# NPU Monitor

本地网页，实时监控远程 SSH 主机上的 **昇腾 NPU** 占用情况。零构建、零数据库，开箱即用。

## 功能

- 增 / 删 / 改 SSH 主机（支持密码和私钥两种认证）
- 一键开始 / 停止监控
- 每张卡片实时显示各 NPU 的 **利用率 + HBM 内存**
- 最近 **5 分钟** 利用率趋势曲线（Chart.js）
- 可选显示 `npu-smi info` 原始输出，便于排查解析问题
- 配置保存在本地 `data/hosts.json`

## 快速开始

### 方式 A：托盘应用（推荐）

启动后**自动隐藏到系统托盘**，终端立即返回（不挂起）：

```bash
cd npus-usage
npm install
npm run tray
# → 终端立即返回，托盘继续在后台运行
# → 找系统托盘里的琥珀色方块图标
```

**完全无终端**（双击启动）：在文件资源管理器里双击 `start-tray.vbs`，连 cmd 窗口都不弹出。

### 方式 B：桌面应用（窗口 + 托盘）

弹出**独立窗口**（不再需要开浏览器），窗口内显示完整前端 UI。关闭窗口 = 隐藏到托盘，托盘 Quit 才彻底退出：

```bash
npm run app
# → 窗口自动弹出，显示 NPU Monitor UI
# → 关闭窗口后留在托盘；右键托盘 Quit 退出
```

**完全无终端**（双击启动）：双击 `start-app.vbs`。

托盘右键菜单：

- **NPU Monitor · ● Running · :8787** （状态行，只读）
- **Open Window** —— 打开内置 Electron 窗口，显示同一套前端瀑布流和拖拽界面
- **Start Backend** / **Stop Backend** / **Restart Backend** —— 启停 HTTP 服务
- **Quit** —— 退出整个应用

托盘图标为琥珀色方块（`tray-icon.png`）。如需自定义图标，替换项目根的 `tray-icon.png` 后重启托盘应用。

### 方式 B：命令行启动

```bash
cd npus-usage
npm install
npm start
# 或：node --watch server.js  （热重载）
```

浏览器打开 <http://localhost:8787> ，点击右上角 **添加主机**。

### 添加主机字段

| 字段 | 说明 | 默认 |
| --- | --- | --- |
| 主机名 | 备注 | - |
| IP / 域名 | SSH 目标 | - |
| 端口 | SSH 端口 | `22` |
| 用户名 | SSH 用户 | - |
| 采集命令 | 在远端执行的命令 | `npu-smi info` |
| 刷新间隔 | 多久采一次 (ms) | `2000` |
| 认证 | 密码 / 私钥 | - |
| 显示原始输出 | 排查用 | 关 |

保存后点 **测试** 验证连通性，没问题就 **开始** 监控。

## 自定义命令

默认执行 `npu-smi info`。如果你的版本输出格式不同，可在添加/编辑时把 `采集命令` 改为：
- `npu-smi info -t usages`（部分固件支持）
- `npu-smi info -t json`（新版本支持）
- `cat /proc/...` 等任意可输出 NPU 信息的命令

解析器目前内置对 `npu-smi info` 表格输出（带 `Util` / `Memory-Usage(MiB)` 列）的适配——会自动找列名、对齐取数。如果你的输出格式不同，**勾选“显示原始输出”** 可以直观看到原始文本，方便加新解析规则。

## API

| Method | Path | 用途 |
| --- | --- | --- |
| `GET`    | `/api/hosts`             | 列出所有主机（含运行状态） |
| `POST`   | `/api/hosts`             | 新增主机 |
| `PUT`    | `/api/hosts/:id`         | 更新主机（运行中会自动重启采集） |
| `DELETE` | `/api/hosts/:id`         | 删除主机 |
| `POST`   | `/api/hosts/:id/start`   | 开始监控 |
| `POST`   | `/api/hosts/:id/stop`    | 停止监控 |
| `POST`   | `/api/hosts/:id/test`    | 跑 `uname -a` 测试连通性 |
| `WS`     | `/ws`                    | 实时推送（消息: `subscribe` / `snapshot` / `sample` / `error`） |

## 项目结构

```
npus-usage/
├── server.js          # Express + ssh2 + ws
├── package.json
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js
└── data/
    └── hosts.json     # 运行时生成，保存主机配置
```

## 注意事项

- 密码以**明文**保存在 `data/hosts.json`——这是本地工具，不建议在公网部署。若有需要可自行改用 `safeStorage` / 系统 keyring。
- 私钥路径只保存路径，文件本身不复制。`server.js` 每次连接时读取。
- SSH 连接会被**复用**（长连接 + 多次 exec），避免频繁握手开销。
- 端口可通过环境变量 `PORT` 修改：`PORT=9000 npm start`。
