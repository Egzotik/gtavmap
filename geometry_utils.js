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
        const extra = parts.slice(7); 
        if (![...coordinates, ...colors].every(Number.isFinite)) throw new Error('YDD vertex contains a non-numeric value');
        return { coordinates, colors, extra };
    }

    function vertexKey(vertex) {
        const { coordinates, colors } = parseVertex(vertex);
        return `${coordinates[0].toFixed(7)}|${coordinates[1].toFixed(7)}|${coordinates[2].toFixed(7)}|${colors.map(value => Math.trunc(value)).join('|')}`;
    }

    function formatVertex(vertex) {
        const { coordinates, colors, extra } = parseVertex(vertex);
        const extraStr = (extra && extra.length > 0) ? ' ' + extra.join(' ') : '';
        return `                ${coordinates[0].toFixed(7)} ${coordinates[1].toFixed(7)} ${coordinates[2].toFixed(7)}   ${colors.map(value => Math.trunc(value)).join(' ')}${extraStr}`;
    }

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

    function calculateBoundsFromVertices(vertices) {
        if (!vertices || vertices.length === 0) return null;
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

        vertices.forEach(v => {
            if (v.x < minX) minX = v.x; if (v.y < minY) minY = v.y; if (v.z < minZ) minZ = v.z;
            if (v.x > maxX) maxX = v.x; if (v.y > maxY) maxY = v.y; if (v.z > maxZ) maxZ = v.z;
        });

        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        const centerZ = (minZ + maxZ) / 2;

        let maxRadiusSq = 0;
        vertices.forEach(v => {
            const dx = v.x - centerX, dy = v.y - centerY, dz = v.z - centerZ;
            const distSq = dx * dx + dy * dy + dz * dz;
            if (distSq > maxRadiusSq) maxRadiusSq = distSq;
        });

        return {
            min: { x: minX, y: minY, z: minZ },
            max: { x: maxX, y: maxY, z: maxZ },
            center: { x: centerX, y: centerY, z: centerZ },
            radius: Math.sqrt(maxRadiusSq)
        };
    }

    function setDirectBounds(geomItem, bounds) {
        if (!bounds) return;
        const getDirectChild = (parent, tag) => Array.from(parent.children).find(c => c.nodeName === tag);
        
        const bMin = getDirectChild(geomItem, 'BoundingBoxMin');
        if (bMin) { bMin.setAttribute('x', bounds.min.x.toFixed(6)); bMin.setAttribute('y', bounds.min.y.toFixed(6)); bMin.setAttribute('z', bounds.min.z.toFixed(6)); bMin.removeAttribute('w'); }
        
        const bMax = getDirectChild(geomItem, 'BoundingBoxMax');
        if (bMax) { bMax.setAttribute('x', bounds.max.x.toFixed(6)); bMax.setAttribute('y', bounds.max.y.toFixed(6)); bMax.setAttribute('z', bounds.max.z.toFixed(6)); bMax.removeAttribute('w'); }
        
        const bCenter = getDirectChild(geomItem, 'BoundingSphereCenter');
        if (bCenter) { bCenter.setAttribute('x', bounds.center.x.toFixed(6)); bCenter.setAttribute('y', bounds.center.y.toFixed(6)); bCenter.setAttribute('z', bounds.center.z.toFixed(6)); }
        
        const bRadius = getDirectChild(geomItem, 'BoundingSphereRadius');
        if (bRadius) { bRadius.setAttribute('value', bounds.radius.toFixed(6)); }
    }

    function applyYddGeometryMerge(vDataNode, iDataNode, geomItem, newVertices, newIndices) {
        let baseVLines = [];
        vDataNode.textContent.split('\n').forEach(line => {
            const p = line.trim().split(/\s+/).filter(Boolean);
            if (p.length >= 7) baseVLines.push(`                ${p[0]} ${p[1]} ${p[2]}   ${p.slice(3).join(' ')}`);
        });

        let baseITokens = iDataNode.textContent.trim().split(/\s+/).filter(t => t !== '');

        const mergeResult = mergeYddGeometry(baseVLines, baseITokens, newVertices, newIndices);

        vDataNode.textContent = "\n" + mergeResult.vertices.join('\n') + "\n              ";
        let iStr = "\n";
        for (let i = 0; i < mergeResult.indices.length; i += 24) {
            iStr += "                " + mergeResult.indices.slice(i, i + 24).join(" ") + "\n";
        }
        iDataNode.textContent = iStr + "              ";

        geomItem.querySelectorAll('Vertices, VertexCount').forEach(n => { if (n.hasAttribute('value')) n.setAttribute('value', mergeResult.vertices.length); });
        geomItem.querySelectorAll('Indices, IndicesCount').forEach(n => { if (n.hasAttribute('value')) n.setAttribute('value', mergeResult.indices.length); });
        geomItem.querySelectorAll('PrimitiveCount').forEach(n => { if (n.hasAttribute('value')) n.setAttribute('value', mergeResult.indices.length / 3); });

        const parsedVerts = mergeResult.vertices.map(line => {
            const p = line.trim().split(/\s+/).filter(Boolean);
            return { x: parseFloat(p[0]), y: parseFloat(p[1]), z: parseFloat(p[2]) };
        });
        const bounds = calculateBoundsFromVertices(parsedVerts);
        setDirectBounds(geomItem, bounds);
        
        const rootItem = geomItem.closest('Item');
        if (rootItem && rootItem !== geomItem) setDirectBounds(rootItem, bounds);

        return mergeResult;
    }

    return {
        clipTriangleToCell,
        mergeYddGeometry,
        calculateBoundsFromVertices,
        setDirectBounds,
        applyYddGeometryMerge
    };
});