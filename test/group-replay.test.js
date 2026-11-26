const test = require('node:test');
const assert = require('node:assert/strict');
const { replayGroupScene } = require('../lib/group-replay');
const config = { apiKey: 'local-test', charName: '风堇', enableStickers: true, customKeywords: [], maxReplyLength: 200 };
const response = content => ({ choices: [{ message: { content } }] });

test('replay routes a quoted follow-up across speakers, evaluates once and keeps model failures distinct from silence', async () => {
    const transcript = '小白：@机器人 周末调休？\n机器人：调休补班。\n阿洛：今晚约游戏\n小白：[#2] 公司中间三天也不给批';
    let calls = 0;
    const result = await replayGroupScene({ transcript }, { config, complete: async (_config, messages) => {
        calls++;
        assert.match(JSON.stringify(messages), /调休补班/);
        assert.match(JSON.stringify(messages), /公司中间三天/);
        return response('这三天卡得也太准了。');
    } });
    assert.equal(calls, 1);
    assert.deepEqual(result.outputs, [{ type: 'text', text: '这三天卡得也太准了。' }]);
    assert.equal(result.kind, 'reply');
    await assert.rejects(replayGroupScene({ transcript }, { config, complete: async () => { throw new Error('模型服务暂时不可用'); } }), /模型服务暂时不可用/);
    const silent = await replayGroupScene({ transcript: '小白：@阿洛 今晚有空吗？\n阿洛：[#1] 九点' }, { config, complete: () => assert.fail() });
    assert.deepEqual(silent, { kind: 'silent', outputs: [], modelCalled: false });
    await assert.rejects(replayGroupScene({ transcript: '小白：[#9] 这条不存在' }, { config }), /引用行号/);
});

test('interleaved replay keeps unrelated game chatter and drops a superseded reply with one generation per case', async () => {
    const base = '小白：@机器人 周末还要调休吗？\n机器人：这周六补班。\n小白：中间三天不给批假。';
    let calls = 0;
    const deps = { config, complete: async () => { calls++; return response('{"respond":true,"reply":"三天一次都批不下来啊。"}'); } };
    const independent = await replayGroupScene({ targetLine: 3, transcript: base + '\n阿洛：@阿青 晚上打游戏吗？\n阿青：[#4] 九点上线。' }, deps);
    assert.equal(independent.kind, 'reply');
    const corrected = await replayGroupScene({ targetLine: 3, transcript: base + '\n小白：[#3] 更正，刚批了两天假。' }, deps);
    assert.equal(corrected.kind, 'silent');
    assert.equal(calls, 2);
});

test('replay previews exactly the selected sticker, without writing to a group or using another group’s material', async () => {
    const stickerStore = {
        list: () => [{ id: 'irony', meaning: '表面赞同', scope: 'group_22' }, { id: 'private_asset', meaning: '另一群', scope: 'group_33' }],
        image: async id => { assert.equal(id, 'irony'); return { bytes: Buffer.from('example') }; },
    };
    const result = await replayGroupScene({ transcript: '甲：@机器人 原则上可以', scope: 'group_22' }, {
        config, stickerStore, complete: async (_config, messages) => {
            assert.match(JSON.stringify(messages), /irony/);
            assert.doesNotMatch(JSON.stringify(messages), /private_asset/);
            return response('[[sticker:irony]]');
        },
    });
    assert.deepEqual(result, { kind: 'sticker', outputs: [{ type: 'sticker', id: 'irony' }], modelCalled: true });
});
