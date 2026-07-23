# HYACINE-AI

一个面向 QQ 群聊的本地化 AI 机器人与桌宠项目。通过 NapCat / OneBot v11 接收 QQ 消息，连接 OpenAI Chat Completions 兼容模型，并提供角色设定、图片理解、生图、记忆、主动发言、Web 管理面板和 Electron 桌面互动。

[![CI](https://github.com/Byldxxy/HYACINE-AI/actions/workflows/ci.yml/badge.svg)](https://github.com/Byldxxy/HYACINE-AI/actions/workflows/ci.yml)
[![Release](https://img.shields.io/badge/release-v1.2.1-ef5da8)](https://github.com/Byldxxy/HYACINE-AI/tree/v1.2.1)
[![License](https://img.shields.io/badge/license-MIT-2f855a)](./LICENSE)

- [零基础使用手册](./USER_GUIDE.md)：安装 Git/Node.js、拉取源码、运行测试、连接 NapCat、生成 Windows EXE。
- [项目维护跟踪](./PROJECT_TRACKER.md)：系统架构、模块职责、工程保障、验证状态、已知限制和路线图。

## 核心能力

### QQ 对话

- 支持 NapCat / OneBot v11 反向 WebSocket。
- 支持 @ 机器人、句首唤醒词和全量回复三种触发方式。
- 识别群聊发送者昵称、QQ、主人身份和群聊环境。
- 兼容 OpenAI Chat Completions 风格的文本模型服务。
- 支持拟人化分段发送和会话重置指令。

### 图片理解与生图

- 消息触发机器人且附带图片时，可交给支持视觉输入的文本模型理解。
- 当前消息图片只进入本次模型请求，不把 Base64 写入会话文件。
- 正常聊天触发生图时，可同时使用本地角色基底图和聊天参考图。
- 文本模型端点、生图端点和模型名称均由用户配置，不包含私人服务商默认值。

### 记忆与主动互动

- 短期上下文窗口、长期摘要和跨会话事实记忆。
- 群聊主动发言支持检查间隔、冷却、置信度、上下文条数和目标群配置。
- 配置、会话、摘要和长期事实采用校验、串行原子写入与备份恢复。

### Web 管理面板

- 集中管理连接、模型、人设、记忆、主动发言和桌面感知。
- 内置对话测试、图片测试、实时日志和脱敏诊断导出。
- 看板娘支持隐藏和尺寸调节；隐藏后配置面板自动居中。
- 首次启动保持 API Endpoint、模型名称、Key 和角色预设为空。

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
git checkout v1.2.1
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

仓库不包含第三方人物图片、MMD 模型、贴图、VMD 动作或音频。请只使用自行创作、已获授权或许可证允许使用的资源。

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
│   ├── hooks/                # 配置、日志、桌宠状态 Hooks
│   └── pet/                  # Three.js 桌宠运行时、配置和覆盖层
├── test/                     # Node.js 单元与集成测试
├── server.js                 # Express / WebSocket 后端入口
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

当前源码版本为 `1.2.1`。已完成能力、稳定设计约束、验证基线、已知限制和后续优先级统一维护在 [PROJECT_TRACKER.md](./PROJECT_TRACKER.md)。

## 许可证

项目源代码采用 [MIT License](./LICENSE)。

第三方依赖和用户自行添加的模型、图片、贴图、动作、音频等资源适用各自许可证。HYACINE-AI 的 MIT License 不会自动授予这些外部资源的使用或再分发权。
