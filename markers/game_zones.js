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
        { id: 'phones', titles: ['Телефоны', 'Phones', 'Телефони'], color: '#34d399', icon: 'phone', url: 'markers/phones.json' }
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

    function parseZonePolygons(raw) {
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
        return out;
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

    return { GAME_ZONES, parseZonePoints, parseZonePolygons, parseZoneFile, wikiToGame, polygonsToVectorItems, polygonsToMergedFigures };
});

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('gameZonesList');
    if (!container || !window.GameZones) return;
    const t = (ru, en, uk) => window.t ? window.t(ru, en, uk) : ru;
    const state = {};
    window.GameZones.GAME_ZONES.forEach(def => { state[def.id] = { on: false, group: null, points: [], polygons: [], loading: false, customIcon: null }; });

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
        const group = new THREE.Group();
        group.position.z = 31;
        group.userData.isGameZone = true;
        group.userData.zoneId = def.id;
        group.userData.mats = [];
        const outerMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 1, depthTest: false, depthWrite: false });
        const innerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(def.color), side: THREE.DoubleSide, transparent: true, opacity: 1, depthTest: false, depthWrite: false });
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
            const outer = new THREE.Mesh(new THREE.CircleGeometry(outerR, 20), outerMat);
            outer.position.set(pt.x, pt.y, 0);
            outer.renderOrder = 1002;
            outer.userData.isGameZone = true;
            const inner = new THREE.Mesh(new THREE.CircleGeometry(innerR, 20), innerMat);
            inner.position.set(pt.x, pt.y, 0.01);
            inner.renderOrder = 1002.1;
            inner.userData.isGameZone = true;
            group.add(outer, inner);
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
        group.traverse(child => { if (child.isMesh && child.geometry) child.geometry.dispose(); });
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
        if (!def.url) return;
        if (st.on) return;
        try {
            if (!st.group) {
                st.loading = true;
                const response = await fetch(def.url, { cache: 'no-store' });
                if (!response.ok) throw new Error('HTTP ' + response.status);
                const raw = await response.json();
                const data = window.GameZones.parseZoneFile(raw);
                st.points = data.points;
                st.polygons = data.polygons;
                if (st.points.length === 0 && st.polygons.length === 0) throw new Error('empty');
                if (st.polygons.length > 0) await window.convertZoneToFigures(def.id);
                st.group = buildGroup(def, { points: st.points, polygons: [] });
                scene.add(st.group);
            } else {
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
    }

    window.toggleGameZone = function(id, on) {
        const def = window.GameZones.GAME_ZONES.find(d => d.id === id);
        if (!def) return;
        if (on) setZoneOn(def);
        else setZoneOff(def);
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
            const items = window.GameZones.polygonsToMergedFigures(data.polygons, id, def.color, label, { opacity: fd.opacity ?? 1, strokeWidth: fd.strokeWidth ?? null });
        if (items.length === 0) return 0;
        await window.loadVectorsFromJSON(items, true);
        if (window.showToast) window.showToast(t('Создано фигур: ' + items.length, 'Created figures: ' + items.length, 'Створено фігур: ' + items.length));
        return items.length;
    };

    window.getGameZonesState = function() {
        const icons = {};
        window.GameZones.GAME_ZONES.forEach(d => {
            if (state[d.id] && state[d.id].customIcon) icons[d.id] = state[d.id].customIcon;
        });
        return {
            on: window.GameZones.GAME_ZONES.filter(d => state[d.id] && state[d.id].on).map(d => d.id),
            markerSize: markerSize,
            icons: icons
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
        for (const id of (saved.on || [])) {
            const def = window.GameZones.GAME_ZONES.find(d => d.id === id);
            if (def && def.url) await setZoneOn(def);
        }
        window.GameZones.GAME_ZONES.forEach(def => {
            if (!(saved.on || []).includes(def.id) && window.setConvertedVisible) window.setConvertedVisible(def.id, false);
        });
        window.refreshGameZonesList();
    };

    const sizeInput = document.getElementById('gameZoneSize');
    const sizeNum = document.getElementById('gameZoneSizeNum');
    if (sizeInput) sizeInput.addEventListener('input', () => {
        markerSize = parseFloat(sizeInput.value) || 6;
        if (sizeNum) sizeNum.textContent = markerSize;
        window.GameZones.GAME_ZONES.forEach(def => {
            if (state[def.id] && state[def.id].points.length > 0) rebuildZoneGroup(def);
        });
    });

    window.refreshGameZonesList = function() {
        const active = document.activeElement;
        container.replaceChildren(...window.GameZones.GAME_ZONES.map(def => {
            const st = state[def.id];
            const row = document.createElement('label');
            row.className = 'flex items-center gap-2 py-1 px-1.5 rounded-lg border border-slate-700/50 bg-slate-800/40 cursor-pointer hover:border-emerald-500 transition' + (def.url ? '' : ' opacity-50');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'w-3.5 h-3.5 accent-emerald-500 shrink-0';
            checkbox.checked = st.on;
            checkbox.disabled = !def.url || st.loading;
            checkbox.title = def.url ? '' : t('Нет данных — добавьте JSON слоя', 'No data — add layer JSON', 'Немає даних — додайте JSON шару');
            checkbox.addEventListener('change', () => window.toggleGameZone(def.id, checkbox.checked));
            const dot = document.createElement('span');
            dot.className = 'w-3 h-3 rounded-full shrink-0 border border-black/40';
            dot.style.backgroundColor = def.color;
            const name = document.createElement('span');
            name.className = 'flex-1 min-w-0 truncate text-slate-200 text-[10px] font-semibold';
            name.textContent = labelOf(def);
            row.append(checkbox, dot, name);
            const iconBtn = document.createElement('label');
            iconBtn.className = 'shrink-0 p-1 rounded transition cursor-pointer ' + (st.customIcon ? 'text-emerald-400 bg-emerald-500/20' : 'text-slate-500 hover:text-emerald-400 hover:bg-emerald-500/20');
            iconBtn.title = t('Своя иконка меток (SVG)', 'Custom marker icon (SVG)', 'Своя іконка міток (SVG)');
            iconBtn.innerHTML = '<i data-lucide="image" class="w-3.5 h-3.5"></i>';
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = '.svg,image/svg+xml';
            fileInput.className = 'hidden';
            fileInput.addEventListener('change', () => {
                const file = fileInput.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                    st.customIcon = ev.target.result;
                    if (!parseCustomIconShapes(def)) {
                        st.customIcon = null;
                        if (window.showToast) window.showToast(t('В SVG нет залитых контуров', 'SVG has no filled contours', 'У SVG немає залитих контурів'), 'error');
                    }
                    rebuildZoneGroup(def);
                    window.refreshGameZonesList();
                };
                reader.readAsText(file);
            });
            iconBtn.appendChild(fileInput);
            row.appendChild(iconBtn);
            if (st.customIcon) {
                const resetIconBtn = document.createElement('button');
                resetIconBtn.type = 'button';
                resetIconBtn.className = 'shrink-0 p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-500/20 transition';
                resetIconBtn.title = t('Вернуть стандартные метки', 'Restore default markers', 'Повернути стандартні мітки');
                resetIconBtn.textContent = '×';
                resetIconBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    st.customIcon = null;
                    rebuildZoneGroup(def);
                    window.refreshGameZonesList();
                });
                row.appendChild(resetIconBtn);
            }
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
