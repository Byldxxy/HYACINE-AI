# PROJECT_TRACKER - HYACINE-AI 项目理解与开发跟踪

> 此文件用于快速理解项目全貌和当前维护状态。

## 项目概述

可自定义人设与本地视觉资源的 QQ 群 AI 聊天机器人管理面板。

- 前端：React 19 + Vite 7 + TailwindCSS
- 后端：Express 5 + WebSocket，CommonJS 模块化
- 桌宠：Electron + Three.js MMD
- 通信：NapCat / OneBot v11 反向 WebSocket
- 存储：本地 JSON 文件

## 架构路径

```text
QQ 消息 -> NapCat -> WebSocket(后端) -> lib/message-handler.js
                                      -> 文本模型 / 生图模型
                                      -> send_msg -> NapCat -> QQ

配置面板 -> HTTP API -> server.js -> data/bot-config.json / data/bot-sessions.json
配置面板 <- WebSocket 日志 <- server.js
Electron -> fork(server.js) + 加载 pet.html
Electron 主显示器 + 前台应用 -> 本地变化/隐私筛选 -> lib/desktop-awareness.js -> pet:event 气泡
```

## 核心文件

| 文件 | 职责 |
| --- | --- |
| `server.js` | 后端入口、API、WebSocket、依赖注入、主动发言定时器启动 |
| `lib/message-handler.js` | QQ 消息触发、上下文构建、LLM 调用、生图拦截、分段发送 |
| `lib/memory.js` | 会话记忆、长期摘要、持久化事实 |
| `lib/proactive.js` | 群聊观察、主动发言判断、主动发言定时器 |
| `lib/desktop-awareness.js` | 桌面视觉分析、结构化决策、互动冷却与提示注入防护 |
| `lib/image-gen.js` | 生图 API 请求，支持 `imageEndpoint` / `apiEndpoint` |
| `lib/vision.js` | OneBot 图片提取、下载限制与多模态输入准备 |
| `lib/paths.js` | 运行时数据目录约定与旧版数据迁移 |
| `src/lib/api.js` | 前端 API / WebSocket 地址推导 |
| `src/components/ConfigPanel.jsx` | 配置面板主容器 |
| `src/components/UIComponents.jsx` | 管理面板共享控件与布局原语 |
| `src/components/tabs/*.jsx` | 连接、模型、人设、记忆、测试各 Tab |
| `src/pet/PetScene.jsx` | Three.js MMD 桌宠 |
| `src/pet/config/petManifest.js` | 桌宠资源清单加载、默认骨骼/Morph/事件语义 |
| `src/pet/runtime/*.js` | VMD 动作状态机、表情、注视和模型能力诊断 |
| `src/pet/hooks/usePetEvents.js` | 接收后端桌宠语义事件 |
| `electron/main.js` | Electron 主进程和托盘 |
| `electron/desktop-observer.js` | 主显示器采样、前台应用隐私筛选、变化检测和截图压缩 |

## 当前关键设计

1. 后端默认绑定 `127.0.0.1`，可用 `BIND_HOST` 覆盖。
2. 后端端口来自 `API_PORT` / `PORT`，默认 `3001`。
3. 前端通过 `src/lib/api.js` 推导 API 和 WS 地址；可用 `VITE_API_BASE_URL` 覆盖。
4. `.env` 中的 `API_KEY` 优先于 `data/bot-config.json`。
5. 生图优先使用 `imageEndpoint`，为空时使用 `apiEndpoint` 并自动补 `/chat/completions`。
6. `longMem` 是长期摘要保留比例，`0` 表示关闭摘要。
7. `proactiveThreshold` 已参与主动发言置信度判断。
8. 同一 `sessionId` 的消息处理通过 Promise 队列串行执行，并在完成后清理队列项。
9. 运行时配置、记忆和用户头像统一存放在 `data/`；`lib/paths.js` 会在启动时迁移旧版路径。
10. Electron 桌宠显示状态通过管理面板 -> HTTP API -> Node IPC -> Electron 主进程控制。
11. 桌宠 VMD 资源由本地 manifest 配置；仓库只提交配置示例，不提交第三方动作。
12. 后端通过专用 `pet:event` WebSocket 消息驱动桌宠注意、思考、说话、生图和错误反馈。
13. 桌面感知默认关闭，截取主显示器；截图只驻留内存，并在采集前按前台应用执行隐私排除。
14. 桌面截图先在 Electron 本地执行变化检测和隐私排除，再由独立后端引擎分析，不进入 QQ 会话记忆。
15. 桌宠窗口隐藏时暂停全部桌面采集和模型调用，重新显示后恢复。

## 配置项状态

| 配置项 | 状态 |
| --- | --- |
| `wsUrl` | 后端读取配置时回填当前运行 WebSocket 地址，用于展示和 NapCat 配置参考 |
| `httpPort` | 后端读取配置时回填当前运行端口 |
| `botQQ` | 已用，@ 检测 |
| `customKeywords` | 已用，唤醒词 |
| `apiEndpoint` | 已用，文本模型端点；也作为默认生图端点 |
| `imageEndpoint` | 已用，可单独指定生图端点 |
| `apiKey` | 已用，支持 `.env` 优先和脱敏传输 |
| `modelName` | 已用，文本模型 |
| `imageModel` | 已用，生图模型 |
| `temperature` | 已用 |
| `maxReplyLength` | 已用，注入系统提示 |
| `enableSplit` | 已用，分段发送 |
| `optimizeImgPrompt` | 已用，控制生图提示词模式 |
| `masterQQ` | 已用，主人身份识别 |
| `systemPrompt` | 已用 |
| `masterPrompt` / `strangerPrompt` / `groupPrompt` | 已用 |
| `shortMem` | 已用，短期窗口 |
| `longMem` | 已用，摘要保留比例 |
| `persistMem` | 已用，持久化事实提取 |
| `enableProactive` | 已用 |
| `proactiveInterval` / `proactiveCooldown` / `proactiveThreshold` | 已用 |
| `proactiveContextSize` | 已用，控制主动发言判断读取的最近群消息条数 |
| `proactiveTargetGroups` | 已用，支持纯群号或 `group_群号` |
| `enableDesktopAwareness` | 已用，仅 Electron 模式可用，默认关闭 |
| `desktopAwarenessInterval` / `desktopAwarenessCooldown` | 已用，控制视觉调用频率与互动冷却 |
| `desktopAwarenessMaxTokens` | 已用，控制桌面视觉回复最大输出 Token |
| `desktopAwarenessChangeThreshold` | 已用，控制本地画面变化门槛 |
| `desktopAwarenessExcludedTerms` | 已用，在截图生成前排除敏感前台应用 |
| `currentPersonaFileName` | 已用，生图参考图 |
| `personaTags` | 未使用，原 SD Tags 遗留字段 |

## 近期已完成

- README 重写，移除 Vite 模板残留。
- 后端默认本机绑定，端口支持环境变量。
- 前端 API / WebSocket 地址集中管理。
- 生图端点从硬编码改为配置驱动。
- 主动发言定时器统一到 `lib/proactive.js`。
- 主动发言阈值真正参与判断。
- 长期记忆 `longMem` 改为比例语义。
- ESLint 分离浏览器和 Node 环境，并忽略构建产物/模型资源。
- `.gitignore` 增加构建产物、运行时数据和用户自备视觉资源。
- 运行时 JSON 与用户头像迁移到 `data/`，静态发布资源保留在 `public/`。
- 管理面板保留粉色二次元毛玻璃视觉，所有基础表单控件统一到共享组件。
- 管理面板和托盘菜单增加 Electron 桌宠显示开关。
- 仓库移除第三方模型和图片，视觉资源改为由使用者在本地自行提供。
- @ 或句首唤醒词触发的图片消息支持多模态模型理解，图片不写入会话文件。
- 正常聊天触发生图时支持“本地角色基底图 + 当前聊天参考图”的多图输入与角色优先级约束。
- 桌宠运行时拆分为 manifest、动作、表情、注视、事件和覆盖层模块，支持 VMD 状态机与无动作降级。
- Electron 桌宠支持通用桌面感知、前台应用隐私过滤、本地画面变化筛选和主动互动气泡。

## 后续建议

- 为管理 API 增加可选本地 token。
- 为配置和记忆 API 增加 schema 校验。
- 将 JSON 写入改为临时文件 + rename 的原子写入。
- 为 `smartSplit`、主动发言 JSON 解析、记忆摘要触发补单元测试。
- Three.js 暂固定为 `0.170.0`；升级前需将已弃用的 `MMDAnimationHelper` 迁移到后续维护方案。
