const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeYddGeometry, needsGeometrySplit } = require('../geometry_utils.js');

const baseVertices = [
    '0 0 10 215 26 28 255',
    '1 0 10 215 26 28 255',
    '0 1 10 215 26 28 255'
];

test('geometry splitting uses triangle count, not raw index count', () => {
    assert.equal(needsGeometrySplit(100, 60000 * 3, 60000, 65535), false);
    assert.equal(needsGeometrySplit(100, 60001 * 3, 60000, 65535), true);
    assert.equal(needsGeometrySplit(65536, 3, 60000, 65535), true);
});

test('repeated merge preserves existing triangle multiplicity and is idempotent', () => {
    const baseIndices = [0, 1, 2, 0, 1, 2];
    const formattingVariant = [
        '0.000000000 0.0 10.0000000 215 26 28 255',
        '1.0000000 0.00000000 10 215 26 28 255',
        '0 1.000000000 10.0 215 26 28 255'
    ];

    const first = mergeYddGeometry(baseVertices, baseIndices, formattingVariant, [0, 1, 2, 0, 1, 2]);
    assert.equal(first.vertices.length, 3);
    assert.deepEqual(first.indices, baseIndices);
    assert.equal(first.addedTriangleCount, 0);

    const second = mergeYddGeometry(first.vertices, first.indices, formattingVariant, [0, 1, 2, 0, 1, 2]);
    assert.deepEqual(second.vertices, first.vertices);
    assert.deepEqual(second.indices, first.indices);
});

test('merge preserves base vertex lines byte-for-byte', () => {
    const sameTriangle = [
        '0.0000000 0.0 10.0000000 215 26 28 255',
        '1.0000000 0.00000000 10 215 26 28 255',
        '0 1.000000000 10.0 215 26 28 255'
    ];
    const result = mergeYddGeometry(baseVertices, [0, 1, 2], sameTriangle, [0, 1, 2]);
    assert.deepEqual(result.vertices, baseVertices);
    assert.deepEqual(result.indices, [0, 1, 2]);
    assert.equal(result.addedTriangleCount, 0);
});

test('cyclic duplicates are rejected without treating reversed winding as identical', () => {
    const cyclic = mergeYddGeometry(baseVertices, [0, 1, 2], baseVertices, [1, 2, 0]);
    assert.equal(cyclic.indices.length, 3);

    const reversed = mergeYddGeometry(baseVertices, [0, 1, 2], baseVertices, [0, 2, 1]);
    assert.equal(reversed.indices.length, 6);
    assert.deepEqual(reversed.indices.slice(3), [0, 2, 1]);
});

test('RGBA and Z remain part of the vertex identity', () => {
    const additions = [
        '0 0 11 215 26 28 255',
        '1 0 10 0 144 189 255',
        '0 1 10 215 26 28 254'
    ];
    const result = mergeYddGeometry(baseVertices, [0, 1, 2], additions, [0, 1, 2]);
    assert.equal(result.vertices.length, 6);
    assert.equal(result.indices.length, 6);
});
