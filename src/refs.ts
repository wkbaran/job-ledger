/**
 * Refs are the short handles (`K3`, `W12`) a model uses to point at items the
 * server holds. The server hands them out and resolves them, so the model never
 * copies an id, a URL or a title from one tool call to the next.
 */

/** Give each item a ref: `prefix` plus a 1-based number, continuing from `start`. */
export function assignRefs<T>(prefix: string, items: readonly T[], start = 1): { ref: string; item: T }[] {
  if (!/^[A-Z]{1,3}$/.test(prefix)) throw new Error(`Ref prefix "${prefix}" must be 1–3 capital letters.`);
  return items.map((item, i) => ({ ref: `${prefix}${start + i}`, item }));
}

/**
 * Normalize what a model sent as a ref: trims, uppercases, and drops wrapping
 * brackets or quotes (`[k3]`, `"K3"`, `K3.`). Returns null if it doesn't look
 * like a ref at all.
 */
export function cleanRef(raw: unknown): string | null {
  const s = String(raw ?? "").trim().replace(/^[\["'`(]+|[\]"'`).,;:]+$/g, "").toUpperCase();
  return /^[A-Z]{1,3}\d{1,4}(?:\.\d{1,3})?$/.test(s) ? s : null;
}

export interface Resolved<T> {
  found: { ref: string; item: T }[];
  unknown: string[];
  duplicates: string[];
}

/** Look refs up in a map, keeping the order given and dropping repeats. */
export function resolveRefs<T>(raw: readonly unknown[], lookup: (ref: string) => T | undefined): Resolved<T> {
  const found: { ref: string; item: T }[] = [];
  const unknown: string[] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const ref = cleanRef(r);
    if (!ref) {
      unknown.push(String(r));
      continue;
    }
    if (seen.has(ref)) {
      duplicates.push(ref);
      continue;
    }
    seen.add(ref);
    const item = lookup(ref);
    if (item === undefined) unknown.push(ref);
    else found.push({ ref, item });
  }
  return { found, unknown, duplicates };
}
