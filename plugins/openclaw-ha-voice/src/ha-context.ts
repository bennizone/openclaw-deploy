import { HAVoiceConfig } from "./config";

/**
 * Load entities grouped by area from HA via template rendering.
 * Returns a compact text block suitable for LLM context injection.
 */
export async function loadEntityContext(config: HAVoiceConfig): Promise<string> {
  // Compact template: temp, humidity, lights, climate, window contacts
  // Skips: battery, voltage, zigbee, echo devices, indicators, empty rooms
  const template = [
    "{% set skip_areas = ['system'] %}",
    "{% for area_id in areas() %}",
    "{% if area_id not in skip_areas %}",
    "{% set ents = area_entities(area_id) %}",
    "{% set ns = namespace(lines=[]) %}",
    "{% for eid in ents %}",
    "{% set s = states[eid] %}",
    "{% if s is defined and s.state not in ['unavailable','unknown'] %}",
    "{% set d = eid.split('.')[0] %}",
    "{% set name = state_attr(eid, 'friendly_name') or eid %}",
    "{% set unit = s.attributes.unit_of_measurement | default('') %}",
    "{% if d == 'sensor' and unit == '°C' and 'chip' not in eid and 'zigbee' not in eid %}",
    "{% set ns.lines = ns.lines + [name ~ ': ' ~ s.state ~ ' Grad'] %}",
    "{% elif d == 'sensor' and 'luftfeuchtigkeit' in name | lower %}",
    "{% set ns.lines = ns.lines + [name ~ ': ' ~ s.state ~ ' Prozent'] %}",
    "{% elif d == 'light' %}",
    "{% set ns.lines = ns.lines + [name ~ ': ' ~ s.state] %}",
    "{% elif d == 'climate' %}",
    "{% set ns.lines = ns.lines + [name ~ ': ' ~ s.state] %}",
    "{% elif d == 'cover' %}",
    "{% set ns.lines = ns.lines + [name ~ ': ' ~ s.state] %}",
    "{% elif d == 'binary_sensor' and ('fenster' in eid or 'door' in eid or 'window' in eid) and 'batter' not in eid %}",
    "{% set ns.lines = ns.lines + [name ~ ': ' ~ ('offen' if s.state == 'on' else 'geschlossen')] %}",
    "{% endif %}",
    "{% endif %}",
    "{% endfor %}",
    "{% if ns.lines | length > 0 %}",
    "{{ area_name(area_id) }}: {{ ns.lines | join(', ') }}",
    "{% endif %}",
    "{% endif %}",
    "{% endfor %}",
  ].join("\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(`${config.url}/api/template`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ template }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HA template HTTP ${response.status}`);
    }

    const text = await response.text();
    return text.trim();
  } finally {
    clearTimeout(timer);
  }
}
