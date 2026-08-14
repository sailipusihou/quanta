# Token消费器

监控 DeepSeek API 消耗与余额的 Windows 桌面应用：常驻悬浮小窗 + 完整仪表盘。

## 快速开始

### 给使用者（无需代码环境）

下载 `TokenConsumer-Setup-*.exe`（安装版）或 `TokenConsumer-Portable-*.exe`（便携版，双击即用）：

1. 打开软件，首次启动会弹出引导，填入你自己的 DeepSeek API Key 并点击「保存并验证」。
2. 看到剩余金额即表示连接成功。
3. 把你常用的客户端（ChatBox、Cherry Studio 等）的 Base URL 指向 `http://127.0.0.1:8787`，
   之后每次调用都会实时显示 token 消耗。

> 每个人填自己的 Key，数据只保存在自己电脑上，不需要任何服务器。

### 开发者模式

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
- 多平台账户：可添加多个平台账户（DeepSeek / OpenAI 兼容自定义），随时切换；
  余额接口与 JSON 路径可配置，适用于任何提供余额 API 的平台
- 充值记账：手动记录每次充值，自动统计充值总额与累计消耗估算
- 余额预警：低于设定阈值时桌面通知提醒，悬浮窗同步变红
- 数据导出：一键导出全部消耗记录为 CSV
- 估算剩余 token：余额 ÷ 近期每 token 平均成本
- 悬浮小窗：置顶、可拖动、双击打开仪表盘
- 仪表盘：今日/本月统计、7/30 天趋势图、按模型分解、充值记录、请求明细、设置
- 新用户引导：首次打开提示填写 API Key 并自动验证余额

## 数据与安全

- API Key 仅存于 `data/config.json`，该目录已被 `.gitignore` 忽略
- 消耗日志存于 `data/usage.jsonl`，余额快照存于 `data/state.json`
- 安装版数据保存在系统用户目录 `%APPDATA%\Token消费器\data`（每台电脑/每个用户独立）

## 打包分发

```text
npm run dist
```

产物在 `release/` 目录：

- `TokenConsumer-Setup-<版本>.exe`：安装版（可改安装目录、生成桌面快捷方式）
- `TokenConsumer-Portable-<版本>.exe`：便携版（解压即用，无需安装）

## 代码签名（消除 SmartScreen 警告）

未签名的安装包首次运行时 Windows SmartScreen 会提示"未知发布者"。消除它需要数字签名证书，有两种方式：

1. **OV/EV 代码签名证书**（约 ¥1000+/年，企业主体）：拿到 `.pfx` 证书后，用以下命令打包，会自动签名：

   ```text
   $env:CSC_LINK = "C:\path\to\cert.pfx"
   $env:CSC_KEY_PASSWORD = "证书密码"
   npm run dist
   ```

2. **Azure Trusted Signing**（约 ¥9.99/月，个人可办，无需 U 盾）：在 Azure 门户创建 Trusted Signing 账户后，在 `package.json` 的 `build.win` 里配置 `azureSignOptions`（endpoint、certificateProfileName、codeSigningAccountName），或使用 electron-builder 官方文档中的环境变量方式。

> 签名后还需要一段时间的下载量积累，SmartScreen 声誉才会完全消失；大量用户下载 + 证书签名是标准做法。
