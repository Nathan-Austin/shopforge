# CLAUDE.md

Guidance for coding agents working in this repository.

shopforge generates a Next.js + Supabase + Stripe shop in one of two store
modes (`generic`, `chilli`). What is planned, what is done and what is
decided lives in `ROADMAP.md`; the current direction — one codebase whose
choices are settings rather than generated code — is section 0 there and
`docs/single-codebase-plan.md`.

## Session working rules

How we work in this repository.

- **State where you are first.** Check `pwd`, name the git worktree folder
  and the branch, and derive every temporary folder name strictly from the
  worktree folder (`/tmp/sf-<folder>-<task>`) — never from another
  worktree's name, and never from the branch, which may disagree with the
  folder it is checked out in.
- **Everything in the foreground.** Builds, generators and test suites run
  in the foreground: no background tasks, timers or wait loops.
- **Fix at the source.** Changes belong in the generator scripts and in
  `store-modes/{generic,chilli}/` (or `shared-assets/` for what both modes
  share), and both modes must keep building cleanly with placeholder
  environment values only.
- **Small atomic commits**, one step at a time. Never push to a remote.
- **End every turn** with: what changed (and tick `ROADMAP.md`), how the
  checks went, what broke and how it was fixed, and any decisions needed.

## Checks

Both run in the foreground and need no Supabase project:

- `test/generate-and-check.sh --mode=generic|chilli [--shipping=form|stripe]
  [--suffix=…] [--tmp-dir=/tmp/sf-…]` generates a store and runs install,
  type-check, lint, unit tests and build.
- `test/check-schema.sh --mode=all` applies every migration twice, in
  generator order, and runs the SQL tests in `test/sql/`.
