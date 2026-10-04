import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { insideDir, isoStamp, serializeJson, writeAtomic } from "./files.js";

/**
 * Run files are the contract between a job's "begin" and "finish" tools:
 * refs only mean something against a run. Each lives at
 * `<dir>/<subdir>/<id>.json`, where `id` is the start time (`20261002T121524Z`),
 * with `-2`, `-3`… when two runs start in the same second. A `scope` (a lane, a
 * feed) can prefix the id: `a-dnb-20261002T121524Z`.
 */
export interface RunStoreOptions {
  dir: string;
  subdir?: string;
  /** How many run files to keep per scope. */
  keep?: number;
}

const SCOPE = /^[a-z0-9][a-z0-9_-]{0,40}$/;
const STAMP = /\d{8}T\d{6}Z(?:-\d+)?$/;

export class RunStore<T> {
  readonly dir: string;
  readonly subdir: string;
  readonly keep: number;

  constructor(opts: RunStoreOptions) {
    this.dir = opts.dir;
    this.subdir = opts.subdir ?? "runs";
    this.keep = opts.keep ?? 14;
  }

  private prefix(scope?: string): string {
    if (scope === undefined) return "";
    if (!SCOPE.test(scope)) throw new Error(`"${scope}" isn't a valid run scope (lowercase letters, digits, - and _).`);
    return `${scope}-`;
  }

  private valid(id: string, scope?: string): boolean {
    const p = this.prefix(scope);
    return id.startsWith(p) && new RegExp(`^${STAMP.source}`).test(id.slice(p.length));
  }

  /** Run ids for a scope, oldest first. */
  async list(scope?: string): Promise<string[]> {
    const runs = await insideDir(this.dir, this.subdir);
    const names = await readdir(runs).catch(() => [] as string[]);
    return names
      .filter((n) => n.endsWith(".json"))
      .map((n) => n.slice(0, -5))
      .filter((id) => this.valid(id, scope))
      .sort(compareRunIds);
  }

  /** A run id not used yet for this start time. */
  async newId(startedAt: Date, scope?: string): Promise<string> {
    const base = this.prefix(scope) + isoStamp(startedAt);
    const taken = new Set(await this.list(scope));
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  }

  async read(id: string): Promise<T | null> {
    if (!/^[a-z0-9_-]*\d{8}T\d{6}Z(?:-\d+)?$/.test(id)) return null;
    const file = await insideDir(this.dir, this.subdir, `${id}.json`);
    try {
      return JSON.parse(await readFile(file, "utf8")) as T;
    } catch {
      return null;
    }
  }

  /** The newest run for a scope, if any. */
  async latest(scope?: string): Promise<{ id: string; run: T } | null> {
    const ids = await this.list(scope);
    for (const id of ids.reverse()) {
      const run = await this.read(id);
      if (run) return { id, run };
    }
    return null;
  }

  async write(id: string, run: T): Promise<void> {
    await mkdir(await insideDir(this.dir, this.subdir), { recursive: true });
    await writeAtomic(await insideDir(this.dir, this.subdir, `${id}.json`), serializeJson(run));
  }

  /** Delete all but the newest `keep` run files for a scope. */
  async prune(scope?: string): Promise<void> {
    const ids = await this.list(scope);
    for (const id of ids.slice(0, Math.max(0, ids.length - this.keep))) {
      await rm(await insideDir(this.dir, this.subdir, `${id}.json`), { force: true });
    }
  }
}

function compareRunIds(a: string, b: string): number {
  const ma = a.match(STAMP)![0];
  const mb = b.match(STAMP)![0];
  const [ba, sa] = ma.split("-");
  const [bb, sb] = mb.split("-");
  return ba! < bb! ? -1 : ba! > bb! ? 1 : Number(sa ?? 1) - Number(sb ?? 1);
}
