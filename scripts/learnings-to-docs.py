#!/usr/bin/env python3
"""learnings-to-docs.py — Phase F.2: Learnings aus workflow-patterns.md zurueck in Komponenten-Docs.

Parst workflow-patterns.md, ordnet Patterns Komponenten zu, generiert
Patch-Vorschlaege fuer description.md / Checklisten und trackt Resolution.

Usage:
    python3 scripts/learnings-to-docs.py                  # Vorschlaege zeigen
    python3 scripts/learnings-to-docs.py --apply           # Patches schreiben
    python3 scripts/learnings-to-docs.py --component NAME  # Nur eine Komponente
    python3 scripts/learnings-to-docs.py --resolve         # Resolution-Check: offen→geloest
"""

import argparse
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
PATTERNS_FILE = REPO_ROOT / "docs" / "workflow-patterns.md"
COMPONENTS_DIR = REPO_ROOT / "components"

# Bekannte Komponenten
COMPONENTS = sorted(p.name for p in COMPONENTS_DIR.iterdir() if p.is_dir())

# Keyword → Komponente Mapping (Dateien, Begriffe)
KEYWORD_MAP = {
    "deploy-checklist": "tool-hub",
    "new-tool-checklist": "tool-hub",
    "tool-hub": "tool-hub",
    "mcp": "tool-hub",
    "gateway": "gateway",
    "openclaw-gateway": "gateway",
    "config-change": "gateway",
    "systemctl": "gateway",
    "XDG_RUNTIME_DIR": "gateway",
    "qdrant": "memory-system",
    "extractor": "memory-system",
    "memory": "memory-system",
    "embedding": "memory-system",
    "bge-m3": "memory-system",
    "gpu": "gpu-server",
    "llama": "gpu-server",
    "model-swap": "gpu-server",
    "ha-integration": "ha-integration",
    "home-assistant": "ha-integration",
    "home-llm": "ha-integration",
    "plugin": "openclaw-skills",
    "skill": "openclaw-skills",
    "new-skill": "openclaw-skills",
    "onboard": "onboard",
    "consult-agent": None,  # Kein Komponenten-Fix
    "CLAUDE.md": None,
    "Claude-Verhalten": None,
    "testinstruct": "tool-hub",
}


def parse_patterns(path: Path) -> list[dict]:
    """Parst die Markdown-Tabelle in workflow-patterns.md."""
    text = path.read_text(encoding="utf-8")
    rows = []
    in_table = False
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("| Datum"):
            in_table = True
            continue
        if in_table and line.startswith("|---"):
            continue
        if in_table and line.startswith("|"):
            cols = [c.strip() for c in line.split("|")[1:-1]]
            if len(cols) >= 6:
                rows.append({
                    "datum": cols[0],
                    "feature": cols[1],
                    "pattern": cols[2],
                    "fix": cols[3],
                    "status": cols[4],
                    "anzahl": int(cols[5]) if cols[5].isdigit() else 1,
                    "_raw": line,
                })
        elif in_table and not line.startswith("|"):
            break
    return rows


def match_component(entry: dict) -> str | None:
    """Bestimmt die betroffene Komponente aus Fix-Spalte und Pattern."""
    fix = entry["fix"]
    pattern = entry["pattern"]
    combined = f"{fix} {pattern}"

    # Direkte Datei-Referenzen in Fix-Spalte
    for keyword, comp in KEYWORD_MAP.items():
        if keyword.lower() in combined.lower():
            return comp

    # Komponenten-Name direkt im Text
    for comp in COMPONENTS:
        if comp in combined.lower():
            return comp

    return None


def find_target_files(component: str) -> dict[str, Path]:
    """Findet description.md und Checklisten einer Komponente."""
    comp_dir = COMPONENTS_DIR / component
    targets = {}
    desc = comp_dir / "description.md"
    if desc.exists():
        targets["description"] = desc
    for f in comp_dir.glob("*checklist*"):
        targets[f.stem] = f
    return targets


def fix_already_in_docs(entry: dict, component: str) -> bool:
    """Prueft ob der Fix-Inhalt bereits in den Komponenten-Docs steht."""
    targets = find_target_files(component)
    fix_text = entry["fix"].lower()
    pattern_text = entry["pattern"].lower()

    # Kernbegriffe aus dem Fix extrahieren
    key_terms = []
    # Dateinamen
    for m in re.finditer(r'[\w-]+\.(md|json|ts|py|sh)', fix_text):
        key_terms.append(m.group(0))
    # "Schritt N" Referenzen
    for m in re.finditer(r'Schritt\s+(\d+)', fix_text, re.IGNORECASE):
        key_terms.append("schritt")
    # Fallback: markante Woerter aus Pattern
    if not key_terms:
        for word in pattern_text.split():
            if len(word) > 5 and word not in ("vergessen", "unklar", "noetig"):
                key_terms.append(word)
                break

    for name, path in targets.items():
        content = path.read_text(encoding="utf-8").lower()
        # Wenn >50% der Kernbegriffe gefunden → bereits dokumentiert
        if key_terms:
            found = sum(1 for t in key_terms if t.lower() in content)
            if found >= max(1, len(key_terms) * 0.5):
                return True

    return False


def generate_patch(entry: dict, component: str) -> dict | None:
    """Generiert einen Patch-Vorschlag fuer die Komponenten-Docs."""
    targets = find_target_files(component)
    fix = entry["fix"]
    pattern = entry["pattern"]

    # Checklisten-Referenz im Fix?
    checklist_match = re.search(r'([\w-]+-checklist)\.md\s+Schritt\s+(\d+)', fix)
    if checklist_match:
        cl_name = checklist_match.group(1)
        if cl_name in targets:
            # Fix ist bereits als Checklisten-Schritt dokumentiert → kein Patch
            return None

    # Patch fuer description.md: "Bekannte Einschraenkungen" Abschnitt
    desc = targets.get("description")
    if not desc:
        return None

    content = desc.read_text(encoding="utf-8")
    section = "## Bekannte Einschraenkungen"
    bullet = f"- **{pattern.split('→')[0].strip() if '→' in pattern else pattern[:60]}** — {fix}"

    if section in content:
        # Duplikat-Check
        if bullet.split("—")[0].strip().lower() in content.lower():
            return None
        return {
            "file": desc,
            "action": "append_to_section",
            "section": section,
            "content": bullet,
        }
    else:
        return {
            "file": desc,
            "action": "add_section",
            "section": section,
            "content": f"\n{section}\n\n{bullet}\n",
        }


def apply_patch(patch: dict) -> bool:
    """Wendet einen Patch auf die Zieldatei an."""
    path = patch["file"]
    content = path.read_text(encoding="utf-8")

    if patch["action"] == "add_section":
        # Am Ende anfuegen
        content = content.rstrip() + "\n" + patch["content"]
        path.write_text(content, encoding="utf-8")
        return True
    elif patch["action"] == "append_to_section":
        # Nach der Section-Ueberschrift den Bullet einfuegen
        section = patch["section"]
        idx = content.find(section)
        if idx == -1:
            return False
        # Finde das Ende des Abschnitts (naechste ## oder EOF)
        after = content[idx + len(section):]
        next_section = re.search(r'\n## ', after)
        if next_section:
            insert_pos = idx + len(section) + next_section.start()
        else:
            insert_pos = len(content)
        # Vor dem naechsten Abschnitt einfuegen
        new_content = content[:insert_pos].rstrip() + "\n" + patch["content"] + "\n" + content[insert_pos:]
        path.write_text(new_content, encoding="utf-8")
        return True
    return False


def update_pattern_status(patterns: list[dict], resolved_indices: list[int]) -> None:
    """Aktualisiert Status in workflow-patterns.md von 'offen' auf 'geloest'."""
    text = PATTERNS_FILE.read_text(encoding="utf-8")
    for idx in resolved_indices:
        entry = patterns[idx]
        old_raw = entry["_raw"]
        new_raw = old_raw.replace("| offen |", "| geloest |")
        if new_raw != old_raw:
            text = text.replace(old_raw, new_raw)
    PATTERNS_FILE.write_text(text, encoding="utf-8")


def consult_minimax(pattern: str) -> str | None:
    """Fallback: MiniMax via consult-sdk.mjs befragen fuer Komponenten-Zuordnung."""
    script = REPO_ROOT / "scripts" / "consult-sdk.mjs"
    if not script.exists():
        return None
    question = (
        f"Welche OpenClaw-Komponente ist von diesem Pattern betroffen? "
        f"Antworte NUR mit dem Komponenten-Namen (z.B. tool-hub, gateway, memory-system). "
        f"Pattern: {pattern}"
    )
    try:
        result = subprocess.run(
            ["node", str(script), "--component", "protokollant", "--question", question, "--brief"],
            capture_output=True, text=True, timeout=120,
        )
        answer = result.stdout.strip().lower()
        for comp in COMPONENTS:
            if comp in answer:
                return comp
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass
    return None


def main():
    parser = argparse.ArgumentParser(description="Learnings → Docs Flow (Phase F.2)")
    parser.add_argument("--apply", action="store_true", help="Patches schreiben")
    parser.add_argument("--resolve", action="store_true", help="Resolution-Check: offen→geloest")
    parser.add_argument("--component", help="Nur eine Komponente bearbeiten")
    parser.add_argument("--consult", action="store_true", help="MiniMax-Fallback fuer unbekannte Zuordnungen")
    args = parser.parse_args()

    if not PATTERNS_FILE.exists():
        print(f"FEHLER: {PATTERNS_FILE} nicht gefunden", file=sys.stderr)
        sys.exit(1)

    patterns = parse_patterns(PATTERNS_FILE)
    if not patterns:
        print("Keine Patterns in workflow-patterns.md gefunden.")
        return

    print(f"📋 {len(patterns)} Patterns geladen\n")

    # --- Resolution-Tracking (F.2.2) ---
    if args.resolve:
        resolved = []
        for i, entry in enumerate(patterns):
            if entry["status"] != "offen":
                continue
            comp = match_component(entry)
            if comp and fix_already_in_docs(entry, comp):
                resolved.append(i)
                print(f"  ✓ #{i+1} → geloest (Fix in {comp} Docs gefunden)")
        if resolved:
            update_pattern_status(patterns, resolved)
            print(f"\n{len(resolved)} Pattern(s) als geloest markiert.")
        else:
            print("Keine offenen Patterns mit vorhandenen Fixes gefunden.")
        return

    # --- Patch-Vorschlaege (F.2.1) ---
    proposals = []
    unmatched = []

    for i, entry in enumerate(patterns):
        comp = match_component(entry)

        # MiniMax-Fallback
        if comp is None and args.consult:
            comp = consult_minimax(entry["pattern"])

        if args.component and comp != args.component:
            continue

        if comp is None:
            unmatched.append(entry)
            continue

        # Bereits dokumentiert?
        if fix_already_in_docs(entry, comp):
            print(f"  ⏭ #{i+1} [{comp}] bereits in Docs: {entry['pattern'][:50]}")
            continue

        patch = generate_patch(entry, comp)
        if patch:
            proposals.append((i, entry, comp, patch))
        else:
            print(f"  ⏭ #{i+1} [{comp}] kein Patch noetig: {entry['pattern'][:50]}")

    # Ergebnisse
    if proposals:
        print(f"\n{'='*60}")
        print(f"📝 {len(proposals)} Patch-Vorschlag/Vorschlaege:\n")
        for i, entry, comp, patch in proposals:
            rel_path = patch["file"].relative_to(REPO_ROOT)
            print(f"  #{i+1} [{comp}] → {rel_path}")
            print(f"      Pattern: {entry['pattern'][:70]}")
            print(f"      Aktion:  {patch['action']}")
            print(f"      Inhalt:  {patch['content'].strip()[:100]}")
            print()

        if args.apply:
            applied = 0
            for i, entry, comp, patch in proposals:
                if apply_patch(patch):
                    applied += 1
                    print(f"  ✅ #{i+1} angewendet auf {patch['file'].relative_to(REPO_ROOT)}")
                else:
                    print(f"  ❌ #{i+1} fehlgeschlagen")
            print(f"\n{applied}/{len(proposals)} Patches angewendet.")
        else:
            print("→ Mit --apply Patches schreiben")
    else:
        print("\nKeine neuen Patches noetig.")

    if unmatched:
        print(f"\n⚠ {len(unmatched)} Pattern(s) ohne Komponenten-Zuordnung:")
        for e in unmatched:
            print(f"  - {e['pattern'][:70]}")
        if not args.consult:
            print("  → Mit --consult MiniMax-Fallback aktivieren")


if __name__ == "__main__":
    main()
