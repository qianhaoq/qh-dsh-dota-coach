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
