const test = require('node:test');
const assert = require('node:assert/strict');
const { GAME_ZONES, parseZonePoints, parseZonePolygons, parseZoneFile, wikiToGame, polygonsToVectorItems, polygonsToMergedFigures } = require('./game_zones.js');

test('rubbish overlay is defined with data source', () => {
    const rubbish = GAME_ZONES.find(z => z.id === 'rubbish');
    assert.ok(rubbish);
    assert.equal(rubbish.url, 'markers/rubbish_points.json');
});

test('parses wiki point arrays with 90 degree CCW rotation and horizontal mirror', () => {
    const pts = parseZonePoints([
        { _id: 'rubbish-25', name: 'test', point: [4624.87939453125, 1947.764892578125] }
    ]);
    assert.deepEqual(pts, [{ x: 1947.764892578125, y: 4624.87939453125, name: 'test' }]);
});

test('parses x/y fields and skips invalid entries', () => {
    const pts = parseZonePoints([
        { x: 100, y: 200 },
        { point: ['bad', 5] },
        { point: [1] },
        null,
        'nope',
        { point: [1, 2, 3] }
    ]);
    assert.equal(pts.length, 2);
    assert.equal(pts[0].x, 200);
    assert.equal(pts[0].y, 100);
    assert.equal(pts[1].x, 2);
    assert.equal(pts[1].y, 1);
});

test('returns empty array for non-array input', () => {
    assert.deepEqual(parseZonePoints(null), []);
    assert.deepEqual(parseZonePoints({}), []);
    assert.deepEqual(parseZonePoints([]), []);
});

test('wikiToGame applies rotation, mirror and shift', () => {
    assert.deepEqual(wikiToGame(1947.764892578125, 4624.87939453125), { x: 4624.87939453125, y: 1947.764892578125 });
    assert.deepEqual(wikiToGame(0, 0), { x: 0, y: 0 });
});

test('parses polygon lists with transform and colors', () => {
    const polys = parseZonePolygons([
        { _id: 'a', name: 'Zone', color: '#04ff1c', polygon: [[0, 0], [10, 0], [10, 10], [0, 10]] },
        { _id: 'b', polygon: [[0, 0], [1, 1]] },
        null
    ]);
    assert.equal(polys.length, 1);
    assert.equal(polys[0].color, '#04ff1c');
    assert.equal(polys[0].points.length, 4);
});

test('polygonsToVectorItems centers figures and keeps colors', () => {
    const items = polygonsToVectorItems([
        { name: 'A', color: '#ff0000', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] },
        { name: 'B', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
        null
    ], 'treasure', '#facc15');
    assert.equal(items.length, 1);
    assert.equal(items[0].position.x, 5);
    assert.equal(items[0].position.y, 5);
    assert.deepEqual(items[0].pencilPoints[0], { x: -5, y: -5 });
    assert.equal(items[0].color, '#ff0000');
    assert.equal(items[0].convertedFrom, 'treasure');
    assert.equal(items[0].isPencil, true);
    const fallback = polygonsToVectorItems([{ points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }] }], 'zz', '#22c55e');
    assert.equal(fallback[0].color, '#22c55e');
    assert.deepEqual(polygonsToVectorItems(null), []);
    const withDefaults = polygonsToMergedFigures(
        [{ name: 'T', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] }],
        'treasure', '#facc15', 'Treasure', { opacity: 0.2, strokeWidth: 0.4 });
    assert.equal(withDefaults.length, 1);
    assert.equal(withDefaults[0].opacity, 0.2);
    assert.equal(withDefaults[0].hasStroke, true);
    assert.equal(withDefaults[0].strokeWidth, 0.4);
    assert.equal(withDefaults[0].strokeColor, '#facc15');
    const plain = polygonsToMergedFigures(
        [{ name: 'T', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] }],
        'zz', '#22c55e', 'ZZ');
    assert.equal(plain[0].opacity, 1);
    assert.equal(plain[0].hasStroke, undefined);
});

test('polygonsToMergedFigures groups by color into single centered figures', () => {
    const items = polygonsToMergedFigures([
        { name: 'A', color: '#ff0000', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] },
        { name: 'B', color: '#ff0000', points: [{ x: 20, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 30 }, { x: 20, y: 30 }] },
        { name: 'C', color: '#00ff00', points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }] },
        { name: 'D', points: [{ x: 0, y: 0 }] }
    ], 'treasure', '#facc15');
    assert.equal(items.length, 2);
    const red = items.find(i => i.color === '#ff0000');
    assert.equal(red.position.x, 15);
    assert.equal(red.position.y, 15);
    assert.equal(red.pencilShapes.length, 2);
    assert.equal(red.convertedFrom, 'treasure');
    assert.equal(red.isPencil, true);
    const green = items.find(i => i.color === '#00ff00');
    assert.equal(green.pencilShapes.length, 1);
    assert.deepEqual(polygonsToMergedFigures([], 'x'), []);
});

test('parseZoneFile handles legacy arrays and layered objects', () => {
    const legacy = parseZoneFile([{ point: [100, 200] }]);
    assert.equal(legacy.points.length, 1);
    assert.deepEqual(legacy.polygons, []);
    const layered = parseZoneFile({ points: [{ point: [100, 200] }], polygons: [{ name: 'z', polygon: [[0, 0], [10, 0], [10, 10]] }] });
    assert.equal(layered.points.length, 1);
    assert.equal(layered.polygons.length, 1);
    assert.deepEqual(parseZoneFile(null), { points: [], polygons: [] });
});
