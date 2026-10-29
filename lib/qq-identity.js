// Official OpenIDs are namespaced by application and environment, never treated as QQ numbers.
const isChatIdentity = value => /^(?:\d+|qbot_\d+_(?:live|sandbox)_[A-Za-z0-9_-]{1,128})$/.test(String(value || ''));
const officialIdentity = (config, id) => `qbot_${config.qqBotAppId}_${config.qqBotSandbox ? 'sandbox' : 'live'}_${id}`;
module.exports = { isChatIdentity, officialIdentity };
