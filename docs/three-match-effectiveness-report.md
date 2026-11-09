# 三局内容有效性复测（2026-11-09，Asia/Shanghai）

结论：**FAIL / incomplete**。LS 部分；Morph 未答；Enigma 未答。事实校验、测试和渲染 PASS 不等于核心问题已回答，也不证明胜率收益。

## 真实数据与前后对照

本轮只读 GET OpenDota 三局，均 HTTP 200。精确时间、version/od_data 见 `three-match-effectiveness-fetch.json`；原始响应为 `three-match-effectiveness-raw-*.json`。未提交任何 parse job，未花新 parse/模型预算、未读凭证。Morph 由上游自行从旧快照未解析变为 version22，不归功于本轮代码。Enigma 仍 has_parsed=false。

`three-match-effectiveness-results.json` 包含双语旧快照状态、**同一份新输入**在 site 1b102f9 和本轮实现上的正文对照及 followup 结果。原始数据 SHA256、schema/来源计算/边界断言见该 JSON 和 `three-match-effectiveness-verify.mjs`。逐局 before/after/followups JSON 全部落盘；保留既有 after/fresh-after，不覆盖它们。

| 对局 | 原社区核心问题 | 判定 | 可核事实及仍缺内容 |
|---|---|---|---|
| LS 9079097889 / 54 | 对线、出装、早打还是刷 | 部分 | 10分钟44CS、前10分钟0死；10分钟团队经济差−921，不是个人经济。辉耀18:51、双刀27:39、否决32:44是首次购买，非送达/使用。补入个人10–20分钟发育记录和对线生存事实，但无逐时位置、兵线、视野、资源机会和合规版本出装基准，不能评兵线控制、出装优劣或12–24分钟刷打取舍。44CS/921伪及格线保持撤销。末段最差经济窗仍仅为回看候选。|
| Morph 9080780642 / 10 | 怎么刷更快 | 未答 | 本轮真实上游已解析。10分钟45CS、前10分钟1死；10–20分钟补刀45→142（+97）、累计经济2912→7797（+4885）、经验2682→7838（+5156）；累计经济非净资产。幻影斧23:21是购买记录。新 followup 只给个人发育观察和复查范围；没有兵线/营地可用性、逐时移动及资源替代方案，不能定位刷钱瓶颈或建议最优路线。解析可用不代表核心需求已答。|
| Enigma 9077301945 / 33 | 是否该彻底弃线 | 未答 | 仍未解析。终局KDA2/13/12、120补刀、323GPM、322XPM、9230净资产可核。现有 availableSummary 保持单张终局摘要，明确刷钱/弃线/刷打未答，不伪造CS10、购买或死亡时间轴。缺兵线、敌我位置、营地争夺、可替代资源与死亡事件，不能确定弃线时间或最优决策。|

OpenDota 的 lane_pos 为聚合热图（解析局存在），不是逐时位置/视野/兵线证据；不将其当作刷打、刷钱路线因果依据。对 Enigma 不用拉野原则回答弃线。没有已授权、可验证不消耗新预算的 parse 提交路径；现有提交器会消费 parse budget，因此未触发，也未无界等待。

## 实现

- site review-engine：next_game 增补前10分钟死亡事实和不能据此评价对线的边界；首次购买明确非送达/使用、非最优出装/早打结论。保留无基准、无数值训练目标。
- 可选 preset `farm_progress`：个人10–20分钟补刀/累计经济/经验的端点与增量，仅在有限、非负、单调端点存在时输出。明确不识别瓶颈或最优路线；未解析局即使残留字段也不暴露。补入幻影斧/迈达斯首次购买识别，未推断该买与否。
- version_independent 知识需 `kbContextIds` 显式选择才附于对局，默认不以跨版本适用性代替问题相关性；实际策展文件仍可导入并显式引用署名与边界。三局默认无拉野原则引用。没有改变原则本身、导出边界或 dsh pin。
- UI 仅避免把新增对线死亡数重复显示成无标签数字 chip；中英文文案与原截图更新。视觉阈值保持 0.01，没有改配置或放宽断言。
- availableSummary 已足够诚实，本轮未改其逻辑。coach 无运行时代码改动，仅同步本报告。

## 验证（最终输出补记于下）

site 全量测试1452/1452（100文件）；coach 全量81/81，类型及构建通过；coach浏览器7/7；Go全量通过（GOCACHE=/tmp/three-match-go-cache）。初次Go默认缓存受只读权限阻塞，改缓存路径后通过，没有扩权。

site 类型、engine 类型、构建和 server.js 语法检查通过，只有既有bundle体积提示。三局事实/schema/双语边界校验通过；12次三局中英/390与1280渲染检查通过。视觉更新前2项截图因新增文案变化失败；刷新实际图后以原阈值重跑。既有6项跨项目不适用skip保持原样，没有新增skip。

初次全量2项旧断言失败：next_game 现在引用对线死亡，来源应包含 kills_log；精确正文应包含新增边界。保留精确断言并补全期望，不删除检查、不修改gold fixture、不放宽阈值。独立既有回归与新负例一起通过；不声称已经独立QA批准。

## 发布边界

仍不能宣称三局有效性通过。保持既有两个PR draft + no-auto-merge，autoMergeRequest=null；不部署、不合入、不贴qa-passed、不碰#115、不读取凭证。远端CI不冒称通过。策展/导出/P1既有成果与本轮内容有效性分别判断。

最终视觉结果：site `npm run test:e2e` 6 passed / 6 existing project-inapplicable skipped；刷新后原0.01阈值重跑通过。新增文案影响4张既有截图；无阈值/测试配置改动。三局12次渲染检查在最终代码上再次通过。

同输入复现基线：先将 `git -C site archive 1b102f9 packages/review-engine` 解压到 `/tmp/three-match-effectiveness-before`，令该目录 node_modules 指向 site/node_modules，再执行 `node evidence/three-match-effectiveness-verify.mjs`。本轮网络请求仅为记录中的3次GET，复现无需再次请求。baseline不包含本轮改变，避免把Morph上游解析变化错算为代码收益。
