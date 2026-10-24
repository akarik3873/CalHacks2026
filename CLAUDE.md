# CalHacks2026

AI health assistant built for the Elastic track. Read [plan3.md](plan3.md) for the architecture and build order, and [sponsor-tracks.md](sponsor-tracks.md) for track rules.

# Git Rules
- **Never push directly to `main`.** `main` is the source of truth and must always run. Work lands on `elastic` first and reaches `main` only through a reviewed pull request.
- **Work on the `elastic` line for now.** Agent branches (`agent/builder-feature`, `agent/tester-qa`) branch from `elastic` and merge back into `elastic`.
- **Commit small and often.** Commit each piece as soon as it works (e.g. `git commit -m "add elastic client stub"`), so any break is one step to undo.

# Parallel Agent Execution Rules

Three Claude Code agents work at the same time, each in its own git worktree:

| Agent | Worktree | Branch | Port |
|---|---|---|---|
| Main/Design | `CalHacks2026/` | `elastic` | `3000` |
| Builder | `CalHacks2026-builder/` | `agent/builder-feature` | `3001` |
| Tester | `CalHacks2026-tester/` | `agent/tester-qa` | `3002` |

All three worktrees sit side by side in the same parent folder.

## Directory & File Scoping
Each agent edits strictly within its assigned scope. Reading anything is fine; editing outside your scope is not.

| Agent | Owns (may edit) |
|---|---|
| Main/Design | `plan*.md`, `sponsor-tracks.md`, `README.md`, `CLAUDE.md`, `design/`, `start-agents.sh`, and merging agent branches into `elastic` |
| Builder | `app/` (Expo), `convex/`, `elastic/` (mappings, ES\|QL, agent, workflows, seed), root `package.json` and lockfile, app/build config files |
| Tester | `tests/`, `e2e/`, `tests/fixtures/`, test runner config (`vitest.config.*`, `jest.config.*`, `playwright.config.*`) |

- A test dependency the Tester needs goes in `devDependencies`. The Tester may add it to `package.json` only for test tooling, and must log it (see Shared State).
- A file not listed above belongs to Main/Design until it assigns it. Ask by logging a note first.

## Port Allocation
Every dev server an agent starts uses that agent's port, and only that port:
- Main/Design: `3000`
- Builder: `3001`
- Tester: `3002`

Pass the port explicitly, e.g. `npx expo start --web --port 3001`. Never kill a process on another agent's port.

## Error Handling
If build, type, or lint errors come from files **outside your assigned scope**, do NOT fix them. Instead:
1. Append a note to `.agent-sync.log` naming the file, the error, and the owner agent.
2. Wait for the owner agent to resolve it. Carry on with in-scope work that doesn't depend on it.

## Shared State: `.agent-sync.log`
There is one shared log for all three agents, in the main worktree:

```
C:/Users/johna/Downloads/Personal/CalHacks2026/.agent-sync.log
```

From the Builder or Tester worktree that is `../CalHacks2026/.agent-sync.log`. Always write to that one file, never a copy in your own worktree. It is git-ignored.

- **Must log:** API changes (function signatures, HTTP routes, tool schemas), new dependencies, DB schema edits (Convex schema, Elasticsearch mappings), and out-of-scope errors.
- **Read it** at the start of each task and before merging.
- **Append only.** Never edit or delete existing lines.
- **Format:** one line per entry:

```
[2026-10-24T14:05:00Z] [builder] [schema] added `kind` keyword field to health-timeline mapping (elastic/mappings/health-timeline.json)
```

Types: `api`, `dependency`, `schema`, `error`, `note`.
