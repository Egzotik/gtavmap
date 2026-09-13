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
function getStrokeMeshes(object) { return getMeshes(object, true).filter(mesh => mesh.userData.isStroke); }

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
    if (Math.abs(referenceSide) < 1e-8) return poly;
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

function rebuildPseudoTransparency(wrapper) {
    if (!wrapper) return;
    removePseudoTransparency(wrapper);
    wrapper.traverse(child => {
        if (child.isMesh && !child.userData.isPseudoTransparency) child.visible = !child.userData.fillHidden;
    });

    const mapCache = getCachedMapTriangles();
    if (mapCache.tris.length === 0) return;

    const pseudoSources = [];
    wrapper.traverse(child => {
        if (child.isMesh && !child.userData.isPseudoTransparency && !child.userData.isText) pseudoSources.push(child);
    });
    pseudoSources.forEach(sourceMesh => {
        const opacity = sourceMesh.userData.pseudoOpacity ?? sourceMesh.material?.opacity ?? 1;
        if (!sourceMesh.visible || !sourceMesh.geometry || !sourceMesh.material || opacity >= 0.999) return;
        const positions = sourceMesh.geometry.attributes.position;
        if (!positions) return;
        sourceMesh.updateMatrixWorld(true);
        const index = sourceMesh.geometry.index;
        const count = index ? index.count : positions.count;
        const sourceTriangles = [];
        for (let i = 0; i + 2 < count; i += 3) {
            const ids = index ? [index.getX(i), index.getX(i + 1), index.getX(i + 2)] : [i, i + 1, i + 2];
            sourceTriangles.push(ids.map(id => new THREE.Vector3(positions.getX(id), positions.getY(id), positions.getZ(id)).applyMatrix4(sourceMesh.matrixWorld)));
        }

        const layerOutputs = new Map();
        const outputForLayer = (zLayer) => {
            let bucket = layerOutputs.get(zLayer);
            if (!bucket) { bucket = { positions: [], colors: [] }; layerOutputs.set(zLayer, bucket); }
            return bucket;
        };
        const figureColor = sourceMesh.material.color || new THREE.Color(1, 1, 1);
        let sourceBaseZ = -Infinity;
        sourceTriangles.forEach(triangle => triangle.forEach(vertex => { if (vertex.z > sourceBaseZ) sourceBaseZ = vertex.z; }));
        sourceBaseZ += 0.1;
        sourceTriangles.forEach(figure => {
            const minX = Math.min(figure[0].x, figure[1].x, figure[2].x);
            const maxX = Math.max(figure[0].x, figure[1].x, figure[2].x);
            const minY = Math.min(figure[0].y, figure[1].y, figure[2].y);
            const maxY = Math.max(figure[0].y, figure[1].y, figure[2].y);
            if (Math.abs(triArea2(figure[0], figure[1], figure[2])) < 1e-9) return;
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
            for (let i = 1; i < polygon.length - 1; i++) {
                const triPts = [polygon[0], polygon[i], polygon[i + 1]];
                const ccx = (triPts[0].x + triPts[1].x + triPts[2].x) / 3;
                const ccy = (triPts[0].y + triPts[1].y + triPts[2].y) / 3;
                const cw = barycentric2d(figure[0], figure[1], figure[2], { x: ccx, y: ccy });
                if (cw[0] < -1e-6 || cw[1] < -1e-6 || cw[2] < -1e-6) continue;
                triPts.forEach(point => {
                    const weights = barycentric2d({ x: map.x0, y: map.y0 }, { x: map.x1, y: map.y1 }, { x: map.x2, y: map.y2 }, point);
                    const mapColor = [mr[0] * weights[0] + mr[1] * weights[1] + mr[2] * weights[2], mg[0] * weights[0] + mg[1] * weights[1] + mg[2] * weights[2], mb[0] * weights[0] + mb[1] * weights[1] + mb[2] * weights[2]];
                    const color = [figureColor.r * opacity + mapColor[0] * (1 - opacity), figureColor.g * opacity + mapColor[1] * (1 - opacity), figureColor.b * opacity + mapColor[2] * (1 - opacity)];
                    const sourceLayerOffset = sourceMesh.userData.isStroke ? 0.002 : 0;
                    const worldPoint = new THREE.Vector3(point.x, point.y, sourceBaseZ + map.zLayer * 0.05 + sourceLayerOffset);
                    const localPoint = wrapper.worldToLocal(worldPoint);
                    const bucket = outputForLayer(map.zLayer);
                    bucket.positions.push(localPoint.x, localPoint.y, localPoint.z);
                    bucket.colors.push(color[0], color[1], color[2]);
                });
            }
            });
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
                cutout.renderOrder = 990 + Math.min(zLayer, 90) * 0.01;
                wrapper.add(cutout);
            });
            sourceMesh.visible = false;
        }
    });
}

window.rebuildVectorPseudoTransparency = function() {
    vectorState.objects.forEach(rebuildPseudoTransparency);
};

let singleRebuildTimer = null;
const singleRebuildTargets = new Set();
window.scheduleSinglePseudoRebuild = function(wrapper) {
    if (wrapper) {
        if (Array.isArray(wrapper)) wrapper.forEach(w => singleRebuildTargets.add(w));
        else singleRebuildTargets.add(wrapper);
    }
    if (singleRebuildTimer !== null) return;
    singleRebuildTimer = setTimeout(() => {
        singleRebuildTimer = null;
        const targets = Array.from(singleRebuildTargets);
        singleRebuildTargets.clear();
        targets.forEach(target => rebuildPseudoTransparency(target));
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
        if (!input || !obj) return;
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
        }
    });

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
        });
        renderLayersList();
        if (window.requestSceneRender) window.requestSceneRender();
    }
    window.updateVectorsOrder = updateVectorsOrder;

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
                        const n = Math.max(1, Math.round(totalLen / stepLen));
                        const step = totalLen / n;
                        for (let k = 0; k < n; k++) {
                            const p = pointAt((k + 0.5) * step);
                            const dot = new THREE.CircleGeometry(dotDiameter / 2, 12);
                            dot.translate(p.x + offsetX, p.y + offsetY, 0);
                            strokeGeometries.push(dot);
                        }
                        return;
                    }

                    if (strokePattern === 'dashed') {
                        const period = dashLength + gapLength;
                        const n = Math.max(1, Math.round(totalLen / period));
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
        if (obj && vectorState.activeObj !== obj) {
            const idx = vectorState.objects.indexOf(obj);
            if (idx > 0) {
                vectorState.objects.splice(idx, 1);
                vectorState.objects.unshift(obj);
                updateVectorsOrder();
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

            const lineTools = document.getElementById('vecLineTools');
            const linePatternTools = document.getElementById('vecLinePatternTools');
            const isPencilLine = Boolean(obj.userData.isPencilLine);
            if (lineTools) lineTools.classList.toggle('hidden', !isPencilLine);
            if (linePatternTools) linePatternTools.classList.toggle('hidden', !isPencilLine);
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
                    document.getElementById('vecPropStrokeAlpha').checked = strokeMesh.userData.strokeUseAlpha ?? obj.userData.strokeUseAlpha ?? true;
                }
                syncStrokePatternUI();
            }
        } else {
            transformControl.detach();
            document.getElementById('vectorPropsPanel').classList.add('hidden');
            document.getElementById('vecLineTools')?.classList.add('hidden');
            document.getElementById('vecLinePatternTools')?.classList.add('hidden');
            document.getElementById('vecStrokePatternTools')?.classList.add('hidden');
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
        const current = getObjectWorldRadius(obj);
        if (current < 1e-9) return;
        recordVectorUndoState(true);
        const k = target / current;
        obj.scale.x *= k;
        obj.scale.y *= k;
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

    function syncStrokePatternUI() {
        const pattern = document.getElementById('vecPropStrokePattern')?.value || 'solid';
        const hasStroke = document.getElementById('vecPropStroke')?.checked;
        document.getElementById('vecStrokePatternTools')?.classList.toggle('hidden', !hasStroke);
        document.getElementById('vecStrokeDashRow')?.classList.toggle('hidden', pattern !== 'dashed');
        document.getElementById('vecStrokeGapRow')?.classList.toggle('hidden', pattern === 'solid');
        document.getElementById('vecStrokeDotRow')?.classList.toggle('hidden', pattern !== 'dotted');
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
        const strokeWidth = parseFloat(document.getElementById('vecPropStrokeWidthNum').value) || 10;
        const strokePattern = document.getElementById('vecPropStrokePattern')?.value || 'solid';
        const strokeCap = document.getElementById('vecPropStrokeCap')?.value || 'round';
        const strokeDash = parseFloat(document.getElementById('vecStrokeDash')?.value) || 10;
        const strokeGap = parseFloat(document.getElementById('vecStrokeGap')?.value) || 6;
        const strokeDot = parseFloat(document.getElementById('vecStrokeDotSize')?.value) || 8;
        const strokeUseAlpha = document.getElementById('vecPropStrokeAlpha')?.checked !== false;
        const fillEnabled = document.getElementById('vecPropFill')?.checked !== false;
        const scaleVal = parseFloat(document.getElementById('vecPropScaleNum').value) || 1;
        const rotVal = parseFloat(document.getElementById('vecPropRotNum').value) || 0;
        const qualityVal = parseInt(document.getElementById('vecPropQualityNum').value) || 12;
        const textVal = document.getElementById('vecPropTextValue').value;
        const lineHeightVal = parseFloat(document.getElementById('vecLineHeight') ? document.getElementById('vecLineHeight').value : 1.2) || 1.2;
        const lineWidthVal = parseFloat(document.getElementById('vecLineWidthNum')?.value) || 2;
        const linePatternVal = document.getElementById('vecLinePattern')?.value || 'solid';

        document.getElementById('vecPropStrokeTools').classList.toggle('hidden', !useStroke);
        syncStrokePatternUI();

        const obj = vectorState.activeObj;
        if (obj.userData.isSvg && markStyleOverride) obj.userData.styleOverridden = true;
        obj.userData.strokePattern = strokePattern;
        obj.userData.strokeCap = strokeCap;
        obj.userData.strokeDash = strokeDash;
        obj.userData.strokeGap = strokeGap;
        obj.userData.strokeDot = strokeDot;
        obj.userData.strokeUseAlpha = strokeUseAlpha;
        obj.userData.fillEnabled = fillEnabled;

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
                    mesh.material.opacity = 1;
                    mesh.material.transparent = false;
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
                if (!strokeMesh || strokeMesh.userData.strokeWidth !== strokeWidth || strokeMesh.userData.strokePattern !== strokePattern || strokeMesh.userData.strokeDash !== strokeDash || strokeMesh.userData.strokeGap !== strokeGap || strokeMesh.userData.strokeDot !== strokeDot || strokeMesh.userData.strokeCap !== strokeCap || forceRebuildStroke) {
                    const strokeGeo = generateStrokeGeometry(mesh.geometry.userData.shapesData, strokeWidth * 0.1, qualityVal, strokePattern, strokeDash * 0.1, strokeGap * 0.1, strokeDot * 0.1, strokeCap);
                    if (strokeGeo) {
                        if (!strokeMesh) {
                            strokeMesh = new THREE.Mesh(strokeGeo, new THREE.MeshBasicMaterial({ color: strokeHex, depthWrite: true, alphaTest: 0.01 }));
                            strokeMesh.userData.isStroke = true;
                            strokeMesh.frustumCulled = false;
                            strokeMesh.userData.parentMeshId = mesh.uuid;
                            mesh.parent.add(strokeMesh);
                        } else { strokeMesh.geometry.dispose(); strokeMesh.geometry = strokeGeo; }
                        strokeMesh.userData.strokeWidth = strokeWidth;
                        strokeMesh.userData.strokePattern = strokePattern;
                        strokeMesh.userData.strokeCap = strokeCap;
                        strokeMesh.userData.strokeDash = strokeDash;
                        strokeMesh.userData.strokeGap = strokeGap;
                        strokeMesh.userData.strokeDot = strokeDot;
                        strokeMesh.userData.quality = qualityVal;

                        const tX = mesh.geometry.userData.tX || 0;
                        const tY = mesh.geometry.userData.tY || 0;
                        strokeMesh.geometry.translate(tX, tY, 0);
                        const holeKey = String(Math.max(0, primaryMeshes.indexOf(mesh)));
                        const holeList = (obj.userData.strokeHoles && obj.userData.strokeHoles[holeKey]) || [];
                        const holedGeo = applyStrokeHoles(strokeMesh.geometry, holeList);
                        if (!holedGeo) {
                            if (strokeMesh.parent) strokeMesh.parent.remove(strokeMesh);
                            disposeObject3D(strokeMesh);
                            strokeMesh = null;
                        } else if (holedGeo !== strokeMesh.geometry) {
                            strokeMesh.geometry = holedGeo;
                        }
                    }
                }
                if (strokeMesh) {
                    strokeMesh.material.color.set(strokeHex);
                    strokeMesh.userData.strokeUseAlpha = strokeUseAlpha;
                    strokeMesh.userData.pseudoOpacity = strokeUseAlpha ? alpha : 1;
                    strokeMesh.material.opacity = 1;
                    strokeMesh.material.transparent = false;
                    strokeMesh.position.z = -0.005; // Фикс z-offset для обводки
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
            cloneData.position.x += 50; 
            cloneData.position.y -= 50;
            cloneData.name = cloneData.name + " (Копия)";
            
            vectorState.pendingSelectId = cloneData.uuid;
            window.loadVectorsFromJSON([cloneData]); 
            window.showToast("Слой скопирован", "success");
        }
    }

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
        });
        if (window.lucide) window.lucide.createIcons();
    }

    function spawnVectorMesh(geometry, name, icon, isText = false, textContent = '', defaultScale = 1, posX = null, posY = null) {
        recordVectorUndoState(true);
        const material = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 1, depthWrite: true, alphaTest: 0.01 });
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

    function rebuildStrokeWithHoles(obj, strokeMesh) {
        const primaries = getMeshes(obj, false);
        const parent = primaries.find(m => m.uuid === strokeMesh.userData.parentMeshId) || primaries[0];
        if (!parent || !parent.geometry.userData.shapesData) return false;
        const u = strokeMesh.userData;
        const pi = Math.max(0, primaries.indexOf(parent));
        const holes = (obj.userData.strokeHoles && obj.userData.strokeHoles[String(pi)]) || [];
        let g = generateStrokeGeometry(parent.geometry.userData.shapesData, (u.strokeWidth || 10) * 0.1, u.quality || parent.userData.quality || 12, u.strokePattern || 'solid', (u.strokeDash ?? 10) * 0.1, (u.strokeGap ?? 6) * 0.1, (u.strokeDot ?? 8) * 0.1, u.strokeCap || 'round');
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
        } else if (pattern === 'dotted') {
            const radius = width / 2;
            for (let i = 0; i < points.length - 1; i++) {
                const distance = points[i].distanceTo(points[i + 1]);
                const steps = Math.max(1, Math.ceil(distance / Math.max(width * 3, 1)));
                for (let step = 0; step < steps; step++) {
                    const point = points[i].clone().lerp(points[i + 1], (step + 0.5) / steps);
                    const geometry = new THREE.CircleGeometry(radius, 12);
                    geometry.translate(point.x, point.y, 0);
                    geometries.push(geometry);
                }
            }
        } else {
            const dashLength = Math.max(width * 5, 5);
            const gapLength = Math.max(width * 3, 3);
            let drawRemaining = dashLength;
            let gapRemaining = 0;
            for (let i = 0; i < points.length - 1; i++) {
                const start = points[i], end = points[i + 1];
                const direction = end.clone().sub(start);
                const segmentLength = direction.length();
                if (segmentLength === 0) continue;
                direction.normalize();
                let offset = 0;
                while (offset < segmentLength) {
                    const amount = Math.min(drawRemaining > 0 ? drawRemaining : gapRemaining, segmentLength - offset);
                    if (drawRemaining > 0) addStroke([start.clone().addScaledVector(direction, offset), start.clone().addScaledVector(direction, offset + amount)]);
                    offset += amount;
                    if (drawRemaining > 0) { drawRemaining -= amount; if (drawRemaining <= 0) gapRemaining = gapLength; }
                    else { gapRemaining -= amount; if (gapRemaining <= 0) drawRemaining = dashLength; }
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

        function processAndInject(trianglesArray, tileNameSuffix) {
            if (trianglesArray.length === 0) return;
            trianglesArray.sort((a, b) => a.z - b.z);
            const tiles = {};

            trianglesArray.forEach(tri => {
                const v1 = tri.v1, v2 = tri.v2, v3 = tri.v3;
                const tMinX = Math.min(v1.x, v2.x, v3.x), tMaxX = Math.max(v1.x, v2.x, v3.x);
                const tMinY = Math.min(v1.y, v2.y, v3.y), tMaxY = Math.max(v1.y, v2.y, v3.y);

                const startGridX = Math.max(0, Math.floor((tMinX - startX) / stepX));
                const endGridX = Math.min(7, Math.floor((tMaxX - startX) / stepX));
                const startGridY = Math.max(0, Math.floor((topY - tMaxY) / stepY));
                const endGridY = Math.min(8, Math.floor((topY - tMinY) / stepY));

                for (let gx = startGridX; gx <= endGridX; gx++) {
                    for (let gy = startGridY; gy <= endGridY; gy++) {
                        const cellMinX = startX + gx * stepX;
                        const cellMaxX = cellMinX + stepX;
                        const cellMaxY = topY - gy * stepY;
                        const cellMinY = cellMaxY - stepY;

                        if (tMaxX < cellMinX || tMinX > cellMaxX || tMaxY < cellMinY || tMinY > cellMaxY) continue;

                        const clippedPoly = clipTriangleToCell(v1, v2, v3, cellMinX, cellMaxX, cellMinY, cellMaxY);

                        if (clippedPoly.length >= 3 && calcPolyArea(clippedPoly) > 1e-6) {
                            const tileKey = `${gx}_${gy}`;
                            if (!tiles[tileKey]) {
                                tiles[tileKey] = { 
                                    gx: gx, gy: gy, 
                                    vertices: [], indices: [], vertexMap: new Map(),
                                    minX: Infinity, minY: Infinity, minZ: Infinity, 
                                    maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity
                                };
                            }
                            const tile = tiles[tileKey];
                            const addVertex = (v) => {
                                const vStr = `                ${v.x.toFixed(7)} ${v.y.toFixed(7)} ${v.z.toFixed(7)}   ${Math.round(v.r)} ${Math.round(v.g)} ${Math.round(v.b)} ${Math.round(v.a)}`;
                                if (tile.vertexMap.has(vStr)) return tile.vertexMap.get(vStr);
                                const newIdx = tile.vertices.length; 
                                tile.vertices.push(vStr); 
                                tile.vertexMap.set(vStr, newIdx);

                                if(v.x < tile.minX) tile.minX = v.x; if(v.x > tile.maxX) tile.maxX = v.x;
                                if(v.y < tile.minY) tile.minY = v.y; if(v.y > tile.maxY) tile.maxY = v.y;
                                if(v.z < tile.minZ) tile.minZ = v.z; if(v.z > tile.maxZ) tile.maxZ = v.z;

                                return newIdx;
                            };
                            const idx0 = addVertex(clippedPoly[0]);
                            for (let pt = 1; pt < clippedPoly.length - 1; pt++) {
                                tile.indices.push(idx0, addVertex(clippedPoly[pt]), addVertex(clippedPoly[pt+1]));
                            }
                        }
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
                        const vb = targetLayerItem.querySelector('VertexBuffer');
                        if (vb) {
                            const ib = targetLayerItem.querySelector('IndexBuffer');
                            const vDataNode = vb.querySelector('Data2') || vb.querySelector('Data');
                            const iDataNode = ib ? (ib.querySelector('Data2') || ib.querySelector('Data')) : null;
                            if (!vDataNode || !iDataNode) throw new Error(`${targetFileName}: ${fullItemName} не содержит полные VertexBuffer/IndexBuffer`);
                            
                            const geomItem = vb.closest('Item') || vb.closest('Geometry');
                            const mergeResult = window.GeometryUtils.applyYddGeometryMerge(vDataNode, iDataNode, geomItem, t.vertices, t.indices);
                            geometryChanged = mergeResult.addedTriangleCount > 0;
                        } else {
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

        let shapeTriangles = [];
        let textTriangles = [];

        vectorState.objects.forEach(wrapper => {
            let isTextWrapper = false;
            wrapper.traverse((c) => {
                if (c.isMesh && c.userData && c.userData.isText) isTextWrapper = true;
            });

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

                    for (let i = 0; i < faceCount; i++) {
                        let idx1 = indexAttr ? indexAttr.getX(i * 3) : i * 3;
                        let idx2 = indexAttr ? indexAttr.getX(i * 3 + 1) : i * 3 + 1;
                        let idx3 = indexAttr ? indexAttr.getX(i * 3 + 2) : i * 3 + 2;

                        if (flipWinding) {
                            let temp = idx2; idx2 = idx3; idx3 = temp;
                        }

                        const v1 = getVertex(idx1), v2 = getVertex(idx2), v3 = getVertex(idx3);
                        const avgZ = (v1.z + v2.z + v3.z) / 3;

                        if (isTextWrapper) {
                            textTriangles.push({ v1, v2, v3, z: avgZ });
                        } else {
                            shapeTriangles.push({ v1, v2, v3, z: avgZ });
                        }
                    }
                    geo.dispose();
                }
            });
        });

        let allMclTriangles = [];
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
                        allMclTriangles.push({ v1, v2, v3, z: (v1.z + v2.z + v3.z)/3 });
                    }
                });
            });
        }

        // ТЕСТОВЫЙ РЕЖИМ: сливаем вообще всю кастомную геометрию (фигуры, MCL, текст) в один массив
        const allTrianglesFor2_2 = allMclTriangles.concat(shapeTriangles).concat(textTriangles);

        // Инжектим всё исключительно в слой tile_2_2
        processAndInject(allTrianglesFor2_2, 'tile_2_2');
        
        return modifiedCount;
    };
    
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
                fillEnabled: obj.userData.fillEnabled !== false
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
                    data.strokeUseAlpha = strokeMesh.userData.strokeUseAlpha ?? obj.userData.strokeUseAlpha ?? true;
                    if (obj.userData.strokeHoles) data.strokeHoles = JSON.parse(JSON.stringify(obj.userData.strokeHoles));
                }
            }
            return data;
        });
    };
    
    window.loadVectorsFromJSON = async function(vectorsData, showProgress = false) {
        if (!vectorsData || !Array.isArray(vectorsData)) return;

        for (let vectorIndex = 0; vectorIndex < vectorsData.length; vectorIndex++) {
            const data = vectorsData[vectorIndex];
            if (showProgress && window.yieldToBrowser) {
                window.showLoading?.(window.t("Восстановление слоёв...", "Restoring layers...", "Відновлення шарів..."), `${vectorIndex + 1}/${vectorsData.length}`);
                await window.yieldToBrowser();
            }
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
            } else if (data.isPencil && data.pencilPoints && data.pencilPoints.length >= (data.isPencilLine ? 2 : 3)) {
                const geo = data.isPencilLine ? createPencilLineFromPoints(data.pencilPoints, data.lineWidth || 2, data.linePattern || 'solid') : createPencilShapeFromPoints(data.pencilPoints);
                if (geo) {
                    const wrapper = spawnLoadedVectorMesh(geo, data);
                    if (wrapper) {
                        wrapper.userData.isPencil = true;
                        wrapper.userData.isPencilLine = Boolean(data.isPencilLine);
                        wrapper.userData.pencilPoints = data.pencilPoints;
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
        wrapper.userData.strokeUseAlpha = data.strokeUseAlpha ?? true;
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
        getMeshes(wrapper, false).forEach(mesh => {
            mesh.userData.fillHidden = data.fillEnabled === false;
            mesh.visible = data.fillEnabled !== false;
        });

        if (data.hasStroke) {
            getMeshes(wrapper, false).forEach(firstMesh => {
              if (firstMesh.geometry && firstMesh.geometry.userData.shapesData) {
                firstMesh.renderOrder = firstMesh.userData.isText ? 1001 : 999; firstMesh.position.z = 0.005;
                const strokeGeo = generateStrokeGeometry(firstMesh.geometry.userData.shapesData, data.strokeWidth * 0.1, firstMesh.userData.quality || 12, data.strokePattern || 'solid', (data.strokeDash ?? 10) * 0.1, (data.strokeGap ?? 6) * 0.1, (data.strokeDot ?? 8) * 0.1, data.strokeCap || 'round');
                if (strokeGeo) {
                    const strokeUseAlpha = data.strokeUseAlpha ?? true;
                    const restoredOpacity = strokeUseAlpha ? (data.opacity ?? 1) : 1;
                    const strokeMesh = new THREE.Mesh(strokeGeo, new THREE.MeshBasicMaterial({ color: data.strokeColor, opacity: 1, transparent: false, depthWrite: true, alphaTest: 0.01 }));
                    strokeMesh.userData.isStroke = true;
                    strokeMesh.frustumCulled = false;
                    strokeMesh.userData.strokeWidth = data.strokeWidth;
                    strokeMesh.userData.strokePattern = data.strokePattern || 'solid';
                    strokeMesh.userData.strokeCap = data.strokeCap || 'round';
                    strokeMesh.userData.strokeDash = data.strokeDash ?? 10;
                    strokeMesh.userData.strokeGap = data.strokeGap ?? 6;
                    strokeMesh.userData.strokeDot = data.strokeDot ?? 8;
                    strokeMesh.userData.strokeUseAlpha = strokeUseAlpha;
                    strokeMesh.userData.pseudoOpacity = restoredOpacity;
                    strokeMesh.userData.quality = firstMesh.userData.quality || 12;
                    strokeMesh.userData.parentMeshId = firstMesh.uuid;
                    
                    strokeMesh.position.z = -0.005;
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
            });
        }
        
        scene.add(wrapper);
        vectorState.objects.unshift(wrapper); 
        rebuildPseudoTransparency(wrapper);
        
        if (vectorState.pendingSelectId === wrapper.uuid) {
            selectObject(wrapper);
            vectorState.pendingSelectId = null;
        }

        if (window.updateExportState) window.updateExportState();
        if (window.requestSceneRender) window.requestSceneRender();
    }
});
