# DSH Dota coach

An evidence-based post-match coaching plugin: choose a match, review a decision window, study source material, save one practice goal, and revisit it after the next game.

The conversation tools and four embedded tabs share one Host domain service. DSH owns the model, credentials and conversation. There is no separate chat server or cloud account.

## Install

Requires Node ≥24.9 and the tested DSH baseline 0.2.1-rc.3. Download the platform `.tgz` and verify `SHA256SUMS` from [Releases](https://github.com/qianhaoq/qh-dsh-dota-coach/releases), then run:

```sh
dsh plugin --profile web add ./qh-dsh-dota-coach-0.1.1-linux-x64.tgz
```

Targets: Linux x64, Windows x64, macOS arm64 and macOS x64 (`darwin` in filenames). Packages include built code, runtime dependencies and the native replay extractor. End users do not need Go, a database server or system decompression tools.

Open **Dota coach** in the DSH sidebar. Configure an OpenDota account ID or enter a match ID. No personal account is preset. Data lives in `$DSH_HOME/dota-coach`, defaulting to `~/.dsh/dota-coach`; uninstalling leaves it intact.

## Knowledge and learning

The plugin embeds the public MemOS Local 2.0.21 MemoryCore API in an owned worker. SQLite holds original material, locators, hashes, evidence, revision history, reviews and practice checkins. A durable queue projects these records into MemOS; local multilingual embeddings enable semantic retrieval. First indexing may download a model; offline model paths are supported.

`dota_memory learn` uses the owning DSH conversation's configured model to induce candidate experience from a saved review. Repeated learning from one review does not increase support. Higher-level induction requires three independent reviews. Generated policies and skills remain **unverified candidates**, never automatically verified facts or host instructions.

Storage and embeddings run locally. Learning prompts go through the configured DSH model, which may be cloud-hosted. MemOS telemetry and Hub are disabled. Practice completion and feedback are user reports, without an inferred progress score.

## Workflow

1. **Matches:** account settings, hero/result filters and match selection.
2. **Review:** synchronized time window, economy chart, event timeline and coordinates. **Ask coach** prepares an unsent conversation draft.
3. **Knowledge:** import readable subtitles/text, link notes to source records, inspect patch applicability, and search long-term memory.
4. **Training:** saving a grounded review atomically creates its single trigger → action → check goal. Record the next game's execution and revisit previous reviews.

Source plugins are optional. `dota_source fetch` dispatches installed subtitle/forum tools through DSH. `import` works without them. Titles, source IDs and comments alone cannot support a factual note.

## Evidence limits

OpenDota supplies match events and statistics; replay extraction supplies entity positions and ward lifecycle observations. Missing data is explicit. Alignment requires matching building identities, at least three anchors, ≥60% matches and ≤2 seconds residual by default. Failed alignment never falls back to zero offset.

Only identified main heroes enter spatial analysis. Nearby wards and teammate distance do not establish visibility or death causation. Unknown ward expiry stays unknown. A replay 404 establishes current unavailability, not a fixed retention policy.

## Development

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm exec playwright install chromium
pnpm test:ui
cd packages/coach/go
go test ./...
cd ../../..
pnpm pack:release
```

Builds use published SDK declarations and need no local DSH checkout. Optional `pnpm exec tsx scripts/semantic-smoke.ts` downloads the multilingual model and verifies local semantic retrieval. Daily tests use synthetic fixtures.

Legacy Markdown/JSONL is backed up before an idempotent migration and remains unverified until supported. SQLite owns new records; Markdown is an export format. See the [Chinese guide](../README.md), [architecture](architecture.zh-CN.md), [contributing guide](../CONTRIBUTING.md), and [third-party notices](../packages/coach/NOTICE).

MIT © Hao Qian. Dependencies and match data retain their own terms.
