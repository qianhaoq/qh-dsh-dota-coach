# Contributing

Use Node ≥24.9, the pnpm version in `packageManager`, and Go 1.27.3. Run `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm test:ui`, and `go test ./...` in `packages/coach/go` for affected behavior.

Keep Host and Client entrypoints separate. Browser code must use the generated Remote; it cannot read local files, SQLite or OpenDota. Own registrations, timers, workers and child processes through the Cordis plugin scope.

Keep source text, locators, evidence hashes, patch applicability and user reports distinct. Knowledge revisions preserve old records. Generated memory is a candidate, not verified truth. Do not add independent model credentials or a second chatbot.

Fixtures must be synthetic or explicitly redistributable and anonymized. Never commit credentials, personal accounts, user corpora, database files, downloaded replays or local absolute paths. Full replay and live API checks are optional release smokes, separate from deterministic CI.

Release builds are per-platform and include runtime dependencies. Inspect the staged package, run the clean-install smoke and verify checksums before publishing. No npm or marketplace publication in v0.1.
