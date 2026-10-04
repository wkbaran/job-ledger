/**
 * Comparison keys for names and titles: lowercase, accents removed, `&` as
 * `and`, punctuation dropped, whitespace collapsed. "Łaszewo" and "Laszewo"
 * get the same key, as do "Ho Gosh & Macarite" and "Ho Gosh and Macarite".
 */
export function textKey(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[łŁ]/g, "l")
    .replace(/[øØ]/g, "o")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Cut text to `max` characters at a clause or word break, adding "…". */
export function clip(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const clause = Math.max(cut.lastIndexOf("; "), cut.lastIndexOf(", "), cut.lastIndexOf(". "), cut.lastIndexOf(" — "));
  const at = clause > max * 0.6 ? clause : cut.lastIndexOf(" ") > max * 0.6 ? cut.lastIndexOf(" ") : cut.length;
  return cut.slice(0, at).replace(/[\s,;:.—-]+$/, "") + "…";
}
