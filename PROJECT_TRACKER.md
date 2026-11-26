# 工程维护概览

当前版本：**1.4.0**。版本变化见 [CHANGELOG.md](./CHANGELOG.md)，安装与使用见 [USER_GUIDE.md](./USER_GUIDE.md)。

## 模块职责

| 层级 | 主要文件 | 职责 |
| --- | --- | --- |
| 服务入口 | `server.js` | 管理 API、静态资源、渠道装配、运行状态 |
| QQ 接入 | `qq-transport.js`、`onebot-client.js`、`qq-official.js` | 连接生命周期、协议适配、鉴权与发送确认 |
| 对话运行时 | `message-chain.js`、`conversation-runtime.js`、`message-handler.js` | 消息规范化、会话队列、去重、失效控制、回复提交 |
| 群聊决策 | `group-social.js`、`group-topics.js`、`proactive.js`、`group-replay.js` | 成员身份、话题关联、主动参与与隔离回放 |
| 上下文与记忆 | `context-budget.js`、`chat-completion.js`、`memory.js`、`learned-memory.js` | 预算、召回、摘要、证据约束与持久化 |
| 存储与管理 | `session-history-store.js`、`session-history-api.js`、`management-edits.js`、`config.js` | 旧会话迁移、分页、并发编辑与原子写入 |
| 运行统计 | `usage-metrics.js`、`UsageMetrics.jsx` | 按日、群和任务类型汇总用量、结果与耗时 |
| 扩展 | `lib/extensions/` | 视频资料、表情教学与选择、NapCat 短语音输入、短期表达状态 |
| 前端 | `src/components/`、`src/hooks/`、`src/styles/` | 工作区、可复用表单、独立数据状态与场景呈现 |
| 桌面 | `electron/`、`src/pet/` | 原生窗口、桌宠动画、交互及桌面感知 |

## 数据与并发约束

- 每个会话按队列处理；重置和渠道切换使旧任务失效。
- 发送成功后写入已确认历史，失败或结果未知不自动重发。
- 记忆与群内资料按作用域筛选；单角色偏好可以共享，成员资料不得跨群误归属。
- 情绪状态仅在进程内保存；长期偏好与教学内容进入原有长期记忆管理。
- 收到 QQ 回执后按会话持久化近期历史和摘要。切换存储前从旧 JSON 导入数据，完成导入后才启用新目录。
- 配置按字段、长期记忆和历史消息按条目校验编辑基线。过期的整表覆盖请求返回冲突，调用方可重新读取并核对。
- WebUI API 及模型错误保持可见，失败请求不清除未提交草稿。

## 发布验证

1.4.0 共通过 199 项自动化测试。发布检查包括 ESLint、生产构建及资源边界扫描。

本版回归覆盖多话题取消与发送回执、引用教表情、转写凭据隔离、编辑冲突、历史迁移与重启恢复、用量聚合，以及攀爬进度和动作切换。

模拟接口与隔离服务测试不等于真实平台联调。QQ 权限、B 站公开接口、模型格式遵循和实际群聊表达效果仍需部署环境验证。当前源码发布不包含已验证的 Windows 安装包。

## 已知限制与扩展方向

- 词法记忆召回对同义词的覆盖有限，可通过独立检索适配层增加语义检索。
- 角色偏好目前使用单角色共享作用域；短期表达状态已按人设指纹隔离。
- 临时话题使用有界线索，短促或缺乏共同词汇的回复仍可能产生歧义。可在多人回放中校准实际片段。
- 近期历史已按会话分文件，每次保存仍需序列化该会话的当前窗口。长期记忆沿用独立 JSON 文件。
- 表情教学支持引用单图。GIF 关键帧理解仍待扩展。
- B 站登录字幕、按需画面分析以及语音输出属于独立扩展方向。

## 文档导航

- [消息处理架构](./BOT_LOGIC.md)
- [QQ 渠道配置](./QQ_CHANNELS.md)
- [WebUI](./WEBUI_GUIDE.md)
- [聊天扩展](./EXTENSIONS_GUIDE.md)
- [人格与记忆设计](./HUMANIZATION_RESEARCH.md)
- [角色表达](./CHARACTER_GUIDE.md)
- [桌宠动作](./COMPANION_GUIDE.md)
- [渲染](./RENDERING_GUIDE.md)
- [菜单与尺寸交互](./CONTROLS_GUIDE.md)
