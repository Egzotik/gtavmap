const test = require('node:test');
const assert = require('node:assert/strict');
const { clipTriangleToCell } = require('../geometry_utils.js');

function vertex(x, y, z = 0) { return { x, y, z, r: 10, g: 20, b: 30, a: 255 }; }

test('keeps a triangle located inside a tile', () => {
    const result = clipTriangleToCell(vertex(1, 1), vertex(9, 1), vertex(1, 9), 0, 10, 0, 10);
    assert.equal(result.length, 3);
});

test('removes a triangle located outside a tile', () => {
    const result = clipTriangleToCell(vertex(20, 20), vertex(30, 20), vertex(20, 30), 0, 10, 0, 10);
    assert.equal(result.length, 0);
});

test('clips crossing edges and preserves RGBA values', () => {
    const result = clipTriangleToCell(vertex(-5, 5), vertex(5, 15), vertex(5, 5), 0, 10, 0, 10);
    assert.ok(result.length >= 3);
    assert.ok(result.every(point => point.x >= -0.001 && point.x <= 10.001 && point.y >= -0.001 && point.y <= 10.001));
    assert.ok(result.every(point => Number.isInteger(point.r) && point.a === 255));
});
