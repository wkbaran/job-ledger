/** `2026-10-02T12:15:24Z`: ISO without milliseconds. */
export function isoSeconds(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** The later of two ISO times. Use it so a "last run" time never moves backwards. */
export function laterIso(a: string | undefined, b: string | undefined): string | undefined {
  const ta = a ? Date.parse(a) : NaN;
  const tb = b ? Date.parse(b) : NaN;
  if (Number.isNaN(ta)) return Number.isNaN(tb) ? (a ?? b) : b;
  if (Number.isNaN(tb)) return a;
  return tb > ta ? b : a;
}

/** The calendar date (`2026-10-02`) of `d` in an IANA time zone. */
export function localDate(d: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
