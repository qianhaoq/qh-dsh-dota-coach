# DSH Dota coach

Evidence-linked Dota 2 post-match coaching with local MemOS knowledge, replay extraction, and four embedded DSH tabs. DSH owns the conversation and model credentials.

需要 Node ≥24.9 和 DSH 0.2.1-rc.3。安装匹配平台的包：

```sh
dsh plugin --profile web add ./qh-dsh-dota-coach-0.1.0-linux-x64.tgz
```

Open **Dota coach / Dota 教练** in the DSH sidebar. Enter an OpenDota account ID or a match ID. Runtime dependencies and the platform extractor are included; no Go build or database service is required. Data defaults to `$DSH_HOME/dota-coach` (`~/.dsh/dota-coach`).

Local storage and multilingual embeddings use MemOS Local's public core. First semantic indexing may download a model. Learning uses the owning DSH model, which may be cloud-hosted. Generated experience remains unverified. Telemetry and Hub are disabled.

中文说明、English guide、源码、配置与验证：[project repository](https://github.com/qianhaoq/qh-dsh-dota-coach)。

MIT © Hao Qian. Dependencies retain their own terms; see NOTICE.
