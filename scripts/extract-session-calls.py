#!/usr/bin/env python3
"""extract-session-calls.py — Extrahiert Tool-Calls aus Claude Code JSONL-Sessions.

Liest eine JSONL-Session-Datei und gibt eine kompakte Liste aller Tool-Calls aus:
- Tool-Name
- Input (gekuerzt)
- Result (gekuerzt) oder Error
- Ob der Call fehlgeschlagen ist

Output: Strukturierter Text, geeignet als Input fuer MiniMax-Analyse.

Usage:
    python3 scripts/extract-session-calls.py <session.jsonl> [--max-input-len N] [--max-result-len N] [--json]
"""

import json
import sys
import argparse
from pathlib import Path


def truncate(text: str, max_len: int) -> str:
    """Kuerzt Text auf max_len Zeichen mit ... Marker."""
    if not text:
        return ""
    text = text.strip()
    if len(text) <= max_len:
        return text
    return text[:max_len] + "..."


def extract_tool_calls(jsonl_path: str, max_input_len: int = 200, max_result_len: int = 300) -> list[dict]:
    """Extrahiert alle Tool-Calls mit Results aus einer JSONL-Session."""

    # Phase 1: Alle Zeilen parsen, tool_use und tool_result sammeln
    tool_uses = {}   # id -> {name, input, timestamp, uuid}
    tool_results = {}  # tool_use_id -> {content, is_error}
    call_order = []  # tool_use IDs in Reihenfolge

    with open(jsonl_path, "r") as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue

            entry_type = entry.get("type")
            message = entry.get("message", {})
            content = message.get("content", [])

            # String content (kein Array) ueberspringen
            if isinstance(content, str):
                continue

            timestamp = entry.get("timestamp", "")

            for block in content:
                if not isinstance(block, dict):
                    continue

                # Tool-Use (Assistant ruft Tool auf)
                if block.get("type") == "tool_use":
                    tool_id = block.get("id", "")
                    tool_uses[tool_id] = {
                        "name": block.get("name", "unknown"),
                        "input": block.get("input", {}),
                        "timestamp": timestamp,
                    }
                    call_order.append(tool_id)

                # Tool-Result (System gibt Ergebnis zurueck)
                elif block.get("type") == "tool_result":
                    tool_use_id = block.get("tool_use_id", "")
                    result_content = block.get("content", "")
                    is_error = block.get("is_error", False)
                    tool_results[tool_use_id] = {
                        "content": result_content if isinstance(result_content, str) else json.dumps(result_content, ensure_ascii=False),
                        "is_error": is_error,
                    }

    # Phase 2: Zusammenfuehren
    calls = []
    for i, tool_id in enumerate(call_order, 1):
        use = tool_uses[tool_id]
        result = tool_results.get(tool_id, {})

        # Input formatieren
        inp = use["input"]
        if isinstance(inp, dict):
            # Fuer Read/Write: nur file_path zeigen
            if use["name"] in ("Read", "Write", "Edit") and "file_path" in inp:
                input_summary = inp["file_path"]
                if use["name"] == "Edit" and "old_string" in inp:
                    input_summary += f" (edit: {truncate(inp['old_string'], 60)})"
            elif use["name"] == "Bash" and "command" in inp:
                input_summary = inp["command"]
            elif use["name"] == "Grep" and "pattern" in inp:
                input_summary = f"pattern={inp['pattern']}"
                if "path" in inp:
                    input_summary += f" path={inp['path']}"
            elif use["name"] == "Glob" and "pattern" in inp:
                input_summary = f"pattern={inp['pattern']}"
            else:
                input_summary = json.dumps(inp, ensure_ascii=False)
        else:
            input_summary = str(inp)

        # Result formatieren
        result_text = result.get("content", "")
        is_error = result.get("is_error", False)

        # Error-Detection: Bash exit codes und Tool-Use-Errors erkennen
        if not is_error and result_text:
            lower = result_text[:500].lower()
            if any(marker in lower for marker in ["exit code", "command failed", "<tool_use_error>"]):
                is_error = True

        call = {
            "seq": i,
            "name": use["name"],
            "input": truncate(input_summary, max_input_len),
            "result": truncate(result_text, max_result_len),
            "error": is_error,
            "timestamp": use["timestamp"],
        }
        calls.append(call)

    return calls


def format_text(calls: list[dict]) -> str:
    """Formatiert Calls als lesbaren Text fuer MiniMax-Analyse."""
    lines = []
    lines.append(f"# Session Tool-Calls ({len(calls)} total)\n")

    error_count = sum(1 for c in calls if c["error"])
    lines.append(f"Errors: {error_count}/{len(calls)}\n")

    for c in calls:
        status = "ERROR" if c["error"] else "OK"
        lines.append(f"## [{c['seq']}] {c['name']} [{status}]")
        lines.append(f"Input: {c['input']}")
        if c["result"]:
            lines.append(f"Result: {c['result']}")
        lines.append("")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Extract tool calls from Claude Code JSONL sessions")
    parser.add_argument("jsonl", help="Path to JSONL session file")
    parser.add_argument("--max-input-len", type=int, default=200, help="Max chars for input summary (default: 200)")
    parser.add_argument("--max-result-len", type=int, default=300, help="Max chars for result summary (default: 300)")
    parser.add_argument("--json", action="store_true", help="Output as JSON instead of text")
    args = parser.parse_args()

    jsonl_path = Path(args.jsonl).expanduser()
    if not jsonl_path.exists():
        print(f"ERROR: {jsonl_path} nicht gefunden", file=sys.stderr)
        sys.exit(1)

    calls = extract_tool_calls(str(jsonl_path), args.max_input_len, args.max_result_len)

    if args.json:
        print(json.dumps(calls, indent=2, ensure_ascii=False))
    else:
        print(format_text(calls))


if __name__ == "__main__":
    main()
