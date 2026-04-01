#!/usr/bin/env python3
"""autonomy-status.py — Stuetzraeder-Protokoll: Graduierte Autonomie per Komponente.

Subcommands:
    status              Aktuelle Levels aller Komponenten
    check COMP OP       Braucht diese Operation Freigabe?
    record COMP [--error [--critical]]  Session-Ergebnis eintragen
    suggest-promotions  Welche Komponenten koennten aufsteigen?

Usage:
    python3 scripts/autonomy-status.py status
    python3 scripts/autonomy-status.py check gateway deploy
    python3 scripts/autonomy-status.py record tool-hub
    python3 scripts/autonomy-status.py record tool-hub --error
    python3 scripts/autonomy-status.py suggest-promotions
"""

import json
import sys
import argparse
from pathlib import Path
from datetime import date

AUTONOMY_FILE = Path(__file__).parent.parent / "config" / "autonomy.json"

LEVEL_NAMES = {
    0: "Vollstaendig begleitet",
    1: "Begleitet mit Vertrauen",
    2: "Ueberwacht",
    3: "Autonom",
}

# Operations that require approval at each level
# Level 0: everything needs approval
# Level 1: only write operations
# Level 2: only new/unknown ops + deploy
# Level 3: only deploy + config changes
APPROVAL_REQUIRED = {
    0: {"read", "write", "deploy", "config", "new"},
    1: {"write", "deploy", "config", "new"},
    2: {"deploy", "config", "new"},
    3: {"deploy", "config"},
}


def load_autonomy() -> dict:
    """Load autonomy.json, exit with error if missing."""
    if not AUTONOMY_FILE.exists():
        print(f"Fehler: {AUTONOMY_FILE} nicht gefunden.", file=sys.stderr)
        sys.exit(1)
    return json.loads(AUTONOMY_FILE.read_text())


def save_autonomy(data: dict) -> None:
    """Write autonomy.json with pretty formatting."""
    AUTONOMY_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def cmd_status(data: dict) -> None:
    """Show current autonomy levels for all components."""
    levels = data["levels"]
    print(f"{'Komponente':<20} {'Level':>5}  {'Name':<28} {'Sessions':>8} {'Fehlerfrei':>10} {'Letzter Fehler'}")
    print("-" * 100)
    for comp in sorted(levels):
        info = levels[comp]
        m = info["metrics"]
        last_err = m["last_error"] or "—"
        print(
            f"{comp:<20} {info['current']:>5}  {LEVEL_NAMES[info['current']]:<28} "
            f"{m['sessions_total']:>8} {m['sessions_error_free']:>10} {last_err}"
        )


def cmd_check(data: dict, component: str, operation: str) -> None:
    """Check if an operation needs approval for a component."""
    if component not in data["levels"]:
        print(f"Fehler: Komponente '{component}' nicht in autonomy.json.", file=sys.stderr)
        sys.exit(1)

    level = data["levels"][component]["current"]
    needs_approval = operation in APPROVAL_REQUIRED.get(level, set())

    if needs_approval:
        print(f"JA — '{operation}' braucht Freigabe bei Level {level} ({LEVEL_NAMES[level]})")
    else:
        print(f"NEIN — '{operation}' ist bei Level {level} ({LEVEL_NAMES[level]}) freigegeben")

    sys.exit(0 if not needs_approval else 1)


def cmd_record(data: dict, component: str, error: bool, critical: bool) -> None:
    """Record a session result for a component."""
    if component not in data["levels"]:
        print(f"Fehler: Komponente '{component}' nicht in autonomy.json.", file=sys.stderr)
        sys.exit(1)

    info = data["levels"][component]
    m = info["metrics"]
    m["sessions_total"] += 1

    if error:
        m["last_error"] = date.today().isoformat()
        # Regression
        if critical:
            old_level = info["current"]
            info["current"] = 0
            info["since"] = date.today().isoformat()
            print(f"{component}: KRITISCHER FEHLER — Level {old_level} → 0 (Reset)")
        else:
            if info["current"] > 0:
                old_level = info["current"]
                info["current"] -= 1
                info["since"] = date.today().isoformat()
                print(f"{component}: Fehler — Level {old_level} → {info['current']} (Regression)")
            else:
                print(f"{component}: Fehler vermerkt (bleibt Level 0)")
        # Reset error-free counter on any error
        m["sessions_error_free"] = 0
    else:
        m["sessions_error_free"] += 1
        print(f"{component}: Erfolgreiche Session vermerkt ({m['sessions_error_free']} fehlerfrei in Folge)")

    save_autonomy(data)


def cmd_suggest_promotions(data: dict) -> None:
    """Suggest components that could be promoted to the next level."""
    progression = data["progression"]
    suggestions = []

    for comp in sorted(data["levels"]):
        info = data["levels"][comp]
        level = info["current"]
        if level >= 3:
            continue

        key = f"{level}\u2192{level + 1}"
        threshold = progression.get(key, 999)
        error_free = info["metrics"]["sessions_error_free"]

        if error_free >= threshold:
            suggestions.append((comp, level, level + 1, error_free, threshold))

    if not suggestions:
        print("Keine Promotions moeglich — noch nicht genug fehlerfreie Sessions.")
        return

    print("Promotion-Vorschlaege:")
    print(f"{'Komponente':<20} {'Aktuell':>7} {'Neu':>3} {'Fehlerfrei':>10} {'Schwelle':>8}")
    print("-" * 55)
    for comp, old, new, ef, thr in suggestions:
        print(f"{comp:<20} {old:>7} {new:>3} {ef:>10} {thr:>8}")

    print(f"\nPromotion anwenden: Manuell Level in config/autonomy.json setzen oder per User-Freigabe.")


def main():
    parser = argparse.ArgumentParser(description="Stuetzraeder-Protokoll: Autonomie-Status")
    sub = parser.add_subparsers(dest="command")

    sub.add_parser("status", help="Aktuelle Levels anzeigen")

    p_check = sub.add_parser("check", help="Braucht Operation Freigabe?")
    p_check.add_argument("component")
    p_check.add_argument("operation", choices=["read", "write", "deploy", "config", "new"])

    p_record = sub.add_parser("record", help="Session-Ergebnis eintragen")
    p_record.add_argument("component")
    p_record.add_argument("--error", action="store_true", help="Session hatte Fehler")
    p_record.add_argument("--critical", action="store_true", help="Kritischer Fehler (Reset auf 0)")

    sub.add_parser("suggest-promotions", help="Promotion-Vorschlaege")

    args = parser.parse_args()

    if args.command == "record" and getattr(args, "critical", False) and not args.error:
        parser.error("--critical erfordert --error")

    if not args.command:
        parser.print_help()
        sys.exit(1)

    data = load_autonomy()

    if args.command == "status":
        cmd_status(data)
    elif args.command == "check":
        cmd_check(data, args.component, args.operation)
    elif args.command == "record":
        cmd_record(data, args.component, args.error, args.critical)
    elif args.command == "suggest-promotions":
        cmd_suggest_promotions(data)


if __name__ == "__main__":
    main()
