const test = require('node:test');
const assert = require('node:assert/strict');
const dictionary = require('../map/dictionary.json');
const { classify, waterLevel, waterColor, changesForWater } = require('../map_presets.js');

test('classifies dictionary colors into water and land', () => {
    assert.equal(Object.keys(dictionary).filter(hex => classify(hex, dictionary) === 'water').length, 14);
    assert.ok(Object.keys(dictionary).filter(hex => classify(hex, dictionary) === 'land').length >= 9);
    assert.equal(classify('#ffffff', dictionary), null);
});

test('water gradient follows depth levels between selected endpoints', () => {
    const shallow = waterColor('#3d4f55', dictionary, ['#ffffff', '#000000']);
    const deep = waterColor('#97a7af', dictionary, ['#ffffff', '#000000']);
    assert.notEqual(shallow, deep);
    assert.equal(waterLevel('Океан (Уровень 1 - Глубокий)'), 1);
    assert.equal(waterLevel('Океан (Уровень 13 - Мелководье)'), 13);
    assert.equal(waterLevel('Реки / Пресная вода'), 14);
});

test('applies endpoint gradient only to water and preserves source data', () => {
    const colors = [
        { key: 'water', origHex: '#3d4f55', currentHex: '#fff', currentA: 10 },
        { key: 'land', origHex: '#414141', currentHex: '#000', currentA: 20 }
    ];
    const before = JSON.stringify(colors);
    const changes = changesForWater(colors, dictionary, ['#ffffff', '#000000']);
    assert.deepEqual(changes.map(change => change.key), ['water']);
    assert.equal(JSON.stringify(colors), before);
});
