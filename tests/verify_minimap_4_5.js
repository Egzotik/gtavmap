const fs = require('node:fs');
const assert = require('node:assert/strict');
const { mergeYddGeometry, vertexKey, triangleKey } = require('../geometry_utils.js');

const correctPath = process.argv[2] || 'C:\\Users\\ub1\\Downloads\\fix.minimap_4_5.ydd.xml';
const problemPath = process.argv[3] || 'C:\\Users\\ub1\\Downloads\\minimap_4_5.ydd.xml';
const itemName = 'supertile_fore_4_5_tile_2_2';

function dataContents(block, tag) {
    const match = block.match(new RegExp(`<${tag}\\b[\\s\\S]*?<(?:Data2|Data)>([\\s\\S]*?)<\\/(?:Data2|Data)>`, 'i'));
    if (!match) throw new Error(`${tag}/Data not found`);
    return match[1];
}

function readGeometry(filePath) {
    const xml = fs.readFileSync(filePath, 'utf8');
    const nameAt = xml.indexOf(`<Name>${itemName}</Name>`);
    if (nameAt < 0) throw new Error(`${itemName} not found in ${filePath}`);
    const tail = xml.slice(nameAt);
    const vertices = dataContents(tail, 'VertexBuffer').split(/\r?\n/).map(line => line.trim()).filter(line => line.split(/\s+/).length >= 7);
    const indices = dataContents(tail, 'IndexBuffer').trim().split(/\s+/).filter(Boolean).map(Number);
    return { vertices, indices };
}

function semanticTriangles(geometry) {
    const keys = geometry.vertices.map(vertexKey);
    const counts = new Map();
    for (let i = 0; i < geometry.indices.length; i += 3) {
        const [a, b, c] = geometry.indices.slice(i, i + 3).map(index => keys[index]);
        const key = triangleKey(a, b, c);
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
}

function colorCounts(vertices) {
    const counts = new Map();
    vertices.forEach(line => {
        const parts = line.trim().split(/\s+/);
        const color = parts.slice(3, 7).map(Number).join(' ');
        counts.set(color, (counts.get(color) || 0) + 1);
    });
    return counts;
}

const correct = readGeometry(correctPath);
const problem = readGeometry(problemPath);
const first = mergeYddGeometry(correct.vertices, correct.indices, correct.vertices, correct.indices);
const second = mergeYddGeometry(first.vertices, first.indices, correct.vertices, correct.indices);

assert.equal(first.vertices.length, 2601);
assert.equal(first.indices.length, 8571);
assert.equal(first.indices.length / 3, 2857);
assert.deepEqual(second.vertices, first.vertices);
assert.deepEqual(second.indices, first.indices);
assert.equal(second.addedVertexCount, 0);
assert.equal(second.addedTriangleCount, 0);

const expectedColors = new Map([
    ['215 26 28 255', 114],
    ['0 144 189 255', 98],
    ['191 195 0 255', 64],
    ['215 24 143 255', 44],
    ['0 78 196 255', 23]
]);
const actualColors = colorCounts(first.vertices);
expectedColors.forEach((count, color) => assert.equal(actualColors.get(color), count, color));

assert.deepEqual(semanticTriangles(first), semanticTriangles(correct));

console.log(JSON.stringify({
    correct: { vertices: correct.vertices.length, indices: correct.indices.length, triangles: correct.indices.length / 3 },
    problem: { vertices: problem.vertices.length, indices: problem.indices.length, triangles: problem.indices.length / 3 },
    mergedOnce: { vertices: first.vertices.length, indices: first.indices.length, triangles: first.indices.length / 3, addedTriangles: first.addedTriangleCount },
    mergedTwice: { vertices: second.vertices.length, indices: second.indices.length, triangles: second.indices.length / 3, addedTriangles: second.addedTriangleCount },
    colors: Object.fromEntries(expectedColors)
}, null, 2));
