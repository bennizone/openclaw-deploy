#!/usr/bin/env python3
"""aggregate-sessions.py — Multi-Session-Aggregation fuer Claude Code Sessions.

Liest mehrere JSONL-Sessions, extrahiert Tool-Calls und erkennt
Cross-Session-Patterns (wiederkehrende Errors, Tool-Verteilung, Waste).

Usage:
    python3 scripts/aggregate-sessions.py [--dir DIR] [--since YYYY-MM-DD] [--json] [--minimax]
"""

import json
import sys
import argparse
from pathlib import Path
from datetime import datetime, timezone
from collections import Counter

# extract-session-calls.py importierbar machen
sys.path.insert(0, str(Path(__file__).parent))
from importlib import import_module
extract_mod = import_module("extract-session-calls")
extract_tool_calls = extract_mod.extract_tool_calls


def get_session_mtime(jsonl_path: Path) -> datetime:
    """Letzte Aenderung der Session-Datei als Datetime."""
    return datetime.fromtimestamp(jsonl_path.stat().st_mtime, tz=timezone.utc)


def error_fingerprint(call: dict) -> str:
    """Erstellt einen Fingerprint fuer Error-Gruppierung: Tool-Name + Error-Typ."""
    name = call["name"]
    result = call.get("result", "")[:200].lower()

    if "tool_use_error" in result:
        return f"{name}:tool_use_error"
    elif "exit code" in result:
        return f"{name}:exit_code"
    elif "not found" in result or "nicht gefunden" in result:
        return f"{name}:not_found"
    elif "timeout" in result:
        return f"{name}:timeout"
    elif "permission" in result or "denied" in result:
        return f"{name}:permission"
    else:
        return f"{name}:other_error"


def analyze_sessions(session_dir: str, since: str | None = None) -> dict:
    """Analysiert alle Sessions im Verzeichnis."""
    session_path = Path(session_dir)
    jsonl_files = sorted(session_path.glob("*.jsonl"), key=lambda p: p.stat().st_mtime)

    if since:
        since_dt = datetime.strptime(since, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        jsonl_files = [f for f in jsonl_files if get_session_mtime(f) >= since_dt]

    sessions = []
    all_errors = []
    tool_counter = Counter()
    error_counter = Counter()
    total_calls = 0
    total_errors = 0

    for jsonl_file in jsonl_files:
        try:
            calls = extract_tool_calls(str(jsonl_file), max_input_len=100, max_result_len=200)
        except Exception as e:
            print(f"WARN: {jsonl_file.name} uebersprungen: {e}", file=sys.stderr)
            continue

        if not calls:
            continue

        session_errors = [c for c in calls if c["error"]]
        error_rate = len(session_errors) / len(calls) if calls else 0

        session_tools = Counter(c["name"] for c in calls)
        tool_counter.update(session_tools)
        total_calls += len(calls)
        total_errors += len(session_errors)

        for err_call in session_errors:
            fp = error_fingerprint(err_call)
            error_counter[fp] += 1
            all_errors.append({
                "session": jsonl_file.name,
                "fingerprint": fp,
                "input": err_call["input"],
                "result": err_call["result"][:150],
            })

        sessions.append({
            "file": jsonl_file.name,
            "mtime": get_session_mtime(jsonl_file).isoformat(),
            "total_calls": len(calls),
            "errors": len(session_errors),
            "error_rate": round(error_rate, 3),
            "top_tools": session_tools.most_common(5),
        })

    # Strukturelle Patterns: >= 3 Vorkommen
    structural = {fp: count for fp, count in error_counter.items() if count >= 3}

    return {
        "summary": {
            "sessions_analyzed": len(sessions),
            "sessions_skipped": len(jsonl_files) - len(sessions),
            "total_calls": total_calls,
            "total_errors": total_errors,
            "error_rate": round(total_errors / total_calls, 3) if total_calls else 0,
        },
        "tool_distribution": tool_counter.most_common(15),
        "error_fingerprints": error_counter.most_common(20),
        "structural_patterns": structural,
        "sessions": sessions,
        "error_details": all_errors,
    }


def format_minimax(data: dict) -> str:
    """Kompakter Output fuer MiniMax-Konsultation (max ~3000 Zeichen)."""
    lines = []
    s = data["summary"]
    lines.append(f"# Multi-Session-Aggregation")
    lines.append(f"{s['sessions_analyzed']} Sessions, {s['total_calls']} Calls, "
                 f"{s['total_errors']} Errors ({s['error_rate']*100:.1f}%)\n")

    lines.append("## Tool-Verteilung (Top 10)")
    for tool, count in data["tool_distribution"][:10]:
        pct = count / s["total_calls"] * 100 if s["total_calls"] else 0
        lines.append(f"  {tool}: {count} ({pct:.0f}%)")
    lines.append("")

    lines.append("## Error-Fingerprints")
    for fp, count in data["error_fingerprints"]:
        marker = " ← STRUKTURELL" if fp in data["structural_patterns"] else ""
        lines.append(f"  {fp}: {count}x{marker}")
    lines.append("")

    if data["structural_patterns"]:
        lines.append("## Strukturelle Probleme (>= 3x)")
        for fp, count in data["structural_patterns"].items():
            examples = [e for e in data["error_details"] if e["fingerprint"] == fp][:2]
            lines.append(f"\n### {fp} ({count}x)")
            for ex in examples:
                lines.append(f"  Session: {ex['session'][:12]}...")
                lines.append(f"  Input: {ex['input'][:80]}")
                lines.append(f"  Error: {ex['result'][:80]}")
    else:
        lines.append("## Keine strukturellen Probleme gefunden (kein Error >= 3x)")

    lines.append("")
    lines.append("## Sessions mit hoechster Error-Rate")
    worst = sorted(data["sessions"], key=lambda s: s["error_rate"], reverse=True)[:5]
    for sess in worst:
        if sess["errors"] > 0:
            lines.append(f"  {sess['file'][:12]}... {sess['errors']}/{sess['total_calls']} "
                         f"({sess['error_rate']*100:.0f}%)")

    output = "\n".join(lines)
    # Auf 3000 Zeichen begrenzen
    if len(output) > 3000:
        output = output[:2950] + "\n\n[... gekuerzt auf 3000 Zeichen]"
    return output


def format_json(data: dict) -> str:
    return json.dumps(data, indent=2, ensure_ascii=False)


def format_text(data: dict) -> str:
    """Ausfuehrlicher Text-Output fuer direkte Nutzung."""
    lines = []
    s = data["summary"]
    lines.append(f"=== Multi-Session-Aggregation ===")
    lines.append(f"Sessions: {s['sessions_analyzed']} analysiert, {s['sessions_skipped']} uebersprungen")
    lines.append(f"Calls: {s['total_calls']} total, {s['total_errors']} Errors ({s['error_rate']*100:.1f}%)\n")

    lines.append("--- Tool-Verteilung ---")
    for tool, count in data["tool_distribution"]:
        pct = count / s["total_calls"] * 100 if s["total_calls"] else 0
        lines.append(f"  {tool:20s} {count:5d} ({pct:5.1f}%)")
    lines.append("")

    lines.append("--- Error-Fingerprints ---")
    if data["error_fingerprints"]:
        for fp, count in data["error_fingerprints"]:
            marker = " ← STRUKTURELL" if fp in data["structural_patterns"] else ""
            lines.append(f"  {fp}: {count}x{marker}")
    else:
        lines.append("  Keine Errors gefunden")
    lines.append("")

    if data["structural_patterns"]:
        lines.append("--- Strukturelle Probleme (>= 3x) ---")
        for fp, count in data["structural_patterns"].items():
            lines.append(f"\n  {fp} ({count}x):")
            examples = [e for e in data["error_details"] if e["fingerprint"] == fp][:3]
            for ex in examples:
                lines.append(f"    Session: {ex['session']}")
                lines.append(f"    Input:   {ex['input'][:100]}")
                lines.append(f"    Error:   {ex['result'][:100]}")

    lines.append("\n--- Pro Session ---")
    for sess in data["sessions"]:
        err_marker = f" ⚠ {sess['error_rate']*100:.0f}% errors" if sess['errors'] > 0 else ""
        lines.append(f"  {sess['file']} — {sess['total_calls']} calls, {sess['errors']} errors{err_marker}")

    return "\n".join(lines)


def main():
    default_dir = str(Path.home() / ".claude/projects/-home-openclaw-openclaw-deploy")

    parser = argparse.ArgumentParser(description="Multi-Session-Aggregation fuer Claude Code")
    parser.add_argument("--dir", default=default_dir, help=f"JSONL-Verzeichnis (default: {default_dir})")
    parser.add_argument("--since", help="Nur Sessions seit YYYY-MM-DD")
    parser.add_argument("--json", action="store_true", help="JSON-Output")
    parser.add_argument("--minimax", action="store_true", help="Kompakt-Output fuer MiniMax (max 3000 Zeichen)")
    args = parser.parse_args()

    session_dir = Path(args.dir).expanduser()
    if not session_dir.exists():
        print(f"ERROR: Verzeichnis {session_dir} nicht gefunden", file=sys.stderr)
        sys.exit(1)

    data = analyze_sessions(str(session_dir), args.since)

    if data["summary"]["sessions_analyzed"] == 0:
        print("Keine Sessions gefunden.", file=sys.stderr)
        sys.exit(1)

    if args.json:
        print(format_json(data))
    elif args.minimax:
        print(format_minimax(data))
    else:
        print(format_text(data))


if __name__ == "__main__":
    main()
