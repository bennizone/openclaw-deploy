#!/usr/bin/env python3
"""orchestrator-audit.py — Prueft ob der Orchestrator seinen Workflow eingehalten hat.

Analysiert eine Claude Code JSONL-Session auf Workflow-Verletzungen:
- Hat der Orchestrator selbst Code editiert statt /coder zu delegieren?
- Wurden Pflicht-Schritte uebersprungen (/consult, /reviewer, /tester, /docs)?
- Hat der Orchestrator mechanische Findings selbst gefixt?

Usage:
    python3 scripts/orchestrator-audit.py <session.jsonl> [--json]
"""

import json
import re
import sys
import argparse
from pathlib import Path

# extract-session-calls.py importierbar machen
sys.path.insert(0, str(Path(__file__).parent))
from importlib import import_module
extract_mod = import_module("extract-session-calls")
extract_tool_calls = extract_mod.extract_tool_calls

# Pfade die der Orchestrator direkt editieren darf (kein Violation)
ALLOWED_ORCHESTRATOR_PATTERNS = [
    r"\.claude/projects/.*/memory/",
    r"\.claude/plans/",
    r"docs/workflow-patterns\.md$",
    r"config/autonomy\.json$",
    r"docs/PLAN-.*\.md$",
    r"MEMORY\.md$",
    r"docs/audits/.*\.md$",
]

# Tools die als schreibend gelten
WRITE_TOOLS = {"Edit", "Write"}

SEVERITY_ORDER = {"HOCH": 0, "MITTEL": 1, "NIEDRIG": 2}

# Deterministische Patch-Vorschlaege pro Violation-Typ
PATCH_SUGGESTIONS = {
    "ORCH-EDIT": {
        "file": "CLAUDE.md",
        "section": "Orchestrator-Protokoll",
        "patch": "WARNUNG: Orchestrator schreibt KEINEN Code. Auch nicht 'nur kurz' oder "
                 "'nur eine Datei'. IMMER /coder delegieren — auch fuer neue Dateien.",
    },
    "ORCH-FIX": {
        "file": "CLAUDE.md",
        "section": "Workflow Schritt 10a",
        "patch": "WARNUNG: Nach /reviewer mechanische Findings IMMER an /coder delegieren. "
                 "Orchestrator fixt NIE selbst — auch nicht einzeilige Aenderungen.",
    },
    "SKIP-CONSULT": {
        "file": "CLAUDE.md",
        "section": "Workflow Schritt 4",
        "patch": "Konsultationsrunde (/consult oder /plan-review) ist Pflicht vor Implementierung. "
                 "NICHT ueberspringen — kostet fast nichts, verhindert Fehlentscheidungen.",
    },
    "SKIP-REVIEWER": {
        "file": "CLAUDE.md",
        "section": "Workflow Schritt 10",
        "patch": "/reviewer ist Pflicht nach jeder Implementierung. Kein Skip erlaubt.",
    },
    "SKIP-TESTER": {
        "file": "CLAUDE.md",
        "section": "Workflow Schritt 9",
        "patch": "/tester nach Implementierung ausfuehren — mindestens Health-Checks "
                 "und Plugin-Doctor wenn Plugins betroffen sind.",
    },
    "SKIP-DOCS": {
        "file": "CLAUDE.md",
        "section": "Workflow Schritt 11",
        "patch": "/docs fuer DECISIONS.md ist Pflicht bei bewussten Entscheidungen. "
                 "Optional nur bei mechanischen Changes (Typos, Formatting, Refactoring ohne Verhaltenssaenderung).",
    },
    "SKIP-DESCRIPTION": {
        "file": "CLAUDE.md",
        "section": "Workflow Schritt 2",
        "patch": "components/*/description.md MUSS vor Implementierung gelesen werden.",
    },
}


def is_allowed_orchestrator_path(file_path: str) -> bool:
    """Prueft ob ein Dateipfad fuer Orchestrator-Edits erlaubt ist."""
    for pattern in ALLOWED_ORCHESTRATOR_PATTERNS:
        if re.search(pattern, file_path):
            return True
    return False


def extract_file_path(call: dict) -> str | None:
    """Extrahiert den Dateipfad aus dem Input eines Edit/Write Calls."""
    inp = call["input"]
    # Input ist bereits formatiert: bei Edit/Write nur file_path
    # Format: "/path/to/file" oder "/path/to/file (edit: ...)"
    if " (edit:" in inp:
        return inp.split(" (edit:")[0].strip()
    return inp.strip()


def extract_skill_name(call: dict) -> str | None:
    """Extrahiert den Skill-Namen aus einem Skill-Call."""
    inp = call["input"]
    try:
        data = json.loads(inp)
        return data.get("skill", "")
    except (json.JSONDecodeError, TypeError):
        # Fallback: Regex
        m = re.search(r'"skill"\s*:\s*"([^"]+)"', inp)
        return m.group(1) if m else None


def build_segments(calls: list[dict]) -> list[dict]:
    """Baut Kontext-Segmente: Orchestrator vs Sub-Agent."""
    segments = []
    current_agent = "orchestrator"
    current_calls = []
    start_seq = 1

    for call in calls:
        if call["name"] == "Skill":
            # Aktuelles Segment abschliessen
            if current_calls:
                segments.append({
                    "agent": current_agent,
                    "start_seq": start_seq,
                    "end_seq": current_calls[-1]["seq"],
                    "calls": current_calls,
                })
            # Neues Segment starten
            skill = extract_skill_name(call)
            current_agent = skill or "unknown-skill"
            current_calls = [call]
            start_seq = call["seq"]
        else:
            current_calls.append(call)

    # Letztes Segment
    if current_calls:
        segments.append({
            "agent": current_agent,
            "start_seq": start_seq,
            "end_seq": current_calls[-1]["seq"],
            "calls": current_calls,
        })

    return segments


def check_violations(calls: list[dict], segments: list[dict]) -> list[dict]:
    """Prueft alle Violations deterministisch."""
    violations = []
    has_edits = False
    first_edit_seq = None
    had_reviewer = False
    had_coder = False
    had_consult = False
    had_tester = False
    had_docs = False
    had_description_read = False

    # Global: Skill-Nutzung und description.md Reads tracken
    for call in calls:
        if call["name"] == "Skill":
            skill = extract_skill_name(call)
            if skill == "reviewer":
                had_reviewer = True
            elif skill == "coder":
                had_coder = True
            elif skill in ("consult", "plan-review"):
                had_consult = True
            elif skill == "tester":
                had_tester = True
            elif skill == "docs":
                had_docs = True
        elif call["name"] == "Bash" and "consult-agent.sh" in call.get("input", ""):
            had_consult = True
        elif call["name"] == "Read" and "components/" in call["input"] and "description.md" in call["input"]:
            had_description_read = True
        if call["name"] in WRITE_TOOLS and not has_edits:
            fp = extract_file_path(call)
            if fp and not is_allowed_orchestrator_path(fp):
                has_edits = True
                first_edit_seq = call["seq"]

    # Segment-basierte Violations: ORCH-EDIT und ORCH-FIX
    # Nur /coder darf Projektdateien editieren. Edits in jedem anderen Segment
    # (orchestrator, reviewer, docs, tester, etc.) sind Violations.
    post_reviewer = False
    for seg in segments:
        if seg["agent"] == "reviewer":
            post_reviewer = True

        # /coder und /docs duerfen Projektdateien editieren
        if seg["agent"] in ("coder", "docs"):
            continue

        bad_edits = []
        for call in seg["calls"]:
            if call["name"] not in WRITE_TOOLS:
                continue
            fp = extract_file_path(call)
            if not fp or is_allowed_orchestrator_path(fp):
                continue
            bad_edits.append(call)

        if not bad_edits:
            continue

        seqs = [c["seq"] for c in bad_edits]
        files = list(set(extract_file_path(c) for c in bad_edits))
        file_names = [Path(f).name for f in files if f]

        if post_reviewer:
            violations.append({
                "id": "ORCH-FIX",
                "severity": "HOCH",
                "details": f"{len(bad_edits)} Edit(s) nach /reviewer ohne /coder: {', '.join(file_names)}",
                "calls": seqs,
            })
        else:
            violations.append({
                "id": "ORCH-EDIT",
                "severity": "HOCH",
                "details": f"{len(bad_edits)} Edit(s) auf Projektdateien ohne /coder: {', '.join(file_names)}",
                "calls": seqs,
            })

    # SKIP-Violations (nur wenn es Edits auf Projektdateien gab)
    if has_edits:
        if not had_consult:
            violations.append({
                "id": "SKIP-CONSULT",
                "severity": "MITTEL",
                "details": "Keine /consult oder /plan-review vor Implementierung",
                "calls": [first_edit_seq] if first_edit_seq else [],
            })

        if not had_reviewer:
            violations.append({
                "id": "SKIP-REVIEWER",
                "severity": "HOCH",
                "details": "Kein /reviewer nach Implementierung",
                "calls": [],
            })

        if not had_tester:
            violations.append({
                "id": "SKIP-TESTER",
                "severity": "MITTEL",
                "details": "Kein /tester nach Implementierung",
                "calls": [],
            })

        if not had_docs:
            violations.append({
                "id": "SKIP-DOCS",
                "severity": "MITTEL",
                "details": "Kein /docs fuer DECISIONS.md",
                "calls": [],
            })

        if not had_description_read:
            violations.append({
                "id": "SKIP-DESCRIPTION",
                "severity": "MITTEL",
                "details": "Kein Read auf components/*/description.md vor Implementierung",
                "calls": [],
            })

    # Sortieren: HOCH > MITTEL > NIEDRIG
    violations.sort(key=lambda v: SEVERITY_ORDER.get(v["severity"], 99))
    return violations


def format_calls_range(seqs: list[int]) -> str:
    """Formatiert Call-Nummern kompakt: [9,10,11,12] -> '9-12'."""
    if not seqs:
        return "—"
    seqs = sorted(seqs)
    if len(seqs) == 1:
        return str(seqs[0])

    ranges = []
    start = seqs[0]
    end = seqs[0]
    for s in seqs[1:]:
        if s == end + 1:
            end = s
        else:
            ranges.append(f"{start}-{end}" if start != end else str(start))
            start = end = s
    ranges.append(f"{start}-{end}" if start != end else str(start))
    return ", ".join(ranges)


def format_report(session_name: str, calls: list[dict], segments: list[dict],
                  violations: list[dict]) -> str:
    """Formatiert den Audit-Report als lesbaren Text."""
    lines = ["# Orchestrator Self-Audit", ""]

    orch_calls = sum(len(s["calls"]) for s in segments if s["agent"] == "orchestrator")
    agent_calls = len(calls) - orch_calls

    lines.append(f"Session: {session_name}")
    lines.append(f"Tool-Calls: {len(calls)} total | {orch_calls} Orchestrator | {agent_calls} Sub-Agent")
    lines.append("")

    # Violations
    if violations:
        lines.append(f"## Violations ({len(violations)} gefunden)")
        lines.append("")
        lines.append(f"| # | Schwere | Regel | Details | Calls |")
        lines.append(f"|---|---------|-------|---------|-------|")
        for i, v in enumerate(violations, 1):
            calls_str = format_calls_range(v["calls"])
            lines.append(f"| {i} | {v['severity']} | {v['id']} | {v['details']} | {calls_str} |")
        lines.append("")
    else:
        lines.append("## Violations: Keine")
        lines.append("")

    # Compliance-Checkliste
    skills_used = set()
    for call in calls:
        if call["name"] == "Skill":
            skill = extract_skill_name(call)
            if skill:
                skills_used.add(skill)

    has_desc_read = any(
        c["name"] == "Read" and "components/" in c["input"] and "description.md" in c["input"]
        for c in calls
    )
    has_consult_bash = any(
        c["name"] == "Bash" and "consult-agent.sh" in c.get("input", "")
        for c in calls
    )
    has_consult = bool(skills_used & {"consult", "plan-review"}) or has_consult_bash

    def check(ok: bool) -> str:
        return "[x]" if ok else "[ ]"

    lines.append("## Workflow-Compliance")
    lines.append("")
    lines.append(f"- {check(has_desc_read)} description.md gelesen")
    lines.append(f"- {check(has_consult)} /consult durchgefuehrt")
    lines.append(f"- {check('coder' in skills_used)} /coder fuer Implementierung")
    lines.append(f"- {check('reviewer' in skills_used)} /reviewer fuer Review")
    lines.append(f"- {check('tester' in skills_used)} /tester fuer Tests")
    lines.append(f"- {check('docs' in skills_used)} /docs fuer DECISIONS.md")
    lines.append("")

    # Patch-Vorschlaege
    if violations:
        lines.append("## Patch-Vorschlaege")
        lines.append("")
        seen_patches = set()
        for v in violations:
            vid = v["id"]
            if vid in seen_patches:
                continue
            seen_patches.add(vid)
            patch = PATCH_SUGGESTIONS.get(vid)
            if patch:
                lines.append(f"**{vid}** → In `{patch['file']}` ({patch['section']}):")
                lines.append(f"  {patch['patch']}")
                lines.append("")

    return "\n".join(lines)


def format_json(session_name: str, calls: list[dict], segments: list[dict],
                violations: list[dict]) -> str:
    """Formatiert den Audit-Report als JSON."""
    orch_calls = sum(len(s["calls"]) for s in segments if s["agent"] == "orchestrator")

    skills_used = set()
    for call in calls:
        if call["name"] == "Skill":
            skill = extract_skill_name(call)
            if skill:
                skills_used.add(skill)

    has_desc_read = any(
        c["name"] == "Read" and "components/" in c["input"] and "description.md" in c["input"]
        for c in calls
    )

    result = {
        "session": session_name,
        "stats": {
            "total_calls": len(calls),
            "orchestrator_calls": orch_calls,
            "agent_calls": len(calls) - orch_calls,
        },
        "violations": [
            {
                "id": v["id"],
                "severity": v["severity"],
                "details": v["details"],
                "calls": v["calls"],
                "patch": PATCH_SUGGESTIONS.get(v["id"]),
            }
            for v in violations
        ],
        "compliance": {
            "description_read": has_desc_read,
            "consult": bool(skills_used & {"consult", "plan-review"}),
            "coder": "coder" in skills_used,
            "reviewer": "reviewer" in skills_used,
            "tester": "tester" in skills_used,
            "docs": "docs" in skills_used,
        },
    }
    return json.dumps(result, indent=2, ensure_ascii=False)


def main():
    parser = argparse.ArgumentParser(description="Orchestrator Self-Audit fuer Claude Code Sessions")
    parser.add_argument("jsonl", help="Pfad zur JSONL-Session-Datei")
    parser.add_argument("--json", action="store_true", help="Output als JSON")
    args = parser.parse_args()

    jsonl_path = Path(args.jsonl).expanduser()
    if not jsonl_path.exists():
        print(f"Fehler: {jsonl_path} nicht gefunden", file=sys.stderr)
        sys.exit(1)

    # Hoehere max_input_len damit Skill-Parameter und file_paths erhalten bleiben
    calls = extract_tool_calls(str(jsonl_path), max_input_len=500, max_result_len=100)

    if not calls:
        print("Keine Tool-Calls in der Session gefunden.", file=sys.stderr)
        sys.exit(0)

    segments = build_segments(calls)
    violations = check_violations(calls, segments)

    session_name = jsonl_path.name

    if args.json:
        print(format_json(session_name, calls, segments, violations))
    else:
        print(format_report(session_name, calls, segments, violations))



if __name__ == "__main__":
    main()
