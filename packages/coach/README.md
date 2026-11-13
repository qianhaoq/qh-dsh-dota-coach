# DSH Dota coach

Evidence-linked Dota 2 post-match coaching with local MemOS knowledge, replay extraction, and an immersive in-plugin Coach / Journal workspace. DSH owns the conversation and model credentials.

需要 Node ≥24.9 和 DSH 0.2.1-rc.3。安装匹配平台的包：

```sh
dsh plugin --profile web add ./qh-dsh-dota-coach-0.6.3-linux-x64.tgz
```

Open **Dota coach / Dota 教练** in the DSH sidebar. Enter an OpenDota account ID or a match ID. Runtime dependencies and the platform extractor are included; no Go build or database service is required. Data defaults to `$DSH_HOME/dota-coach` (`~/.dsh/dota-coach`).

`dota_kb search/get/status` reads local Markdown sections and SQLite/FTS notes: stable `principles.md`, versioned `library.md`, and optional `patch/<ver>/heroes/<hero>/*.md`. Only an empty `patch/` is scaffolded. Facts cite `[版本 · 日期 · 来源]`; missing stamps remain unverified and need rechecking. Search returns bounded snippets; `get` accepts an id or a relative path with an optional `#section` (and `offset/max_chars`). Optional Markdown metadata lines are `hero:`, `source_id:`, `source_record_id:` and `evidence_level:`. Use `dota_coach_note` for append/revise/recheck writes and OpenDota/local replay tools for match facts. DSH remains the base; a future thin site may read exports. Replays and cookies stay local.

Local storage and multilingual embeddings use MemOS Local's public core. First semantic indexing may download a model. Learning uses the owning DSH model, which may be cloud-hosted. Generated experience remains unverified. Telemetry and Hub are disabled.

中文说明、English guide、源码、配置与验证：[project repository](https://github.com/qianhaoq/qh-dsh-dota-coach)。

MIT © Hao Qian. Dependencies retain their own terms; see NOTICE.

### Native replay economy facts

`dota-extract` writes `trace/events.jsonl` with hero-involved combat events,
plus buyback, purchase, gold, XP, player stats, team building kills, and first
blood even when both hero flags are false. Creep-only damage remains filtered.
`attacker`, `target`, `inflictor`, and `value_name` resolve CombatLogNames;
for purchases, `target` is the buyer and `value_name` is the item. Numeric
`value` is preserved. Optional economy/building fields retain null when absent.
Event `t` remains combat timestamp minus game start time; negative pre-game
purchase times are valid. Missing death coordinates remain null.

`trace/metadata.jsonl` contains demo match metadata from each metadata callback,
with an explicit player-field allowlist (no Steam IDs, names, private metadata,
or cosmetics). It includes team/slot identifiers, net worth graph values,
camps stacked, item purchases, and inventory stat snapshots. These graphs and
snapshots are metadata observations, not combat-log exact times; their native
purchase/game times are preserved without applying the event clock formula.

Trace version 4 adds public `match_id` from `CDOTAMatchMetadataFile` to metadata
rows and the successful extraction summary (omitted when absent/zero; conflicting
IDs fail extraction). Player `hero_key` is the official `npc_dota_hero_*` unit key,
joined by `game_player_id` to PlayerResource's selected hero handle and UnitNames;
`hero_identity_source` records that join. Unresolved heroes have `hero_key: null`.
The match metadata player proto has no general hero ID; its ability-draft facet
ID is not used as the played hero's identity.

All entity trace `t` fields, including objectives, use the same pause-adjusted
server clock as tactical states. Unknown clock values are null. Combat `t` uses
the already pause-adjusted combat timestamp minus game start. The summary's
`clock` object records `name`, `unit`, `zero` (horn/game start), `pregame`,
`entity_formula`, `combat_formula`, `pause_handling`, `pause_observed`,
`total_paused_ticks`, and `game_end`. When rules are observed it also records
`tick_interval` and `game_start_time`. Unknown pause/end observations are null.
A known `game_end` contains `t`, `source`, and `target`, taken only from a fort
`DOTA_COMBATLOG_TEAM_BUILDING_KILL`; tower kills do not establish game end.
Native metadata graph, purchase, and snapshot times keep their original meaning.
