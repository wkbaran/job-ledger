# Design

## The rule

**Whatever a model would copy, count or remember, the server holds.** The model sees refs and short text. It returns refs, judgments and notes. Everything a mistake could corrupt stays in the server: ids, URLs, dedup sets, limits, state files and the final message layout.

The bugs that led to each rule:

| What went wrong (Hermes cron jobs, 2026) | Rule |
|---|---|
| A digest was sent, then the run ended before the model saved state, so the next run repeated it | `finish` saves state *before* returning the message |
| Full-file rewrites of a state file were refused (it had been read in pages); half a run's budget went on retries | The model gets no file tools; state is written only by the server |
| The main model renumbered posts when delegating, so 10 of 12 summaries were attached to the wrong posts | Refs are assigned and resolved by the server; subagents read by ref |
| A playlist job called "add" twice, leaving 5 duplicate tracks | Side effects check current state first, so they're idempotent |
| Two overlapping runs each created that day's playlist | Shared daily resources are created under a lock |
| A hand-patched history file collected duplicates | Dedup uses normalized keys, in code |

## What's in the library today (0.1.0)

Atomic JSON state (`updateJson`), lock files, run files per scope (`RunStore`), refs, comparison keys and time helpers. See the README.

## Planned

These are being built for spotify-discovery-mcp, and will move here once they're proven there.

### Item pools

A pool is the set of items a job has collected but not yet finished with. It's what lets a job fetch by date ("new since last run") without losing anything that was shown and not picked.

Each item has a stable key, which the job defines (a URI, a normalized title), and a status:

```
new ──shown──▶ shown (passes: 1, 2, …) ──▶ picked
                      │                  ├─▶ rejected   (the model said no)
                      └──────────────────┴─▶ expired    (passed over N times, or too old)
```

- `begin` adds newly fetched items, skipping keys that are already picked, rejected or expired. It then shows new items first and carried-over items after them, each marked with how many times it's been passed over.
- `finish` marks picks and rejections, and increments `passes` on everything shown and not chosen.
- An item expires after `carry_runs` passes or `max_age_days`, whichever comes first. Expired keys are kept for a while, so the item isn't fetched again as new.
- **Pending** items are ones the job found but couldn't use yet (a release not on Spotify yet). `begin` re-checks them each run, and they join the pool once usable. They're dropped after `pending_days`.

### Pick limits

`finish` takes picks in the model's order of preference and applies limits deterministically:

- a total maximum,
- per-source maximums (for example, at most 3 from the known-source feed),
- per-tag maximums (for example, at most 2 by artists the user already likes),
- source caps that lift when the other source has nothing usable,
- optional minimums ("at least 2 web finds when there are 2 to choose from").

Picks over a limit are dropped from the end of the preference order, and the result says which were dropped and why. It never fails. Hermes pauses an MCP server after three error results in a row, so a model that keeps sending a list one too long would stall the job. Dropping from the end and saying so is better than refusing.

### Rendering

- The final message comes from a template, so the model can't open it with "All done! Here's the report:".
- Every tool result is plain text under 40,000 characters. Hermes wraps results in JSON and diverts anything over about 50,000 to a file the model can't read. JSON inside the text gets double-escaped and is hard for a model to copy from.
- Long lists are cut lowest-ranked first, with a count of what was left out.

## What stays in each job's server

The library knows nothing about any one service. Each server provides:

- **collect**: fetch candidates (feeds, searches).
- **verify** (optional): check a model-proposed item exists.
- **apply**: the side effect (add to a playlist, send nothing, mark read).
- **render**: the message layout.
- **its tool definitions**, because tool names and argument descriptions are what the model reads.

## Why a library and not a generic "ledger" MCP server

A generic server would sit between other tools, so the model would copy items from a source tool into the ledger and refs back out again. That's exactly the copying the pattern exists to remove. A generic server still makes sense for jobs whose items the model writes itself, such as "don't repeat a news story already summarized". It could be a thin MCP wrapper over this library later.
