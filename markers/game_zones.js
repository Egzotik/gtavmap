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
        { id: 'rubbish', titles: ['Мусорные баки', 'Trash bins', 'Сміттєві баки'], color: '#eab308', icon: 'trash-2', url: 'markers/rubbish_points.json', directCoordinates: false },
        { id: 'phones', titles: ['Телефоны', 'Phones', 'Телефони'], color: '#34d399', icon: 'phone', url: 'markers/phones.json', directCoordinates: false },
        { id: 'airdrop', titles: ['Аирдропы', 'Airdrops', 'Аірдропи'], color: '#6d9aed', icon: 'plane', url: 'markers/airdrop.json', figureDefaults: { strokeWidth: 0.4, strokeColor: '#ffffff' }, overlayOutline: '#ffffff' },
        { id: 'custom', titles: ['Свои метки', 'Custom markers', 'Свої мітки'], color: '#f8fafc', icon: 'map-pin', custom: true, url: null }
    ];
    // --- СГЕНЕРИРОВАНО из out/all (78 групп стандартных меток). Не править вручную ---
    const STANDARD_ZONE_DEFS = [
        { id: 'std-car-rent', group: 'car-rent', title: 'Car Rent', color: '#e6194B', ru: 'Аренда авто' },
        { id: 'std-gas-station', group: 'gas-station', title: 'Gas Station', color: '#3cb44b', ru: 'Заправки' },
        { id: 'std-grocery-store', group: 'grocery-store', title: 'Grocery Store', color: '#ffe119', ru: 'Магазины' },
        { id: 'std-fishing', group: 'fishing', title: 'Fishing', color: '#4363d8', ru: 'Рыбалка' },
        { id: 'std-free-premises', group: 'free-premises', title: 'Free Premises', color: '#f58231', ru: 'Свободные помещения' },
        { id: 'std-job', group: 'job', title: 'Job', color: '#911eb4', ru: 'Работы' },
        { id: 'std-clothing-store', group: 'clothing-store', title: 'Clothing Store', color: '#46f0f0', ru: 'Одежда' },
        { id: 'std-autoservice', group: 'autoservice', title: 'Autoservice', color: '#f032e6', ru: 'Автосервис' },
        { id: 'std-farm', group: 'farm', title: 'Farm', color: '#bcf60c', ru: 'Фермы' },
        { id: 'std-gunshop', group: 'gunshop', title: 'Gunshop', color: '#fabebe', ru: 'Оружейные' },
        { id: 'std-auto-shop', group: 'auto-shop', title: 'Auto Shop', color: '#008080', ru: 'Автомагазины' },
        { id: 'std-spawn', group: 'spawn', title: 'Spawn', color: '#e6beff', ru: 'Спавны' },
        { id: 'std-warehouse', group: 'warehouse', title: 'Warehouse', color: '#9a6324', ru: 'Склады' },
        { id: 'std-bank', group: 'bank', title: 'Bank', color: '#fffac8', ru: 'Банки' },
        { id: 'std-apartment', group: 'apartment', title: 'Apartment', color: '#800000', ru: 'Апартаменты' },
        { id: 'std-auto-repair', group: 'auto-repair', title: 'Auto Repair', color: '#aaffc3', ru: 'Автомастерские' },
        { id: 'std-bar', group: 'bar', title: 'Bar', color: '#808000', ru: 'Бары' },
        { id: 'std-barbershop', group: 'barbershop', title: 'Barbershop', color: '#ffd8b1', ru: 'Парикмахерские' },
        { id: 'std-craft-family', title: 'Family crafting', color: '#808080', ru: 'Семейные крафты', descriptionFilter: 'Точка крафта для семейных организаций' },
        { id: 'std-craft-gangs', title: 'Gang crafting', color: '#f032e6', ru: 'Крафты банд', descriptionFilter: 'Точка крафта для банд' },
        { id: 'std-craft-government', title: 'Government crafting', color: '#008080', ru: 'Гос крафт', descriptionFilter: 'государственных организаций' },
        { id: 'std-lsc', group: 'lsc', title: 'Lsc', color: '#000000', ru: 'LSC' },
        { id: 'std-mansion', group: 'mansion', title: 'Mansion', color: '#e6194B', ru: 'Особняки' },
        { id: 'std-mushrooms', group: 'mushrooms', title: 'Mushrooms', color: '#3cb44b', ru: 'Грибы' },
        { id: 'std-pvz', group: 'pvz', title: 'Pvz', color: '#ffe119', ru: 'ПВЗ' },
        { id: 'std-tattoo', group: 'tattoo', title: 'Tattoo', color: '#4363d8', ru: 'Тату' },
        { id: 'std-car-point', group: 'car-point', title: 'Car Point', color: '#f58231', ru: 'Точки авто' },
        { id: 'std-car-washing', group: 'car-washing', title: 'Car Washing', color: '#911eb4', ru: 'Автомойки' },
        { id: 'std-drift', group: 'drift', title: 'Drift', color: '#46f0f0', ru: 'Дрифт' },
        { id: 'std-forest', group: 'forest', title: 'Forest', color: '#f032e6', ru: 'Лес' },
        { id: 'std-office', group: 'office', title: 'Office', color: '#bcf60c', ru: 'Офисы' },
        { id: 'std-quests', group: 'quests', title: 'Quests', color: '#fabebe', ru: 'Квесты' },
        { id: 'std-truck-spawn', group: 'truck-spawn', title: 'Truck Spawn', color: '#008080', ru: 'Спавн грузовиков' },
        { id: 'std-boat-rent', group: 'boat-rent', title: 'Boat Rent', color: '#e6beff', ru: 'Аренда лодок' },
        { id: 'std-boat-station', group: 'boat-station', title: 'Boat Station', color: '#9a6324', ru: 'Лодочные станции' },
        { id: 'std-church', group: 'church', title: 'Church', color: '#fffac8', ru: 'Церкви' },
        { id: 'std-cinema', group: 'cinema', title: 'Cinema', color: '#800000', ru: 'Кинотеатры' },
        { id: 'std-ems', group: 'ems', title: 'Ems', color: '#aaffc3', ru: 'Медики' },
        { id: 'std-market', group: 'market', title: 'Market', color: '#808000', ru: 'Рынки' },
        { id: 'std-special-tuning', group: 'special-tuning', title: 'Special Tuning', color: '#ffd8b1', ru: 'Тюнинг' },
        { id: 'std-utilization', group: 'utilization', title: 'Utilization', color: '#000075', ru: 'Утилизация' },
        { id: 'std-aircraft-spawn', group: 'aircraft-spawn', title: 'Aircraft Spawn', color: '#808080', ru: 'Спавн самолётов' },
        { id: 'std-airport', group: 'airport', title: 'Airport', color: '#ffffff', ru: 'Аэропорты' },
        { id: 'std-anchor', group: 'anchor', title: 'Anchor', color: '#000000', ru: 'Якорь' },
        { id: 'std-arm', group: 'arm', title: 'Arm', color: '#e6194B', ru: 'Армрестлинг' },
        { id: 'std-biker', group: 'biker', title: 'Biker', color: '#3cb44b', ru: 'Байкеры' },
        { id: 'std-lscsd', group: 'lscsd', title: 'Lscsd', color: '#4363d8', ru: 'LSCSD' },
        { id: 'std-lspd', group: 'lspd', title: 'Lspd', color: '#f58231', ru: 'LSPD' },
        { id: 'std-arena', group: 'arena', title: 'Arena', color: '#911eb4', ru: 'Арена' },
        { id: 'std-ballas', group: 'ballas', title: 'Ballas', color: '#46f0f0', ru: 'Баллас' },
        { id: 'std-betting', group: 'betting', title: 'Betting', color: '#f032e6', ru: 'Ставки' },
        { id: 'std-bike-spawn', group: 'bike-spawn', title: 'Bike Spawn', color: '#bcf60c', ru: 'Спавн мото' },
        { id: 'std-bloods', group: 'bloods', title: 'Bloods', color: '#fabebe', ru: 'Bloods' },
        { id: 'std-car-market', group: 'car-market', title: 'Car Market', color: '#008080', ru: 'Авторынок' },
        { id: 'std-casino', group: 'casino', title: 'Casino', color: '#e6beff', ru: 'Казино' },
        { id: 'std-container', group: 'container', title: 'Container', color: '#9a6324', ru: 'Контейнеры' },
        { id: 'std-court', group: 'court', title: 'Court', color: '#fffac8', ru: 'Суд' },
        { id: 'std-driving-school', group: 'driving-school', title: 'Driving School', color: '#808000', ru: 'Автошкола' },
        { id: 'std-famillies', group: 'famillies', title: 'Famillies', color: '#ffd8b1', ru: 'Фамилии' },
        { id: 'std-fib', group: 'fib', title: 'Fib', color: '#000075', ru: 'FIB' },
        { id: 'std-flying-school', group: 'flying-school', title: 'Flying School', color: '#808080', ru: 'Лётная школа' },
        { id: 'std-government', group: 'government', title: 'Government', color: '#ffffff', ru: 'Правительство' },
        { id: 'std-gym', group: 'gym', title: 'Gym', color: '#000000', ru: 'Спортзалы' },
        { id: 'std-jail', group: 'jail', title: 'Jail', color: '#e6194B', ru: 'Тюрьма' },
        { id: 'std-marabunta', group: 'marabunta', title: 'Marabunta', color: '#3cb44b', ru: 'Марабунта' },
        { id: 'std-marketplace', group: 'marketplace', title: 'Marketplace', color: '#ffe119', ru: 'Маркетплейс' },
        { id: 'std-nettle-grower', group: 'nettle-grower', title: 'Nettle Grower', color: '#4363d8', ru: 'Крапива' },
        { id: 'std-parking-fine', group: 'parking-fine', title: 'Parking Fine', color: '#f58231', ru: 'Штрафстоянка' },
        { id: 'std-sang', group: 'sang', title: 'Sang', color: '#911eb4', ru: 'SANG' },
        { id: 'std-strip-club', group: 'strip-club', title: 'Strip Club', color: '#46f0f0', ru: 'Стрип-клуб' },
        { id: 'std-university', group: 'university', title: 'University', color: '#f032e6', ru: 'Университет' },
        { id: 'std-vagos', group: 'vagos', title: 'Vagos', color: '#bcf60c', ru: 'Вагос' },
        { id: 'std-vehicle-registration', group: 'vehicle-registration', title: 'Vehicle Registration', color: '#fabebe', ru: 'Регистрация ТС' },
        { id: 'std-weazle-news', group: 'weazle-news', title: 'Weazle News', color: '#008080', ru: 'Weazel News' },
        { id: 'std-wolf', group: 'wolf', title: 'Wolf', color: '#e6beff', ru: 'Волк' },
    ];
    STANDARD_ZONE_DEFS.forEach(g => GAME_ZONES.push({
        id: g.id, titles: [g.ru || g.title, g.title, g.title], color: g.color, icon: 'map-pin',
        url: 'markers/standard.json', group: g.group, descriptionFilter: g.descriptionFilter, standard: true
    }));

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

    function parseZonePoints(raw, options) {
        const opts = options || {};
        if (!Array.isArray(raw)) return [];
        const out = [];
        raw.forEach((item, ri) => {
            if (!item || typeof item !== 'object') return;
            const source = (item.data && typeof item.data === 'object') ? item.data : item;
            let x, y, name;
            if (Array.isArray(source.point) && source.point.length >= 2) {
                x = Number(source.point[0]); y = Number(source.point[1]);
            } else if (source.x !== undefined || source.y !== undefined) {
                x = Number(source.x); y = Number(source.y);
            } else {
                return;
            }
            const g = opts.direct ? { x, y } : wikiToGame(x, y);
            if (!g) return;
            name = typeof source.name === 'string' ? source.name : '';
            const pt = { x: g.x, y: g.y, name, ri };
            if (typeof source.description === 'string' && source.description.trim()) pt.description = source.description.trim();
            if (typeof source.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(source.color)) pt.color = source.color;
            if (source.style && typeof source.style.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(source.style.color)) pt.color = source.style.color;
            if (typeof source.group === 'string' && source.group) pt.group = source.group;
            if (typeof source.category === 'string' && source.category) pt.group = source.category;
            if (typeof source.icon === 'string' && source.icon) pt.icon = source.icon;
            out.push(pt);
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
                zone: typeof item.zone === 'string' ? item.zone : '',
                points: pts
            });
        });
        return snapPolygonVertices(out, tolerance === undefined ? 1 : tolerance);
    }

    function parseZoneFile(raw, options) {
        if (Array.isArray(raw)) return { points: parseZonePoints(raw, options), polygons: [] };
        if (!raw || typeof raw !== 'object') return { points: [], polygons: [] };
        return {
            points: parseZonePoints(raw.points || [], options),
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
                skipPseudo: true,
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
                skipPseudo: (settings.opacity ?? 1) >= 1,
                convertedFrom: zoneId
            };
            if (settings.strokeWidth != null) {
                item.hasStroke = true;
                item.strokeColor = settings.strokeColor || color;
                item.strokeWidth = settings.strokeWidth;
                item.strokePattern = 'solid';
            }
            figures.push(item);
        });
        return figures;
    }

    // isGame=true: вход уже в игровых координатах (ПКМ-копия с вики) —
    // переводим обратно в вики-пространство, дальше конвейер общий.
    function parsePastedPoints(text, isGame) {
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
            let cleanName = parts.slice(2).join(usedComma ? ', ' : ' ').replace(/^[-–—]\s*/, '');
            let color = null;
            const colorTail = cleanName.match(/(#[0-9a-fA-F]{6})\s*$/);
            if (colorTail) {
                color = colorTail[1].toLowerCase();
                cleanName = cleanName.slice(0, colorTail.index).trim();
            }
            const pt = { point: isGame ? [y, x] : [x, y], name: cleanName };
            if (color) pt.color = color;
            out.push(pt);
        });
        return out;
    }

    function normalizeMarkerStyle(ms, defColor) {
        const src = (ms && typeof ms === 'object') ? ms : {};
        const out = { color: defColor || '#ffffff', outline: '#ffffff', outlineStyle: 'solid', gap: 0, width: 2, dash: 3, dashGap: 2, dot: 1.5, size: 6, label: false, labelSize: 1, labelHeight: 2, labelTemplate: '{name}', labelColor: '#ffffff', labelOutline: '#000000', labelOutlineSize: 2, useIcon: false, fill: true };
        if (typeof src.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(src.color)) out.color = src.color;
        if (typeof src.outline === 'string' && /^#[0-9a-fA-F]{6}$/.test(src.outline)) out.outline = src.outline;
        if (src.outlineStyle === 'dashed' || src.outlineStyle === 'dashdot' || src.outlineStyle === 'none') out.outlineStyle = src.outlineStyle;
        // Размах — в метрах от центра (как радиус в игре), не в процентах.
        if (Number.isFinite(src.gap)) out.gap = Math.min(5000, Math.max(0, src.gap));
        if (Number.isFinite(src.width)) out.width = Math.min(5000, Math.max(0.2, src.width));
        if (Number.isFinite(src.dash)) out.dash = Math.min(5000, Math.max(0.5, src.dash));
        if (Number.isFinite(src.dashGap)) out.dashGap = Math.min(5000, Math.max(0.5, src.dashGap));
        if (Number.isFinite(src.dot)) out.dot = Math.min(5000, Math.max(0.5, src.dot));
        if (Number.isFinite(src.size)) out.size = Math.min(40, Math.max(1, src.size));
        if (src.label === true) out.label = true;
        if (Number.isFinite(src.labelSize)) out.labelSize = Math.min(100, Math.max(1, src.labelSize));
        if (typeof src.labelTemplate === 'string') out.labelTemplate = src.labelTemplate.slice(0, 120);
        if (Number.isFinite(src.labelHeight)) out.labelHeight = Math.min(500, Math.max(0, src.labelHeight));
        if (typeof src.labelColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(src.labelColor)) out.labelColor = src.labelColor;
        if (typeof src.labelOutline === 'string' && /^#[0-9a-fA-F]{6}$/.test(src.labelOutline)) out.labelOutline = src.labelOutline;
        if (Number.isFinite(src.labelOutlineSize)) out.labelOutlineSize = Math.min(100, Math.max(0, src.labelOutlineSize));
        if (src.useIcon === true) out.useIcon = true;
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
    window.GameZones.GAME_ZONES.forEach(def => { state[def.id] = { on: false, group: null, points: [], polygons: [], loading: false, customIcon: null, customRaw: [], markerStyle: null, labelOverrides: {}, show: 'both' }; });

    function markerStyleOf(def) {
        const st = state[def.id];
        const style = window.GameZones.normalizeMarkerStyle(st && st.markerStyle, def.color);
        if (!st || !st.markerStyle || !Number.isFinite(st.markerStyle.size)) style.size = markerSize;
        return style;
    }

    function markerLabelText(point, style) {
        const numberMatch = String(point.name || '').match(/(?:#\s*)?(\d+)\s*$/);
        return (style.labelTemplate || '{name}')
            .replace(/\{name\}/gi, String(point.name || '').trim())
            .replace(/\{n\}/gi, numberMatch ? numberMatch[1] : '')
            .trim();
    }

    function wrapMarkerLabel(text) {
        const lines = [];
        String(text || '').split(/\r?\n/).forEach(rawLine => {
            let line = '';
            rawLine.trim().split(/\s+/).filter(Boolean).forEach(word => {
                const next = line ? line + ' ' + word : word;
                if (line && next.length > 14) { lines.push(line); line = word; }
                else line = next;
            });
            if (line) lines.push(line);
        });
        return lines.length ? lines.join('\n') : String(text || '');
    }

    async function syncMarkerTextLayers(def) {
        const st = state[def.id];
        if (!window.replaceMarkerTextLayers || !st) return;
        st.labelRevision = (st.labelRevision || 0) + 1;
        if (st.labelSyncing) return;
        st.labelSyncing = true;
        do {
        const revision = st.labelRevision;
        const style = markerStyleOf(def);
        const items = st.points.map((point, pointIndex) => {
            const local = st.labelOverrides && st.labelOverrides[String(pointIndex)];
            const pointStyle = local ? Object.assign({}, style, local.style || {}) : style;
            if (!point.name || (local ? local.enabled !== true : !style.label)) return null;
            const text = markerLabelText(point, pointStyle);
            return {
            name: text,
            icon: 'type',
            position: { x: point.x, y: point.y + pointStyle.size + pointStyle.labelHeight, z: 50 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: pointStyle.labelSize * 0.5, y: pointStyle.labelSize * 0.5, z: 1 },
            isText: true,
            text: wrapMarkerLabel(text),
            quality: 8,
            textAlign: 'center',
            textLineHeight: 1.2,
            color: pointStyle.labelColor,
            opacity: 1,
            hasStroke: pointStyle.labelOutlineSize > 0,
            strokeColor: pointStyle.labelOutline,
            strokeWidth: pointStyle.labelOutlineSize,
            strokePattern: 'solid',
            strokeCap: 'round',
            convertedFrom: def.id,
            isMarkerLabel: true,
            markerPointIndex: st.points.indexOf(point),
            layerGroup: labelOf(def)
            };
        }).filter(Boolean);
        await window.replaceMarkerTextLayers(def.id, items);
        if (st.labelRevision === revision) break;
        } while (st.labelRevision !== 0);
        st.labelSyncing = false;
    }
    window.refreshGameZoneTextLabels = async function() {
        await Promise.all(window.GameZones.GAME_ZONES.filter(def => state[def.id] && state[def.id].on).map(syncMarkerTextLayers));
    };

    function setMarkerStyle(def, patch) {
        const st = state[def.id];
        if (!st) return;
        st.markerStyle = Object.assign({}, st.markerStyle, patch);
        rebuildZoneGroup(def);
        if (window.updatePixelImageLayerScale) window.updatePixelImageLayerScale(def.id, markerStyleOf(def).size / 5);
        if (st.on) syncMarkerTextLayers(def);
    }

    let selectedZoneId = null;
    let selectedPointIdx = -1;
    let selectedCustomIdx = -1;
    let zoneSearchQuery = '';
    const zoneMatchesQuery = (def) => {
        const q = zoneSearchQuery.trim().toLowerCase();
        if (!q) return true;
        return def.titles.some(t => String(t || '').toLowerCase().includes(q));
    };

    // Зоны-полигоны (зелёные/красные/собирательство/клады): только настройки слоя.
    // Остальные метки (контрабанда/мусорки/телефоны/свои): только настройки меток.
    const LAYER_ONLY_ZONES = ['zz', 'red', 'gathering', 'treasure'];

    window.selectGameZone = function(id, pointIdx) {
        selectedZoneId = id;
        selectedPointIdx = (Number.isInteger(pointIdx) && pointIdx >= 0) ? pointIdx : -1;
        selectedCustomIdx = (id === 'custom' && Number.isInteger(pointIdx) && pointIdx >= 0) ? pointIdx : -1;
        renderMarkerPanel();
        window.refreshGameZonesList();
        if (window.refreshVectorLayersList) window.refreshVectorLayersList();
    };

    function selectedZoneDef() {
        return window.GameZones.GAME_ZONES.find(d => d.id === selectedZoneId) || null;
    }

    // Видимые полигоны зоны с учётом переключателя подуровней
    // (аирдропы: внешняя r300 / внутренняя r150).
    function visiblePolygons(def) {
        const st = def && state[def.id];
        if (!st || !Array.isArray(st.polygons)) return [];
        if (def.id !== 'airdrop' || !st.show || st.show === 'both') return st.polygons;
        return st.polygons.filter(p => p && p.zone === st.show);
    }

    function toPanelHex(c) { try { return '#' + new THREE.Color(c).getHexString(); } catch (e) { return '#ffffff'; } }

    function renderMarkerPanel() {
        const panel = document.getElementById('markerPropsPanel');
        if (!panel) return;
        const def = selectedZoneDef();
        // Зоны-полигоны настраиваются только через слой фигуры —
        // панель меток для них мертва, не показываем.
        if (!def || LAYER_ONLY_ZONES.includes(def.id)) { panel.classList.add('hidden'); return; }
        panel.classList.remove('hidden');
        const st = state[def.id];
        const ms = markerStyleOf(def);
        const nameEl = document.getElementById('markerPropsName');
        const selectedPoint = st && selectedPointIdx >= 0 && st.points[selectedPointIdx];
        if (nameEl) nameEl.textContent = (selectedPoint && selectedPoint.name) || labelOf(def);
        const descriptionEl = document.getElementById('markerPropsDescription');
        if (descriptionEl) {
            descriptionEl.textContent = (selectedPoint && selectedPoint.description) || '';
            descriptionEl.classList.toggle('hidden', !(selectedPoint && selectedPoint.description));
        }
        const airdropRow = document.getElementById('markerAirdropRow');
        const airdropShow = document.getElementById('markerAirdropShow');
        const isAirdrop = def.id === 'airdrop';
        if (airdropRow) airdropRow.classList.toggle('hidden', !isAirdrop);
        if (airdropRow) airdropRow.classList.toggle('flex', isAirdrop);
        if (airdropShow) airdropShow.value = (st && st.show) || 'both';
        // Своя метка, выбранная кликом: её личный цвет (иначе общий цвет слоя).
        const customRow = document.getElementById('markerCustomColorRow');
        const customColorEl = document.getElementById('markerCustomColor');
        const customPt = (def.id === 'custom' && st && selectedCustomIdx >= 0 && st.points[selectedCustomIdx]) || null;
        const customRi = customPt ? customPt.ri : null;
        const customRawPt = (customRi !== null && customRi !== undefined && st.customRaw && st.customRaw[customRi]) || null;
        if (customRow) customRow.classList.toggle('hidden', !customPt);
        if (customRow) customRow.classList.toggle('flex', !!customPt);
        if (customColorEl) customColorEl.value = toPanelHex((customRawPt && customRawPt.color) || ms.color);
        if (customColorEl) customColorEl.dataset.ri = (customRi !== null && customRi !== undefined) ? customRi : '';
        const colorEl = document.getElementById('markerPropColor');
        const outlineEl = document.getElementById('markerPropOutline');
        const styleEl = document.getElementById('markerPropOutlineStyle');
        const noteEl = document.getElementById('markerSvgNote');
        const lockedInner = !!(st && st.customIcon);
        if (colorEl) { colorEl.value = toPanelHex(ms.color); colorEl.disabled = lockedInner; }
        const fillEl = document.getElementById('markerPropFill');
        if (fillEl) { fillEl.checked = ms.fill !== false; fillEl.disabled = lockedInner; }
        // Обводка кольца при своей иконке остаётся настраиваемой.
        if (outlineEl) { outlineEl.value = toPanelHex(ms.outline); outlineEl.disabled = false; }
        if (styleEl) { styleEl.value = ms.outlineStyle; styleEl.disabled = false; }
        if (noteEl) noteEl.classList.toggle('hidden', !lockedInner);
        const gapPct = Math.round(ms.gap), widthPct = Math.round(ms.width);
        const gapEl = document.getElementById('markerPropGap');
        const gapNum = document.getElementById('markerPropGapNum');
        const widthEl = document.getElementById('markerPropWidth');
        const widthNum = document.getElementById('markerPropWidthNum');
        const labelEl = document.getElementById('markerPropLabel');
        const localLabelRow = document.getElementById('markerPropLocalLabelRow');
        const localLabelEl = document.getElementById('markerPropLocalLabel');
        const sizeEl = document.getElementById('markerPropSize');
        const sizeNum = document.getElementById('markerPropSizeNum');
        const labelSizeEl = document.getElementById('markerPropLabelSize');
        const labelSizeNum = document.getElementById('markerPropLabelSizeNum');
        const labelHeightEl = document.getElementById('markerPropLabelHeight');
        const labelHeightNum = document.getElementById('markerPropLabelHeightNum');
        const labelTemplateEl = document.getElementById('markerPropLabelTemplate');
        const labelColorEl = document.getElementById('markerPropLabelColor');
        const labelOutlineEl = document.getElementById('markerPropLabelOutline');
        const labelOutlineSizeEl = document.getElementById('markerPropLabelOutlineSize');
        const labelOutlineSizeNum = document.getElementById('markerPropLabelOutlineSizeNum');
        const iconEnabledEl = document.getElementById('markerPropIconEnabled');
        const iconLabelEl = document.getElementById('markerPropIconLabel');
        const iconReset = document.getElementById('markerPropIconReset');
        if (gapEl) { gapEl.value = gapPct; gapEl.disabled = false; }
        if (gapNum) { gapNum.value = gapPct; gapNum.disabled = false; }
        if (widthEl) { widthEl.value = widthPct; widthEl.disabled = false; }
        if (widthNum) { widthNum.value = widthPct; widthNum.disabled = false; }
        if (labelEl) labelEl.checked = ms.label === true;
        const localOverride = (selectedPointIdx >= 0 && st.labelOverrides && st.labelOverrides[String(selectedPointIdx)]) || null;
        if (localLabelRow) localLabelRow.classList.toggle('hidden', selectedPointIdx < 0 || !st.points[selectedPointIdx]);
        if (localLabelEl) localLabelEl.checked = !!(localOverride && localOverride.enabled === true);
        if (sizeEl) sizeEl.value = ms.size;
        if (sizeNum) sizeNum.value = ms.size;
        if (labelSizeEl) labelSizeEl.value = ms.labelSize;
        if (labelSizeNum) labelSizeNum.value = ms.labelSize;
        if (labelHeightEl) labelHeightEl.value = ms.labelHeight;
        if (labelHeightNum) labelHeightNum.value = ms.labelHeight;
        if (labelTemplateEl) labelTemplateEl.value = ms.labelTemplate || '{name}';
        if (labelColorEl) labelColorEl.value = ms.labelColor;
        if (labelOutlineEl) labelOutlineEl.value = ms.labelOutline;
        if (labelOutlineSizeEl) labelOutlineSizeEl.value = ms.labelOutlineSize;
        if (labelOutlineSizeNum) labelOutlineSizeNum.value = ms.labelOutlineSize;
        if (iconEnabledEl) iconEnabledEl.checked = ms.useIcon === true;
        if (iconLabelEl) iconLabelEl.classList.remove('opacity-50');
        const dashEl = document.getElementById('markerPropDash');
        const dashGapEl = document.getElementById('markerPropDashGap');
        const dotEl = document.getElementById('markerPropDot');
        if (dashEl) dashEl.value = ms.dash;
        if (dashGapEl) dashGapEl.value = ms.dashGap;
        if (dotEl) dotEl.value = ms.dot;
        if (iconReset) iconReset.classList.toggle('hidden', !lockedInner);
    }

    function parseCustomIconShapes(def, sizeOverride) {
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
            const scale = Math.max(size.x, size.y) > 1e-9 ? ((sizeOverride || markerSize) * 2) / Math.max(size.x, size.y) : 1;
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
    const markerLabelTextureCache = new Map();

    function buildGroup(def, data) {
        const points = data.points || [];
        const polygons = data.polygons || [];
        const mstyle = markerStyleOf(def);
        const pointSize = mstyle.size;
        const group = new THREE.Group();
        group.position.z = 50;
        group.userData.isGameZone = true;
        group.userData.zoneId = def.id;
        group.userData.mats = [];
        const outerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(mstyle.outline), side: THREE.DoubleSide, transparent: true, opacity: 1, depthTest: false, depthWrite: false });
        const innerMatShared = new THREE.MeshBasicMaterial({ color: new THREE.Color(mstyle.color), side: THREE.DoubleSide, transparent: true, opacity: 1, depthTest: false, depthWrite: false });
        group.userData.mats.push(outerMat, innerMatShared);
        const outerR = pointSize, innerR = pointSize * 0.71;
        const zoneState = state[def.id];
        const iconParts = (zoneState && zoneState.customIcon && mstyle.useIcon) ? parseCustomIconShapes(def, pointSize) : null;
        const iconMats = [];
        if (iconParts) iconParts.forEach(part => {
            // Иконка всегда в transparent-проходе (поверх translucent-заливок зон),
            // иначе заливка перекрывает её при любом z/renderOrder.
            const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(part.color), side: THREE.DoubleSide, transparent: true, opacity: part.opacity, depthTest: false, depthWrite: false });
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
                // Своя иконка не отменяет обводку кольца — рисуем её ниже как обычно.
            }
            const hasPointIcon = mstyle.useIcon && !iconParts && typeof pt.icon === 'string' && pt.icon.length > 0;
            if (hasPointIcon && !window.addPixelImageLayer) {
                const file = pt.icon.split('/').pop();
                if (file) {
                    try {
                        const loader = new THREE.TextureLoader();
                        loader.load('icons/' + file, (texture) => {
                            const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
                            const sprite = new THREE.Sprite(mat);
                            sprite.position.set(pt.x, pt.y, 0.02);
                            sprite.scale.set(pointSize * 2, pointSize * 2, 1);
                            sprite.renderOrder = 1002.2;
                            sprite.userData.isGameZone = true;
                            group.userData.mats.push(mat);
                            group.add(sprite);
                            if (window.requestSceneRender) window.requestSceneRender();
                        }, undefined, () => {});
                    } catch (e) { /* PNG is optional */ }
                }
            }
            if (mstyle.label && pt.name && typeof document !== 'undefined' && !window.replaceMarkerTextLayers) {
                const numberMatch = String(pt.name).match(/(?:#\s*)?(\d+)\s*$/);
                const markerName = mstyle.labelTemplate
                    ? mstyle.labelTemplate.replace(/\{name\}/gi, String(pt.name).trim()).replace(/\{n\}/gi, numberMatch ? numberMatch[1] : '').trim()
                    : String(pt.name).trim();
                const lines = [];
                markerName.split(/\r?\n/).forEach(rawLine => {
                    const words = rawLine.trim().split(/\s+/).filter(Boolean);
                    let line = '';
                    words.forEach(word => {
                        const next = line ? line + ' ' + word : word;
                        if (line && next.length > 14) { lines.push(line); line = word; }
                        else line = next;
                    });
                    if (line) lines.push(line);
                });
                if (lines.length === 0) lines.push(markerName || String(pt.name).trim());
                const fontSize = Math.round(34 * mstyle.labelSize);
                const lineHeight = Math.round(fontSize * 1.35);
                const textureKey = [markerName, fontSize, mstyle.labelColor, mstyle.labelOutline, mstyle.labelOutlineSize].join('|');
                let cachedLabel = markerLabelTextureCache.get(textureKey);
                if (!cachedLabel) {
                    const canvas = document.createElement('canvas');
                    canvas.width = 1024; canvas.height = Math.max(lineHeight, lines.length * lineHeight);
                    const ctx = canvas.getContext('2d');
                    ctx.font = 'bold ' + fontSize + 'px Arial';
                    canvas.width = Math.ceil(Math.max(...lines.map(text => ctx.measureText(text).width), 1) + fontSize * 0.8);
                    canvas.height = Math.max(lineHeight, lines.length * lineHeight);
                    ctx.font = 'bold ' + fontSize + 'px Arial';
                    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                    ctx.lineWidth = mstyle.labelOutlineSize * mstyle.labelSize; ctx.strokeStyle = mstyle.labelOutline;
                    lines.forEach((text, index) => {
                        const y = lineHeight / 2 + index * lineHeight;
                        ctx.strokeText(text, canvas.width / 2, y);
                        ctx.fillStyle = mstyle.labelColor; ctx.fillText(text, canvas.width / 2, y);
                    });
                    cachedLabel = { texture: new THREE.CanvasTexture(canvas), width: canvas.width, height: canvas.height };
                    markerLabelTextureCache.set(textureKey, cachedLabel);
                }
                const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: cachedLabel.texture, transparent: true, depthTest: false, depthWrite: false }));
                label.position.set(pt.x, pt.y + pointSize + mstyle.labelHeight, 0.03);
                const labelHeight = 0.75 * lines.length * mstyle.labelSize;
                label.scale.set(labelHeight * (cachedLabel.width / cachedLabel.height), labelHeight, 1);
                label.renderOrder = 1002.3;
                label.userData.isGameZone = true;
                group.userData.mats.push(label.material);
                group.add(label);
            }
            const gapAbs = mstyle.gap;
            const widthAbs = Math.max(0.2, mstyle.width);
            // Размах задаёт радиус от центра метки, а не расстояние от её края.
            const ringInnerR = gapAbs > 0 ? gapAbs : innerR;
            const ringOuterR = ringInnerR + widthAbs;
            const hasRing = !hasPointIcon && mstyle.outlineStyle !== 'none' && ringOuterR > ringInnerR;
            const outer = (hasRing && mstyle.outlineStyle === 'solid') ? new THREE.Mesh(new THREE.RingGeometry(Math.max(0.01, ringInnerR), ringOuterR, 40), outerMat) : null;
            if (outer) {
                outer.position.set(pt.x, pt.y, 0);
                outer.renderOrder = 1002;
                outer.userData.isGameZone = true;
                group.add(outer);
            }
            if (mstyle.outlineStyle === 'dashed' && hasRing) {
                const midR = Math.max(0.5, (ringInnerR + ringOuterR) / 2);
                const dashLen = Math.max(0.5, mstyle.dash);
                const gapLen = Math.max(0.5, mstyle.dashGap);
                const period = dashLen + gapLen;
                const count = Math.max(3, Math.round((2 * Math.PI * midR) / period));
                const step = (Math.PI * 2) / count;
                const dashAngle = Math.min(step * 0.95, dashLen / midR);
                for (let k = 0; k < count; k++) {
                    const dash = new THREE.Mesh(new THREE.RingGeometry(ringInnerR, ringOuterR, 8, 1, k * step, dashAngle), outerMat);
                    dash.position.set(pt.x, pt.y, 0);
                    dash.renderOrder = 1002;
                    dash.userData.isGameZone = true;
                    group.add(dash);
                }
            }
            if (mstyle.outlineStyle === 'dashdot' && hasRing) {
                // Штрихпунктир: дуги-штрихи линиями + точки кружками.
                const midR = Math.max(0.5, (ringInnerR + ringOuterR) / 2);
                 const dashLen = Math.max(0.5, mstyle.dash);
                 const gapLen = Math.max(0.5, mstyle.dashGap);
                 const dotD = Math.max(0.5, mstyle.dot);
                const period = dashLen + gapLen + dotD + gapLen;
                const n = Math.max(4, Math.round(2 * Math.PI * midR / period));
                const lineMat = new THREE.LineBasicMaterial({ color: new THREE.Color(mstyle.outline), transparent: true, opacity: 1, depthTest: false, depthWrite: false });
                const dotMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(mstyle.outline), side: THREE.DoubleSide, transparent: true, opacity: 1, depthTest: false, depthWrite: false });
                group.userData.mats.push(lineMat, dotMat);
                for (let k = 0; k < n; k++) {
                    const a0 = (k / n) * Math.PI * 2;
                    const a1 = a0 + (dashLen / period) * (Math.PI * 2 / n);
                    const arc = [];
                    for (let s = 0; s <= 8; s++) {
                        const a = a0 + (a1 - a0) * (s / 8);
                        arc.push(new THREE.Vector3(midR * Math.cos(a), midR * Math.sin(a), 0));
                    }
                    const dash = new THREE.Line(new THREE.BufferGeometry().setFromPoints(arc), lineMat);
                    dash.position.set(pt.x, pt.y, 0);
                    dash.renderOrder = 1002;
                    dash.userData.isGameZone = true;
                    group.add(dash);
                    const amid = a0 + ((dashLen + gapLen + dotD / 2) / period) * (Math.PI * 2 / n);
                    const dot = new THREE.Mesh(new THREE.CircleGeometry(Math.max(0.05, dotD / 2), 10), dotMat);
                    dot.position.set(pt.x + midR * Math.cos(amid), pt.y + midR * Math.sin(amid), 0.01);
                    dot.renderOrder = 1002.1;
                    dot.userData.isGameZone = true;
                    group.add(dot);
                }
            }
            // Личный цвет точки — только у своих меток (выбран пользователем).
            // Цвета из файлов данных стиль слоя не перебивают.
            const ptColor = (def.id === 'custom' && typeof pt.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(pt.color)) ? pt.color : null;
            const innerMat = ptColor
                ? new THREE.MeshBasicMaterial({ color: new THREE.Color(ptColor), side: THREE.DoubleSide, transparent: true, opacity: 1, depthTest: false, depthWrite: false })
                : null;
            if (innerMat) group.userData.mats.push(innerMat);
            const inner = new THREE.Mesh(new THREE.CircleGeometry(innerR, 20), innerMat || innerMatShared);
            inner.position.set(pt.x, pt.y, 0.01);
            inner.renderOrder = 1002.1;
            inner.userData.isGameZone = true;
            if (mstyle.fill && !iconParts && !hasPointIcon) group.add(inner);
        });
        polygons.forEach(poly => {
            const shape = new THREE.Shape(poly.points.map(p => new THREE.Vector2(p.x, p.y)));
            const fillMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(poly.color || def.color), side: THREE.DoubleSide, transparent: true, opacity: 0.35, depthTest: false, depthWrite: false });
            const lineMat = new THREE.LineBasicMaterial({ color: new THREE.Color(def.overlayOutline || poly.color || def.color), transparent: true, opacity: 1, depthTest: false, depthWrite: false });
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

    // Общий кэш JSON слоёв: стандартные группы делят один файл.
    const zoneFileCache = {};
    const iconDataCache = {};
    async function fetchIconDataUrl(iconPath) {
        const file = String(iconPath || '').split('/').pop();
        if (!file) return null;
        if (!iconDataCache[file]) {
            iconDataCache[file] = fetch('icons/' + file).then(response => {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.blob();
            }).then(blob => new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            }));
        }
        return iconDataCache[file];
    }
    async function fetchZoneJson(def) {
        if (!def.url) return null;
        if (!zoneFileCache[def.url]) {
            zoneFileCache[def.url] = (async () => {
                const response = await fetch(def.url, { cache: 'no-store' });
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.json();
            })();
        }
        return zoneFileCache[def.url];
    }

    // Точки одной группы стандартных меток (def.group), остальные — как есть.
    function filterGroupPoints(def, points) {
        if (def.descriptionFilter) {
            const filter = def.descriptionFilter.toLowerCase();
            return (Array.isArray(points) ? points : []).filter(p => p && typeof p.description === 'string' && p.description.toLowerCase().includes(filter));
        }
        if (!def.group || !Array.isArray(points)) return points;
        return points.filter(p => p && p.group === def.group);
    }

    async function addZoneIconMeshes(def) {
        const st = state[def.id];
        if (!window.addPixelImageLayer || !st || !markerStyleOf(def).useIcon || st.customIcon) return;
        const points = st.points.filter(point => point.icon);
        if (points.length === 0) return;
        for (let i = 0; i < points.length; i++) {
            window.showLoading?.(t('Загрузка иконок...', 'Loading icons...', 'Завантаження іконок...'), `${i + 1}/${points.length}`);
            if (window.yieldToBrowser) await window.yieldToBrowser();
            const point = points[i];
            try {
                const dataUrl = await fetchIconDataUrl(point.icon);
                if (dataUrl) await window.addPixelImageLayer(dataUrl, point.name || def.id, point.x, point.y, markerStyleOf(def).size / 5, def.id, labelOf(def));
            } catch (error) { console.warn('Marker icon mesh failed:', point.icon, error); }
        }
        window.hideLoading?.();
    }

    async function setZoneOn(def, checkbox) {
        const st = state[def.id];
        if (!def.url && !def.custom) return;
        if (st.on || st.loading) return;
        if (def.group === 'gunshop') {
            st.customIcon = null;
        }
        st.loading = true;
        window.refreshGameZonesList();
        try {
            if (!st.group) {
                if (def.url) {
                    st.loading = true;
                    const raw = await fetchZoneJson(def);
                    // Координаты стандартных меток в JSON записаны в исходной ориентации карты.
                    // Перевод через wikiToGame разворачивает их на 90 градусов влево.
                    const data = window.GameZones.parseZoneFile(raw, { direct: def.directCoordinates !== undefined ? def.directCoordinates : !def.standard });
                    st.points = def.id === 'airdrop' ? [] : filterGroupPoints(def, data.points);
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
            await addZoneIconMeshes(def);
            await syncMarkerTextLayers(def);
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
                    best = { id: def.id, index: idx };
                }
            });
            return best;
        } catch (e) { return null; }
    };

    window.clearGameZoneSelection = function() {
        if (!selectedZoneId && selectedPointIdx < 0 && selectedCustomIdx < 0) return;
        selectedZoneId = null;
        selectedPointIdx = -1;
        selectedCustomIdx = -1;
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
        const data = window.GameZones.parseZoneFile(await fetchZoneJson(def), { direct: def.directCoordinates !== undefined ? def.directCoordinates : !def.standard });
        st.points = def.id === 'airdrop' ? [] : filterGroupPoints(def, data.points);
        st.polygons = data.polygons;
        return { points: st.points, polygons: st.polygons };
    }

    window.convertZoneToFigures = async function(id) {
        const def = window.GameZones.GAME_ZONES.find(d => d.id === id);
        if (!def || !def.url || !window.loadVectorsFromJSON) return 0;
        if (!window.mapBounds) {
            if (window.showToast) window.showToast(t('Сначала загрузите карту', 'Load the map first', 'Спочатку завантажте карту'), 'error');
            return 0;
        }
        const data = await ensureZoneData(def);
        if (!data) return 0;
        const polys = (def.id === 'airdrop') ? visiblePolygons(def) : data.polygons;
        if (polys.length === 0) return 0;
        const existing = window.getVectorsForJSON ? window.getVectorsForJSON().filter(d => d.convertedFrom === id).length : 0;
        if (existing > 0) return 0;
            const label = def.titles[window.currentLang === 'en' ? 1 : window.currentLang === 'uk' ? 2 : 0];
            const fd = def.figureDefaults || {};
            const items = window.GameZones.polygonsToMergedFigures(polys, id, def.color, label, { opacity: fd.opacity ?? 1, strokeWidth: fd.strokeWidth ?? 0.4 });
        if (items.length === 0) return 0;
        await window.loadVectorsFromJSON(items, true);
        if (window.showToast) window.showToast(t('Создано фигур: ' + items.length, 'Created figures: ' + items.length, 'Створено фігур: ' + items.length));
        return items.length;
    };

    window.getGameZonesState = function() {
        const icons = {};
        const styles = {};
        const labels = {};
        window.GameZones.GAME_ZONES.forEach(d => {
            if (state[d.id] && state[d.id].customIcon) icons[d.id] = state[d.id].customIcon;
            if (state[d.id] && state[d.id].markerStyle) styles[d.id] = state[d.id].markerStyle;
            if (state[d.id] && state[d.id].labelOverrides && Object.keys(state[d.id].labelOverrides).length) labels[d.id] = state[d.id].labelOverrides;
        });
        return {
            on: window.GameZones.GAME_ZONES.filter(d => state[d.id] && state[d.id].on).map(d => d.id),
            markerSize: markerSize,
            v: 3,
            icons: icons,
            styles: styles,
            labels: labels,
            shows: Object.fromEntries(window.GameZones.GAME_ZONES.filter(d => state[d.id] && state[d.id].show && state[d.id].show !== 'both').map(d => [d.id, state[d.id].show])),
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
        const labels = saved.labels || {};
        Object.keys(labels).forEach(id => {
            if (state[id] && labels[id] && typeof labels[id] === 'object') state[id].labelOverrides = labels[id];
        });
        const shows = saved.shows || {};
        Object.keys(shows).forEach(id => {
            if (state[id] && (shows[id] === 'outer' || shows[id] === 'inner' || shows[id] === 'both')) state[id].show = shows[id];
        });
        const styles = saved.styles || {};
        // v2: размах в метрах; v3: толщина в метрах. Старые доли пересчитываем
        // через размер меток из того же сейва.
        const gapScale = (saved.v >= 2) ? 1 : (Number.isFinite(saved.markerSize) ? saved.markerSize : 6);
        const widthScale = (saved.v >= 3) ? 1 : (Number.isFinite(saved.markerSize) ? saved.markerSize : 6);
        Object.keys(styles).forEach(id => {
            const s = styles[id];
            if (!state[id] || !s || typeof s !== 'object') return;
            const patch = {};
            if (typeof s.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.color)) patch.color = s.color;
            if (typeof s.outline === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.outline)) patch.outline = s.outline;
            if (s.outlineStyle === 'dashed' || s.outlineStyle === 'dashdot' || s.outlineStyle === 'none') patch.outlineStyle = s.outlineStyle;
            if (Number.isFinite(s.gap)) patch.gap = Math.min(5000, Math.max(0, s.gap * gapScale));
            if (Number.isFinite(s.width)) patch.width = Math.min(5000, Math.max(0.2, s.width * widthScale));
            if (Number.isFinite(s.dash)) patch.dash = Math.min(5000, Math.max(0.5, s.dash));
            if (Number.isFinite(s.dashGap)) patch.dashGap = Math.min(5000, Math.max(0.5, s.dashGap));
            if (Number.isFinite(s.dot)) patch.dot = Math.min(5000, Math.max(0.5, s.dot));
            if (Number.isFinite(s.size)) patch.size = Math.min(40, Math.max(1, s.size));
            if (s.label === true) patch.label = true;
            if (Number.isFinite(s.labelSize)) patch.labelSize = Math.min(100, Math.max(1, s.labelSize));
            if (typeof s.labelTemplate === 'string') patch.labelTemplate = s.labelTemplate.slice(0, 120);
            if (Number.isFinite(s.labelHeight)) patch.labelHeight = Math.min(500, Math.max(0, s.labelHeight));
            if (typeof s.labelColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.labelColor)) patch.labelColor = s.labelColor;
            if (typeof s.labelOutline === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.labelOutline)) patch.labelOutline = s.labelOutline;
            if (Number.isFinite(s.labelOutlineSize)) patch.labelOutlineSize = Math.min(100, Math.max(0, s.labelOutlineSize));
            if (s.useIcon === true) patch.useIcon = true;
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
    // Толщина — метры напрямую, без процентов.
    (() => {
        const range = document.getElementById('markerPropWidth'), num = document.getElementById('markerPropWidthNum');
        if (!range || !num) return;
        const setM = (v) => {
            const def = selectedZoneDef(); if (!def) return;
            setMarkerStyle(def, { width: v });
        };
        range.addEventListener('input', () => { num.value = range.value; setM(parseFloat(range.value) || 0); });
        num.addEventListener('input', () => {
            let v = parseFloat(num.value);
            if (!Number.isFinite(v)) return;
            v = Math.min(parseFloat(range.max), Math.max(parseFloat(range.min), v));
            range.value = v;
            setM(v);
        });
    })();
    // Размах — метры напрямую, без процентов.
    (() => {
        const range = document.getElementById('markerPropGap'), num = document.getElementById('markerPropGapNum');
        if (!range || !num) return;
        const setM = (v) => {
            const def = selectedZoneDef(); if (!def) return;
            setMarkerStyle(def, { gap: v });
        };
        range.addEventListener('input', () => { num.value = range.value; setM(parseFloat(range.value) || 0); });
        num.addEventListener('input', () => {
            let v = parseFloat(num.value);
            if (!Number.isFinite(v)) return;
            v = Math.min(parseFloat(range.max), Math.max(parseFloat(range.min), v));
            range.value = v;
            setM(v);
        });
    })();
    // Параметры разметки штрихпунктирной линии — в метрах.
    ['markerPropDash', 'markerPropDashGap', 'markerPropDot'].forEach((id) => {
        const input = document.getElementById(id);
        if (!input) return;
        input.addEventListener('input', () => {
            const def = selectedZoneDef();
            const value = parseFloat(input.value);
            if (!def || !Number.isFinite(value)) return;
            const key = id === 'markerPropDash' ? 'dash' : id === 'markerPropDashGap' ? 'dashGap' : 'dot';
            setMarkerStyle(def, { [key]: Math.min(500, Math.max(0.5, value)) });
        });
    });
    document.getElementById('markerPropFill')?.addEventListener('change', (e) => {
        const def = selectedZoneDef(); if (!def) return;
        setMarkerStyle(def, { fill: e.target.checked });
        window.refreshGameZonesList();
    });
    document.getElementById('markerPropLabel')?.addEventListener('change', (e) => {
        const def = selectedZoneDef(); if (!def) return;
        const st = state[def.id];
        const patch = { label: e.target.checked };
        if (e.target.checked && (!st.markerStyle || !st.markerStyle.labelTemplate)) patch.labelTemplate = '{name}';
        setMarkerStyle(def, patch);
    });
    document.getElementById('markerPropLocalLabel')?.addEventListener('change', async (e) => {
        const def = selectedZoneDef();
        const st = def && state[def.id];
        if (!def || !st || selectedPointIdx < 0) return;
        const key = String(selectedPointIdx);
        st.labelOverrides = st.labelOverrides || {};
        if (e.target.checked) st.labelOverrides[key] = { enabled: true };
        else delete st.labelOverrides[key];
        if (st.on) await syncMarkerTextLayers(def);
        renderMarkerPanel();
    });
    let markerLabelTemplateTimer = 0;
    document.getElementById('markerPropLabelTemplate')?.addEventListener('input', (e) => {
        const def = selectedZoneDef(); if (!def) return;
        const value = String(e.target.value || '').slice(0, 120);
        clearTimeout(markerLabelTemplateTimer);
        markerLabelTemplateTimer = setTimeout(() => {
            if (selectedZoneDef() === def) setMarkerStyle(def, { labelTemplate: value });
        }, 300);
    });
    document.getElementById('markerPropLabelColor')?.addEventListener('input', (e) => {
        const def = selectedZoneDef(); if (!def) return;
        setMarkerStyle(def, { labelColor: e.target.value });
    });
    document.getElementById('markerPropLabelOutline')?.addEventListener('input', (e) => {
        const def = selectedZoneDef(); if (!def) return;
        setMarkerStyle(def, { labelOutline: e.target.value });
    });
    let markerLabelOutlineSizeTimer = 0;
    const setMarkerLabelOutlineSize = (value) => {
        const def = selectedZoneDef(); if (!def) return;
        const v = Math.min(100, Math.max(0, Number(value) || 0));
        const range = document.getElementById('markerPropLabelOutlineSize');
        const num = document.getElementById('markerPropLabelOutlineSizeNum');
        if (range) range.value = v;
        if (num) num.value = v;
        clearTimeout(markerLabelOutlineSizeTimer);
        markerLabelOutlineSizeTimer = setTimeout(() => {
            if (selectedZoneDef() === def) setMarkerStyle(def, { labelOutlineSize: v });
        }, 300);
    };
    document.getElementById('markerPropLabelOutlineSize')?.addEventListener('input', (e) => setMarkerLabelOutlineSize(e.target.value));
    document.getElementById('markerPropLabelOutlineSizeNum')?.addEventListener('input', (e) => setMarkerLabelOutlineSize(e.target.value));
    const setMarkerSize = (value) => {
        const def = selectedZoneDef(); if (!def) return;
        const v = Math.min(40, Math.max(1, Number(value) || 6));
        const sizeEl = document.getElementById('markerPropSize');
        const sizeNum = document.getElementById('markerPropSizeNum');
        if (sizeEl) sizeEl.value = v;
        if (sizeNum) sizeNum.value = v;
        setMarkerStyle(def, { size: v });
    };
    document.getElementById('markerPropSize')?.addEventListener('input', (e) => setMarkerSize(e.target.value));
    document.getElementById('markerPropSizeNum')?.addEventListener('input', (e) => setMarkerSize(e.target.value));
    let markerLabelSizeTimer = 0;
    const setMarkerLabelSize = (value) => {
        const def = selectedZoneDef(); if (!def) return;
        const v = Math.min(100, Math.max(1, Number(value) || 1));
        const range = document.getElementById('markerPropLabelSize');
        const num = document.getElementById('markerPropLabelSizeNum');
        if (range) range.value = v;
        if (num) num.value = v;
        clearTimeout(markerLabelSizeTimer);
        markerLabelSizeTimer = setTimeout(() => {
            if (selectedZoneDef() === def) setMarkerStyle(def, { labelSize: v });
        }, 300);
    };
    document.getElementById('markerPropLabelSize')?.addEventListener('input', (e) => setMarkerLabelSize(e.target.value));
    document.getElementById('markerPropLabelSizeNum')?.addEventListener('input', (e) => setMarkerLabelSize(e.target.value));
    let markerLabelHeightTimer = 0;
    const setMarkerLabelHeight = (value) => {
        const def = selectedZoneDef(); if (!def) return;
        const v = Math.min(500, Math.max(0, Number(value) || 0));
        const range = document.getElementById('markerPropLabelHeight');
        const num = document.getElementById('markerPropLabelHeightNum');
        if (range) range.value = v;
        if (num) num.value = v;
        clearTimeout(markerLabelHeightTimer);
        markerLabelHeightTimer = setTimeout(() => {
            if (selectedZoneDef() === def) setMarkerStyle(def, { labelHeight: v });
        }, 300);
    };
    document.getElementById('markerPropLabelHeight')?.addEventListener('input', (e) => setMarkerLabelHeight(e.target.value));
    document.getElementById('markerPropLabelHeightNum')?.addEventListener('input', (e) => setMarkerLabelHeight(e.target.value));
    // Личный цвет выбранной своей метки (иначе — общий цвет слоя).
    const applyCustomColor = (hex) => {
        const def = selectedZoneDef();
        const st = def && state[def.id];
        const input = document.getElementById('markerCustomColor');
        const ri = input ? Number(input.dataset.ri) : NaN;
        if (!def || def.id !== 'custom' || !st || !Array.isArray(st.customRaw) || !Number.isInteger(ri) || !st.customRaw[ri]) return;
        if (!/^#[0-9a-fA-F]{6}$/.test(hex || '')) return;
        st.customRaw[ri].color = hex.toLowerCase();
        st.points = window.GameZones.parseZonePoints(st.customRaw);
        rebuildZoneGroup(def);
        renderMarkerPanel();
        window.refreshGameZonesList();
        if (window.requestSceneRender) window.requestSceneRender();
    };
    document.getElementById('markerCustomColor')?.addEventListener('input', (e) => applyCustomColor(e.target.value));
    document.getElementById('markerCustomColorReset')?.addEventListener('click', () => {
        const def = selectedZoneDef();
        const st = def && state[def.id];
        const input = document.getElementById('markerCustomColor');
        const ri = input ? Number(input.dataset.ri) : NaN;
        if (!def || def.id !== 'custom' || !st || !Array.isArray(st.customRaw) || !Number.isInteger(ri) || !st.customRaw[ri]) return;
        delete st.customRaw[ri].color;
        st.points = window.GameZones.parseZonePoints(st.customRaw);
        rebuildZoneGroup(def);
        renderMarkerPanel();
        window.refreshGameZonesList();
        if (window.requestSceneRender) window.requestSceneRender();
    });
    // Аирдропы: какие подуровни видны (внешняя r300 / внутренняя r150).
    document.getElementById('gameZoneSearch')?.addEventListener('input', (e) => {
        zoneSearchQuery = e.target.value || '';
        window.refreshGameZonesList();
    });
    // Аирдропы: какие подуровни видны (внешняя r300 / внутренняя r150).
    document.getElementById('markerAirdropShow')?.addEventListener('change', async (e) => {
        const def = selectedZoneDef();
        const st = def && state[def.id];
        if (!def || !st || def.id !== 'airdrop') return;
        const v = e.target.value;
        st.show = (v === 'outer' || v === 'inner') ? v : 'both';
        e.target.value = st.show;
        renderMarkerPanel();
        window.refreshGameZonesList();
        if (!st.on) return;
        if (window.deleteConvertedFigures) window.deleteConvertedFigures(def.id);
        if (window.convertZoneToFigures) await window.convertZoneToFigures(def.id);
        if (window.setConvertedVisible) window.setConvertedVisible(def.id, true);
        if (window.refreshVectorLayersList) window.refreshVectorLayersList();
        if (window.requestSceneRender) window.requestSceneRender();
        // Удерживаем выбор: иначе снос активной фигуры закрывает левую панель.
        if (window.selectConvertedFigure) window.selectConvertedFigure(def.id);
    });
    document.getElementById('markerPropIconEnabled')?.addEventListener('change', async (e) => {
        const def = selectedZoneDef(); if (!def) return;
        const st = state[def.id];
        if (!st) return;
        if (st.on && window.deleteConvertedFigures) window.deleteConvertedFigures(def.id);
        st.markerStyle = Object.assign({}, st.markerStyle, { useIcon: e.target.checked });
        rebuildZoneGroup(def);
        await addZoneIconMeshes(def);
        if (st.on) await syncMarkerTextLayers(def);
        renderMarkerPanel();
        window.refreshGameZonesList();
    });
    document.getElementById('markerPropIconFile')?.addEventListener('change', (e) => {
        const def = selectedZoneDef(); const st = def && state[def.id];
        const file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!def || !st || !file) return;
        const reader = new FileReader();
        reader.onload = async (ev) => {
            const wasOn = st.on;
            st.customIcon = ev.target.result;
            st.markerStyle = Object.assign({}, st.markerStyle, { useIcon: true, outlineStyle: 'none' });
            if (!parseCustomIconShapes(def)) {
                st.customIcon = null;
                st.markerStyle = Object.assign({}, st.markerStyle, { useIcon: false });
                if (window.showToast) window.showToast(t('В SVG нет залитых контуров', 'SVG has no filled contours', 'У SVG немає залитих контурів'), 'error');
            }
            if (wasOn) {
                setZoneOff(def);
            }
            rebuildZoneGroup(def);
            if (wasOn) await setZoneOn(def);
            renderMarkerPanel();
            window.refreshGameZonesList();
        };
        reader.readAsText(file);
    });
    document.getElementById('markerPropIconReset')?.addEventListener('click', async () => {
        const def = selectedZoneDef(); const st = def && state[def.id];
        if (!def || !st) return;
        st.customIcon = null;
        st.markerStyle = Object.assign({}, st.markerStyle, { useIcon: false });
        if (st.on) {
            setZoneOff(def);
            await setZoneOn(def);
        } else rebuildZoneGroup(def);
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
    let globalMarkerSizeFrame = 0;
    if (sizeInput) sizeInput.addEventListener('input', () => {
        markerSize = parseFloat(sizeInput.value) || 6;
        if (sizeNum) sizeNum.textContent = markerSize;
        if (globalMarkerSizeFrame) cancelAnimationFrame(globalMarkerSizeFrame);
        globalMarkerSizeFrame = requestAnimationFrame(() => {
            window.GameZones.GAME_ZONES.forEach(def => {
                const st = state[def.id];
                if (!st) return;
                st.markerStyle = Object.assign({}, st.markerStyle, { size: markerSize });
                if (st.points.length > 0) rebuildZoneGroup(def);
                if (window.updatePixelImageLayerScale) window.updatePixelImageLayerScale(def.id, markerSize / 5);
                if (st.on) syncMarkerTextLayers(def);
            });
            globalMarkerSizeFrame = 0;
        });
    });

    document.getElementById('addCustomPoints')?.addEventListener('click', async () => {
        try {
        const ta = document.getElementById('customPointsInput');
        const def = window.GameZones.GAME_ZONES.find(d => d.id === 'custom');
        const st = state.custom;
        if (!ta || !def || !st || !Array.isArray(st.customRaw)) return;
        const isGame = Boolean(document.getElementById('customPointsGameCoords')?.checked);
        const items = window.GameZones.parsePastedPoints(ta.value, isGame);
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
        // Запоминаем скролл, чтобы список не прыгал вверх при перерисовке.
        const panel = document.querySelector('#gameZonesDropdown > div');
        const panelTop = panel ? panel.scrollTop : 0;
        const stdBody = container.querySelector('.std-scroll');
        const stdTop = stdBody ? stdBody.scrollTop : 0;
        const pasteBox = document.getElementById('customPointsInput');
        if (pasteBox) pasteBox.placeholder = t('x, y, название — напр.: 4624.88, 1947.76, контейнер #25', 'x, y, name — e.g.: 4624.88, 1947.76, bin #25', 'x, y, назва — напр.: 4624.88, 1947.76, контейнер #25');
        const makeZoneRow = (def) => {
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
                const next = selectedZoneId === def.id ? null : def.id;
                window.selectGameZone(next);
                // Вместо мёртвых настроек меток — настройки слоя фигуры зоны.
                if (next && window.selectConvertedFigure) window.selectConvertedFigure(next);
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
        };
        const mainDefs = window.GameZones.GAME_ZONES.filter(def => !def.standard && zoneMatchesQuery(def));
        const stdDefs = window.GameZones.GAME_ZONES.filter(def => def.standard && zoneMatchesQuery(def));
        const nodes = mainDefs.map(makeZoneRow);
        if (zoneSearchQuery.trim() && mainDefs.length === 0 && stdDefs.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'text-[10px] text-slate-500 text-center py-3';
            empty.textContent = t('Ничего не найдено', 'Nothing found', 'Нічого не знайдено');
            nodes.push(empty);
        }
        if (stdDefs.length > 0) {
            const onCount = stdDefs.filter(def => state[def.id] && state[def.id].on).length;
            const details = document.createElement('details');
            details.className = 'rounded-lg border border-slate-700/50 bg-slate-950/40 mt-1.5';
            if (zoneSearchQuery.trim()) {
                details.open = true;
            } else if (window.__stdZonesOpen === undefined) {
                if (onCount > 0) details.open = true;
            } else if (window.__stdZonesOpen) {
                details.open = true;
            }
            const summary = document.createElement('summary');
            summary.className = 'cursor-pointer px-2 py-1 text-[10px] font-semibold text-slate-300 flex items-center justify-between';
            const sTitle = document.createElement('span');
            sTitle.textContent = t('Стандартные метки', 'Standard markers', 'Стандартні мітки');
            const sCount = document.createElement('span');
            sCount.className = 'text-[9px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1 rounded-full';
            sCount.textContent = onCount + '/' + stdDefs.length;
            summary.append(sTitle, sCount);
            summary.addEventListener('click', () => {
                window.__stdZonesOpen = !details.open;
            });
            details.append(summary);
            const body = document.createElement('div');
            body.className = 'std-scroll p-1.5 pt-0 space-y-1';
            stdDefs.forEach(def => body.appendChild(makeZoneRow(def)));
            details.append(body);
            nodes.push(details);
        }
        container.replaceChildren(...nodes);
        try {
            const panel2 = document.querySelector('#gameZonesDropdown > div');
            if (panel2) panel2.scrollTop = panelTop;
            const stdBody2 = container.querySelector('.std-scroll');
            if (stdBody2) stdBody2.scrollTop = stdTop;
        } catch (e) {}
        if (window.lucide) window.lucide.createIcons();
    };

    async function loadStandardMenuLabels() {
        try {
            const raw = await fetchZoneJson({ url: 'markers/standard.json' });
            const data = Array.isArray(raw) ? raw : raw && Array.isArray(raw.points) ? raw.points : [];
            window.GameZones.GAME_ZONES.filter(def => def.standard && !def.descriptionFilter).forEach(def => {
                const points = data.filter(point => point && point.group === def.group && typeof point.name === 'string' && point.name.trim());
                const names = new Map();
                points.forEach(point => {
                    const title = point.name.trim()
                        .replace(/\s*\|.*$/, '')
                        .replace(/\s*\(\d+\s*уровень\)\s*$/i, '')
                        .replace(/\s+#\d+\s*$/i, '')
                        .trim();
                    if (title) names.set(title, (names.get(title) || 0) + 1);
                });
                let best = '';
                let bestCount = -1;
                names.forEach((count, title) => {
                    if (count > bestCount) { best = title; bestCount = count; }
                });
                if (best) def.titles[0] = best;
            });
        } catch (e) {
            console.warn('Standard marker labels failed:', e);
        }
    }

    window.renderGameZonesList = window.refreshGameZonesList;
    loadStandardMenuLabels().finally(() => window.refreshGameZonesList());
});
}
