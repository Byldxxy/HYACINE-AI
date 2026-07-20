# HYACINE-AI - QQ 群 AI 聊天机器人管理面板

一个基于 React + Express 的 QQ 群 AI 机器人管理面板，通过 NapCat / OneBot v11 与 QQ 通信，支持角色扮演、OpenAI 兼容文本模型、生图、会话记忆、主动发言和桌宠模式。

第一次使用 Git、Node.js 或 Electron？请直接阅读 [HYACINE-AI 1.2.0 零基础使用手册](./USER_GUIDE.md)，其中包含从 GitHub 拉取源码、开发运行和 Windows 生成 EXE 的逐步说明。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React 19, Vite 7, TailwindCSS 3, Framer Motion |
| 后端 | Express 5, ws, OpenAI SDK |
| 桌宠 | Electron, Three.js MMD |
| 存储 | JSON 文件 |
| QQ 协议 | NapCat / OneBot v11 |
| 打包 | Electron Builder, NSIS, Vite |

## 功能

- AI 对话：兼容 OpenAI Chat Completions 格式，可配置 API Endpoint、文本模型、温度和回复长度。
- 图片理解：@ 机器人或使用句首唤醒词发送图片时，将图片交给支持视觉输入的文本模型理解并回复。
- 聊天参考生图：正常聊天触发生图且消息附带图片时，本地角色图作为基底，聊天图片作为姿势、构图、场景或风格参考。
- AI 生图：支持普通生图和挂载角色参考图的生图流程。
- 触发机制：支持 @ 机器人、自定义唤醒词、全量回复模式。
- 群聊身份识别：群聊消息会注入发送者昵称/QQ，主人 QQ 会单独标记。
- 记忆系统：短期记忆、长期摘要、跨会话持久化事实、面板编辑/删除。
- 主动发言：机器人可观察群聊，在满足阈值和冷却条件时主动插话。
- 实时日志：前端通过 WebSocket 接收后端日志。
- 桌宠模式：Electron 启动后端并显示可拖拽 MMD 桌宠。
- 桌宠开关：Electron 模式下可从管理面板顶部或托盘菜单显示/隐藏桌宠窗口。
- 桌面感知：可选观察主显示器画面，在画面变化后由桌宠自主决定是否搭话。

## 快速开始

### 前置条件

- Node.js 22.12 或更高版本（Vite 7 要求）。
- 已运行并配置反向 WebSocket 的 NapCat 或其他 OneBot v11 兼容框架。

### 安装依赖

```bash
npm install
```

### 配置环境变量

复制 `.env.example` 为 `.env`：

```env
API_KEY=your-api-key-here
API_PORT=3001
BIND_HOST=127.0.0.1
```

说明：

- `API_KEY` 优先级高于 `data/bot-config.json`，用于避免把 Key 明文写入配置文件。
- `API_PORT` 是后端 HTTP/WebSocket 端口，默认 `3001`。
- `BIND_HOST` 默认 `127.0.0.1`，只允许本机访问管理接口；如果确实要给局域网设备访问，改为 `0.0.0.0` 前请确认网络环境可信。

### 开发模式

开两个终端：

```bash
node server.js
```

```bash
npm run dev
```

默认地址：

- 管理面板开发服务器：`http://localhost:5173`
- 后端 API 和 WebSocket：`http://localhost:3001`
- NapCat 反向 WebSocket：`ws://127.0.0.1:3001`

### 生产模式

```bash
npm run build
node server.js
```

构建后，后端会托管 `dist/`，可直接打开：

```text
http://localhost:3001
```

### 桌宠模式

仓库不包含人物图片、MMD 模型或托盘图标。使用桌宠前，请准备你自行创作、已获授权或许可允许使用的资源，并按以下路径放置：

```text
public/
├── character.png          # 可选，管理面板人物图片
├── tray_icon.png          # 可选，Electron 托盘图标
└── models/
    └── desktop-pet.pmx    # 桌宠 MMD 模型
```

MMD 模型引用的贴图、材质和其他依赖文件也应放入 `public/models/`，并保持模型内部使用的相对路径。缺少 `character.png` 时管理面板会隐藏人物图片；缺少 `tray_icon.png` 时 Electron 会跳过托盘创建；缺少模型时桌宠页面会显示加载错误。

默认模型地址是 `/models/desktop-pet.pmx`。需要使用其他文件名或目录时，在本地 `.env` 中设置相对于 `public/` 的 URL，例如：

```env
VITE_PET_MODEL_PATH=/models/my-pet.pmx
```

修改 `VITE_PET_MODEL_PATH` 后需要重启 Vite 或 `npm run dev:pet`。

如果默认的 Vite `5173` 端口已被占用，可在本地环境中设置 `VITE_DEV_SERVER_URL`，让 Electron 连接到另一个开发服务器地址。

### 桌宠动作配置

桌宠动作采用 MMD VMD 文件。仓库只提供 `public/pet-manifest.example.json` 配置示例，不包含模型、动作或声音素材。准备好有权使用的动作文件后：

1. 将示例复制为本地 `public/pet-manifest.json`。
2. 将 VMD 文件放入模型资源目录，例如 `public/models/motions/`。
3. 在 manifest 的 `motions` 中填写动作 URL。
4. 在本地 `.env` 设置 `VITE_PET_MANIFEST_PATH=/pet-manifest.json`。
5. 重启 Vite 或 Electron。

manifest 支持以下能力：

- `motions`：动作文件、循环、优先级、淡入淡出、速度和冷却。
- `bones`：不同模型的头部和眼睛骨骼名映射。
- `expressions`：眨眼、微笑、生气、惊讶、悲伤等 Morph 名映射。
- `interactions`：点击头部或身体时触发的动作与表情。
- `events`：机器人注意、思考、说话、生图、主动发言和错误状态对应的动作。

动作控制器会在非循环动作结束后自动返回 `idle`。缺少动作或单个 VMD 加载失败时不会阻止模型显示，而是继续使用无动作降级待机。模型加载后，开发者控制台会输出骨骼、Morph、材质和物理能力报告，便于填写 manifest。

`speaking` 事件会按回复长度驱动 `mouthOpen` Morph 做基础口型。后续接入 TTS 时，可以在保留事件与动作状态机的前提下改用音频振幅驱动。

请勿使用、分发或提交你无权使用的模型、图片、贴图、动作、音频或其他素材。

```bash
npm run electron:dev
```

该命令要求 Vite 已在另一个终端运行。也可以使用会自动启动并等待 Vite 的跨平台联动脚本：

```bash
npm run dev:pet
```

管理面板顶部提供“桌宠”开关。该开关通过本地后端通知 Electron 主进程，因此使用普通 `node server.js` 启动时会显示为不可用；这不会影响机器人和管理面板的其他功能。

## 项目结构

```text
HYACINE-AI/
├── electron/
│   ├── main.js                 # Electron 主进程，启动后端和桌宠窗口
│   └── preload.js              # Electron IPC 桥
├── lib/
│   ├── config.js               # 配置读写与 API Key 脱敏
│   ├── image-gen.js            # 生图请求
│   ├── memory.js               # 会话、摘要、持久化记忆
│   ├── message-handler.js      # OneBot 消息解析、触发、回复
│   ├── paths.js                # 运行时数据路径与旧版迁移
│   ├── proactive.js            # 主动发言引擎
│   └── utils.js                # 通用工具
├── public/
│   └── models/                 # 用户自行放置的桌宠资源，不纳入版本控制
├── data/                       # 本地运行时数据，启动时自动创建
│   ├── avatars/                # 本地角色参考图，面板动态扫描
│   ├── bot-config.json         # 运行时配置
│   ├── bot-sessions.json       # 会话记忆
│   ├── bot-summaries.json      # 长期摘要，按需生成
│   └── bot-persistent-memory.json # 持久化事实，按需生成
├── src/
│   ├── components/             # React 配置面板组件
│   ├── hooks/                  # 配置与 WebSocket Hook
│   ├── pet/                    # Three.js 桌宠入口
│   │   ├── config/             # Manifest 加载与默认语义映射
│   │   ├── hooks/              # 桌宠 WebSocket 事件
│   │   ├── runtime/            # 动作、表情、注视与模型诊断
│   │   └── ui/                 # 桌宠覆盖层控件
│   ├── App.jsx
│   └── main.jsx
├── server.js                   # Express + WebSocket 后端入口
└── package.json
```

## 配置字段

| 字段 | 说明 |
| --- | --- |
| `botQQ` | 机器人 QQ，用于检测 @ 消息 |
| `masterQQ` | 主人 QQ，用于主人身份提示词 |
| `customKeywords` | 唤醒词列表，命中消息开头时触发 |
| `alwaysReply` | 回复所有群消息，建议谨慎开启 |
| `apiEndpoint` | OpenAI 兼容文本接口地址 |
| `apiKey` | API Key；有 `.env` 时保存文件会留空 |
| `modelName` | 文本模型 |
| `imageModel` | 生图模型 |
| `imageEndpoint` | 可选，单独指定生图接口；为空时使用 `apiEndpoint` |
| `temperature` | 文本模型温度 |
| `maxReplyLength` | 注入系统提示的回复长度上限 |
| `enableSplit` | 启用拟人化分段发送 |
| `optimizeImgPrompt` | 让文本模型优化/翻译生图提示词 |
| `shortMem` | 短期记忆保留轮数 |
| `longMem` | 长期摘要触发比例，`0` 表示关闭 |
| `persistMem` | 开启跨会话事实提取 |
| `enableProactive` | 开启主动发言 |
| `proactiveInterval` | 主动发言检查间隔，秒 |
| `proactiveCooldown` | 同一群主动发言冷却，秒 |
| `proactiveThreshold` | 主动发言最低置信度 |
| `proactiveContextSize` | 主动发言判断使用的最近群消息条数，范围 `3-50` |
| `proactiveTargetGroups` | 指定主动发言群号；为空表示全部群 |
| `enableDesktopAwareness` | 启用 Electron 桌面感知；默认关闭 |
| `desktopAwarenessInterval` | 桌面视觉分析最短间隔，范围 `30-900` 秒 |
| `desktopAwarenessCooldown` | 两次桌面互动之间的冷却，范围 `60-3600` 秒 |
| `desktopAwarenessMaxTokens` | 桌面视觉回复最大输出 Token，范围 `256-10000`，默认 `4000` |
| `desktopAwarenessMaxReplyLength` | 桌面气泡最大字符数，范围 `80-800`，默认 `300`；超长回复优先按完整句子截取 |
| `desktopAwarenessChangeThreshold` | 截图上传前的本地画面变化阈值，范围 `0.02-0.5` |
| `desktopAwarenessExcludedTerms` | 截图前排除的前台应用名、进程名或包标识关键词 |
| `desktopAwarenessHidePetFromCapture` | 截图时隐藏桌宠内容；可从托盘菜单切换，默认开启 |
| `currentPersonaFileName` | 生图参考图文件名 |

### 图片理解

图片理解沿用普通消息的触发规则：群聊中需要 @ 机器人、使用句首唤醒词，或开启全量回复；私聊图片会直接处理。文本模型必须支持 OpenAI Chat Completions 的多模态 `image_url` 输入格式。

- 支持 OneBot 结构化图片消息和 `[CQ:image,...]` 消息。
- 单条消息最多读取 3 张图片，每张最大 6 MB，下载超时为 15 秒。
- 图片仅用于当前模型请求；会话 JSON 只保存图片数量占位，不保存图片 Base64。
- 如果所配置的文本模型不支持视觉输入，模型 API 会返回错误，需要在面板中换用视觉模型。
- 正常聊天触发生图时，当前消息的图片会继续传给生图模型；本地选中的角色图保持主角身份，聊天图片不会覆盖角色基底。

## QQ 管理指令

以下指令可清空当前会话记忆：

- `/reset`
- `/clear`
- `重置记忆`
- `忘记一切`

群聊中只有 `masterQQ` 可以执行；私聊中默认允许执行。

## 本地数据

配置、会话记录和角色参考图保存在本地 `data/` 目录。首次启动会自动创建所需文件和目录；旧版根目录数据存在时会迁移到该目录，且不会覆盖已有目标文件。环境变量可写入本地 `.env`，格式参见 `.env.example`。

后端默认监听 `127.0.0.1`。将 `BIND_HOST` 改为其他地址前，请自行配置访问控制并评估所在网络环境。

## 管理面板 UI

- 页面保留粉色二次元毛玻璃、看板娘和气泡视觉，使用顶部标签导航与统一内容区布局。
- 面板底部可隐藏 Web 看板娘或调整立绘大小；偏好保存在当前浏览器，隐藏后配置面板自动居中。
- 输入框、文本框、按钮、图标按钮、开关、滑块和分区由 `src/components/UIComponents.jsx` 统一维护。
- 桌宠开关调用 `/api/desktop-pet`，仅 Electron 子进程模式可以控制桌宠窗口。
- 桌宠通过独立 WebSocket 事件响应注意、思考、回复、生图、主动发言和错误状态。
- 桌面互动通过气泡展示，并复用桌宠的 `speaking` 动作与口型。

### 桌面感知

桌面感知仅在 Electron 桌宠模式下可用，并且默认关闭。可在“连接与触发 -> 桌面感知”中开启。macOS 首次开启时需要在系统设置中授予屏幕录制权限。

- 每 5 秒只在本地检查一次前台应用和低清画面变化，不因此调用模型。
- 截取主显示器画面，避免依赖不同应用的窗口标题和窗口源格式。
- 前台应用识别失败、用户空闲超过 60 秒或应用命中隐私排除关键词时直接跳过。
- 截图压缩为最高约 `960x540` 的 JPEG，只驻留内存，不写入配置、日志或会话记录。
- 屏幕内容始终作为不可信观察数据，网页或应用内文字不会被当作系统指令执行。
- 托盘菜单中的“桌面感知”复选项会直接启用或停用已保存配置。
- 托盘菜单中的“截图中隐藏桌宠”可切换内容保护；关闭后允许桌宠结合自身与桌面内容互动。
- 隐藏桌宠窗口时会立即停止画面采集；重新显示后恢复观察。

默认最短分析间隔为 120 秒，互动冷却为 300 秒。只有画面相对上次分析出现明显变化，并且视觉模型给出的互动分数达到阈值时，桌宠才显示气泡。按默认值，理论上每小时最多分析约 30 次；实际次数通常会因画面变化、冷却、空闲检测和隐私排除进一步降低。

## 常用命令

```bash
npm run dev          # 前端开发服务器
npm run build        # 构建前端
npm run lint         # 静态检查
npm run preview      # 预览前端构建
npm run electron:dev # 桌宠开发模式
npm run pack:dir     # 构建当前平台的 Electron 目录包
npm run dist:win     # 构建 Windows x64 NSIS 安装包
```

Electron 安装产物输出到 `release/`。打包采用资源白名单，不包含 `.env`、`data/`、个人预设或 `public/models_fengjin/`；只有放入 `public/models/` 且确认允许再分发的模型资源才会进入本地安装包。

## 许可

项目源代码采用 [MIT License](./LICENSE) 发布。

第三方依赖及用户自行添加的模型、图片等资源适用各自的许可条款，不因本项目采用 MIT License 而获得授权；本仓库不授予这些外部资源的任何权利。
