const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const vectors = fs.readFileSync(path.join(root, 'vector_tools.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('export uses copies instead of project file objects', () => {
    assert.match(app, /const exportFiles = cloneFilesForExport\(state\.files\)/);
    assert.doesNotMatch(app, /const mapFiles = state\.files\.filter/);
});

test('custom XML and vector branches share the same guarded YDD merge', () => {
    assert.match(app, /GeometryUtils\.applyYddGeometryMerge/);
    assert.match(vectors, /GeometryUtils\.applyYddGeometryMerge/);
    assert.doesNotMatch(app, /baseVLines\.concat\(t\.vertices\)/);
    assert.doesNotMatch(vectors, /baseVLines\.concat\(t\.vertices\)/);
    assert.match(vectors, /geometryChanged = mergeResult\.addedTriangleCount > 0/);
});

test('Z palette mode and zero opacity are round-tripped', () => {
    assert.match(app, /separateByZ: state\.separateByZ/);
    assert.match(vectors, /opacity: data\.opacity \?\? 1/);
});

test('XML geometry is traversed by vertex buffers rather than nested Item nodes', () => {
    assert.match(app, /const vertexBuffers = doc\.querySelectorAll\('VertexBuffer'\)/);
    assert.doesNotMatch(app, /const items = doc\.querySelectorAll\('Item'\); let meshesData/);
});

test('runtime dependencies are local', () => {
    assert.doesNotMatch(html, /<script[^>]+https?:\/\//i);
    for (const file of ['tailwindcss.js', 'lucide.js', 'jszip.min.js', 'three.min.js', 'opentype.min.js', 'roboto-black-webfont.ttf']) {
        assert.ok(fs.existsSync(path.join(root, 'vendor', file)), `${file} is missing`);
    }
});
