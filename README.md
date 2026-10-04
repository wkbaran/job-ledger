# job-ledger

Bookkeeping for scheduled LLM jobs, so the model only has to judge.

An unattended agent job (a daily digest, a playlist builder) has two kinds of work: judgment, which needs a model, and bookkeeping, which doesn't. Bookkeeping means remembering what's been done, handing items between steps, deduplicating, saving state and laying out the final message. Models are bad at bookkeeping. They mistype ids, renumber items, forget to save, and fight file tools that refuse their writes. Every one of those mistakes has happened in production on [Hermes](https://github.com/NousResearch/hermes-agent) cron jobs.

job-ledger is the bookkeeping half. It's a TypeScript library for MCP servers built around one pattern:

1. **begin**: the server collects the items, drops the ones already handled, gives each a short ref (`K3`), saves a run file, and returns a compact plain-text list.
2. **The model judges**: it picks refs, writes short notes, and may hand some refs to subagents. It never copies an id, URL or title between calls.
3. **finish**: the server resolves the refs against the run file, applies limits, does the side effects, saves state atomically, and returns the final message for the model to send unchanged.

The model needs no file tools, and state can't be lost by a run that sends its message and stops.

## What's in it

| Module | Provides |
|---|---|
| `files` | `insideDir` (no symlinks or escapes), `writeAtomic` (temp file and rename), `withLock` (lock file with stale-lock recovery), `readJson`, `updateJson` (locked read-modify-write with `.bak` and corrupt-file recovery) |
| `runs` | `RunStore`: run files per scope (`a-dnb-20261002T150000Z`), newest-N pruning, `latest()` |
| `refs` | `assignRefs`, `cleanRef`, `resolveRefs`: tolerant of `k3`, `[K3]`, `"K3"` and repeats |
| `text` | `textKey` (comparison keys: case, accents, `&`, punctuation), `clip` (cut at a clause or word break) |
| `time` | `isoSeconds`, `laterIso` (a last-run time that never moves backwards), `localDate` |

The code comes from [medium-reader-mcp](https://github.com/wkbaran/medium-reader-mcp) and [substack-reader-mcp](https://github.com/wkbaran/substack-reader-mcp), where it has run the daily digests since 2026-10-02. [docs/design.md](docs/design.md) covers what's planned next: item pools that carry unpicked items forward, pick limits, and size-capped rendering.

## Using it

The servers that use it bundle it into their `dist/` at build time, so a deploy copies `dist/` and nothing else needs installing. During development, depend on the local checkout:

```json
"dependencies": { "job-ledger": "file:../job-ledger" }
```

```ts
import { RunStore, updateJson, resolveRefs } from "job-ledger";
```

## Development

```sh
npm install
npm test
npm run build
```

Node 26 or later. MIT licensed.
