import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CalDavSource } from "../clients/caldav.js";
import {
  resolveAgentId,
  getCalendarSources,
  hasWriteAccess,
} from "../lib/pim-access.js";
import type { CalendarEvent, ResolvedSource } from "../lib/types.js";

const log = (msg: string) => process.stderr.write(`[calendar] ${msg}\n`);

/** Shared map of lazily-created CalDavSource instances. */
const sourcePool = new Map<string, CalDavSource>();

function getOrCreateSource(rs: ResolvedSource): CalDavSource {
  let src = sourcePool.get(rs.id);
  if (!src) {
    src = new CalDavSource(rs);
    sourcePool.set(rs.id, src);
  }
  return src;
}

function formatEventList(events: CalendarEvent[]): string {
  if (events.length === 0) return "Keine Termine gefunden.";

  const sorted = [...events].sort((a, b) => a.start.localeCompare(b.start));
  const lines: string[] = [];
  let lastDate = "";

  for (const ev of sorted) {
    const dateKey = ev.allDay ? ev.start : ev.start.split(",")[0] ?? ev.start.slice(0, 10);
    if (dateKey !== lastDate) {
      if (lines.length > 0) lines.push("");
      lines.push(`📅 ${dateKey}`);
      lastDate = dateKey;
    }

    const time = ev.allDay ? "Ganztägig" : ev.start.split(", ")[1] ?? ev.start;
    const loc = ev.location ? ` 📍 ${ev.location}` : "";
    lines.push(`  [${ev.sourceId}/${ev.calendarName}] ${time} — ${ev.title}${loc} (UID: ${ev.uid})`);
  }

  return lines.join("\n");
}

function textResult(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], isError };
}

const agentIdParam = z
  .enum(["benni", "domi", "household"])
  .optional()
  .describe("Agent-ID (wird automatisch erkannt, falls vom Gateway übergeben)");

export function registerCalendar(server: McpServer): void {
  // ── calendar_events ──────────────────────────────────────────────
  server.registerTool(
    "calendar_events",
    {
      title: "Kalender: Termine abrufen",
      description:
        "Listet Termine aus allen zugänglichen Kalendern für einen Zeitraum auf. " +
        "Ergebnisse sind nach Datum/Uhrzeit sortiert und zeigen die Quelle.",
      inputSchema: {
        agent_id: agentIdParam,
        start_date: z.string().describe("Startdatum (ISO 8601, z.B. 2026-04-01)"),
        end_date: z.string().describe("Enddatum (ISO 8601, z.B. 2026-04-07)"),
        calendar_name: z
          .string()
          .optional()
          .describe("Optional: nur diesen Kalender abfragen (Teilname genügt)"),
      },
    },
    async ({ agent_id, start_date, end_date, calendar_name }, extra) => {
      try {
        const agentId = resolveAgentId(agent_id, extra as { _meta?: Record<string, unknown> });
        const sources = getCalendarSources(agentId);
        if (sources.length === 0) return textResult("Keine Kalenderquellen konfiguriert.", true);

        const results = await Promise.allSettled(
          sources.map((rs) => getOrCreateSource(rs).fetchEvents(start_date, end_date))
        );

        const events: CalendarEvent[] = [];
        const errors: string[] = [];

        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          if (r.status === "fulfilled") {
            events.push(...r.value);
          } else {
            errors.push(`${sources[i].config.label}: ${r.reason}`);
          }
        }

        // Filter by calendar name if provided
        const filtered = calendar_name
          ? events.filter((e) => e.calendarName.toLowerCase().includes(calendar_name.toLowerCase()))
          : events;

        let text = formatEventList(filtered);
        if (errors.length > 0) text += `\n\n⚠️ Fehler: ${errors.join("; ")}`;
        return textResult(text);
      } catch (err) {
        return textResult(`Error: ${err instanceof Error ? err.message : String(err)}`, true);
      }
    }
  );

  // ── calendar_search ──────────────────────────────────────────────
  server.registerTool(
    "calendar_search",
    {
      title: "Kalender: Termine suchen",
      description:
        "Durchsucht Kalendereinträge nach Freitext (Titel, Beschreibung, Ort). " +
        "Sucht standardmäßig ±1 Jahr ab heute.",
      inputSchema: {
        agent_id: agentIdParam,
        query: z.string().describe("Suchbegriff"),
        start_date: z.string().optional().describe("Startdatum (ISO 8601)"),
        end_date: z.string().optional().describe("Enddatum (ISO 8601)"),
      },
    },
    async ({ agent_id, query, start_date, end_date }, extra) => {
      try {
        const agentId = resolveAgentId(agent_id, extra as { _meta?: Record<string, unknown> });
        const sources = getCalendarSources(agentId);
        if (sources.length === 0) return textResult("Keine Kalenderquellen konfiguriert.", true);

        const results = await Promise.allSettled(
          sources.map((rs) => getOrCreateSource(rs).searchEvents(query, start_date, end_date))
        );

        const events: CalendarEvent[] = [];
        const errors: string[] = [];

        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          if (r.status === "fulfilled") events.push(...r.value);
          else errors.push(`${sources[i].config.label}: ${r.reason}`);
        }

        let text = events.length > 0
          ? `🔍 ${events.length} Treffer für "${query}":\n\n${formatEventList(events)}`
          : `Keine Treffer für "${query}".`;
        if (errors.length > 0) text += `\n\n⚠️ Fehler: ${errors.join("; ")}`;
        return textResult(text);
      } catch (err) {
        return textResult(`Error: ${err instanceof Error ? err.message : String(err)}`, true);
      }
    }
  );

  // ── calendar_create ──────────────────────────────────────────────
  server.registerTool(
    "calendar_create",
    {
      title: "Kalender: Termin erstellen",
      description:
        "Erstellt einen neuen Termin. Benötigt Schreibzugriff auf die Kalenderquelle.",
      inputSchema: {
        agent_id: agentIdParam,
        source_name: z
          .string()
          .describe("Quell-ID aus dem Suchergebnis (z.B. 'benni-hetzner', 'domi-icloud')"),
        calendar_name: z
          .string()
          .optional()
          .describe("Kalendername innerhalb der Quelle (optional, sonst Standard-Kalender)"),
        title: z.string().describe("Titel des Termins"),
        start: z.string().describe("Startzeit (ISO 8601, z.B. 2026-04-01T10:00:00)"),
        end: z.string().describe("Endzeit (ISO 8601, z.B. 2026-04-01T11:00:00)"),
        location: z.string().optional().describe("Ort"),
        description: z.string().optional().describe("Beschreibung"),
        all_day: z.boolean().optional().default(false).describe("Ganztägiger Termin?"),
      },
    },
    async ({ agent_id, source_name, calendar_name, title, start, end, location, description, all_day }, extra) => {
      try {
        const agentId = resolveAgentId(agent_id, extra as { _meta?: Record<string, unknown> });

        if (!hasWriteAccess(agentId, source_name, "calendars")) {
          return textResult(`Kein Schreibzugriff auf "${source_name}" für Agent "${agentId}".`, true);
        }

        const sources = getCalendarSources(agentId);
        const rs = sources.find((s) => s.id === source_name);
        if (!rs) return textResult(`Quelle "${source_name}" nicht verfügbar.`, true);

        const src = getOrCreateSource(rs);
        const ev = await src.createEvent(calendar_name, title, start, end, {
          location,
          description,
          allDay: all_day,
        });

        return textResult(
          `✅ Termin erstellt:\n` +
          `  ${ev.title}\n` +
          `  ${ev.allDay ? ev.start : `${ev.start} – ${ev.end}`}\n` +
          (ev.location ? `  📍 ${ev.location}\n` : "") +
          `  [${ev.sourceLabel}/${ev.calendarName}]`
        );
      } catch (err) {
        return textResult(`Error: ${err instanceof Error ? err.message : String(err)}`, true);
      }
    }
  );

  // ── calendar_update ──────────────────────────────────────────────
  server.registerTool(
    "calendar_update",
    {
      title: "Kalender: Termin ändern",
      description:
        "Ändert einen bestehenden Termin anhand seiner UID. Benötigt Schreibzugriff.",
      inputSchema: {
        agent_id: agentIdParam,
        source_name: z.string().describe("Quell-ID aus dem Suchergebnis (z.B. 'benni-hetzner', 'domi-icloud')"),
        event_uid: z.string().describe("UID des Termins"),
        calendar_name: z.string().optional().describe("Kalendername (zur Eingrenzung)"),
        title: z.string().optional().describe("Neuer Titel"),
        start: z.string().optional().describe("Neue Startzeit (ISO 8601)"),
        end: z.string().optional().describe("Neue Endzeit (ISO 8601)"),
        location: z.string().optional().describe("Neuer Ort"),
        description: z.string().optional().describe("Neue Beschreibung"),
      },
    },
    async ({ agent_id, source_name, event_uid, calendar_name, title, start, end, location, description }, extra) => {
      try {
        const agentId = resolveAgentId(agent_id, extra as { _meta?: Record<string, unknown> });

        if (!hasWriteAccess(agentId, source_name, "calendars")) {
          return textResult(`Kein Schreibzugriff auf "${source_name}" für Agent "${agentId}".`, true);
        }

        const sources = getCalendarSources(agentId);
        const rs = sources.find((s) => s.id === source_name);
        if (!rs) return textResult(`Quelle "${source_name}" nicht verfügbar.`, true);

        const src = getOrCreateSource(rs);
        const ev = await src.updateEvent(event_uid, calendar_name, {
          title,
          start,
          end,
          location,
          description,
        });

        return textResult(
          `✅ Termin aktualisiert:\n` +
          `  ${ev.title}\n` +
          `  ${ev.start} – ${ev.end}\n` +
          `  [${ev.sourceLabel}/${ev.calendarName}]`
        );
      } catch (err) {
        return textResult(`Error: ${err instanceof Error ? err.message : String(err)}`, true);
      }
    }
  );

  // ── calendar_delete ──────────────────────────────────────────────
  server.registerTool(
    "calendar_delete",
    {
      title: "Kalender: Termin löschen",
      description:
        "Löscht einen Termin anhand seiner UID. Benötigt Schreibzugriff.",
      inputSchema: {
        agent_id: agentIdParam,
        source_name: z.string().describe("Quell-ID aus dem Suchergebnis (z.B. 'benni-hetzner', 'domi-icloud')"),
        event_uid: z.string().describe("UID des Termins"),
        calendar_name: z.string().optional().describe("Kalendername (zur Eingrenzung)"),
      },
    },
    async ({ agent_id, source_name, event_uid, calendar_name }, extra) => {
      try {
        const agentId = resolveAgentId(agent_id, extra as { _meta?: Record<string, unknown> });

        if (!hasWriteAccess(agentId, source_name, "calendars")) {
          return textResult(`Kein Schreibzugriff auf "${source_name}" für Agent "${agentId}".`, true);
        }

        const sources = getCalendarSources(agentId);
        const rs = sources.find((s) => s.id === source_name);
        if (!rs) return textResult(`Quelle "${source_name}" nicht verfügbar.`, true);

        const src = getOrCreateSource(rs);
        await src.deleteEvent(event_uid, calendar_name);

        return textResult(`✅ Termin gelöscht (UID: ${event_uid}).`);
      } catch (err) {
        return textResult(`Error: ${err instanceof Error ? err.message : String(err)}`, true);
      }
    }
  );

  log("5 calendar tools registered");
}
