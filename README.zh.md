# dsh-mcp-market

[English](README.md) | 中文

装在 DeepSeek Harness 里的 **MCP 服务器商场**：浏览精选目录，一键安装 MCP 服务器到当前 profile，**无需重启立即生效**（经由官方 `@deepseek-ai/dsh-mcp-client` 与 loader 服务）。

打开 **设置 → MCP 商场**：搜一搜，点一下，装好。模型马上就能看到 `mcp__<serverName>__<tool>` 前缀的工具。

## 特性

- **浏览与搜索**：内置精选目录（15 个全部实测可用的服务器），支持分类筛选、关键词搜索、中英描述
- **npm 存在性校验**：加载目录时逐条向 registry.npmjs.org 校验 npm 包是否存在，已下架的条目自动置灰并禁止安装（防死条目/诱饵包）
- **一键安装**：stdio（本机子进程）与 streamable-http（远程 URL）两种传输；安装前可填写/修改命令、参数、环境变量、URL、请求头
- **免重启生效**：通过 `ctx.loader.create()` 热注册，模型立即可用；配置已持久化，重启后依然存在
- **已装管理**：已安装列表展示注册状态，支持启用/停用、编辑配置（HMR 自动重连）、卸载
- **手动添加**：目录里没有的服务器可以直接手动配置
- **离线兜底**：目录数据实时抓取远程 JSON，失败时回退到内置快照
- **持久化干净**：所有安装只写 profile 的 `cordis.patch.yml` 里一个 `# --- dsh-mcp-market managed ---` 注释块，你手动改的配置原样保留

## 安装

```sh
# 从 npm 安装（所有人通用）
dsh plugin --profile web add dsh-mcp-market

# 或从本地开发目录安装（仅供你自己开发调试，路径换成你的实际目录）
dsh plugin --profile web add "D:\path\to\dsh-mcp-market"

# 更新到最新版
dsh plugin --profile web update dsh-mcp-market

# 卸载
dsh plugin --profile web remove dsh-mcp-market
```

重启 `dsh web`，打开 **设置 → MCP 商场**。

## 开发

```sh
npm install
npm run build        # tsc 编译 host 端到 lib/，esbuild 打包 client 端到 client/client.js
npm run typecheck    # 两端类型检查
```

改完代码后：

1. `npm run build`（client 端改完 UI 必须重新打包）
2. 重启 `dsh web` 生效（host 端改动需要；client 端可配合 dev:web watcher 热更）

安装到 profile 进行联调：`dsh plugin --profile web add <本项目路径>`。

## 目录数据源

**活目录**：默认从 GitHub Pages 托管地址 `https://LKMeng2001.github.io/dsh-mcp-market/servers.json` 拉取（仓库里 `docs/servers.json` 是唯一权威源，改它并 push 即全局生效，无需发版）；拉取失败时回退到内置 `data/registry-snapshot.json`（由 `npm run sync:catalog` 从 `docs/servers.json` 同步生成）。

目录维护：

- 加/改服务器：编辑 `docs/servers.json` → `git push` → 1 小时后（缓存）所有用户可见；
- 防失效：CI 每天自动校验每个 npm 包是否存在（`.github/workflows/catalog-check.yml`），缺失会标红失败；
- 也可通过 host 配置覆盖 URL（见下）。

条目 schema：

```jsonc
{
  "name": "github",                       // serverName / 条目 id（mcp-<name>）
  "category": "dev",                      // 分类 key，对应顶层 categories
  "description": { "en": "...", "zh": "..." },
  "transport": "stdio",                   // "stdio" | "streamable-http"
  "command": "npx",                       // stdio：命令
  "args": ["-y", "@modelcontextprotocol/server-github"], // stdio：参数
  "env": {},                              // stdio：默认环境变量
  "url": "https://example.com/mcp",       // streamable-http：URL
  "headers": {},                          // streamable-http：请求头
  "envHint": ["GITHUB_TOKEN"],            // 需要用户填写的环境变量名（UI 会提示）
  "placeholder": false,                   // true = 占位条目，需要用户替换成真实值
  "tags": ["github", "api"]
}
```

## Host 配置

`cordis.patch.yml` 里覆盖默认值：

```yaml
- id: dsh-mcp-market
  config:
    profile: web            # 默认从命令行 --profile 推断
    registryUrl: https://your-registry.example.com/servers.json
```

## 安全

- 所有写操作（install/remove/toggle/update）只接受**同源 POST**，带 Origin 校验；
- MCP 服务器是第三方代码/服务：stdio 服务器会在本机启动子进程，安装即代表你信任该来源（UI 有提示）；
- 环境变量等配置明文存在 profile 的 `cordis.patch.yml` 中，请勿存放高敏密钥，或自行加密后再写入。

## 工作原理

| 层 | 文件 | 职责 |
|---|---|---|
| host 入口 | `src/index.ts` | cordis 插件，注入 webServer + loader，挂路由 |
| host 路由 | `src/routes.ts` | `/mcp-market/registry`、`/installed`、`/status`、`/install`、`/remove`、`/toggle`、`/update` |
| 目录 | `src/registry.ts` | 远程 JSON + 内存缓存 + 内置快照回退 |
| 持久化 | `src/profile.ts` | 读写 `cordis.patch.yml` 的 managed 块（js-yaml，保留用户其他内容） |
| 编排 | `src/manage.ts` | 校验 → `loader.create/update/remove` 热生效 → 落盘 |
| client | `src/client/` | 设置页「MCP 商场」React UI，同源 fetch 上述路由 |

## 路线图

- [ ] 连接状态实时展示（复用 dsh-mcp-client 的事件）
- [ ] 目录提交/审核机制与独立托管站点
- [ ] 一键「从本地 mcp 配置导入」
- [ ] 已装服务器一键导出成 `claude_desktop_config` 风格配置

## 许可

MIT
