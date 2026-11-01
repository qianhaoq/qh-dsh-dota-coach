# DSH Dota coach

An evidence-based post-match coaching plugin: choose a match, review a decision window, study source material, save one practice goal, and revisit it after the next game.

The immersive Coach / Journal workspace keeps the map, questions, explanations and practice card inside the plugin. DSH owns model routing and credentials. Existing material management and the original advanced tools remain available.

## Install

Requires Node ≥24.9 and the tested DSH baseline 0.2.1-rc.3. Download the platform `.tgz` and verify `SHA256SUMS` from [Releases](https://github.com/qianhaoq/qh-dsh-dota-coach/releases), then run:

```sh
dsh plugin --profile web add ./qh-dsh-dota-coach-0.6.3-linux-x64.tgz
```

Targets: Linux x64, Windows x64, macOS arm64 and macOS x64 (`darwin` in filenames). Packages include built code, runtime dependencies and the native replay extractor. End users do not need Go, a database server or system decompression tools.

Open **Dota coach** in the DSH sidebar. Configure an OpenDota account ID or enter a match ID. No personal account is preset. Data lives in `$DSH_HOME/dota-coach`, defaulting to `~/.dsh/dota-coach`; uninstalling leaves it intact.

If the package is installed but the sidebar entry is missing, check the active profile's `package.json`: `dsh.profile.bundles` must include `@qianhaoq/dsh-dota-coach` as well as the dependency being installed. Restart DSH after restoring activation. Personal account settings can be saved in the panel or configured through the profile's `cordis.patch.yml`.

The old prototype could report `Invalid schema for function 'dota_coach_note'` because it submitted a parameter map as raw JSON Schema, treating the `title` parameter as a schema annotation. The current version uses DSH's `defineTool` to put it under `parameters.properties`. Confirm the updated package is loaded, then call `dota_status` in the original conversation. Historical failure records remain visible.

## Knowledge and learning

The plugin embeds the public MemOS Local 2.0.21 MemoryCore API in an owned worker. SQLite holds original material, locators, hashes, evidence, revision history, reviews and practice checkins. A durable queue projects these records into MemOS; local multilingual embeddings enable semantic retrieval. First indexing may download a model; offline model paths are supported.

`dota_memory learn` uses the owning DSH conversation's configured model to induce candidate experience from a saved review. Repeated learning from one review does not increase support. Higher-level induction requires three independent reviews. Generated policies and skills remain **unverified candidates**, never automatically verified facts or host instructions.

Storage and embeddings run locally. Learning prompts go through the configured DSH model, which may be cloud-hosted. MemOS telemetry and Hub are disabled. Practice completion and feedback are user reports, without an inferred progress score.

## Workflow

1. **Choose a match:** paste an ID/link or select a recent game; identify your hero if no account is configured.
2. **Revisit:** prepare evidence automatically and discuss up to three moments, starting with a question before the outcome.
3. **Understand:** answer in your own words or choose an intention; inspect evidence, alternatives and uncertainty. All-vision exploration becomes available after answering.
4. **Practice:** edit and save one trigger → action → check goal for five games. Games without an opportunity do not count as failures.
5. **Journal:** restore progress after refresh and revisit completed moments. Library & tools retains the original source and knowledge workflows.

Source plugins are optional. `dota_source fetch` dispatches installed subtitle/forum tools through DSH. `import` works without them. Titles, source IDs and comments alone cannot support a factual note.

## Evidence limits

OpenDota supplies match events and statistics; replay extraction supplies entity positions and ward lifecycle observations. Missing data is explicit. Alignment requires matching building identities, at least three anchors, ≥60% matches and ≤2 seconds residual by default. Failed alignment never falls back to zero offset.

The v3 extractor adds a native, pause-adjusted server clock, approximately 250ms state samples, HP/mana, inventory slots, skill levels and remaining cooldowns, control flags, combat events and ward lifecycle. Compressed 15-second windows bound scene reads.

Continuous unit visibility is absent from some real replays. Combat-event visibility alone is not promoted to continuous unit visibility or last-seen positions. Unobserved enemies remain unknown. The bundled 7.40 map is explicitly a reference, not a terrain-vision or player-attention reconstruction. Cooldown readiness does not establish castability.

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
