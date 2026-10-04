import { mkdtemp, readdir, readFile, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { assignRefs, cleanRef, clip, insideDir, laterIso, localDate, readJson, resolveRefs, RunStore, textKey, updateJson, withLock } from "../src/index.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "job-ledger-"));
});

type Doc = { n: number; tags: string[] };
const validate = (v: unknown): Doc | null => {
  const d = v as Doc;
  return d && typeof d.n === "number" && Array.isArray(d.tags) ? d : null;
};
const opts = { validate, initial: (): Doc => ({ n: 0, tags: [] }) };

describe("updateJson", () => {
  it("creates a missing file pretty-printed, mode 0644", async () => {
    const r = await updateJson(dir, "doc.json", opts, (d) => ({ value: { ...d, n: d.n + 1 }, result: d.n + 1 }));
    expect(r).toEqual({ result: 1, changed: true, warnings: [] });
    expect(await readFile(join(dir, "doc.json"), "utf8")).toBe('{\n  "n": 1,\n  "tags": []\n}\n');
    expect((await stat(join(dir, "doc.json"))).mode & 0o777).toBe(0o644);
  });

  it("writes nothing, not even a backup, when nothing changed", async () => {
    await updateJson(dir, "doc.json", opts, (d) => ({ value: d, result: null }));
    const r = await updateJson(dir, "doc.json", opts, (d) => ({ value: d, result: null }));
    expect(r.changed).toBe(false);
    expect((await readdir(dir)).sort()).toEqual(["doc.json"]);
  });

  it("backs up the previous file and leaves no temp files", async () => {
    await updateJson(dir, "doc.json", opts, (d) => ({ value: { ...d, n: 1 }, result: null }));
    await updateJson(dir, "doc.json", opts, (d) => ({ value: { ...d, n: 2 }, result: null }));
    expect(JSON.parse(await readFile(join(dir, "doc.json.bak"), "utf8")).n).toBe(1);
    expect((await readdir(dir)).sort()).toEqual(["doc.json", "doc.json.bak"]);
  });

  it("moves a corrupt file aside and starts again", async () => {
    await writeFile(join(dir, "doc.json"), "{ nope");
    const r = await updateJson(dir, "doc.json", opts, (d) => ({ value: d, result: d.n }));
    expect(r.result).toBe(0);
    expect(r.warnings[0]).toMatch(/corrupt/);
    expect((await readdir(dir)).some((n) => n.startsWith("doc.json.corrupt-"))).toBe(true);
  });

  it("serializes concurrent updates", async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        updateJson(dir, "doc.json", opts, async (d) => {
          await new Promise((r) => setTimeout(r, 5));
          return { value: { n: d.n + 1, tags: [...d.tags, String(i)] }, result: null };
        }),
      ),
    );
    const saved = JSON.parse(await readFile(join(dir, "doc.json"), "utf8")) as Doc;
    expect(saved.n).toBe(10);
    expect(saved.tags).toHaveLength(10);
  });
});

describe("readJson", () => {
  it("reports missing, corrupt and ok", async () => {
    expect((await readJson(dir, "doc.json", validate)).status).toBe("missing");
    await writeFile(join(dir, "doc.json"), '{"n":"x"}');
    expect((await readJson(dir, "doc.json", validate)).status).toBe("corrupt");
    await writeFile(join(dir, "doc.json"), '{"n":1,"tags":[]}');
    expect(await readJson(dir, "doc.json", validate)).toEqual({ status: "ok", value: { n: 1, tags: [] } });
  });
});

describe("insideDir", () => {
  it("refuses paths outside the directory and symlinks", async () => {
    await expect(insideDir(dir, "..", "x")).rejects.toThrow(/outside/);
    await symlink("/etc/passwd", join(dir, "link.json"));
    await expect(insideDir(dir, "link.json")).rejects.toThrow(/symlink/);
  });
});

describe("withLock", () => {
  it("removes a stale lock", async () => {
    const lock = join(dir, "x.lock");
    await writeFile(lock, "999 old\n");
    const old = new Date(Date.now() - 120_000);
    await utimes(lock, old, old);
    expect(await withLock(lock, async () => "ran")).toBe("ran");
  });

  it("gives up on a live lock after the wait", async () => {
    const lock = join(dir, "x.lock");
    await writeFile(lock, "1 now\n");
    await expect(withLock(lock, async () => "ran", { waitMs: 200 })).rejects.toThrow(/held by another run/);
  });
});

describe("RunStore", () => {
  it("scopes, orders, de-duplicates ids and prunes per scope", async () => {
    const runs = new RunStore<{ x: number }>({ dir, keep: 2 });
    const t = new Date("2026-10-02T15:00:00Z");
    const a1 = await runs.newId(t, "a-dnb");
    expect(a1).toBe("a-dnb-20261002T150000Z");
    await runs.write(a1, { x: 1 });
    const a2 = await runs.newId(t, "a-dnb");
    expect(a2).toBe("a-dnb-20261002T150000Z-2");
    await runs.write(a2, { x: 2 });
    await runs.write(await runs.newId(new Date("2026-10-06T15:00:00Z"), "a-dnb"), { x: 3 });
    await runs.write(await runs.newId(t, "b-ukg"), { x: 9 });
    expect(await runs.list("a-dnb")).toEqual(["a-dnb-20261002T150000Z", "a-dnb-20261002T150000Z-2", "a-dnb-20261006T150000Z"]);
    expect((await runs.latest("a-dnb"))?.run).toEqual({ x: 3 });
    await runs.prune("a-dnb");
    expect(await runs.list("a-dnb")).toEqual(["a-dnb-20261002T150000Z-2", "a-dnb-20261006T150000Z"]);
    expect(await runs.list("b-ukg")).toHaveLength(1);
  });

  it("rejects bad scopes and odd ids", async () => {
    const runs = new RunStore({ dir });
    await expect(runs.newId(new Date(), "../x")).rejects.toThrow(/valid run scope/);
    expect(await runs.read("../../etc/passwd")).toBeNull();
  });
});

describe("refs", () => {
  it("assigns and resolves, tolerating what weak models send", () => {
    const items = assignRefs("K", ["a", "b", "c"]);
    expect(items.map((i) => i.ref)).toEqual(["K1", "K2", "K3"]);
    const map = new Map(items.map((i) => [i.ref, i.item]));
    const r = resolveRefs(["k2", "[K1]", '"K2"', "K9", "nonsense", "K3."], (ref) => map.get(ref));
    expect(r.found.map((f) => f.ref)).toEqual(["K2", "K1", "K3"]);
    expect(r.duplicates).toEqual(["K2"]);
    expect(r.unknown).toEqual(["K9", "nonsense"]);
    expect(cleanRef("K4.2")).toBe("K4.2");
  });
});

describe("text and time", () => {
  it("makes comparison keys", () => {
    expect(textKey("Łaszewo")).toBe(textKey("Laszewo"));
    expect(textKey("Ho Gosh & Macarite")).toBe("ho gosh and macarite");
    expect(textKey("  UNiiQU3 ")).toBe(textKey("UNIIQU3"));
  });

  it("clips at a break", () => {
    expect(clip("one two three four five six seven", 20)).toBe("one two three four…");
    expect(clip("short", 20)).toBe("short");
  });

  it("never moves backwards and knows local dates", () => {
    expect(laterIso("2026-10-02T00:00:00Z", "2026-10-01T00:00:00Z")).toBe("2026-10-02T00:00:00Z");
    expect(laterIso(undefined, "2026-10-01T00:00:00Z")).toBe("2026-10-01T00:00:00Z");
    expect(localDate(new Date("2026-10-03T04:00:00Z"), "America/Denver")).toBe("2026-10-02");
  });
});
