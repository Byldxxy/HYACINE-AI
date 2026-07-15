const test = require('node:test');
const assert = require('node:assert/strict');
const { selectObservationContext } = require('../lib/proactive');

const observations = Array.from({ length: 60 }, (_, index) => ({ text: String(index + 1) }));

test('selects the configured number of latest proactive observations', () => {
    const selected = selectObservationContext(observations, 12);
    assert.equal(selected.length, 12);
    assert.equal(selected[0].text, '49');
    assert.equal(selected.at(-1).text, '60');
});

test('defaults to 30 observations and clamps the configurable range', () => {
    assert.equal(selectObservationContext(observations).length, 30);
    assert.equal(selectObservationContext(observations, 1).length, 3);
    assert.equal(selectObservationContext(observations, 999).length, 50);
});
