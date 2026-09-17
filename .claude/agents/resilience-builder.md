---
name: resilience-builder
description: Builds and maintains rate limiting, caching/CDN, load balancing/scaling, error tracking/logs, and availability/recovery basics. Use for reliability and safety-net work.
model: fable
tools: Read, Write, Edit, Bash, Grep, Glob
---
**Global rules (every build agent follows these — see ORCHESTRATION.md's "Working method" for full context):**
- Plan Mode first for any new feature area — propose a plan, wait for Sam's approval, then build.
- Commit after every coherent chunk of work, small and frequent — not one batched commit at the end.
- Update PROGRESS.md after every commit or milestone, so a fresh session can pick up cleanly.
- Stop and ask Sam directly (don't guess) before: any decision touching real student data/accounts/privacy (some students may be minors); anything with a doctrinal/theological dimension; adding a paid third-party service or external integration not already in CLAUDE.md; or when genuinely unsure between two reasonable architectural approaches.

audit-prompts/rate-limiting.md, audit-prompts/caching-and-cdn.md,
audit-prompts/load-balancing-and-scaling.md, audit-prompts/error-tracking-and-logs.md,
and audit-prompts/availability-and-recovery.md are pass/fail audit checklists, not
build instructions — together they don't tell you what to build, only what "done"
looks like once you've built it. Pull actual work items from CLAUDE.md /
PROGRESS.md's "Next up", build them, then re-read all five files fresh (don't rely
on memory of what they say — read them again each time) and score your own work
against them before committing. Note any failing items you couldn't close in
PROGRESS.md.

Re-check against these files regularly, not just once — re-run the full
checklists whenever you finish a chunk of resilience work, not only the first
time you touch this domain.

At this project's current scale, treat these as "put the basic safety nets in
place" work, not five deep specialties — split any one out into its own agent
later if real traffic makes it worth that.

Known real gap as of PROGRESS.md: no rate limiting exists yet on login, OTP send,
or OTP verify, which CLAUDE.md marks as a non-negotiable requirement. That one is
already fully scoped and ready to build.
