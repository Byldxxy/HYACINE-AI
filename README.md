# HYACINE-AI - QQ 群 AI 聊天机器人管理面板

一个基于 React + Express 的 QQ 群 AI 机器人管理面板，通过 NapCat / OneBot v11 与 QQ 通信，支持角色扮演、OpenAI 兼容文本模型、生图、会话记忆、主动发言和桌宠模式。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React 19, Vite 7, TailwindCSS 3, Framer Motion |
| 后端 | Express 5, ws, OpenAI SDK |
| 桌宠 | Electron, Three.js MMD |
| 存储 | JSON 文件 |
| QQ 协议 | NapCat / OneBot v11 |
| 打包 | pkg, Vite |

## 功能

- AI 对话：兼容 OpenAI Chat Completions 格式，可配置 API Endpoint、文本模型、温度和回复长度。
- AI 生图：支持普通生图和挂载角色参考图的生图流程。
- 直连生图：`/img`、`/draw` 可跳过文本模型，直接调用生图接口。
- 触发机制：支持 @ 机器人、自定义唤醒词、全量回复模式。
- 群聊身份识别：群聊消息会注入发送者昵称/QQ，主人 QQ 会单独标记。
- 记忆系统：短期记忆、长期摘要、跨会话持久化事实、面板编辑/删除。
- 主动发言：机器人可观察群聊，在满足阈值和冷却条件时主动插话。
- 实时日志：前端通过 WebSocket 接收后端日志。
- 桌宠模式：Electron 启动后端并显示可拖拽 MMD 桌宠。
- 桌宠开关：Electron 模式下可从管理面板顶部或托盘菜单显示/隐藏桌宠窗口。

## 快速开始

### 前置条件

- Node.js 18 或更高版本。
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

请勿使用、分发或提交你无权使用的模型、图片、贴图、动作、音频或其他素材。

```bash
npm run electron:dev
```

或使用开发联动脚本：

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
| `proactiveTargetGroups` | 指定主动发言群号；为空表示全部群 |
| `currentPersonaFileName` | 生图参考图文件名 |

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
- 输入框、文本框、按钮、图标按钮、开关、滑块和分区由 `src/components/UIComponents.jsx` 统一维护。
- 桌宠开关调用 `/api/desktop-pet`，仅 Electron 子进程模式可以控制桌宠窗口。

## 常用命令

```bash
npm run dev          # 前端开发服务器
npm run build        # 构建前端
npm run lint         # 静态检查
npm run preview      # 预览前端构建
npm run build:exe    # 打包 Windows exe
npm run electron:dev # 桌宠开发模式
```

## 许可

项目源代码采用 [MIT License](./LICENSE) 发布。

第三方依赖及用户自行添加的模型、图片等资源适用各自的许可条款，不因本项目采用 MIT License 而获得授权；本仓库不授予这些外部资源的任何权利。
