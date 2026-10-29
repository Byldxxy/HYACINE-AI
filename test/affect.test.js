const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAffect } = require('../lib/extensions/affect');
const { memoryContext } = require('../lib/chat-policy');
const { mergeLearnedMemory } = require('../lib/learned-memory');
const message = { sessionId: 'group_1', senderId: '1', text: '这个梗真的笑死我了' };
const config = { enableAffect: true, affectHalfLife: 5, systemPrompt: '风堇' };
test('affect requires original evidence, strips malformed controls and ignores unknown states', () => {
    const affect = createAffect();
    assert.equal(affect.parse('好 [[affect:{"mood":"playful","evidence":"真的笑死我了"}]]', message).candidate.mood, 'playful');
    assert.equal(affect.parse('好 [[affect:{"mood":"playful","evidence":"不存在的证据"}]]', message).candidate, null);
    assert.equal(affect.parse('好 [[affect:broken', message).text, '好');
    assert.equal(affect.parse('好 [[affect:{"mood":"angry","evidence":"真的笑死我了"}]]', message).candidate, null);
});
test('affect is isolated by member, session, persona and reset generation, and decays', () => {
    let time = 1000; const affect = createAffect({ now: () => time });
    affect.commit({ mood: 'playful' }, message, config, 1);
    assert.match(affect.context(message, config, 1), /上一轮倾向/);
    for (const other of [{...message,senderId:'2'}, {...message,sessionId:'group_2'}]) assert.doesNotMatch(affect.context(other,config,1),/上一轮倾向/);
    assert.doesNotMatch(affect.context(message,{...config,systemPrompt:'其他角色'},1),/上一轮倾向/);
    assert.doesNotMatch(affect.context(message,config,2),/上一轮倾向/);
    time += 16*60000; assert.doesNotMatch(affect.context(message,config,1),/上一轮倾向/);
    const epoch=affect.generation(); affect.clear(); affect.commit({mood:'warm'},message,config,1,epoch); assert.equal(affect.status().count,0);
});
test('focused retrieval filters irrelevant automatic tastes while respecting fixed memory and scope', () => {
    const records=[{fact:'喜欢医护话题',kind:'bot_preference',source:'persona'}, {fact:'今天下雨',source:'group_2'}, {fact:'固定人设',source:'manual',locked:true}, {fact:'策略游戏要规划资源',source:'group_1'}];
    const picked=memoryContext(records,'group_1','策略游戏',{mode:'focused'});
    assert.deepEqual(picked.map(x=>x.fact),['固定人设','策略游戏要规划资源']);
    assert.equal(records.length,4);
});
test('automatic personality revisions need new evidence, not reinterpretation of old replies', () => {
    const records=[{source:'persona',kind:'bot_preference',subject:'游戏',fact:'喜欢策略',evidenceIds:['a','b']}];
    const evidence=[{id:'a',role:'assistant',text:'我喜欢解谜游戏'}, {id:'b',role:'assistant',text:'我喜欢解谜游戏'}];
    assert.equal(mergeLearnedMemory(records,{kind:'bot_preference',subject:'游戏',fact:'喜欢解谜',evidenceIds:['a','b']},evidence,'group_1',1),0);
    assert.equal(records[0].fact,'喜欢策略');
});
