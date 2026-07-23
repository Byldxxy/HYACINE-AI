# HYACINE-AI Project Tracker

本文档是项目公开的维护快照，集中记录当前架构、已实现能力、稳定设计约束、工程保障、验证基线、已知限制和后续路线。使用教程见 [USER_GUIDE.md](./USER_GUIDE.md)，项目入口见 [README.md](./README.md)。

## 项目状态

| 项目 | 当前状态 |
| --- | --- |
| 当前版本 | `1.2.1` |
| 主分支 | `main` |
| Node.js | `>=22.12.0` |
| QQ 协议 | NapCat / OneBot v11 反向 WebSocket |
| WebUI | React 19 + Vite 7 + TailwindCSS 3 |
| 后端 | Express 5 + ws + OpenAI SDK |
| 桌宠 | Electron + Three.js MMD |
| 数据 | 本地 JSON + Zod + 原子写入/备份恢复 |
| Windows 打包 | Electron Builder + NSIS x64 |
| CI | GitHub Actions：Windows、macOS、Linux |
| 源码许可证 | MIT |

### 能力完成度

| 能力域 | 状态 | 说明 |
| --- | --- | --- |
| QQ 文本对话 | 可用 | @、句首唤醒词、全量回复、身份和群聊上下文 |
| 图片理解 | 可用 | 当前消息多图输入，需要兼容多模态的文本模型 |
| 聊天触发生图 | 可用 | 本地角色基底图 + 当前聊天参考图 |
| 记忆系统 | 可用 | 短期上下文、长期摘要、跨会话事实 |
| 主动发言 | 可用 | 间隔、冷却、阈值、上下文条数、目标群 |
| Web 管理面板 | 可用 | 配置、记忆、测试、日志、脱敏诊断 |
| MMD 桌宠 | 可用 | 模型、VMD、表情、注视、点击和事件状态 |
| 桌面感知 | 可用，默认关闭 | 主显示器采样、变化筛选、隐私排除、动态气泡 |
| Windows 安装包 | 可构建 | NSIS x64；尚未签名，缺少正式图标 |
| TTS | 未实现 | 当前仅有基于说话时长的基础口型 |

## 运行架构

```text
QQ message
    │
    ▼
NapCat / OneBot v11 reverse WebSocket
    │
    ▼
server.js
    ├── lib/message-handler.js
    │      ├── trigger / identity / session queue
    │      ├── lib/chat-completion.js
    │      ├── lib/vision.js
    │      ├── lib/image-gen.js
    │      └── send_msg -> NapCat -> QQ
    ├── REST management API -> React WebUI
    ├── WebSocket logs / pet:event -> WebUI and pet renderer
    ├── lib/memory.js -> local JSON stores
    └── lib/proactive.js -> proactive group interaction

Electron main process
    ├── utilityProcess.fork(server.js)
    ├── BrowserWindow -> pet.html
    ├── Tray / global cursor / window controls
    └── desktop-observer.js
           ├── foreground-app privacy filter
           ├── primary-display capture
           ├── local change detection
           └── desktop-awareness.js -> visual model -> pet:event
```

### 进程边界

| 进程 | 主要职责 | 通信方式 |
| --- | --- | --- |
| 浏览器 WebUI | 配置、记忆管理、测试和日志展示 | HTTP + WebSocket |
| Node 后端 | OneBot、模型请求、数据持久化和业务规则 | HTTP + WebSocket |
| Electron 主进程 | 桌面窗口、托盘、截屏、全局鼠标和子进程生命周期 | Electron IPC + utility process IPC |
| 桌宠渲染进程 | Three.js MMD、动作、表情、气泡和右键菜单 | preload 暴露的白名单 IPC + WebSocket |

## 核心模块

### 后端

| 文件 | 职责 |
| --- | --- |
| `server.js` | Express、WebSocket、管理 API、模块装配和进程生命周期 |
| `lib/message-handler.js` | OneBot 消息触发、会话队列、回复和生图流程 |
| `lib/chat-completion.js` | QQ 与 WebUI 测试共用的提示词、记忆和文本模型请求 |
| `lib/vision.js` | OneBot 图片提取、受控下载和多模态内容构建 |
| `lib/image-gen.js` | 文生图/参考图请求与角色基底优先级 |
| `lib/memory.js` | 会话、摘要、持久化事实和摘要触发 |
| `lib/proactive.js` | 群聊观察、主动发言判断、冷却和目标群筛选 |
| `lib/desktop-awareness.js` | 桌面画面模型请求、输出规范化和互动冷却 |
| `lib/config.js` | 配置加载、保存、API Key 环境变量覆盖和脱敏 |
| `lib/schemas.js` | 配置、会话、摘要和事实的 Zod 边界 |
| `lib/json-store.js` | 串行写入、临时文件替换、备份和恢复 |
| `lib/paths.js` | 源码、安装态和测试态数据目录约定 |
| `lib/diagnostics.js` | 不包含敏感内容的运行诊断报告 |
| `lib/parent-ipc.js` | 普通 Node 与 Electron utility process 的 IPC 适配 |

### WebUI

| 文件 | 职责 |
| --- | --- |
| `src/components/ConfigPanel.jsx` | 配置面板主容器和保存入口 |
| `src/components/UIComponents.jsx` | 共享表单控件、按钮、分区和布局原语 |
| `src/components/tabs/*.jsx` | 连接、模型、人设、记忆和测试页面 |
| `src/hooks/useConfig.js` | 默认配置、加载、编辑和完整快照保存 |
| `src/hooks/useWebSocket.js` | WebUI 日志 WebSocket 生命周期 |
| `src/hooks/useDesktopPet.js` | Electron 桌宠可用状态和显示控制 |
| `src/hooks/useDesktopAwareness.js` | 桌面感知运行状态 |
| `src/lib/api.js` | 浏览器端 API、WebSocket 和资源 URL 推导 |

### Electron 与桌宠

| 文件 | 职责 |
| --- | --- |
| `electron/main.js` | utility process、透明窗口、托盘、全局鼠标、显示状态和 IPC |
| `electron/preload.js` | 向渲染进程暴露最小化 Electron 能力 |
| `electron/desktop-observer.js` | 主显示器采样、权限、隐私排除、变化检测和截图压缩 |
| `src/pet/PetScene.jsx` | Three.js 场景、模型加载、窗口尺寸和交互协调 |
| `src/pet/config/petManifest.js` | 本地 manifest、骨骼/Morph 映射和事件配置 |
| `src/pet/runtime/MotionController.js` | VMD 优先级、冷却、淡入淡出和待机回退 |
| `src/pet/runtime/ExpressionController.js` | Morph 表情、眨眼和基础说话口型 |
| `src/pet/runtime/LookAtController.js` | 全局鼠标驱动的头部/眼睛注视 |
| `src/pet/runtime/modelDiagnostics.js` | 骨骼、Morph、材质和物理能力报告 |
| `src/pet/ui/PetOverlay.jsx` | 气泡、状态、右键菜单和临时测试入口 |

## 稳定设计约束

以下约束用于避免不同入口、运行模式和发行包之间出现行为漂移。

### 配置与模型请求

1. 文本模型采用 OpenAI Chat Completions 兼容接口。
2. `apiEndpoint`、`modelName`、`imageEndpoint` 和 `imageModel` 由 WebUI 保存；新安装不携带私人默认值。
3. `.env` 的 `API_KEY` 优先于 `data/bot-config.json`，用于避免 WebUI 将真实 Key 写盘。
4. `imageEndpoint` 为空时可复用文本服务端点；生图仍要求显式配置模型。
5. QQ 对话与 WebUI 对话测试必须复用 `lib/chat-completion.js`，避免提示词、视觉输入和记忆结构分叉。
6. 同一 `sessionId` 的消息通过 Promise 队列串行处理，不同会话可以并行。

### 数据持久化

1. 源码模式使用项目 `data/`；安装版使用操作系统 `userData`；测试可通过环境变量隔离目录。
2. 配置、会话、摘要和事实写入前经过 Zod 校验。
3. 同一文件的写入串行化，并使用临时文件、刷新、原子替换和 `.bak` 恢复。
4. 管理 API 的无效数据返回结构化 `400`，写入异常返回结构化 `500`。
5. 运行时 JSON、角色参考图和私人配置不得进入 Git 或公开构建。

### 图片和网络边界

1. 单条消息最多读取 3 张图片，每张最大 6 MB，总请求受 15 秒超时约束。
2. 仅接受 HTTP/HTTPS 图片，拒绝嵌入凭据、本地主机、私网、回环、链路本地和保留地址。
3. 最多跟随 3 次重定向，每一跳重新执行 URL、DNS 和 IP 校验。
4. 聊天图片只进入当前模型请求，会话文件仅保存图片数量占位。
5. 本地角色图片是生图身份基底，聊天图片只作为姿势、构图、场景或风格参考。

### Electron 与桌面感知

1. 后端在 Electron utility process 中运行，主进程等待明确的 `server-ready` 后再创建窗口。
2. 后端异常退出采用有限次数退避重启，应用保持单实例。
3. 桌面感知默认关闭，只截取主显示器，截图驻留内存且不进入 QQ 记忆。
4. 截图上传前执行前台应用隐私排除、用户空闲检查和本地画面变化筛选。
5. 桌宠隐藏时暂停截图和视觉模型调用；重新显示后恢复观察。
6. 内容保护开关决定桌宠是否出现在截图中，允许用户在隐私保护和自我互动之间选择。
7. 桌面回复的 Token 预算与气泡字符上限独立；超长文本优先按完整句子结束。
8. 气泡按文本实测高度扩展 Electron 窗口，不使用内部滚动条，并固定人物脚部位置。
9. 固定间隔和右键强制桌面分析在视觉请求期间统一播放循环思考动作，并在回复、静默或失败后显式结束并返回待机。

### 本地视觉资源

1. 仓库只提供 `public/pet-manifest.example.json`，不提交第三方模型、贴图、动作和个人图片。
2. 开发态从 `public/` 读取本地资源；生产构建不自动复制整个 `public/`。
3. Electron Builder 只复制明确白名单中的运行资源。
4. 单个 VMD 缺失不阻止模型显示，运行时降级为无动作待机。

## 主要配置分组

| 分组 | 关键配置 | 说明 |
| --- | --- | --- |
| OneBot | `botQQ`, `customKeywords`, `alwaysReply` | 机器人身份与消息触发 |
| 文本模型 | `apiEndpoint`, `apiKey`, `modelName`, `temperature` | OpenAI 兼容对话服务 |
| 生图 | `imageEndpoint`, `imageModel`, `optimizeImgPrompt` | 生图服务和提示词处理 |
| 人设 | `charName`, `systemPrompt`, `masterQQ`, 身份附加提示 | 角色和场景身份 |
| 记忆 | `shortMem`, `longMem`, `persistMem` | 短期、摘要和长期事实 |
| 主动发言 | `enableProactive`, 间隔、冷却、阈值、上下文、目标群 | 群聊主动互动 |
| 桌面感知 | `enableDesktopAwareness`, 间隔、冷却、Token、字符、变化阈值、排除词 | 桌宠画面互动 |
| 本地角色 | `currentPersonaFileName` | 生图身份基底图 |

## 工程保障

### 跨平台启动与安装

- `scripts/dev-pet.js` 提供 Windows、macOS、Linux 通用的 Vite + Electron 开发启动。
- Electron Builder 提供当前平台目录包和 Windows NSIS x64 安装包。
- 安装态页面和资源由本地后端通过 HTTP 提供，避免 `file://` 与根路径资源不一致。
- 安装态数据写入用户目录；源码态继续使用项目 `data/`。

### 输出与桌宠体验

- 桌面模型回复支持纯文本、结构化内容和兼容内容数组的统一规范化。
- 智能优化生图提示词仅在配置值明确为 `true` 时启用；关闭时聊天模型只判定生图意图，生图 API 固定接收当前用户清洗后的原始文本，不使用模型翻译或扩写结果。
- 生图 prompt 先构建 `text-only`、`identity-only`、`reference-only` 或 `multi-source` 生成计划，再序列化请求。多图计划使用“主构图参考 / 角色身份参考 / 补充参考”语义标签：主构图图片首先上传以规避首图 img2img 锁定，身份图片只提供面部、发型、发色、瞳色和头饰；人体比例独立协调，明确换装时主构图图片同时提供服装设计。
- 气泡字符限制采用句末优先的自然截取，避免在半句话中间截断。
- 气泡高度、原生窗口尺寸和人物锚点联动，不产生内部滚动条或人物跳动。
- 全局鼠标坐标由 Electron 主进程采样，注视不受透明窗口范围限制。
- VMD 切换使用 AnimationMixer 的统一时钟推进骨骼淡入淡出；旧 action 在下一帧 MMD 求解前退出，仅同步其独占轨道，并强制当前动作达到完整权重，使 idle、IK、Grant 和物理从干净基准计算。头发和衣物物理在动作间连续运行；用户点击动作优先于桌面分析事件。
- VMD 加载时自动移除 Grant 派生骨和动态刚体骨的动画轨道，避免包含全骨骼静态关键帧的外部动作与腿部派生、头发及衣物求解器重复写入。

### 数据完整性

- Zod 统一覆盖磁盘加载和管理 API 输入。
- JSON 写入队列防止并发覆盖，原子替换降低进程中断造成的文件损坏。
- 主文件不可用时可从最近备份恢复。
- 配置版本字段为后续迁移提供边界，未知字段保留以支持兼容扩展。

### 安全与发布边界

- 图片下载包含 URL、DNS、IP 和逐跳重定向验证，降低 SSRF 风险。
- 后端默认绑定 `127.0.0.1`；跨域仅允许本机来源。
- 诊断导出只包含平台、状态和计数，不包含 Key、端点、模型名、提示词、窗口标题、消息、摘要或事实。
- `scripts/check-release-boundary.js` 阻止本地运行数据和模型资源进入 Git 跟踪或 Vite 构建。
- `.gitignore` 排除 `.env`、`data/`、本地视觉资源、构建产物和安装包。

### 自动化验证

- Node.js 测试覆盖共享模型请求、桌面感知、桌面源选择、诊断脱敏、生图参考图、配置/记忆持久化、主动发言和图片网络边界。
- 隔离后端集成测试验证启动、Electron 不可用降级、配置/记忆校验和诊断脱敏。
- GitHub Actions 在 Ubuntu、macOS 和 Windows 上执行 `npm ci`、lint、测试、生产构建和发布边界检查。
- 手动工作流可在 Windows runner 生成 NSIS 安装包 artifact。

## 版本 1.2.1 验证基线

| 检查 | 状态 |
| --- | --- |
| `npm run lint` | 通过 |
| `npm test` | 46 项测试均已验证；受限沙箱中的回环测试另在可监听环境通过 |
| `npm run build` | 通过 |
| `npm run check:release` | 通过 |
| GitHub Actions 三平台 CI | 通过 |
| `npm audit` | 发布时为 0 个已知漏洞 |
| Windows NSIS 构建链路 | 已验证可生成 x64 安装包 |
| 私有资源审计 | `.env`、运行时数据、预设、模型、贴图和动作未进入公开提交 |

## 发布边界

### 不进入公开仓库

- `.env` 和真实 API Key。
- `data/` 中的配置、会话、摘要、长期事实和角色图片。
- `public/character.*`、`public/tray_icon.*`、`public/pet-manifest.json`。
- `public/models/` 及其他本地模型目录中的模型、贴图和动作。
- `release/` 中的本地安装包。

### 可以公开维护

- 源码、测试、CI、构建配置和 MIT License。
- `.env.example` 中的非敏感占位符。
- `public/pet-manifest.example.json` 中的资源路径示例。
- 不包含私人端点、模型名和角色内容的默认配置结构。

## 已知限制

| 限制 | 影响 | 后续方向 |
| --- | --- | --- |
| Windows 安装包未签名 | SmartScreen 可能拦截 | 配置代码签名证书 |
| 缺少正式 `.ico` | 安装包使用默认 Electron 图标 | 增加品牌图标资源 |
| WebUI 输入的 Key 可明文写入本地配置 | 本机文件读取者可见 | 优先使用 `.env`；评估 Electron `safeStorage` |
| 管理 API 无独立认证 | 本机其他进程可访问默认端口 | 增加可选本地 token |
| DNS 校验与实际 fetch 分两次解析 | 极端条件仍存在 DNS rebinding 理论窗口 | 使用可固定已验证地址的 dispatcher |
| 桌面感知依赖操作系统权限 | 首次使用需要授权，平台行为有差异 | 扩充真实 Windows/macOS 烟测 |
| 桌宠主 bundle 较大 | 构建产生 chunk 警告 | 拆分 Three.js/MMD 懒加载边界 |
| Three.js 固定 `0.170.0` | 升级受 MMD API 兼容性约束 | 迁移已弃用的 MMD helper 后再升级 |
| 暂无 TTS | 发言只显示气泡和模拟口型 | 设计可替换的本地/远端语音适配层 |

## 路线图

### P0：发行质量

- 在真实 Windows 10/11 环境完成安装、升级、重启持久化、卸载和桌面感知烟测。
- 增加正式应用图标和 Windows 代码签名。
- 为发布流程增加安装包校验和版本化 Release artifact。

### P1：安全与可维护性

- 为管理 API 增加默认关闭、可选启用的本地访问 token。
- 评估 Electron `safeStorage` 与普通 Node 模式兼容的 Key 存储方案。
- 为智能分段、主动发言兼容解析和摘要触发补充边界测试。
- 拆分桌宠大体积依赖，降低首次加载和构建 chunk 体积。

### P2：桌宠体验

- 收集并验证获得授权的 idle、attention、thinking、speaking、greet 等 VMD 动作。
- 增加基于动作能力检测的设置反馈和 manifest 校验工具。
- 设计 TTS 适配接口，并使用音频振幅替换模拟口型。
- 评估可选的桌面场景规则或本地轻量识别器，同时保留通用视觉模型降级路径。

## 维护流程

提交功能前至少执行：

```bash
npm run lint
npm test
npm run build
npm run check:release
git diff --check
```

涉及以下边界时同步更新文档和测试：

- 新增配置字段：更新 `types.js`、前端默认值、表单、后端使用点和 Schema。
- 修改模型请求：同步 QQ 对话、WebUI 测试、视觉输入和错误处理。
- 修改 Electron IPC：同步主进程、preload、渲染端和不可用降级。
- 修改桌宠事件：同步后端事件名、manifest 默认映射和运行时控制器。
- 修改持久化文件：提供迁移、校验、原子写入和恢复测试。
- 修改打包资源：重新执行发布边界和安装包内容审计。

## 发布历史

| 版本 | 主要内容 |
| --- | --- |
| `v1.0.0` | 初始公开版本、MIT License、基础 WebUI 与机器人能力 |
| `v1.1.0` | 桌宠、桌面感知、图片理解与聊天参考生图 |
| `v1.2.0` | Electron/Windows 打包链路、持久化与安全边界、共享请求模块、诊断、跨平台 CI、完整使用手册 |
| `v1.2.1` | 多源参考生图计划、原文提示词开关修复、桌面分析思考状态、MMD 动作过渡与物理解算兼容 |

## 文档导航

- [README.md](./README.md)：项目展示、核心能力和快速开始。
- [USER_GUIDE.md](./USER_GUIDE.md)：面向零基础用户的完整安装、运行和打包说明。
- [LICENSE](./LICENSE)：MIT License。
