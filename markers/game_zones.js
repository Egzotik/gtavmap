(function(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.GameZones = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
    // Overlay reference layers (Majestic wiki). Only layers with `url` can be enabled.
    const GAME_ZONES = [
        { id: 'zz', titles: ['Зелёные зоны (ЗЗ)', 'Green zones (ZZ)', 'Зелені зони (ЗЗ)'], color: '#22c55e', icon: 'shield', url: 'markers/zz.json' },
        { id: 'red', titles: ['Красные зоны', 'Red zones', 'Червоні зони'], color: '#ef4444', icon: 'flame', url: 'markers/red.json' },
        { id: 'contraband', titles: ['Контрабанда (тайники)', 'Contraband (caches)', 'Контрабанда (схованки)'], color: '#f59e0b', icon: 'package', url: 'markers/contraband.json' },
        { id: 'gathering', titles: ['Собирательство', 'Gathering', 'Збиральництво'], color: '#a3e635', icon: 'leaf', url: 'markers/gathering.json' },
        { id: 'treasure', titles: ['Кладоискатель', 'Treasure hunter', 'Шукач скарбів'], color: '#facc15', icon: 'gem', url: 'markers/treasure.json', figureDefaults: { strokeWidth: 0.4 } },
        { id: 'rubbish', titles: ['Мусорные баки', 'Trash bins', 'Сміттєві баки'], color: '#eab308', icon: 'trash-2', url: 'markers/rubbish_points.json' },
        { id: 'phones', titles: ['Телефоны', 'Phones', 'Телефони'], color: '#34d399', icon: 'phone', url: 'markers/phones.json' },
        { id: 'custom', titles: ['Свои метки', 'Custom markers', 'Свої мітки'], color: '#f8fafc', icon: 'map-pin', custom: true, url: null }
    ];

    // Wiki CRS is rotated 90 degrees clockwise relative to game coordinates,
    // so points are rotated 90 degrees counter-clockwise about the origin: (x, y) -> (-y, x),
    // then mirrored horizontally about the map center (x = 200),
    // then nudged 200 units west to align with the map.
    const MAP_CENTER_X = 200;
    const SHIFT_X = -400;
    function wikiToGame(x, y) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return { x: 2 * MAP_CENTER_X + y + SHIFT_X, y: x };
    }

    function parseZonePoints(raw) {
        if (!Array.isArray(raw)) return [];
        const out = [];
        raw.forEach(item => {
            if (!item || typeof item !== 'object') return;
            let x, y, name;
            if (Array.isArray(item.point) && item.point.length >= 2) {
                x = Number(item.point[0]); y = Number(item.point[1]);
            } else if (item.x !== undefined || item.y !== undefined) {
                x = Number(item.x); y = Number(item.y);
            } else {
                return;
            }
            const g = wikiToGame(x, y);
            if (!g) return;
            name = typeof item.name === 'string' ? item.name : '';
            out.push({ x: g.x, y: g.y, name });
        });
        return out;
    }

    function snapPolygonVertices(polygons, tolerance) {
        const tol = Math.max(0, tolerance || 0);
        if (tol <= 0 || !Array.isArray(polygons) || polygons.length === 0) return polygons;
        const cell = tol;
        const grid = new Map();
        const anchors = [];
        const findAnchor = (x, y) => {
            const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
            for (let ix = cx - 1; ix <= cx + 1; ix++) for (let iy = cy - 1; iy <= cy + 1; iy++) {
                const arr = grid.get(ix + ':' + iy);
                if (!arr) continue;
                for (const idx of arr) {
                    const a = anchors[idx];
                    if (Math.abs(a.x - x) <= tol && Math.abs(a.y - y) <= tol && Math.hypot(a.x - x, a.y - y) <= tol) return a;
                }
            }
            return null;
        };
        return polygons.map(poly => {
            if (!poly || !Array.isArray(poly.points)) return poly;
            const pts = poly.points.map(p => {
                const a = findAnchor(p.x, p.y);
                if (a) return { x: a.x, y: a.y };
                const n = { x: p.x, y: p.y };
                const k = Math.floor(p.x / cell) + ':' + Math.floor(p.y / cell);
                if (!grid.has(k)) grid.set(k, []);
                grid.get(k).push(anchors.length);
                anchors.push(n);
                return n;
            });
            const clean = [];
            pts.forEach(p => {
                const last = clean[clean.length - 1];
                if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 1e-9) clean.push(p);
            });
            if (clean.length > 1) {
                const f = clean[0], l = clean[clean.length - 1];
                if (Math.hypot(f.x - l.x, f.y - l.y) <= 1e-9) clean.pop();
            }
            if (clean.length < 3) return poly;
            const out = Object.assign({}, poly);
            out.points = clean;
            return out;
        });
    }

    function parseZonePolygons(raw, tolerance) {
        if (!Array.isArray(raw)) return [];
        const out = [];
        raw.forEach(item => {
            if (!item || typeof item !== 'object' || !Array.isArray(item.polygon)) return;
            const pts = [];
            item.polygon.forEach(p => {
                if (!Array.isArray(p) || p.length < 2) return;
                const g = wikiToGame(Number(p[0]), Number(p[1]));
                if (g) pts.push(g);
            });
            if (pts.length < 3) return;
            out.push({
                name: typeof item.name === 'string' ? item.name : '',
                color: typeof item.color === 'string' ? item.color : null,
                points: pts
            });
        });
        return snapPolygonVertices(out, tolerance === undefined ? 1 : tolerance);
    }

    function parseZoneFile(raw) {
        if (Array.isArray(raw)) return { points: parseZonePoints(raw), polygons: [] };
        if (!raw || typeof raw !== 'object') return { points: [], polygons: [] };
        return {
            points: parseZonePoints(raw.points || []),
            polygons: parseZonePolygons(raw.polygons || [])
        };
    }

    function polygonsToVectorItems(polys, zoneId, fallbackColor) {
        if (!Array.isArray(polys)) return [];
        const items = [];
        polys.forEach((poly, index) => {
            if (!poly || !Array.isArray(poly.points) || poly.points.length < 3) return;
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            poly.points.forEach(p => {
                if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
                if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
            });
            if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) return;
            const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
            items.push({
                name: poly.name || ('Фигура ' + (index + 1)),
                icon: 'pen',
                position: { x: cx, y: cy, z: 20 },
                rotation: { x: 0, y: 0, z: 0 },
                scale: { x: 1, y: 1, z: 1 },
                isText: false,
                isSvg: false,
                styleOverridden: false,
                isPencil: true,
                isPencilLine: false,
                pencilPoints: poly.points.map(p => ({ x: p.x - cx, y: p.y - cy })),
                color: poly.color || fallbackColor || '#ffffff',
                opacity: 1,
                convertedFrom: zoneId
            });
        });
        return items;
    }

    function polygonsToMergedFigures(polys, zoneId, fallbackColor, title, opts) {
        if (!Array.isArray(polys) || polys.length === 0) return [];
        const settings = opts || {};
        const groups = new Map();
        polys.forEach(poly => {
            if (!poly || !Array.isArray(poly.points) || poly.points.length < 3) return;
            const color = poly.color || fallbackColor || '#ffffff';
            if (!groups.has(color)) groups.set(color, []);
            groups.get(color).push(poly);
        });
        const figures = [];
        groups.forEach((list, color) => {
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            list.forEach(poly => poly.points.forEach(p => {
                if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
                if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
            }));
            if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) return;
            const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
            const item = {
                name: groups.size > 1 ? (title + ' — ' + color) : title,
                icon: 'pen',
                position: { x: cx, y: cy, z: 20 },
                rotation: { x: 0, y: 0, z: 0 },
                scale: { x: 1, y: 1, z: 1 },
                isText: false,
                isSvg: false,
                styleOverridden: false,
                isPencil: true,
                isPencilLine: false,
                pencilShapes: list.map(poly => poly.points.map(p => ({ x: p.x - cx, y: p.y - cy }))),
                color: color,
                opacity: settings.opacity ?? 1,
                convertedFrom: zoneId
            };
            if (settings.strokeWidth != null) {
                item.hasStroke = true;
                item.strokeColor = color;
                item.strokeWidth = settings.strokeWidth;
                item.strokePattern = 'solid';
            }
            figures.push(item);
        });
        return figures;
    }

    function parsePastedPoints(text) {
        const out = [];
        String(text || '').split('\n').forEach(rawLine => {
            let line = String(rawLine).trim().replace(/^(?:[-–—](?=\s)|•)\s*/, '');
            if (!line) return;
            let parts = line.split(/[,;\t]+/).map(s => s.trim()).filter(s => s.length > 0);
            let usedComma = true;
            if (parts.length < 2 || !Number.isFinite(Number(parts[0])) || !Number.isFinite(Number(parts[1]))) {
                parts = line.split(/\s+/).filter(Boolean);
                usedComma = false;
            }
            if (parts.length < 2) return;
            const x = Number(parts[0]), y = Number(parts[1]);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return;
            const name = parts.slice(2).join(usedComma ? ', ' : ' ').replace(/^[-–—]\s*/, '');
            out.push({ point: [x, y], name });
        });
        return out;
    }

    function normalizeMarkerStyle(ms, defColor) {
        const src = (ms && typeof ms === 'object') ? ms : {};
        const out = { color: defColor || '#ffffff', outline: '#ffffff', outlineStyle: 'solid', gap: 0, width: 0.29, fill: true };
        if (typeof src.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(src.color)) out.color = src.color;
        if (typeof src.outline === 'string' && /^#[0-9a-fA-F]{6}$/.test(src.outline)) out.outline = src.outline;
        if (src.outlineStyle === 'dashed' || src.outlineStyle === 'none') out.outlineStyle = src.outlineStyle;
        if (Number.isFinite(src.gap)) out.gap = Math.min(1, Math.max(0, src.gap));
        if (Number.isFinite(src.width)) out.width = Math.min(1.5, Math.max(0.05, src.width));
        if (src.fill === false) out.fill = false;
        return out;
    }

    function findNearestMarker(points, project, x, y, maxDist) {
        let best = -1, bestDist = maxDist;
        for (let i = 0; i < points.length; i++) {
            const s = project(points[i].x, points[i].y);
            if (!s) continue;
            const dx = s[0] - x, dy = s[1] - y;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < bestDist) { bestDist = d; best = i; }
        }
        return best;
    }

    return { GAME_ZONES, parseZonePoints, parseZonePolygons, parseZoneFile, wikiToGame, polygonsToVectorItems, polygonsToMergedFigures, parsePastedPoints, normalizeMarkerStyle, findNearestMarker, snapPolygonVertices };
});

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('gameZonesList');
    if (!container || !window.GameZones) return;
    const t = (ru, en, uk) => window.t ? window.t(ru, en, uk) : ru;
    const state = {};
    window.GameZones.GAME_ZONES.forEach(def => { state[def.id] = { on: false, group: null, points: [], polygons: [], loading: false, customIcon: null, customRaw: [], markerStyle: null }; });

    function markerStyleOf(def) {
        const st = state[def.id];
        return window.GameZones.normalizeMarkerStyle(st && st.markerStyle, def.color);
    }

    function setMarkerStyle(def, patch) {
        const st = state[def.id];
        if (!st) return;
        st.markerStyle = Object.assign({}, st.markerStyle, patch);
        rebuildZoneGroup(def);
    }

    let selectedZoneId = null;

    window.selectGameZone = function(id) {
        selectedZoneId = id;
        renderMarkerPanel();
        window.refreshGameZonesList();
        if (window.refreshVectorLayersList) window.refreshVectorLayersList();
    };

    function selectedZoneDef() {
        return window.GameZones.GAME_ZONES.find(d => d.id === selectedZoneId) || null;
    }

    function toPanelHex(c) { try { return '#' + new THREE.Color(c).getHexString(); } catch (e) { return '#ffffff'; } }

    function renderMarkerPanel() {
        const panel = document.getElementById('markerPropsPanel');
        if (!panel) return;
        const def = selectedZoneDef();
        if (!def) { panel.classList.add('hidden'); return; }
        panel.classList.remove('hidden');
        const st = state[def.id];
        const ms = markerStyleOf(def);
        const nameEl = document.getElementById('markerPropsName');
        if (nameEl) nameEl.textContent = labelOf(def);
        const colorEl = document.getElementById('markerPropColor');
        const outlineEl = document.getElementById('markerPropOutline');
        const styleEl = document.getElementById('markerPropOutlineStyle');
        const noteEl = document.getElementById('markerSvgNote');
        const locked = !!(st && st.customIcon);
        if (colorEl) { colorEl.value = toPanelHex(ms.color); colorEl.disabled = locked; }
        const fillEl = document.getElementById('markerPropFill');
        if (fillEl) { fillEl.checked = ms.fill !== false; fillEl.disabled = locked; }
        if (outlineEl) { outlineEl.value = toPanelHex(ms.outline); outlineEl.disabled = locked; }
        if (styleEl) { styleEl.value = ms.outlineStyle; styleEl.disabled = locked; }
        if (noteEl) noteEl.classList.toggle('hidden', !locked);
        const gapPct = Math.round(ms.gap * 100), widthPct = Math.round(ms.width * 100);
        const gapEl = document.getElementById('markerPropGap');
        const gapNum = document.getElementById('markerPropGapNum');
        const widthEl = document.getElementById('markerPropWidth');
        const widthNum = document.getElementById('markerPropWidthNum');
        const iconReset = document.getElementById('markerPropIconReset');
        if (gapEl) { gapEl.value = gapPct; gapEl.disabled = locked; }
        if (gapNum) { gapNum.value = gapPct; gapNum.disabled = locked; }
        if (widthEl) { widthEl.value = widthPct; widthEl.disabled = locked; }
        if (widthNum) { widthNum.value = widthPct; widthNum.disabled = locked; }
        if (iconReset) iconReset.classList.toggle('hidden', !locked);
    }

    function parseCustomIconShapes(def) {
        const st = state[def.id];
        const svgString = st && st.customIcon;
        if (!svgString || !window.createSafeSvgShapes) return null;
        try {
            const loader = new THREE.SVGLoader();
            const svgData = loader.parse(svgString);
            const parts = [];
            (svgData.paths || []).forEach(path => {
                const style = path.userData.style || {};
                const fill = style.fill === undefined ? '#ffffff' : style.fill;
                if (String(fill).toLowerCase() === 'none') return;
                const shapes = window.createSafeSvgShapes(path);
                if (!shapes || shapes.length === 0) return;
                let color = '#ffffff';
                try { color = '#' + new THREE.Color().setStyle(fill).getHexString(); } catch (e) {}
                const opacity = style.fillOpacity !== undefined ? style.fillOpacity : 1;
                shapes.forEach(shape => parts.push({ shape, color, opacity }));
            });
            if (parts.length === 0) return null;
            const box = new THREE.Box2();
            parts.forEach(p => {
                const pts = p.shape.extractPoints(8);
                pts.shape.concat(pts.holes.reduce((a, h) => a.concat(h), [])).forEach(v => box.expandByPoint(v));
            });
            const size = box.getSize(new THREE.Vector2());
            const scale = Math.max(size.x, size.y) > 1e-9 ? (markerSize * 2) / Math.max(size.x, size.y) : 1;
            const center = box.getCenter(new THREE.Vector2());
            return parts.map(p => {
                const g = new THREE.ShapeGeometry(p.shape);
                g.scale(scale, scale, 1);
                g.translate(-center.x * scale, -center.y * scale, 0);
                g.rotateZ(Math.PI);
                return { geometry: g, color: p.color, opacity: p.opacity };
            });
        } catch (err) {
            console.warn('Custom icon parse failed:', err);
            return null;
        }
    }

    const labelOf = (def) => def.titles[window.currentLang === 'en' ? 1 : window.currentLang === 'uk' ? 2 : 0];

    let markerSize = 6;

    function buildGroup(def, data) {
        const points = data.points || [];
        const polygons = data.polygons || [];
        const mstyle = markerStyleOf(def);
        const group = new THREE.Group();
        group.position.z = 31;
        group.userData.isGameZone = true;
        group.userData.zoneId = def.id;
        group.userData.mats = [];
        const outerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(mstyle.outline), side: THREE.DoubleSide, transparent: true, opacity: 1, depthTest: false, depthWrite: false });
        const innerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(mstyle.color), side: THREE.DoubleSide, transparent: true, opacity: 1, depthTest: false, depthWrite: false });
        group.userData.mats.push(outerMat, innerMat);
        const outerR = markerSize, innerR = markerSize * 0.71;
        const zoneState = state[def.id];
        const iconParts = (zoneState && zoneState.customIcon) ? parseCustomIconShapes(def) : null;
        const iconMats = [];
        if (iconParts) iconParts.forEach(part => {
            const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(part.color), side: THREE.DoubleSide, transparent: part.opacity < 1, opacity: part.opacity, depthTest: false, depthWrite: false });
            iconMats.push(mat);
            group.userData.mats.push(mat);
        });
        points.forEach(pt => {
            if (iconParts) {
                iconParts.forEach((part, pi) => {
                    const mesh = new THREE.Mesh(part.geometry, iconMats[pi]);
                    mesh.position.set(pt.x, pt.y, 0.01);
                    mesh.renderOrder = 1002.1;
                    mesh.userData.isGameZone = true;
                    group.add(mesh);
                });
                return;
            }
            const gapAbs = mstyle.gap * markerSize;
            const widthAbs = Math.max(0.2, mstyle.width * markerSize);
            const ringInnerR = innerR + gapAbs;
            const ringOuterR = ringInnerR + widthAbs;
            const hasRing = mstyle.outlineStyle !== 'none' && ringOuterR > ringInnerR;
            const outer = (hasRing && mstyle.outlineStyle === 'solid') ? new THREE.Mesh(new THREE.RingGeometry(Math.max(0.01, ringInnerR), ringOuterR, 40), outerMat) : null;
            if (outer) {
                outer.position.set(pt.x, pt.y, 0);
                outer.renderOrder = 1002;
                outer.userData.isGameZone = true;
                group.add(outer);
            }
            if (mstyle.outlineStyle === 'dashed' && hasRing) {
                const midR = Math.max(0.5, (ringInnerR + ringOuterR) / 2);
                const dashPts = new THREE.EllipseCurve(0, 0, midR, midR).getPoints(72).map(p => new THREE.Vector3(p.x, p.y, 0));
                const fit = window.GeometryUtils.fitRingDashes(2 * Math.PI * midR, widthAbs);
                const dashMat = new THREE.LineDashedMaterial({ color: new THREE.Color(mstyle.outline), dashSize: fit.dashSize, gapSize: fit.gapSize, transparent: true, opacity: 1, depthTest: false, depthWrite: false });
                const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(dashPts), dashMat);
                ring.computeLineDistances();
                ring.position.set(pt.x, pt.y, 0);
                ring.renderOrder = 1002;
                ring.userData.isGameZone = true;
                group.userData.mats.push(dashMat);
                group.add(ring);
            }
            const inner = new THREE.Mesh(new THREE.CircleGeometry(innerR, 20), innerMat);
            inner.position.set(pt.x, pt.y, 0.01);
            inner.renderOrder = 1002.1;
            inner.userData.isGameZone = true;
            if (mstyle.fill) group.add(inner);
        });
        polygons.forEach(poly => {
            const shape = new THREE.Shape(poly.points.map(p => new THREE.Vector2(p.x, p.y)));
            const fillMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(poly.color || def.color), side: THREE.DoubleSide, transparent: true, opacity: 0.35, depthTest: false, depthWrite: false });
            const lineMat = new THREE.LineBasicMaterial({ color: new THREE.Color(poly.color || def.color), transparent: true, opacity: 1, depthTest: false, depthWrite: false });
            group.userData.mats.push(fillMat, lineMat);
            const fill = new THREE.Mesh(new THREE.ShapeGeometry(shape), fillMat);
            fill.position.z = 0;
            fill.renderOrder = 995;
            fill.userData.isGameZone = true;
            const outlinePts = poly.points.map(p => new THREE.Vector3(p.x, p.y, 0.01));
            outlinePts.push(outlinePts[0].clone());
            const outline = new THREE.Line(new THREE.BufferGeometry().setFromPoints(outlinePts), lineMat);
            outline.renderOrder = 996;
            outline.userData.isGameZone = true;
            group.add(fill, outline);
        });
        return group;
    }

    function disposeGroup(group) {
        if (!group) return;
        scene.remove(group);
        group.traverse(child => { if ((child.isMesh || child.isLine) && child.geometry) child.geometry.dispose(); });
        (group.userData.mats || []).forEach(m => m.dispose && m.dispose());
    }

    function rebuildZoneGroup(def) {
        const st = state[def.id];
        if (!st) return;
        if (st.group) disposeGroup(st.group);
        st.group = null;
        if (st.points.length > 0 || st.polygons.length > 0) {
            st.group = buildGroup(def, { points: st.points, polygons: [] });
            if (st.on) scene.add(st.group);
        }
        if (window.requestSceneRender) window.requestSceneRender();
    }

    async function setZoneOn(def, checkbox) {
        const st = state[def.id];
        if (!def.url && !def.custom) return;
        if (st.on) return;
        try {
            if (!st.group) {
                if (def.url) {
                    st.loading = true;
                    const response = await fetch(def.url, { cache: 'no-store' });
                    if (!response.ok) throw new Error('HTTP ' + response.status);
                    const raw = await response.json();
                    const data = window.GameZones.parseZoneFile(raw);
                    st.points = data.points;
                    st.polygons = data.polygons;
                } else if (def.custom) {
                    st.points = window.GameZones.parseZonePoints(st.customRaw);
                }
                if (st.points.length === 0 && st.polygons.length === 0) throw new Error('empty');
                if (st.polygons.length > 0) await window.convertZoneToFigures(def.id);
                st.group = buildGroup(def, { points: st.points, polygons: [] });
                scene.add(st.group);
            } else {
                // Фигуры из полигонов при выключении удаляются (deleteConvertedFigures),
                // поэтому при повторном включении восстанавливаем их заново.
                if (st.polygons.length > 0 && window.convertZoneToFigures) await window.convertZoneToFigures(def.id);
                scene.add(st.group);
            }
            st.on = true;
            if (window.requestSceneRender) window.requestSceneRender();
        } catch (err) {
            console.warn('Game zone failed:', def.id, err);
            if (checkbox) checkbox.checked = false;
            if (window.showToast) window.showToast(t('Не удалось загрузить слой', 'Failed to load layer', 'Не вдалося завантажити шар'), 'error');
        } finally {
            st.loading = false;
            if (window.setConvertedVisible) window.setConvertedVisible(def.id, st.on);
            window.refreshGameZonesList();
            if (window.refreshVectorLayersList) window.refreshVectorLayersList();
        }
    }

    function setZoneOff(def) {
        const st = state[def.id];
        if (!st.on) return;
        st.on = false;
        if (st.group) scene.remove(st.group);
        if (window.deleteConvertedFigures) window.deleteConvertedFigures(def.id);
        if (window.requestSceneRender) window.requestSceneRender();
        window.refreshGameZonesList();
        if (window.refreshVectorLayersList) window.refreshVectorLayersList();
    }

    window.toggleGameZone = function(id, on) {
        const def = window.GameZones.GAME_ZONES.find(d => d.id === id);
        if (!def) return Promise.resolve(false);
        if (on) return setZoneOn(def);
        setZoneOff(def);
        return Promise.resolve(true);
    };

    window.GameZones.pickMarkerAt = function(clientX, clientY) {
        try {
            if (typeof camera === 'undefined' || typeof renderer === 'undefined' || !renderer.domElement) return null;
            const rect = renderer.domElement.getBoundingClientRect();
            if (rect.width < 1 || rect.height < 1) return null;
            const x = clientX - rect.left, y = clientY - rect.top;
            const v = new THREE.Vector3();
            const project = (px, py) => {
                v.set(px, py, 31).project(camera);
                if (v.z > 1 || v.z < -1) return null;
                return [(v.x * 0.5 + 0.5) * rect.width, (-v.y * 0.5 + 0.5) * rect.height];
            };
            const findNearest = window.GameZones.findNearestMarker;
            let best = null, bestDist = 16;
            window.GameZones.GAME_ZONES.forEach(def => {
                const st = state[def.id];
                if (!st || !st.on || !st.points || st.points.length === 0) return;
                const idx = findNearest(st.points, project, x, y, bestDist);
                if (idx >= 0) {
                    const s = project(st.points[idx].x, st.points[idx].y);
                    bestDist = Math.sqrt((s[0] - x) * (s[0] - x) + (s[1] - y) * (s[1] - y));
                    best = def.id;
                }
            });
            return best;
        } catch (e) { return null; }
    };

    window.clearGameZoneSelection = function() {
        if (!selectedZoneId) return;
        selectedZoneId = null;
        renderMarkerPanel();
        window.refreshGameZonesList();
        if (window.refreshVectorLayersList) window.refreshVectorLayersList();
    };

    async function ensureZoneData(def) {
        const st = state[def.id];
        if (!def.url) return null;
        if (st.polygons.length > 0 || st.points.length > 0) {
            return { points: st.points, polygons: st.polygons };
        }
        const response = await fetch(def.url, { cache: 'no-store' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const data = window.GameZones.parseZoneFile(await response.json());
        st.points = data.points;
        st.polygons = data.polygons;
        return data;
    }

    window.convertZoneToFigures = async function(id) {
        const def = window.GameZones.GAME_ZONES.find(d => d.id === id);
        if (!def || !def.url || !window.loadVectorsFromJSON) return 0;
        if (!window.mapBounds) {
            if (window.showToast) window.showToast(t('Сначала загрузите карту', 'Load the map first', 'Спочатку завантажте карту'), 'error');
            return 0;
        }
        const data = await ensureZoneData(def);
        if (!data || data.polygons.length === 0) return 0;
        const existing = window.getVectorsForJSON ? window.getVectorsForJSON().filter(d => d.convertedFrom === id).length : 0;
        if (existing > 0) return 0;
            const label = def.titles[window.currentLang === 'en' ? 1 : window.currentLang === 'uk' ? 2 : 0];
            const fd = def.figureDefaults || {};
            const items = window.GameZones.polygonsToMergedFigures(data.polygons, id, def.color, label, { opacity: fd.opacity ?? 1, strokeWidth: fd.strokeWidth ?? 0.4 });
        if (items.length === 0) return 0;
        await window.loadVectorsFromJSON(items, true);
        if (window.showToast) window.showToast(t('Создано фигур: ' + items.length, 'Created figures: ' + items.length, 'Створено фігур: ' + items.length));
        return items.length;
    };

    window.getGameZonesState = function() {
        const icons = {};
        const styles = {};
        window.GameZones.GAME_ZONES.forEach(d => {
            if (state[d.id] && state[d.id].customIcon) icons[d.id] = state[d.id].customIcon;
            if (state[d.id] && state[d.id].markerStyle) styles[d.id] = state[d.id].markerStyle;
        });
        return {
            on: window.GameZones.GAME_ZONES.filter(d => state[d.id] && state[d.id].on).map(d => d.id),
            markerSize: markerSize,
            icons: icons,
            styles: styles,
            custom: (state.custom && state.custom.customRaw) || []
        };
    };

    window.setGameZonesState = async function(saved) {
        if (!saved) return;
        if (Number.isFinite(saved.markerSize)) {
            markerSize = saved.markerSize;
            if (sizeInput) sizeInput.value = markerSize;
            if (sizeNum) sizeNum.textContent = markerSize;
        }
        const icons = saved.icons || {};
        Object.keys(icons).forEach(id => {
            if (state[id] && typeof icons[id] === 'string') state[id].customIcon = icons[id];
        });
        const styles = saved.styles || {};
        Object.keys(styles).forEach(id => {
            const s = styles[id];
            if (!state[id] || !s || typeof s !== 'object') return;
            const patch = {};
            if (typeof s.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.color)) patch.color = s.color;
            if (typeof s.outline === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.outline)) patch.outline = s.outline;
            if (s.outlineStyle === 'dashed' || s.outlineStyle === 'none') patch.outlineStyle = s.outlineStyle;
            if (Number.isFinite(s.gap)) patch.gap = Math.min(1, Math.max(0, s.gap));
            if (Number.isFinite(s.width)) patch.width = Math.min(1.5, Math.max(0.05, s.width));
            if (s.fill === false) patch.fill = false;
            if (Object.keys(patch).length > 0) state[id].markerStyle = patch;
        });
        if (Array.isArray(saved.custom) && saved.custom.length > 0 && state.custom) {
            state.custom.customRaw = saved.custom.filter(r => r && Array.isArray(r.point));
        }
        for (const id of (saved.on || [])) {
            const def = window.GameZones.GAME_ZONES.find(d => d.id === id);
            if (def && (def.url || def.custom)) await setZoneOn(def);
        }
        window.GameZones.GAME_ZONES.forEach(def => {
            if (!(saved.on || []).includes(def.id) && window.setConvertedVisible) window.setConvertedVisible(def.id, false);
        });
        window.refreshGameZonesList();
    };

    document.getElementById('markerPropColor')?.addEventListener('input', (e) => {
        const def = selectedZoneDef(); if (!def) return;
        setMarkerStyle(def, { color: e.target.value });
    });
    document.getElementById('markerPropColor')?.addEventListener('change', () => window.refreshGameZonesList());
    document.getElementById('markerPropOutline')?.addEventListener('input', (e) => {
        const def = selectedZoneDef(); if (!def) return;
        setMarkerStyle(def, { outline: e.target.value });
    });
    document.getElementById('markerPropOutline')?.addEventListener('change', () => window.refreshGameZonesList());
    document.getElementById('markerPropOutlineStyle')?.addEventListener('change', (e) => {
        const def = selectedZoneDef(); if (!def) return;
        setMarkerStyle(def, { outlineStyle: e.target.value });
        window.refreshGameZonesList();
    });
    const syncPctPair = (rangeId, numId, set) => {
        const range = document.getElementById(rangeId), num = document.getElementById(numId);
        if (!range || !num) return;
        range.addEventListener('input', () => {
            const def = selectedZoneDef(); if (!def) return;
            num.value = range.value;
            set(def, parseFloat(range.value) / 100);
        });
        num.addEventListener('input', () => {
            const def = selectedZoneDef(); if (!def) return;
            let v = parseFloat(num.value);
            if (!Number.isFinite(v)) return;
            v = Math.min(parseFloat(range.max), Math.max(parseFloat(range.min), v));
            range.value = v;
            set(def, v / 100);
        });
    };
    syncPctPair('markerPropGap', 'markerPropGapNum', (def, v) => setMarkerStyle(def, { gap: v }));
    syncPctPair('markerPropWidth', 'markerPropWidthNum', (def, v) => setMarkerStyle(def, { width: v }));
    document.getElementById('markerPropFill')?.addEventListener('change', (e) => {
        const def = selectedZoneDef(); if (!def) return;
        setMarkerStyle(def, { fill: e.target.checked });
        window.refreshGameZonesList();
    });
    document.getElementById('markerPropIconFile')?.addEventListener('change', (e) => {
        const def = selectedZoneDef(); const st = def && state[def.id];
        const file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!def || !st || !file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            st.customIcon = ev.target.result;
            if (!parseCustomIconShapes(def)) {
                st.customIcon = null;
                if (window.showToast) window.showToast(t('В SVG нет залитых контуров', 'SVG has no filled contours', 'У SVG немає залитих контурів'), 'error');
            }
            rebuildZoneGroup(def);
            renderMarkerPanel();
            window.refreshGameZonesList();
        };
        reader.readAsText(file);
    });
    document.getElementById('markerPropIconReset')?.addEventListener('click', () => {
        const def = selectedZoneDef(); const st = def && state[def.id];
        if (!def || !st) return;
        st.customIcon = null;
        rebuildZoneGroup(def);
        renderMarkerPanel();
        window.refreshGameZonesList();
    });
    document.getElementById('markerPropReset')?.addEventListener('click', () => {
        const def = selectedZoneDef(); if (!def || !state[def.id]) return;
        state[def.id].markerStyle = null;
        rebuildZoneGroup(def);
        renderMarkerPanel();
        window.refreshGameZonesList();
    });
    document.getElementById('markerPropsClose')?.addEventListener('click', () => window.selectGameZone(null));

    const sizeInput = document.getElementById('gameZoneSize');
    const sizeNum = document.getElementById('gameZoneSizeNum');
    if (sizeInput) sizeInput.addEventListener('input', () => {
        markerSize = parseFloat(sizeInput.value) || 6;
        if (sizeNum) sizeNum.textContent = markerSize;
        window.GameZones.GAME_ZONES.forEach(def => {
            if (state[def.id] && state[def.id].points.length > 0) rebuildZoneGroup(def);
        });
    });

    document.getElementById('addCustomPoints')?.addEventListener('click', async () => {
        try {
        const ta = document.getElementById('customPointsInput');
        const def = window.GameZones.GAME_ZONES.find(d => d.id === 'custom');
        const st = state.custom;
        if (!ta || !def || !st || !Array.isArray(st.customRaw)) return;
        const items = window.GameZones.parsePastedPoints(ta.value);
        if (items.length === 0) {
            if (window.showToast) window.showToast(t('Нет координат для добавления', 'No coordinates to add', 'Немає координат для додавання'), 'error');
            return;
        }
        const seen = new Set(st.customRaw.map(r => r.point[0] + ',' + r.point[1]));
        let added = 0;
        items.forEach(it => {
            const key = it.point[0] + ',' + it.point[1];
            if (seen.has(key)) return;
            seen.add(key);
            st.customRaw.push({ point: it.point.slice(), name: it.name });
            added++;
        });
        st.points = window.GameZones.parseZonePoints(st.customRaw);
        if (!st.on) await setZoneOn(def);
        else { rebuildZoneGroup(def); window.refreshGameZonesList(); }
        ta.value = '';
        if (window.showToast) window.showToast(t('Добавлено меток: ' + added, 'Added markers: ' + added, 'Додано міток: ' + added), added ? 'success' : 'info');
        } catch (err) {
            console.error('[game-zones] addCustomPoints failed:', err);
            if (window.showToast) window.showToast(t('Ошибка добавления меток', 'Failed to add markers', 'Помилка додавання міток'), 'error');
        }
    });

    document.getElementById('clearCustomPoints')?.addEventListener('click', () => {
        const st = state.custom;
        const def = window.GameZones.GAME_ZONES.find(d => d.id === 'custom');
        if (!st || !def || !st.customRaw.length) return;
        st.customRaw = [];
        st.points = [];
        rebuildZoneGroup(def);
        window.refreshGameZonesList();
        if (window.showToast) window.showToast(t('Свои метки очищены', 'Custom markers cleared', 'Свої мітки очищено'), 'info');
    });

    document.getElementById('customPointsFile')?.addEventListener('change', (e) => {
        const ta = document.getElementById('customPointsInput');
        const file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!ta || !file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            ta.value = String(ev.target.result || '');
            const n = window.GameZones.parsePastedPoints(ta.value).length;
            if (window.showToast) window.showToast(t('Загружено из файла: ' + file.name + ' (' + n + ')', 'Loaded from file: ' + file.name + ' (' + n + ')', 'Завантажено з файлу: ' + file.name + ' (' + n + ')'), n ? 'success' : 'error');
        };
        reader.readAsText(file);
    });

    window.refreshGameZonesList = function() {
        const active = document.activeElement;
        renderMarkerPanel();
        const pasteBox = document.getElementById('customPointsInput');
        if (pasteBox) pasteBox.placeholder = t('x, y, название — напр.: 4624.88, 1947.76, контейнер #25', 'x, y, name — e.g.: 4624.88, 1947.76, bin #25', 'x, y, назва — напр.: 4624.88, 1947.76, контейнер #25');
        container.replaceChildren(...window.GameZones.GAME_ZONES.map(def => {
            const st = state[def.id];
            const row = document.createElement('label');
            row.className = 'flex items-center gap-2 py-1 px-1.5 rounded-lg border border-slate-700/50 bg-slate-800/40 cursor-pointer hover:border-emerald-500 transition' + (def.url ? '' : ' opacity-50');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'w-3.5 h-3.5 accent-emerald-500 shrink-0';
            checkbox.checked = st.on;
            checkbox.disabled = (!(def.url || def.custom)) || st.loading;
            checkbox.title = def.url ? '' : t('Нет данных — добавьте JSON слоя', 'No data — add layer JSON', 'Немає даних — додайте JSON шару');
            checkbox.addEventListener('change', () => window.toggleGameZone(def.id, checkbox.checked));
            const dot = document.createElement('span');
            dot.className = 'w-3 h-3 rounded-full shrink-0 border border-black/40';
            dot.style.backgroundColor = markerStyleOf(def).color;
            const name = document.createElement('span');
            name.className = 'flex-1 min-w-0 truncate text-slate-200 text-[10px] font-semibold cursor-pointer hover:text-emerald-300';
            name.textContent = labelOf(def);
            name.title = t('Настроить метки слоя', 'Configure layer markers', 'Налаштувати мітки шару');
            name.addEventListener('click', (e) => {
                e.preventDefault();
                window.selectGameZone(selectedZoneId === def.id ? null : def.id);
            });
            if (selectedZoneId === def.id) row.classList.add('border-emerald-500', 'bg-emerald-500/10');
            row.append(checkbox, dot, name);
            const total = st.points.length + st.polygons.length;
            if (total > 0) {
                const count = document.createElement('span');
                count.className = 'text-[9px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1 rounded-full shrink-0';
                count.textContent = total;
                row.appendChild(count);
            }
            if (active && active !== document.body) { /* keep focus stable: do nothing */ }
            return row;
        }));
        if (window.lucide) window.lucide.createIcons();
    };

    window.renderGameZonesList = window.refreshGameZonesList;
    window.refreshGameZonesList();
});
}
