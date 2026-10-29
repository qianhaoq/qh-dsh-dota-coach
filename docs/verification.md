# Verification

Release baseline: Node 24.22.1 and the published DSH 0.2.1-rc.3 SDK/CLI. The Go toolchain is 1.27.3. No local DSH source checkout is used by build or acceptance scripts.

- `pnpm check`: strict Host and Client type checking; 22 tests covering real Cordis/Tools/Skill/Typert registration and reload, schema validation, Native/PTC value transport, real MemOS worker/model route, evidence storage and migrations, HTTP failures, task cancellation, calibration and entity filtering. The PTC unit test uses a fixture runtime to isolate transport; it does not claim a full production sandbox test.
- `go test ./...`: entity identity classification and dem/bz2/zstd container handling, corruption and size limits.
- `pnpm test:ui`: four browser flows against the actual React panel and domain service, using synthetic OpenDota/trace fixtures. Covers empty states, unavailable replay/source provider, synchronized window, review → one goal → checkin, source import/read and host English/Chinese dictionaries.
- `scripts/installed-smoke.ts`: installs the actual platform archive through the public DSH CLI into a new profile, invokes shipped tools and MemOS, reloads, and parses the handcrafted Stop demo with the shipped binary.
- `scripts/host-browser-smoke.ts`: launches that new DSH profile through the public CLI. Tests sidebar navigation, client factory, generated Typert Remote and retrieval of the same SQLite source in the full host UI, with no account or model credentials.
- Optional material smoke: an installed source plugin fetched a real public teaching post through normal DSH tool dispatch; the coach saved its readable body, original URL and content hash. Material stayed in a temporary database.
- Optional live smoke: a real public parsed match and its replay were downloaded, checked, decompressed, parsed and aligned on Linux. A separate user-provided local demo was also parsed. Same-building alignment matched 20 anchors, with a maximum residual below 0.47 seconds. No full demo, match identity or user material is in Git or release archives.
- Optional local vector smoke: a downloaded multilingual local model retrieved a Chinese movement rule from a paraphrased question. Daily CI does not download model weights or call paid models. Its model bridge test uses a deterministic provider.

[GitHub CI](https://github.com/qianhaoq/qh-dsh-dota-coach/actions/workflows/ci.yml) repeats build, tests, packaging and fresh installation on Linux x64, Windows x64 and macOS arm64/x64. A manual `live_match_id` input enables real replay acceptance on all four targets. Ordinary CI relies on redistributable fixtures, so replay retention does not make daily builds fail.

Limits: external source plugins and model services remain optional runtime dependencies. Their availability, public API quotas, replay retention and patch applicability are not guaranteed. Generated experience remains a candidate even when MemOS assigns a ranking score. Neither tests nor user checkins establish improvement in playing strength.
