# Bible Academy Platform — Autonomous Build Orchestration

Read this before starting build work in a new session, alongside `CLAUDE.md` and `PROGRESS.md`.

## Setup notes (2026-09-16)

A few things resolved when this file was created, worth knowing before treating anything below as settled:

- **This is a scope decision, not a rename.** The Bible academy is the first deployment; naming, schema, and branding stay generic per `CLAUDE.md`'s "Current deployment context" section so the platform can be reused as a template later. Don't let agents introduce bible/church-specific naming into the schema or routes on the assumption this doc's title means otherwise.
- **The 13 audit-prompt files are pass/fail checklists, not build instructions.** They're seeded now with real content (2026-09-16). Each one tells an agent what "done" looks like for its domain — pull the actual work items from `CLAUDE.md` / `PROGRESS.md`'s "Next up" instead. A build agent's loop is: build the next item → re-read its audit-prompt file(s) fresh from disk (never rely on memory of what they say) → score its own work pass/fail against every item → note failures in `PROGRESS.md` → commit. This re-check happens after every chunk of work in a domain, not just once when an agent first touches it.
- **The `npx getdesign@latest add claude` step below runs a third-party npm package.** Worth a quick look at what it actually does before running, same as vetting any new dependency — it wasn't part of the original stack in `CLAUDE.md`.

---

## Before anything else

1. **This project has existing local progress — pick it up, don't start from scratch.** Don't fully trust `CLAUDE.md`'s description of that progress either, since time has passed since it was last touched. Inventory what's actually there first: `git log`, the directory tree, which parts run vs. which are stubbed or half-finished.
2. Read `CLAUDE.md` in full, then reconcile it against what you actually found in step 1. Update `CLAUDE.md` wherever it's gone stale — don't build forward on a description that no longer matches the code.
3. Check whether `PROGRESS.md` exists.
   - If it exists, read it — it's the source of truth for what's done, in progress, blocked, and any open questions from earlier sessions.
   - If it doesn't exist, create it now, seeded with the reconciled state from steps 1–2: `## Done`, `## In progress`, `## Next up`, `## Decisions & assumptions`, `## Open questions for Sam`.
4. Confirm the active model. If usage credits are available, work on Fable; when they run low you'll see a consent/low-balance prompt — that's expected, not an error.

## Mission

Build as much of the platform described in `CLAUDE.md` as possible, working with minimal check-ins, so the Fable credit window isn't wasted on back-and-forth. Work in this priority order, so the most valuable pieces land first if credits or time run out mid-build:

1. Data models / DB schema
2. Auth and user roles (student, professor, admin) — including role-based route protection, not just "logged in or not"
3. Core CRUD for courses/lectures/exams/assignments
4. Forum, then rate limiting / RLS hardening on everything already built (see the API Security Rules in `CLAUDE.md` — these are non-negotiable, not "later" work, but land after the core flows they protect exist to protect)
5. Polish, styling, and secondary features last

## Visual design

Goal: don't look like a generic AI-scaffolded app. Use [DESIGN.md](https://github.com/VoltAgent/awesome-design-md) — real brand design systems distilled into a markdown file coding agents can follow directly (colors, type scale, component states, spacing, do's/don'ts).

**Primary system — Claude's:** warm terracotta accent, clean editorial layout, humanist type. This is the source of truth for color palette, typography, and spacing everywhere in the app. It's a strong fit here: content-heavy (lesson/devotional text reads like long-form editorial), warm without being childish, and distinctive rather than templated.

Install:
```
npx getdesign@latest add claude
```
Run this from the project root — it drops `DESIGN.md` in. Then tell Claude Code explicitly: *"Follow DESIGN.md as the design system for all UI work."* Sanity-check the result against `design/preview.html` (light and dark) before wiring real components to it.

**Secondary reference — Airtable's, for structure only:** for data-dense screens (course/lesson management, rosters, professor and admin views), pull Airtable's DESIGN.md as a *second, non-authoritative* file — don't let it overwrite the primary one, since two full palettes/type systems fighting for the same UI is how you get an incoherent result:
```
npx getdesign@latest add airtable
mv DESIGN.md design/DESIGN-airtable-reference.md
```
Then instruct Claude Code: *"For course-management and admin screens, additionally reference design/DESIGN-airtable-reference.md for table, tag, and card component conventions — but keep all colors and typography from the primary DESIGN.md."*

**On Binance:** worth naming honestly — its actual identity is "bold yellow on monochrome, trading-floor urgency," which doesn't suit devotional/educational content. What's genuinely appealing there is probably data-dense dashboard *clarity* for a student progress view, not the crypto-trading register. Get that from layout discipline (clear hierarchy, tight data density) within the Claude palette rather than importing Binance's system — adding a third full identity is a good way to end up with a UI that looks like three different products stitched together.

Have `frontend-builder` check new UI against `DESIGN.md` as part of its own definition-of-done, not just against your audit prompt.

## Working method

- **Plan mode** for any new feature area before writing code; wait for approval on the plan itself, not every file.
- **Auto mode** for implementation once a plan's approved — this is Claude Code's current default on Pro/Max/Team: tool calls proceed unless a safety classifier flags them, so you get real autonomy without full permission-bypass risk. Leave it on. If it drops back to manual approval after repeated blocks, treat that as a signal to look closer, not friction to route around.
- **Never commit directly to `main`.** Every commit, from every agent and every session — including Sam's own interactive sessions, not just the autonomous build agents — happens on a branch. Solo/sequential work: `git checkout -b <type>/<slug>` (e.g. `feat/core-crud-courses`, `chore/rls-policies`) before the first commit, even when working in the main directory with no worktree involved. Parallel work: the `-w`/`--worktree` flag branches automatically. Either way, stop and tell Sam the branch is ready for review/merge — don't merge to `main` yourself unless explicitly told to. (`main` already has direct-commit history from before this rule existed, 2026-09-16 through 2026-09-18 — that's not being rewritten, this is a go-forward rule.)
- **Commit to git after every coherent chunk of work**, with a message describing what changed and why. Small, frequent commits are your rollback points and my review surface — don't batch a day's work into one commit.
- **Update `PROGRESS.md` after every commit or milestone.** This is what lets a fresh session — new model, new day, new terminal — pick up cleanly.
- **Stop and ask me directly** (don't guess or assume) when:
  - A decision touches real user/student data, accounts, or anything student-privacy-related (this is a church academy — some students may be minors, so err conservative on data collection and access control)
  - Content or wording has a doctrinal/theological dimension
  - You'd need to add a paid third-party service, payment processing, or external integration not already in `CLAUDE.md`
  - You're genuinely unsure between two reasonable architectural approaches

## Model handoff (Fable → Sonnet)

- Switching models mid-session with `/model sonnet` preserves full conversation context — nothing needs to be re-explained. Use Fable for the heaviest scaffolding work while credits last; when the low-balance prompt appears, just switch.
- If a brand-new session starts days later, run `claude --continue` (same directory) or `/resume` to reattach to prior history when possible. `PROGRESS.md` is the fallback source of truth if history isn't picked up or has been compacted away.
- Fable doesn't draw from the normal weekly subscription limit on this plan — it only bills against usage credits, so there's no risk of it eating into regular Sonnet/Opus quota. Pin it explicitly rather than relying on defaults: pick it once via `/model` (saves as the default for future sessions too), or force it per-launch with `claude --model fable`. For named subagents, set `model: fable` directly in each `.claude/agents/*.md` frontmatter so it's pinned per-agent regardless of the parent session. Watch the model name in the CLI occasionally — a safety-flagged message can silently fall back to a different model mid-session.
- **Use the unversioned alias `fable`, not a specific dotted version like `claude-fable-5-1`.** The exact versioned ID is a real, current model per Anthropic's own API, but this installation's Claude Code build (2.1.274, confirmed 2026-09-17) rejected it as an unsupported model when used directly — the CLI's own `--help` documents `fable`/`opus`/`sonnet` as the supported alias form for "latest model in this tier," which resolves correctly without the client needing to recognize the exact dotted version. If a future Claude Code update starts accepting versioned IDs directly, this constraint may no longer apply — but the alias should keep working regardless, so there's little reason to switch back.

## Named agents (13 domain prompts → 6 build agents)

**Agents build or revise purely based on which tools you grant them — it's not inherent to subagents.** Read-only tools = they can only flag things, never touch code. Give them Write, Edit, and Bash, and they build. Since you want building, that's the setup below.

Reframe the 13 domain prompts accordingly: since they started life as audit checklists, use each one as the **definition of done** for its domain rather than a separate revision-only pass. Each agent builds whatever's next in its domain (pulled from `CLAUDE.md` / `PROGRESS.md`'s "Next up"), checks its own work against its prompt before committing, and only then hands off. Same prompt, different job: standard-to-build-to instead of standard-to-audit-against-afterward.

Store the 13 original prompts as-is under `audit-prompts/` (one file each) and point each agent at the file(s) it owns, so nothing is lost rewriting them. Same groupings as before — build workload splits the same way review workload did:

- `frontend-builder` — Frontend. Solo: large, fast-changing surface.
- `backend-builder` — APIs and backend. Solo: same reasoning you gave — big enough to isolate even from related areas.
- `auth-access-builder` — Auth and permissions + Security and RLS. Merged: both are "who can touch what data," built together so app-layer checks and DB-layer enforcement (RLS) form one coherent chain instead of two disconnected efforts.
- `database-builder` — Database and storage. Solo: schema/migrations/indexing is its own discipline, worth a dedicated pass.
- `platform-ops-builder` — Hosting and deployment + Cloud and compute + CI/CD and version control. Merged: at this project's scale, "how code ships and where it runs" is one coherent effort, not three.
- `resilience-builder` — Rate limiting + Caching and CDN + Load balancing and scaling + Error tracking/logs + Availability and recovery. Merged: for a congregation-scale app these start as lightweight "put the basic safety nets in place" work, not five deep specialties yet. Split any one out into its own agent later if real traffic ever makes it a discipline on its own — subagents are just markdown files, so splitting is cheap.

### The supervising agent (a seventh role, deliberately not a builder)
`.claude/agents/supervising-agent.md` defines the supervisor that sits above the six build agents: it triages PRs and branches, resolves merge conflicts, reports exactly what only Sam can do (merges, dashboards, credentials, decisions), drives external-service setup via CLI/API, and keeps `PROGRESS.md` true. It changes code only when strictly necessary (conflict resolution, or a defect that blocks a merge/deploy/setup) and never starts or dispatches build work without Sam's explicit go-ahead. When a supervising session grows too large, start a fresh one and say: "Follow the instructions for the supervising agent in `.claude/agents/supervising-agent.md`." Everything durable lives in `PROGRESS.md`, so nothing needs re-explaining.

### Running them
- **In-session delegation** (agent works inside your current terminal, reports back): ask "use the backend-builder agent to build X," or let Claude auto-delegate based on the agent's description. Best for work tied closely to what the main session is already doing.
- **Dedicated terminal per agent**: launch a whole session *as* that agent from the start with `claude --agent <name>`. Now that these write files, running more than one at a time in the *same* directory risks collisions — give each a git worktree (see Parallelizing below) if they're running concurrently, or just run them one at a time in the main directory if you're not parallelizing yet.

**Trade-off worth knowing:** Write access removes the "see the finding before it lands" checkpoint the read-only version had. That's fine here — you already have two other checkpoints doing that job: Auto mode's classifier gates individual tool calls, and small frequent commits (see Working method) give you a real diff to review after the fact instead of before.

**Keep a door open for pure audits.** Before a merge or a deploy, invoke the same agent with an explicit "review only, don't change anything, just report" — tool access makes writing *possible*, it doesn't force it. Same agent, same prompt, different instruction.

### Seeing them on your phone
Claude Code's **Remote Control** feature bridges a local terminal session to the Claude mobile app (all plans) — code and execution stay on your machine, the phone is just a live window into it. Inside each session run `/remote-control` (or pass `--remote-control` at launch) and give it a name; it'll show up in the phone app's **Code** tab as a separate entry with a status dot. Do this for each of your six agent terminals and you'll see all six listed by name, with the ability to view live output, approve/deny actions, and send follow-ups from your phone. Background subagents running within a session are also visible from there.

## Parallelizing across terminals (optional — once subagents feel comfortable)

For genuinely independent build streams (frontend scaffold + backend API at the same time):

```
git worktree add ../academy-frontend feature/frontend
git worktree add ../academy-backend feature/backend
```

Open one terminal tab per worktree, name the tab to match, and give each session a one-line role header at the start ("You are the frontend agent — work only in this worktree, on X"). Hold off on Claude Code's experimental Agent Teams feature until worktrees feel routine — it's still flagged experimental and each teammate is a full separate context window, so it burns credits fast.

## Environment note

Terminal is the most capable surface for this (full worktree cleanup, all interactive features, cheapest to run several at once) — recommended as home base given your Linux comfort. The Claude Desktop app's Code tab is worth adding alongside it if you want OS-level toast notifications when a session needs your input, so you're not babysitting a terminal window. VS Code's extension is nice for reviewing diffs inline on the parts you want to eyeball closely (auth/security code, say). Note sessions aren't shared between these three — pick one client per session lineage and stick with it rather than hopping mid-task.
