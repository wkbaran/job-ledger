import { copyFile, lstat, open, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";

export const LOCK_STALE_MS = 60_000;
const LOCK_WAIT_MS = 10_000;

/**
 * A path inside a job's directory. Refuses symlinks and anything whose real
 * location is outside the directory, so a planted link can't redirect a write.
 */
export async function insideDir(dir: string, ...parts: string[]): Promise<string> {
  let root: string;
  try {
    root = await realpath(dir);
  } catch {
    throw new Error(`The directory ${dir} doesn't exist. Create it, or fix the setting that points to it.`);
  }
  const target = join(root, ...parts);
  if (target !== root && !target.startsWith(root + sep)) throw new Error(`${parts.join("/")} is outside ${dir}.`);
  const parent = await realpath(dirname(target)).catch(() => null);
  if (parent && parent !== root && !parent.startsWith(root + sep)) throw new Error(`${parts.join("/")} resolves outside ${dir}.`);
  const info = await lstat(target).catch(() => null);
  if (info?.isSymbolicLink()) throw new Error(`Refusing to use ${target}: it's a symlink.`);
  return target;
}

/** Write via `<file>.tmp-<pid>` and rename, so readers never see half a file. */
export async function writeAtomic(file: string, text: string, mode = 0o644): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    await writeFile(tmp, text, { mode });
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

/**
 * Run `fn` holding an exclusive lock file. A lock older than `staleMs` is
 * assumed to belong to a dead process and is removed.
 */
export async function withLock<T>(lockFile: string, fn: () => Promise<T>, opts: { staleMs?: number; waitMs?: number } = {}): Promise<T> {
  const staleMs = opts.staleMs ?? LOCK_STALE_MS;
  const deadline = Date.now() + (opts.waitMs ?? LOCK_WAIT_MS);
  for (;;) {
    try {
      const handle = await open(lockFile, "wx");
      await handle.writeFile(`${process.pid} ${new Date().toISOString()}\n`);
      await handle.close();
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const info = await stat(lockFile).catch(() => null);
      if (info && Date.now() - info.mtimeMs > staleMs) {
        await rm(lockFile, { force: true });
        continue;
      }
      if (Date.now() > deadline) throw new Error(`${lockFile.split(sep).pop()} is held by another run; try again in a minute.`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  try {
    return await fn();
  } finally {
    await rm(lockFile, { force: true });
  }
}

export type Loaded<T> = { status: "ok"; value: T } | { status: "missing"; value: null } | { status: "corrupt"; value: null; warning: string };

/** Read a JSON file without changing anything. `validate` returns null for a value it doesn't accept. */
export async function readJson<T>(dir: string, name: string, validate: (v: unknown) => T | null): Promise<Loaded<T>> {
  const file = await insideDir(dir, name);
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { status: "missing", value: null };
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { status: "corrupt", value: null, warning: `${name} isn't valid JSON.` };
  }
  const value = validate(parsed);
  return value === null ? { status: "corrupt", value: null, warning: `${name} doesn't have the expected shape.` } : { status: "ok", value };
}

/** Pretty-printed with a trailing newline, so hand edits and diffs stay readable. */
export function serializeJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

export interface UpdateResult<R> {
  result: R;
  changed: boolean;
  warnings: string[];
}

/**
 * Read-modify-write one JSON file under `<name>.lock`. `change` gets the
 * current value (or `initial()` when the file is missing) and returns the new
 * value plus anything the caller wants back.
 *
 * - A corrupt file is moved aside to `<name>.corrupt-<time>` and treated as missing.
 * - The previous file is copied to `<name>.bak`, then the new one is written atomically.
 * - Nothing is written when the serialized text is unchanged.
 * - The previous file's mode is kept (0644 for a new one).
 */
export async function updateJson<T, R>(
  dir: string,
  name: string,
  opts: { validate: (v: unknown) => T | null; initial: () => T; lock?: { staleMs?: number; waitMs?: number } },
  change: (current: T) => { value: T; result: R } | Promise<{ value: T; result: R }>,
): Promise<UpdateResult<R>> {
  const file = await insideDir(dir, name);
  const warnings: string[] = [];
  return withLock(
    file + ".lock",
    async () => {
      let existing: string | null = null;
      let mode = 0o644;
      try {
        existing = await readFile(file, "utf8");
        mode = (await stat(file)).mode & 0o777;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
      let current: T | null = null;
      if (existing !== null) {
        try {
          current = opts.validate(JSON.parse(existing));
        } catch {
          current = null;
        }
        if (current === null) {
          const aside = await insideDir(dir, `${name}.corrupt-${isoStamp(new Date())}`);
          await rename(file, aside);
          warnings.push(`${name} was corrupt; moved it to ${aside.split(sep).pop()} and started a new one.`);
          existing = null;
        }
      }
      const { value, result } = await change(current ?? opts.initial());
      const text = serializeJson(value);
      if (text === existing) return { result, changed: false, warnings };
      if (existing !== null) await copyFile(file, await insideDir(dir, `${name}.bak`));
      await writeAtomic(file, text, mode);
      return { result, changed: true, warnings };
    },
    opts.lock,
  );
}

/** `20261002T121524Z`, for file names. */
export function isoStamp(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[-:]/g, "");
}
