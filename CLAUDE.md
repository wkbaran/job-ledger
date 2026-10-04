# Agent notes

Common mistakes and confusion points in this project. Add to this list when something surprises you.

- **This is a library for MCP servers that run unattended agent jobs.** Its users are medium-reader-mcp, substack-reader-mcp and spotify-discovery-mcp (all in `~/projects/`). Changes here reach them only when each is rebuilt, because they bundle it into `dist/`.
- **The code was extracted from medium-reader-mcp's `src/digest/state.ts`** and generalized. Keep the behaviour the same: `.bak` before every write, temp file plus rename, lock files that go stale after 60 s, and a `last_run` that never moves backwards. The digest servers' state files depend on it.
- **Nothing here may print to stdout.** The servers that use it speak MCP over stdio.
- **Keep it free of any one service** (no Medium, Substack or Spotify types). Anything specific to one job belongs in that job's server.
- TypeScript is 7.x, the native compiler. If vitest fails with `Cannot find native binding` (rolldown), delete `node_modules` and `package-lock.json` and run `npm install` again.
