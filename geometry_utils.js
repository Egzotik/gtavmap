(function(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.GeometryUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
    function lerpVertex(v1, v2, t) {
        t = Math.max(0, Math.min(1, t));
        return {
            x: v1.x + (v2.x - v1.x) * t,
            y: v1.y + (v2.y - v1.y) * t,
            z: v1.z + (v2.z - v1.z) * t,
            r: Math.round(v1.r + (v2.r - v1.r) * t),
            g: Math.round(v1.g + (v2.g - v1.g) * t),
            b: Math.round(v1.b + (v2.b - v1.b) * t),
            a: Math.round(v1.a + (v2.a - v1.a) * t)
        };
    }

    function clipPolygonAgainstEdge(poly, nx, ny, d) {
        const result = [];
        if (poly.length === 0) return result;
        let previous = poly[poly.length - 1];
        let previousDistance = nx * previous.x + ny * previous.y - d;
        for (const current of poly) {
            const currentDistance = nx * current.x + ny * current.y - d;
            if (currentDistance >= -0.001) {
                if (previousDistance < -0.001) result.push(lerpVertex(previous, current, previousDistance / (previousDistance - currentDistance)));
                result.push(current);
            } else if (previousDistance >= -0.001) {
                result.push(lerpVertex(previous, current, previousDistance / (previousDistance - currentDistance)));
            }
            previous = current;
            previousDistance = currentDistance;
        }
        return result;
    }

    function clipTriangleToCell(v1, v2, v3, minX, maxX, minY, maxY) {
        let polygon = [v1, v2, v3];
        polygon = clipPolygonAgainstEdge(polygon, 1, 0, minX);
        polygon = clipPolygonAgainstEdge(polygon, -1, 0, -maxX);
        polygon = clipPolygonAgainstEdge(polygon, 0, 1, minY);
        polygon = clipPolygonAgainstEdge(polygon, 0, -1, -maxY);
        return polygon;
    }

    function parseVertex(vertex) {
        const parts = Array.isArray(vertex) ? vertex : String(vertex).trim().split(/\s+/);
        if (parts.length < 7) throw new Error('YDD vertex must contain x, y, z, r, g, b, a');
        const coordinates = parts.slice(0, 3).map(Number);
        const colors = parts.slice(3, 7).map(Number);
        if (![...coordinates, ...colors].every(Number.isFinite)) throw new Error('YDD vertex contains a non-numeric value');
        return { coordinates, colors };
    }

    function vertexKey(vertex) {
        const { coordinates, colors } = parseVertex(vertex);
        return `${coordinates[0].toFixed(7)}|${coordinates[1].toFixed(7)}|${coordinates[2].toFixed(7)}|${colors.map(value => Math.trunc(value)).join('|')}`;
    }

    function formatVertex(vertex) {
        const { coordinates, colors } = parseVertex(vertex);
        return `                ${coordinates[0].toFixed(7)} ${coordinates[1].toFixed(7)} ${coordinates[2].toFixed(7)}   ${colors.map(value => Math.trunc(value)).join(' ')}`;
    }

    // Cyclic rotations preserve winding. Reversed winding intentionally remains distinct.
    function triangleKey(a, b, c) {
        const rotations = [`${a}|${b}|${c}`, `${b}|${c}|${a}`, `${c}|${a}|${b}`];
        rotations.sort();
        return rotations[0];
    }

    function mergeYddGeometry(baseVertices, baseIndices, addedVertices, addedIndices) {
        if (baseIndices.length % 3 !== 0 || addedIndices.length % 3 !== 0) throw new Error('YDD index count must be divisible by three');

        const vertices = baseVertices.map(formatVertex);
        const indices = baseIndices.map(Number);
        const firstIndexByVertex = new Map();
        const canonicalBaseIndex = [];

        baseVertices.forEach((vertex, index) => {
            const key = vertexKey(vertex);
            if (!firstIndexByVertex.has(key)) firstIndexByVertex.set(key, index);
            canonicalBaseIndex[index] = firstIndexByVertex.get(key);
        });

        if (indices.some(index => !Number.isInteger(index) || index < 0 || index >= baseVertices.length)) throw new Error('Existing YDD index is out of range');

        const knownTriangles = new Set();
        for (let i = 0; i < indices.length; i += 3) {
            knownTriangles.add(triangleKey(canonicalBaseIndex[indices[i]], canonicalBaseIndex[indices[i + 1]], canonicalBaseIndex[indices[i + 2]]));
        }

        const remappedAddedIndices = new Array(addedVertices.length);
        addedVertices.forEach((vertex, index) => {
            const key = vertexKey(vertex);
            let targetIndex = firstIndexByVertex.get(key);
            if (targetIndex === undefined) {
                targetIndex = vertices.length;
                firstIndexByVertex.set(key, targetIndex);
                vertices.push(formatVertex(vertex));
            }
            remappedAddedIndices[index] = targetIndex;
        });

        let addedTriangleCount = 0;
        for (let i = 0; i < addedIndices.length; i += 3) {
            const source = [Number(addedIndices[i]), Number(addedIndices[i + 1]), Number(addedIndices[i + 2])];
            if (source.some(index => !Number.isInteger(index) || index < 0 || index >= addedVertices.length)) throw new Error('Added YDD index is out of range');
            const triangle = source.map(index => remappedAddedIndices[index]);
            const key = triangleKey(triangle[0], triangle[1], triangle[2]);
            if (knownTriangles.has(key)) continue;
            knownTriangles.add(key);
            indices.push(...triangle);
            addedTriangleCount++;
        }

        // Vertices which were new but belonged only to rejected duplicate triangles must not leak into the buffer.
        const used = new Set(indices);
        const compactVertices = [];
        const compactIndex = new Map();
        vertices.forEach((vertex, index) => {
            if (index < baseVertices.length || used.has(index)) {
                compactIndex.set(index, compactVertices.length);
                compactVertices.push(vertex);
            }
        });
        const compactIndices = indices.map(index => compactIndex.get(index));

        return {
            vertices: compactVertices,
            indices: compactIndices,
            addedVertexCount: compactVertices.length - baseVertices.length,
            addedTriangleCount
        };
    }

    function applyYddGeometryMerge(vertexDataNode, indexDataNode, geometryNode, addedVertices, addedIndices) {
        const baseVertices = String(vertexDataNode.textContent || '').split('\n').map(line => line.trim()).filter(line => line.split(/\s+/).length >= 7);
        const baseIndices = String(indexDataNode.textContent || '').trim().split(/\s+/).filter(Boolean).map(Number);
        const result = mergeYddGeometry(baseVertices, baseIndices, addedVertices, addedIndices);

        vertexDataNode.textContent = `\n${result.vertices.join('\n')}\n              `;
        let indexText = '\n';
        for (let i = 0; i < result.indices.length; i += 24) indexText += `                ${result.indices.slice(i, i + 24).join(' ')}\n`;
        indexDataNode.textContent = `${indexText}              `;

        if (geometryNode) {
            geometryNode.querySelectorAll('Vertices, VertexCount').forEach(node => { if (node.hasAttribute('value')) node.setAttribute('value', result.vertices.length); });
            geometryNode.querySelectorAll('Indices, IndicesCount').forEach(node => { if (node.hasAttribute('value')) node.setAttribute('value', result.indices.length); });
            geometryNode.querySelectorAll('PrimitiveCount').forEach(node => { if (node.hasAttribute('value')) node.setAttribute('value', result.indices.length / 3); });

            const parsed = result.vertices.map(parseVertex);
            const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
            parsed.forEach(({ coordinates }) => coordinates.forEach((value, axis) => { min[axis] = Math.min(min[axis], value); max[axis] = Math.max(max[axis], value); }));
            const directChild = name => Array.from(geometryNode.children || []).find(child => child.nodeName === name);
            const minNode = directChild('BoundingBoxMin'), maxNode = directChild('BoundingBoxMax');
            if (minNode && maxNode && parsed.length) {
                ['x', 'y', 'z'].forEach((axis, index) => { minNode.setAttribute(axis, min[index].toFixed(6)); maxNode.setAttribute(axis, max[index].toFixed(6)); });
            }
        }
        return result;
    }

    return { lerpVertex, clipPolygonAgainstEdge, clipTriangleToCell, vertexKey, triangleKey, mergeYddGeometry, applyYddGeometryMerge };
});
