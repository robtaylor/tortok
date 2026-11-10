# Handoff discipline

Handoffs in this project are **ephemeral working memory**, not historical record. They exist to bridge a single session boundary — when one Claude session stops and another (or a human) picks up — and they are deleted once the work they describe is resolved.

This document defines what a handoff is, what it isn't, when to write one, and exactly what to do when one is resolved.

## Why this discipline exists

Decision rationale, technical context, and project state all have natural homes:

- **Decision records** (`docs/architecture/decisions/`) capture architectural decisions and their *why*.
- **Open problems** (`docs/architecture/open-problems/`) capture decisions we have deliberately *not* made yet, with a `Must resolve by:` phase header.
- **Plan docs** (`docs/plans/<phase>.md`) capture *what's left* in a phase and the next workstream slices.
- **Release plan** (`docs/plans/release-plan.md`) captures launch criteria and pre-release work.

When that content lives in a handoff instead, two things go wrong:

1. **It's not where contributors look.** A new contributor reading `CLAUDE.md` → the [architecture map](architecture/README.md) → the decision records shouldn't have to dig through a stack of resolved handoff docs to find load-bearing decisions or the current state of a phase.
2. **It rots out of sync with reality.** Handoffs are point-in-time snapshots. A "STATUS: RESOLVED" banner doesn't help when the thing referenced has moved or changed; the canonical doc is what should hold the current truth.

The discipline closes this gap by **forcing migration before deletion**. Every load-bearing piece of a handoff lands in its proper home (decision record / open-problem / plan / release-plan / code comment) before the handoff file is removed.

## What a handoff IS

A single markdown file at `docs/handoffs/<topic>-handoff.md` containing exactly what the next session needs to pick up where you left off:

- **Goal & next-up** — what this session was trying to do, and what the *very next* concrete action is.
- **Done this session** — commits landed, with one-line summaries.
- **Open follow-ups** — the work that wasn't done, with enough scope detail to start cold.
- **Critical context** — gotchas, surprising findings, environment specifics that aren't obvious from the code or docs *yet*.
- **Verification** — the command(s) the next session runs to confirm the work is in the state you say it is.

There's at most one handoff per active thread of work, and usually just one. There's no chain of resolved predecessors to wade through.

## What a handoff IS NOT

- **Not a decision log.** Decisions go in decision records at `docs/architecture/decisions/`. If you find yourself writing "we chose X over Y because Z" in a handoff, that paragraph belongs in a decision record — a new one, or, if it changes an accepted decision, a *superseding* record. Decisions are immutable: never edit an accepted record's body or bolt on a dated amendment; the current state of the system lives in the area doc instead.
- **Not a design doc.** "How the WebTorrent bridge serves multi-file torrents to expo-video" is a design topic; it lives in a code comment near the bridge, not a handoff's "Critical context" section.
- **Not a status dashboard for the project.** Phase status lives in the plan doc — `docs/plans/phase-3-atproto.md` for the current phase. A handoff cites it, doesn't reproduce it.
- **Not a historical record.** `git log` is the historical record. Handoffs that survive past their resolution turn into noise that misleads new contributors.

## When to write one

Write a handoff at the end of any session that:

1. **Leaves work in a partial state** that someone else might pick up cold.
2. **Captures non-obvious context** the next session needs (e.g. "eager construction of the OAuth client crashes Expo Router's web render pass with `indexedDB is not defined`").
3. **Documents the next concrete step** with enough scope to start without re-discovering it.

If the session ended at a clean stopping point (everything merged, all decisions documented in decision records/plans, nothing surprising), don't write a handoff. The plan doc already says what's next.

## Resolution: fold, then delete

The two-location split is deliberate: handoffs *live* at `docs/handoffs/<topic>-handoff.md` while in flight; their *content* migrates into the persistent docs (`docs/architecture/decisions/`, `docs/architecture/open-problems/`, `docs/plans/`, `docs/plans/release-plan.md`, code comments) at resolution. The handoff file then gets removed; nothing about the work is lost because everything load-bearing has a permanent home elsewhere.

When a handoff's work is done — whether in the next session or several sessions later — every load-bearing piece of it must be migrated to its proper home **before the handoff file is deleted**:

| If the handoff says... | It belongs in... |
|---|---|
| "We chose approach X over Y because Z" | A new decision record under `docs/architecture/decisions/`; if it overturns an accepted one, a *superseding* record (set the old record's Status to `Superseded by Decision NNNN` and move it to `decisions/archive/` with `doctool.py archive`) |
| "Future scope for Unit N: do A then B then C" | The plan doc's Unit N section (`docs/plans/phase-3-atproto.md` or successor) |
| "Open question: should we X or Y; must decide by phase Z" | A new file under `docs/architecture/open-problems/<name>.md` with the standard `Must resolve by:` header |
| "Gotcha: Hermes is missing `AbortSignal.throwIfAborted`" | A code comment near the polyfill (`tortok/lib/polyfills.ts`), or `CLAUDE.md` if it cuts across files |
| "Build dep / env var Z is required for dev" | `.env.example` and the quickstart in the root `README.md`, not a handoff |
| "Subsystem A doesn't yet do B" | Plan doc as a new open item, or a decision-record-tracked walk-back if it's a deferred design choice |
| "Run `npm run seed:fixtures` to verify" | The verification block in the relevant plan doc, or the quickstart in the root `README.md` |
| "Launch criteria: A, B, C must hold before opening signups" | `docs/plans/release-plan.md` |

After migration, the handoff file is removed in the same commit as the migration:

```bash
git rm docs/handoffs/<topic>-handoff.md
git add <files-receiving-the-migrated-content>
git commit -m "$(cat <<'EOF'
docs: resolve <topic> handoff — fold into <where-it-went>

<one-paragraph summary of what was migrated and where>

Co-developed-by: Claude Code v<version> (<model-id>)
EOF
)"
```

The commit message records what migrated where — that's the audit trail. `git log -- docs/handoffs/` then shows the project's handoff history (one add, one delete per session) without needing the files themselves to live forever.

## Template

Start from [`docs/handoffs/_template.md`](handoffs/_template.md), or scaffold one with `uv run docs/scripts/doctool.py new handoff "<topic>"`. Replace placeholders inline, and delete sections that don't apply rather than filling them with "N/A".

## Tooling

The `create_handoff` and `resume_handoff` skills (from various Claude Code orchestration toolkits) generate and consume handoffs. They're optional — the discipline above is the load-bearing artifact. A handoff written by hand following this template is just as valid.

If you use one of those skills, expect them to default to YAML format under `thoughts/shared/handoffs/` with database indexing. **That doesn't apply to this project.** Override it: produce markdown at `docs/handoffs/<topic>-handoff.md` and skip the database step. The skill activation is informational; the project's convention takes precedence.
