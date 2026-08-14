# Token消费器

监控 DeepSeek API 消耗与余额的 Windows 桌面应用：常驻悬浮小窗 + 完整仪表盘。

## 快速开始

1. 安装依赖并启动：

   ```text
   npm install
   npm start
   ```

2. 首次启动前，把你的 API Key 写入 `data/config.json`（参考下文格式），或在仪表盘
   「设置」里填写。

3. 把你常用的客户端（ChatBox、Cherry Studio、Claude Code 等）的 Base URL 指向：

   ```text
   http://127.0.0.1:8787
   ```

   之后所有调用都会实时出现在本应用里。

## 功能

- 本地反向代理：自动给请求注入 `stream_options.include_usage`，从响应中解析 token 用量
- 按 DeepSeek 官方价目计算金额（含缓存命中/未命中，2026-08-17 起峰谷定价）
- 余额轮询：官方 `/user/balance` 接口，显示总余额/充值余额
- 估算剩余 token：余额 ÷ 近期每 token 平均成本
- 悬浮小窗：置顶、可拖动、双击打开仪表盘
- 仪表盘：今日/本月统计、近 7 天图表、按模型分解、请求明细、设置

## 数据与安全

- API Key 仅存于 `data/config.json`，该目录已被 `.gitignore` 忽略
- 消耗日志存于 `data/usage.jsonl`，余额快照存于 `data/state.json`
