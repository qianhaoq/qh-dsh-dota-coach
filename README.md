# DSH Dota coach

[English](docs/README.en.md)

一个面向赛后教学的 DSH 插件：选择比赛，围绕证据复盘，学习相关材料，保存一个训练目标，并在下一局回看。

对话工具和四页内嵌面板使用同一组领域服务。DSH 负责会话和模型；插件没有独立聊天服务、第二套模型密钥或云端账号。

## 知识积累与学习

知识层使用 **MemOS Local 2.0.21 公共 MemoryCore**，包含本地多语言向量检索、全文检索和经验归纳。它运行在插件拥有的 worker 中，避免共享其他 MemOS 插件的全局模型桥或数据目录。未调用旧版 DSH 适配器，未复制其他插件内部代码。

- SQLite 保存材料原文、定位、内容哈希、比赛证据、知识修订、复盘和训练执行记录。
- 持久化索引队列把记录投影到 MemOS。长材料分块；索引失败不丢失已保存的证据，重试可恢复。
- 语义向量由本地多语言模型生成。第一次更新索引会下载模型；可配置离线模型目录。
- `dota_memory learn` 根据已保存复盘，调用当前 DSH 会话的模型归纳经验。需要至少三个独立复盘才进入上层归纳；重复提交同一复盘不会增加支持次数。
- 机器归纳的策略和技能始终作为**候选经验**展示。原文引用、版本适用性和反例需要由教练复核；它们不会自动成为事实或宿主指令。
- 反馈和完成状态标为用户自报，不生成成长分。知识修订保留旧记录与 `supersedes` 关系。

存储与向量计算在本机。归纳时，相关材料会交给用户在 DSH 中配置的模型处理；该模型可能运行于云端。MemOS 遥测和 Hub 均关闭。

## 安装

需要 Node **≥24.9** 和 DSH **0.2.1-rc.3**。兼容声明只覆盖验证基线。

从 [Releases](https://github.com/qianhaoq/qh-dsh-dota-coach/releases) 下载对应平台的插件包及 `SHA256SUMS`，核对校验和后安装：

```sh
dsh plugin --profile web add ./qh-dsh-dota-coach-0.1.0-linux-x64.tgz
```

支持目标：Linux x64、Windows x64、macOS arm64 和 macOS x64。平台包自带构建产物、运行依赖和 Go 提取器；普通使用不需要 Go、数据库服务、系统 bz2/zstd 工具或源码编译。macOS 的平台标识为 `darwin`。

在 DSH 左侧打开“Dota 教练”。可设置 OpenDota account ID，也可以直接输入比赛 ID。默认账号为空。普通字段在配置修改后随插件重载生效。

本地数据默认位于 `$DSH_HOME/dota-coach`；未设置 `DSH_HOME` 时使用 `~/.dsh/dota-coach`。卸载插件不会删除这份数据。

## 使用闭环

1. **对局**：设置账号，按英雄和胜负筛选，选择一场比赛。
2. **复盘**：选择时间窗，查看经济差、事件和战场坐标；“问教练”打开会话草稿，由用户发送。
3. **知识库**：导入字幕/正文，保存带原文引用的知识，或者检索长期记忆。没有取材插件也能导入材料。
4. **训练**：保存复盘时同时创建唯一训练目标；下一局记录执行情况，并查看历史复盘。

知识应按“长期原理 / 版本事实 / 待验证反例”区分。补丁未知时会显示适用性未知；传入 `current_patch` 后可标出不匹配的事实。标题、来源 ID 和评论不能单独支持知识结论。

## 工具

| 工具                           | 用途                                                           |
| ------------------------------ | -------------------------------------------------------------- |
| `dota_status`                  | 本机状态、账号、限速策略、提取器、取材插件和待索引数量         |
| `dota_matches` / `dota_match`  | 比赛列表与单场证据                                             |
| `dota_timeline` / `dota_parse` | 窗口事件、校准和实体轨迹                                       |
| `dota_hero`                    | 带采集时间的公开英雄统计；不推断克制原因                       |
| `dota_replay`                  | 下载、校验、解压、检查、列出和删除录像                         |
| `dota_source`                  | `fetch/import/list/get`：正文、定位和哈希                      |
| `dota_coach_note`              | `append/list/search/get/recheck/revise`：证据关联知识与修订    |
| `dota_review`                  | `save/list/get`：窗口、学员解释、证据和唯一训练规则            |
| `dota_training`                | `create/get/list/update/checkin`：目标与用户自报执行情况       |
| `dota_memory`                  | `search/get/status/reindex/learn/feedback`：长期检索与候选经验 |

`dota_source fetch` 通过 DSH 正常工具调度调用已安装的 `bili_subtitle`、`yt_subtitle`、`forum_fetch` 或 `reddit_json`。缺少插件、正文不可读、只返回标题或评论时会明确报错，可改用 `import`。来源内容始终作为材料处理。

工具输出超过预算会保存为本地 JSON 并返回文件指针。`dota_source get` 支持 `offset/max_chars` 分段读取，原始内容哈希保持不变。

## 证据范围

OpenDota 提供事件、装备、经济和统计；录像轨迹提供实体位置与眼位创建/删除记录。未解析比赛和缺失字段会明确标记。OpenDota 请求使用缓存、并发合并和可配置限速，尊重响应头和 `Retry-After`；本地策略不代表永久 API 额度。

时间校准按相同建筑标识配对，默认至少 3 个锚点、匹配率 ≥60%、残差 ≤2 秒。失败时保留比赛事件并停止空间合并。主英雄由 PlayerResource 选中实体句柄识别；复制体、分身和未知实体不进入主英雄空间推断。

附近眼位和队友距离只表示观察结果，不能证明真实可见性或死亡原因。没有删除记录的眼位生命周期保持未知。录像 404 只表示当前不可获取，不推断固定保留期。

## 配置与开发

完整配置定义见 [config.ts](packages/coach/src/config.ts)。常用项：`accountId`、`homeDir`、`opendotaApiKey`、`replayMaxBytes`、`downloadMaxBytes`、`decompressedMaxBytes`、`extractBin`、`parseTimeoutMs`、`memoryEmbeddingModel`、`memoryOffline`、`memoryModelPath`。

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

开发需要 Node ≥24.9、锁定的 pnpm 以及 Go。构建基于已发布的 SDK，无需 DSH 源码目录。Typert 生成器的工作区识别需要暂存一份**未修改的公开 SDK 声明文件**；这一步由 `scripts/generate.ts` 自动完成，暂存文件不进入 Git 或发布包。

可选联网验证：`pnpm exec tsx scripts/semantic-smoke.ts` 会下载本地模型并验证中文语义检索。完整录像与 OpenDota 发布前 smoke 使用 `DOTA_SMOKE_MATCH_ID=<公开且已解析的对局> pnpm test:smoke`；可额外设置 `DOTA_SMOKE_DEMO` 指向本地录像。日常 CI 仅使用自建脱敏 fixtures。手动工作流传入 `live_match_id` 可在四个平台验证真实下载和解析，录像不会作为构建产物上传。

旧 `library.md`、`principles.md` 和 `coach-log.jsonl` 首次启动时备份并导入；重复运行不重复记账，无法核实的内容标为待验证。SQLite 是新记录的权威存储，Markdown 是阅读与导出格式。

见 [架构与知识治理](docs/architecture.zh-CN.md)、[贡献指南](CONTRIBUTING.md)、[变更记录](CHANGELOG.md) 和 [第三方声明](packages/coach/NOTICE)。

MIT © Hao Qian。比赛数据和依赖仍适用各自来源条款。项目专注赛后教学。
