# Agent notes — qh-dsh-dota-coach

本仓是 **DeepSeek Harness（dsh）领域插件**（教练 / `dota_kb` / Match tools），不是 dota2.ai 薄站。

## dsh 版本钉（2026-11-04）

- **产品侧精确 pin** `@deepseek-ai/dsh*`（及同组 `@deepseek-ai/dsh-*`）= **`0.2.1-rc.3`**（以本仓已绿为准；**勿用 `^`**）。
- **升级**须与其它产品侧插件仓（bili / learn-tools 等）**同一轮 PR 齐升**；接受 RC 破兼容，升完跑本仓矩阵 CI + 本机 `dsh --profile` 冒烟。
- **薄站 `qianhaoq/dota2.ai` 不 pin dsh**（不宿主 harness）。

## Coding（本机 / box）

1. 优先 box Codex CLI（`gpt-6.1-sol`）。
2. Codex 不可用再 `coding glm`；前端/UI 用 `coding kimi`。
3. 不默认 Cursor Cloud Agent。

## 合入

CI 矩阵（linux-x64 / windows-x64 / darwin-arm64 / darwin-x64 / browser）齐绿即可 auto-merge / squash；P0/P1 必清。本仓不加产品仓那套 Codex/QA 理解门禁。
