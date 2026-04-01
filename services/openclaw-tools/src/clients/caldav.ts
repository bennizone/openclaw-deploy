import { DAVClient, type DAVCalendar, type DAVCalendarObject } from "tsdav";
import type { ResolvedSource, CalendarEvent } from "../lib/types.js";

const log = (msg: string) => process.stderr.write(`[caldav] ${msg}\n`);

const TZ = "Europe/Berlin";

/** Format a Date in Europe/Berlin as "YYYY-MM-DD HH:MM" */
function fmtLocal(d: Date): string {
  return d.toLocaleString("de-DE", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Minimal iCal field extractor — works without a full parser. */
function icalField(data: string, field: string): string | undefined {
  // Handle folded lines (RFC 5545: lines can be continued with CRLF + space/tab)
  const unfolded = data.replace(/\r?\n[ \t]/g, "");
  const re = new RegExp(`^${field}[;:](.*)$`, "m");
  const m = unfolded.match(re);
  if (!m) return undefined;
  // strip params from value (e.g. DTSTART;TZID=Europe/Berlin:20260401T100000 → 20260401T100000)
  const raw = m[1];
  const colonIdx = raw.indexOf(":");
  // If the regex already matched after ':', the value is the whole match.
  // But we matched field;... or field:..., so we need to check for params.
  if (field === m[0].split(/[;:]/)[0] && raw.includes(":")) {
    return raw.slice(colonIdx + 1).trim();
  }
  return raw.trim();
}

/** Parse an iCal datetime value (basic or extended) into a Date. */
function parseICalDate(value: string): Date {
  // Formats: 20260401T100000Z, 20260401T100000, 20260401
  const clean = value.replace(/[^0-9TZ]/g, "");
  if (clean.length === 8) {
    // All-day: YYYYMMDD
    return new Date(`${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}T00:00:00`);
  }
  const iso = `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}T${clean.slice(9, 11)}:${clean.slice(11, 13)}:${clean.slice(13, 15)}`;
  return clean.endsWith("Z") ? new Date(iso + "Z") : new Date(iso);
}

function isAllDay(data: string): boolean {
  const unfolded = data.replace(/\r?\n[ \t]/g, "");
  return /^DTSTART;VALUE=DATE:/m.test(unfolded) || (/^DTSTART:/m.test(unfolded) && (icalField(data, "DTSTART") ?? "").length === 8);
}

function extractUid(data: string): string {
  return icalField(data, "UID") ?? "unknown";
}

function parseEvent(
  obj: DAVCalendarObject,
  sourceLabel: string,
  sourceId: string,
  calendarName: string
): CalendarEvent | null {
  const data = typeof obj.data === "string" ? obj.data : "";
  if (!data.includes("VEVENT")) return null;

  const dtStart = icalField(data, "DTSTART");
  const dtEnd = icalField(data, "DTEND");
  if (!dtStart) return null;

  const start = parseICalDate(dtStart);
  const end = dtEnd ? parseICalDate(dtEnd) : start;
  const allDay = isAllDay(data);

  return {
    uid: extractUid(data),
    title: icalField(data, "SUMMARY") ?? "(Kein Titel)",
    start: allDay ? dtStart.slice(0, 8).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3") : fmtLocal(start),
    end: allDay ? (dtEnd ?? dtStart).slice(0, 8).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3") : fmtLocal(end),
    allDay,
    location: icalField(data, "LOCATION"),
    description: icalField(data, "DESCRIPTION"),
    sourceLabel,
    sourceId,
    calendarName,
    url: obj.url,
    etag: obj.etag ?? undefined,
  };
}

/** Holds a lazily-initialized tsdav client for one CalDAV source. */
export class CalDavSource {
  private client: DAVClient | null = null;
  private calendarsCache: DAVCalendar[] | null = null;
  private calendarsCacheTime = 0;
  private readonly CACHE_TTL = 60_000; // 60s

  constructor(private readonly source: ResolvedSource) {}

  get id(): string {
    return this.source.id;
  }
  get label(): string {
    return this.source.config.label;
  }
  get calendarFilter(): string[] | undefined {
    return this.source.config.calendarFilter;
  }

  private async connect(): Promise<DAVClient> {
    if (this.client) return this.client;
    log(`Connecting to ${this.source.config.serverUrl} as ${this.source.username}`);
    this.client = new DAVClient({
      serverUrl: this.source.config.serverUrl,
      credentials: {
        username: this.source.username,
        password: this.source.password,
      },
      authMethod: "Basic",
      defaultAccountType: "caldav",
    });
    await this.client.login();
    log(`Connected to ${this.source.id}`);
    return this.client;
  }

  async fetchCalendars(): Promise<DAVCalendar[]> {
    const now = Date.now();
    if (this.calendarsCache && now - this.calendarsCacheTime < this.CACHE_TTL) {
      return this.calendarsCache;
    }
    const client = await this.connect();
    const all = await client.fetchCalendars();
    const filter = this.calendarFilter;
    const cals = filter
      ? all.filter((c) => {
          const name = typeof c.displayName === "string" ? c.displayName : "";
          return filter.some((f) => name.toLowerCase().includes(f.toLowerCase()));
        })
      : all;
    this.calendarsCache = cals;
    this.calendarsCacheTime = now;
    log(`${this.source.id}: ${cals.length}/${all.length} calendars`);
    return cals;
  }

  async fetchEvents(start: string, end: string): Promise<CalendarEvent[]> {
    const calendars = await this.fetchCalendars();
    const results: CalendarEvent[] = [];

    for (const cal of calendars) {
      const calName = typeof cal.displayName === "string" ? cal.displayName : this.label;
      try {
        const client = await this.connect();
        const objects = await client.fetchCalendarObjects({
          calendar: cal,
          timeRange: { start, end },
          expand: true,
        });
        for (const obj of objects) {
          const ev = parseEvent(obj, this.label, this.source.id, calName);
          if (ev) results.push(ev);
        }
      } catch (err) {
        log(`Error fetching events from ${calName}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return results;
  }

  async searchEvents(query: string, start?: string, end?: string): Promise<CalendarEvent[]> {
    // CalDAV doesn't support server-side text search well, so fetch range and filter client-side
    const s = start ?? new Date(Date.now() - 365 * 24 * 3600_000).toISOString();
    const e = end ?? new Date(Date.now() + 365 * 24 * 3600_000).toISOString();
    const events = await this.fetchEvents(s, e);
    const q = query.toLowerCase();
    return events.filter(
      (ev) =>
        ev.title.toLowerCase().includes(q) ||
        (ev.description?.toLowerCase().includes(q) ?? false) ||
        (ev.location?.toLowerCase().includes(q) ?? false)
    );
  }

  async createEvent(
    calendarName: string | undefined,
    title: string,
    start: string,
    end: string,
    opts: { location?: string; description?: string; allDay?: boolean }
  ): Promise<CalendarEvent> {
    const calendars = await this.fetchCalendars();
    const cal = calendarName
      ? calendars.find((c) => {
          const name = typeof c.displayName === "string" ? c.displayName : "";
          return name.toLowerCase().includes(calendarName.toLowerCase());
        })
      : calendars[0];

    if (!cal) throw new Error(`Kalender "${calendarName ?? "default"}" nicht gefunden in ${this.label}`);

    const uid = `openclaw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");

    let dtStart: string;
    let dtEnd: string;
    let dtProps: string;

    if (opts.allDay) {
      dtStart = start.replace(/-/g, "");
      dtEnd = end.replace(/-/g, "");
      dtProps = `DTSTART;VALUE=DATE:${dtStart}\r\nDTEND;VALUE=DATE:${dtEnd}`;
    } else {
      dtStart = new Date(start).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
      dtEnd = new Date(end).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
      dtProps = `DTSTART:${dtStart}\r\nDTEND:${dtEnd}`;
    }

    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//OpenClaw//Tool-Hub//DE",
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${now}`,
      dtProps,
      `SUMMARY:${title}`,
    ];
    if (opts.location) lines.push(`LOCATION:${opts.location}`);
    if (opts.description) lines.push(`DESCRIPTION:${opts.description}`);
    lines.push("END:VEVENT", "END:VCALENDAR");

    const iCalString = lines.join("\r\n") + "\r\n";
    const client = await this.connect();
    await client.createCalendarObject({
      calendar: cal,
      iCalString,
      filename: `${uid}.ics`,
    });

    this.calendarsCache = null; // invalidate

    const calName = typeof cal.displayName === "string" ? cal.displayName : this.label;
    return {
      uid,
      title,
      start: opts.allDay ? start : fmtLocal(new Date(start)),
      end: opts.allDay ? end : fmtLocal(new Date(end)),
      allDay: opts.allDay ?? false,
      location: opts.location,
      description: opts.description,
      sourceLabel: this.label,
      sourceId: this.source.id,
      calendarName: calName,
    };
  }

  async updateEvent(
    eventUid: string,
    calendarName: string | undefined,
    changes: { title?: string; start?: string; end?: string; location?: string; description?: string }
  ): Promise<CalendarEvent> {
    const calendars = await this.fetchCalendars();
    const client = await this.connect();

    for (const cal of calendars) {
      if (calendarName) {
        const name = typeof cal.displayName === "string" ? cal.displayName : "";
        if (!name.toLowerCase().includes(calendarName.toLowerCase())) continue;
      }
      const objects = await client.fetchCalendarObjects({ calendar: cal });
      const obj = objects.find((o) => {
        const data = typeof o.data === "string" ? o.data : "";
        return extractUid(data) === eventUid;
      });

      if (!obj || typeof obj.data !== "string") continue;

      let data = obj.data;
      if (changes.title) data = data.replace(/^SUMMARY:.*$/m, `SUMMARY:${changes.title}`);
      if (changes.location !== undefined) {
        if (data.includes("LOCATION:")) {
          data = data.replace(/^LOCATION:.*$/m, `LOCATION:${changes.location}`);
        } else {
          data = data.replace("END:VEVENT", `LOCATION:${changes.location}\r\nEND:VEVENT`);
        }
      }
      if (changes.description !== undefined) {
        if (data.includes("DESCRIPTION:")) {
          data = data.replace(/^DESCRIPTION:.*$/m, `DESCRIPTION:${changes.description}`);
        } else {
          data = data.replace("END:VEVENT", `DESCRIPTION:${changes.description}\r\nEND:VEVENT`);
        }
      }
      // TODO: start/end changes require more complex DTSTART/DTEND handling

      await client.updateCalendarObject({ calendarObject: { ...obj, data } });
      this.calendarsCache = null;

      const calName = typeof cal.displayName === "string" ? cal.displayName : this.label;
      const ev = parseEvent({ ...obj, data }, this.label, this.source.id, calName);
      if (ev) return ev;
      throw new Error("Event updated but could not re-parse");
    }

    throw new Error(`Event mit UID "${eventUid}" nicht gefunden in ${this.label}`);
  }

  async deleteEvent(eventUid: string, calendarName: string | undefined): Promise<void> {
    const calendars = await this.fetchCalendars();
    const client = await this.connect();

    for (const cal of calendars) {
      if (calendarName) {
        const name = typeof cal.displayName === "string" ? cal.displayName : "";
        if (!name.toLowerCase().includes(calendarName.toLowerCase())) continue;
      }
      const objects = await client.fetchCalendarObjects({ calendar: cal });
      const obj = objects.find((o) => {
        const data = typeof o.data === "string" ? o.data : "";
        return extractUid(data) === eventUid;
      });

      if (!obj) continue;

      await client.deleteCalendarObject({ calendarObject: obj });
      this.calendarsCache = null;
      return;
    }

    throw new Error(`Event mit UID "${eventUid}" nicht gefunden in ${this.label}`);
  }
}
