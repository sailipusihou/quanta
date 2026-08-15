# Spec: Quanta（桌面实时 Token/余额监控）

## Objective

做一款 Windows 桌面应用：用户通过本地代理使用 DeepSeek API 时，应用实时记录每次请求的
token 消耗与金额，并以「常驻悬浮小窗 + 完整仪表盘」两种形态展示：

- 当前正在消耗的平台与模型
- 本次/今日/本月消耗的 token 与金额
- 剩余充值金额（来自官方余额接口）与估算剩余 token

成功标准：

1. 把任意 OpenAI 兼容客户端的 Base URL 指向本地代理后，每次调用都会出现在仪表盘，
   实时刷新（< 2 秒）。
2. 余额接口每 60 秒轮询一次，悬浮窗与仪表盘上的剩余金额实时更新。
3. 金额按 DeepSeek 官方价目表计算（含缓存命中/未命中、2026-08-17 起峰谷定价）。
4. 悬浮小窗置顶、可拖动、可一键打开仪表盘；托盘常驻。
5. API Key 只存本地 `data/config.json`（git 忽略），不出现在代码/日志/提交中。

## 用户与场景

- 用户：个人开发者，主要使用 DeepSeek，采用单次充值金额方式。
- 场景：日常通过 ChatBox / Cherry Studio / CLI 等工具调用 DeepSeek，希望随时看到
  花了多少、还剩多少，避免余额耗尽时才发现。

## Tech Stack

- Electron（最新稳定版，无前端构建步骤）
- Node.js 内置 `http`/`https` 实现反向代理（无第三方运行时依赖）
- 纯 HTML/CSS/JS 渲染层，手绘 SVG 图表
- 存储：`data/usage.jsonl`（追加式事件日志）+ `data/state.json`（余额快照）
- 测试：Node 内置 `node --test`

## Commands

```text
启动（开发）: npm start
运行测试:     npm test
```

## Project Structure

```text
docs/SPEC.md          # 本规格（活文档）
README.md             # 使用说明
package.json
src/
  main.js             # Electron 主进程：窗口、托盘、IPC、生命周期
  preload.js          # contextBridge 安全桥
  server/
    config.js         # 配置读取/保存（data/config.json）
    pricing.js        # DeepSeek 价目表与费用计算（含峰谷定价）
    store.js          # 事件日志存储与聚合统计
    balance.js        # 官方余额接口轮询
    proxy.js          # 本地反向代理（OpenAI/Anthropic 兼容）
    index.js          # 服务装配：代理 + 轮询 + 事件总线
  renderer/
    dashboard.html/.css/.js
    widget.html/.css/.js
data/                 # 运行时数据（git 忽略）
tests/                # node:test 单元/集成测试
```

## Code Style

- CommonJS（Electron 主进程惯例），2 空格缩进，分号结尾。
- 模块只暴露职责明确的函数；事件通过 `EventEmitter` 或回调传递。
- UI 文案使用中文；数值金额统一 `¥` + 4 位小数以内的字符串格式化。

```js
// 示例：计价模块核心函数
function computeCost(model, usage, ts = Date.now()) {
  const rates = rateFor(model, ts); // 含峰谷/新老价目
  return {
    amount:
      (usage.cacheHit / 1e6) * rates.hit +
      (usage.cacheMiss / 1e6) * rates.miss +
      (usage.completion / 1e6) * rates.out,
    rates,
  };
}
```

## Testing Strategy

- `tests/pricing.test.js`：价目选择（老价格/新峰谷）、缓存拆分、未知模型兜底。
- `tests/store.test.js`：事件追加、按天/月/模型聚合、余额快照。
- `tests/proxy.test.js`：用本地 mock upstream 验证非流式/流式转发与用量记录。
- 覆盖率目标：核心逻辑（计价、存储、代理解析）关键路径 100% 覆盖。

## Boundaries

- Always：启动前检查配置存在；API Key 只读自配置文件；写入事件日志前校验字段。
- Ask first：新增第三方依赖、改动存储格式、改变端口/域名默认值。
- Never：把 API Key 写进代码或提交；删除用户数据；修改 DeepSeek 官方域名。

## Open Questions

- 是否需要接入除 DeepSeek 之外的第二家平台（架构已预留多 upstream）？
- 是否需要开机自启（设置页已提供开关）？
