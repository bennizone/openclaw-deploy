import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  resolveAgentId,
  getContactSources,
  getCalendarSources,
  hasWriteAccess,
  getOrCreateCardDavSource,
  getOrCreateCalDavSource,
} from "../lib/pim-access.js";
import type { Contact, BirthdayEntry } from "../lib/types.js";

const log = (msg: string) => process.stderr.write(`[contacts] ${msg}\n`);

function formatContactList(contacts: Contact[]): string {
  if (contacts.length === 0) return "Keine Kontakte gefunden.";

  return contacts
    .map((c) => {
      const parts = [`👤 ${c.fullName}`];
      parts.push(`  UID: ${c.uid}`);
      parts.push(`  Source: ${c.sourceId}`);
      if (c.emails.length > 0) parts.push(`  📧 ${c.emails.join(", ")}`);
      if (c.phones.length > 0) parts.push(`  📞 ${c.phones.join(", ")}`);
      if (c.organization) parts.push(`  🏢 ${c.organization}`);
      if (c.address) parts.push(`  📍 ${c.address}`);
      if (c.birthday) parts.push(`  🎂 ${c.birthday}`);
      parts.push(`  [${c.sourceLabel}]`);
      return parts.join("\n");
    })
    .join("\n\n");
}

function textResult(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], isError };
}

const agentIdParam = z
  .enum(["benni", "domi", "household"])
  .optional()
  .describe("Agent-ID (wird automatisch erkannt, falls vom Gateway übergeben)");

/** Normalize a name for birthday deduplication. */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export function registerContacts(server: McpServer): void {
  // ── contacts_search ──────────────────────────────────────────────
  server.registerTool(
    "contacts_search",
    {
      title: "Kontakte: Suchen",
      description:
        "Durchsucht Kontakte nach Name, E-Mail, Telefonnummer oder Organisation.",
      inputSchema: {
        agent_id: agentIdParam,
        query: z.string().describe("Suchbegriff (Name, E-Mail, Telefon, Firma)"),
      },
    },
    async ({ agent_id, query }, extra) => {
      try {
        const agentId = resolveAgentId(agent_id, extra as { _meta?: Record<string, unknown> });
        const sources = getContactSources(agentId);
        if (sources.length === 0) return textResult("Keine Kontaktquellen konfiguriert.", true);

        const results = await Promise.allSettled(
          sources.map((rs) => getOrCreateCardDavSource(rs).fetchContacts(query))
        );

        const contacts: Contact[] = [];
        const errors: string[] = [];

        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          if (r.status === "fulfilled") contacts.push(...r.value);
          else errors.push(`${sources[i].config.label}: ${r.reason}`);
        }

        let text = contacts.length > 0
          ? `🔍 ${contacts.length} Kontakte für "${query}":\n\n${formatContactList(contacts)}`
          : `Keine Kontakte gefunden für "${query}".`;
        if (errors.length > 0) text += `\n\n⚠️ Fehler: ${errors.join("; ")}`;
        return textResult(text);
      } catch (err) {
        return textResult(`Error: ${err instanceof Error ? err.message : String(err)}`, true);
      }
    }
  );

  // ── contacts_create ──────────────────────────────────────────────
  server.registerTool(
    "contacts_create",
    {
      title: "Kontakte: Erstellen",
      description:
        "Erstellt einen neuen Kontakt. Benötigt Schreibzugriff auf die Kontaktquelle.",
      inputSchema: {
        agent_id: agentIdParam,
        source_name: z.string().describe("Quell-ID aus dem Suchergebnis (Source-Feld, z.B. 'benni-hetzner', 'domi-icloud')"),
        name: z.string().describe("Vollständiger Name"),
        email: z.string().optional().describe("E-Mail-Adresse"),
        phone: z.string().optional().describe("Telefonnummer"),
        organization: z.string().optional().describe("Firma / Organisation"),
        address: z.string().optional().describe("Adresse (z.B. 'Musterstr. 1, 12345 Berlin')"),
        birthday: z.string().optional().describe("Geburtstag (YYYY-MM-DD)"),
      },
    },
    async ({ agent_id, source_name, name, email, phone, organization, address, birthday }, extra) => {
      try {
        const agentId = resolveAgentId(agent_id, extra as { _meta?: Record<string, unknown> });

        if (!hasWriteAccess(agentId, source_name, "contacts")) {
          return textResult(`Kein Schreibzugriff auf "${source_name}" für Agent "${agentId}".`, true);
        }

        const sources = getContactSources(agentId);
        const rs = sources.find((s) => s.id === source_name);
        if (!rs) return textResult(`Quelle "${source_name}" nicht verfügbar.`, true);

        const src = getOrCreateCardDavSource(rs);
        const contact = await src.createContact(name, { email, phone, organization, address, birthday });

        return textResult(
          `✅ Kontakt erstellt:\n${formatContactList([contact])}`
        );
      } catch (err) {
        return textResult(`Error: ${err instanceof Error ? err.message : String(err)}`, true);
      }
    }
  );

  // ── contacts_update ──────────────────────────────────────────────
  server.registerTool(
    "contacts_update",
    {
      title: "Kontakte: Aktualisieren",
      description:
        "Aktualisiert einen bestehenden Kontakt anhand seiner UID. Benötigt Schreibzugriff.",
      inputSchema: {
        agent_id: agentIdParam,
        source_name: z.string().describe("Quell-ID aus dem Suchergebnis (z.B. 'benni-hetzner', 'domi-icloud')"),
        contact_uid: z.string().describe("UID des Kontakts (aus dem Suchergebnis)"),
        name: z.string().optional().describe("Neuer Name"),
        email: z.string().optional().describe("Neue E-Mail"),
        phone: z.string().optional().describe("Neue Telefonnummer"),
        organization: z.string().optional().describe("Neue Firma"),
        address: z.string().optional().describe("Neue Adresse (z.B. 'Musterstr. 1, 12345 Berlin')"),
        birthday: z.string().optional().describe("Neuer Geburtstag (YYYY-MM-DD)"),
      },
    },
    async ({ agent_id, source_name, contact_uid, name, email, phone, organization, address, birthday }, extra) => {
      try {
        const agentId = resolveAgentId(agent_id, extra as { _meta?: Record<string, unknown> });

        if (!hasWriteAccess(agentId, source_name, "contacts")) {
          return textResult(`Kein Schreibzugriff auf "${source_name}" für Agent "${agentId}".`, true);
        }

        const sources = getContactSources(agentId);
        const rs = sources.find((s) => s.id === source_name);
        if (!rs) return textResult(`Quelle "${source_name}" nicht verfügbar.`, true);

        const src = getOrCreateCardDavSource(rs);
        const contact = await src.updateContact(contact_uid, {
          name,
          email,
          phone,
          organization,
          address,
          birthday,
        });

        return textResult(
          `✅ Kontakt aktualisiert:\n${formatContactList([contact])}`
        );
      } catch (err) {
        return textResult(`Error: ${err instanceof Error ? err.message : String(err)}`, true);
      }
    }
  );

  // ── contacts_birthdays ───────────────────────────────────────────
  server.registerTool(
    "contacts_birthdays",
    {
      title: "Kontakte: Geburtstage",
      description:
        "Zeigt anstehende Geburtstage aus Kontakten. " +
        "Dedupliziert Einträge aus Kontakten und Kalender-Geburtstagen.",
      inputSchema: {
        agent_id: agentIdParam,
        days_ahead: z
          .number()
          .int()
          .min(1)
          .max(365)
          .optional()
          .default(30)
          .describe("Wie viele Tage vorausschauen (Standard: 30)"),
      },
    },
    async ({ agent_id, days_ahead }, extra) => {
      try {
        const agentId = resolveAgentId(agent_id, extra as { _meta?: Record<string, unknown> });

        // Collect birthdays from CardDAV contacts
        const contactSources = getContactSources(agentId);
        const contactResults = await Promise.allSettled(
          contactSources.map((rs) => getOrCreateCardDavSource(rs).fetchBirthdays())
        );

        const allBirthdays: BirthdayEntry[] = [];
        const errors: string[] = [];

        for (let i = 0; i < contactResults.length; i++) {
          const r = contactResults[i];
          if (r.status === "fulfilled") allBirthdays.push(...r.value);
          else errors.push(`${contactSources[i].config.label}: ${r.reason}`);
        }

        // Also check calendar sources for birthday calendars
        const calSources = getCalendarSources(agentId);
        const now = new Date();
        const futureDate = new Date(now.getTime() + days_ahead * 24 * 3600_000);

        for (const rs of calSources) {
          try {
            const src = getOrCreateCalDavSource(rs);
            const events = await src.fetchEvents(now.toISOString(), futureDate.toISOString());
            for (const ev of events) {
              if (
                ev.calendarName.toLowerCase().includes("geburtstag") ||
                ev.calendarName.toLowerCase().includes("birthday")
              ) {
                allBirthdays.push({
                  name: ev.title.replace(/\s*Geburtstag\s*/i, "").replace(/'s Birthday/i, "").trim() || ev.title,
                  date: ev.start,
                  hasYear: false,
                  sourceLabel: ev.sourceLabel,
                });
              }
            }
          } catch {
            // Calendar source errors are non-critical for birthday lookup
          }
        }

        // Deduplicate by normalized name
        const deduped = new Map<string, BirthdayEntry>();
        for (const b of allBirthdays) {
          const key = normalizeName(b.name);
          const existing = deduped.get(key);
          if (!existing || (b.hasYear && !existing.hasYear)) {
            deduped.set(key, b);
          }
        }

        // Filter to upcoming birthdays within days_ahead
        const today = new Date();
        const upcoming: (BirthdayEntry & { daysUntil: number })[] = [];

        for (const b of deduped.values()) {
          let monthDay: number;
          if (b.date.startsWith("--")) {
            // --MM-DD
            monthDay = parseInt(b.date.slice(2, 4), 10) * 100 + parseInt(b.date.slice(5, 7), 10);
          } else if (b.date.includes("-") && b.date.length >= 10) {
            monthDay = parseInt(b.date.slice(5, 7), 10) * 100 + parseInt(b.date.slice(8, 10), 10);
          } else {
            continue;
          }

          let daysUntil: number;
          const thisYear = today.getFullYear();
          const bdayThisYear = new Date(thisYear, Math.floor(monthDay / 100) - 1, monthDay % 100);
          if (bdayThisYear >= today) {
            daysUntil = Math.ceil((bdayThisYear.getTime() - today.getTime()) / (24 * 3600_000));
          } else {
            const bdayNextYear = new Date(thisYear + 1, Math.floor(monthDay / 100) - 1, monthDay % 100);
            daysUntil = Math.ceil((bdayNextYear.getTime() - today.getTime()) / (24 * 3600_000));
          }

          if (daysUntil <= days_ahead) {
            upcoming.push({ ...b, daysUntil });
          }
        }

        upcoming.sort((a, b) => a.daysUntil - b.daysUntil);

        if (upcoming.length === 0) {
          let text = `Keine Geburtstage in den nächsten ${days_ahead} Tagen.`;
          if (errors.length > 0) text += `\n\n⚠️ Fehler: ${errors.join("; ")}`;
          return textResult(text);
        }

        const lines = upcoming.map((b) => {
          const when = b.daysUntil === 0 ? "🎉 HEUTE!" : b.daysUntil === 1 ? "morgen" : `in ${b.daysUntil} Tagen`;
          const age = b.age !== undefined ? ` (wird ${b.age + 1})` : "";
          return `🎂 ${b.name}${age} — ${when} [${b.sourceLabel}]`;
        });

        let text = `Geburtstage (nächste ${days_ahead} Tage):\n\n${lines.join("\n")}`;
        if (errors.length > 0) text += `\n\n⚠️ Fehler: ${errors.join("; ")}`;
        return textResult(text);
      } catch (err) {
        return textResult(`Error: ${err instanceof Error ? err.message : String(err)}`, true);
      }
    }
  );

  log("4 contacts tools registered");
}
