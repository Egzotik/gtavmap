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

    function triangleKey(a, b, c) {
        const rotations = [`${a}|${b}|${c}`, `${b}|${c}|${a}`, `${c}|${a}|${b}`];
        rotations.sort();
        return rotations[0];
    }

    function calculateBoundsFromVertices(vertices) {
        const parsed = vertices.map(parseVertex);
        const min = { x: Infinity, y: Infinity, z: Infinity };
        const max = { x: -Infinity, y: -Infinity, z: -Infinity };
        for (const { coordinates } of parsed) {
            min.x = Math.min(min.x, coordinates[0]);
            min.y = Math.min(min.y, coordinates[1]);
            min.z = Math.min(min.z, coordinates[2]);
            max.x = Math.max(max.x, coordinates[0]);
            max.y = Math.max(max.y, coordinates[1]);
            max.z = Math.max(max.z, coordinates[2]);
        }
        if (!parsed.length) return null;
        const center = {
            x: (min.x + max.x) / 2,
            y: (min.y + max.y) / 2,
            z: (min.z + max.z) / 2
        };
        let radiusSq = 0;
        for (const { coordinates } of parsed) {
            const dx = coordinates[0] - center.x;
            const dy = coordinates[1] - center.y;
            const dz = coordinates[2] - center.z;
            radiusSq = Math.max(radiusSq, dx * dx + dy * dy + dz * dz);
        }
        return { min, max, center, radius: Math.sqrt(radiusSq) };
    }

    function setDirectBounds(node, bounds, pad = 0) {
        if (!node || !bounds) return;
        const directChild = name => Array.from(node.children || []).find(child => child.nodeName === name);
        const minNode = directChild('BoundingBoxMin');
        const maxNode = directChild('BoundingBoxMax');
        if (minNode) {
            minNode.setAttribute('x', (bounds.min.x - pad).toFixed(6));
            minNode.setAttribute('y', (bounds.min.y - pad).toFixed(6));
            minNode.setAttribute('z', (bounds.min.z - pad).toFixed(6));
            minNode.removeAttribute('w');
        }
        if (maxNode) {
            maxNode.setAttribute('x', (bounds.max.x + pad).toFixed(6));
            maxNode.setAttribute('y', (bounds.max.y + pad).toFixed(6));
            maxNode.setAttribute('z', (bounds.max.z + pad).toFixed(6));
            maxNode.removeAttribute('w');
        }
        const centerNode = directChild('BoundingSphereCenter');
        const radiusNode = directChild('BoundingSphereRadius');
        if (centerNode && radiusNode) {
            centerNode.setAttribute('x', bounds.center.x.toFixed(6));
            centerNode.setAttribute('y', bounds.center.y.toFixed(6));
            centerNode.setAttribute('z', bounds.center.z.toFixed(6));
            radiusNode.setAttribute('value', (bounds.radius + pad).toFixed(6));
        }
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

            const bounds = calculateBoundsFromVertices(result.vertices);
            setDirectBounds(geometryNode, bounds, 0);
        }
        return result;
    }

    return { lerpVertex, clipPolygonAgainstEdge, clipTriangleToCell, vertexKey, triangleKey, mergeYddGeometry, applyYddGeometryMerge, calculateBoundsFromVertices };
});
