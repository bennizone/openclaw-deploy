#!/usr/bin/env python3
"""config-audit.py — Prueft OpenClaw-Config auf Integritaet und bekannte Probleme.

Nicht-destruktiv: Liest nur, aendert nichts.

Usage:
    python3 scripts/config-audit.py [--json]

Exit-Codes:
    0 = Alles OK (OK/INFO/WARN)
    2 = Fehler gefunden
"""

import json
import os
import re
import stat
import sys
from pathlib import Path

OPENCLAW_DIR = Path.home() / ".openclaw"
CONFIG_PATH = OPENCLAW_DIR / "openclaw.json"
ENV_PATH = OPENCLAW_DIR / ".env"
EXTENSIONS_DIR = OPENCLAW_DIR / "extensions"
EXTRACTOR_ENV = Path.home() / "extractor" / ".env"

# Keys die in .env erwartet werden
EXPECTED_ENV_KEYS = [
    "GATEWAY_AUTH_TOKEN",
]

# Bekannte Secret-Patterns in openclaw.json
SECRET_PATTERNS = [
    r"sk-[a-zA-Z0-9]{20,}",
    r"Bearer\s+[a-zA-Z0-9_-]{20,}",
    r"token.*[a-zA-Z0-9]{32,}",
]

# Kritische Config-Werte
REQUIRED_CONFIG = {
    "tools.profile": "full",
    "plugins.slots.memory": "none",
}


def load_config():
    """Laedt openclaw.json, gibt (config_dict, error) zurueck."""
    if not CONFIG_PATH.exists():
        return None, f"Config nicht gefunden: {CONFIG_PATH}"
    try:
        with open(CONFIG_PATH) as f:
            return json.load(f), None
    except json.JSONDecodeError as e:
        return None, f"Config ist kein valides JSON: {e}"


def get_nested(d, dotpath, default=None):
    """Holt verschachtelten Wert: 'a.b.c' -> d['a']['b']['c']."""
    keys = dotpath.split(".")
    for key in keys:
        if isinstance(d, dict) and key in d:
            d = d[key]
        else:
            return default
    return d


def check_config_valid(config, error):
    """Prueft ob Config geladen werden konnte."""
    if error:
        return [("FAIL", f"openclaw.json: {error}")]
    return [("OK", "openclaw.json ist valides JSON")]


def check_permissions():
    """Prueft Datei-Permissions."""
    results = []
    if not CONFIG_PATH.exists():
        return results

    mode = oct(CONFIG_PATH.stat().st_mode & 0o777)
    if mode == "0o444":
        results.append(("OK", f"openclaw.json Permissions: {mode}"))
    else:
        results.append(("WARN", f"openclaw.json Permissions: {mode} (sollte 0o444 sein)"))

    return results


def check_env_files():
    """Prueft ob .env Dateien existieren und erwartete Keys haben."""
    results = []

    if not ENV_PATH.exists():
        results.append(("FAIL", f"{ENV_PATH} existiert nicht"))
        return results

    results.append(("OK", f"{ENV_PATH} existiert"))

    env_content = ENV_PATH.read_text()
    for key in EXPECTED_ENV_KEYS:
        if re.search(rf"^{key}=", env_content, re.MULTILINE):
            results.append(("OK", f".env hat {key}"))
        else:
            results.append(("WARN", f".env fehlt {key}"))

    if EXTRACTOR_ENV.exists():
        results.append(("OK", f"{EXTRACTOR_ENV} existiert"))
    else:
        results.append(("WARN", f"{EXTRACTOR_ENV} fehlt"))

    return results


def check_critical_values(config):
    """Prueft kritische Config-Werte."""
    results = []
    if not config:
        return results

    for dotpath, expected in REQUIRED_CONFIG.items():
        actual = get_nested(config, dotpath)
        if actual == expected:
            results.append(("OK", f"{dotpath} = \"{actual}\""))
        elif actual is None:
            results.append(("WARN", f"{dotpath} nicht gesetzt (sollte \"{expected}\" sein)"))
        else:
            results.append(("FAIL", f"{dotpath} = \"{actual}\" (sollte \"{expected}\" sein)"))

    # userTimezone
    tz = get_nested(config, "agents.defaults.userTimezone")
    if tz:
        results.append(("OK", f"agents.defaults.userTimezone = \"{tz}\""))
    else:
        results.append(("FAIL", "agents.defaults.userTimezone nicht gesetzt (Agent kennt kein Datum!)"))

    return results


def check_plugins(config):
    """Prueft ob referenzierte Plugins existieren."""
    results = []
    if not config:
        return results

    # Eingebaute Channel-Plugins leben nicht in extensions/
    BUILTIN_PLUGINS = {"matrix", "whatsapp", "telegram", "signal", "discord"}

    # Plugins aus Config extrahieren
    plugins_allow = get_nested(config, "plugins.allow", [])
    if not plugins_allow:
        results.append(("INFO", "plugins.allow nicht gesetzt (alle Plugins erlaubt)"))
        return results

    for plugin_id in plugins_allow:
        if plugin_id in BUILTIN_PLUGINS:
            results.append(("OK", f"Plugin {plugin_id} (built-in Channel)"))
            continue
        plugin_dir = EXTENSIONS_DIR / plugin_id
        if plugin_dir.exists():
            results.append(("OK", f"Plugin {plugin_id} existiert"))
        else:
            results.append(("FAIL", f"Plugin {plugin_id} in plugins.allow aber nicht in {EXTENSIONS_DIR}"))

    return results


def check_no_secrets(config):
    """Prueft ob openclaw.json Klartext-Secrets enthaelt."""
    results = []
    if not config:
        return results

    config_str = json.dumps(config)

    # ENV-Substitution ist OK: ${VAR_NAME}
    # Klartext-Secrets sind nicht OK
    for pattern in SECRET_PATTERNS:
        matches = re.findall(pattern, config_str)
        # Filter: ${...} Substitutionen sind OK
        real_matches = [m for m in matches if "${" not in m]
        if real_matches:
            results.append(("FAIL", f"Moegliches Klartext-Secret gefunden (Pattern: {pattern})"))
            return results

    results.append(("OK", "Keine Klartext-Secrets in openclaw.json"))
    return results


def check_env_substitution(config):
    """Prueft ob alle ${VAR} Referenzen in .env definiert sind."""
    results = []
    if not config:
        return results

    config_str = json.dumps(config)
    var_refs = set(re.findall(r'\$\{([A-Z_][A-Z0-9_]*)\}', config_str))

    if not var_refs:
        results.append(("INFO", "Keine ENV-Substitutionen in Config"))
        return results

    env_content = ""
    if ENV_PATH.exists():
        env_content = ENV_PATH.read_text()

    for var in sorted(var_refs):
        if re.search(rf"^{var}=", env_content, re.MULTILINE):
            results.append(("OK", f"${{{var}}} definiert in .env"))
        else:
            results.append(("FAIL", f"${{{var}}} referenziert aber nicht in .env definiert"))

    return results


def main():
    json_output = "--json" in sys.argv

    config, error = load_config()

    all_results = []
    all_results.extend(check_config_valid(config, error))
    all_results.extend(check_permissions())
    all_results.extend(check_env_files())
    all_results.extend(check_critical_values(config))
    all_results.extend(check_plugins(config))
    all_results.extend(check_no_secrets(config))
    all_results.extend(check_env_substitution(config))

    if json_output:
        print(json.dumps([{"status": s, "message": m} for s, m in all_results], indent=2))
    else:
        print("Config-Audit Ergebnisse:")
        print("=" * 50)
        for status, message in all_results:
            icon = {"OK": "[OK]  ", "WARN": "[WARN]", "FAIL": "[FAIL]", "INFO": "[INFO]"}
            print(f"  {icon.get(status, '[??]  ')} {message}")

        # Zusammenfassung
        counts = {}
        for status, _ in all_results:
            counts[status] = counts.get(status, 0) + 1
        print()
        print(f"Zusammenfassung: {counts.get('OK', 0)} OK, "
              f"{counts.get('WARN', 0)} Warnungen, "
              f"{counts.get('FAIL', 0)} Fehler, "
              f"{counts.get('INFO', 0)} Info")

    # Exit-Code
    if any(s == "FAIL" for s, _ in all_results):
        sys.exit(2)
    else:
        sys.exit(0)


if __name__ == "__main__":
    main()
