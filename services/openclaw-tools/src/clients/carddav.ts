import { DAVClient, type DAVAddressBook, type DAVVCard } from "tsdav";
import type { ResolvedSource, Contact, BirthdayEntry } from "../lib/types.js";

const log = (msg: string) => process.stderr.write(`[carddav] ${msg}\n`);

/** Extract a field value from a vCard line. */
function vcardField(data: string, field: string): string | undefined {
  const unfolded = data.replace(/\r?\n[ \t]/g, "");
  const re = new RegExp(`^${field}[;:](.*)$`, "im");
  const m = unfolded.match(re);
  if (!m) return undefined;
  const raw = m[1];
  // If the matched line has params (e.g. TEL;TYPE=CELL:+49...) extract the value after last ':'
  const colonIdx = raw.lastIndexOf(":");
  return colonIdx >= 0 ? raw.slice(colonIdx + 1).trim() : raw.trim();
}

/** Extract all values for a field (e.g. multiple TEL or EMAIL lines). */
function vcardFieldAll(data: string, field: string): string[] {
  const unfolded = data.replace(/\r?\n[ \t]/g, "");
  const re = new RegExp(`^${field}[;:](.*)$`, "gim");
  const results: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(unfolded)) !== null) {
    const raw = m[1];
    const colonIdx = raw.lastIndexOf(":");
    const val = colonIdx >= 0 ? raw.slice(colonIdx + 1).trim() : raw.trim();
    if (val) results.push(val);
  }
  return results;
}

/** Parse FN (formatted name) or build from N field. */
function parseName(data: string): string {
  const fn = vcardField(data, "FN");
  if (fn) return fn;
  const n = vcardField(data, "N");
  if (!n) return "(Unbekannt)";
  // N format: Last;First;Middle;Prefix;Suffix
  const parts = n.split(";").map((p) => p.trim()).filter(Boolean);
  return parts.length >= 2 ? `${parts[1]} ${parts[0]}` : parts.join(" ");
}

/** Parse BDAY field — handles various formats. */
function parseBirthday(data: string): { date: string; hasYear: boolean } | null {
  const bday = vcardField(data, "BDAY");
  if (!bday) return null;

  const clean = bday.replace(/[^0-9-]/g, "");

  // --MMDD (no year)
  if (clean.startsWith("--") && clean.length >= 6) {
    const mm = clean.slice(2, 4);
    const dd = clean.slice(4, 6);
    return { date: `--${mm}-${dd}`, hasYear: false };
  }

  // YYYYMMDD
  if (clean.length === 8 && !clean.includes("-")) {
    return {
      date: `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`,
      hasYear: true,
    };
  }

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    return { date: clean, hasYear: true };
  }

  return null;
}

/** Parse ADR field — format: PO;Ext;Street;City;Region;Postal;Country */
function parseAddress(data: string): string | undefined {
  const adr = vcardField(data, "ADR");
  if (!adr) return undefined;
  const parts = adr.split(";").map((p) => p.trim()).filter(Boolean);
  return parts.join(", ") || undefined;
}

/** Format an address string into vCard ADR field: ;;Street;City;;Postal;Country */
function formatAdr(address: string): string {
  // Try to parse "Street, Postal City" or "Street, Postal City, Country"
  const parts = address.split(",").map((p) => p.trim());
  if (parts.length >= 2) {
    const street = parts[0];
    // Try to split "71063 Sindelfingen" into postal + city
    const cityPart = parts[1];
    const postalMatch = cityPart.match(/^(\d{4,5})\s+(.+)$/);
    const postal = postalMatch ? postalMatch[1] : "";
    const city = postalMatch ? postalMatch[2] : cityPart;
    const country = parts[2] ?? "";
    return `;;${street};${city};;${postal};${country}`;
  }
  // Fallback: put everything in street
  return `;;${address};;;;`;
}

function parseContact(
  obj: DAVVCard,
  sourceLabel: string,
  sourceId: string
): Contact | null {
  const data = typeof obj.data === "string" ? obj.data : "";
  if (!data.includes("VCARD")) return null;

  const uid = vcardField(data, "UID") ?? obj.url;
  const fullName = parseName(data);
  const emails = vcardFieldAll(data, "EMAIL");
  const phones = vcardFieldAll(data, "TEL");
  const org = vcardField(data, "ORG")?.replace(/;/g, ", ").replace(/, $/, "");
  const adr = parseAddress(data);
  const bday = parseBirthday(data);

  return {
    uid,
    fullName,
    emails,
    phones,
    organization: org,
    address: adr,
    birthday: bday?.date,
    sourceLabel,
    sourceId,
    url: obj.url,
    etag: obj.etag ?? undefined,
  };
}

export class CardDavSource {
  private client: DAVClient | null = null;
  private addressBooksCache: DAVAddressBook[] | null = null;
  private addressBooksCacheTime = 0;
  private readonly CACHE_TTL = 60_000;

  constructor(private readonly source: ResolvedSource) {}

  get id(): string {
    return this.source.id;
  }
  get label(): string {
    return this.source.config.label;
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
      defaultAccountType: "carddav",
    });
    await this.client.login();
    log(`Connected to ${this.source.id}`);
    return this.client;
  }

  async fetchAddressBooks(): Promise<DAVAddressBook[]> {
    const now = Date.now();
    if (this.addressBooksCache && now - this.addressBooksCacheTime < this.CACHE_TTL) {
      return this.addressBooksCache;
    }
    const client = await this.connect();
    this.addressBooksCache = await client.fetchAddressBooks();
    this.addressBooksCacheTime = now;
    log(`${this.source.id}: ${this.addressBooksCache.length} address books`);
    return this.addressBooksCache;
  }

  async fetchContacts(query?: string): Promise<Contact[]> {
    const books = await this.fetchAddressBooks();
    const client = await this.connect();
    const contacts: Contact[] = [];

    for (const book of books) {
      try {
        const vCards = await client.fetchVCards({ addressBook: book });
        for (const vc of vCards) {
          const c = parseContact(vc, this.label, this.source.id);
          if (!c) continue;
          if (query) {
            const q = query.toLowerCase();
            const match =
              c.fullName.toLowerCase().includes(q) ||
              c.emails.some((e) => e.toLowerCase().includes(q)) ||
              c.phones.some((p) => p.includes(q)) ||
              (c.organization?.toLowerCase().includes(q) ?? false);
            if (!match) continue;
          }
          contacts.push(c);
        }
      } catch (err) {
        log(`Error fetching contacts from ${book.displayName ?? book.url}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return contacts;
  }

  async fetchBirthdays(): Promise<BirthdayEntry[]> {
    const contacts = await this.fetchContacts();
    const entries: BirthdayEntry[] = [];

    for (const c of contacts) {
      if (!c.birthday) continue;
      const parsed = c.birthday;
      const hasYear = !parsed.startsWith("--");
      let age: number | undefined;

      if (hasYear) {
        const birthYear = parseInt(parsed.slice(0, 4), 10);
        const now = new Date();
        age = now.getFullYear() - birthYear;
        // Adjust if birthday hasn't happened yet this year
        const thisYearBday = new Date(`${now.getFullYear()}-${parsed.slice(5)}`);
        if (now < thisYearBday) age--;
      }

      entries.push({
        name: c.fullName,
        date: parsed,
        hasYear,
        age,
        sourceLabel: this.label,
      });
    }
    return entries;
  }

  async createContact(
    name: string,
    opts: { email?: string; phone?: string; organization?: string; address?: string; birthday?: string }
  ): Promise<Contact> {
    const books = await this.fetchAddressBooks();
    if (books.length === 0) throw new Error(`Kein Adressbuch in ${this.label} gefunden`);

    const uid = `openclaw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const nameParts = name.split(" ");
    const lastName = nameParts.length > 1 ? nameParts.pop()! : "";
    const firstName = nameParts.join(" ");

    const lines = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      `UID:${uid}`,
      `FN:${name}`,
      `N:${lastName};${firstName};;;`,
    ];
    if (opts.email) lines.push(`EMAIL;TYPE=INTERNET:${opts.email}`);
    if (opts.phone) lines.push(`TEL;TYPE=CELL:${opts.phone}`);
    if (opts.organization) lines.push(`ORG:${opts.organization}`);
    if (opts.address) lines.push(`ADR;TYPE=HOME:${formatAdr(opts.address)}`);
    if (opts.birthday) lines.push(`BDAY:${opts.birthday.replace(/-/g, "")}`);
    lines.push("END:VCARD");

    const vCardString = lines.join("\r\n") + "\r\n";
    const client = await this.connect();
    await client.createVCard({
      addressBook: books[0],
      vCardString,
      filename: `${uid}.vcf`,
    });

    this.addressBooksCache = null;

    return {
      uid,
      fullName: name,
      emails: opts.email ? [opts.email] : [],
      phones: opts.phone ? [opts.phone] : [],
      organization: opts.organization,
      address: opts.address,
      birthday: opts.birthday,
      sourceLabel: this.label,
      sourceId: this.source.id,
    };
  }

  async updateContact(
    contactUid: string,
    changes: { name?: string; email?: string; phone?: string; organization?: string; address?: string; birthday?: string }
  ): Promise<Contact> {
    const books = await this.fetchAddressBooks();
    const client = await this.connect();

    for (const book of books) {
      const vCards = await client.fetchVCards({ addressBook: book });
      const vc = vCards.find((v) => {
        const data = typeof v.data === "string" ? v.data : "";
        return (vcardField(data, "UID") ?? v.url) === contactUid;
      });
      if (!vc || typeof vc.data !== "string") continue;

      let data = vc.data;
      if (changes.name) {
        data = data.replace(/^FN:.*$/m, `FN:${changes.name}`);
        const parts = changes.name.split(" ");
        const last = parts.length > 1 ? parts.pop()! : "";
        const first = parts.join(" ");
        data = data.replace(/^N:.*$/m, `N:${last};${first};;;`);
      }
      if (changes.email !== undefined) {
        if (/^EMAIL/m.test(data)) {
          data = data.replace(/^EMAIL[;:].*$/m, `EMAIL;TYPE=INTERNET:${changes.email}`);
        } else {
          data = data.replace("END:VCARD", `EMAIL;TYPE=INTERNET:${changes.email}\r\nEND:VCARD`);
        }
      }
      if (changes.phone !== undefined) {
        if (/^TEL/m.test(data)) {
          data = data.replace(/^TEL[;:].*$/m, `TEL;TYPE=CELL:${changes.phone}`);
        } else {
          data = data.replace("END:VCARD", `TEL;TYPE=CELL:${changes.phone}\r\nEND:VCARD`);
        }
      }
      if (changes.organization !== undefined) {
        if (/^ORG/m.test(data)) {
          data = data.replace(/^ORG:.*$/m, `ORG:${changes.organization}`);
        } else {
          data = data.replace("END:VCARD", `ORG:${changes.organization}\r\nEND:VCARD`);
        }
      }
      if (changes.address !== undefined) {
        const adrVal = formatAdr(changes.address);
        if (/^ADR/m.test(data)) {
          data = data.replace(/^ADR[;:].*$/m, `ADR;TYPE=HOME:${adrVal}`);
        } else {
          data = data.replace("END:VCARD", `ADR;TYPE=HOME:${adrVal}\r\nEND:VCARD`);
        }
      }
      if (changes.birthday !== undefined) {
        const bdayVal = changes.birthday.replace(/-/g, "");
        if (/^BDAY/m.test(data)) {
          data = data.replace(/^BDAY[;:].*$/m, `BDAY:${bdayVal}`);
        } else {
          data = data.replace("END:VCARD", `BDAY:${bdayVal}\r\nEND:VCARD`);
        }
      }

      await client.updateVCard({ vCard: { ...vc, data } });
      this.addressBooksCache = null;

      const updated = parseContact({ ...vc, data }, this.label, this.source.id);
      if (updated) return updated;
      throw new Error("Contact updated but could not re-parse");
    }

    throw new Error(`Kontakt mit UID "${contactUid}" nicht gefunden in ${this.label}`);
  }
}
