# QQ 接入渠道

在 WebUI「连接 → 接入渠道」选择渠道并保存配置。一次启用一个渠道；旧配置默认使用 NapCat。渠道切换会关闭旧连接并取消旧会话任务，保留已保存的历史记录。

| 渠道 | 连接方式 | 配置 | 当前能力 |
| --- | --- | --- | --- |
| NapCat | 反向 WebSocket | 机器人 QQ、可选 Access Token | 现有 OneBot 聊天、识图、生图、旁听、续聊、主动发言 |
| SnowLuma | 正向 WebSocket | OneBot WS 地址、WS Token、机器人 QQ | 复用 OneBot 消息处理；自动重连、账号离线状态 |
| 官方 QQ Bot | HTTPS Webhook + HTTP API | AppID、AppSecret、可选主人 OpenID、沙箱开关 | QQ 群聊与 C2C 单聊；文本、图片、已获授权事件的续聊与记忆 |

## NapCat

1. 选择 NapCat，复制页面上的反向 WebSocket 地址。
2. 在 NapCat 新建反向 WebSocket 客户端，填入地址。
3. 如需鉴权，在两端配置相同的 Access Token；NapCat 需使用 `Authorization: Bearer <token>` 请求头。
4. 填写机器人 QQ 可校验接入账号，保存后查看连接状态。

已有未配置 Token 的本机反向连接保持兼容。跨机器接入时将地址中的回环主机替换为机器人后端实际可达的地址；后端默认仅监听回环地址。

## SnowLuma

1. 按 [SnowLuma 官方指南](https://snowluma.github.io/en/docs/guide/connect-bot) 部署并登录 QQ；本项目不负责安装或启动 SnowLuma。
2. 在 SnowLuma 启用 **OneBot WebSocket 服务端**，设置监听地址、端口与 WS Token。
3. 本项目选择 SnowLuma，填写该 WS 服务地址与 Token。不要填写 SnowLuma WebUI 或 HTTP API 地址。
4. 填写机器人 QQ，保存配置。后端连接 SnowLuma 并通过 `get_login_info` 或收到的事件确认账号。

同机部署时注意端口冲突：HYACINE-AI 后端默认使用 `3001`，SnowLuma 示例 WS 端口也是 `3001`。可将 SnowLuma WS 改为 `3002`，本项目填写 `ws://127.0.0.1:3002/`。容器或远程机器应使用实际可达的域名/IP；远程连接优先使用 `wss://`。Token 独立填写，不放入 URL。

断开后按 1–30 秒退避重连；停止或切换渠道会取消重连。账号离线事件会更新连接状态。超时或断线导致发送结果未知时，不会自动重发聊天消息。

## 官方 QQ Bot

### 平台与后端配置

1. 在 [QQ 开放平台](https://q.qq.com/) 创建机器人，取得 AppID 和 AppSecret，并开通所需场景权限。
2. 在本项目选择「官方 QQ Bot」，填入 AppID / AppSecret；开发阶段按实际平台配置选择沙箱。
3. 将公网 HTTPS 地址的 **`/api/qqbot/webhook` 路径**反向代理到本机后端的同名路径。保留原始请求体及 `X-Bot-Appid`、`X-Signature-Timestamp`、`X-Signature-Ed25519` 请求头。
4. 在开放平台将回调地址设为 `https://你的域名/api/qqbot/webhook`，订阅 `GROUP_AT_MESSAGE_CREATE` 与 `C2C_MESSAGE_CREATE`。具有全量群消息权限时也可订阅 `GROUP_MESSAGE_CREATE`。
5. 在授权的群聊中 @ 机器人，或向机器人发送单聊消息。成功验签的事件到达后，面板显示「回调已验证」。此状态表示本进程已收到合法事件，并不表示存在 WebSocket 长连接。

公网代理仅暴露该 Webhook 路径，不要将配置、记忆、日志接口或整个管理面板一并公开。平台支持的回调端口以 [事件订阅文档](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/event-emit.html) 为准；通常使用 HTTPS 443。部署公网域名、证书和反向代理由使用者完成。

AppSecret 仅在服务端换取访问凭证和完成 Ed25519 签名/验签。页面读取密钥时返回占位符；保存占位符保留原值，清空输入框则清除保存的密钥。回调验签使用原始请求体，并拒绝超过五分钟时差的请求；服务器需保持时间同步。

### 身份、记忆与能力边界

- 官方平台使用 OpenID，而不是个人 QQ 号。会话与成员标识使用 `qbot_<AppID>_<live|sandbox>_<OpenID>` 命名空间；不同应用、正式/沙箱以及 OneBot 会话互相隔离，不自动合并历史身份。
- 主人识别使用连接页的「主人 OpenID」，无需手动添加上述前缀。群成员 OpenID 与单聊 OpenID 由平台提供，不假定二者一致；目前每个应用配置一个主人标识。
- 官方渠道只处理平台实际推送的消息。仅开通群 @ 事件时无法旁听其他群聊；「回复所有消息」也不能扩大平台权限。
- 本适配器暂不启用定时主动发言，不处理频道及频道私信。已有主动发言配置保留，切回 OneBot 后仍可使用。
- 支持文本回复、图片识别和单张图片发送。图片 URL 由平台转存；Base64 图片使用不超过 5 MB 的直接上传，不提供大文件分片上传。语音/视频收到后保留类型提示，未实现转写和播放。
- 被动回复绑定收到的 `msg_id`，分段使用递增 `msg_seq`；适配器保守限制为五分钟内、群聊最多五次、单聊最多四次。发送确认以平台返回的消息 ID 为准。鉴权、审核、频控及超时失败会记录错误，不自动重发。
- 平台附带的成员提及会保留为带 OpenID 的对象信息；复杂卡片、频道事件和引用消息索引尚未完整适配。

## 代码入口

- `lib/onebot-client.js`：SnowLuma 出站 WebSocket 生命周期。
- `lib/qq-official.js`：官方回调验签、事件转换、凭证缓存及 HTTP 发送。
- `lib/qq-identity.js`：跨渠道身份格式。
- `lib/qq-transport.js`：统一发送入口与 OneBot 回执关联。
- `server.js`：渠道选择、回调路由、运行状态及配置切换。
- `src/components/tabs/ConnectTab.jsx`：各渠道表单。

## 协议参考

- [SnowLuma：接入机器人](https://snowluma.github.io/en/docs/guide/connect-bot)
- [QQ 官方：获取访问凭证](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/access-token.html)
- [QQ 官方：回调签名](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/sign.html)
- [QQ 官方：群聊消息发送](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_messages.post.html)
- [QQ 官方：群聊富媒体上传](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_files.post.html)
