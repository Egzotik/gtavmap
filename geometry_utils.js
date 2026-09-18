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
        // Квантование 1e-4 (0.1мм): гасит шум сериализации и не плодит
        // почти-дубликаты при росте числа вершин. Позиция хранимой вершины не меняется.
        const q = (v) => (Math.round(Number(v) * 1e4) / 1e4).toFixed(4);
        return `${q(coordinates[0])}|${q(coordinates[1])}|${q(coordinates[2])}|${colors.map(value => Math.trunc(value)).join('|')}`;
    }

    function formatVertex(vertex) {
        const { coordinates, colors, extra } = parseVertex(vertex);
        const extraStr = (extra && extra.length > 0) ? ' ' + extra.join(' ') : '';
        return `                ${coordinates[0].toFixed(7)} ${coordinates[1].toFixed(7)} ${coordinates[2].toFixed(7)}   ${colors.map(value => Math.trunc(value)).join(' ')}${extraStr}`;
    }

    // Sollumz/CodeWalker печатает границы как float32-shortest (как C# float.ToString()):
    // меньше значащих цифр — короче строка, значение обязано вернуться в тот же float32.
    // Целые дописываем как "200.0" / "0.0", как в Blender.
    function formatFloat32Shortest(numStr) {
        const v = Math.fround(Number(numStr));
        if (!Number.isFinite(v)) return numStr;
        if (v === 0) return '0.0';
        for (let p = 1; p <= 9; p++) {
            const cand = String(Number(v.toPrecision(p)));
            if (Math.fround(Number(cand)) === v) {
                return /[.eE]/.test(cand) ? cand : cand + '.0';
            }
        }
        return String(v);
    }

    const BLENDER_BOUND_TAGS = { BoundingSphereCenter: 1, BoundingSphereRadius: 1, BoundingBoxMin: 1, BoundingBoxMax: 1 };

    // Байт-стилистика Sollumz/Blender: CRLF, декларация с одинарными кавычками,
    // отступ 2 пробела на уровень, границы float32-shortest, блоки <Data> как есть.
    function formatBlenderXmlString(xmlStr) {
        const dataBlocks = [];
        const skeleton = String(xmlStr).replace(/\r\n?/g, '\n')
            .replace(/<Data>([\s\S]*?)<\/Data>/g, (m, inner) => `<Data>\u0000${dataBlocks.length}\u0000</Data>${(dataBlocks.push(inner), '')}`);
        const parts = skeleton.split(/(<[^>]+>)/g);
        const lines = [];
        let depth = 0;
        const pad = (d) => '  '.repeat(d);
        for (let i = 0; i < parts.length; i++) {
            const tok = parts[i];
            if (!tok) continue;
            if (tok[0] !== '<') {
                if (tok.indexOf('\u0000') >= 0) lines.push(tok);
                else if (lines.length > 0 && tok.trim() !== '') lines[lines.length - 1] += tok.trim();
                continue;
            }
            const isClosing = tok[1] === '/';
            const isSelfClosing = /\/>$/.test(tok) || tok[1] === '?';
            const tagName = (tok.match(/^<\/?([^\s/>]+)/) || [])[1] || '';
            if (!isClosing && !isSelfClosing && tagName === 'Data') {
                const innerTok = parts[i + 1] || '';
                const dm = innerTok.match(/^\u0000(\d+)\u0000$/);
                if (dm) {
                    lines.push(pad(depth) + tok);
                    const raw = dataBlocks[Number(dm[1])].replace(/^\r?\n/, '').replace(/\s+$/, '');
                    if (raw !== '') raw.split('\n').forEach(l => lines.push(l));
                    lines.push(pad(depth) + '</Data>');
                    i += 2;
                    continue;
                }
            }
            if (isClosing) depth = Math.max(0, depth - 1);
            if (!isClosing && !isSelfClosing && tagName !== 'Data'
                && parts[i + 1] && parts[i + 1][0] !== '<' && parts[i + 1].trim() !== ''
                && parts[i + 2] && parts[i + 2][1] === '/') {
                lines.push(pad(depth) + tok + parts[i + 1].trim() + parts[i + 2]);
                i += 2;
                continue;
            }
            let out = tok;
            if (BLENDER_BOUND_TAGS[tagName]) {
                out = out.replace(/(x|y|z|value)="(-?\d+\.\d+)"/g, (m, k, n) => `${k}="${formatFloat32Shortest(n)}"`);
            }
            lines.push(pad(depth) + out);
            if (!isClosing && !isSelfClosing) depth++;
        }
        if (lines.length > 0 && lines[0].indexOf('<?xml') === 0) {
            lines[0] = `<?xml version='1.0' encoding='UTF-8'?>`;
        } else {
            lines.unshift(`<?xml version='1.0' encoding='UTF-8'?>`);
        }
        return lines.join('\n').replace(/\u0000(\d+)\u0000/g, (m, n) => dataBlocks[Number(n)]).replace(/\n/g, '\r\n') + '\r\n';
    }

    // Ближайший СУЩЕСТВУЮЩИЙ квадрат сетки к точке: за сеткой контент
    // привязывается к нему целиком (ничего не удаляем). Пустой список —
    // clamp к сетке (файл будет создан). grid: {startX, stepX, topY, stepY, maxGx, maxGy}.
    function chooseNearestCell(existingNames, cx, cy, grid) {
        const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
        const cells = [];
        (existingNames || []).forEach(name => {
            const m = String(name || '').match(/minimap_(\d+)_(\d+)/i);
            if (m) cells.push({ gx: parseInt(m[1], 10), gy: parseInt(m[2], 10) });
        });
        if (cells.length === 0) {
            return [clampInt(Math.floor((cx - grid.startX) / grid.stepX), 0, grid.maxGx),
                clampInt(Math.floor((grid.topY - cy) / grid.stepY), 0, grid.maxGy)];
        }
        let best = cells[0], bestD = Infinity;
        cells.forEach(c => {
            const minX = grid.startX + c.gx * grid.stepX, maxX = minX + grid.stepX;
            const maxY = grid.topY - c.gy * grid.stepY, minY = maxY - grid.stepY;
            const dx = cx < minX ? minX - cx : (cx > maxX ? cx - maxX : 0);
            const dy = cy < minY ? minY - cy : (cy > maxY ? cy - maxY : 0);
            const d = dx * dx + dy * dy;
            if (d < bestD) { bestD = d; best = c; }
        });
        return [best.gx, best.gy];
    }

    function triangleKey(a, b, c) {
        const rotations = [`${a}|${b}|${c}`, `${b}|${c}|${a}`, `${c}|${a}|${b}`];
        rotations.sort();
        return rotations[0];
    }

    function mergeYddGeometry(baseVertices, baseIndices, addedVertices, addedIndices) {
        if (baseIndices.length % 3 !== 0 || addedIndices.length % 3 !== 0) throw new Error('YDD index count must be divisible by three');

        const vertices = baseVertices.slice();
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
            // Вырожденные треугольники в игру не пишем: повторные индексы
            // и нулевая площадь ломают импорт (деление на ноль в нормалях).
            if (triangle[0] === triangle[1] || triangle[1] === triangle[2] || triangle[2] === triangle[0]) continue;
            const pa = vertices[triangle[0]].trim().split(/\s+/);
            const pb = vertices[triangle[1]].trim().split(/\s+/);
            const pc = vertices[triangle[2]].trim().split(/\s+/);
            const abx = +pb[0] - +pa[0], aby = +pb[1] - +pa[1], abz = +pb[2] - +pa[2];
            const acx = +pc[0] - +pa[0], acy = +pc[1] - +pa[1], acz = +pc[2] - +pa[2];
            const cx = aby * acz - abz * acy, cy = abz * acx - abx * acz, cz = abx * acy - aby * acx;
            if (!(cx * cx + cy * cy + cz * cz > 1e-18)) continue;
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

        // Радиус — половина диагонали бокса (как Blender/CodeWalker):
        // покрывает углы бокса, а не только самую дальнюю вершину.
        const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;

        return {
            min: { x: minX, y: minY, z: minZ },
            max: { x: maxX, y: maxY, z: maxZ },
            center: { x: centerX, y: centerY, z: centerZ },
            radius: Math.sqrt(dx * dx + dy * dy + dz * dz) / 2
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
        
        let rootItem = null;
        let ancestor = geomItem.parentElement;
        while (ancestor) {
            if (ancestor.nodeName === 'Item') rootItem = ancestor;
            ancestor = ancestor.parentElement;
        }
        if (rootItem) setDirectBounds(rootItem, bounds);

        return mergeResult;
    }

    // GTA V limits the primitive count and the vertex index space independently.
    // The old implementation compared the raw index count to maxLimit, allowing
    // three times as many triangles as intended.
    function needsGeometrySplit(vertexCount, indexCount, maxTriangles = 60000, maxVertices = 65535) {
        return vertexCount > maxVertices || indexCount > 0 && Math.floor(indexCount / 3) > maxTriangles;
    }

    function splitOversizedGeometries(xmlDoc, maxTriangles = 60000, maxVertices = 65535) {
        const getDirectChild = (parent, tag) => Array.from(parent.children).find(c => c.nodeName === tag);

        const geomItems = Array.from(xmlDoc.querySelectorAll('Geometries > Item'));
        let splitCount = 0;

        geomItems.forEach(geomItem => {
            const vb = getDirectChild(geomItem, 'VertexBuffer');
            const ib = getDirectChild(geomItem, 'IndexBuffer');
            if (!vb || !ib) return;

            const vData = getDirectChild(vb, 'Data2') || getDirectChild(vb, 'Data');
            const iData = getDirectChild(ib, 'Data2') || getDirectChild(ib, 'Data');
            if (!vData || !iData) return;

            const vLines = vData.textContent.split('\n').filter(line => line.trim().split(/\s+/).filter(Boolean).length >= 7);
            const iTokens = iData.textContent.trim().split(/\s+/).filter(t => t !== '');
            const indices = iTokens.map(Number);

            if (indices.length < 3 || !needsGeometrySplit(vLines.length, indices.length, maxTriangles, maxVertices)) return;
            if (indices.length % 3 !== 0) throw new Error('Cannot split YDD geometry: index count is not divisible by three');

            if (indices.some(index => !Number.isInteger(index) || index < 0 || index >= vLines.length)) {
                throw new Error('Cannot split YDD geometry: index is out of range');
            }

            const triangles = [];
            for (let i = 0; i + 2 < indices.length; i += 3) {
                triangles.push([indices[i], indices[i + 1], indices[i + 2]]);
            }

            const chunks = [];
            let current = { usedVerts: new Set(), tris: [] };

            for (const tri of triangles) {
                const newVertCount = tri.filter(idx => !current.usedVerts.has(idx)).length;
                if ((current.usedVerts.size + newVertCount > maxVertices) || (current.tris.length + 1 > maxTriangles)) {
                    if (current.tris.length > 0) chunks.push(current);
                    current = { usedVerts: new Set(), tris: [] };
                }
                tri.forEach(idx => current.usedVerts.add(idx));
                current.tris.push(tri);
            }
            if (current.tris.length > 0) chunks.push(current);

            const parentGeometries = geomItem.parentElement;
            const insertRef = geomItem.nextSibling;

            chunks.forEach(chunk => {
                const usedArr = Array.from(chunk.usedVerts).sort((a, b) => a - b);
                const remap = new Map();
                const newVertLines = [];

                usedArr.forEach((oldIdx, newIdx) => {
                    remap.set(oldIdx, newIdx);
                    newVertLines.push(vLines[oldIdx]);
                });

                const newIndices = [];
                for (const tri of chunk.tris) {
                    newIndices.push(remap.get(tri[0]), remap.get(tri[1]), remap.get(tri[2]));
                }

                const clone = geomItem.cloneNode(true);

                const newVb = getDirectChild(clone, 'VertexBuffer');
                const newVData = getDirectChild(newVb, 'Data2') || getDirectChild(newVb, 'Data');
                newVData.textContent = "\n" + newVertLines.join('\n') + "\n              ";

                const newIb = getDirectChild(clone, 'IndexBuffer');
                const newIData = getDirectChild(newIb, 'Data2') || getDirectChild(newIb, 'Data');
                let iStr = "\n";
                for (let i = 0; i < newIndices.length; i += 24) {
                    iStr += "                " + newIndices.slice(i, i + 24).join(" ") + "\n";
                }
                newIData.textContent = iStr + "              ";

                clone.querySelectorAll('Vertices, VertexCount').forEach(n => { if (n.hasAttribute('value')) n.setAttribute('value', String(newVertLines.length)); });
                clone.querySelectorAll('Indices, IndicesCount').forEach(n => { if (n.hasAttribute('value')) n.setAttribute('value', String(newIndices.length)); });
                clone.querySelectorAll('PrimitiveCount').forEach(n => { if (n.hasAttribute('value')) n.setAttribute('value', String(newIndices.length / 3)); });

                const parsedVerts = newVertLines.map(line => {
                    const p = line.trim().split(/\s+/).filter(Boolean);
                    return { x: parseFloat(p[0]), y: parseFloat(p[1]), z: parseFloat(p[2]) };
                });
                const bounds = calculateBoundsFromVertices(parsedVerts);
                setDirectBounds(clone, bounds);

                parentGeometries.insertBefore(clone, insertRef);
            });

            parentGeometries.removeChild(geomItem);
            splitCount++;
        });

        return splitCount > 0;
    }

    function validateYddGeometry(xmlDoc) {
        const errors = [];
        const getDirectChild = (parent, tag) => Array.from(parent.children).find(c => c.nodeName === tag);

        Array.from(xmlDoc.querySelectorAll('Geometries > Item')).forEach((geomItem, geomIndex) => {
            const vb = getDirectChild(geomItem, 'VertexBuffer');
            const ib = getDirectChild(geomItem, 'IndexBuffer');
            if (!vb || !ib) {
                errors.push(`geometry #${geomIndex}: missing VertexBuffer/IndexBuffer`);
                return;
            }
            const vData = getDirectChild(vb, 'Data2') || getDirectChild(vb, 'Data');
            const iData = getDirectChild(ib, 'Data2') || getDirectChild(ib, 'Data');
            if (!vData || !iData) {
                errors.push(`geometry #${geomIndex}: missing vertex/index Data`);
                return;
            }
            const vLines = vData.textContent.split('\n').filter(line => line.trim().split(/\s+/).filter(Boolean).length >= 7);
            const iTokens = iData.textContent.trim().split(/\s+/).filter(t => t !== '');
            if (iTokens.length === 0 || iTokens.length % 3 !== 0) {
                errors.push(`geometry #${geomIndex}: index count ${iTokens.length} is not a positive multiple of three`);
                return;
            }
            const indices = iTokens.map(Number);
            const badIndex = indices.findIndex(index => !Number.isInteger(index) || index < 0 || index >= vLines.length);
            if (badIndex !== -1) {
                errors.push(`geometry #${geomIndex}: index ${iTokens[badIndex]} out of range (0..${vLines.length - 1})`);
                return;
            }
            const badVertex = vLines.findIndex(line => {
                const p = line.trim().split(/\s+/).filter(Boolean);
                return p.slice(0, 3).some(value => !Number.isFinite(Number(value)));
            });
            if (badVertex !== -1) errors.push(`geometry #${geomIndex}: vertex #${badVertex} has a non-numeric coordinate`);
        });

        return errors;
    }

    function circleOutlineParams(radius, gapFrac, widthFrac) {
        const R = Math.max(0, Number(radius) || 0);
        const gap = Math.min(1, Math.max(0, Number.isFinite(gapFrac) ? gapFrac : 0));
        const width = Math.min(1.5, Math.max(0.05, Number.isFinite(widthFrac) ? widthFrac : 0.29));
        const gapAbs = gap * R;
        const widthAbs = Math.max(0.2, width * R);
        return {
            contourR: R + gapAbs + widthAbs / 2,
            strokeWidth: widthAbs,
            dashLen: Math.max(1, widthAbs * 0.9),
            gapLen: Math.max(0.6, widthAbs * 0.5),
            dotSize: widthAbs
        };
    }

    function fitRingDashes(circumference, widthAbs) {
        const circ = Math.max(0.01, Number(circumference) || 0);
        const w = Math.max(0.2, Number(widthAbs) || 0.2);
        const gapSize = Math.max(0.6, w * 0.5);
        const wantUnit = Math.max(1.6, w * 0.9 + gapSize);
        const count = Math.max(3, Math.round(circ / wantUnit));
        return { dashSize: Math.max(0.5, circ / count - gapSize), gapSize, count };
    }

    return {
        clipTriangleToCell,
        mergeYddGeometry,
        calculateBoundsFromVertices,
        setDirectBounds,
        applyYddGeometryMerge,
        needsGeometrySplit,
        splitOversizedGeometries,
        validateYddGeometry,
        circleOutlineParams,
        fitRingDashes,
        triangleKey,
        chooseNearestCell,
        formatFloat32Shortest,
        formatBlenderXmlString
    };
});
