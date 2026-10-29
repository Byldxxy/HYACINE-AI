# HYACINE-AI

一个面向 QQ 群聊的本地化 AI 机器人与桌宠项目。通过 NapCat、SnowLuma（OneBot v11）或官方 QQ Bot 接收 QQ 消息，连接 OpenAI Chat Completions 兼容模型，并提供角色设定、图片理解、生图、记忆、主动发言、Web 管理面板和 Electron 桌面互动。

[![CI](https://github.com/Byldxxy/HYACINE-AI/actions/workflows/ci.yml/badge.svg)](https://github.com/Byldxxy/HYACINE-AI/actions/workflows/ci.yml)
[![Release](https://img.shields.io/badge/release-v1.3.0-ef5da8)](https://github.com/Byldxxy/HYACINE-AI/tree/v1.3.0)
[![License](https://img.shields.io/badge/license-MIT-2f855a)](./LICENSE)

- [1.3.0 更新日志](./CHANGELOG.md)：新增能力、兼容性与升级说明。
- [人格与记忆扩展评估](./HUMANIZATION_RESEARCH.md)：参考项目、兼容性、表达连续性和记忆召回。
- [聊天扩展](./EXTENSIONS_GUIDE.md)：表情素材管理、B 站链接资料和扩展边界。
- [QQ 渠道配置](./QQ_CHANNELS.md)：NapCat、SnowLuma 与官方 QQ Bot 的接入步骤和能力差异。
- [消息处理架构](./BOT_LOGIC.md)：触发、旁听、主动发言、发送回执及记忆边界。
- [WebUI 使用与结构](./WEBUI_GUIDE.md)：工作台导航、草稿保存、状态反馈与前端模块。
- [角色表达与扩展](./CHARACTER_GUIDE.md)：风堇群聊预设、记忆选择与模块扩展入口。
- [零基础使用手册](./USER_GUIDE.md)：安装 Git/Node.js、拉取源码、运行测试、连接 NapCat、生成 Windows EXE。
- [统一菜单与尺寸调整](./CONTROLS_GUIDE.md)：右键入口、交互暂停和屏幕边缘布局。
- [角色渲染与瞳孔控制](./RENDERING_GUIDE.md)：三渲二着色、近距离视线跟随与验证。
- [桌宠动作与窗口互动](./COMPANION_GUIDE.md)：状态机、配布来源、窗口散步与攀爬。
- [项目维护跟踪](./PROJECT_TRACKER.md)：系统架构、模块职责、工程保障、验证状态、已知限制和路线图。

## 核心能力

### QQ 对话

- 可选 NapCat 反向 WebSocket、SnowLuma 正向 WebSocket 或官方 QQ Bot Webhook；一次启用一个渠道。
- 支持 @ 机器人、句首唤醒词和全量回复三种触发方式。
- 按群与 QQ 号区分成员，支持群名片、外号和有来源的偏好记忆。
- 支持围绕近期话题的多人免 @ 续聊，普通回复和主动发言均可承接；由上下文判断是否参与。
- 兼容 OpenAI Chat Completions 风格的文本模型服务。
- 同一会话串行处理，支持分段回复、引用机器人消息继续对话和会话重置。
- 消息 ID 去重、排除自身回声；收到 OneBot 成功回执或官方消息 ID 才写入回复记忆，失败或未知结果不自动重发。

官方渠道按平台授权接收群聊或单聊事件，身份独立存储，暂不启用定时主动发言；详细范围见 [QQ 渠道配置](./QQ_CHANNELS.md)。

### 图片理解与生图

- 消息触发机器人且附带图片时，可交给支持视觉输入的文本模型理解。
- 当前消息图片只进入本次模型请求，不把 Base64 写入会话文件。
- 正常聊天触发生图时，可同时使用本地角色基底图和聊天参考图。
- 文本模型端点、生图端点和模型名称均由用户配置，不包含私人服务商默认值。

### 记忆与主动互动

- 短期上下文、独立问答线索、长期摘要与成员资料；自动学习群内黑话、教学知识和有依据的角色偏好。
- 长期记忆统一支持分类添加、编辑和启停；人工固定内容优先于自动学习，按话题相关性与长度预算选择请求上下文。
- 群聊主动发言保留间隔、冷却、置信度、上下文条数和目标群配置；仅基于新真人消息判断，普通回复优先，过期候选和重复内容会被拦截。
- 配置、会话、摘要和长期事实采用校验、串行原子写入与备份恢复。

### Web 管理面板

- 连续云庭场景与生成式导航徽记；风堇支持招手、思考、微笑三种姿势，随页面和交互变化，可关闭动态效果。
- 以工作台为入口，按对话、记忆、人设、模型、连接组织功能，延续粉色半透明面板与统一控件。
- 工作台区分后端就绪、QQ 连接与模型配置状态，提供设置入口和最近活动；模型已配置不代表已完成连通性测试。
- 配置采用独立编辑草稿，显示保存进度、错误和未保存状态；保存期间的新修改保留，记忆使用各自的保存入口。
- 对话页使用独立测试会话，支持主人身份切换、输入法安全发送和清空确认；模型调用失败不写入后端聊天历史。
- 提供可预览、编辑和撤销的风堇群聊预设，以及图片测试、实时日志和脱敏诊断导出。
- `Cmd/Ctrl + K` 快速跳转，`Cmd/Ctrl + S` 保存配置；页面与日志延迟加载，遵循系统减少动态效果设置。
- 看板娘支持切换本地立绘、隐藏和尺寸调节；隐藏后扩展工作区。首次启动保持 API Endpoint、模型名称、Key 和角色预设为空。

### Electron 桌宠

- 使用 Three.js 加载 MMD PMX/PMD 模型，支持 VMD 动作状态机。
- 支持骨骼注视、Morph 表情、点击互动、说话口型和语义事件。
- 支持托盘菜单、拖拽、尺寸调节、显示/隐藏、鼠标穿透和全局视线跟随。
- 桌面感知可观察主显示器变化，在满足条件时通过动态气泡互动。
- 隐藏桌宠时停止画面采集；是否将桌宠排除在截图外可由托盘开关控制。

## 系统架构

```text
QQ / NapCat
    │ OneBot v11 reverse WebSocket
    ▼
server.js
    ├── 消息触发、身份、人设和记忆上下文
    ├── OpenAI 兼容文本 / 视觉模型
    ├── 可选生图模型
    ├── REST 管理 API
    └── WebSocket 日志与桌宠事件
             │
             ├──────────────► React WebUI
             │
Electron main process
    ├── utility process 运行 server.js
    ├── 透明桌宠窗口与系统托盘
    └── 主显示器采样、隐私过滤和变化检测
             │
             ▼
        Three.js MMD pet
```

| 层 | 技术 |
| --- | --- |
| WebUI | React 19、Vite 7、TailwindCSS 3、Framer Motion |
| 后端 | Node.js、Express 5、ws、OpenAI SDK |
| 桌宠 | Electron、Three.js MMD |
| 数据 | 本地 JSON、Zod 校验、原子写入与 `.bak` 恢复 |
| QQ 协议 | NapCat / OneBot v11 |
| 打包 | Electron Builder、NSIS |
| CI | GitHub Actions：Windows、macOS、Linux |

## 快速开始

### 环境要求

- Node.js `22.12.0` 或更高版本。
- Git。
- 需要 QQ 功能时，准备 NapCat 或其他 OneBot v11 兼容实现。
- 需要桌宠时，自行准备拥有使用权的 MMD 模型和贴图。

### 获取源码与依赖

```bash
git clone https://github.com/Byldxxy/HYACINE-AI.git
cd HYACINE-AI
npm ci
```

如需固定使用当前稳定版本：

```bash
git checkout v1.3.0
```

### 本地环境变量

复制 `.env.example` 为 `.env`，再填写本机 Key：

```env
API_KEY=your-api-key-here
API_PORT=3001
BIND_HOST=127.0.0.1
```

`API_KEY` 是可选的环境变量覆盖，用于避免把真实 Key 写入 WebUI 配置文件。文本 API Endpoint、文本模型、生图 Endpoint 和生图模型在 WebUI 中配置。

### 启动完整桌宠开发环境

```bash
npm run dev:pet
```

浏览器打开 `http://localhost:5173`。该命令会启动 Vite、Electron 和后端，适合测试 WebUI、桌宠、托盘与桌面感知。

### 只启动 WebUI 与机器人后端

分别在两个终端执行：

```bash
node server.js
```

```bash
npm run dev
```

浏览器打开 `http://localhost:5173`，NapCat 反向 WebSocket 指向：

```text
ws://127.0.0.1:3001
```

普通 `node server.js` 模式不包含 Electron，因此桌宠和桌面感知会显示不可用。

完整的 Windows/macOS 操作步骤、WebUI 配置方法和故障排查见 [USER_GUIDE.md](./USER_GUIDE.md)。

## 本地视觉资源

WebUI 内置生成式装饰和角色姿势素材，来源见[界面素材说明](./src/assets/atelier/README.md)。仓库不包含本地原始人物立绘、MMD 模型、贴图、VMD 动作或音频。基础攀爬使用程序化动作及允许再分发的 Quaternius CC0 动画轨迹，来源见 [动作资源说明](./third_party/motions/quaternius/README.md)。个人模型与额外动作请使用自行创作、已获授权或许可证允许使用的资源。

```text
public/
├── character.png             # 可选：WebUI 看板娘
├── tray_icon.png             # 可选：Electron 托盘图标
├── pet-manifest.json         # 可选：本地动作/表情清单
└── models/
    ├── desktop-pet.pmx       # 示例模型路径
    ├── 模型引用的贴图和材质
    └── motions/*.vmd         # 可选动作
```

默认模型 URL 为 `/models/desktop-pet.pmx`。使用其他路径时在 `.env` 设置：

```env
VITE_PET_MODEL_PATH=/models/my-pet.pmx
VITE_PET_MANIFEST_PATH=/pet-manifest.json
```

动作清单格式参见 `public/pet-manifest.example.json`。单个动作缺失时桌宠会降级为无动作待机，不阻止模型显示。

## 数据与隐私边界

源码模式的运行时数据保存在本地 `data/`：

```text
data/
├── avatars/
├── bot-config.json
├── bot-sessions.json
├── bot-summaries.json
└── bot-persistent-memory.json
```

安装后的 Electron 应用使用操作系统用户数据目录，不向安装目录写入私人数据。

以下内容由 `.gitignore` 和发布边界检查排除：

- `.env`、API Key 和本地运行时配置。
- `data/` 中的角色预设、聊天记录、摘要和长期记忆。
- `public/character.*`、`public/tray_icon.*` 和本地 `public/pet-manifest.json`。
- `public/models/` 及其他本地模型目录中的模型、贴图和动作。
- `release/` 中的安装包。

桌面感知默认关闭。启用后，截图只驻留内存，不写入配置、日志或聊天记忆；前台应用隐私排除、用户空闲检测和本地画面变化检测会在调用视觉模型前执行。

## 项目结构

```text
HYACINE-AI/
├── .github/workflows/        # 跨平台 CI 与 Windows 安装包工作流
├── electron/                 # Electron 主进程、preload、桌面观察器
├── lib/                      # 对话、记忆、生图、视觉、持久化等后端模块
├── public/                   # 公开运行资源和本地视觉资源目录
├── scripts/                  # 跨平台启动与发布边界检查
├── src/
│   ├── components/           # WebUI 页面与共享控件
│   ├── hooks/                # 配置草稿、记忆、测试对话、运行状态与桌宠 Hooks
│   └── pet/                  # Three.js 桌宠运行时、配置和覆盖层
├── test/                     # Node.js 单元与集成测试
├── server.js                 # Express / WebSocket 后端入口
├── WEBUI_GUIDE.md            # 管理面板使用与结构
├── USER_GUIDE.md             # 零基础使用手册
└── PROJECT_TRACKER.md        # 架构、状态和路线图
```

## 开发与验证

```bash
npm run lint          # ESLint 静态检查
npm test              # Node.js 自动化测试
npm run build         # Vite 生产构建
npm run check:release # 私有资源与构建边界检查
npm run pack:dir      # 当前平台 Electron 目录包
npm run dist:win      # Windows x64 NSIS 安装包
```

GitHub Actions 会在 Windows、macOS 和 Linux 上执行依赖安装、lint、测试、生产构建和发布边界检查。Windows 安装包工作流可手动触发。

安装产物输出到 `release/`。当前安装包未配置代码签名，公开分发前应配置正式图标和 Windows 代码签名。

## 当前版本与路线图

当前源码版本为 `1.3.0`。已完成能力、稳定设计约束、验证基线、已知限制和后续优先级统一维护在 [PROJECT_TRACKER.md](./PROJECT_TRACKER.md)。

## 许可证

项目源代码采用 [MIT License](./LICENSE)。

第三方依赖和用户自行添加的模型、图片、贴图、动作、音频等资源适用各自许可证。HYACINE-AI 的 MIT License 不会自动授予这些外部资源的使用或再分发权。
