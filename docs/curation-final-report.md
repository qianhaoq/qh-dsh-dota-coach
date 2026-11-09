# t284s1445 人类策展闭环

完成本地真实候选 → active principle → dota_kb export → 薄站实际文件导入。人类批准来源为本次指令转述的钱浩 / Grok Bot 卡片 t284s1445；未伪造新的人类评审或模型运行。

## 策展及持久化

原候选 `6672ed86-7b16-4988-8f77-d914fd3f56bc` 的正文保留在本地原记录，未改写或公开。以其同一 source_record_id 创建修订短摘要的 ontology candidate，再由真实注册的 dota_kb promote 晋升 active Principle。执行使用历史数据库的持久副本 `evidence/curation-run-1794187145506/coach.sqlite`；这不是内存 mock，也未覆盖历史验收数据库。完整工具调用、负例、事件及重开验证在该目录 trace.json。未运行新模型，作者建议仍为 material_linked_not_independently_verified。

reviewer=钱浩（经 Grok Bot 卡片 t284s1445）；decision=approve_version_independent。rationale=按批准的修订短摘要晋升版本无关原则，保留历史作者建议、署名、原链接及适用边界，不公开旧长正文/数值。记录时间为 `2026-11-09T09:19:05+08:00`，timezone=Asia/Shanghai；这是本地记录批准的时间，卡片原始批准的精确时刻未另行读取或推定。精确结构化元数据以 curation-demo-summary.json 为准，亦提交于 coach/docs/curation-t284s1445.json。

宿主仅为精确晋升 payload 授权；模型提供 reviewer 文本不能自行批准，修改 payload 后授权不适用。学习专用工具策略仍拒绝晋升。策展信息进入本体文档和 append-only human_curated_promotion 事件；公开导出不包含 reviewer 或内部候选/源记录 ID。

## 公开条目与消费

原链接：https://steamcommunity.com/sharedfiles/filedetails/?id=827490913
作者：✪还能一起看海吗；hong yu（Steam Community），依据已保存原页面 Created by 区域。

公开摘要：拉野前检查兵线、营地、双方位置、核心安全、塔压与敌方视野，并与队友协调；敌兵已进己塔时，先重新评估是否应离线拉野。

适用边界：历史作者建议；版本无关的局势检查原则。须按当前兵线、营地与安全条件判断，不构成具体补丁或具体对局的有效性验证。

实际导出 `evidence/curation-snapshot.json` 与提交的 site/data/site-knowledge.v1.json 相同。公开条目 `kb-028d66b81456e3720aaea63a`，kind=principle，patch=unknown，applicability_scope=version_independent。本体 ID、来源 SHA256 与完整元数据见 curation-demo-summary.json。无旧长正文、长引文或旧数值，未标 7.41f / patch60。

正常 export 校验来源 hash、公开链接与策展状态。schema @1 仅增加可选署名/适用性字段；声明 version_independent 时强制 principle + unknown + attribution + boundary。消费者显示署名与边界，引用 patch 仍是 unknown。新增回归用实际导出文件验证 null / 60 / 7.41f / 其他版本均可引用原则；这些引用不改对局结论。unknown fact、具体 patch 后缀精确匹配与 hero 守卫仍通过原回归。本体 recall 同时验证 role/phase 和 version_independent 结果，get 也不会报告 exact。

## 验证与演示

从工作区根运行：

```sh
node --import ./coach/node_modules/tsx/dist/loader.mjs evidence/curation-demo.mts
# 重新执行会创建新的独立数据库与 ID；需显式复制新导出才会更新薄站
```

从 coach 运行 `COREPACK_HOME=/tmp/ontology-corepack pnpm check`：81/81，host/client 类型与构建通过。新增测试覆盖宿主授权、payload 绑定、持久事件、公开字段隔离、版本无关召回及错误阶段排除。`PLAYWRIGHT_BROWSERS_PATH=/tmp/ontology-cache/ms-playwright COREPACK_HOME=/tmp/ontology-corepack pnpm test:ui`：7/7。Go 全量通过。

从 site 运行 `npm test`：100 文件 / 1450 测试通过；`npx tsc --noEmit`、review-engine 类型、`npm run build`、`node --check server.js` 通过。实际 export 用 parseSiteKnowledge 导入通过，见 curation-consumer-validation.log。无布局修改，不刷新视觉阈值。保留首次 schema strictRequired 失败与浏览器缓存路径失败的事实；修正 schema 定义并使用既有 Chromium 后重跑全绿，未弱化断言。

日志：curation-coach-check.log、curation-site-test.log、curation-ui-retry.log、curation-go-test.log；类型/构建工具成功退出另见执行记录。

## 仍未完成

三局有效性仍 FAIL/incomplete；完整架构部署、公开 agent endpoint、自动历史回填、向量检索未做。dsh 产品 pin 保持唯一 0.2.1-rc.3。未读凭证、未部署、未合入、未添加 qa-passed、未碰 #115。两个既有 PR 保持 draft + no-auto-merge；远端 CI 状态不伪称通过。
