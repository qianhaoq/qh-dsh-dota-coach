# Verification

## 0.2.1 acceptance

- Guided sessions: duplicate starts, pre-question information boundaries, validated citations, persisted answers, reload, one atomic goal, no-opportunity checkins, and native-event fallback for an unparsed upstream match.
- Deterministic guards reject foreign evidence IDs, event-time contradictions, and cooldown assertions while controlled. These checks do not prove all free-text tactical reasoning correct.
- Go tests cover native server-clock offset, pause freezing, missing values and current game-schema control flags.
- A local real replay produced 110,620 state rows, 105,570 combat events and 619,472 known ability-cooldown samples. All 80 OpenDota death-log observations matched native events within the API’s one-second precision; the largest difference was 0.800 seconds.
- An independent raw-field probe at demo tick 10020 / server tick 10536 expected game time 108.89998 and Static Link cooldown 31.00018. The nearest state sample was 66.7ms earlier and preserved the cooldown to float precision. This is a parser cross-check, not full in-client visual ground truth.
- This replay had zero continuous unit-visibility samples. Enemy positions remain unknown in the team scene; combat-event visibility is not used to invent last-seen unit positions. Exact fog, player attention and every patch’s terrain are not reconstructed.
- Real recordings, match identity and private verification artifacts stay outside the release.

Release baseline: Node 24.22.1 and the published DSH 0.2.1-rc.3 SDK/CLI. The Go toolchain is 1.27.3. No local DSH source checkout is used by build or acceptance scripts.

- `pnpm check`: strict Host and Client type checking; 33 tests covering real Cordis/Tools/Skill/Typert registration and reload, schema validation, Native/PTC value transport, real MemOS worker/model route, evidence storage and migrations, HTTP failures, task cancellation, calibration and entity filtering. The model-facing registry schemas keep `title` under `properties` before and after reload, accept a titled evidence-linked note, and reject a numeric title. Source dispatch tests cover the published single-call executor and the batch interface found in later source builds, including policy denial and deferred context. The PTC unit test uses a fixture runtime to isolate transport; it does not claim a full production sandbox test.
- `go test ./...`: entity identity classification and dem/bz2/zstd container handling, corruption and size limits.
- `pnpm test:ui`: legacy browser flows plus the new guided-review flow against the actual React panel and domain service, using synthetic OpenDota/trace fixtures. Covers empty states, unavailable replay/source provider, synchronized window, review → one goal → checkin, source import/read and host English/Chinese dictionaries.
- `scripts/installed-smoke.ts`: installs the actual platform archive through the public DSH CLI into a new profile, invokes shipped tools and MemOS, reloads, and parses the handcrafted Stop demo with the shipped binary.
- `scripts/host-browser-smoke.ts`: launches that new DSH profile through the public CLI. Tests sidebar navigation, client factory, generated Typert Remote and retrieval of the same SQLite source in the full host UI, with no account or model credentials.
- Optional material smoke: an installed source plugin fetched a real public teaching post through normal DSH tool dispatch; the coach saved its readable body, original URL and content hash. Material stayed in a temporary database.
- Optional live smoke: a real public parsed match and its replay were downloaded, checked, decompressed, parsed and aligned on Linux. A separate user-provided local demo was also parsed. Same-building alignment matched 20 anchors, with a maximum residual below 0.47 seconds. No full demo, match identity or user material is in Git or release archives.
- Optional local vector smoke: a downloaded multilingual local model retrieved a Chinese movement rule from a paraphrased question. Daily CI does not download model weights or call paid models. Its model bridge test uses a deterministic provider.
- Memory lifecycle assertions require healthy initialization, the configured multilingual model name and the same learned trace after a worker reload, without another model call.

[GitHub CI](https://github.com/qianhaoq/qh-dsh-dota-coach/actions/workflows/ci.yml) repeats build, tests, packaging and fresh installation on Linux x64, Windows x64 and macOS arm64/x64. A manual `live_match_id` input enables real replay acceptance on all four targets. Ordinary CI relies on redistributable fixtures, so replay retention does not make daily builds fail.

Limits: external source plugins and model services remain optional runtime dependencies. Their availability, public API quotas, replay retention and patch applicability are not guaranteed. Generated experience remains a candidate even when MemOS assigns a ranking score. Neither tests nor user checkins establish improvement in playing strength.

### 0.3.0 phase reports

- The default panel now uses full-match reports. Phase boundaries follow match duration, with shorter navigation intervals for Turbo; a match ending at a boundary does not create an empty later phase.
- Focus, risk preference, detail and optional player intention are persisted. Observed actions and measured outcomes are produced from replay/API records, independently of model prose. Alternative outcomes remain conditional.
- Domain tests cover coverage boundaries, unavailable/stale economy curves, diverse decisions, malformed/foreign citations, persistence across service reload, preference-specific identity, ready-stage reuse and idempotent practice saves. The original schema and guided-review regressions remain in the suite.
- Browser acceptance uses the real React client and fixture service; production acceptance uses the installed archive in DSH. Fixture model prose is acceptance data, never shipped as production coaching.
- In the local desktop installation, `dsh-web.service` owns the existing localhost-only web command and restarts it on failure. This is an environment repair, not an additional server packaged with the plugin.

### 0.4.1 complete-report conversation acceptance

- `pnpm check`: 39 tests pass. The report lifecycle test also covers opening a cached report without another analysis call, idempotent conversation submissions, exact-timestamp scene retrieval, reply persistence across restart, and foreign-citation failure isolated from the report.
- The final Linux archive passes a clean public-CLI DSH installation, shipped MemOS worker/reload/extractor acceptance, and archive/binary checksum verification.
- Manual browser acceptance through CUA covers ID input → automatic analysis → completed conclusions, focused discussion, answer/citation rendering, draft clearing, refresh restoration and unique conversation/practice panels. At a 375px viewport the conversation has no horizontal overflow. The browser regression spec also checks that changing context leaves exactly one composer.
- In the actual local DSH installation, a real four-phase, twelve-moment review remained cached when opened and questioned. A timestamp follow-up fetched its own player-side resource/control snapshot, returned validated evidence IDs, and survived refresh. Original notes and the previous guided review remain present; the profile's coach configuration is unchanged.
- Proof screenshots are local test artifacts, not bundled production assets. No live match identity, player material, account configuration or credentials are included in the release.

### 0.5.0 compact reading acceptance

- `pnpm check`: strict Host/Client checks and all 41 tests pass. New regressions preserve complete sentences, conditions, negations and decimal values in previews. Invalid or oversized optional answer summaries fall back without failing the answer or making another model call.
- The Linux release passes clean public-CLI installation, shipped MemOS/reload/extractor smoke and archive/binary checksum verification.
- Manual CUA acceptance covers independent card tabs, keyboard tab navigation, one shared detail region, full advice, replay and contextual AI discussion. Stage summaries and practice are collapsed initially; old long answers expand without regeneration. Browser regression specifications were updated; the automated browser suite was not run in this acceptance.
- In the actual installed DSH, a cached four-stage/twelve-moment review opens directly in the new cards. A real follow-up renders one conclusion, two action points and a short caveat. The original report is byte-for-byte unchanged as parsed JSON; all 20 notes and coach configuration remain unchanged. At 375px the app has no horizontal overflow and exactly one composer. The viewport override was reset after checking.
- Local proof images: `test-results/dota-coach-v050-cards.png` and `test-results/dota-coach-v050-answer.png`.

### 0.6.3 A2UI acceptance

- `pnpm check`: strict Host/Client checks and all 47 tests pass. A2UI tests reject unknown components, foreign record references, missing/cyclic/duplicate trees, unsafe data paths and actions that do not belong to their issuing component. Presentation-only repair is bounded and preserves the existing report; invalid optional reply UI preserves the answer without an extra analysis call. The Host registry test includes the presentation action.
- The final Linux archive passes clean public-CLI installation, shipped MemOS/reload/extractor smoke and archive/binary checksum verification.
- Manual CUA acceptance uses real React surfaces, including model-selected components, opening replay/choice/evidence/match views, event-time seeking, match scoreboards and persistent follow-up surfaces after refresh. The browser regression specification was updated; its automated runner was not used for this acceptance.
- In the actual installed DSH, the configured model composed four A2UI surfaces for the cached review. The original report including generation timestamp remains unchanged, along with all 20 notes and the coach configuration. Native replay events can be clicked to seek their time; the pre-decision snapshot remains explicitly labelled separately from later events. At 375px the inspector has no horizontal overflow. Temporary viewport overrides are reset after checking.
- A real timestamp follow-up persisted ReplayClip, ResourceSnapshot and EvidenceList components. Opening its requested-time evidence shows 26 available mana versus a 75-mana prerequisite, with localized resource explanations and full raw records available on demand. Local proof images: `test-results/dota-coach-v063-replay.png` and `test-results/dota-coach-v063-evidence.png`.
- This is a custom A2UI v0.9.1 catalog and batched DSH transport, not a general Basic Catalog renderer or streaming partial JSON. The player displays a 2D reconstruction from native replay records. See [protocol scope](a2ui.md).
