// ==========================================
// ИНСТРУМЕНТЫ ВЕКТОРОВ (Текст, SVG, Фигуры, Интерактивный размер)
// ==========================================

const vectorState = {
    objects: [],
    activeObj: null,
    loadedFont: null,
    loadedFontName: 'Roboto Black',
    loadedFontData: null,
    pendingSelectId: null,
    placementMode: null, // Флаг режима размещения
    undoStack: [],
    skipNextHistory: false,
    restoringHistory: false
};

function setConvertedVisible(zoneId, visible) {
    if (!vectorState || !vectorState.objects) return;
    vectorState.objects.forEach(obj => {
        if (obj.userData && obj.userData.convertedFrom === zoneId) obj.visible = visible;
    });
    if (window.requestSceneRender) window.requestSceneRender();
}
window.setConvertedVisible = setConvertedVisible;

let lastUndoSnapshotTime = 0;
function recordVectorUndoState(force) {
    if (vectorState.restoringHistory || vectorState.skipNextHistory || !window.getVectorsForJSON) return;
    const now = Date.now();
    if (!force && vectorState.undoStack.length > 0 && now - lastUndoSnapshotTime < 1000) return;
    lastUndoSnapshotTime = now;
    const snapshot = JSON.stringify(window.getVectorsForJSON());
    if (vectorState.undoStack[vectorState.undoStack.length - 1] !== snapshot) {
        vectorState.undoStack.push(snapshot);
        if (vectorState.undoStack.length > 30) vectorState.undoStack.shift();
    }
}

window.undoLastVectorAction = async function() {
    if (vectorState.pencilActive && vectorState.undoPencilPoint) {
        vectorState.undoPencilPoint();
        return;
    }
    const snapshot = vectorState.undoStack.pop();
    if (!snapshot || !window.clearVectors || !window.loadVectorsFromJSON) return;
    vectorState.restoringHistory = true;
    window.clearVectors();
    await window.loadVectorsFromJSON(JSON.parse(snapshot));
    vectorState.restoringHistory = false;
};

function activatePlacementMode(actionCallback, toolName) {
    if (vectorState.cancelPencil) vectorState.cancelPencil();
    if (window.cancelEraser) window.cancelEraser();
    vectorState.placementMode = actionCallback;
    document.body.style.cursor = 'crosshair';
    window.showToast(`Кликните ЛКМ для размещения, потяните для размера: ${toolName}`, 'success');
}

function getMeshes(object, includeStrokes = false) {
    const meshes = [];
    if (!object) return meshes;
    object.traverse(child => {
        if (child.isMesh && !child.userData.isPseudoTransparency && (includeStrokes || !child.userData.isStroke)) meshes.push(child);
    });
    return meshes;
}

function getPrimaryMesh(object) { return getMeshes(object, false)[0] || null; }
function getStrokeMeshes(object) {
    const out = [];
    if (!object) return out;
    object.traverse(child => {
        if ((child.isMesh || child.isLine) && child.userData.isStroke) out.push(child);
    });
    return out;
}

function disposeObject3D(object) {
    if (!object) return;
    object.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (Array.isArray(child.material)) child.material.forEach(material => material.dispose());
        else if (child.material) child.material.dispose();
    });
}

function removePseudoTransparency(wrapper) {
    wrapper.children.filter(child => child.userData && child.userData.isPseudoTransparency).forEach(child => {
        wrapper.remove(child);
        disposeObject3D(child);
    });
}

function clipPolygon(poly, edgeStart, edgeEnd, reference) {
    if (poly.length === 0) return [];
    const side = (point) => (edgeEnd.x - edgeStart.x) * (point.y - edgeStart.y) - (edgeEnd.y - edgeStart.y) * (point.x - edgeStart.x);
    const referenceSide = side(reference);
    // Вырожденное ребро: в закрытом виде возвращаем ПУСТО (иначе наружу
    // протекал бы необрезанный полигон — гигантские прямоугольники поверх карты).
    if (Math.abs(referenceSide) < 1e-8) return [];
    const inside = point => side(point) * referenceSide >= -1e-8;
    const intersection = (start, end) => {
        const startSide = side(start), endSide = side(end);
        const amount = startSide / (startSide - endSide);
        return { x: start.x + (end.x - start.x) * amount, y: start.y + (end.y - start.y) * amount };
    };
    const result = [];
    let previous = poly[poly.length - 1];
    for (const current of poly) {
        if (inside(current)) {
            if (!inside(previous)) result.push(intersection(previous, current));
            result.push(current);
        } else if (inside(previous)) {
            result.push(intersection(previous, current));
        }
        previous = current;
    }
    return result;
}

function barycentric2d(a, b, c, point) {
    const denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (Math.abs(denominator) < 1e-8) return [1, 0, 0];
    const wa = ((b.y - c.y) * (point.x - c.x) + (c.x - b.x) * (point.y - c.y)) / denominator;
    const wb = ((c.y - a.y) * (point.x - c.x) + (a.x - c.x) * (point.y - c.y)) / denominator;
    return [wa, wb, 1 - wa - wb];
}

function triArea2(a, b, c) {
    return (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
}

// Кламп цвета в [0,1]: барицентрика на иголках даёт веса ±1e6,
// без клампа в файл уплывают отрицательные цвета и роняют импорт
// (Sollumz: could not convert '-982' to uint32).
function clamp01(v) {
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

// Подразбиение больше не нужно: векторное перекрытие считается точным
// пересечением (см. ниже), а не сэмплом по центроиду.

// Узоры полупрозрачной заливки (псевдо-прозрачность): фигура покрывается
// полосами/точками тонированной карты, в промежутках видна чистая карта.
// Возвращает массив треугольников [{x, y} x3] — кусков исходного.
// Авторазмер узора по фигуре (метры): расстояние и толщина по умолчанию.
function fillPatternAutoFor(obj) {
    try {
        const box = new THREE.Box3().setFromObject(obj);
        const size = box.getSize(new THREE.Vector3());
        const diag = Math.sqrt(size.x * size.x + size.y * size.y);
        if (!(diag > 0)) return { spacing: 12, thickness: 5 };
        const spacing = Math.max(3, Math.min(60, diag / 12));
        return { spacing, thickness: spacing * 0.4 };
    } catch (e) { return { spacing: 12, thickness: 5 }; }
}

function fillPatternAngles(style) {
    if (style === 'zebra' || style === 'crosshatch') return style === 'zebra' ? [Math.PI / 4] : [Math.PI / 4, -Math.PI / 4];
    if (style === 'horizontal' || style === 'grid') return style === 'horizontal' ? [0] : [0, Math.PI / 2];
    if (style === 'vertical') return [Math.PI / 2];
    return null;
}

function splitTriangleByPattern(a, b, c, style, spacing, thickness, dotD) {
    const tri = [{ x: a.x, y: a.y }, { x: b.x, y: b.y }, { x: c.x, y: c.y }];
    const minX = Math.min(tri[0].x, tri[1].x, tri[2].x), maxX = Math.max(tri[0].x, tri[1].x, tri[2].x);
    const minY = Math.min(tri[0].y, tri[1].y, tri[2].y), maxY = Math.max(tri[0].y, tri[1].y, tri[2].y);
    if (style === 'dots') {
        const out = [];
        const R = Math.max(0.05, dotD / 2);
        for (let gx = Math.floor((minX - R) / spacing) * spacing; gx <= maxX + R; gx += spacing) {
            for (let gy = Math.floor((minY - R) / spacing) * spacing; gy <= maxY + R; gy += spacing) {
                if (gx < minX - R || gx > maxX + R || gy < minY - R || gy > maxY + R) continue;
                const oct = [];
                for (let k = 0; k < 8; k++) {
                    const ang = (k / 8) * Math.PI * 2;
                    oct.push({ x: gx + R * Math.cos(ang), y: gy + R * Math.sin(ang) });
                }
                let poly = tri.slice();
                for (let e = 0; e < 8; e++) {
                    poly = clipPolygon(poly, oct[e], oct[(e + 1) % 8], { x: gx, y: gy });
                    if (poly.length < 3) break;
                }
                for (let i = 1; i < poly.length - 1; i++) out.push([poly[0], poly[i], poly[i + 1]]);
            }
        }
        return out;
    }
    const angles = fillPatternAngles(style);
    if (!angles) return [tri];
    const out = [];
    angles.forEach(ang => {
        const cos = Math.cos(ang), sin = Math.sin(ang);
        const rot = p => ({ x: p.x * cos + p.y * sin, y: -p.x * sin + p.y * cos });
        const unrot = p => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos });
        const rt = tri.map(rot);
        const rxs = rt.map(p => p.x), rys = rt.map(p => p.y);
        const rminX = Math.min.apply(null, rxs) - 1, rmaxX = Math.max.apply(null, rxs) + 1;
        const rminY = Math.min.apply(null, rys);
        const rmaxY = Math.max.apply(null, rys);
        for (let y0 = Math.floor((rminY - thickness) / spacing) * spacing; y0 <= rmaxY; y0 += spacing) {
            const band = [{ x: rminX, y: y0 }, { x: rmaxX, y: y0 }, { x: rmaxX, y: y0 + thickness }, { x: rminX, y: y0 + thickness }];
            const ccx = (rminX + rmaxX) / 2, ccy = y0 + thickness / 2;
            let poly = rt.slice();
            const edges = [[band[0], band[1]], [band[1], band[2]], [band[2], band[3]], [band[3], band[0]]];
            for (let e = 0; e < 4; e++) {
                poly = clipPolygon(poly, edges[e][0], edges[e][1], { x: ccx, y: ccy });
                if (poly.length < 3) break;
            }
            if (poly.length >= 3) {
                const world = poly.map(unrot);
                for (let i = 1; i < world.length - 1; i++) out.push([world[0], world[i], world[i + 1]]);
            }
        }
    });
    return out;
}

function applyStrokeHoles(geometry, holes) {
    if (!geometry || !holes || holes.length === 0) return geometry;
    const posAttr = geometry.attributes.position;
    if (!posAttr) return geometry;
    const indexAttr = geometry.index;
    const triCount = indexAttr ? indexAttr.count / 3 : posAttr.count / 3;
    const kept = [];
    for (let i = 0; i < triCount; i++) {
        const ids = indexAttr ? [indexAttr.getX(i * 3), indexAttr.getX(i * 3 + 1), indexAttr.getX(i * 3 + 2)] : [i * 3, i * 3 + 1, i * 3 + 2];
        const cx = (posAttr.getX(ids[0]) + posAttr.getX(ids[1]) + posAttr.getX(ids[2])) / 3;
        const cy = (posAttr.getY(ids[0]) + posAttr.getY(ids[1]) + posAttr.getY(ids[2])) / 3;
        let hit = false;
        for (let h = 0; h < holes.length; h++) {
            const dx = cx - holes[h].x, dy = cy - holes[h].y;
            if (dx * dx + dy * dy <= holes[h].r * holes[h].r) { hit = true; break; }
        }
        if (!hit) kept.push(ids);
    }
    if (kept.length === triCount) return geometry;
    if (kept.length === 0) { geometry.dispose(); return null; }
    const names = Object.keys(geometry.attributes);
    const arrays = {};
    names.forEach(n => { arrays[n] = []; });
    const newIndex = [];
    kept.forEach(tri => tri.forEach(id => {
        newIndex.push(newIndex.length);
        names.forEach(n => {
            const attr = geometry.attributes[n];
            for (let k = 0; k < attr.itemSize; k++) arrays[n].push(attr.array[id * attr.itemSize + k]);
        });
    }));
    const newGeo = new THREE.BufferGeometry();
    names.forEach(n => newGeo.setAttribute(n, new THREE.Float32BufferAttribute(arrays[n], geometry.attributes[n].itemSize)));
    newGeo.setIndex(newIndex);
    newGeo.computeBoundingSphere();
    geometry.dispose();
    return newGeo;
}

function svgPointInPolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i], b = polygon[j];
        const crosses = ((a.y > point.y) !== (b.y > point.y)) &&
            point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || Number.EPSILON) + a.x;
        if (crosses) inside = !inside;
    }
    return inside;
}

function svgPolygonArea(points) {
    let area = 0;
    for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        area += a.x * b.y - b.x * a.y;
    }
    return area * 0.5;
}

function createSvgShapesSafely(path) {
    try {
        const contours = (path.subPaths || []).map(subPath => {
            const points = subPath.getPoints(12).map(point => ({ x: point.x, y: point.y }));
            const cleaned = [];
            points.forEach(point => {
                const previous = cleaned[cleaned.length - 1];
                if (!previous || previous.x !== point.x || previous.y !== point.y) cleaned.push(point);
            });
            if (cleaned.length > 2) {
                const first = cleaned[0], last = cleaned[cleaned.length - 1];
                if (first.x === last.x && first.y === last.y) cleaned.pop();
            }
            return cleaned.length >= 3 ? { points: cleaned, area: Math.abs(svgPolygonArea(cleaned)) } : null;
        }).filter(Boolean).filter(contour => contour.area > 1e-8);

        if (contours.length === 0) return [];

        contours.forEach(contour => {
            contour.depth = contours.reduce((depth, other) => {
                if (other === contour || other.area <= contour.area) return depth;
                return svgPointInPolygon(contour.points[0], other.points) ? depth + 1 : depth;
            }, 0);
        });

        const shapes = [];
        contours.filter(contour => contour.depth % 2 === 0).forEach(outer => {
            const shape = new THREE.Shape(outer.points.map(point => new THREE.Vector2(point.x, point.y)));
            contours.filter(hole => hole.depth === outer.depth + 1 && svgPointInPolygon(hole.points[0], outer.points)).forEach(hole => {
                shape.holes.push(new THREE.Path(hole.points.map(point => new THREE.Vector2(point.x, point.y))));
            });
            shapes.push(shape);
        });
        return shapes;
    } catch (error) {
        console.warn('SVG contour skipped:', error);
        return [];
    }
}
window.createSafeSvgShapes = createSvgShapesSafely;

function loadImageFromDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('PNG не удалось прочитать'));
        image.src = dataUrl;
    });
}

async function createPixelImageGeometry(dataUrl, maxDimension = 128) {
    const image = await loadImageFromDataUrl(dataUrl);
    const ratio = Math.min(1, maxDimension / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
    const width = Math.max(1, Math.round((image.naturalWidth || image.width) * ratio));
    const height = Math.max(1, Math.round((image.naturalHeight || image.height) * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    const pixelSize = 10 / Math.max(width, height);
    const startX = -(width * pixelSize) / 2;
    const startY = (height * pixelSize) / 2;
    const positions = [], colors = [], indices = [];
    let vertexIndex = 0;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const offset = (y * width + x) * 4;
            const alpha = pixels[offset + 3];
            if (alpha < 8) continue;
            const x0 = startX + x * pixelSize;
            const x1 = x0 + pixelSize;
            const y1 = startY - y * pixelSize;
            const y0 = y1 - pixelSize;
            positions.push(x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y1, 0);
            for (let i = 0; i < 4; i++) colors.push(pixels[offset] / 255, pixels[offset + 1] / 255, pixels[offset + 2] / 255);
            indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex, vertexIndex + 2, vertexIndex + 3);
            vertexIndex += 4;
        }
    }
    if (positions.length === 0) throw new Error('PNG не содержит видимых пикселей');
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.userData.pixelImage = true;
    geometry.userData.pixelWidth = width;
    geometry.userData.pixelHeight = height;
    return geometry;
}

let cachedMapTriangles = null;
let cachedMapBuildId = -1;

function getCachedMapTriangles() {
    const buildId = window.__mapBuildId || 0;
    if (cachedMapTriangles && cachedMapBuildId === buildId) return cachedMapTriangles;
    const tris = [];
    const seenGeometries = new Set();
    scene.children.forEach(mapMesh => {
        if (!mapMesh.isMesh || !mapMesh.userData.isMapMesh || mapMesh.userData.isMclLayer || mapMesh.name === 'mapCutout' || !mapMesh.geometry || seenGeometries.has(mapMesh.geometry)) return;
        const geometry = mapMesh.geometry;
        const positions = geometry.attributes.position;
        const colors = geometry.attributes.customColor || geometry.attributes.color;
        if (!positions) return;
        seenGeometries.add(geometry);
        mapMesh.updateMatrixWorld(true);
        const m = mapMesh.matrixWorld.elements;
        const readX = (id) => positions.getX(id) * m[0] + positions.getY(id) * m[4] + positions.getZ(id) * m[8] + m[12];
        const readY = (id) => positions.getX(id) * m[1] + positions.getY(id) * m[5] + positions.getZ(id) * m[9] + m[13];
        const index = geometry.index;
        const count = index ? index.count : positions.count;
        const zLayer = mapMesh.userData.zLayer || 0;
        for (let i = 0; i + 2 < count; i += 3) {
            const ids = index ? [index.getX(i), index.getX(i + 1), index.getX(i + 2)] : [i, i + 1, i + 2];
            const x0 = readX(ids[0]), y0 = readY(ids[0]);
            const x1 = readX(ids[1]), y1 = readY(ids[1]);
            const x2 = readX(ids[2]), y2 = readY(ids[2]);
            tris.push({
                x0, y0, x1, y1, x2, y2,
                colorAttr: colors, ids,
                zLayer,
                minX: Math.min(x0, x1, x2), maxX: Math.max(x0, x1, x2),
                minY: Math.min(y0, y1, y2), maxY: Math.max(y0, y1, y2)
            });
        }
    });
    const cache = { tris, tick: 0, stamp: new Uint32Array(Math.max(tris.length, 1)) };
    if (tris.length > 0) {
        let gminX = Infinity, gminY = Infinity, gmaxX = -Infinity, gmaxY = -Infinity;
        tris.forEach(t => {
            if (t.minX < gminX) gminX = t.minX; if (t.minY < gminY) gminY = t.minY;
            if (t.maxX > gmaxX) gmaxX = t.maxX; if (t.maxY > gmaxY) gmaxY = t.maxY;
        });
        const cell = 350;
        const nx = Math.max(1, Math.ceil((gmaxX - gminX) / cell));
        const ny = Math.max(1, Math.ceil((gmaxY - gminY) / cell));
        const cells = new Map();
        tris.forEach((t, ti) => {
            const x0 = Math.max(0, Math.min(nx - 1, Math.floor((t.minX - gminX) / cell)));
            const x1 = Math.max(0, Math.min(nx - 1, Math.floor((t.maxX - gminX) / cell)));
            const y0 = Math.max(0, Math.min(ny - 1, Math.floor((t.minY - gminY) / cell)));
            const y1 = Math.max(0, Math.min(ny - 1, Math.floor((t.maxY - gminY) / cell)));
            for (let cx = x0; cx <= x1; cx++) {
                for (let cy = y0; cy <= y1; cy++) {
                    const key = cx * ny + cy;
                    let list = cells.get(key);
                    if (!list) { list = []; cells.set(key, list); }
                    list.push(ti);
                }
            }
        });
        cache.grid = { cells, cell, gminX, gminY, nx, ny };
    }
    cachedMapTriangles = cache;
    cachedMapBuildId = buildId;
    return cache;
}

function queryMapTriangles(cache, minX, minY, maxX, maxY, cb) {
    const tris = cache.tris;
    if (!cache.grid) {
        for (let ti = 0; ti < tris.length; ti++) cb(tris[ti]);
        return;
    }
    const { cells, cell, gminX, gminY, nx, ny } = cache.grid;
    cache.tick++;
    if (cache.tick > 2000000000) { cache.stamp.fill(0); cache.tick = 1; }
    const tick = cache.tick;
    const x0 = Math.max(0, Math.min(nx - 1, Math.floor((minX - gminX) / cell)));
    const x1 = Math.max(0, Math.min(nx - 1, Math.floor((maxX - gminX) / cell)));
    const y0 = Math.max(0, Math.min(ny - 1, Math.floor((minY - gminY) / cell)));
    const y1 = Math.max(0, Math.min(ny - 1, Math.floor((maxY - gminY) / cell)));
    for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
            const list = cells.get(cx * ny + cy);
            if (!list) continue;
            for (let li = 0; li < list.length; li++) {
                const ti = list[li];
                if (cache.stamp[ti] === tick) continue;
                cache.stamp[ti] = tick;
                cb(tris[ti]);
            }
        }
    }
}
window.invalidateMapTriangleCache = function() { cachedMapTriangles = null; };

// Кэш векторного контента под полупрозрачной фигурой: видимые непрозрачные
// меши фигур/обводок (плоский цвет) + чужие вырезки (уже смешанный цвет).
// Маркеры и текст не сэмплируются — они всегда рисуются поверх.
// Строится заново при каждой перестройке (трансформы постоянно меняются).
// Треугольники лежат в spatial grid (как mapCache): иначе фигуры-монстры
// (обводки аирдропов на всю карту) вешают каждый кусок миллиардами проверок.
// Кэш извлечённых треугольников меша: повторное извлечение только если
// сменились геометрия, матрица или цвет (иначе трансформы/перекраски
// каждый раз пережевывали бы всю сцену заново).
const vecCoverMeshCache = new WeakMap();
function extractCoverTris(mesh) {
    const geometry = mesh.geometry;
    const positions = geometry.attributes.position;
    if (!positions) return null;
    mesh.updateMatrixWorld(true);
    const m = mesh.matrixWorld.elements;
    const mat = mesh.material;
    const colorKey = (mat && mat.color ? mat.color.getHexString() + '|' : 'x|') + (mat && mat.opacity !== undefined ? mat.opacity : 1);
    const hit = vecCoverMeshCache.get(mesh);
    if (hit && hit.geom === geometry && hit.colorKey === colorKey && hit.els.length === 16) {
        let same = true;
        for (let k = 0; k < 16; k++) {
            if (hit.els[k] !== m[k]) { same = false; break; }
        }
        if (same) return hit.data;
    }
    const wx = (id) => positions.getX(id) * m[0] + positions.getY(id) * m[4] + positions.getZ(id) * m[8] + m[12];
    const wy = (id) => positions.getX(id) * m[1] + positions.getY(id) * m[5] + positions.getZ(id) * m[9] + m[13];
    const colors = geometry.attributes.customColor || geometry.attributes.color;
    const flat = mat && mat.color ? [mat.color.r, mat.color.g, mat.color.b] : [1, 1, 1];
    const index = geometry.index;
    const count = index ? index.count : positions.count;
    const data = { tris: [], minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    for (let i = 0; i + 2 < count; i += 3) {
        const ids = index ? [index.getX(i), index.getX(i + 1), index.getX(i + 2)] : [i, i + 1, i + 2];
        const a = { x: wx(ids[0]), y: wy(ids[0]) }, b = { x: wx(ids[1]), y: wy(ids[1]) }, c = { x: wx(ids[2]), y: wy(ids[2]) };
        if (Math.abs(triArea2(a, b, c)) < 1e-9) continue;
        data.tris.push({
            a, b, c,
            minX: Math.min(a.x, b.x, c.x), maxX: Math.max(a.x, b.x, c.x),
            minY: Math.min(a.y, b.y, c.y), maxY: Math.max(a.y, b.y, c.y),
            cols: colors ? ids.map(id => [colors.getX(id), colors.getY(id), colors.getZ(id)]) : [flat, flat, flat]
        });
        if (a.x < data.minX) data.minX = a.x; if (a.x > data.maxX) data.maxX = a.x;
        if (b.x < data.minX) data.minX = b.x; if (b.x > data.maxX) data.maxX = b.x;
        if (c.x < data.minX) data.minX = c.x; if (c.x > data.maxX) data.maxX = c.x;
        if (a.y < data.minY) data.minY = a.y; if (a.y > data.maxY) data.maxY = a.y;
        if (b.y < data.minY) data.minY = b.y; if (b.y > data.maxY) data.maxY = b.y;
        if (c.y < data.minY) data.minY = c.y; if (c.y > data.maxY) data.maxY = c.y;
    }
    if (data.tris.length === 0) return null;
    vecCoverMeshCache.set(mesh, { geom: geometry, els: Array.from(m), colorKey, data });
    return data;
}

function buildVectorCoverCache() {
    const tris = [];
    if (vectorState && vectorState.objects) vectorState.objects.forEach((w, ownerIdx) => {
        if (!w) return;
        w.updateMatrixWorld(true);
        w.traverse(child => {
            if (!child.isMesh || !child.geometry) return;
            if (!child.material) return;
            const isCutout = Boolean(child.userData.isPseudoTransparency);
            if (!isCutout) {
                if (child.visible === false) return;
                if (child.userData.isText || child.userData.isGameZone) return;
                const op = child.userData.pseudoOpacity ?? child.material?.opacity ?? 1;
                if (!(op >= 0.999)) return;
            }
            const data = extractCoverTris(child);
            if (!data || data.tris.length === 0) return;
            data.tris.forEach(t => tris.push({
                a: t.a, b: t.b, c: t.c, ownerIdx,
                minX: t.minX, maxX: t.maxX, minY: t.minY, maxY: t.maxY,
                cols: t.cols
            }));
        });
    });
    const cache = { tris, tick: 0, stamp: new Uint32Array(Math.max(tris.length, 1)) };
    if (tris.length > 0) {
        let gminX = Infinity, gminY = Infinity, gmaxX = -Infinity, gmaxY = -Infinity;
        tris.forEach(t => {
            if (t.minX < gminX) gminX = t.minX; if (t.minY < gminY) gminY = t.minY;
            if (t.maxX > gmaxX) gmaxX = t.maxX; if (t.maxY > gmaxY) gmaxY = t.maxY;
        });
        const cell = 350;
        const nx = Math.max(1, Math.ceil((gmaxX - gminX) / cell));
        const ny = Math.max(1, Math.ceil((gmaxY - gminY) / cell));
        const cells = new Map();
        tris.forEach((t, ti) => {
            const x0 = Math.max(0, Math.min(nx - 1, Math.floor((t.minX - gminX) / cell)));
            const x1 = Math.max(0, Math.min(nx - 1, Math.floor((t.maxX - gminX) / cell)));
            const y0 = Math.max(0, Math.min(ny - 1, Math.floor((t.minY - gminY) / cell)));
            const y1 = Math.max(0, Math.min(ny - 1, Math.floor((t.maxY - gminY) / cell)));
            for (let cx = x0; cx <= x1; cx++) {
                for (let cy = y0; cy <= y1; cy++) {
                    const key = cx * ny + cy;
                    let list = cells.get(key);
                    if (!list) { list = []; cells.set(key, list); }
                    list.push(ti);
                }
            }
        });
        cache.grid = { cells, cell, gminX, gminY, nx, ny };
    }
    return cache;
}

// Покрывающие треугольники векторного контента над куском: только владельцы
// строго НИЖЕ строящейся фигуры (сверху вниз через spatial grid).
// Первый выигрывает ties по глубине — границы идут по рёбрам, без блоков.
function coveringVectorTris(cache, ownIdx, piece) {
    const out = [];
    if (!cache || !cache.tris || cache.tris.length === 0) return out;
    const minX = Math.min(piece[0].x, piece[1].x, piece[2].x);
    const maxX = Math.max(piece[0].x, piece[1].x, piece[2].x);
    const minY = Math.min(piece[0].y, piece[1].y, piece[2].y);
    const maxY = Math.max(piece[0].y, piece[1].y, piece[2].y);
    const pushTri = (t) => {
        if (t.ownerIdx <= ownIdx) return;
        if (maxX < t.minX || minX > t.maxX || maxY < t.minY || minY > t.maxY) return;
        out.push({ tri: t, cols: t.cols, ownerIdx: t.ownerIdx });
    };
    if (!cache.grid) {
        cache.tris.forEach(pushTri);
    } else {
        const { cells, cell, gminX, gminY, nx, ny } = cache.grid;
        cache.tick++;
        if (cache.tick > 2000000000) { cache.stamp.fill(0); cache.tick = 1; }
        const tick = cache.tick;
        const x0 = Math.max(0, Math.min(nx - 1, Math.floor((minX - gminX) / cell)));
        const x1 = Math.max(0, Math.min(nx - 1, Math.floor((maxX - gminX) / cell)));
        const y0 = Math.max(0, Math.min(ny - 1, Math.floor((minY - gminY) / cell)));
        const y1 = Math.max(0, Math.min(ny - 1, Math.floor((maxY - gminY) / cell)));
        for (let cx = x0; cx <= x1; cx++) {
            for (let cy = y0; cy <= y1; cy++) {
                const list = cells.get(cx * ny + cy);
                if (!list) continue;
                for (let li = 0; li < list.length; li++) {
                    const ti = list[li];
                    if (cache.stamp[ti] === tick) continue;
                    cache.stamp[ti] = tick;
                    pushTri(cache.tris[ti]);
                }
            }
        }
    }
    out.sort((a, b) => a.ownerIdx - b.ownerIdx);
    return out;
}

function rebuildPseudoTransparency(wrapper) {
    if (!wrapper) return;
    const __rbT0 = (typeof performance !== 'undefined') ? performance.now() : 0;
    let __srcTris = 0, __cutTris = 0;
    removePseudoTransparency(wrapper);
    wrapper.traverse(child => {
        if (child.isMesh && !child.userData.isPseudoTransparency) child.visible = !child.userData.fillHidden;
    });

    const mapCache = getCachedMapTriangles();
    // Пустой кэш — не повод оставлять глухую заливку: каждый источник
    // ниже сам решит (вырезка или честная прозрачность).
    // Векторный кэш: всё видимое непрозрачное под фигурой (фигуры, обводки,
    // чужие вырезки) — чтобы перекрытия тонировались друг через друга,
    // а не только через карту.
    const vecCoverCache = buildVectorCoverCache();
    const ownOrderIdx = (vectorState && vectorState.objects) ? vectorState.objects.indexOf(wrapper) : -1;

    const pseudoSources = [];
    wrapper.traverse(child => {
        // Текст тоже участвует в прозрачности: полупрозрачный текст получает
        // тонированную вырезку-глифы, сплошной (opacity 1) идёт как раньше.
        if (child.isMesh && !child.userData.isPseudoTransparency) pseudoSources.push(child);
    });
    pseudoSources.forEach(sourceMesh => {
        const opacity = sourceMesh.userData.isText
            ? (sourceMesh.userData.textOpacity ?? sourceMesh.material?.opacity ?? 1)
            : (sourceMesh.userData.pseudoOpacity ?? sourceMesh.material?.opacity ?? 1);
        if (!sourceMesh.visible || !sourceMesh.geometry || !sourceMesh.material) return;
        // Обводкам вырезка нужна всегда (даже непрозрачным): иначе их хоронит
        // вырезка заливки, лежащая выше. Остальным непрозрачным она не нужна.
        const isStrokeSrc = Boolean(sourceMesh.userData.isStroke);
        if (!isStrokeSrc && opacity >= 0.999) return;
        // Прозрачность 0 = заливка выключена: ничего не рисуем и не вырезаем.
        if (opacity < 0.001) {
            sourceMesh.visible = false;
            return;
        }
        const positions = sourceMesh.geometry.attributes.position;
        if (!positions) return;
        sourceMesh.updateMatrixWorld(true);
        const index = sourceMesh.geometry.index;
        const count = index ? index.count : positions.count;
        const sourceTriangles = [];
        const sourceTriCols = [];
        const figureColor = sourceMesh.material.color || new THREE.Color(1, 1, 1);
        const srcColorAttr = sourceMesh.geometry.attributes.customColor || sourceMesh.geometry.attributes.color;
        const srcFlatCol = [figureColor.r, figureColor.g, figureColor.b];
        for (let i = 0; i + 2 < count; i += 3) {
            const ids = index ? [index.getX(i), index.getX(i + 1), index.getX(i + 2)] : [i, i + 1, i + 2];
            sourceTriangles.push(ids.map(id => new THREE.Vector3(positions.getX(id), positions.getY(id), positions.getZ(id)).applyMatrix4(sourceMesh.matrixWorld)));
            sourceTriCols.push(ids.map(id => srcColorAttr ? [srcColorAttr.getX(id), srcColorAttr.getY(id), srcColorAttr.getZ(id)] : srcFlatCol));
        }
        __srcTris += sourceTriangles.length;

        const layerOutputs = new Map();
        const outputForLayer = (zLayer) => {
            let bucket = layerOutputs.get(zLayer);
            if (!bucket) { bucket = { positions: [], colors: [] }; layerOutputs.set(zLayer, bucket); }
            return bucket;
        };
        let sourceBaseZ = -Infinity;
        sourceTriangles.forEach(triangle => triangle.forEach(vertex => { if (vertex.z > sourceBaseZ) sourceBaseZ = vertex.z; }));
        sourceBaseZ += 0.1;
        // Порядок фигуры в стеке (0 — верхняя): верхняя выигрывает пересечения
        // детерминированно — и в превью, и в игре. Без этого совпадающие Z
        // дают рваные перекрытия cutout-треугольников друг другом.
        const stackLen = (vectorState && vectorState.objects) ? vectorState.objects.length : 1;
        const stackIdx = (vectorState && vectorState.objects) ? vectorState.objects.indexOf(wrapper) : 0;
        const orderFrac = stackLen > 1 ? (stackLen - 1 - Math.max(0, stackIdx)) / (stackLen - 1) : 1;
        // Узор заливки: фигура покрывается полосами/точками, сплошная заливка
        // при этом исчезает (вырезка строится только по кускам узора).
        // Обводки (isStroke) всегда сплошные.
        const fillPattern = wrapper.userData.fillPattern || 'solid';
        const usePattern = fillPattern !== 'solid' && !sourceMesh.userData.isStroke;
        let patSpacing = 0, patThickness = 0, patDotD = 0;
        if (usePattern && sourceTriangles.length > 0) {
            let pminX = Infinity, pmaxX = -Infinity, pminY = Infinity, pmaxY = -Infinity;
            sourceTriangles.forEach(triangle => triangle.forEach(vertex => {
                if (vertex.x < pminX) pminX = vertex.x; if (vertex.x > pmaxX) pmaxX = vertex.x;
                if (vertex.y < pminY) pminY = vertex.y; if (vertex.y > pmaxY) pmaxY = vertex.y;
            }));
            const diag = Math.sqrt((pmaxX - pminX) * (pmaxX - pminX) + (pmaxY - pminY) * (pmaxY - pminY));
            const autoS = Math.max(3, Math.min(60, diag / 12));
            const storedS = wrapper.userData.fillPatternSpacing, storedT = wrapper.userData.fillPatternThickness;
            patSpacing = (Number.isFinite(storedS) && storedS > 0) ? storedS : autoS;
            patThickness = (Number.isFinite(storedT) && storedT > 0) ? storedT : patSpacing * 0.4;
            patDotD = patThickness;
        }
        const figurePieces = [];
        sourceTriangles.forEach((triangle, ti) => {
            const tcols = sourceTriCols[ti];
            const triXY = [{ x: triangle[0].x, y: triangle[0].y }, { x: triangle[1].x, y: triangle[1].y }, { x: triangle[2].x, y: triangle[2].y }];
            if (usePattern) {
                splitTriangleByPattern(triangle[0], triangle[1], triangle[2], fillPattern, patSpacing, patThickness, patDotD).forEach(p => {
                    figurePieces.push(p.map(pt => {
                        const w = barycentric2d(triXY[0], triXY[1], triXY[2], pt);
                        return {
                            x: pt.x, y: pt.y,
                            c: [
                                clamp01(tcols[0][0] * w[0] + tcols[1][0] * w[1] + tcols[2][0] * w[2]),
                                clamp01(tcols[0][1] * w[0] + tcols[1][1] * w[1] + tcols[2][1] * w[2]),
                                clamp01(tcols[0][2] * w[0] + tcols[1][2] * w[1] + tcols[2][2] * w[2])
                            ]
                        };
                    }));
                });
            } else {
                figurePieces.push([
                    { x: triangle[0].x, y: triangle[0].y, c: tcols[0] },
                    { x: triangle[1].x, y: triangle[1].y, c: tcols[1] },
                    { x: triangle[2].x, y: triangle[2].y, c: tcols[2] }
                ]);
            }
        });
        // Крупные куски идут как есть: векторное перекрытие считается точным
        // пересечением ниже, блочных ошибок нет.
        figurePieces.forEach(figure => {
            const minX = Math.min(figure[0].x, figure[1].x, figure[2].x);
            const maxX = Math.max(figure[0].x, figure[1].x, figure[2].x);
            const minY = Math.min(figure[0].y, figure[1].y, figure[2].y);
            const maxY = Math.max(figure[0].y, figure[1].y, figure[2].y);
            if (Math.abs(triArea2(figure[0], figure[1], figure[2])) < 1e-6) return;
            queryMapTriangles(mapCache, minX, minY, maxX, maxY, map => {
            if (map.maxX < minX || map.minX > maxX || map.maxY < minY || map.minY > maxY) return;
            let polygon = [{ x: map.x0, y: map.y0 }, { x: map.x1, y: map.y1 }, { x: map.x2, y: map.y2 }];
            polygon = clipPolygon(polygon, figure[0], figure[1], figure[2]);
            polygon = clipPolygon(polygon, figure[1], figure[2], figure[0]);
            polygon = clipPolygon(polygon, figure[2], figure[0], figure[1]);
            if (polygon.length < 3) return;
            const cAttr = map.colorAttr;
            const mr = cAttr ? [cAttr.getX(map.ids[0]), cAttr.getX(map.ids[1]), cAttr.getX(map.ids[2])] : [1, 1, 1];
            const mg = cAttr ? [cAttr.getY(map.ids[0]), cAttr.getY(map.ids[1]), cAttr.getY(map.ids[2])] : [1, 1, 1];
            const mb = cAttr ? [cAttr.getZ(map.ids[0]), cAttr.getZ(map.ids[1]), cAttr.getZ(map.ids[2])] : [1, 1, 1];
            const ma = (cAttr && cAttr.itemSize > 3) ? [cAttr.getW(map.ids[0]), cAttr.getW(map.ids[1]), cAttr.getW(map.ids[2])] : [1, 1, 1];
            const pr = [mr[0] * ma[0], mr[1] * ma[1], mr[2] * ma[2]];
            const pg = [mg[0] * ma[0], mg[1] * ma[1], mg[2] * ma[2]];
            const pb = [mb[0] * ma[0], mb[1] * ma[1], mb[2] * ma[2]];
            for (let i = 1; i < polygon.length - 1; i++) {
                const triPts = [polygon[0], polygon[i], polygon[i + 1]];
                const ccx = (triPts[0].x + triPts[1].x + triPts[2].x) / 3;
                const ccy = (triPts[0].y + triPts[1].y + triPts[2].y) / 3;
                const cw = barycentric2d(figure[0], figure[1], figure[2], { x: ccx, y: ccy });
                if (cw[0] < -1e-6 || cw[1] < -1e-6 || cw[2] < -1e-6) continue;
                triPts.forEach(point => {
                    const weights = barycentric2d({ x: map.x0, y: map.y0 }, { x: map.x1, y: map.y1 }, { x: map.x2, y: map.y2 }, point);
                    const mapColor = [pr[0] * weights[0] + pr[1] * weights[1] + pr[2] * weights[2], pg[0] * weights[0] + pg[1] * weights[1] + pg[2] * weights[2], pb[0] * weights[0] + pb[1] * weights[1] + pb[2] * weights[2]];
                    const fw = barycentric2d(figure[0], figure[1], figure[2], point);
                    const figCol = [
                        figure[0].c[0] * fw[0] + figure[1].c[0] * fw[1] + figure[2].c[0] * fw[2],
                        figure[0].c[1] * fw[0] + figure[1].c[1] * fw[1] + figure[2].c[1] * fw[2],
                        figure[0].c[2] * fw[0] + figure[1].c[2] * fw[1] + figure[2].c[2] * fw[2]
                    ];
                    const color = [clamp01(figCol[0] * opacity + mapColor[0] * (1 - opacity)), clamp01(figCol[1] * opacity + mapColor[1] * (1 - opacity)), clamp01(figCol[2] * opacity + mapColor[2] * (1 - opacity))];
                    const sourceLayerOffset = sourceMesh.userData.isStroke ? 0.02 : 0;
                    // Порядок как в map/: sea (низ) → back → 0_0 (верх).
                    // Шаг 0.5: back больше не выпирает и не z-fights с соседями.
                    const kindZ = map.zLayer <= 0 ? 0 : (map.zLayer === 1 ? 1 : 2);
                    const worldPoint = new THREE.Vector3(point.x, point.y, sourceBaseZ + kindZ * 0.5 + sourceLayerOffset + orderFrac * 0.05);
                    const localPoint = wrapper.worldToLocal(worldPoint);
                    const bucket = outputForLayer(kindZ);
                    bucket.positions.push(localPoint.x, localPoint.y, localPoint.z);
                    bucket.colors.push(color[0], color[1], color[2]);
                });
            }
            });
            // Векторное содержимое под куском: точное пересечение с каждым
            // покрывающим треугольником (сверху вниз). Первый выигрывает
            // ties по глубине — границы идут по рёбрам, без блоков.
            const coverTris = coveringVectorTris(vecCoverCache, ownOrderIdx, figure);
            if (coverTris.length > 0) {
                const vw = sourceBaseZ + 3 * 0.5 + (sourceMesh.userData.isStroke ? 0.002 : 0) + orderFrac * 0.05;
                const bk = outputForLayer(3);
                coverTris.forEach(ct => {
                    let frag = [figure[0], figure[1], figure[2]];
                    frag = clipPolygon(frag, ct.tri.a, ct.tri.b, ct.tri.c);
                    frag = clipPolygon(frag, ct.tri.b, ct.tri.c, ct.tri.a);
                    frag = clipPolygon(frag, ct.tri.c, ct.tri.a, ct.tri.b);
                    for (let i = 1; i < frag.length - 1; i++) {
                        [frag[0], frag[i], frag[i + 1]].forEach(p => {
                            const w = barycentric2d(ct.tri.a, ct.tri.b, ct.tri.c, p);
                            const wf = barycentric2d(figure[0], figure[1], figure[2], p);
                            const figCol = [
                                figure[0].c[0] * wf[0] + figure[1].c[0] * wf[1] + figure[2].c[0] * wf[2],
                                figure[0].c[1] * wf[0] + figure[1].c[1] * wf[1] + figure[2].c[1] * wf[2],
                                figure[0].c[2] * wf[0] + figure[1].c[2] * wf[1] + figure[2].c[2] * wf[2]
                            ];
                            const wp = wrapper.worldToLocal(new THREE.Vector3(p.x, p.y, vw));
                            bk.positions.push(wp.x, wp.y, wp.z);
                            bk.colors.push(
                                clamp01(figCol[0] * opacity + (ct.cols[0][0] * w[0] + ct.cols[1][0] * w[1] + ct.cols[2][0] * w[2]) * (1 - opacity)),
                                clamp01(figCol[1] * opacity + (ct.cols[0][1] * w[0] + ct.cols[1][1] * w[1] + ct.cols[2][1] * w[2]) * (1 - opacity)),
                                clamp01(figCol[2] * opacity + (ct.cols[0][2] * w[0] + ct.cols[1][2] * w[1] + ct.cols[2][2] * w[2]) * (1 - opacity))
                            );
                        });
                    }
                });
            }
        });

        const sortedLayers = Array.from(layerOutputs.keys()).sort((a, b) => a - b);
        if (sortedLayers.length > 0) {
            sortedLayers.forEach(zLayer => {
                const bucket = layerOutputs.get(zLayer);
                if (!bucket || bucket.positions.length === 0) return;
                const geometry = new THREE.BufferGeometry();
                geometry.setAttribute('position', new THREE.Float32BufferAttribute(bucket.positions, 3));
                geometry.setAttribute('color', new THREE.Float32BufferAttribute(bucket.colors, 3));
                const cutout = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: false, opacity: 1, depthWrite: true }));
                cutout.name = 'mapCutout';
                cutout.userData.isPseudoTransparency = true;
                cutout.userData.cutoutLayer = zLayer;
                cutout.userData.bakedFrac = orderFrac;
                cutout.renderOrder = 990 + zLayer * 0.005 + orderFrac * 0.004 + (sourceMesh.userData.isStroke ? 0.001 : 0);
                __cutTris += bucket.positions.length / 9;
                wrapper.add(cutout);
            });
            sourceMesh.visible = false;
        } else if (opacity < 0.999) {
            // Вырезки нет (под фигурой нет карты): честная прозрачность меша
            // вместо глухой заливки, которая прятала всё снизу.
            // Непрозрачные без вырезки оставляем как есть (видны сами).
            const mat = sourceMesh.material;
            if (mat && !Array.isArray(mat)) {
                mat.transparent = true;
                mat.opacity = opacity;
                mat.depthWrite = false;
                mat.needsUpdate = true;
            }
        }
    });
    if (typeof performance !== 'undefined' && (performance.now() - __rbT0) > 500) {
        console.warn('[pseudo] slow rebuild:', wrapper.name, 'src=' + __srcTris, 'cut=' + Math.round(__cutTris), ((performance.now() - __rbT0) | 0) + 'ms');
    }
}

window.rebuildVectorPseudoTransparency = function() {
    // Снизу вверх: вырезки нижних уже свежие, когда верхние их сэмплируют.
    vectorState.objects.slice().reverse().forEach(rebuildPseudoTransparency);
    if (window.validateSceneGeometry) window.validateSceneGeometry(true);
};

// Асинхронная версия для тяжёлых путей (загрузки, включение зон):
// та же снизу-вверх, но с уступками браузеру и живым прогрессом.
// Параллельные вызовы складываются в один прогон.
let pseudoAsyncCurrent = null;
window.rebuildVectorPseudoTransparencyAsync = function(onProgress, only) {
    if (pseudoAsyncCurrent) return pseudoAsyncCurrent;
    pseudoAsyncCurrent = (async () => {
        try {
            const list = (only && only.length ? only.slice() : vectorState.objects.slice()).reverse();
            for (let i = 0; i < list.length; i++) {
                rebuildPseudoTransparency(list[i]);
                if (onProgress) {
                    try { onProgress(i + 1, list.length); } catch (e) {}
                }
                if (window.yieldToBrowser) await window.yieldToBrowser();
            }
            if (window.validateSceneGeometry) window.validateSceneGeometry(true);
            if (window.requestSceneRender) window.requestSceneRender();
        } finally {
            pseudoAsyncCurrent = null;
        }
    })();
    return pseudoAsyncCurrent;
};

// Срочно выполнить отложенные одиночные пересборки (перед экспортом,
// чтобы не читать сцену с несобранной прозрачностью).
window.flushPseudoRebuilds = function() {
    if (singleRebuildTimer !== null) { try { clearTimeout(singleRebuildTimer); } catch (e) {} singleRebuildTimer = null; }
    if (singleRebuildTargets.size === 0) return;
    const targets = Array.from(singleRebuildTargets);
    singleRebuildTargets.clear();
    targets.filter(t => t && vectorState.objects.includes(t))
        .sort((a, b) => vectorState.objects.indexOf(b) - vectorState.objects.indexOf(a))
        .forEach(target => rebuildPseudoTransparency(target));
    if (window.requestSceneRender) window.requestSceneRender();
};

// Ловец артефактов: ищет нефинитные вершины и длинные тонкие треугольники
// (полосы через полкарты). quiet=true — молчит, если всё чисто.
window.validateSceneGeometry = function(quiet) {
    const bad = [];
    try {
        scene.traverse(obj => {
            if (!obj.isMesh || !obj.geometry) return;
            const pos = obj.geometry.attributes.position;
            if (!pos) return;
            const arr = pos.array;
            const index = obj.geometry.index;
            const count = index ? index.count : pos.count;
            const nm = obj.name || obj.uuid || '?';
            for (let i = 0; i + 2 < count; i += 3) {
                const ids = index ? [index.getX(i), index.getX(i + 1), index.getX(i + 2)] : [i, i + 1, i + 2];
                const ax = arr[ids[0] * 3], ay = arr[ids[0] * 3 + 1];
                const bx = arr[ids[1] * 3], by = arr[ids[1] * 3 + 1];
                const cx = arr[ids[2] * 3], cy = arr[ids[2] * 3 + 1];
                if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by) || !Number.isFinite(cx) || !Number.isFinite(cy)) {
                    bad.push({ mesh: nm, kind: 'nonfinite', tri: i / 3 });
                    return;
                }
                const e0 = Math.hypot(bx - ax, by - ay), e1 = Math.hypot(cx - bx, cy - by), e2 = Math.hypot(ax - cx, ay - cy);
                const longest = Math.max(e0, e1, e2);
                const area2 = Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay));
                if (longest > 1000 && area2 < longest * 2 && bad.length < 20) {
                    bad.push({ mesh: nm, kind: 'sliver', tri: i / 3, longest: Math.round(longest), pts: [[ax, ay], [bx, by], [cx, cy]].map(p => p.map(v => Math.round(v * 10) / 10)) });
                }
            }
        });
    } catch (err) { console.warn('[geo-validate]', err); }
    if (bad.length > 0 || !quiet) console.warn('[geo-validate] issues:', bad.length, bad.slice(0, 20));
    return bad;
};

let singleRebuildTimer = null;
const singleRebuildTargets = new Set();
// Полная пересборка с задержкой после последнего вызова (перекраска карты):
// карта обновляется сразу, зоны подтягиваются потом.
let fullRebuildTimer = null;
window.scheduleFullPseudoRebuild = function(delayMs) {
    const delay = Number.isFinite(delayMs) ? delayMs : 700;
    if (fullRebuildTimer !== null) { try { clearTimeout(fullRebuildTimer); } catch (e) {} fullRebuildTimer = null; }
    fullRebuildTimer = setTimeout(() => {
        fullRebuildTimer = null;
        if (window.rebuildVectorPseudoTransparency) window.rebuildVectorPseudoTransparency();
        else if (window.requestSceneRender) window.requestSceneRender();
    }, delay);
};
window.scheduleSinglePseudoRebuild = function(wrapper) {
    const addWithAbove = (w) => {
        if (!w) return;
        singleRebuildTargets.add(w);
        // Всё, что выше изменённой фигуры, может показывать её старый оттенок.
        if (vectorState && vectorState.objects.includes(w)) {
            const idx = vectorState.objects.indexOf(w);
            for (let i = 0; i < idx; i++) singleRebuildTargets.add(vectorState.objects[i]);
        }
    };
    if (wrapper) {
        if (Array.isArray(wrapper)) wrapper.forEach(addWithAbove);
        else addWithAbove(wrapper);
    }
    if (singleRebuildTimer !== null) return;
    singleRebuildTimer = setTimeout(() => {
        singleRebuildTimer = null;
        const targets = Array.from(singleRebuildTargets);
        singleRebuildTargets.clear();
        // Снизу вверх — свежие нижние вырезки для верхних.
        targets.filter(t => t && vectorState.objects.includes(t))
            .sort((a, b) => vectorState.objects.indexOf(b) - vectorState.objects.indexOf(a))
            .forEach(target => rebuildPseudoTransparency(target));
        if (window.requestSceneRender) window.requestSceneRender();
    }, 120);
};

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer); let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    return btoa(binary);
}

function base64ToArrayBuffer(value) {
    const binary = atob(value); const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

window.getVectorCount = () => vectorState.objects.length;
window.setPendingVectorSelect = id => { vectorState.pendingSelectId = id; };

window.clearVectors = function() {
    if (vectorState.cancelPencil) vectorState.cancelPencil();
    if (window.vectorTransformControl) window.vectorTransformControl.detach();
    vectorState.objects.forEach(obj => { scene.remove(obj); disposeObject3D(obj); });
    vectorState.objects = [];
    vectorState.activeObj = null;
    document.getElementById('vectorLayersList').innerHTML = '<div class="text-[10px] text-slate-500 text-center py-2">Слоев нет</div>';
    
    const countSpan = document.getElementById('vectorLayerCount');
    if (countSpan) countSpan.textContent = '0';

    document.getElementById('vectorPropsPanel').classList.add('hidden');
    if (window.updateExportState) window.updateExportState();
    if (window.requestSceneRender) window.requestSceneRender();
};

document.addEventListener("DOMContentLoaded", () => {
    const transformControl = new THREE.TransformControls(camera, renderer.domElement);
    window.vectorTransformControl = transformControl;
    scene.add(transformControl);

    const ttfLoader = new THREE.TTFLoader();
    ttfLoader.load('vendor/roboto-black-webfont.ttf', (parsed) => {
        vectorState.loadedFont = new THREE.Font(parsed);
        vectorState.loadedFontName = 'Roboto Black';
    }, undefined, () => window.showToast("Не удалось загрузить стандартный шрифт", "error"));
    
    document.getElementById('vectorFontInput')?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        
        reader.onload = (event) => {
            try {
                const parsed = ttfLoader.parse(event.target.result);
                vectorState.loadedFont = new THREE.Font(parsed);
                vectorState.loadedFontName = file.name;
                vectorState.loadedFontData = event.target.result.slice(0);
                if (vectorState.activeObj) {
                    const firstMesh = getPrimaryMesh(vectorState.activeObj);
                    if (firstMesh && firstMesh.userData.isText) {
                        applyPropsToActive(true);
                    }
                }
                window.showToast("Шрифт (.ttf/.otf) загружен!", "success");
            } catch(err) { window.showToast("Ошибка при разборе шрифта!", "error"); }
        };
        reader.readAsArrayBuffer(file);
    });

    let isShiftDown = false;
    let initialScale = new THREE.Vector3();
    
    window.addEventListener('keydown', (e) => { 
        if (e.key === 'Escape' && (vectorState.pencilActive || vectorState.placementMode || eraserActive)) {
            if (vectorState.pencilActive && vectorState.cancelPencil) {
                vectorState.cancelPencil();
                window.showToast("Рисование отменено", "error");
            } else if (eraserActive) {
                cancelEraser();
                window.showToast("Ластик отключён", "success");
            } else {
                vectorState.placementMode = null;
                document.body.style.cursor = 'default';
                window.showToast("Размещение отменено", "error");
            }
            return;
        }

        if (e.key === 'Shift') isShiftDown = true; 

        if (e.ctrlKey && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            if (vectorState.pencilActive && vectorState.undoPencilPoint) vectorState.undoPencilPoint();
            else if (window.undoLastVectorAction) window.undoLastVectorAction();
            return;
        }
        
        const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
        if (activeTag === 'input' || activeTag === 'textarea') return;

        if (e.code === 'KeyW' || e.code === 'Ц') setTransformMode('translate', 'vecModeTranslate');
        if (e.code === 'KeyE' || e.code === 'У') setTransformMode('rotate', 'vecModeRotate');
        if (e.code === 'KeyR' || e.code === 'К') setTransformMode('scale', 'vecModeScale');
    });
    window.addEventListener('keyup', (e) => { if (e.key === 'Shift') isShiftDown = false; });

    transformControl.addEventListener('dragging-changed', (event) => {
        controls.enabled = !event.value;
        if (event.value && vectorState.activeObj) {
            initialScale.copy(vectorState.activeObj.scale);
            removePseudoTransparency(vectorState.activeObj);
            vectorState.activeObj.traverse(child => {
                if (child.isMesh && !child.userData.isPseudoTransparency) child.visible = !child.userData.fillHidden;
            });
            if (window.requestSceneRender) window.requestSceneRender();
        } else if (!event.value && vectorState.activeObj) {
            rebuildPseudoTransparency(vectorState.activeObj);
            if (window.requestSceneRender) window.requestSceneRender();
        }
    });

    transformControl.addEventListener('change', () => {
        if (window.requestSceneRender) window.requestSceneRender();
        if (transformControl.mode === 'scale' && transformControl.dragging && vectorState.activeObj && isShiftDown) {
            const currScale = vectorState.activeObj.scale;
            const ratioX = currScale.x / initialScale.x;
            const ratioY = currScale.y / initialScale.y;
            
            let maxRatio = Math.max(Math.abs(ratioX - 1), Math.abs(ratioY - 1)) === Math.abs(ratioX - 1) ? ratioX : ratioY;
            
            const signY = vectorState.activeObj.userData.isSvg ? -1 : 1;
            vectorState.activeObj.scale.set(initialScale.x * maxRatio, initialScale.y * maxRatio * signY, 1);
        }
        
        if (vectorState.activeObj && transformControl.mode === 'scale') {
            const currentScale = Math.abs(vectorState.activeObj.scale.x);
            const scaleSlider = document.getElementById('vecPropScale');
            const scaleNum = document.getElementById('vecPropScaleNum');
            updateWorldRadiusUI(vectorState.activeObj);
            if (scaleSlider && scaleNum) {
                scaleSlider.value = currentScale;
                scaleNum.value = currentScale.toFixed(2);
            }
        }
    });

    // --- ИНТЕРАКТИВНЫЙ ДРАГ ПРИ СОЗДАНИИ СЛОЯ ---
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let isPlacingDrag = false;
    let placingStartPoint = new THREE.Vector2();
    let placingObject = null;
    let placingStartScale = 2;
    let isPencilPanning = false;

    function getMapIntersection(e) {
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        
        let spawnX = 0, spawnY = 0;
        const mapMeshes = scene.children.filter(c => c.isMesh && c.userData.isMapMesh);
        const intersects = raycaster.intersectObjects(mapMeshes, false);
        
        if (intersects.length > 0) {
            spawnX = intersects[0].point.x;
            spawnY = intersects[0].point.y;
        } else {
            const zPlane = window.mapBounds ? window.mapBounds.maxZ : 10;
            const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -zPlane);
            const target = new THREE.Vector3();
            raycaster.ray.intersectPlane(plane, target);
            if (target) { spawnX = target.x; spawnY = target.y; }
        }
        return { x: spawnX, y: spawnY };
    }

    function updateScaleUIForDrag(scaleVal) {
        const scaleSlider = document.getElementById('vecPropScale');
        const scaleNum = document.getElementById('vecPropScaleNum');
        if (scaleSlider && scaleNum) {
            scaleSlider.value = scaleVal;
            scaleNum.value = scaleVal.toFixed(2);
        }
    }

    function getObjectWorldRadius(obj) {
        if (!obj) return 0;
        const size = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
        return Math.max(size.x, size.y) / 2;
    }

    function updateWorldRadiusUI(obj) {
        const input = document.getElementById('vecPropSizeMeters');
        const label = document.getElementById('vecSizeLabel');
        if (!input || !obj) return;
        const pm = getPrimaryMesh(obj);
        if (pm && pm.userData.isText) {
            if (label) { label.textContent = 'Размер:'; label.title = 'Масштаб текста (одинаковый размер — одинаковый текст)'; }
            input.value = Math.abs(obj.scale.x).toFixed(2);
            return;
        }
        if (label) { label.textContent = 'Радиус (м):'; label.title = 'Радиус объекта в метрах'; }
        input.value = getObjectWorldRadius(obj).toFixed(2);
    }

    renderer.domElement.addEventListener('pointerdown', (e) => {
        if (window.isEyedropperActive) return;

        if (eraserActive) {
            if (e.button === 2) { isPencilPanning = true; return; }
            if (e.button !== 0) return;
            e.preventDefault();
            recordVectorUndoState(true);
            controls.enabled = false;
            erasingStroke = true;
            lastEraseTime = 0;
            const pt = getMapIntersection(e);
            if (eraseStrokeAt(pt)) {
                if (window.scheduleSinglePseudoRebuild) window.scheduleSinglePseudoRebuild(Array.from(erasedWrappers));
                else if (window.rebuildVectorPseudoTransparency) window.rebuildVectorPseudoTransparency();
                erasedWrappers.clear();
                if (window.requestSceneRender) window.requestSceneRender();
            }
            updateEraserPreview(pt);
            return;
        }

        // КАРАНДАШ: фигура замыкается, линия завершается двойным кликом
        if (vectorState.pencilActive) {
            if (e.button === 2) {
                isPencilPanning = true;
                return;
            }
            if (e.button !== 0) return;

            const pt = getMapIntersection(e);
            const now = Date.now();

            const dx = e.clientX - (vectorState.pencilLastClickX || 0);
            const dy = e.clientY - (vectorState.pencilLastClickY || 0);
            const sameSpot = (dx * dx + dy * dy) <= 100;
            const isDoubleClick = vectorState.pencilLastClickTime && (now - vectorState.pencilLastClickTime) < 350 && sameSpot;
            if (isDoubleClick) {
                vectorState.pencilLastClickTime = 0;
                if (vectorState.pencilPoints.length >= (vectorState.pencilMode === 'line' ? 2 : 3)) {
                    vectorState.finishPencilShape();
                }
                return;
            }
            vectorState.addPencilPoint(pt);
            vectorState.pencilLastClickTime = now;
            vectorState.pencilLastClickX = e.clientX;
            vectorState.pencilLastClickY = e.clientY;
            return;
        }

        // Обработка режима ручного размещения кликом
        if (vectorState.placementMode) {
            if (e.button !== 0) return; 

            const pt = getMapIntersection(e);
            
            placingObject = vectorState.placementMode(pt.x, pt.y);
            
            if (placingObject) {
                isPlacingDrag = true;
                placingStartPoint.set(pt.x, pt.y);
                
                const signY = placingObject.userData.isSvg ? -1 : 1;
                placingStartScale = placingObject.userData.isSvg
                    ? Math.max(10, Math.min(100, (window.mapBounds?.maxDim || 2000) * 0.005))
                    : 2;
                placingObject.scale.set(placingStartScale, placingStartScale * signY, 1);
                updateScaleUIForDrag(placingStartScale);
                
                if (typeof controls !== 'undefined') controls.enabled = false;
            }

            vectorState.placementMode = null;
            document.body.style.cursor = 'default';
            return;
        }

        if (transformControl.axis !== null) return; 
        if (e.button !== 0) return; 

        // Выбор только по клику: панорама (drag) панели не закрывает.
        const downX = e.clientX, downY = e.clientY;
        if (vectorState.pendingMapClick) window.removeEventListener('pointerup', vectorState.pendingMapClick);
        vectorState.pendingMapClick = function onMapPointerUp(up) {
            vectorState.pendingMapClick = null;
            const dx = up.clientX - downX, dy = up.clientY - downY;
            if (dx * dx + dy * dy > 36) return;
            handleMapClick(up);
        };
        window.addEventListener('pointerup', vectorState.pendingMapClick, { once: true });
        return;
    });

    // Клик по карте: выбор фигуры слоя или зоны меток.
    function handleMapClick(e) {
        getMapIntersection(e);

        let allMeshes = [];
        vectorState.objects.forEach(obj => {
            if (obj.isGroup) allMeshes.push(...obj.children);
            else allMeshes.push(obj);
        });

        const intersects = raycaster.intersectObjects(allMeshes, true);

        if (intersects.length > 0) {
            let clicked = intersects[0].object;
            while (clicked.parent && clicked.parent.type === 'Group' && clicked.parent !== scene) {
                clicked = clicked.parent;
            }
            selectObject(clicked);
        } else {
            selectObject(null);
            if (window.GameZones && window.GameZones.pickMarkerAt && window.selectGameZone) {
                const zoneId = window.GameZones.pickMarkerAt(e.clientX, e.clientY);
                if (zoneId) window.selectGameZone(zoneId);
            }
        }
    }

    window.addEventListener('pointermove', (e) => {
        if (eraserActive && !isPencilPanning && !(e.buttons & 2)) {
            const pt = getMapIntersection(e);
            updateEraserPreview(pt);
            if ((e.buttons & 1) && erasingStroke) {
                const now = Date.now();
                if (now - lastEraseTime > 60) {
                    lastEraseTime = now;
                    if (eraseStrokeAt(pt)) {
                        if (window.scheduleSinglePseudoRebuild) window.scheduleSinglePseudoRebuild(Array.from(erasedWrappers));
                        erasedWrappers.clear();
                        if (window.requestSceneRender) window.requestSceneRender();
                    }
                }
            }
            return;
        }
        if (vectorState.pencilActive && !isPencilPanning && !(e.buttons & 2)) {
            const pt = getMapIntersection(e);
            vectorState.updatePencilLivePreview(pt);
            return;
        }

        if (isPlacingDrag && placingObject) {
            const pt = getMapIntersection(e);
            const dist = placingStartPoint.distanceTo(new THREE.Vector2(pt.x, pt.y));
            const newScale = Math.max(placingStartScale, dist);
            
            const signY = placingObject.userData.isSvg ? -1 : 1;
            placingObject.scale.set(newScale, newScale * signY, 1);
            updateScaleUIForDrag(newScale);
            updateWorldRadiusUI(placingObject);

            if (window.requestSceneRender) window.requestSceneRender();
        }
    });

    window.addEventListener('pointerup', () => {
        isPencilPanning = false;
        if (erasingStroke) {
            erasingStroke = false;
            controls.enabled = true;
            if (erasedWrappers.size > 0) {
                if (window.scheduleSinglePseudoRebuild) window.scheduleSinglePseudoRebuild(Array.from(erasedWrappers));
                else if (window.rebuildVectorPseudoTransparency) window.rebuildVectorPseudoTransparency();
                erasedWrappers.clear();
                if (window.requestSceneRender) window.requestSceneRender();
            }
        }
        if (isPlacingDrag) {
            isPlacingDrag = false;
            placingObject = null;
            if (typeof controls !== 'undefined') controls.enabled = true; 
            if (window.requestSceneRender) window.requestSceneRender();
        }
    });

    function updateVectorsOrder() {
        const len = vectorState.objects.length;
        vectorState.objects.forEach((o, i) => {
            const isText = getMeshes(o, true).some(mesh => mesh.userData.isText);
            const orderOffset = (len - i) * 0.001;
            o.position.z = (isText ? 30 : 20) + orderOffset;
            // Порядок поменялся (клик/undo/создание): сдвигаем готовые вырезки
            // за фигурой без перестройки геометрии (z и порядок отрисовки).
            const frac = len > 1 ? (len - 1 - i) / (len - 1) : 1;
            o.traverse(child => {
                if (child.isMesh && child.userData.isPseudoTransparency) {
                    const baked = Number.isFinite(child.userData.bakedFrac) ? child.userData.bakedFrac : frac;
                    child.position.z = (frac - baked) * 0.05;
                    child.renderOrder = 990 + (child.userData.cutoutLayer || 0) * 0.005 + frac * 0.004 + (child.userData.isStrokeCutout ? 0.001 : 0);
                }
            });
        });
        renderLayersList();
        if (window.requestSceneRender) window.requestSceneRender();
    }
    window.updateVectorsOrder = updateVectorsOrder;

    // Выбрать первую фигуру, конвертированную из зоны меток:
    // вместо мёртвых «настроек меток» открываются настройки слоя.
    window.selectConvertedFigure = function(zoneId) {
        if (!zoneId || !vectorState || !vectorState.objects) return false;
        const obj = vectorState.objects.find(o => o && o.visible && o.userData && o.userData.convertedFrom === zoneId);
        if (!obj) return false;
        selectObject(obj);
        return true;
    };

    // Скачивание только добавленного (фигуры, текст, метки) одним JSON
    // для переноса между проектами. Загружается той же кнопкой «Открыть JSON».
    window.saveLayersJson = function() {
        const vectorsData = window.getVectorsForJSON ? window.getVectorsForJSON() : [];
        const zonesState = window.getGameZonesState ? window.getGameZonesState() : null;
        const hasZones = Boolean(zonesState && ((zonesState.on && zonesState.on.length > 0) || (zonesState.custom && zonesState.custom.length > 0)));
        if (vectorsData.length === 0 && !hasZones) {
            window.showToast(window.t("Нечего сохранять: слоёв нет", "Nothing to save: no layers", "Нічого зберігати: шарів немає"), "error");
            return;
        }
        const layersData = {
            type: 'vector_layers', version: "10.1", timestamp: new Date().toISOString(),
            vectors: vectorsData,
            vectorFont: window.getVectorFontForJSON ? window.getVectorFontForJSON() : null,
            gameZones: zonesState
        };
        const blob = new Blob([JSON.stringify(layersData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `vector_layers_${Date.now()}.json`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
        window.showToast(window.t("Слои сохранены в JSON!", "Layers saved to JSON!", "Шари збережено в JSON!"));
    };
    document.getElementById('saveLayersBtn')?.addEventListener('click', () => window.saveLayersJson());

    function pencilStrokeFactor(obj, mesh) {
        if (!obj || !obj.userData.isPencil || obj.userData.isPencilLine) return 1;
        const geo = mesh && mesh.geometry;
        if (!geo) return 1;
        if (!geo.boundingBox) geo.computeBoundingBox();
        const s = geo.boundingBox.getSize(new THREE.Vector3());
        const m = Math.max(s.x, s.y);
        return m > 1e-9 ? Math.min(m / 10, 100) : 1;
    }

    function isMarkerStyleCircle(obj, mesh) {
        return !!(obj && obj.userData.icon === 'circle' && !obj.userData.isPencil && !obj.userData.isSvg && mesh && !mesh.userData.isText);
    }

    function normalizeCircleOutline(src) {
        const s = (src && typeof src === 'object') ? src : {};
        return {
            gap: Number.isFinite(s.gap) ? Math.min(1, Math.max(0, s.gap)) : 0,
            width: Number.isFinite(s.width) ? Math.min(1.5, Math.max(0.05, s.width)) : 0.29
        };
    }

    function circleShapeRadius(mesh) {
        const geo = mesh && mesh.geometry;
        if (!geo) return 0;
        if (!geo.boundingBox) geo.computeBoundingBox();
        const s = geo.boundingBox.getSize(new THREE.Vector3());
        return Math.max(s.x, s.y) / 2;
    }

    function buildCircleStroke(parentMesh, pattern, gap, width, quality, cap, colorHex) {
        if (!window.GeometryUtils) return null;
        const R = circleShapeRadius(parentMesh);
        if (!(R > 0)) return null;
        const P = window.GeometryUtils.circleOutlineParams(R, gap, width);
        if (pattern === 'dashed') {
            const midR = Math.max(0.5, (R + P.contourR) / 2);
            const fit = window.GeometryUtils.fitRingDashes(2 * Math.PI * midR, P.strokeWidth);
            const pts = new THREE.EllipseCurve(0, 0, midR, midR).getPoints(72).map(p => new THREE.Vector3(p.x, p.y, 0));
            const ring = new THREE.LineLoop(
                new THREE.BufferGeometry().setFromPoints(pts),
                new THREE.LineDashedMaterial({ color: new THREE.Color(colorHex || '#ffffff'), dashSize: fit.dashSize, gapSize: fit.gapSize, transparent: true, opacity: 1, depthTest: false, depthWrite: false })
            );
            ring.computeLineDistances();
            ring.frustumCulled = false;
            return ring;
        }
        const cShape = new THREE.Shape();
        cShape.absarc(0, 0, Math.max(0.01, P.contourR), 0, Math.PI * 2, false);
        const geo = generateStrokeGeometry([{ shapes: [cShape], offsetX: 0, offsetY: 0 }], P.strokeWidth, quality, pattern, P.dashLen, P.gapLen, P.dotSize, cap);
        if (!geo) return null;
        const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: colorHex || '#ffffff', depthWrite: true, alphaTest: 0.01 }));
        mesh.frustumCulled = false;
        return mesh;
    }

    function generateStrokeGeometry(shapesData, strokeWidth, quality, pattern, dashLen, gapLen, dotSize, lineCap) {
        if (!shapesData || shapesData.length === 0) return null;
        let strokeGeometries = [];
        const strokePattern = pattern || 'solid';
        const dashLength = Math.max(dashLen || strokeWidth * 5, 0.01);
        const gapLength = Math.max(gapLen || strokeWidth * 3, 0);
        const dotDiameter = Math.max(dotSize || strokeWidth, 0.01);

        shapesData.forEach(data => {
            const { shapes, offsetX, offsetY } = data;
            shapes.forEach(shape => {
                const ptsData = shape.extractPoints(quality);

                const capStyle = lineCap || 'round';
                const addStroke = (strokePoints) => {
                    if (strokePoints.length < 2) return;
                    const geo = THREE.SVGLoader.pointsToStroke(strokePoints, {
                        strokeWidth: strokeWidth,
                        strokeLineJoin: 'round', // �-����?�?�?�>��?�?�<�� ��?���?
                        strokeLineCap: capStyle
                    });
                    if (geo) {
                        geo.translate(offsetX, offsetY, 0);
                        strokeGeometries.push(geo);
                    }
                };

                const processPath = (pts) => {
                    if (pts.length < 2) return;

                    // �?�?���>�?��? �?�?�+�>��?�?�?�%���?�? ���?�?�>��?�?��� �'�?�ؐ�� �?�>�? �"���?�� ���?�'��"����'�?�
                    while (pts.length > 1 && pts[0].distanceTo(pts[pts.length - 1]) < 0.1) {
                        pts.pop();
                    }
                    pts.push(pts[0].clone()); // �-���?�<�����? ��?�?�'�?�? �ؐ�?�'

                    // Длина замкнутого контура для равномерного распределения
                    let totalLen = 0;
                    const segLens = [];
                    for (let i = 0; i < pts.length - 1; i++) {
                        const l = pts[i].distanceTo(pts[i + 1]);
                        segLens.push(l);
                        totalLen += l;
                    }
                    if (totalLen < 1e-9) return;

                    // Точка на расстоянии d вдоль контура (с заворотом)
                    const pointAt = (d) => {
                        let dd = ((d % totalLen) + totalLen) % totalLen;
                        for (let i = 0; i < segLens.length; i++) {
                            if (dd <= segLens[i] || i === segLens.length - 1) {
                                const t = segLens[i] < 1e-12 ? 0 : Math.max(0, Math.min(1, dd / segLens[i]));
                                return pts[i].clone().lerp(pts[i + 1], t);
                            }
                            dd -= segLens[i];
                        }
                        return pts[0].clone();
                    };

                    if (strokePattern === 'dotted') {
                        const stepLen = dotDiameter + gapLength;
                        const n = Math.max(8, Math.round(totalLen / stepLen));
                        const step = totalLen / n;
                        const dotR = Math.min(dotDiameter, step * 0.55) / 2;
                        for (let k = 0; k < n; k++) {
                            const p = pointAt((k + 0.5) * step);
                            const dot = new THREE.CircleGeometry(dotR, 12);
                            dot.translate(p.x + offsetX, p.y + offsetY, 0);
                            strokeGeometries.push(dot);
                        }
                        return;
                    }

                    if (strokePattern === 'dashed') {
                        const period = dashLength + gapLength;
                        const n = Math.max(8, Math.round(totalLen / period));
                        const scaledPeriod = totalLen / n;
                        const scaledDash = scaledPeriod * (dashLength / period);
                        for (let k = 0; k < n; k++) {
                            const d0 = k * scaledPeriod;
                            const d1 = d0 + scaledDash;
                            const span = d1 - d0;
                            const samples = Math.max(2, Math.ceil(span / (scaledDash / 8)));
                            const chain = [];
                            for (let s = 0; s <= samples; s++) chain.push(pointAt(d0 + (span * s) / samples));
                            addStroke(chain);
                        }
                        return;
                    }

                    if (strokePattern === 'dashdot') {
                        // Штрихпунктир: штрих + промежуток + точка + промежуток.
                        const period = dashLength + gapLength + dotDiameter + gapLength;
                        const n = Math.max(4, Math.round(totalLen / period));
                        const scaledPeriod = totalLen / n;
                        const kDash = dashLength / period, kGap = gapLength / period, kDot = dotDiameter / period;
                        const dotR = Math.max(0.01, dotDiameter / 2);
                        for (let k = 0; k < n; k++) {
                            const base = k * scaledPeriod;
                            const span = scaledPeriod * kDash;
                            const samples = Math.max(2, Math.ceil(span / (span / 8)));
                            const chain = [];
                            for (let s = 0; s <= samples; s++) chain.push(pointAt(base + (span * s) / samples));
                            addStroke(chain);
                            const p = pointAt(base + scaledPeriod * (kDash + kGap) + (scaledPeriod * kDot) / 2);
                            const dot = new THREE.CircleGeometry(dotR, 12);
                            dot.translate(p.x + offsetX, p.y + offsetY, 0);
                            strokeGeometries.push(dot);
                        }
                        return;
                    }

                    addStroke(pts);
                };

                processPath(ptsData.shape);
                ptsData.holes.forEach(processPath);
            });
        });
        
        if (strokeGeometries.length === 0) return null;
        return THREE.BufferGeometryUtils.mergeBufferGeometries(strokeGeometries);
    }

    function createTextGeometry(text, font, quality, align = 'center', lineHeight = 1.2) {
        const lines = text.split('\n');
        const geos = [];
        const shapesData = [];
        const baseSize = 10;
        const lineSpacing = baseSize * lineHeight;

        let maxWidth = 0;
        const lineWidths = [];
        const lineShapesArr = [];

        lines.forEach(line => {
            const shapes = font.generateShapes(line || ' ', baseSize);
            lineShapesArr.push(shapes);
            const tempGeo = new THREE.ShapeGeometry(shapes);
            tempGeo.computeBoundingBox();
            const w = tempGeo.boundingBox ? tempGeo.boundingBox.max.x - tempGeo.boundingBox.min.x : 0;
            lineWidths.push(w);
            if (w > maxWidth) maxWidth = w;
            tempGeo.dispose();
        });

        lines.forEach((line, i) => {
            const w = lineWidths[i];
            let offsetX = 0;
            if (align === 'center') offsetX = -w / 2;
            else if (align === 'right') offsetX = -w;

            const offsetY = -i * lineSpacing;
            const shapes = lineShapesArr[i];
            
            if (shapes && shapes.length > 0) {
                const geo = new THREE.ShapeGeometry(shapes, quality);
                geo.translate(offsetX, offsetY, 0);
                geos.push(geo);
            }
            shapesData.push({ shapes, offsetX, offsetY });
        });

        const finalGeo = geos.length > 0 ? THREE.BufferGeometryUtils.mergeBufferGeometries(geos) : new THREE.BufferGeometry();
        finalGeo.userData.shapesData = shapesData;

        if (geos.length > 0) {
            finalGeo.computeBoundingBox();
            finalGeo.computeBoundingSphere();
            const cx = -(finalGeo.boundingBox.max.x + finalGeo.boundingBox.min.x) / 2;
            const cy = -(finalGeo.boundingBox.max.y + finalGeo.boundingBox.min.y) / 2;
            finalGeo.translate(cx, cy, 0);
            finalGeo.userData.tX = cx;
            finalGeo.userData.tY = cy;
        } else {
            finalGeo.userData.tX = 0;
            finalGeo.userData.tY = 0;
        }

        return finalGeo;
    }

    function selectObject(obj) {
        if (window.clearGameZoneSelection) window.clearGameZoneSelection();
        // Фигура, конвертированная из зоны меток: связываем меню —
        // выбираем зону, чтобы открылись её настройки в меню меток.
        if (obj && obj.userData && obj.userData.convertedFrom && window.selectGameZone) window.selectGameZone(obj.userData.convertedFrom);
        if (obj && vectorState.activeObj !== obj) {
            const idx = vectorState.objects.indexOf(obj);
            if (idx > 0) {
                vectorState.objects.splice(idx, 1);
                vectorState.objects.unshift(obj);
                updateVectorsOrder();
                // Фигура всплыла наверх: её оттенок устарел (считался для низа) —
                // пересобрать с новым набором «под ней».
                if (window.scheduleSinglePseudoRebuild) window.scheduleSinglePseudoRebuild(obj);
            }
        }
        
        vectorState.activeObj = obj;
        if (obj) {
            transformControl.attach(obj);
            document.getElementById('vectorPropsPanel').classList.remove('hidden');
            
            const firstMesh = getPrimaryMesh(obj);
            
            if (firstMesh && firstMesh.userData.isText) {
                document.getElementById('vecPropTextContainer').classList.remove('hidden');
                document.getElementById('vecPropTextValue').value = firstMesh.userData.text;
                const lhInput = document.getElementById('vecLineHeight');
                if (lhInput) lhInput.value = firstMesh.userData.textLineHeight || 1.2;
                
                const align = obj.userData.textAlign || 'center';
                ['vecAlignLeft', 'vecAlignCenter', 'vecAlignRight'].forEach(id => {
                    const btn = document.getElementById(id);
                    if(btn) {
                        btn.classList.remove('bg-emerald-500/20', 'text-emerald-400', 'border-emerald-500/50');
                        btn.classList.add('bg-slate-800', 'text-slate-400', 'border-slate-700/50');
                    }
                });
                const activeBtn = align === 'left' ? 'vecAlignLeft' : (align === 'right' ? 'vecAlignRight' : 'vecAlignCenter');
                const btnActive = document.getElementById(activeBtn);
                if(btnActive) {
                    btnActive.classList.add('bg-emerald-500/20', 'text-emerald-400', 'border-emerald-500/50');
                    btnActive.classList.remove('bg-slate-800', 'text-slate-400', 'border-slate-700/50');
                }
            } else {
                document.getElementById('vecPropTextContainer').classList.add('hidden');
            }
            const fillPatternEl = document.getElementById('vecPropFillPattern');
            if (fillPatternEl) fillPatternEl.value = obj.userData.fillPattern || 'solid';
            const autoFP = fillPatternAutoFor(obj);
            const effS = (obj.userData.fillPatternSpacing > 0) ? obj.userData.fillPatternSpacing : autoFP.spacing;
            const effT = (obj.userData.fillPatternThickness > 0) ? obj.userData.fillPatternThickness : autoFP.thickness;
            const setPair = (r, n, v) => {
                const re = document.getElementById(r), ne = document.getElementById(n);
                if (re) re.value = v;
                if (ne) ne.value = v;
            };
            setPair('vecFillSpacing', 'vecFillSpacingNum', Math.round(effS));
            setPair('vecFillThickness', 'vecFillThicknessNum', Math.round(effT * 2) / 2);
            syncFillPatternUI();

            const lineTools = document.getElementById('vecLineTools');
            const linePatternTools = document.getElementById('vecLinePatternTools');
            const isPencilLine = Boolean(obj.userData.isPencilLine);
            if (lineTools) lineTools.classList.toggle('hidden', !isPencilLine);
            if (linePatternTools) linePatternTools.classList.toggle('hidden', !isPencilLine);
            document.getElementById('vecQualityTools')?.classList.toggle('hidden', Boolean(obj.userData.isPencil));
            if (isPencilLine && firstMesh) {
                const lineWidth = firstMesh.geometry.userData.lineWidth || obj.userData.lineWidth || 2;
                const linePattern = firstMesh.geometry.userData.linePattern || obj.userData.linePattern || 'solid';
                document.getElementById('vecLineWidth').value = lineWidth;
                document.getElementById('vecLineWidthNum').value = lineWidth;
                document.getElementById('vecLinePattern').value = linePattern;
            }


            if (firstMesh && firstMesh.material) {
                document.getElementById('vecPropColor').value = "#" + firstMesh.material.color.getHexString();
                const selectedOpacity = firstMesh.userData.isText
                    ? (firstMesh.userData.textOpacity ?? firstMesh.material.opacity)
                    : (firstMesh.userData.pseudoOpacity ?? firstMesh.material.opacity);
                document.getElementById('vecPropAlpha').value = selectedOpacity;
                document.getElementById('vecPropAlphaNum').value = selectedOpacity;
                document.getElementById('vecPropFill').checked = !firstMesh.userData.fillHidden;
                document.getElementById('vecPropScale').value = Math.abs(obj.scale.x);
                document.getElementById('vecPropScaleNum').value = Math.abs(obj.scale.x).toFixed(2);
                updateWorldRadiusUI(obj);
                
                const degZ = THREE.MathUtils.radToDeg(obj.rotation.z);
                document.getElementById('vecPropRot').value = degZ;
                document.getElementById('vecPropRotNum').value = degZ.toFixed(1);
                
                const qual = firstMesh.userData.quality || 12;
                document.getElementById('vecPropQuality').value = qual;
                document.getElementById('vecPropQualityNum').value = qual;
                
                const hasStroke = getStrokeMeshes(obj).length > 0;
                document.getElementById('vecPropStroke').checked = hasStroke;
                document.getElementById('vecPropStrokeTools').classList.toggle('hidden', !hasStroke);
                
                if (hasStroke) {
                    const strokeMesh = getStrokeMeshes(obj)[0];
                    document.getElementById('vecPropStrokeColor').value = "#" + strokeMesh.material.color.getHexString();
                    document.getElementById('vecPropStrokeWidth').value = strokeMesh.userData.strokeWidth || 10;
                    document.getElementById('vecPropStrokeWidthNum').value = strokeMesh.userData.strokeWidth || 10;
                    document.getElementById('vecPropStrokePattern').value = strokeMesh.userData.strokePattern || obj.userData.strokePattern || 'solid';

                    document.getElementById('vecStrokeDash').value = strokeMesh.userData.strokeDash ?? obj.userData.strokeDash ?? 10;
                    document.getElementById('vecStrokeGap').value = strokeMesh.userData.strokeGap ?? obj.userData.strokeGap ?? 6;
                    document.getElementById('vecStrokeDotSize').value = strokeMesh.userData.strokeDot ?? obj.userData.strokeDot ?? 8;
                    const cogPct = Math.round(((strokeMesh.userData.circleGap ?? obj.userData.circleOutline?.gap) ?? 0) * 100);
                    const cowPct = Math.round(((strokeMesh.userData.circleWidth ?? obj.userData.circleOutline?.width) ?? 0.29) * 100);
                    if (document.getElementById('vecCircleGap')) document.getElementById('vecCircleGap').value = cogPct;
                    if (document.getElementById('vecCircleGapNum')) document.getElementById('vecCircleGapNum').value = cogPct;
                    if (document.getElementById('vecCircleWidth')) document.getElementById('vecCircleWidth').value = cowPct;
                    if (document.getElementById('vecCircleWidthNum')) document.getElementById('vecCircleWidthNum').value = cowPct;
                    document.getElementById('vecPropStrokeAlpha').checked = strokeMesh.userData.strokeUseAlpha ?? obj.userData.strokeUseAlpha ?? false;
                }
                syncStrokePatternUI();
            }
        } else {
            transformControl.detach();
            document.getElementById('vectorPropsPanel').classList.add('hidden');
            document.getElementById('vecLineTools')?.classList.add('hidden');
            document.getElementById('vecLinePatternTools')?.classList.add('hidden');
            document.getElementById('vecStrokePatternTools')?.classList.add('hidden');
            document.getElementById('vecQualityTools')?.classList.remove('hidden');
        }
        renderLayersList();
        if (window.requestSceneRender) window.requestSceneRender();
    }

    transformControl.addEventListener('change', () => {
        if (vectorState.activeObj) {
            if (transformControl.mode === 'scale') {
                const currentScale = Math.abs(vectorState.activeObj.scale.x);
                const scaleSlider = document.getElementById('vecPropScale');
                const scaleNum = document.getElementById('vecPropScaleNum');
                if (scaleSlider && scaleNum) { scaleSlider.value = currentScale; scaleNum.value = currentScale.toFixed(2); }
            }
            if (transformControl.mode === 'rotate') {
                const degZ = THREE.MathUtils.radToDeg(vectorState.activeObj.rotation.z);
                const rotSlider = document.getElementById('vecPropRot');
                const rotNum = document.getElementById('vecPropRotNum');
                if (rotSlider && rotNum) { rotSlider.value = degZ; rotNum.value = degZ.toFixed(1); }
            }
        }
    });
    renderer.domElement.addEventListener('contextmenu', (e) => {
        if (vectorState.pencilActive) e.preventDefault();
    });

    document.getElementById('vecPropTextValue')?.addEventListener('input', (e) => {
        if (!vectorState.activeObj) return;
        const newText = e.target.value;
        recordVectorUndoState();
        vectorState.skipNextHistory = true;
        const obj = vectorState.activeObj;
        const meshes = getMeshes(obj, false);
        
        meshes.forEach(mesh => {
            if (mesh.userData.isText && vectorState.loadedFont) {
                const qual = mesh.userData.quality || 12;
                const align = obj.userData.textAlign || 'center';
                const lineHeight = mesh.userData.textLineHeight || 1.2;
                
                const newGeo = createTextGeometry(newText, vectorState.loadedFont, qual, align, lineHeight);
                
                mesh.geometry.dispose();
                mesh.geometry = newGeo;
                mesh.userData.text = newText;
                
                let displayName = newText.split('\n')[0];
                obj.name = displayName || 'Текст';
                
            }
        });
        applyPropsToActive(false, true);
        renderLayersList();
    });

    function setAlign(align) {
        if (!vectorState.activeObj) return;
        vectorState.activeObj.userData.textAlign = align;
        ['vecAlignLeft', 'vecAlignCenter', 'vecAlignRight'].forEach(id => {
            const btn = document.getElementById(id);
            if(btn) {
                btn.classList.remove('bg-emerald-500/20', 'text-emerald-400', 'border-emerald-500/50');
                btn.classList.add('bg-slate-800', 'text-slate-400', 'border-slate-700/50');
            }
        });
        const activeBtn = align === 'left' ? 'vecAlignLeft' : (align === 'right' ? 'vecAlignRight' : 'vecAlignCenter');
        const btnActive = document.getElementById(activeBtn);
        if(btnActive) {
            btnActive.classList.add('bg-emerald-500/20', 'text-emerald-400', 'border-emerald-500/50');
            btnActive.classList.remove('bg-slate-800', 'text-slate-400', 'border-slate-700/50');
        }
        applyPropsToActive(true);
    }

    document.getElementById('vecAlignLeft')?.addEventListener('click', () => setAlign('left'));
    document.getElementById('vecAlignCenter')?.addEventListener('click', () => setAlign('center'));
    document.getElementById('vecAlignRight')?.addEventListener('click', () => setAlign('right'));
    document.getElementById('vecLineHeight')?.addEventListener('input', () => applyPropsToActive(true));

    document.getElementById('vecPropQuality')?.addEventListener('input', (e) => { document.getElementById('vecPropQualityNum').value = e.target.value; applyPropsToActive(true); });
    document.getElementById('vecPropQualityNum')?.addEventListener('input', (e) => { document.getElementById('vecPropQuality').value = e.target.value; applyPropsToActive(true); });
    
    document.getElementById('vecPropScale')?.addEventListener('input', (e) => { document.getElementById('vecPropScaleNum').value = e.target.value; applyPropsToActive(); });
    document.getElementById('vecPropScaleNum')?.addEventListener('input', (e) => { document.getElementById('vecPropScale').value = e.target.value; applyPropsToActive(); });
    document.getElementById('vecPropSizeMeters')?.addEventListener('change', () => {
        const obj = vectorState.activeObj;
        if (!obj) return;
        const target = parseFloat(document.getElementById('vecPropSizeMeters').value);
        if (!(target > 0)) return;
        recordVectorUndoState(true);
        const pm = getPrimaryMesh(obj);
        if (pm && pm.userData.isText) {
            const signY = obj.userData.isSvg ? -1 : 1;
            obj.scale.set(target, target * signY, 1);
        } else {
            const current = getObjectWorldRadius(obj);
            if (!(current > 1e-9)) return;
            const k = target / current;
            obj.scale.x *= k;
            obj.scale.y *= k;
        }
        document.getElementById('vecPropScale').value = Math.abs(obj.scale.x);
        document.getElementById('vecPropScaleNum').value = Math.abs(obj.scale.x).toFixed(2);
        updateVectorsOrder();
        if (window.scheduleSinglePseudoRebuild) window.scheduleSinglePseudoRebuild(obj);
        else rebuildPseudoTransparency(obj);
        if (window.requestSceneRender) window.requestSceneRender();
    });

    document.getElementById('vecPropRot')?.addEventListener('input', (e) => { document.getElementById('vecPropRotNum').value = e.target.value; applyPropsToActive(); });
    document.getElementById('vecPropRotNum')?.addEventListener('input', (e) => { document.getElementById('vecPropRot').value = e.target.value; applyPropsToActive(); });

    document.getElementById('vecPropStrokeWidth')?.addEventListener('input', (e) => { document.getElementById('vecPropStrokeWidthNum').value = e.target.value; applyPropsToActive(false, true); });
    document.getElementById('vecPropStrokeWidthNum')?.addEventListener('input', (e) => { document.getElementById('vecPropStrokeWidth').value = e.target.value; applyPropsToActive(false, true); });
    document.getElementById('vecCircleGap')?.addEventListener('input', (e) => { document.getElementById('vecCircleGapNum').value = e.target.value; applyPropsToActive(false, true); });
    document.getElementById('vecCircleGapNum')?.addEventListener('input', (e) => { document.getElementById('vecCircleGap').value = e.target.value; applyPropsToActive(false, true); });
    document.getElementById('vecCircleWidth')?.addEventListener('input', (e) => { document.getElementById('vecCircleWidthNum').value = e.target.value; applyPropsToActive(false, true); });
    document.getElementById('vecCircleWidthNum')?.addEventListener('input', (e) => { document.getElementById('vecCircleWidth').value = e.target.value; applyPropsToActive(false, true); });

    document.getElementById('vecPropColor')?.addEventListener('input', () => applyPropsToActive(false, false, true));
    document.getElementById('vecPropAlpha')?.addEventListener('input', (e) => { document.getElementById('vecPropAlphaNum').value = e.target.value; applyPropsToActive(false, false, true); });
    document.getElementById('vecPropAlphaNum')?.addEventListener('input', (e) => { document.getElementById('vecPropAlpha').value = e.target.value; applyPropsToActive(false, false, true); });
    document.getElementById('vecPropStroke')?.addEventListener('change', () => applyPropsToActive());
    document.getElementById('vecPropStrokeColor')?.addEventListener('input', () => applyPropsToActive());
    document.getElementById('vecPropStrokePattern')?.addEventListener('change', () => applyPropsToActive(false, true));

    document.getElementById('vecStrokeDash')?.addEventListener('input', () => applyPropsToActive(false, true));
    document.getElementById('vecStrokeGap')?.addEventListener('input', () => applyPropsToActive(false, true));
    document.getElementById('vecStrokeDotSize')?.addEventListener('input', () => applyPropsToActive(false, true));
    document.getElementById('vecPropStrokeAlpha')?.addEventListener('change', () => applyPropsToActive());
    document.getElementById('vecPropFill')?.addEventListener('change', () => applyPropsToActive());
    document.getElementById('vecPropFillPattern')?.addEventListener('change', () => applyPropsToActive());
    const syncFillPair = (r, n) => {
        document.getElementById(r)?.addEventListener('input', (e) => { document.getElementById(n).value = e.target.value; applyPropsToActive(); });
        document.getElementById(n)?.addEventListener('input', (e) => { document.getElementById(r).value = e.target.value; applyPropsToActive(); });
    };
    syncFillPair('vecFillSpacing', 'vecFillSpacingNum');
    syncFillPair('vecFillThickness', 'vecFillThicknessNum');

    function syncFillPatternUI() {
        const ao = vectorState.activeObj;
        const pm = ao ? getPrimaryMesh(ao) : null;
        const isText = Boolean(pm && pm.userData.isText);
        const pat = document.getElementById('vecPropFillPattern')?.value || (ao && ao.userData.fillPattern) || 'solid';
        document.getElementById('vecFillPatternRow')?.classList.toggle('hidden', isText);
        document.getElementById('vecFillPatternTune')?.classList.toggle('hidden', isText || pat === 'solid');
    }

    // Паттерны обводки действуют на любые фигуры с обводкой.
    window.STROKE_PATTERNS = window.STROKE_PATTERNS || ['solid', 'dashed', 'dashdot', 'dotted'];
    function syncStrokePatternUI() {
        const pattern = document.getElementById('vecPropStrokePattern')?.value || 'solid';
        const hasStroke = document.getElementById('vecPropStroke')?.checked;
        document.getElementById('vecStrokePatternTools')?.classList.toggle('hidden', !hasStroke);
        document.getElementById('vecStrokeDashRow')?.classList.toggle('hidden', pattern !== 'dashed' && pattern !== 'dashdot');
        document.getElementById('vecStrokeGapRow')?.classList.toggle('hidden', pattern === 'solid');
        document.getElementById('vecStrokeDotRow')?.classList.toggle('hidden', pattern !== 'dotted' && pattern !== 'dashdot');
        const ao = vectorState.activeObj;
        const isCircle = !!(ao && ao.userData.icon === 'circle' && !ao.userData.isPencil && !ao.userData.isSvg);
        const isConverted = !!(ao && ao.userData.convertedFrom);
        document.getElementById('vecPropStrokeWidthWrap')?.classList.toggle('hidden', isCircle);
        document.getElementById('vecCircleOutlineTools')?.classList.toggle('hidden', !hasStroke || !isCircle);
        document.getElementById('vecStrokePatternRow')?.classList.toggle('hidden', !hasStroke);
        if (isCircle) {
            document.getElementById('vecStrokeDashRow')?.classList.add('hidden');
            document.getElementById('vecStrokeGapRow')?.classList.add('hidden');
            document.getElementById('vecStrokeDotRow')?.classList.add('hidden');
        }
    }
    document.getElementById('vecLineWidth')?.addEventListener('input', (e) => { document.getElementById('vecLineWidthNum').value = e.target.value; applyPropsToActive(); });
    document.getElementById('vecLineWidthNum')?.addEventListener('input', (e) => { document.getElementById('vecLineWidth').value = e.target.value; applyPropsToActive(); });
    document.getElementById('vecLinePattern')?.addEventListener('change', () => applyPropsToActive());

    function applyPropsToActive(forceRebuildText = false, forceRebuildStroke = false, markStyleOverride = false) {
        if (!vectorState.activeObj) return;
        recordVectorUndoState();
        vectorState.skipNextHistory = false;
        const colorHex = document.getElementById('vecPropColor').value;
        const alpha = Math.max(0, Math.min(1, parseFloat(document.getElementById('vecPropAlphaNum')?.value ?? document.getElementById('vecPropAlpha').value) || 0));
        const useStroke = document.getElementById('vecPropStroke').checked;
        const strokeHex = document.getElementById('vecPropStrokeColor').value;
        const strokeWidth = Math.min(150, Math.max(0.1, parseFloat(document.getElementById('vecPropStrokeWidthNum').value) || 10));
        const strokePatternRaw = document.getElementById('vecPropStrokePattern')?.value || 'solid';
        const strokePattern = (window.STROKE_PATTERNS || []).includes(strokePatternRaw) ? strokePatternRaw : 'solid';
        const strokeCap = document.getElementById('vecPropStrokeCap')?.value || 'round';
        const strokeDash = parseFloat(document.getElementById('vecStrokeDash')?.value) || 10;
        const strokeGap = parseFloat(document.getElementById('vecStrokeGap')?.value) || 6;
        const strokeDot = parseFloat(document.getElementById('vecStrokeDotSize')?.value) || 8;
        const strokeUseAlpha = document.getElementById('vecPropStrokeAlpha')?.checked !== false;
        const fillEnabled = document.getElementById('vecPropFill')?.checked !== false;
        const fillPattern = document.getElementById('vecPropFillPattern')?.value || 'solid';
        const scaleVal = parseFloat(document.getElementById('vecPropScaleNum').value) || 1;
        const rotVal = parseFloat(document.getElementById('vecPropRotNum').value) || 0;
        const qualityVal = parseInt(document.getElementById('vecPropQualityNum').value) || 12;
        const textVal = document.getElementById('vecPropTextValue').value;
        const lineHeightVal = parseFloat(document.getElementById('vecLineHeight') ? document.getElementById('vecLineHeight').value : 1.2) || 1.2;
        const lineWidthVal = parseFloat(document.getElementById('vecLineWidthNum')?.value) || 2;
        const linePatternVal = document.getElementById('vecLinePattern')?.value || 'solid';

        document.getElementById('vecPropStrokeTools').classList.toggle('hidden', !useStroke);
        syncStrokePatternUI();
        syncFillPatternUI();

        const obj = vectorState.activeObj;
        if (obj.userData.isSvg && markStyleOverride) obj.userData.styleOverridden = true;
        obj.userData.strokePattern = strokePattern;
        obj.userData.strokeCap = strokeCap;
        obj.userData.strokeDash = strokeDash;
        obj.userData.strokeGap = strokeGap;
        obj.userData.strokeDot = strokeDot;
        obj.userData.strokeUseAlpha = strokeUseAlpha;
        obj.userData.fillEnabled = fillEnabled;
        obj.userData.fillPattern = fillPattern;
        const fillSpacingRaw = parseFloat(document.getElementById('vecFillSpacingNum')?.value);
        const fillThicknessRaw = parseFloat(document.getElementById('vecFillThicknessNum')?.value);
        obj.userData.fillPatternSpacing = (Number.isFinite(fillSpacingRaw) && fillSpacingRaw > 0) ? fillSpacingRaw : null;
        obj.userData.fillPatternThickness = (Number.isFinite(fillThicknessRaw) && fillThicknessRaw > 0) ? fillThicknessRaw : null;
        const circleGapRaw = parseFloat(document.getElementById('vecCircleGapNum')?.value);
        const circleWidthRaw = parseFloat(document.getElementById('vecCircleWidthNum')?.value);
        const prevCo = normalizeCircleOutline(obj.userData.circleOutline);
        obj.userData.circleOutline = {
            gap: Number.isFinite(circleGapRaw) ? Math.min(100, Math.max(0, circleGapRaw)) / 100 : prevCo.gap,
            width: Number.isFinite(circleWidthRaw) ? Math.min(100, Math.max(5, circleWidthRaw)) / 100 : prevCo.width
        };

        const signY = obj.userData.isSvg ? -1 : 1;
        obj.scale.set(scaleVal, scaleVal * signY, 1);
        obj.rotation.z = THREE.MathUtils.degToRad(rotVal);
        
        const primaryMeshes = getMeshes(obj, false);
        const firstMesh = primaryMeshes[0];
        if (!firstMesh) return;

        if (forceRebuildText && firstMesh.userData.isText && vectorState.loadedFont) {
            const align = obj.userData.textAlign || 'center';
            const newGeo = createTextGeometry(textVal, vectorState.loadedFont, qualityVal, align, lineHeightVal);
            
            firstMesh.geometry.dispose();
            firstMesh.geometry = newGeo;
            firstMesh.userData.text = textVal;
            firstMesh.userData.quality = qualityVal;
            firstMesh.userData.textLineHeight = lineHeightVal;
            
            let displayName = textVal.split('\n')[0];
            obj.name = displayName || 'Текст';

            forceRebuildStroke = true;
        }

        if (!firstMesh.userData.isText && obj.userData.icon === 'circle' && (firstMesh.userData.quality || 12) !== qualityVal) {
            const circleShape = firstMesh.geometry.userData.shapesData && firstMesh.geometry.userData.shapesData[0] && firstMesh.geometry.userData.shapesData[0].shapes && firstMesh.geometry.userData.shapesData[0].shapes[0];
            if (circleShape) {
                const circleGeo = new THREE.ShapeGeometry(circleShape, Math.max(3, qualityVal));
                circleGeo.userData.shapesData = firstMesh.geometry.userData.shapesData;
                circleGeo.userData.tX = firstMesh.geometry.userData.tX || 0;
                circleGeo.userData.tY = firstMesh.geometry.userData.tY || 0;
                firstMesh.geometry.dispose();
                firstMesh.geometry = circleGeo;
                firstMesh.userData.quality = qualityVal;
                forceRebuildStroke = true;
            }
        }

        if (obj.userData.isPencilLine && obj.userData.pencilPoints) {
            const currentWidth = firstMesh.geometry.userData.lineWidth || obj.userData.lineWidth || 2;
            const currentPattern = firstMesh.geometry.userData.linePattern || obj.userData.linePattern || 'solid';
            if (currentWidth !== lineWidthVal || currentPattern !== linePatternVal) {
                const newGeo = createPencilLineFromPoints(obj.userData.pencilPoints, lineWidthVal, linePatternVal);
                if (newGeo) {
                    firstMesh.geometry.dispose();
                    firstMesh.geometry = newGeo;
                }
            }
            obj.userData.lineWidth = lineWidthVal;
            obj.userData.linePattern = linePatternVal;
        }

        primaryMeshes.forEach(mesh => {
            mesh.userData.fillHidden = !fillEnabled;
            mesh.visible = fillEnabled;
            if (!obj.userData.isSvg || obj.userData.styleOverridden) {
                mesh.material.color.set(colorHex);
                if (mesh.userData.isText) {
                    mesh.userData.textOpacity = alpha;
                    mesh.userData.pseudoOpacity = 1;
                    mesh.material.opacity = alpha;
                    mesh.material.transparent = alpha < 1;
                } else {
                    mesh.userData.pseudoOpacity = alpha;
                    if (mesh.material.transparent !== false || mesh.material.depthWrite !== true || mesh.material.opacity !== 1) {
                        mesh.material.opacity = 1;
                        mesh.material.transparent = false;
                        mesh.material.depthWrite = true;
                        mesh.material.needsUpdate = true;
                    }
                }
            }
            mesh.renderOrder = mesh.userData.isText ? 1001 : 999;
            mesh.position.z = 0.005; // Фикс z-offset для геометрии

            let strokeMesh = getStrokeMeshes(obj).find(stroke => stroke.userData.parentMeshId === mesh.uuid);
            if (forceRebuildStroke && strokeMesh) {
                if (strokeMesh.parent) strokeMesh.parent.remove(strokeMesh);
                disposeObject3D(strokeMesh);
                strokeMesh = null;
            }
            if (useStroke && mesh.geometry.userData && mesh.geometry.userData.shapesData) {
                const meshIsCircle = isMarkerStyleCircle(obj, mesh);
                const co = meshIsCircle ? normalizeCircleOutline(obj.userData.circleOutline) : null;
                if (!strokeMesh || strokeMesh.userData.strokeWidth !== strokeWidth || strokeMesh.userData.strokePattern !== strokePattern || strokeMesh.userData.strokeDash !== strokeDash || strokeMesh.userData.strokeGap !== strokeGap || strokeMesh.userData.strokeDot !== strokeDot || strokeMesh.userData.strokeCap !== strokeCap || (meshIsCircle && (strokeMesh.userData.circleGap !== co.gap || strokeMesh.userData.circleWidth !== co.width)) || forceRebuildStroke) {
                    if (meshIsCircle && window.GeometryUtils) {
                        if (strokeMesh) {
                            if (strokeMesh.parent) strokeMesh.parent.remove(strokeMesh);
                            disposeObject3D(strokeMesh);
                            strokeMesh = null;
                        }
                        strokeMesh = buildCircleStroke(mesh, strokePattern, co.gap, co.width, qualityVal, strokeCap, strokeHex);
                        if (strokeMesh) {
                            strokeMesh.userData.isStroke = true;
                            strokeMesh.userData.parentMeshId = mesh.uuid;
                            mesh.parent.add(strokeMesh);
                        }
                    } else {
                        const pScale = pencilStrokeFactor(obj, mesh);
                        const strokeGeo = generateStrokeGeometry(mesh.geometry.userData.shapesData, strokeWidth * 0.1 * pScale, qualityVal, strokePattern, strokeDash * 0.1 * pScale, strokeGap * 0.1 * pScale, strokeDot * 0.1 * pScale, strokeCap);
                        if (strokeGeo) {
                            if (!strokeMesh) {
                                strokeMesh = new THREE.Mesh(strokeGeo, new THREE.MeshBasicMaterial({ color: strokeHex, depthWrite: true, alphaTest: 0.01 }));
                                if (mesh.userData.isText) strokeMesh.material.side = THREE.DoubleSide;
                                strokeMesh.userData.isStroke = true;
                                strokeMesh.frustumCulled = false;
                                strokeMesh.userData.parentMeshId = mesh.uuid;
                                mesh.parent.add(strokeMesh);
                            } else { strokeMesh.geometry.dispose(); strokeMesh.geometry = strokeGeo; }
                        }
                    }
                        strokeMesh.userData.strokeWidth = strokeWidth;
                        strokeMesh.userData.strokePattern = strokePattern;
                        strokeMesh.userData.strokeCap = strokeCap;
                        strokeMesh.userData.strokeDash = strokeDash;
                        strokeMesh.userData.strokeGap = strokeGap;
                        strokeMesh.userData.strokeDot = strokeDot;
                        if (meshIsCircle && co) {
                            strokeMesh.userData.circleGap = co.gap;
                            strokeMesh.userData.circleWidth = co.width;
                        }
                        strokeMesh.userData.quality = qualityVal;

                        const tX = mesh.geometry.userData.tX || 0;
                        const tY = mesh.geometry.userData.tY || 0;
                        strokeMesh.geometry.translate(tX, tY, 0);
                        const holeKey = String(Math.max(0, primaryMeshes.indexOf(mesh)));
                        const holeList = (obj.userData.strokeHoles && obj.userData.strokeHoles[holeKey]) || [];
                        const holedGeo = strokeMesh.isLine ? strokeMesh.geometry : applyStrokeHoles(strokeMesh.geometry, holeList);
                        if (!holedGeo) {
                            if (strokeMesh.parent) strokeMesh.parent.remove(strokeMesh);
                            disposeObject3D(strokeMesh);
                            strokeMesh = null;
                        } else if (holedGeo !== strokeMesh.geometry) {
                            strokeMesh.geometry = holedGeo;
                        }
                }
                if (strokeMesh) {
                    strokeMesh.material.color.set(strokeHex);
                    strokeMesh.userData.strokeUseAlpha = strokeUseAlpha;
                    strokeMesh.userData.pseudoOpacity = strokeUseAlpha ? alpha : 1;
                    strokeMesh.material.opacity = 1;
                    strokeMesh.material.transparent = false;
                    strokeMesh.position.z = 0.015; // Фикс z-offset для обводки (зоны — поверх заливок)
                    strokeMesh.renderOrder = 998; 
                    strokeMesh.scale.set(1, 1, 1);
                }
            } else if (strokeMesh) {
                if (strokeMesh.parent) strokeMesh.parent.remove(strokeMesh);
                disposeObject3D(strokeMesh);
            }
        });
        if (window.scheduleSinglePseudoRebuild) window.scheduleSinglePseudoRebuild(obj);
        else rebuildPseudoTransparency(obj);
        if (window.requestSceneRender) window.requestSceneRender();
    }

    function duplicateObject(obj) {
        recordVectorUndoState(true);
        const data = window.getVectorsForJSON().find(d => d.uuid === obj.uuid);
        if (data) {
            const cloneData = JSON.parse(JSON.stringify(data)); 
            cloneData.uuid = THREE.MathUtils.generateUUID(); 
            const pm = getPrimaryMesh(obj);
            if (!pm || !pm.userData.isText) {
                cloneData.position.x += 50; 
                cloneData.position.y -= 50;
            }
            cloneData.name = cloneData.name + " (Копия)";
            
            vectorState.pendingSelectId = cloneData.uuid;
            window.loadVectorsFromJSON([cloneData]);
            window.showToast("Слой скопирован", "success");
        }
    }

    window.deleteConvertedFigures = function(zoneId) {
        const doomed = vectorState.objects.filter(obj => obj.userData && obj.userData.convertedFrom === zoneId);
        if (doomed.length === 0) return 0;
        recordVectorUndoState(true);
        const activeGone = vectorState.activeObj && vectorState.activeObj.userData && vectorState.activeObj.userData.convertedFrom === zoneId;
        doomed.forEach(obj => {
            if (window.vectorTransformControl && window.vectorTransformControl.object === obj) window.vectorTransformControl.detach();
            scene.remove(obj);
            disposeObject3D(obj);
        });
        vectorState.objects = vectorState.objects.filter(obj => !(obj.userData && obj.userData.convertedFrom === zoneId));
        if (activeGone) selectObject(null);
        else renderLayersList();
        if (window.rebuildVectorPseudoTransparency) window.rebuildVectorPseudoTransparency();
        if (window.updateExportState) window.updateExportState();
        if (window.requestSceneRender) window.requestSceneRender();
        return doomed.length;
    };

    function renderLayersList() {
        const list = document.getElementById('vectorLayersList');
        const countSpan = document.getElementById('vectorLayerCount');
        
        if (countSpan) countSpan.textContent = vectorState.objects.length;
        
        list.innerHTML = '';
        if (vectorState.objects.length === 0) {
            list.innerHTML = '<div class="text-[10px] text-slate-500 text-center py-4 bg-slate-900/30 rounded border border-slate-800 border-dashed">Слоев нет</div>';
            return;
        }

        vectorState.objects.forEach((obj, idx) => {
            if (!obj.userData.layerGroup) makeLayerRow(obj, idx, list);
        });
        const seenGroups = [];
        vectorState.objects.forEach(obj => {
            const g = obj.userData.layerGroup;
            if (g && !seenGroups.includes(g)) seenGroups.push(g);
        });
        seenGroups.forEach(g => {
            const members = vectorState.objects.filter(o => o.userData.layerGroup === g);
            if (members.length === 0) return;
            const header = document.createElement('div');
            header.className = 'flex items-center justify-between px-1.5 py-1 mt-1 rounded bg-slate-900/60 border border-slate-700/50 text-[9px] uppercase tracking-wider text-slate-400 font-semibold';
            const title = document.createElement('span');
            title.className = 'truncate';
            title.textContent = g;
            title.title = g;
            const count = document.createElement('span');
            count.className = 'font-mono text-emerald-400';
            count.textContent = members.length;
            header.append(title, count);
            list.appendChild(header);
            members.forEach(obj => {
                makeLayerRow(obj, vectorState.objects.indexOf(obj), list);
            });
        });
        if (window.lucide) window.lucide.createIcons();
    }

    // Помечает импортированные слои группой (для отдельного отображения
    // в менеджере). hadUuids — uuid слоёв до импорта.
    window.tagLayerGroupByUuids = function(hadUuids, groupName) {
        if (!groupName) return 0;
        let n = 0;
        vectorState.objects.forEach(o => {
            if (o && !hadUuids.has(o.uuid)) { o.userData.layerGroup = groupName; n++; }
        });
        renderLayersList();
        return n;
    };

    function makeLayerRow(obj, idx, list) {
            const isActive = (vectorState.activeObj === obj);
            const div = document.createElement('div');
            div.className = `flex justify-between items-center p-1.5 rounded cursor-pointer text-[10px] border transition ${isActive ? 'bg-emerald-900/40 border-emerald-500/50 text-emerald-300' : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'}`;
            div.innerHTML = `
                <div class="flex items-center gap-2 truncate">
                    <i data-lucide="${obj.userData.icon || 'box'}" class="w-3.5 h-3.5 shrink-0 ${isActive ? 'text-emerald-400' : 'text-slate-400'}"></i>
                    <span class="layer-name truncate font-bold"></span>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                    <button class="dup-btn text-blue-400 hover:text-blue-300 hover:bg-blue-500/20 p-1 rounded transition" title="Дублировать"><i data-lucide="copy" class="w-3.5 h-3.5"></i></button>
                    <button class="delete-btn text-slate-500 hover:text-rose-400 hover:bg-rose-500/20 p-1 rounded transition" title="Удалить"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
                </div>
            `;
            div.querySelector('.layer-name').textContent = obj.name || 'Слой ' + (idx + 1);
            div.addEventListener('click', (e) => {
                if (e.target.closest('.delete-btn')) {
                    recordVectorUndoState(true);
                    if (window.vectorTransformControl && window.vectorTransformControl.object === obj) window.vectorTransformControl.detach();
                    scene.remove(obj);
                    disposeObject3D(obj);
                    vectorState.objects = vectorState.objects.filter(o => o !== obj);
                    if (isActive) selectObject(null);
                    else renderLayersList();
                    // Удаление меняет «низ» для верхних — пересобрать всё.
                    if (window.rebuildVectorPseudoTransparency) window.rebuildVectorPseudoTransparency();
                    
                    const countSpan = document.getElementById('vectorLayerCount');
                    if (countSpan) countSpan.textContent = vectorState.objects.length;
                    
                    if (window.updateExportState) window.updateExportState();
                    if (window.requestSceneRender) window.requestSceneRender();
                } else if (e.target.closest('.dup-btn')) {
                    duplicateObject(obj);
                } else {
                    selectObject(obj);
                }
            });
            list.appendChild(div);
    }

    function spawnVectorMesh(geometry, name, icon, isText = false, textContent = '', defaultScale = 1, posX = null, posY = null) {
        recordVectorUndoState(true);
        const material = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: false, opacity: 1, depthWrite: true, alphaTest: 0.01 });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.frustumCulled = false;
        mesh.renderOrder = isText ? 1001 : 999;

        const group = new THREE.Group();
        group.uuid = THREE.MathUtils.generateUUID(); 
        group.add(mesh);
        
        group.scale.set(defaultScale, defaultScale, 1);

        let spawnZ = isText ? 30 : 20;
        let sX = posX !== null ? posX : (window.mapBounds ? window.mapBounds.centerX : 0);
        let sY = posY !== null ? posY : (window.mapBounds ? window.mapBounds.centerY : 0);

        group.position.set(sX, sY, spawnZ);
        
        group.name = name;
        group.userData.icon = icon;
        group.renderOrder = 999; 
        
        if (isText) {
            mesh.userData.isText = true;
            mesh.userData.text = textContent;
            mesh.userData.quality = 12;
            mesh.userData.font = vectorState.loadedFont;
            mesh.userData.textLineHeight = 1.2;
            group.userData.textAlign = 'center';
        }
        
        scene.add(group);
        vectorState.objects.unshift(group); 
        updateVectorsOrder();
        selectObject(group);
        
        if (window.updateExportState) window.updateExportState();
        if (window.requestSceneRender) window.requestSceneRender();
        
        return group; // Возвращаем для drag-to-size
    }

    document.getElementById('btnAddSquare')?.addEventListener('click', () => {
        activatePlacementMode((x, y) => {
            const shape = new THREE.Shape(); shape.moveTo(-5, -5); shape.lineTo(5, -5); shape.lineTo(5, 5); shape.lineTo(-5, 5); shape.lineTo(-5, -5);
            const geo = new THREE.ShapeGeometry(shape); 
            geo.userData.shapesData = [{ shapes: [shape], offsetX: 0, offsetY: 0 }];
            geo.userData.tX = 0; geo.userData.tY = 0;
            return spawnVectorMesh(geo, 'Квадрат', 'square', false, '', 2, x, y); 
        }, 'Квадрат');
    });

    document.getElementById('btnAddCircle')?.addEventListener('click', () => {
        activatePlacementMode((x, y) => {
            const shape = new THREE.Shape(); shape.absarc(0, 0, 5, 0, Math.PI * 2, false);
            const geo = new THREE.ShapeGeometry(shape); 
            geo.userData.shapesData = [{ shapes: [shape], offsetX: 0, offsetY: 0 }];
            geo.userData.tX = 0; geo.userData.tY = 0;
            return spawnVectorMesh(geo, 'Круг', 'circle', false, '', 2, x, y);
        }, 'Круг');
    });

    document.getElementById('btnAddTriangle')?.addEventListener('click', () => {
        activatePlacementMode((x, y) => {
            const shape = new THREE.Shape(); shape.moveTo(0, 5); shape.lineTo(4.33, -2.5); shape.lineTo(-4.33, -2.5); shape.lineTo(0, 5);
            const geo = new THREE.ShapeGeometry(shape); 
            geo.userData.shapesData = [{ shapes: [shape], offsetX: 0, offsetY: 0 }];
            geo.userData.tX = 0; geo.userData.tY = 0;
            return spawnVectorMesh(geo, 'Треугольник', 'triangle', false, '', 2, x, y);
        }, 'Треугольник');
    });

    document.getElementById('btnAddMarker')?.addEventListener('click', () => {
        activatePlacementMode((x, y) => {
            const shape = new THREE.Shape(); 
            shape.moveTo(0, -5); 
            shape.quadraticCurveTo(4, -1, 4, 2);
            shape.absarc(0, 2, 4, 0, Math.PI, false); 
            shape.quadraticCurveTo(-4, -1, 0, -5);
            const hole = new THREE.Path();
            hole.absarc(0, 2, 1.5, 0, Math.PI * 2, true);
            shape.holes.push(hole);
            const geo = new THREE.ShapeGeometry(shape); 
            geo.userData.shapesData = [{ shapes: [shape], offsetX: 0, offsetY: 0 }];
            geo.userData.tX = 0; geo.userData.tY = 0;
            return spawnVectorMesh(geo, 'Маркер', 'map-pin', false, '', 2, x, y);
        }, 'Маркер');
    });
    
    document.getElementById('btnAddText')?.addEventListener('click', () => {
        const textNode = document.getElementById('vectorTextInput');
        const text = textNode ? textNode.value || 'GTA 5' : 'GTA 5';
        if (!vectorState.loadedFont) { window.showToast("Шрифт загружается...", "error"); return; }
        
        activatePlacementMode((x, y) => {
            const geometry = createTextGeometry(text, vectorState.loadedFont, 12, 'center', 1.2);
            const displayName = text.split('\n')[0] || 'Текст';
            return spawnVectorMesh(geometry, displayName, 'type', true, text, 2, x, y); 
        }, 'Текст');
    });

    // --- КАРАНДАШ: рисование произвольной формы по точкам (двойной клик замыкает контур) ---
    vectorState.pencilActive = false;
    vectorState.pencilPoints = [];
    vectorState.pencilLastClickTime = 0;
    vectorState.pencilPreviewLine = null;
    vectorState.pencilPreviewDots = [];
    vectorState.pencilLiveLine = null;
    vectorState.pencilLiveDot = null;

    function pencilDrawZ() {
        return 20;
    }

    function pencilCleanupPreview() {
        const cleanupObj = (obj) => { if (obj) { scene.remove(obj); disposeObject3D(obj); } };
        cleanupObj(vectorState.pencilPreviewLine); vectorState.pencilPreviewLine = null;
        cleanupObj(vectorState.pencilLiveLine); vectorState.pencilLiveLine = null;
        cleanupObj(vectorState.pencilLiveDot); vectorState.pencilLiveDot = null;
        vectorState.pencilPreviewDots.forEach(d => { scene.remove(d); disposeObject3D(d); });
        vectorState.pencilPreviewDots = [];
        if (window.requestSceneRender) window.requestSceneRender();
    }

    function refreshPencilPreview() {
        const z = pencilDrawZ();
        if (vectorState.pencilPreviewLine) { scene.remove(vectorState.pencilPreviewLine); disposeObject3D(vectorState.pencilPreviewLine); }
        const points = vectorState.pencilPoints.map(point => new THREE.Vector3(point.x, point.y, z));
        if (vectorState.pencilMode !== 'line' && points.length >= 3) points.push(points[0].clone());
        if (points.length > 0) {
            const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
            vectorState.pencilPreviewLine = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x00ff88, depthTest: false }));
            vectorState.pencilPreviewLine.renderOrder = 1000;
            scene.add(vectorState.pencilPreviewLine);
        } else {
            vectorState.pencilPreviewLine = null;
        }

        if (window.requestSceneRender) window.requestSceneRender();
    }

    vectorState.addPencilPoint = function(pt) {
        const z = pencilDrawZ();
        vectorState.pencilPoints.push({ x: pt.x, y: pt.y, z: z });

        const dot = new THREE.Mesh(
            new THREE.CircleGeometry(0.5, 16),
            new THREE.MeshBasicMaterial({ color: 0x00ff88, side: THREE.DoubleSide, depthTest: false })
        );
        dot.position.set(pt.x, pt.y, z);
        dot.renderOrder = 1000;
        scene.add(dot);
        vectorState.pencilPreviewDots.push(dot);

        refreshPencilPreview();
    };

    vectorState.undoPencilPoint = function() {
        if (vectorState.pencilPoints.length === 0) return;
        vectorState.pencilPoints.pop();
        const dot = vectorState.pencilPreviewDots.pop();
        if (dot) { scene.remove(dot); disposeObject3D(dot); }
        refreshPencilPreview();
    };

    vectorState.updatePencilLivePreview = function(pt) {
        const z = pencilDrawZ();
        const cleanupObj = (obj) => { if (obj) { scene.remove(obj); disposeObject3D(obj); } };
        cleanupObj(vectorState.pencilLiveLine); vectorState.pencilLiveLine = null;
        cleanupObj(vectorState.pencilLiveDot); vectorState.pencilLiveDot = null;

        if (vectorState.pencilPoints.length > 0) {
            const last = vectorState.pencilPoints[vectorState.pencilPoints.length - 1];
            const lineGeo = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(last.x, last.y, z),
                new THREE.Vector3(pt.x, pt.y, z)
            ]);
            vectorState.pencilLiveLine = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x00ff88, opacity: 0.5, transparent: true, depthTest: false }));
            vectorState.pencilLiveLine.renderOrder = 1000;
            scene.add(vectorState.pencilLiveLine);
        }

        const dot = new THREE.Mesh(
            new THREE.CircleGeometry(0.5, 16),
            new THREE.MeshBasicMaterial({ color: 0x00ff88, side: THREE.DoubleSide, transparent: true, opacity: 0.6, depthTest: false })
        );
        dot.position.set(pt.x, pt.y, z);
        dot.renderOrder = 1000;
        scene.add(dot);
        vectorState.pencilLiveDot = dot;

        if (window.requestSceneRender) window.requestSceneRender();
    };

    vectorState.cancelPencil = function() {
        vectorState.pencilActive = false;
        vectorState.pencilPoints = [];
        vectorState.pencilLastClickTime = 0;
        controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
        document.body.style.cursor = 'default';
        pencilCleanupPreview();
    };

    const ERASER_RADIUS = 30;
    let eraserActive = false;
    let erasingStroke = false;
    let eraserPreview = null;
    let lastEraseTime = 0;
    const erasedWrappers = new Set();

    function updateEraserPreview(pt) {
        clearEraserPreview();
        const z = pencilDrawZ();
        const pts = [];
        for (let i = 0; i <= 48; i++) {
            const a = (i / 48) * Math.PI * 2;
            pts.push(new THREE.Vector3(pt.x + Math.cos(a) * ERASER_RADIUS, pt.y + Math.sin(a) * ERASER_RADIUS, z));
        }
        eraserPreview = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xff3344, depthTest: false }));
        eraserPreview.renderOrder = 1001;
        scene.add(eraserPreview);
        if (window.requestSceneRender) window.requestSceneRender();
    }

    function clearEraserPreview() {
        if (eraserPreview) { scene.remove(eraserPreview); disposeObject3D(eraserPreview); eraserPreview = null; }
    }

    function strokeHolesFor(obj, parentMesh) {
        const primaries = getMeshes(obj, false);
        const key = String(Math.max(0, primaries.indexOf(parentMesh)));
        if (!obj.userData.strokeHoles) obj.userData.strokeHoles = {};
        if (!obj.userData.strokeHoles[key]) obj.userData.strokeHoles[key] = [];
        return obj.userData.strokeHoles[key];
    }

    function rebuildLineStrokeWithHoles(obj, strokeMesh, parent, holes, u) {
        if (!parent || !window.GeometryUtils) return false;
        const coH = normalizeCircleOutline({ gap: u.circleGap, width: u.circleWidth });
        const R = circleShapeRadius(parent);
        if (!(R > 0)) return false;
        const P = window.GeometryUtils.circleOutlineParams(R, coH.gap, coH.width);
        const midR = Math.max(0.5, (R + P.contourR) / 2);
        const fit = window.GeometryUtils.fitRingDashes(2 * Math.PI * midR, P.strokeWidth);
        const tX = parent.geometry.userData.tX || 0, tY = parent.geometry.userData.tY || 0;
        const unit = (2 * Math.PI * midR) / fit.count;
        const pos = [];
        for (let k = 0; k < fit.count; k++) {
            const a0 = (k * unit) / midR, a1 = (k * unit + fit.dashSize) / midR;
            const am = (a0 + a1) / 2;
            const mx = tX + midR * Math.cos(am), my = tY + midR * Math.sin(am);
            let hit = false;
            for (const h of holes) {
                const dx = mx - h.x, dy = my - h.y;
                const rr = (h.r || 0) + fit.dashSize / 2;
                if (dx * dx + dy * dy <= rr * rr) { hit = true; break; }
            }
            if (hit) continue;
            pos.push(tX + midR * Math.cos(a0), tY + midR * Math.sin(a0), 0,
                     tX + midR * Math.cos(a1), tY + midR * Math.sin(a1), 0);
        }
        const par = strokeMesh.parent;
        const mat = strokeMesh.material;
        if (par) par.remove(strokeMesh);
        strokeMesh.geometry.dispose();
        if (pos.length < 6) return true;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        const lineObj = new THREE.LineSegments(geo, mat);
        Object.assign(lineObj.userData, u);
        lineObj.position.copy(strokeMesh.position);
        lineObj.renderOrder = strokeMesh.renderOrder;
        lineObj.scale.copy(strokeMesh.scale);
        lineObj.frustumCulled = false;
        if (par) par.add(lineObj);
        return true;
    }

    function rebuildStrokeWithHoles(obj, strokeMesh) {
        const primaries = getMeshes(obj, false);
        const parent = primaries.find(m => m.uuid === strokeMesh.userData.parentMeshId) || primaries[0];
        if (!parent || !parent.geometry.userData.shapesData) return false;
        const u = strokeMesh.userData;
        const pi = Math.max(0, primaries.indexOf(parent));
        const holes = (obj.userData.strokeHoles && obj.userData.strokeHoles[String(pi)]) || [];
        if (strokeMesh.isLine) {
            return rebuildLineStrokeWithHoles(obj, strokeMesh, parent, holes, u);
        }
        const holeCircle = obj.userData.icon === 'circle' && !obj.userData.isPencil && !obj.userData.isSvg && u.circleGap !== undefined && !strokeMesh.isLine && !strokeMesh.isLineSegments && window.GeometryUtils;
        if (holeCircle) {
            const coH = normalizeCircleOutline({ gap: u.circleGap, width: u.circleWidth });
            const P = window.GeometryUtils.circleOutlineParams(circleShapeRadius(parent), coH.gap, coH.width);
            const cShapeH = new THREE.Shape();
            cShapeH.absarc(0, 0, Math.max(0.01, P.contourR), 0, Math.PI * 2, false);
            let g = generateStrokeGeometry([{ shapes: [cShapeH], offsetX: 0, offsetY: 0 }], P.strokeWidth, u.quality || parent.userData.quality || 12, u.strokePattern || 'solid', P.dashLen, P.gapLen, P.dotSize, u.strokeCap || 'round');
            if (g) {
                g.translate(parent.geometry.userData.tX || 0, parent.geometry.userData.tY || 0, 0);
                g = applyStrokeHoles(g, holes);
            }
            if (!g) {
                if (strokeMesh.parent) strokeMesh.parent.remove(strokeMesh);
                disposeObject3D(strokeMesh);
                return true;
            }
            strokeMesh.geometry.dispose();
            strokeMesh.geometry = g;
            return true;
        }
        const pScale = pencilStrokeFactor(obj, parent);
        let g = generateStrokeGeometry(parent.geometry.userData.shapesData, (u.strokeWidth || 10) * 0.1 * pScale, u.quality || parent.userData.quality || 12, u.strokePattern || 'solid', (u.strokeDash ?? 10) * 0.1 * pScale, (u.strokeGap ?? 6) * 0.1 * pScale, (u.strokeDot ?? 8) * 0.1 * pScale, u.strokeCap || 'round');
        if (g) {
            g.translate(parent.geometry.userData.tX || 0, parent.geometry.userData.tY || 0, 0);
            g = applyStrokeHoles(g, holes);
        }
        if (!g) {
            if (strokeMesh.parent) strokeMesh.parent.remove(strokeMesh);
            disposeObject3D(strokeMesh);
            return true;
        }
        strokeMesh.geometry.dispose();
        strokeMesh.geometry = g;
        return true;
    }

    function eraseStrokeAt(worldPt) {
        let changed = false;
        vectorState.objects.forEach(obj => {
            obj.updateMatrixWorld(true);
            getStrokeMeshes(obj).forEach(stroke => {
                stroke.updateMatrixWorld(true);
                const wz = new THREE.Vector3().setFromMatrixPosition(stroke.matrixWorld).z;
                const local = stroke.worldToLocal(new THREE.Vector3(worldPt.x, worldPt.y, wz));
                const e = stroke.matrixWorld.elements;
                const s = Math.max(Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6])) || 1;
                const r = ERASER_RADIUS / s;
                if (stroke.isLine) {
                    const posAttr = stroke.geometry.attributes.position;
                    if (!posAttr) return;
                    const n = posAttr.count;
                    const closed = !!stroke.isLineLoop;
                    const dist2 = (i, j) => {
                        const ax = posAttr.getX(i), ay = posAttr.getY(i);
                        const dx = posAttr.getX(j) - ax, dy = posAttr.getY(j) - ay;
                        const len2 = dx * dx + dy * dy;
                        let t = len2 > 1e-12 ? ((local.x - ax) * dx + (local.y - ay) * dy) / len2 : 0;
                        t = Math.max(0, Math.min(1, t));
                        const qx = ax + dx * t - local.x, qy = ay + dy * t - local.y;
                        return qx * qx + qy * qy;
                    };
                    let hit = false;
                    if (closed) {
                        for (let i = 0; i < n && !hit; i++) {
                            if (dist2(i, (i + 1) % n) <= r * r) hit = true;
                        }
                    } else {
                        for (let i = 0; i + 1 < n && !hit; i += 2) {
                            if (dist2(i, i + 1) <= r * r) hit = true;
                        }
                    }
                    if (!hit) return;
                    const primaries = getMeshes(obj, false);
                    const parent = primaries.find(m => m.uuid === stroke.userData.parentMeshId) || primaries[0];
                    const holes = strokeHolesFor(obj, parent);
                    holes.push({ x: local.x, y: local.y, r });
                    if (rebuildStrokeWithHoles(obj, stroke)) { changed = true; erasedWrappers.add(obj); }
                    return;
                }
                const posAttr = stroke.geometry.attributes.position;
                if (!posAttr) return;
                const indexAttr = stroke.geometry.index;
                const triCount = indexAttr ? indexAttr.count / 3 : posAttr.count / 3;
                let hit = false;
                for (let i = 0; i < triCount && !hit; i++) {
                    const ids = indexAttr ? [indexAttr.getX(i * 3), indexAttr.getX(i * 3 + 1), indexAttr.getX(i * 3 + 2)] : [i * 3, i * 3 + 1, i * 3 + 2];
                    const cx = (posAttr.getX(ids[0]) + posAttr.getX(ids[1]) + posAttr.getX(ids[2])) / 3;
                    const cy = (posAttr.getY(ids[0]) + posAttr.getY(ids[1]) + posAttr.getY(ids[2])) / 3;
                    const dx = cx - local.x, dy = cy - local.y;
                    if (dx * dx + dy * dy <= r * r) hit = true;
                }
                if (!hit) return;
                const primaries = getMeshes(obj, false);
                const parent = primaries.find(m => m.uuid === stroke.userData.parentMeshId) || primaries[0];
                const holes = strokeHolesFor(obj, parent);
                holes.push({ x: local.x, y: local.y, r });
                if (rebuildStrokeWithHoles(obj, stroke)) { changed = true; erasedWrappers.add(obj); }
            });
        });
        return changed;
    }

    function activateEraser() {
        if (vectorState.cancelPencil) vectorState.cancelPencil();
        vectorState.placementMode = null;
        eraserActive = true;
        erasingStroke = false;
        controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
        document.body.style.cursor = 'crosshair';
        if (window.vectorTransformControl) window.vectorTransformControl.enabled = false;
        window.showToast('Ластик: стирайте часть обводки ЛКМ. ПКМ — перемещение. Esc — отмена', 'success');
    }

    function cancelEraser() {
        eraserActive = false;
        erasingStroke = false;
        controls.enabled = true;
        controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
        document.body.style.cursor = 'default';
        clearEraserPreview();
        if (window.vectorTransformControl) window.vectorTransformControl.enabled = true;
    }

    function createPencilShapeFromPoints(localPts) {
        if (!localPts || localPts.length < 3) return null;
        const shape = new THREE.Shape();
        shape.moveTo(localPts[0].x, localPts[0].y);
        for (let i = 1; i < localPts.length; i++) shape.lineTo(localPts[i].x, localPts[i].y);
        shape.closePath();
        const geo = new THREE.ShapeGeometry(shape);
        geo.userData.shapesData = [{ shapes: [shape], offsetX: 0, offsetY: 0 }];
        geo.userData.tX = 0; geo.userData.tY = 0;
        return geo;
    }

    function createPencilMultiShapeFromPoints(shapesPts) {
        if (!Array.isArray(shapesPts) || shapesPts.length === 0) return null;
        const shapes = [];
        shapesPts.forEach(localPts => {
            if (!localPts || localPts.length < 3) return;
            const shape = new THREE.Shape();
            shape.moveTo(localPts[0].x, localPts[0].y);
            for (let i = 1; i < localPts.length; i++) shape.lineTo(localPts[i].x, localPts[i].y);
            shape.closePath();
            shapes.push(shape);
        });
        if (shapes.length === 0) return null;
        const geo = new THREE.ShapeGeometry(shapes);
        geo.userData.shapesData = [{ shapes, offsetX: 0, offsetY: 0 }];
        geo.userData.tX = 0; geo.userData.tY = 0;
        return geo;
    }

    function createPencilLineFromPoints(localPts, width = 2, pattern = 'solid') {
        if (!localPts || localPts.length < 2) return null;
        const points = localPts.map(point => new THREE.Vector3(point.x, point.y, 0));
        const geometries = [];
        const addStroke = strokePoints => {
            if (strokePoints.length < 2) return;
            const geometry = THREE.SVGLoader.pointsToStroke(strokePoints, { strokeWidth: width, strokeLineJoin: 'round', strokeLineCap: 'round' });
            if (geometry) geometries.push(geometry);
        };

        if (pattern === 'solid') {
            addStroke(points);
        } else {
            // Длина всей линии для равномерного распределения штрихов/точек
            const segLens = [];
            let totalLen = 0;
            for (let i = 0; i < points.length - 1; i++) {
                const l = points[i].distanceTo(points[i + 1]);
                segLens.push(l);
                totalLen += l;
            }
            if (totalLen < 1e-9) return null;
            // Точка на расстоянии d вдоль линии (без заворота, с clamp)
            const pointAt = (d) => {
                let dd = Math.max(0, Math.min(totalLen, d));
                for (let i = 0; i < segLens.length; i++) {
                    if (dd <= segLens[i] || i === segLens.length - 1) {
                        const t = segLens[i] < 1e-12 ? 0 : Math.max(0, Math.min(1, dd / segLens[i]));
                        return points[i].clone().lerp(points[i + 1], t);
                    }
                    dd -= segLens[i];
                }
                return points[points.length - 1].clone();
            };
            if (pattern === 'dotted') {
                const dotR = width / 2;
                const stepLen = Math.max(width * 3, 1);
                const n = Math.max(1, Math.round(totalLen / stepLen));
                const step = totalLen / n;
                for (let k = 0; k < n; k++) {
                    const p = pointAt((k + 0.5) * step);
                    const geometry = new THREE.CircleGeometry(dotR, 12);
                    geometry.translate(p.x, p.y, 0);
                    geometries.push(geometry);
                }
            } else {
                const dashLength = Math.max(width * 5, 5);
                const gapLength = Math.max(width * 3, 3);
                const period = dashLength + gapLength;
                const n = Math.max(1, Math.round(totalLen / period));
                const scaledPeriod = totalLen / n;
                const scaledDash = scaledPeriod * (dashLength / period);
                for (let k = 0; k < n; k++) {
                    const d0 = k * scaledPeriod;
                    const d1 = d0 + scaledDash;
                    const span = d1 - d0;
                    const samples = Math.max(2, Math.ceil(span / Math.max(scaledDash / 8, 0.01)));
                    const chain = [];
                    for (let s = 0; s <= samples; s++) chain.push(pointAt(d0 + (span * s) / samples));
                    addStroke(chain);
                }
            }
        }
        if (geometries.length === 0) return null;
        const geo = geometries.length === 1 ? geometries[0] : THREE.BufferGeometryUtils.mergeBufferGeometries(geometries);
        geometries.forEach(item => { if (item !== geo) item.dispose(); });
        if (!geo) return null;
        geo.userData.pencilLine = true;
        geo.userData.lineWidth = width;
        geo.userData.linePattern = pattern;
        return geo;
    }

    function spawnPencilShape(worldPts) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        worldPts.forEach(p => {
            if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
        });
        const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;
        const localPts = worldPts.map(p => ({ x: p.x - centerX, y: p.y - centerY }));
        const isLine = vectorState.pencilMode === 'line';
        const geo = isLine ? createPencilLineFromPoints(localPts) : createPencilShapeFromPoints(localPts);
        if (!geo) return null;
        const group = spawnVectorMesh(geo, isLine ? 'Нарисованная линия' : 'Нарисованная фигура', isLine ? 'spline' : 'pen', false, '', 1, centerX, centerY);
        group.userData.isPencil = true;
        group.userData.isPencilLine = isLine;
        group.userData.pencilPoints = localPts;
        group.userData.lineWidth = isLine ? (geo.userData.lineWidth || 2) : undefined;
        group.userData.linePattern = isLine ? (geo.userData.linePattern || 'solid') : undefined;
        if (isLine) selectObject(group);
        return group;
    }

    vectorState.finishPencilShape = function() {
        const minPoints = vectorState.pencilMode === 'line' ? 2 : 3;
        if (vectorState.pencilPoints.length < minPoints) {
            window.showToast(vectorState.pencilMode === 'line' ? "Минимум 2 точки для линии" : "Минимум 3 точки для замкнутой фигуры", "error");
            vectorState.cancelPencil();
            return;
        }
        const worldPts = vectorState.pencilPoints.slice();
        vectorState.cancelPencil();
        spawnPencilShape(worldPts);
        window.showToast(`${vectorState.pencilMode === 'line' ? 'Линия' : 'Фигура'} создана (${worldPts.length} точек)`, "success");
    };

    function activatePencil(mode) {
        if (eraserActive) cancelEraser();
        if (vectorState.pencilActive) {
            vectorState.cancelPencil();
            window.showToast("Рисование остановлено", "error");
            return;
        }
        vectorState.placementMode = null;
        vectorState.pencilMode = mode;
        vectorState.pencilActive = true;
        controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
        vectorState.pencilPoints = [];
        vectorState.pencilLastClickTime = 0;
        document.body.style.cursor = 'crosshair';
        window.showToast(mode === 'line' ? "Линия: клики ставят точки, двойной клик завершает. Esc — отмена" : "Фигура: клики ставят точки, двойной клик замыкает контур. Esc — отмена", "success");
    }

    document.getElementById('btnAddPencil')?.addEventListener('click', () => activatePencil('shape'));
    document.getElementById('btnAddPencilLine')?.addEventListener('click', () => activatePencil('line'));
    document.getElementById('btnAddEraser')?.addEventListener('click', () => {
        if (eraserActive) cancelEraser();
        else activateEraser();
    });
    window.cancelEraser = cancelEraser;

    document.getElementById('vectorSvgInput')?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const svgString = event.target.result;
            const svgLoader = new THREE.SVGLoader();
            const svgData = svgLoader.parse(svgString);

            const group = new THREE.Group();
            group.uuid = THREE.MathUtils.generateUUID();
            group.name = file.name.replace(/\.svg$/i, '');
            group.userData.icon = 'image';
            
            svgData.paths.forEach((path) => {
                const style = path.userData.style || {};
                const fillColor = style.fill === undefined ? '#ffffff' : style.fill;
                if (String(fillColor).toLowerCase() !== 'none') {
                    const material = new THREE.MeshBasicMaterial({
                        color: new THREE.Color().setStyle(fillColor),
                        opacity: style.fillOpacity !== undefined ? style.fillOpacity : 1,
                        transparent: (style.fillOpacity ?? 1) < 1, side: THREE.DoubleSide, depthWrite: true, alphaTest: 0.01
                    });
                    const shapes = createSvgShapesSafely(path);
                    shapes.forEach((shape) => {
                        const geo = new THREE.ShapeGeometry(shape);
                        geo.userData.shapesData = [{ shapes: [shape], offsetX: 0, offsetY: 0 }];
                        geo.userData.tX = 0; geo.userData.tY = 0;
                        const mesh = new THREE.Mesh(geo, material);
                        mesh.frustumCulled = false;
                        mesh.renderOrder = 999;
                        group.add(mesh);
                    });
                }
            });
            if (getMeshes(group, false).length === 0) throw new Error('SVG не содержит поддерживаемых залитых контуров');

            const box = new THREE.Box3().setFromObject(group);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y) || 1;
            
            const normalizedScale = 10 / maxDim;
            group.scale.setScalar(normalizedScale); // Нормализуем масштаб для drag-to-size
            group.position.x = -center.x * normalizedScale;
            group.position.y = -center.y * normalizedScale;
            
            const wrapper = new THREE.Group();
            wrapper.add(group);
            wrapper.scale.y = -1; 
            wrapper.name = group.name;
            wrapper.userData.icon = 'image';
            wrapper.userData.isSvg = true; 
            wrapper.userData.svgString = svgString;
            wrapper.userData.styleOverridden = false;
            wrapper.uuid = group.uuid;

            activatePlacementMode((posX, posY) => {
        let spawnZ = 20;
                wrapper.position.set(posX, posY, spawnZ);
                wrapper.renderOrder = 999;
                
                scene.add(wrapper);
                vectorState.objects.unshift(wrapper);
                updateVectorsOrder();
                selectObject(wrapper);
                
                if (window.updateExportState) window.updateExportState();
                if (window.requestSceneRender) window.requestSceneRender();
                return wrapper;
            }, 'SVG Иконка');
            
            e.target.value = "";
          } catch (err) {
            console.error(err);
            window.showToast(err.message || "Ошибка SVG", "error");
          }
        };
        reader.readAsText(file);
    });

    document.getElementById('vectorPngInput')?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const dataUrl = event.target.result;
                const geometry = await createPixelImageGeometry(dataUrl);
                activatePlacementMode((posX, posY) => {
                    const group = spawnVectorMesh(geometry, file.name.replace(/\.png$/i, ''), 'image', false, '', 1, posX, posY);
                    const mesh = getPrimaryMesh(group);
                    mesh.material.vertexColors = true;
                    mesh.material.needsUpdate = true;
                    group.userData.isPixelImage = true;
                    group.userData.pixelImageData = dataUrl;
                    group.userData.pixelImageName = file.name;
                    selectObject(group);
                    return group;
                }, 'PNG');
            } catch (error) {
                console.error(error);
                window.showToast(error.message || 'Ошибка PNG', 'error');
            } finally {
                e.target.value = '';
            }
        };
        reader.readAsDataURL(file);
    });

    function setTransformMode(mode, btnId) {
        transformControl.setMode(mode);
        ['vecModeTranslate', 'vecModeRotate', 'vecModeScale'].forEach(id => {
            const b = document.getElementById(id);
            if (b) { b.classList.remove('bg-emerald-500/20', 'text-emerald-400'); b.classList.add('bg-slate-800', 'text-slate-400'); }
        });
        const activeBtn = document.getElementById(btnId);
        if (activeBtn) { activeBtn.classList.add('bg-emerald-500/20', 'text-emerald-400'); activeBtn.classList.remove('bg-slate-800', 'text-slate-400'); }
    }

    document.getElementById('vecModeTranslate')?.addEventListener('click', () => setTransformMode('translate', 'vecModeTranslate'));
    document.getElementById('vecModeRotate')?.addEventListener('click', () => setTransformMode('rotate', 'vecModeRotate'));
    document.getElementById('vecModeScale')?.addEventListener('click', () => setTransformMode('scale', 'vecModeScale'));
    
    // ЭКСПОРТ И ИНЖЕКТ СЛОЕВ ПО РАЗНЫМ ТАЙЛАМ
    window.exportVectorsToXMLFiles = function(stateFilesArray, customFilesArray) {
        if (vectorState.objects.length === 0 && (!customFilesArray || customFilesArray.length === 0)) return 0;
        
        let modifiedCount = 0;
        const startX = -4500, stepX = 1175, topY = 8000, stepY = 1388;
        const { clipTriangleToCell } = window.GeometryUtils;

        function calcPolyArea(poly) {
            let area = 0;
            for (let i = 0; i < poly.length; i++) {
                let p1 = poly[i];
                let p2 = poly[(i + 1) % poly.length];
                area += (p1.x * p2.y) - (p2.x * p1.y);
            }
            return Math.abs(area) * 0.5;
        }

        function processAndInject(trianglesArray, tileNameSuffix, replaceExisting) {
            if (trianglesArray.length === 0) return;
            trianglesArray.sort((a, b) => a.z - b.z);
            const tiles = {};

            trianglesArray.sort((a, b) => a.z - b.z);
            const gridMinX = startX, gridMaxX = startX + 8 * stepX;
            const gridMinY = topY - 9 * stepY, gridMaxY = topY;
            const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

            // Квадраты, которые реально загружены: за сеткой привязываемся
            // к ближайшему СУЩЕСТВУЮЩЕМУ, а не создаём новый.
            const loadedFileNames = stateFilesArray.map(f => f.name);
            const gridParams = { startX: startX, stepX: stepX, topY: topY, stepY: stepY, maxGx: 7, maxGy: 8 };
            const nearestExistingCell = (cx, cy) => window.GeometryUtils.chooseNearestCell(loadedFileNames, cx, cy, gridParams);
            const getTile = (gx, gy) => {
                const tileKey = `${gx}_${gy}`;
                if (!tiles[tileKey]) {
                    tiles[tileKey] = {
                        gx: gx, gy: gy,
                        vertices: [], indices: [], vertexMap: new Map(), triSet: new Set(),
                        minX: Infinity, minY: Infinity, minZ: Infinity,
                        maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity
                    };
                }
                return tiles[tileKey];
            };
            const injectPolygon = (gx, gy, poly) => {
                if (poly.length < 3 || calcPolyArea(poly) <= 1e-6) return;
                const tile = getTile(gx, gy);
                const addVertex = (v) => {
                    const vStr = `                ${v.x.toFixed(7)} ${v.y.toFixed(7)} ${v.z.toFixed(7)}   ${Math.round(v.r)} ${Math.round(v.g)} ${Math.round(v.b)} ${Math.round(v.a)}`;
                    const q = (n) => (Math.round(n * 1e4) / 1e4).toFixed(4);
                    const vKey = `${q(v.x)}|${q(v.y)}|${q(v.z)}|${Math.round(v.r)}|${Math.round(v.g)}|${Math.round(v.b)}|${Math.round(v.a)}`;
                    if (tile.vertexMap.has(vKey)) return tile.vertexMap.get(vKey);
                    const newIdx = tile.vertices.length;
                    tile.vertices.push(vStr);
                    tile.vertexMap.set(vKey, newIdx);

                    if(v.x < tile.minX) tile.minX = v.x; if(v.x > tile.maxX) tile.maxX = v.x;
                    if(v.y < tile.minY) tile.minY = v.y; if(v.y > tile.maxY) tile.maxY = v.y;
                    if(v.z < tile.minZ) tile.minZ = v.z; if(v.z > tile.maxZ) tile.maxZ = v.z;

                    return newIdx;
                };
                const idx0 = addVertex(poly[0]);
                for (let pt = 1; pt < poly.length - 1; pt++) {
                    const tri = [idx0, addVertex(poly[pt]), addVertex(poly[pt + 1])];
                    if (tri[0] === tri[1] || tri[1] === tri[2] || tri[2] === tri[0]) continue;
                    const wa = poly[0], wb = poly[pt], wc = poly[pt + 1];
                    const wabx = wb.x - wa.x, waby = wb.y - wa.y, wabz = wb.z - wa.z;
                    const wacx = wc.x - wa.x, wacy = wc.y - wa.y, wacz = wc.z - wa.z;
                    const wcx = waby * wacz - wabz * wacy, wcy = wabz * wacx - wabx * wacz, wcz = wabx * wacy - waby * wacx;
                    if (!(wcx * wcx + wcy * wcy + wcz * wcz > 1e-18)) continue;
                    const tkey = window.GeometryUtils.triangleKey(tri[0], tri[1], tri[2]);
                    if (tile.triSet.has(tkey)) continue;
                    tile.triSet.add(tkey);
                    tile.indices.push(tri[0], tri[1], tri[2]);
                }
            };

            trianglesArray.forEach(tri => {
                const v1 = tri.v1, v2 = tri.v2, v3 = tri.v3;
                const tMinX = Math.min(v1.x, v2.x, v3.x), tMaxX = Math.max(v1.x, v2.x, v3.x);
                const tMinY = Math.min(v1.y, v2.y, v3.y), tMaxY = Math.max(v1.y, v2.y, v3.y);

                // За сеткой ничего не удаляем: треугольник целиком (без обрезки)
                // привязывается к ближайшему существующему квадрату.
                if (tMinX < gridMinX || tMaxX > gridMaxX || tMinY < gridMinY || tMaxY > gridMaxY) {
                    const cx = (v1.x + v2.x + v3.x) / 3, cy = (v1.y + v2.y + v3.y) / 3;
                    const near = nearestExistingCell(cx, cy);
                    injectPolygon(near[0], near[1], [v1, v2, v3]);
                    return;
                }

                const startGridX = clampInt(Math.floor((tMinX - startX) / stepX), 0, 7);
                const endGridX = clampInt(Math.floor((tMaxX - startX) / stepX), 0, 7);
                const startGridY = clampInt(Math.floor((topY - tMaxY) / stepY), 0, 8);
                const endGridY = clampInt(Math.floor((topY - tMinY) / stepY), 0, 8);

                for (let gx = startGridX; gx <= endGridX; gx++) {
                    for (let gy = startGridY; gy <= endGridY; gy++) {
                        const cellMinX = startX + gx * stepX;
                        const cellMaxX = cellMinX + stepX;
                        const cellMaxY = topY - gy * stepY;
                        const cellMinY = cellMaxY - stepY;

                        if (tMaxX < cellMinX || tMinX > cellMaxX || tMaxY < cellMinY || tMinY > cellMaxY) continue;

                        injectPolygon(gx, gy, clipTriangleToCell(v1, v2, v3, cellMinX, cellMaxX, cellMinY, cellMaxY));
                    }
                }
            });

            Object.keys(tiles).forEach(key => {
                const t = tiles[key]; 
                if (t.vertices.length === 0) return;
                
                const targetFileName = `minimap_${t.gx}_${t.gy}.ydd.xml`;
                const fullItemName = tileNameSuffix ? `supertile_fore_${t.gx}_${t.gy}_${tileNameSuffix}` : `supertile_fore_${t.gx}_${t.gy}`;

                let targetFile = stateFilesArray.find(f => f.name.toLowerCase() === targetFileName.toLowerCase());

                if (targetFile) {
                    const mergeParser = new DOMParser(); 
                    const mergeDoc = mergeParser.parseFromString(targetFile.text, 'application/xml');
                    let geometryChanged = false;
                    const rootItems = Array.from(mergeDoc.documentElement.children).filter(child => child.nodeName === 'Item');
                    
                    let targetLayerItem = null;
                    for (const item of rootItems) {
                        const nameNode = item.querySelector('Name');
                        if (nameNode && nameNode.textContent.toLowerCase() === fullItemName.toLowerCase()) {
                            targetLayerItem = item; break;
                        }
                    }

                    if (targetLayerItem) {
                        const vb = replaceExisting ? null : targetLayerItem.querySelector('VertexBuffer');
                        if (vb) {
                            const ib = targetLayerItem.querySelector('IndexBuffer');
                            const vDataNode = vb.querySelector('Data2') || vb.querySelector('Data');
                            const iDataNode = ib ? (ib.querySelector('Data2') || ib.querySelector('Data')) : null;
                            if (!vDataNode || !iDataNode) throw new Error(`${targetFileName}: ${fullItemName} не содержит полные VertexBuffer/IndexBuffer`);
                            
                            const geomItem = vb.closest('Item') || vb.closest('Geometry');
                            const mergeResult = window.GeometryUtils.applyYddGeometryMerge(vDataNode, iDataNode, geomItem, t.vertices, t.indices);
                            geometryChanged = mergeResult.addedTriangleCount > 0;
                        } else {
                            // Замена целиком (тестовый режим) или починка слоя без буфера:
                            // старый Item удаляется, вместо него встаёт свежесобранный.
                            const itemXml = window.createNewItemXml(t, fullItemName);
                            const tempDoc = new DOMParser().parseFromString(`<root>${itemXml}</root>`, 'application/xml');
                            const newNode = mergeDoc.importNode(tempDoc.querySelector('Item'), true);
                            targetLayerItem.parentNode.replaceChild(newNode, targetLayerItem);
                            geometryChanged = true;
                        }
                    } else {
                        const itemXml = window.createNewItemXml(t, fullItemName);
                        const tempDoc = new DOMParser().parseFromString(`<root>${itemXml}</root>`, 'application/xml');
                        mergeDoc.documentElement.appendChild(mergeDoc.importNode(tempDoc.querySelector('Item'), true));
                        geometryChanged = true;
                    }
                    
                    if (geometryChanged) {
                        const serializer = new XMLSerializer(); 
                        targetFile.text = serializer.serializeToString(mergeDoc).replace(/\s+xmlns="[^"]*"/g, '');
                        modifiedCount++;
                    }
                } else {
                    const xmlTemplate = `<?xml version="1.0" encoding="UTF-8"?>\n<DrawableDictionary>\n${window.createNewItemXml(t, fullItemName)}\n</DrawableDictionary>`;
                    const fileObj = {
                        id: 'file_' + Math.random().toString(36).substring(2, 9),
                        name: targetFileName,
                        text: xmlTemplate,
                        vertices: [], meshesData: [], isDefault: false, zOffset: 0
                    };
                    stateFilesArray.push(fileObj);
                    modifiedCount++;
                }
            });
        }

        // === СЛОИ ВЫГРУЗКИ (порядок отрисовки в игре задаёт суффикс тайла, а не Z) ===
        // tile_0_0 / sea / back — дефолтная карта, сайт их не трогает.
        // Порядок в игре: 0_0 → 1_0 → 2_0 → 0_1 → 1_1 → 2_1 → 0_2 → 1_2 → 2_2.
        const TILE_LAYER_TEXT = 'tile_1_1';    // текст лицом вверх, без подложки
        const TILE_LAYER_LABELS = 'tile_0_1';  // метки (игровые зоны)
        const TILE_LAYER_MCL = 'tile_2_1';     // MCL/FZ/DM, псевдо-прозрачность и прозрачные фигуры (tile_1_0 занят картой!)
        const TILE_LAYER_FIGURES = 'tile_2_0'; // обычные фигуры и их обводки

        let figureTriangles = [];
        let mclTriangles = [];
        let labelTriangles = [];
        let textTriangles = [];

        vectorState.objects.forEach(wrapper => {
            if (!wrapper.visible) return;

            wrapper.updateMatrixWorld(true);
            wrapper.traverse((child) => {
                if (child.isMesh && child.geometry && child.visible) {
                    const geo = child.geometry.clone();
                    geo.applyMatrix4(child.matrixWorld);

                    // ФИКС НОРМАЛЕЙ SVG
                    const det = child.matrixWorld.determinant();
                    const flipWinding = det < 0;

                    const matColor = child.material.color || new THREE.Color(1,1,1);
                    const opacity = child.material.opacity !== undefined ? child.material.opacity : 1;
                    const r = Math.round(matColor.r * 255);
                    const g = Math.round(matColor.g * 255);
                    const b = Math.round(matColor.b * 255);
                    const a = Math.round(opacity * 255);
                    const colorAttr = geo.attributes.color;

                    const posAttr = geo.attributes.position;
                    const indexAttr = geo.index;
                    if (!posAttr) return;

                    const getVertex = (idx) => ({
                        x: posAttr.getX(idx), y: posAttr.getY(idx), z: posAttr.getZ(idx),
                        r: colorAttr ? Math.round(colorAttr.getX(idx) * 255) : r,
                        g: colorAttr ? Math.round(colorAttr.getY(idx) * 255) : g,
                        b: colorAttr ? Math.round(colorAttr.getZ(idx) * 255) : b,
                        a: colorAttr ? 255 : a
                    });
                    const faceCount = indexAttr ? indexAttr.count / 3 : posAttr.count / 3;

                    // Текст всегда идёт в свой слой целиком (лицо + подложка),
                    // даже если ему выставили прозрачность.
                    const isText = Boolean(child.userData && child.userData.isText);
                    const isPseudo = Boolean(child.userData && child.userData.isPseudoTransparency);
                    const mat = child.material;
                    const isTransparent = Boolean(mat && mat.transparent && (mat.opacity === undefined || mat.opacity < 1));

                    for (let i = 0; i < faceCount; i++) {
                        let idx1 = indexAttr ? indexAttr.getX(i * 3) : i * 3;
                        let idx2 = indexAttr ? indexAttr.getX(i * 3 + 1) : i * 3 + 1;
                        let idx3 = indexAttr ? indexAttr.getX(i * 3 + 2) : i * 3 + 2;

                        if (flipWinding) {
                            let temp = idx2; idx2 = idx3; idx3 = temp;
                        }

                        const v1 = getVertex(idx1), v2 = getVertex(idx2), v3 = getVertex(idx3);
                        const avgZ = (v1.z + v2.z + v3.z) / 3;
                        const tri = { v1, v2, v3, z: avgZ };

                        if (isText) {
                            textTriangles.push(tri);
                        } else if (isPseudo || isTransparent) {
                            mclTriangles.push(tri);
                        } else {
                            figureTriangles.push(tri);
                        }
                    }
                    geo.dispose();
                }
            });
        });

        scene.children.forEach(zoneGroup => {
            if (!zoneGroup.userData || !zoneGroup.userData.isGameZone || !zoneGroup.visible) return;
            zoneGroup.updateMatrixWorld(true);
            zoneGroup.traverse(child => {
                if (!child.isMesh || !child.geometry) return;
                const geo = child.geometry.clone();
                geo.applyMatrix4(child.matrixWorld);
                const matColor = child.material.color || new THREE.Color(1, 1, 1);
                const r = Math.round(matColor.r * 255);
                const g = Math.round(matColor.g * 255);
                const b = Math.round(matColor.b * 255);
                const posAttr = geo.attributes.position;
                const indexAttr = geo.index;
                if (!posAttr) { geo.dispose(); return; }
                const faceCount = indexAttr ? indexAttr.count / 3 : posAttr.count / 3;
                for (let i = 0; i < faceCount; i++) {
                    const ids = indexAttr ? [indexAttr.getX(i * 3), indexAttr.getX(i * 3 + 1), indexAttr.getX(i * 3 + 2)] : [i * 3, i * 3 + 1, i * 3 + 2];
                    const tri = ids.map(id => ({ x: posAttr.getX(id), y: posAttr.getY(id), z: posAttr.getZ(id), r, g, b, a: 255 }));
                    labelTriangles.push({ v1: tri[0], v2: tri[1], v3: tri[2], z: (tri[0].z + tri[1].z + tri[2].z) / 3 });
                }
                geo.dispose();
            });
        });

        // MCL/FZ/DM из кастомных файлов — в слой tile_2_1.
        if (customFilesArray && customFilesArray.length > 0) {
            customFilesArray.forEach(file => {
                if (!file.meshesData) return;
                file.meshesData.forEach(data => {
                    const pos = data.positions;
                    const idx = data.indices.length > 0 ? data.indices : null;
                    const origColors = data.originalColorsList;
                    
                    const faceCount = idx ? idx.length / 3 : pos.length / 3;
                    for (let i = 0; i < faceCount; i++) {
                        const i1 = idx ? idx[i*3] : i*3;
                        const i2 = idx ? idx[i*3+1] : i*3+1;
                        const i3 = idx ? idx[i*3+2] : i*3+2;
                        
                        const getVert = (index) => {
                            const orig = origColors[index];
                            if(!orig) return {x:0,y:0,z:0,r:0,g:0,b:0,a:0};
                            const zSuf = (window.state && window.state.separateByZ) ? `_${Math.round(orig.z)}` : '';
                            const key = `${orig.r}_${orig.g}_${orig.b}_${orig.a}${zSuf}`;
                            const cmap = (window.state && window.state.colorsMap) ? window.state.colorsMap.get(key) : null;
                            return {
                                x: pos[index*3], y: pos[index*3+1], z: pos[index*3+2],
                                r: cmap ? cmap.currentR : orig.r,
                                g: cmap ? cmap.currentG : orig.g,
                                b: cmap ? cmap.currentB : orig.b,
                                a: cmap ? cmap.currentA : orig.a
                            };
                        };
                        
                        const v1 = getVert(i1), v2 = getVert(i2), v3 = getVert(i3);
                        mclTriangles.push({ v1, v2, v3, z: (v1.z + v2.z + v3.z)/3 });
                    }
                });
            });
        }

        // Раскладка по слоям: текст 1_1, метки 0_1, MCL/псевдо 2_1, фигуры 2_0.
        // Повторный экспорт дописывает новое через мёрдж, legacy tile_2_2 не трогаем.
        processAndInject(mclTriangles, TILE_LAYER_MCL);
        processAndInject(labelTriangles, TILE_LAYER_LABELS);
        processAndInject(figureTriangles, TILE_LAYER_FIGURES);
        processAndInject(textTriangles, TILE_LAYER_TEXT);
        moveManagedTilesFirst(stateFilesArray);
        
        return modifiedCount;
    };

    // Игра показывает слои сайта только в порядке как у Blender-карты:
    // для каждого файла повторяем последовательность Items из
    // window.BLENDER_FILE_ITEM_ORDER; неизвестные слои едут в конец,
    // файлы без эталона — по запасному правилу (управляемые первыми).
    // Остальные Items сохраняют исходный относительный порядок.
    const MANAGED_TILE_FIRST_ORDER = ['tile_2_0', 'tile_0_1', 'tile_1_1', 'tile_2_1'];
    function moveManagedTilesFirst(stateFilesArray) {
        stateFilesArray.forEach(file => {
            if (!/^minimap_/i.test(file.name || '')) return;
            let doc;
            try { doc = new DOMParser().parseFromString(file.text, 'application/xml'); }
            catch (err) { return; }
            if (!doc.documentElement || doc.querySelector('parsererror')) return;
            const items = Array.from(doc.documentElement.children).filter(c => c.nodeName === 'Item');
            const nameOf = (item) => {
                const nameNode = Array.from(item.children).find(c => c.nodeName === 'Name');
                return nameNode ? nameNode.textContent.trim() : '';
            };
            const refList = (window.BLENDER_FILE_ITEM_ORDER || {})[file.name] || null;
            let target;
            if (refList) {
                const pos = new Map();
                refList.forEach((shortName, idx) => pos.set(('supertile_' + shortName).toLowerCase(), idx));
                target = items.slice().sort((a, b) => {
                    const ia = pos.has(nameOf(a).toLowerCase()) ? pos.get(nameOf(a).toLowerCase()) : 1e9;
                    const ib = pos.has(nameOf(b).toLowerCase()) ? pos.get(nameOf(b).toLowerCase()) : 1e9;
                    return ia - ib;
                });
            } else {
                const rankOf = (item) => {
                    const m = nameOf(item).toLowerCase().match(/_(tile_\d_\d)$/);
                    if (!m) return -1;
                    return MANAGED_TILE_FIRST_ORDER.indexOf(m[1]);
                };
                const managed = items.filter(item => rankOf(item) >= 0)
                    .sort((a, b) => rankOf(a) - rankOf(b));
                if (managed.length === 0) return;
                target = managed.concat(items.filter(item => rankOf(item) < 0));
            }
            const before = items.map(nameOf).join('|');
            const after = target.map(nameOf).join('|');
            if (before === after) return;
            target.forEach(item => doc.documentElement.appendChild(item));
            file.text = new XMLSerializer().serializeToString(doc).replace(/\s+xmlns="[^"]*"/g, '');
        });
    }
    
    // === JSON СЕРИАЛИЗАЦИЯ И ИМПОРТ ===
    window.getVectorFontForJSON = function() {
        if (!vectorState.loadedFontData) return { name: vectorState.loadedFontName, data: null };
        return { name: vectorState.loadedFontName, data: arrayBufferToBase64(vectorState.loadedFontData) };
    };

    window.loadVectorFontFromJSON = async function(fontData) {
        if (!fontData || !fontData.data) return;
        const buffer = base64ToArrayBuffer(fontData.data);
        const parsed = ttfLoader.parse(buffer);
        vectorState.loadedFont = new THREE.Font(parsed);
        vectorState.loadedFontName = fontData.name || 'project-font.ttf';
        vectorState.loadedFontData = buffer;
    };

    window.getVectorsForJSON = function() {
        return vectorState.objects.map(obj => {
            const data = {
                uuid: obj.uuid || THREE.MathUtils.generateUUID(),
                name: obj.name,
                icon: obj.userData.icon,
                position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
                rotation: { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z },
                scale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z },
                isText: false,
                isSvg: false,
                styleOverridden: Boolean(obj.userData.styleOverridden),
                layerGroup: obj.userData.layerGroup || null,
                fillEnabled: obj.userData.fillEnabled !== false,
                fillPattern: obj.userData.fillPattern || 'solid',
                fillPatternSpacing: (Number.isFinite(obj.userData.fillPatternSpacing) && obj.userData.fillPatternSpacing > 0) ? obj.userData.fillPatternSpacing : null,
                fillPatternThickness: (Number.isFinite(obj.userData.fillPatternThickness) && obj.userData.fillPatternThickness > 0) ? obj.userData.fillPatternThickness : null
            };
            if (obj.userData.isPixelImage) {
                data.isPixelImage = true;
                data.pixelImageData = obj.userData.pixelImageData;
                data.pixelImageName = obj.userData.pixelImageName || obj.name;
            }
            
            const firstMesh = getPrimaryMesh(obj);
            if (firstMesh) {
                if (firstMesh.material) {
                    data.color = "#" + firstMesh.material.color.getHexString();
                    data.opacity = firstMesh.userData.isText
                        ? (firstMesh.userData.textOpacity ?? firstMesh.material.opacity)
                        : (firstMesh.userData.pseudoOpacity ?? firstMesh.material.opacity);
                }
                
                if (firstMesh.userData.isText) {
                    data.isText = true;
                    data.text = firstMesh.userData.text;
                    data.quality = firstMesh.userData.quality || 12;
                    data.textAlign = obj.userData.textAlign || 'center';
                    data.textLineHeight = firstMesh.userData.textLineHeight || 1.2;
                }
                
                if (obj.userData.isSvg) {
                    data.isSvg = true;
                    data.svgString = obj.userData.svgString;
                }

                if (obj.userData.isPencil) {
                    data.isPencil = true;
                    data.isPencilLine = Boolean(obj.userData.isPencilLine);
                    data.pencilPoints = obj.userData.pencilPoints;
                    if (obj.userData.pencilShapes) data.pencilShapes = obj.userData.pencilShapes;
                    if (obj.userData.convertedFrom) data.convertedFrom = obj.userData.convertedFrom;
                    data.lineWidth = obj.userData.lineWidth || firstMesh.geometry.userData.lineWidth || 2;
                    data.linePattern = obj.userData.linePattern || firstMesh.geometry.userData.linePattern || 'solid';
                }
                
                const strokeMesh = getStrokeMeshes(obj)[0];
                if (strokeMesh) {
                    data.hasStroke = true;
                    data.strokeColor = "#" + strokeMesh.material.color.getHexString();
                    data.strokeWidth = strokeMesh.userData.strokeWidth || 10;
                    data.strokePattern = strokeMesh.userData.strokePattern || obj.userData.strokePattern || 'solid';
                    data.strokeCap = strokeMesh.userData.strokeCap || obj.userData.strokeCap || 'round';
                    data.strokeDash = strokeMesh.userData.strokeDash ?? obj.userData.strokeDash ?? 10;
                    data.strokeGap = strokeMesh.userData.strokeGap ?? obj.userData.strokeGap ?? 6;
                    data.strokeDot = strokeMesh.userData.strokeDot ?? obj.userData.strokeDot ?? 8;
                    data.strokeUseAlpha = strokeMesh.userData.strokeUseAlpha ?? obj.userData.strokeUseAlpha ?? false;
                    if (obj.userData.icon === 'circle') {
                        const cg = strokeMesh.userData.circleGap ?? obj.userData.circleOutline?.gap ?? 0;
                        const cw = strokeMesh.userData.circleWidth ?? obj.userData.circleOutline?.width ?? 0.29;
                        data.circleOutline = { gap: cg, width: cw };
                    }
                    if (obj.userData.strokeHoles) data.strokeHoles = JSON.parse(JSON.stringify(obj.userData.strokeHoles));
                }
            }
            return data;
        });
    };
    
    window.loadVectorsFromJSON = async function(vectorsData, showProgress = false) {
        if (!vectorsData || !Array.isArray(vectorsData)) return;
        const hadObjects = new Set(vectorState.objects);

        try {
        for (let vectorIndex = 0; vectorIndex < vectorsData.length; vectorIndex++) {
            const data = vectorsData[vectorIndex];
            if (showProgress && window.yieldToBrowser) {
                window.showLoading?.(window.t("Восстановление слоёв...", "Restoring layers...", "Відновлення шарів..."), `${vectorIndex + 1}/${vectorsData.length}`);
                await window.yieldToBrowser();
            }
            const __t0 = (typeof performance !== 'undefined') ? performance.now() : 0;
            if (data.isPixelImage && data.pixelImageData) {
                try {
                    const geometry = await createPixelImageGeometry(data.pixelImageData);
                    const wrapper = spawnLoadedVectorMesh(geometry, data);
                    const mesh = getPrimaryMesh(wrapper);
                    mesh.material.vertexColors = true;
                    mesh.material.needsUpdate = true;
                    wrapper.userData.isPixelImage = true;
                    wrapper.userData.pixelImageData = data.pixelImageData;
                    wrapper.userData.pixelImageName = data.pixelImageName || data.name;
                } catch (error) {
                    console.warn('PNG layer skipped:', error);
                }
            } else if (data.isSvg && data.svgString) {
                const svgLoader = new THREE.SVGLoader();
                const svgData = svgLoader.parse(data.svgString);
                
                const group = new THREE.Group();
                group.uuid = data.uuid || THREE.MathUtils.generateUUID();
                group.name = data.name;
                group.userData.icon = data.icon;
                
                svgData.paths.forEach((path) => {
                    const style = path.userData.style || {};
                    const fillColor = style.fill === undefined ? '#ffffff' : style.fill;
                    if (String(fillColor).toLowerCase() !== 'none') {
                        const material = new THREE.MeshBasicMaterial({
                            color: new THREE.Color().setStyle(fillColor),
                            opacity: style.fillOpacity !== undefined ? style.fillOpacity : 1,
                            transparent: true, side: THREE.DoubleSide, depthWrite: true, alphaTest: 0.01
                        });
                        const shapes = createSvgShapesSafely(path);
                        shapes.forEach((shape) => {
                            const geo = new THREE.ShapeGeometry(shape);
                            geo.userData.shapesData = [{ shapes: [shape], offsetX: 0, offsetY: 0 }];
                            geo.userData.tX = 0; geo.userData.tY = 0;
                            const mesh = new THREE.Mesh(geo, material);
                            mesh.frustumCulled = false;
                            mesh.renderOrder = 999;
                            group.add(mesh);
                        });
                    }
                });
                
                const box = new THREE.Box3().setFromObject(group);
                const center = box.getCenter(new THREE.Vector3());
                const size = box.getSize(new THREE.Vector3());
                const maxDim = Math.max(size.x, size.y) || 1;

                const normalizedScale = 10 / maxDim;
                group.scale.setScalar(normalizedScale);
                group.position.x = -center.x * normalizedScale;
                group.position.y = -center.y * normalizedScale;
                
                const wrapper = new THREE.Group();
                wrapper.uuid = group.uuid;
                wrapper.add(group);
                wrapper.name = data.name;
                wrapper.userData.icon = data.icon;
                wrapper.userData.isSvg = true;
                wrapper.userData.svgString = data.svgString;
                wrapper.userData.styleOverridden = Boolean(data.styleOverridden);
                
                applyTransformAndProperties(wrapper, data);
            } else if (data.isText) {
                let attempts = 0;
                const checkFont = setInterval(() => {
                    attempts++;
                    if (vectorState.loadedFont) {
                        clearInterval(checkFont);
                        const quality = data.quality || 12;
                        const align = data.textAlign || 'center';
                        const lineHeight = data.textLineHeight || 1.2;
                        
                        const newGeo = createTextGeometry(data.text, vectorState.loadedFont, quality, align, lineHeight);
                        spawnLoadedVectorMesh(newGeo, data);
                    }
                    if (attempts > 50) clearInterval(checkFont); 
                }, 100);
            } else if (data.isPencil && ((data.pencilPoints && data.pencilPoints.length >= (data.isPencilLine ? 2 : 3)) || (data.pencilShapes && data.pencilShapes.length > 0))) {
                const geo = data.isPencilLine ? createPencilLineFromPoints(data.pencilPoints, data.lineWidth || 2, data.linePattern || 'solid') : (data.pencilShapes ? createPencilMultiShapeFromPoints(data.pencilShapes) : createPencilShapeFromPoints(data.pencilPoints));
                if (geo) {
                    const wrapper = spawnLoadedVectorMesh(geo, data);
                    if (wrapper) {
                        wrapper.userData.isPencil = true;
                        wrapper.userData.isPencilLine = Boolean(data.isPencilLine);
                        wrapper.userData.pencilPoints = data.pencilPoints;
                        if (data.pencilShapes) wrapper.userData.pencilShapes = data.pencilShapes;
                        if (data.convertedFrom) wrapper.userData.convertedFrom = data.convertedFrom;
                    }
                }
            } else if (data.icon === 'square') {
                const shape = new THREE.Shape(); shape.moveTo(-5, -5); shape.lineTo(5, -5); shape.lineTo(5, 5); shape.lineTo(-5, 5); shape.lineTo(-5, -5);
                const geo = new THREE.ShapeGeometry(shape); 
                geo.userData.shapesData = [{ shapes: [shape], offsetX: 0, offsetY: 0 }];
                geo.userData.tX = 0; geo.userData.tY = 0;
                spawnLoadedVectorMesh(geo, data);
            } else if (data.icon === 'circle') {
                const shape = new THREE.Shape(); shape.absarc(0, 0, 5, 0, Math.PI * 2, false);
                const geo = new THREE.ShapeGeometry(shape); 
                geo.userData.shapesData = [{ shapes: [shape], offsetX: 0, offsetY: 0 }];
                geo.userData.tX = 0; geo.userData.tY = 0;
                spawnLoadedVectorMesh(geo, data);
            } else if (data.icon === 'triangle') {
                const shape = new THREE.Shape(); shape.moveTo(0, 5); shape.lineTo(4.33, -2.5); shape.lineTo(-4.33, -2.5); shape.lineTo(0, 5);
                const geo = new THREE.ShapeGeometry(shape); 
                geo.userData.shapesData = [{ shapes: [shape], offsetX: 0, offsetY: 0 }];
                geo.userData.tX = 0; geo.userData.tY = 0;
                spawnLoadedVectorMesh(geo, data);
            } else if (data.icon === 'map-pin') {
                const shape = new THREE.Shape(); 
                shape.moveTo(0, -5); 
                shape.quadraticCurveTo(4, -1, 4, 2);
                shape.absarc(0, 2, 4, 0, Math.PI, false); 
                shape.quadraticCurveTo(-4, -1, 0, -5);
                const hole = new THREE.Path();
                hole.absarc(0, 2, 1.5, 0, Math.PI * 2, true);
                shape.holes.push(hole);
                const geo = new THREE.ShapeGeometry(shape); 
                geo.userData.shapesData = [{ shapes: [shape], offsetX: 0, offsetY: 0 }];
                geo.userData.tX = 0; geo.userData.tY = 0;
                spawnLoadedVectorMesh(geo, data);
            }
        }
        updateVectorsOrder();
        // Пересобираем только добавленное и всё выше самого нижнего нового:
        // новые всегда сверху, нижние от них не зависят — их не трогаем.
        // Ничего не добавилось — пересобирать нечего.
        const inserted = vectorState.objects.filter(o => !hadObjects.has(o));
        if (inserted.length > 0 && window.rebuildVectorPseudoTransparencyAsync) {
            const minIdx = Math.min.apply(null, inserted.map(o => vectorState.objects.indexOf(o)).filter(i => i >= 0).concat([0]));
            const affected = vectorState.objects.slice(0, Math.max(0, minIdx) + 1);
            // Плашку «Псевдо» показываем, только если реально долго (>600мс),
            // иначе она лишь мелькает поверх мгновенной сборки.
            const __pt0 = Date.now();
            let __pshown = false;
            await window.rebuildVectorPseudoTransparencyAsync(showProgress ? (done, total) => {
                if (__pshown || Date.now() - __pt0 > 600) {
                    __pshown = true;
                    window.showLoading?.(window.t("Псевдо-прозрачность...", "Pseudo-transparency...", "Псевдо-прозорість..."), `${done}/${total}`);
                }
            } : null, affected);
        }
        } catch (err) {
            console.error('[loadVectorsFromJSON]', err);
            throw err;
        } finally {
            if (showProgress && window.hideLoading) { try { window.hideLoading(); } catch (e) {} }
        }
    };

    function spawnLoadedVectorMesh(geometry, data) {
        const material = new THREE.MeshBasicMaterial({ color: data.color || 0xffffff, side: THREE.DoubleSide, transparent: false, opacity: data.opacity ?? 1, depthWrite: true, alphaTest: 0.01 });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.frustumCulled = false;
        mesh.renderOrder = data.isText ? 1001 : 999;
        mesh.userData.pseudoOpacity = data.opacity ?? 1;
        
        if (data.isText) {
            mesh.userData.isText = true;
            mesh.userData.text = data.text;
            mesh.userData.quality = data.quality || 12;
            mesh.userData.font = vectorState.loadedFont;
            mesh.userData.textLineHeight = data.textLineHeight || 1.2;
        }

        const group = new THREE.Group();
        group.uuid = data.uuid || THREE.MathUtils.generateUUID();
        group.add(mesh);
        group.name = data.name;
        group.userData.icon = data.icon;
        if (data.isPencil) {
            group.userData.isPencil = true;
            group.userData.isPencilLine = Boolean(data.isPencilLine);
            group.userData.pencilPoints = data.pencilPoints;
            group.userData.lineWidth = data.lineWidth || 2;
            group.userData.linePattern = data.linePattern || 'solid';
        }
        
        if (data.isText) group.userData.textAlign = data.textAlign || 'center';
        
        applyTransformAndProperties(group, data);
        // Дебаунс схлопывает пачку при массовой загрузке; поздние объекты
        // (текст после шрифта) тоже получают свою пересборку.
        if (window.scheduleSinglePseudoRebuild) window.scheduleSinglePseudoRebuild(group);
        return group;
    }
    
    function applyTransformAndProperties(wrapper, data) {
        wrapper.position.set(data.position.x, data.position.y, data.position.z);
        wrapper.rotation.set(data.rotation.x, data.rotation.y, data.rotation.z);
        wrapper.scale.set(data.scale.x, data.scale.y, 1);
        wrapper.renderOrder = 999;
        wrapper.userData.strokePattern = data.strokePattern || 'solid';
        wrapper.userData.strokeCap = data.strokeCap || 'round';
        wrapper.userData.strokeDash = data.strokeDash ?? 10;
        wrapper.userData.strokeGap = data.strokeGap ?? 6;
        wrapper.userData.strokeDot = data.strokeDot ?? 8;
        wrapper.userData.strokeUseAlpha = data.strokeUseAlpha ?? false;
        if (data.circleOutline && typeof data.circleOutline === 'object') {
            wrapper.userData.circleOutline = {
                gap: Number.isFinite(data.circleOutline.gap) ? Math.min(1, Math.max(0, data.circleOutline.gap)) : 0,
                width: Number.isFinite(data.circleOutline.width) ? Math.min(1.5, Math.max(0.05, data.circleOutline.width)) : 0.29
            };
        }
        if (data.strokeHoles) wrapper.userData.strokeHoles = JSON.parse(JSON.stringify(data.strokeHoles));
        wrapper.position.z = data.isText ? 30 : 20;

        if (!data.isSvg || data.styleOverridden) {
            getMeshes(wrapper, false).forEach(mesh => {
                if (data.color && mesh.material && mesh.material.color) mesh.material.color.set(data.color);
                if (data.opacity !== undefined && mesh.material) {
                    if (mesh.userData.isText) {
                        mesh.userData.textOpacity = data.opacity;
                        mesh.userData.pseudoOpacity = 1;
                        mesh.material.opacity = data.opacity;
                        mesh.material.transparent = data.opacity < 1;
                    } else {
                        mesh.userData.pseudoOpacity = data.opacity;
                        mesh.material.opacity = 1;
                        mesh.material.transparent = false;
                    }
                }
            });
        }
        
        wrapper.userData.fillEnabled = data.fillEnabled !== false;
        wrapper.userData.layerGroup = data.layerGroup || null;
        wrapper.userData.fillPattern = data.fillPattern || 'solid';
        wrapper.userData.fillPatternSpacing = (Number.isFinite(data.fillPatternSpacing) && data.fillPatternSpacing > 0) ? data.fillPatternSpacing : null;
        wrapper.userData.fillPatternThickness = (Number.isFinite(data.fillPatternThickness) && data.fillPatternThickness > 0) ? data.fillPatternThickness : null;
        getMeshes(wrapper, false).forEach(mesh => {
            mesh.userData.fillHidden = data.fillEnabled === false;
            mesh.visible = data.fillEnabled !== false;
        });

        if (data.hasStroke) {
            getMeshes(wrapper, false).forEach(firstMesh => {
              if (firstMesh.geometry && firstMesh.geometry.userData.shapesData) {
                firstMesh.renderOrder = firstMesh.userData.isText ? 1001 : 999; firstMesh.position.z = 0.005;
                const loadIsCircle = wrapper.userData.icon === 'circle' && !wrapper.userData.isPencil && !wrapper.userData.isSvg && !firstMesh.userData.isText && window.GeometryUtils;
                const effLoadPattern = (window.STROKE_PATTERNS || []).includes(data.strokePattern) ? data.strokePattern : 'solid';
                if (loadIsCircle) {
                    const coLoad = normalizeCircleOutline(wrapper.userData.circleOutline);
                    const built = buildCircleStroke(firstMesh, effLoadPattern, coLoad.gap, coLoad.width, firstMesh.userData.quality || 12, data.strokeCap || 'round', data.strokeColor);
                    if (built) {
                        built.userData.isStroke = true;
                        built.userData.strokeWidth = data.strokeWidth;
                        built.userData.strokePattern = effLoadPattern;
                        built.userData.strokeCap = data.strokeCap || 'round';
                        built.userData.strokeDash = data.strokeDash ?? 10;
                        built.userData.strokeGap = data.strokeGap ?? 6;
                        built.userData.strokeDot = data.strokeDot ?? 8;
                        built.userData.circleGap = coLoad.gap;
                        built.userData.circleWidth = coLoad.width;
                        built.userData.strokeUseAlpha = data.strokeUseAlpha ?? false;
                        built.userData.pseudoOpacity = (data.strokeUseAlpha ?? false) ? (data.opacity ?? 1) : 1;
                        built.userData.quality = firstMesh.userData.quality || 12;
                        built.userData.parentMeshId = firstMesh.uuid;
                        built.position.z = 0.015;
                        built.renderOrder = 998;
                        firstMesh.parent.add(built);
                    }
                } else {
                const pScale = pencilStrokeFactor(wrapper, firstMesh);
                const strokeGeo = generateStrokeGeometry(firstMesh.geometry.userData.shapesData, (data.strokeWidth * 0.1) * pScale, firstMesh.userData.quality || 12, effLoadPattern, ((data.strokeDash ?? 10) * 0.1) * pScale, ((data.strokeGap ?? 6) * 0.1) * pScale, ((data.strokeDot ?? 8) * 0.1) * pScale, data.strokeCap || 'round');
                if (strokeGeo) {
                    const strokeUseAlpha = data.strokeUseAlpha ?? false;
                    const restoredOpacity = strokeUseAlpha ? (data.opacity ?? 1) : 1;
                    const strokeMesh = new THREE.Mesh(strokeGeo, new THREE.MeshBasicMaterial({ color: data.strokeColor, opacity: 1, transparent: false, depthWrite: true, alphaTest: 0.01 }));
                    if (firstMesh.userData.isText) strokeMesh.material.side = THREE.DoubleSide;
                    strokeMesh.userData.isStroke = true;
                    strokeMesh.frustumCulled = false;
                    strokeMesh.userData.strokeWidth = data.strokeWidth;
                    strokeMesh.userData.strokePattern = effLoadPattern;
                    strokeMesh.userData.strokeCap = data.strokeCap || 'round';
                    strokeMesh.userData.strokeDash = data.strokeDash ?? 10;
                    strokeMesh.userData.strokeGap = data.strokeGap ?? 6;
                    strokeMesh.userData.strokeDot = data.strokeDot ?? 8;
                    strokeMesh.userData.strokeUseAlpha = strokeUseAlpha;
                    strokeMesh.userData.pseudoOpacity = restoredOpacity;
                    strokeMesh.userData.quality = firstMesh.userData.quality || 12;
                    strokeMesh.userData.parentMeshId = firstMesh.uuid;
                    
                    strokeMesh.position.z = 0.015;
                    strokeMesh.renderOrder = 998;
                    
                    const tX = firstMesh.geometry.userData.tX || 0;
                    const tY = firstMesh.geometry.userData.tY || 0;
                    strokeMesh.geometry.translate(tX, tY, 0);
                    const restoreHoleKey = String(Math.max(0, getMeshes(wrapper, false).indexOf(firstMesh)));
                    const restoreHoleList = (wrapper.userData.strokeHoles && wrapper.userData.strokeHoles[restoreHoleKey]) || [];
                    const restoreHoledGeo = applyStrokeHoles(strokeMesh.geometry, restoreHoleList);
                    if (!restoreHoledGeo) {
                        disposeObject3D(strokeMesh);
                    } else {
                        if (restoreHoledGeo !== strokeMesh.geometry) strokeMesh.geometry = restoreHoledGeo;
                        firstMesh.parent.add(strokeMesh);
                    }
                    }
                }
              }
            });
        }
        
        scene.add(wrapper);
        vectorState.objects.unshift(wrapper);
        // Без поштучной пересборки: в конце загрузки всё пересоберётся разом
        // снизу вверх (иначе двойная работа на тяжёлых фигурах).
        
        if (vectorState.pendingSelectId === wrapper.uuid) {
            selectObject(wrapper);
            vectorState.pendingSelectId = null;
        }

        if (window.updateExportState) window.updateExportState();
        if (window.requestSceneRender) window.requestSceneRender();
    }
});
