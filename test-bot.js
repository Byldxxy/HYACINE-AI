import WebSocket from 'ws';

const apiPort = process.env.API_PORT || process.env.PORT || '3001';
const ws = new WebSocket(`ws://127.0.0.1:${apiPort}`);

// 假设配置里：BotQQ = 123456, MasterQQ = 666666

ws.on('open', () => {
  console.log('✅ 测试器已连接');

  // 1. 测试普通群消息（不应该回复，因为没@）
  const ignoreMsg = {
    post_type: "message",
    message_type: "group",
    group_id: 999,
    user_id: 888888, // 路人甲
    raw_message: "大家吃饭了吗？"
  };
  ws.send(JSON.stringify(ignoreMsg));

  // 2. 测试 @机器人的群消息（应该回复）
  setTimeout(() => {
    const atMsg = {
        post_type: "message",
        message_type: "group",
        group_id: 999,
        user_id: 888888, // 路人甲
        raw_message: "[CQ:at,qq=123456] 你好呀" // qq 值需要和本地配置中的 Bot QQ 一致
    };
    console.log(`📤 发送 @ 消息测试...`);
    ws.send(JSON.stringify(atMsg));
  }, 1000);

  // 3. 测试主人私聊（应该有特殊反应）
  setTimeout(() => {
      const masterMsg = {
        post_type: "message",
        message_type: "private",
        user_id: 666666, // 需要和本地配置中的 Master QQ 一致
        raw_message: "乖，叫主人"
      };
      console.log(`📤 发送主人私聊测试...`);
      ws.send(JSON.stringify(masterMsg));
  }, 5000); // 间隔长一点，因为现在有模拟打字延迟
});

ws.on('message', (data) => {
    const res = JSON.parse(data);
    console.log(`📥 收到回复: ${res.params.message}`);
});
