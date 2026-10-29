# HYACINE-AI 1.3.0 零基础使用手册

这份手册面向第一次接触 Git、Node.js、命令行和 Electron 的用户。按照顺序操作即可，不需要先理解项目源码。

本文包含三条完整路线：

1. 从 GitHub 获取项目代码。
2. 直接运行源码，测试管理面板、QQ 机器人和桌宠。
3. 在 Windows 上生成可以安装的 `.exe` 文件。

QQ 接入可选 NapCat、SnowLuma 或官方 QQ Bot；本文的 NapCat 步骤继续适用，其他渠道请参阅 [QQ 渠道配置](./QQ_CHANNELS.md)。

项目地址：<https://github.com/Byldxxy/HYACINE-AI>

## 1. 开始前先了解几个词

- **项目目录**：下载后的 `HYACINE-AI` 文件夹。本文出现“在项目目录执行命令”时，表示终端当前必须位于这个文件夹内。
- **终端**：输入命令的窗口。Windows 推荐使用 PowerShell，macOS 使用“终端”。VS Code 顶部菜单“终端 -> 新建终端”也可以。
- **Node.js**：运行本项目 JavaScript 后端和开发工具的环境。
- **npm**：随 Node.js 安装的依赖管理工具，用于下载项目需要的软件包和执行项目命令。
- **Git**：从 GitHub 下载代码、获取更新和切换版本的工具。
- **WebUI**：浏览器中的 HYACINE-AI 管理面板。
- **Electron**：让 Web 技术可以创建桌面窗口、系统托盘和桌宠的软件框架。
- **NapCat / OneBot v11**：把 QQ 消息通过反向 WebSocket 发送给 HYACINE-AI 的通信层。

> 本仓库只提供程序源码，不提供第三方角色模型、贴图、图片、动作或音频。请只使用你自己创作、已获授权或许可证允许使用的素材。

## 2. 安装必需软件

### 2.1 安装 Git

Windows：

1. 打开 <https://git-scm.com/download/win>。
2. 下载并运行安装程序。
3. 不确定选项含义时保持默认，一直点击 Next 即可。
4. 安装完成后关闭并重新打开 PowerShell 或 VS Code。

macOS：

1. 打开“终端”。
2. 输入 `git --version`。
3. 如果系统提示安装 Command Line Tools，按提示安装。

验证 Git：

```bash
git --version
```

看到类似 `git version 2.x.x` 表示安装成功。出现“无法识别 git”时，先重启终端；仍无效则重新安装 Git。

### 2.2 安装 Node.js 22.12 或更高版本

1. 打开 <https://nodejs.org/>。
2. 安装当前 LTS 版本。项目要求 Node.js `22.12.0` 或更高版本。
3. 安装完成后关闭并重新打开终端。

验证 Node.js 和 npm：

```bash
node --version
npm --version
```

`node --version` 应显示 `v22.12.0` 或更高版本。版本过低会导致 Vite 或 Electron 安装、构建失败。

### 2.3 可选：安装 VS Code

VS Code 不是运行项目的必要条件，但适合查看代码和打开集成终端：<https://code.visualstudio.com/>。

## 3. 从 GitHub 拉取代码

### 3.1 选择存放位置

不要把项目放进需要管理员权限的目录，例如 `C:\Program Files`。Windows 可以放在：

```text
C:\Projects\HYACINE-AI
```

macOS 可以放在：

```text
~/Projects/HYACINE-AI
```

### 3.2 使用 Git 克隆

在准备存放项目的父目录打开终端，执行：

```bash
git clone https://github.com/Byldxxy/HYACINE-AI.git
cd HYACINE-AI
```

如果要使用经过标记的 `1.3.0` 版本，而不是随时可能更新的开发分支，再执行：

```bash
git checkout v1.3.0
```

检查当前版本：

```bash
git status
```

看到 `On branch main` 表示正在使用最新主分支；看到 `HEAD detached at v1.3.0` 不是错误，表示正在使用固定的 1.3.0 版本。

### 3.3 不使用 Git 的下载方式

也可以在 GitHub 项目页面点击 `Code -> Download ZIP`，然后解压。但 ZIP 方式不能直接使用 `git pull` 更新，也不便于切换版本，因此推荐使用 Git 克隆。

### 3.4 安装项目依赖

确认终端位于包含 `package.json` 的项目根目录，然后执行：

```bash
npm ci
```

第一次安装会下载 Node.js 依赖和 Electron，耗时取决于网络。结束时回到命令提示符且没有 `npm ERR!`，通常表示安装成功。

`npm ci` 会严格按照 `package-lock.json` 安装，适合新拉取的完整项目。如果你正在修改依赖，可使用 `npm install`。

## 4. 准备本地配置

### 4.1 创建 `.env`

`.env` 用于保存只属于本机的环境变量，不会被 Git 上传。

Windows PowerShell：

```powershell
Copy-Item .env.example .env
```

Windows cmd：

```bat
copy .env.example .env
```

macOS / Linux：

```bash
cp .env.example .env
```

用文本编辑器打开 `.env`。最常用的字段如下：

```env
API_KEY=your-api-key-here
API_PORT=3001
BIND_HOST=127.0.0.1
VITE_PET_MODEL_PATH=/models/desktop-pet.pmx
VITE_PET_MANIFEST_PATH=
VITE_DEV_SERVER_URL=http://localhost:5173
```

- `API_KEY`：OpenAI 兼容模型服务的密钥。不想写入 WebUI 配置文件时可填在这里。
- `API_PORT`：后端和 OneBot 反向 WebSocket 使用的端口，默认 `3001`。
- `BIND_HOST`：默认 `127.0.0.1`，仅允许本机访问。零基础用户不要改成 `0.0.0.0`。
- `VITE_PET_MODEL_PATH`：桌宠模型在 `public/` 下的 URL。
- `VITE_PET_MANIFEST_PATH`：自定义动作清单 URL，不使用动作时可以留空。
- `VITE_DEV_SERVER_URL`：桌宠开发页面地址，通常不用修改。
- `VITE_API_BASE_URL`：可选的 WebUI 后端地址覆盖。Vite 开发模式默认连接当前主机的 `3001` 端口；生产页面默认沿用当前站点地址与端口。开发时使用其他后端端口可设置此项。

不要把真实 API Key 发给他人，也不要删除 `.gitignore` 中的 `.env` 规则。

### 4.2 准备桌宠和看板娘素材

这些文件是可选的。没有模型时管理面板和 QQ 机器人仍可运行，但桌宠无法显示人物模型。

```text
public/
├── character.png             # 可选：WebUI 左侧看板娘
├── tray_icon.png             # 可选：桌宠系统托盘图标
├── pet-manifest.json         # 可选：本地动作与表情配置
└── models/
    ├── desktop-pet.pmx       # 示例：MMD 模型
    ├── 模型引用的贴图文件
    └── motions/
        └── idle.vmd          # 示例：动作文件
```

模型引用的贴图和材质必须保持原有相对目录结构。若要配置动作：

1. 将 `public/pet-manifest.example.json` 复制为 `public/pet-manifest.json`。
2. 按实际文件名修改其中的模型和 VMD URL。
3. 在 `.env` 中填写 `VITE_PET_MANIFEST_PATH=/pet-manifest.json`。
4. 重启开发进程。

本地角色参考图通过 WebUI 添加后保存在 `data/avatars/`。`data/`、`.env`、本地模型和个人图片都不会被 Git 跟踪。

## 5. 直接运行源码进行开发测试

根据测试目标选择下面一种方式。不要同时启动多个占用 `3001` 或 `5173` 端口的实例。

### 5.1 推荐：一条命令启动桌宠和完整后端

在项目根目录执行：

```bash
npm run dev:pet
```

这个命令会自动：

1. 启动 Vite 开发服务器。
2. 等待 `http://localhost:5173/pet.html` 可访问。
3. 启动本地 Electron。
4. 由 Electron 启动 HYACINE-AI 后端。

打开浏览器访问：

```text
http://localhost:5173
```

此模式适合测试桌宠、桌面感知、托盘菜单和 WebUI。桌面感知默认关闭，首次开启时需要授予操作系统屏幕录制权限。

停止项目：回到运行命令的终端按 `Ctrl + C`。也可以从桌宠托盘菜单退出，但开发终端若仍在运行，仍建议按一次 `Ctrl + C`。

### 5.2 只测试 WebUI 和 QQ 机器人，不启动桌宠

需要两个终端，两个终端都要位于项目根目录。

终端 1，启动后端：

```bash
node server.js
```

终端 2，启动前端：

```bash
npm run dev
```

然后访问：

```text
http://localhost:5173
```

普通 `node server.js` 模式没有 Electron 主进程，因此 WebUI 的桌宠开关和桌面感知会显示不可用，这是正常现象。

分别在两个终端按 `Ctrl + C` 才能完全停止。

### 5.3 测试接近正式部署的构建

先构建前端：

```bash
npm run build
```

再启动后端：

```bash
node server.js
```

访问：

```text
http://localhost:3001
```

这个模式不提供 Vite 热更新，适合确认生产构建能否正常加载。

## 6. 配置 WebUI 和 NapCat

### 6.1 认识工作区

WebUI 默认进入“工作台”，导航入口如下：

| 页面 | 用途 |
| --- | --- |
| 工作台 | 查看后端、QQ 与模型配置状态，进入设置并查看最近活动 |
| 对话 | 使用已保存配置测试角色回复，不向真实 QQ 发送消息 |
| 记忆 | 管理长期记忆、会话记录、会话摘要与记忆策略 |
| 人设 | 编辑角色名称、提示词、身份关系和风堇群聊预设 |
| 模型 | 配置文本、视觉与生图模型，管理角色参考图并测试生图 |
| 连接 | 配置 NapCat、触发规则、主动参与和桌面感知 |

顶部“后端在线”只表示管理服务可访问，QQ 是否连接需看独立的 QQ 状态；“模型已配置”表示必要字段已填写，实际可用性通过“对话”页验证。运行日志从导航底部打开。

按 `Cmd + K`（macOS）或 `Ctrl + K`（Windows/Linux）打开快速跳转，搜索页面或保存、日志操作。按 `Cmd/Ctrl + S` 保存配置。看板娘可从顶部隐藏，其设置中可选择本地立绘、调整大小和控制桌宠显示。页面遵循系统的减少动态效果设置；首次进入页面或打开日志时才加载相应模块。

完整界面说明见 [WebUI 使用与结构](./WEBUI_GUIDE.md)。

### 6.2 填写模型配置

打开 WebUI 后，至少完成以下内容：

1. 在“模型”中填写 OpenAI 兼容文本 API Endpoint。
2. 填写 API Key；若 `.env` 已设置 `API_KEY`，WebUI 中可不重复保存真实密钥。
3. 填写服务商实际支持的文本模型名称。
4. 在“人设”中填写角色名称和核心人设。
5. 点击页面中的“保存配置”。只修改输入框但不保存，不会写入磁盘。
6. 使用“对话”确认模型能够回复，再连接 QQ。

图片理解要求文本模型支持 OpenAI Chat Completions 风格的多模态 `image_url` 输入。生图还需要填写生图模型和生图 Endpoint；不使用生图时可以留空。

### 6.3 配置 NapCat 反向 WebSocket

先确保 HYACINE-AI 后端已经运行，再在 NapCat 的 OneBot v11 配置中新增或启用“反向 WebSocket”：

```text
ws://127.0.0.1:3001
```

然后：

1. 在 WebUI“连接”中填写机器人 QQ。
2. 根据需要添加句首唤醒词。
3. 点击“保存配置”。
4. 重启或重新连接 NapCat。
5. 在 QQ 群中 @ 机器人进行测试。

默认情况下机器人只响应 @、句首唤醒词等触发消息。“回复所有消息”会显著增加 API 调用和费用，不建议刚开始时开启。

### 6.4 草稿、保存与测试

连接、模型、人设和记忆策略共用配置草稿。页面底部显示读取、未保存、保存中或同步结果；点击“保存配置”后才提交给后端。保存过程中继续编辑的内容仍保留为未保存修改。请求失败会显示错误并保留草稿，可修正配置或连接后重试；“还原配置草稿”恢复至上次成功保存的配置，不影响记忆编辑。

长期记忆、会话记录、会话摘要有独立保存入口，`Cmd/Ctrl + S` 不代替这些操作。会话草稿按会话分别保留，切换会话不会把内容写到另一会话；刷新长期记忆列表时也不会覆盖尚未保存的修改。离开页面前，浏览器会对未保存的配置或记忆发出提示。

“对话”页使用服务端已保存的人设和模型配置；修改后先保存再测试。选择主人或普通用户身份，输入消息后发送；中文输入法确认候选字时不会误发消息。清空会话时取消旧请求，只有后端确认清空后才移除页面记录。清空失败时保留原记录并显示错误。

### 6.5 配置保存在哪里

源码模式的数据位于项目内：

```text
data/
├── bot-config.json
├── bot-sessions.json
├── bot-summaries.json
├── bot-persistent-memory.json
└── avatars/
```

安装后的 Electron 应用使用操作系统的用户数据目录，避免向安装目录写文件。不要手动把 `data/` 上传到 GitHub，其中可能包含密钥、角色预设和聊天内容。

## 7. 运行项目自检

修改源码或准备打包前，建议依次执行：

```bash
npm run lint
npm test
npm run build
npm run check:release
```

- `npm run lint`：检查常见 JavaScript/React 错误。
- `npm test`：运行自动化测试。
- `npm run build`：确认前端能生成生产构建。
- `npm run check:release`：确认 Git 跟踪和前端构建中没有本地配置、模型或用户资源。

所有命令退出且没有 `ERR!`、`failed` 或非零退出码，才继续打包。

## 8. 在 Windows 生成 EXE 安装包

本节需要在 Windows 10/11 x64 环境完成。推荐使用 PowerShell，并确保 Git、Node.js 22.12+ 已安装。

### 8.1 获取干净的 1.3.0 源码

```powershell
git clone https://github.com/Byldxxy/HYACINE-AI.git
cd HYACINE-AI
git checkout v1.3.0
npm ci
```

如果已经克隆过项目：

```powershell
git status
git pull
git checkout v1.3.0
npm ci
```

`git status` 如果显示你修改过源码，切换版本前先确认这些修改是否需要保留。不要使用不理解的强制清理命令。

### 8.2 决定安装包是否携带本地视觉素材

默认 GitHub 源码不包含第三方模型和个人图片，生成的安装包也不会凭空拥有这些资源。

仅用于可信范围内部测试、且你确认拥有分发权时，可以在打包前把素材放到：

```text
public/character.png
public/tray_icon.png
public/pet-manifest.json
public/models/...
```

Electron Builder 会从这些明确的资源位置复制本地桌宠资源。以下内容始终不应该进入安装包：

```text
.env
data/
API Key
私人聊天记录
个人角色预设
你无权再分发的模型、图片、贴图、动作和音频
```

注意：打包白名单只复制 `public/models/`；放在其他本地模型目录的资源不会进入安装包。需要内部测试且确认拥有分发权的模型应放在 `public/models/`，并同步修改 `.env` 或 `pet-manifest.json` 中的本地路径。`.env` 本身不会进入安装包。

### 8.3 打包前检查

```powershell
npm run lint
npm test
npm run build
npm run check:release
```

发布边界检查通过时会显示类似：

```text
Release boundary passed (... tracked files checked).
```

### 8.4 生成安装包

执行：

```powershell
npm run dist:win
```

第一次打包可能需要下载 Electron Builder 使用的 Windows 工具，时间会比普通构建长。完成后安装程序位于：

```text
release/HYACINE-AI-Setup-1.3.0-x64.exe
```

`release/` 已被 Git 忽略，不会因为普通 `git add .` 而上传到源码仓库。

### 8.5 安装和验证

1. 在测试机运行 `HYACINE-AI-Setup-1.3.0-x64.exe`。
2. 选择安装目录并完成安装。
3. 首次启动应看到桌宠或模型缺失提示，取决于安装包是否携带本地授权素材。
4. 打开管理面板，确认 API Endpoint、API Key 和角色预设为空。
5. 填写测试配置并重启，确认配置仍然存在。
6. 测试 NapCat 连接、模型对话、桌宠托盘菜单和桌面感知权限。
7. 卸载后检查是否符合预期；用户数据通常与程序安装文件分离，不应依赖安装目录保存。

当前安装包没有代码签名。Windows SmartScreen 可能显示“Windows 已保护你的电脑”。这不代表构建失败，但只应把未签名安装包发给明确知情并信任来源的测试者。公开分发前应购买代码签名证书并配置正式应用图标。

## 9. 获取后续更新

使用主分支时，在项目目录执行：

```bash
git checkout main
git pull
npm ci
```

更新后重新运行测试。如果新版修改了构建或依赖，`npm ci` 会让本地依赖与仓库锁文件保持一致。

如果你在项目中加入了自己的模型、图片、`.env` 和 `data/`，它们按默认规则不会被 `git pull` 上传；更新前仍建议单独备份本地数据。

## 10. 常见问题

### `git`、`node` 或 `npm` 不是内部或外部命令

软件尚未安装，或者安装后终端没有重启。安装对应软件并重新打开 PowerShell/VS Code。

### `npm ci` 下载 Electron 很慢或失败

Electron 是桌宠和 EXE 打包所需的较大依赖。先确认网络能访问 npm registry，删除未完成安装产生的 `node_modules` 后再运行 `npm ci`。不要反复使用来源不明的全局 Electron。

### `npx electron` 又提示下载 Electron

先在项目根目录成功执行 `npm ci`，再使用项目脚本 `npm run dev:pet` 或 `npm run electron:dev`。项目脚本会使用 `node_modules` 中的本地 Electron，不需要每次重新安装。

### 端口 `3001` 或 `5173` 已被占用

通常是上一次开发进程没有退出。回到旧终端按 `Ctrl + C`，或退出残留的 Electron/Node 进程，再重新启动。修改端口时必须同步考虑前端 API 地址和 NapCat 反向 WebSocket 地址，零基础用户优先关闭旧进程。

### WebUI 能打开，但桌宠按钮不可用

使用 `node server.js` 启动时没有 Electron 主进程，这是正常现象。需要桌宠时使用：

```bash
npm run dev:pet
```

### 桌宠显示模型加载失败

检查模型是否位于 `public/models/`，`.env` 中的 `VITE_PET_MODEL_PATH` 是否以 `/models/` 开头，以及 PMX/PMD 引用的贴图是否完整。修改 `.env` 或 manifest 后必须重启开发进程。

### 配置修改后重启消失

确认点击了“保存配置”，并检查终端是否显示写入错误。源码模式读取项目 `data/`；安装版读取系统用户数据目录。不要同时运行多个指向不同数据目录的实例。

### NapCat 一直未连接

确认后端终端仍在运行，NapCat 使用的是反向 WebSocket `ws://127.0.0.1:3001`，且端口与 `.env` 中的 `API_PORT` 一致。防火墙、安全软件和其他程序占用端口也可能导致连接失败。

### `npm run dist:win` 成功，但找不到 EXE

查看项目根目录的 `release/` 文件夹。文件名应包含 `Setup`、版本号和 `x64`。

### Windows 阻止运行安装包

当前内部测试包未签名，会触发 SmartScreen。只运行你本人构建或从可信发布者获得的文件；正式公开发布应配置代码签名，而不是要求普通用户长期忽略系统警告。

## 11. 隐私和发布前检查

推送代码或把安装包交给别人前，逐项确认：

- `.env` 没有被 Git 跟踪。
- `data/` 没有被 Git 跟踪。
- 安装包首次启动时不含 API Endpoint、API Key、角色预设和聊天记录。
- 所有随安装包提供的模型、图片、贴图、动作和音频均拥有合法分发权。
- 已执行 `npm run check:release`。
- 测试者知道安装包未签名，且只在可信范围内使用。

可以用下面的命令查看即将提交的文件：

```bash
git status
git diff --cached --name-only
```

发现 `.env`、`data/`、私有素材或不认识的大型二进制文件时，不要推送，先检查 `.gitignore` 和暂存区。

## 12. 命令速查

```bash
git clone https://github.com/Byldxxy/HYACINE-AI.git  # 下载源码
cd HYACINE-AI                                       # 进入项目目录
npm ci                                              # 按锁文件安装依赖
npm run dev:pet                                     # 完整桌宠开发模式
node server.js                                      # 单独启动后端
npm run dev                                         # 单独启动前端
npm run lint                                        # 静态检查
npm test                                            # 自动化测试
npm run build                                       # 构建前端
npm run check:release                               # 检查私有资源发布边界
npm run dist:win                                    # Windows x64 EXE 安装包
```

项目概览和快速开始见 [README.md](./README.md)，架构、工程保障、验证状态和后续路线见 [PROJECT_TRACKER.md](./PROJECT_TRACKER.md)。


## 群聊消息处理

触发方式、会话调度及发送确认机制见 [消息处理架构](./BOT_LOGIC.md)。

- 支持的触发方式包括 @、句首关键词、私聊和全量回复；引用已知机器人消息也能继续对话。
- 主动发言根据群聊活跃度调整新增消息门槛，正常状态等待 3 条新的非定向真人消息；自己的回复、已回答内容和过期话题不会不断重新触发。冷却也覆盖普通回复。
- 检查间隔是“尝试判断”的周期，不是定时发话。没有新内容时保持安静是正常行为，不要通过打开全量回复来测试主动发言。
- 日志显示“已确认”才表示收到了 NapCat 成功回执。若提示“结果未知”，先查看群内实际情况；程序不会自动补发，以免网络抖动造成重复发送。
- 自动提取的事实只用于来源会话；手动事实可共享。
- 在群中清除当前会话记忆需要主人身份；清除短期会话不会顺带删除手动长期事实。

## 成员称呼与连续对话

开启持久化记忆后，机器人会按当前群和 QQ 号保存群名片、明确外号及有来源的偏好。可以直接说“叫我阿王”，或用“不要叫我老王，叫我阿王就行”纠正称呼。指向其他成员的称呼可配合 @ 表达。资料沿用现有持久化记忆管理，不增加独立设置面板。

机器人普通回复或主动发言后，群成员可以在 3 分钟内直接承接当前话题，无需每次 @。其他成员接梗、补充经历或纠正称呼也会进入上下文判断，不会仅因换人发言而中断。系统仍可选择保持沉默；明确指向其他人的消息不会直接触发续聊。每次成功回复刷新窗口，超过窗口后可通过 @、唤醒词或引用机器人再次开启对话。

日志中的“进入话题续聊判断”表示已进入候选流程；“旁听”附带未进入续聊的原因。新消息可能使旧候选失效，后续判断会使用更新后的群聊上下文。

## 群聊节奏与长期学习

主动参与以当前话题为基础，不在无人发言时凭空开启话题。热闹时缩短检查间隔和冷却，冷清时提高参与阈值；配置中的间隔、冷却为正常状态的基础值。直接 @ 与明确唤醒仍优先处理。

开启长期记忆后，群内黑话可从重复使用或明确教学中积累。“记住，我们群的……”可用于解释词义；外号继续按 QQ 号绑定成员。角色偏好从多次已确认回复中表达的倾向逐渐提取，群友要求本身不直接改变偏好。

记忆页面默认显示长期记忆，可通过搜索和类型筛选查找条目。点击“添加”展开表单，选择普通记忆、群内黑话、教学知识或角色偏好。黑话选择已有群会话并填写词条；角色偏好填写主题和内容，跨会话共享。已有成员资料也可直接编辑。人工编辑的内容会固定，自动学习不覆盖；停用可保留条目并阻止继续使用。条目修改后点击“保存记忆”。

切换到“会话记录”可查看和编辑各会话的聊天上下文。“会话摘要”默认折叠，用于保留旧聊天压缩后的上下文，仅属于当前会话；它与外号、黑话、知识和角色偏好等长期记忆条目用途不同。展开后可编辑并单独保存摘要。

页面底部的“记忆设置”集中管理上下文深度和长期记忆开关，修改后使用“保存配置”。

## 风堇角色预设

在人设页展开“风堇预设”可查看完整内容。“使用预设”将名称、核心人设和群聊提示填入编辑区，可继续修改或使用“撤销预设”恢复，再通过“保存配置”提交。原有角色图片、模型连接和长期记忆不随预设切换。预设内容与扩展方式见 [角色表达与扩展](./CHARACTER_GUIDE.md)。

测试聊天按场景独立排队，模型请求失败不写入后端聊天历史。页面显示错误并保留输入以便重试；清空操作确认成功前保留原有记录，旧请求的迟到结果不会重新出现在已清空的页面中。
