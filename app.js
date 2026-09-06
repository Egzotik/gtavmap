// ==========================================
// ОСНОВНОЙ КОД ПРИЛОЖЕНИЯ (app.js)
// ==========================================

const state = { files: [], colorsMap: new Map(), modifiedColorsCount: 0, hasUserUploaded: false, separateByZ: false };
window.state = state; 
window.layerDictionary = {}; // СЛОВАРЬ НАЗВАНИЙ СЛОЕВ
const fastColorPointers = new Map();
window.mapBounds = null; 
window.isSeaSolid = false;

const IMPORT_LIMITS = Object.freeze({ maxFiles: 500, maxFileBytes: 50 * 1024 * 1024, maxTotalBytes: 200 * 1024 * 1024 });

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
}

function parseXmlOrThrow(xmlText, fileName = 'XML') {
    if (typeof xmlText !== 'string' || xmlText.length === 0) throw new Error(`${fileName}: пустой файл`);
    if (xmlText.length > IMPORT_LIMITS.maxFileBytes) throw new Error(`${fileName}: файл слишком большой`);
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    const parserError = doc.querySelector('parsererror');
    if (parserError) throw new Error(`${fileName}: некорректный XML`);
    if (!doc.documentElement) throw new Error(`${fileName}: отсутствует корневой элемент`);
    return doc;
}

function cloneFilesForExport(files) {
    return files.map(file => ({ ...file, text: String(file.text) }));
}

const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const folderPickerInput = document.getElementById('folderPickerInput');
const filesContainer = document.getElementById('filesContainer');
const fileList = document.getElementById('fileList');
const fileCount = document.getElementById('fileCount');
const clearFilesBtn = document.getElementById('clearFilesBtn');
const paletteContainer = document.getElementById('paletteContainer');
const uniqueColorCount = document.getElementById('uniqueColorCount');
const modifiedCount = document.getElementById('modifiedCount');
const colorSearchInput = document.getElementById('colorSearchInput');
const clearSearchBtn = document.getElementById('clearSearchBtn'); 
const resetAllColorsBtn = document.getElementById('resetAllColorsBtn');
const invertAllColorsBtn = document.getElementById('invertAllColorsBtn');
const exportZipBtn = document.getElementById('exportZipBtn');
const saveProjectBtn = document.getElementById('saveProjectBtn');
const loadJsonInput = document.getElementById('loadJsonInput');
const mapCanvas = document.getElementById('mapCanvas');
const vertexStats = document.getElementById('vertexStats');
const resetViewBtn = document.getElementById('resetViewBtn');
const loadingOverlay = document.getElementById('loadingOverlay');
const loadingText = document.getElementById('loadingText');
const loadingSubtext = document.getElementById('loadingSubtext');
const localFolderPrompt = document.getElementById('localFolderPrompt');

if(colorSearchInput) {
    colorSearchInput.addEventListener('input', (e) => {
        renderPalette(e.target.value);
        if(clearSearchBtn) {
            if(e.target.value.length > 0) clearSearchBtn.classList.remove('hidden');
            else clearSearchBtn.classList.add('hidden');
        }
    });
}
if(clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
        if(colorSearchInput) colorSearchInput.value = '';
        clearSearchBtn.classList.add('hidden');
        renderPalette('');
    });
}

document.addEventListener("DOMContentLoaded", () => {
    const toggleLeftPanelBtn = document.getElementById('toggleLeftPanelBtn');
    const leftToolsPanel = document.getElementById('leftToolsPanel');
    const panelToggleIcon = document.getElementById('panelToggleIcon');
    
    if (toggleLeftPanelBtn && leftToolsPanel) {
        toggleLeftPanelBtn.addEventListener('click', () => {
            leftToolsPanel.classList.toggle('hidden-panel');
            const isHidden = leftToolsPanel.classList.contains('hidden-panel');
            if (panelToggleIcon) panelToggleIcon.setAttribute('data-lucide', isHidden ? 'panel-left-open' : 'panel-left-close');
            toggleLeftPanelBtn.classList.toggle('text-emerald-400', !isHidden);
            toggleLeftPanelBtn.classList.toggle('text-slate-400', isHidden);
            if (window.lucide) window.lucide.createIcons();
            setTimeout(resizeCanvas, 310);
        });
    }

    document.querySelectorAll('.quick-xml-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const url = btn.getAttribute('data-xml-url');
            const zOffset = parseFloat(btn.getAttribute('data-z-offset')) || 0;
            const fileName = url.split('/').pop();
            
            const existingIdx = state.files.findIndex(f => f.name === fileName); 
            if (existingIdx >= 0) {
                state.files.splice(existingIdx, 1);
                extractUniqueColors(); 
                renderFileList(); 
                renderPalette(document.getElementById('colorSearchInput') ? document.getElementById('colorSearchInput').value : ''); 
                build3DScene(false); 
                updateExportState();
                
                btn.classList.remove('bg-purple-500/40', 'border-purple-400', 'text-white');
                btn.classList.add('bg-purple-500/10', 'text-purple-300');
                window.showToast(`Слой ${fileName} скрыт!`);
                return;
            }

            window.showLoading(`Загрузка ${fileName}...`, "Скачивание и обработка...");
            try {
                const response = await fetch(url, { cache: 'no-store' });
                if (!response.ok) throw new Error(`Не удалось загрузить файл: ${response.status}`);
                const xmlText = await response.text();
                
                const { meshesData, globalVertices } = parseGtaMapTo3D(xmlText, fileName);
                const fileObj = { 
                    id: 'file_' + Math.random().toString(36).substring(2, 9), 
                    name: fileName, 
                    text: xmlText, 
                    vertices: globalVertices, 
                    meshesData: meshesData, 
                    isDefault: false, 
                    zOffset: 0 
                };
                
                if (zOffset !== 0) {
                    fileObj.zOffset = zOffset;
                    fileObj.meshesData.forEach(data => { 
                        for (let i = 0; i < data.positions.length; i += 3) data.positions[i + 2] += zOffset; 
                        data.originalColorsList.forEach(orig => { orig.z += zOffset; }); 
                    }); 
                    fileObj.vertices.forEach(v => { v.z += zOffset; }); 
                    
                    const parser = new DOMParser(); 
                    const doc = parser.parseFromString(fileObj.text, 'application/xml'); 
                    doc.querySelectorAll('VertexBuffer').forEach(vb => { 
                        const vDataNode = vb.querySelector('Data2') || vb.querySelector('Data'); 
                        if (!vDataNode) return; 
                        const rawLines = vDataNode.textContent.split('\n'); 
                        let newVLines = []; 
                        rawLines.forEach(line => { 
                            const p = line.trim().split(/\s+/).filter(Boolean); 
                            if (p.length >= 7) { 
                                p[2] = (parseFloat(p[2]) + zOffset).toFixed(6); 
                                newVLines.push(`                ${p[0]} ${p[1]} ${p[2]}   ${p.slice(3).join(' ')}`); 
                            } 
                        }); 
                        vDataNode.textContent = "\n" + newVLines.join("\n") + "\n              "; 
                        const geomItem = vb.closest('Geometry') || vb.closest('Item'); 
                        if (geomItem) { 
                            ['BoundingBoxMin', 'BoundingBoxMax', 'BoundingSphereCenter'].forEach(tag => { 
                                const node = geomItem.querySelector(tag); 
                                if (node && node.hasAttribute('z')) node.setAttribute('z', (parseFloat(node.getAttribute('z')) + zOffset).toFixed(6)); 
                            }); 
                        } 
                    }); 
                    const serializer = new XMLSerializer(); 
                    let newXml = serializer.serializeToString(doc); 
                    newXml = newXml.replace(/\s+xmlns="[^"]*"/g, ''); 
                    fileObj.text = newXml;
                }

                state.files.push(fileObj);
                
                btn.classList.remove('bg-purple-500/10', 'text-purple-300');
                btn.classList.add('bg-purple-500/40', 'border-purple-400', 'text-white');

                extractUniqueColors(); 
                renderFileList(); 
                renderPalette(document.getElementById('colorSearchInput') ? document.getElementById('colorSearchInput').value : ''); 
                build3DScene(false); 
                updateExportState(); 
                window.showToast(`Слой ${fileName} успешно добавлен!`);
            } catch (err) {
                console.error(err);
                window.showToast(`Ошибка: файл ${url} не найден`, "error");
            } finally {
                window.hideLoading();
            }
        });
    });
});

const scene = new THREE.Scene();
scene.background = null; 

const container = mapCanvas.parentElement;
const camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 10, 100000);

const renderer = new THREE.WebGLRenderer({ canvas: mapCanvas, antialias: true, logarithmicDepthBuffer: true, alpha: true, preserveDrawingBuffer: true });
renderer.setClearColor( 0x000000, 0 ); 
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = false;
controls.enableRotate = false;
controls.minDistance = 100;
controls.maxDistance = 12000;
controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };

scene.add(new THREE.AmbientLight(0xffffff, 1.2));

let renderFramePending = false;
function requestSceneRender() {
    if (renderFramePending) return;
    renderFramePending = true;
    requestAnimationFrame(() => { renderFramePending = false; controls.update(); renderer.render(scene, camera); });
}
window.requestSceneRender = requestSceneRender;
controls.addEventListener('change', requestSceneRender);
requestSceneRender();

function resizeCanvas() {
    const width = mapCanvas.parentElement.clientWidth;
    const height = mapCanvas.parentElement.clientHeight;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    requestSceneRender();
}
window.addEventListener('resize', resizeCanvas);

const lockRotationBtn = document.getElementById('lockRotationBtn');
const lockRotationIcon = document.getElementById('lockRotationIcon');
const helpRotateText = document.getElementById('helpRotateText');

if (lockRotationBtn) {
    lockRotationBtn.addEventListener('click', () => {
        controls.enableRotate = !controls.enableRotate;
        if (controls.enableRotate) {
            lockRotationIcon.setAttribute('data-lucide', 'unlock');
            lockRotationBtn.classList.remove('bg-emerald-500/20', 'text-emerald-400', 'border-emerald-500/50');
            lockRotationBtn.classList.add('bg-slate-800', 'text-slate-300', 'border-slate-700');
            if (helpRotateText) helpRotateText.classList.remove('opacity-30', 'line-through');
            window.showToast("Вращение камеры разрешено", "success");
        } else {
            lockRotationIcon.setAttribute('data-lucide', 'lock');
            lockRotationBtn.classList.remove('bg-slate-800', 'text-slate-300', 'border-slate-700');
            lockRotationBtn.classList.add('bg-emerald-500/20', 'text-emerald-400', 'border-emerald-500/50');
            if (helpRotateText) helpRotateText.classList.add('opacity-30', 'line-through');
            window.showToast("Вращение камеры заблокировано", "success");
        }
        if (window.lucide) window.lucide.createIcons();
    });
}

function initRotationButtonState() {
    if (!controls.enableRotate && lockRotationBtn) {
        lockRotationIcon.setAttribute('data-lucide', 'lock');
        lockRotationBtn.classList.remove('bg-slate-800', 'text-slate-300', 'border-slate-700');
        lockRotationBtn.classList.add('bg-emerald-500/20', 'text-emerald-400', 'border-emerald-500/50');
        if (helpRotateText) helpRotateText.classList.add('opacity-30', 'line-through');
        if (window.lucide) window.lucide.createIcons();
    }
}
initRotationButtonState();

function rgbToHex(r, g, b) { return '#' + [r, g, b].map(x => { const hex = Math.max(0, Math.min(255, x)).toString(16); return hex.length === 1 ? '0' + hex : hex; }).join(''); }
function hexToRgb(hex) { const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex); return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : { r: 0, g: 0, b: 0 }; }
function makeRgbaKey(r, g, b, a) { return `${r}_${g}_${b}_${a}`; }

window.showLoading = function(text, subtext = "Пожалуйста, подождите") {
    if(loadingText) loadingText.textContent = text || "Загрузка...";
    if(loadingSubtext) loadingSubtext.textContent = subtext;
    if(loadingOverlay) loadingOverlay.classList.remove('opacity-0', 'pointer-events-none');
};

window.hideLoading = function() { if(loadingOverlay) loadingOverlay.classList.add('opacity-0', 'pointer-events-none'); };

window.showToast = function(message, type = 'success') {
    const toast = document.getElementById('toast'); const toastMessage = document.getElementById('toastMessage'); const toastIcon = document.getElementById('toastIcon');
    if(!toast) return;
    toastMessage.textContent = message;
    toastIcon.innerHTML = type === 'error' ? `<i data-lucide="alert-circle" class="w-4 h-4 text-rose-400"></i>` : `<i data-lucide="check-circle" class="w-4 h-4 text-emerald-400"></i>`;
    if (window.lucide) window.lucide.createIcons();
    toast.classList.remove('translate-y-20', 'opacity-0'); toast.classList.add('translate-y-0', 'opacity-100');
    setTimeout(() => { toast.classList.remove('translate-y-0', 'opacity-100'); toast.classList.add('translate-y-20', 'opacity-0'); }, 3000);
};

window.isEyedropperActive = false;
const eyedropperBtn = document.getElementById('eyedropperBtn');

if (eyedropperBtn) {
    eyedropperBtn.addEventListener('click', () => {
        window.isEyedropperActive = !window.isEyedropperActive;
        if (window.isEyedropperActive) {
            eyedropperBtn.classList.add('bg-emerald-500/20', 'text-emerald-400', 'border-emerald-500/50');
            eyedropperBtn.classList.remove('bg-slate-800', 'text-slate-300', 'border-slate-700');
            mapCanvas.style.cursor = 'crosshair';
            window.showToast("Пипетка активирована", "success");
        } else {
            eyedropperBtn.classList.remove('bg-emerald-500/20', 'text-emerald-400', 'border-emerald-500/50');
            eyedropperBtn.classList.add('bg-slate-800', 'text-slate-300', 'border-slate-700');
            mapCanvas.style.cursor = 'default';
        }
        if (window.lucide) window.lucide.createIcons();
    });
}

const mapRaycaster = new THREE.Raycaster();
const mapMouse = new THREE.Vector2();

renderer.domElement.addEventListener('pointerdown', (e) => {
    if (!window.isEyedropperActive) return;
    if (e.button !== 0) return; 

    const rect = renderer.domElement.getBoundingClientRect();
    mapMouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mapMouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    mapRaycaster.setFromCamera(mapMouse, camera);

    const mapMeshes = scene.children.filter(c => c.isMesh && c.userData.isMapMesh);
    const intersects = mapRaycaster.intersectObjects(mapMeshes, false);

    if (intersects.length > 0) {
        const intersect = intersects[0];
        const colorAttr = intersect.object.geometry.attributes.customColor;
        if (colorAttr && intersect.face) {
            const a = intersect.face.a;
            const r = Math.round(colorAttr.getX(a) * 255);
            const g = Math.round(colorAttr.getY(a) * 255);
            const b = Math.round(colorAttr.getZ(a) * 255);
            const hex = rgbToHex(r, g, b).toUpperCase();
            
            if (colorSearchInput) {
                colorSearchInput.value = hex;
                renderPalette(hex);
                if(clearSearchBtn) clearSearchBtn.classList.remove('hidden');
            }
            
            window.isEyedropperActive = false;
            if(eyedropperBtn) {
                eyedropperBtn.classList.remove('bg-emerald-500/20', 'text-emerald-400', 'border-emerald-500/50');
                eyedropperBtn.classList.add('bg-slate-800', 'text-slate-300', 'border-slate-700');
            }
            mapCanvas.style.cursor = 'default';
            window.showToast(`Цвет ${hex} скопирован в поиск!`, 'success');
        }
    }
});

async function loadDefaultMapFromFolder() {
    if (window.location.protocol === 'file:') { window.hideLoading(); if(localFolderPrompt) localFolderPrompt.classList.remove('hidden'); window.showToast("Для автозагрузки нужен сервер", "error"); return; }
    window.showLoading("Поиск карты в папке /map/...", "Загрузка всех XML файлов...");

    // ПОПЫТКА ЗАГРУЗИТЬ СЛОВАРЬ ИЗ ПАПКИ map/
    try {
        const dictResponse = await fetch('map/dictionary.json', { cache: 'no-store' });
        if (dictResponse.ok) {
            window.layerDictionary = await dictResponse.json();
        }
    } catch (err) {
        console.warn("Файл dictionary.json не найден или содержит ошибку.");
    }

    const mapFilesToLoad = [
        "minimap_0_3.ydd.xml", "minimap_0_4.ydd.xml", "minimap_0_5.ydd.xml", "minimap_0_6.ydd.xml", "minimap_1_1.ydd.xml", "minimap_1_2.ydd.xml", "minimap_1_3.ydd.xml", "minimap_1_4.ydd.xml", "minimap_1_5.ydd.xml", "minimap_1_6.ydd.xml", "minimap_1_7.ydd.xml", "minimap_1_8.ydd.xml", "minimap_2_0.ydd.xml", "minimap_2_1.ydd.xml", "minimap_2_2.ydd.xml", "minimap_2_3.ydd.xml", "minimap_2_4.ydd.xml", "minimap_2_5.ydd.xml", "minimap_2_6.ydd.xml", "minimap_2_7.ydd.xml", "minimap_2_8.ydd.xml", "minimap_3_0.ydd.xml", "minimap_3_1.ydd.xml", "minimap_3_2.ydd.xml", "minimap_3_3.ydd.xml", "minimap_3_4.ydd.xml", "minimap_3_5.ydd.xml", "minimap_3_6.ydd.xml", "minimap_0_2.ydd.xml", "minimap_4_2.ydd.xml", "minimap_4_3.ydd.xml", "minimap_4_4.ydd.xml", "minimap_4_5.ydd.xml", "minimap_4_6.ydd.xml", "minimap_4_7.ydd.xml", "minimap_4_8.ydd.xml", "minimap_5_0.ydd.xml", "minimap_5_1.ydd.xml", "minimap_5_2.ydd.xml", "minimap_5_3.ydd.xml", "minimap_5_4.ydd.xml", "minimap_5_5.ydd.xml", "minimap_5_6.ydd.xml", "minimap_5_7.ydd.xml", "minimap_5_8.ydd.xml", "minimap_6_0.ydd.xml", "minimap_6_1.ydd.xml", "minimap_6_2.ydd.xml", "minimap_6_3.ydd.xml", "minimap_6_4.ydd.xml", "minimap_6_5.ydd.xml", "minimap_6_6.ydd.xml", "minimap_6_7.ydd.xml", "minimap_6_8.ydd.xml", "minimap_7_0.ydd.xml", "minimap_7_1.ydd.xml", "minimap_7_2.ydd.xml", "minimap_7_3.ydd.xml", "minimap_7_4.ydd.xml", "minimap_7_5.ydd.xml", "minimap_7_6.ydd.xml", "minimap_3_7.ydd.xml", "minimap_3_8.ydd.xml", "minimap_4_0.ydd.xml", "minimap_4_1.ydd.xml"
    ];
    let loadedCount = 0;
    const results = await Promise.allSettled(mapFilesToLoad.map(async filename => {
        const response = await fetch(`map/${filename}`, { cache: 'no-store' });
        if (!response.ok) return false;
        const text = await response.text();
        processSingleXmlText(text, filename, true);
        return true;
    }));
    loadedCount = results.filter(result => result.status === 'fulfilled' && result.value).length;
    if (loadedCount > 0) { extractUniqueColors(); renderFileList(); renderPalette(); build3DScene(); updateExportState(); window.showToast(`Автоматически загружено: ${loadedCount}`); } else { if(localFolderPrompt) localFolderPrompt.classList.remove('hidden'); } window.hideLoading();
}

if(folderPickerInput) {
    folderPickerInput.addEventListener('change', async (e) => {
        const allFiles = Array.from(e.target.files);
        
        // ПОИСК ФАЙЛА dictionary.json В ВЫБРАННОЙ ПАПКЕ
        const dictFile = allFiles.find(f => f.name.toLowerCase() === 'dictionary.json');
        if (dictFile) {
            try { window.layerDictionary = JSON.parse(await dictFile.text()); } catch(err) {}
        }

        const files = allFiles.filter(f => f.name.toLowerCase().endsWith('.xml')).slice(0, IMPORT_LIMITS.maxFiles); 
        if (files.length === 0) return;
        
        window.showLoading("Импорт файлов из папки..."); if(localFolderPrompt) localFolderPrompt.classList.add('hidden');
        try {
            let totalBytes = 0;
            for (const file of files) { totalBytes += file.size; if (file.size > IMPORT_LIMITS.maxFileBytes || totalBytes > IMPORT_LIMITS.maxTotalBytes) throw new Error('Превышен допустимый размер импорта'); const text = await file.text(); processSingleXmlText(text, file.name, false); }
            extractUniqueColors(); renderFileList(); renderPalette(); build3DScene(); updateExportState(); window.showToast(`Загружено: ${files.length}`);
        } catch (err) { console.error(err); window.showToast(err.message || 'Ошибка импорта', 'error'); }
        finally { window.hideLoading(); }
    });
}

window.focusOnColor = function(key) {
    const item = state.colorsMap.get(key); if (!item) return; let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity, found = false;
    state.files.forEach(file => { file.vertices.forEach(v => { if (v.r === item.origR && v.g === item.origG && v.b === item.origB && v.a === item.origA) { if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x; if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y; if (v.z < minZ) minZ = v.z; if (v.z > maxZ) maxZ = v.z; found = true; } }); });
    if (found) { const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2, centerZ = (minZ + maxZ) / 2; const maxDim = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 10); camera.position.set(centerX, centerY, maxZ + maxDim * 1.5); controls.target.set(centerX, centerY, centerZ); controls.update(); window.showToast(`Телепортировано`); } else { window.showToast("Не найдено", "error"); }
};

window.deleteColor = function(key) {
    if (!confirm("Удалить треугольники с этим цветом?")) return;
    const itemToRemove = state.colorsMap.get(key); if (!itemToRemove) return;
    window.showLoading("Вырезание геометрии...");
    setTimeout(() => {
        try {
            let deletedTrianglesCount = 0, completelyDeletedMeshes = 0;
            for (let i = 0; i < state.files.length; i++) {
                const file = state.files[i]; const doc = parseXmlOrThrow(file.text, file.name); const vertexBuffers = doc.querySelectorAll('VertexBuffer'); let fileModified = false;
                vertexBuffers.forEach(vb => {
                    const itemNode = vb.parentElement; const ib = itemNode ? Array.from(itemNode.children).find(child => child.nodeName === 'IndexBuffer') : null; if (!itemNode || !ib) return; const vData = vb.querySelector('Data2') || vb.querySelector('Data'); const iData = ib.querySelector('Data2') || ib.querySelector('Data'); if (!vData || !iData) return;
                    const rawLines = vData.textContent.split('\n'); let validVerts = []; let vertexHasTargetColor = []; let hasAnyTargetColor = false;
                    rawLines.forEach((line) => { const p = line.trim().split(/\s+/).filter(Boolean); if (p.length >= 7) { const r = parseInt(p[3]), g = parseInt(p[4]), b = parseInt(p[5]), a = parseInt(p[6]), z = parseFloat(p[2]); let match = (r === itemToRemove.origR && g === itemToRemove.origG && b === itemToRemove.origB && a === itemToRemove.origA); if (match && state.separateByZ && itemToRemove.origZ !== undefined) if (Math.round(z) !== itemToRemove.origZ) match = false; if (match) hasAnyTargetColor = true; vertexHasTargetColor.push(match); validVerts.push(`                ${p[0]} ${p[1]} ${p[2]}   ${p.slice(3).join(' ')}`); } });
                    if (!hasAnyTargetColor) return; const iTokens = iData.textContent.trim().split(/\s+/).filter(t => t !== ''); let keptIndices = []; let droppedTriangles = 0;
                    for (let k = 0; k < iTokens.length; k += 3) { let idx1 = parseInt(iTokens[k]), idx2 = parseInt(iTokens[k+1]), idx3 = parseInt(iTokens[k+2]); if (vertexHasTargetColor[idx1] || vertexHasTargetColor[idx2] || vertexHasTargetColor[idx3]) droppedTriangles++; else keptIndices.push(idx1, idx2, idx3); }
                    if (droppedTriangles === 0) return; fileModified = true; deletedTrianglesCount += droppedTriangles;
                    if (keptIndices.length === 0) { if (itemNode.parentNode) itemNode.parentNode.removeChild(itemNode); completelyDeletedMeshes++; return; }
                    let usedVertices = new Set(keptIndices), newVLines = [], oldToNewIdx = {}, currentNewIdx = 0; validVerts.forEach((line, oldIdx) => { if (usedVertices.has(oldIdx)) { newVLines.push(line); oldToNewIdx[oldIdx] = currentNewIdx; currentNewIdx++; } }); let finalIndices = keptIndices.map(oldIdx => oldToNewIdx[oldIdx]);
                    vData.textContent = "\n" + newVLines.join("\n") + "\n              "; let iStr = "\n"; for (let k = 0; k < finalIndices.length; k += 24) iStr += "                " + finalIndices.slice(k, k+24).join(" ") + "\n"; iData.textContent = iStr + "              ";
                    const geomItem = vb.closest('Geometry') || vb.closest('Item'); const updateCounts = (selector, val) => { geomItem.querySelectorAll(selector).forEach(n => { if (n.hasAttribute('value')) n.setAttribute('value', val); }); }; updateCounts('Vertices', newVLines.length); updateCounts('VertexCount', newVLines.length); updateCounts('Indices', finalIndices.length); updateCounts('IndicesCount', finalIndices.length); updateCounts('PrimitiveCount', finalIndices.length / 3);
                });
                if (fileModified) { const serializer = new XMLSerializer(); let newXml = serializer.serializeToString(doc); newXml = newXml.replace(/\s+xmlns="[^"]*"/g, ''); file.text = newXml; }
            }
            const currentFiles = [...state.files]; state.files = []; currentFiles.forEach(f => { processSingleXmlText(f.text, f.name, f.isDefault); }); extractUniqueColors(); renderFileList(); renderPalette(document.getElementById('colorSearchInput') ? document.getElementById('colorSearchInput').value : ''); build3DScene(false); updateExportState();
            if (deletedTrianglesCount > 0) window.showToast(`Вырезано полигонов: ${deletedTrianglesCount}`); else window.showToast("Геометрия не найдена", "error");
        } catch (err) { window.showToast("Ошибка при удалении", "error"); } finally { window.hideLoading(); }
    }, 50); 
};

if(fileInput) fileInput.addEventListener('change', (e) => handleFiles(e.target.files));
if(dropZone) {
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('border-emerald-500', 'bg-slate-800/60'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('border-emerald-500', 'bg-slate-800/60'));
    dropZone.addEventListener('drop', (e) => { e.preventDefault(); dropZone.classList.remove('border-emerald-500', 'bg-slate-800/60'); if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files); });
}
if(clearFilesBtn) {
    clearFilesBtn.addEventListener('click', () => { state.files = []; state.colorsMap.clear(); fastColorPointers.clear(); if (window.clearVectors) window.clearVectors(); renderFileList(); renderPalette(); build3DScene(); updateExportState(); window.showToast("Очищено"); });
}

async function handleFiles(fileListInput) {
    const rawFiles = Array.from(fileListInput); if (rawFiles.length === 0) return; window.showLoading("Обработка файлов..."); if(localFolderPrompt) localFolderPrompt.classList.add('hidden'); if (!state.hasUserUploaded) state.hasUserUploaded = true;
    try {
        if (rawFiles.length > IMPORT_LIMITS.maxFiles) throw new Error(`Слишком много файлов: максимум ${IMPORT_LIMITS.maxFiles}`);
        let totalBytes = rawFiles.reduce((sum, file) => sum + file.size, 0);
        if (totalBytes > IMPORT_LIMITS.maxTotalBytes) throw new Error('Слишком большой общий объём файлов');
        for (const file of rawFiles) {
            const lowerName = file.name.toLowerCase();
            if (file.size > IMPORT_LIMITS.maxFileBytes) throw new Error(`${file.name}: файл слишком большой`);
            if (lowerName.endsWith('.zip')) {
                const zip = await JSZip.loadAsync(file);
                const xmlNames = Object.keys(zip.files).filter(filename => filename.toLowerCase().endsWith('.xml') && !zip.files[filename].dir);
                if (xmlNames.length > IMPORT_LIMITS.maxFiles) throw new Error(`${file.name}: слишком много XML`);
                let unpackedBytes = 0;
                for (const filename of xmlNames) {
                    const declaredSize = zip.files[filename]._data && zip.files[filename]._data.uncompressedSize;
                    if (Number.isFinite(declaredSize) && declaredSize > IMPORT_LIMITS.maxFileBytes) throw new Error(`${filename}: файл слишком большой`);
                    const xmlText = await zip.files[filename].async('string');
                    unpackedBytes += xmlText.length;
                    if (xmlText.length > IMPORT_LIMITS.maxFileBytes || unpackedBytes > IMPORT_LIMITS.maxTotalBytes) throw new Error(`${file.name}: превышен размер распакованных данных`);
                    processSingleXmlText(xmlText, filename.split('/').pop(), false);
                }
            } else if (lowerName.endsWith('.xml')) { const xmlText = await file.text(); processSingleXmlText(xmlText, file.name, false); }
        }
        extractUniqueColors(); renderFileList(); renderPalette(); build3DScene(false); updateExportState(); window.showToast("Загружено!");
    } catch (err) { console.error(err); window.showToast(err.message || "Ошибка импорта", "error"); } finally { window.hideLoading(); }
}

function processSingleXmlText(xmlText, fileName, isDefault = false) {
    const { meshesData, globalVertices } = parseGtaMapTo3D(xmlText, fileName);
    const fileObj = { id: 'file_' + Math.random().toString(36).substring(2, 9), name: fileName, text: xmlText, vertices: globalVertices, meshesData: meshesData, isDefault: isDefault, zOffset: 0 };
    const existingIdx = state.files.findIndex(f => f.name === fileObj.name); if (existingIdx >= 0) state.files[existingIdx] = fileObj; else state.files.push(fileObj);
}

function parseGtaMapTo3D(xmlText, fileName = 'XML') {
    const doc = parseXmlOrThrow(xmlText, fileName); const vertexBuffers = doc.querySelectorAll('VertexBuffer'); let meshesData = []; let globalVertices = [];
    vertexBuffers.forEach(vb => {
        const container = vb.parentElement; const ib = container ? Array.from(container.children).find(child => child.nodeName === 'IndexBuffer') : null; const vData = vb.querySelector('Data2') || vb.querySelector('Data'); const iData = ib ? (ib.querySelector('Data2') || ib.querySelector('Data')) : null; if (!vData) return;
        const vLines = vData.textContent.trim().split('\n'); const positions = []; const colors = []; const originalColorsList = [];
        vLines.forEach(line => {
            const p = line.trim().split(/\s+/).filter(Boolean);
            if (p.length >= 7) { const x = parseFloat(p[0]), y = parseFloat(p[1]), z = parseFloat(p[2]), r = parseInt(p[3]), g = parseInt(p[4]), b = parseInt(p[5]), a = parseInt(p[6]); if (!isNaN(x) && !isNaN(y) && !isNaN(r)) { positions.push(x, y, z); colors.push(r / 255, g / 255, b / 255, a / 255); globalVertices.push({ x, y, z, r, g, b, a }); originalColorsList.push({ r, g, b, a, z }); } }
        });
        const indices = []; if (iData) { const iTokens = iData.textContent.trim().split(/\s+/).filter(Boolean); iTokens.forEach(t => { const index = Number(t); if (!Number.isInteger(index) || index < 0 || index >= positions.length / 3) throw new Error(`${fileName}: некорректный индекс вершины`); indices.push(index); }); if (indices.length % 3 !== 0) throw new Error(`${fileName}: число индексов не кратно трём`); } else { for(let i = 0; i < positions.length / 3; i++) indices.push(i); }
        if (positions.length > 0) meshesData.push({ positions: new Float32Array(positions), colors: new Float32Array(colors), indices: new Uint32Array(indices), originalColorsList: originalColorsList });
    });
    return { meshesData, globalVertices };
}

function extractUniqueColors() {
    const oldMap = new Map(state.colorsMap); state.colorsMap.clear();
    for (const file of state.files) {
        for (const v of file.vertices) {
            const baseKey = makeRgbaKey(v.r, v.g, v.b, v.a); const zSuffix = state.separateByZ ? `_${Math.round(v.z)}` : ''; const key = baseKey + zSuffix; const hex = rgbToHex(v.r, v.g, v.b);
            if (state.colorsMap.has(key)) { state.colorsMap.get(key).count++; } else {
                let oldItem = oldMap.get(key); if (!oldItem && state.separateByZ) oldItem = oldMap.get(baseKey); else if (!oldItem && !state.separateByZ) { const matchKey = Array.from(oldMap.keys()).find(k => k.startsWith(baseKey + '_')); if (matchKey) oldItem = oldMap.get(matchKey); }
                
                // ПРИСВАИВАЕМ ИМЯ ИЗ СЛОВАРЯ
                let defaultName = "";
                if (window.layerDictionary && window.layerDictionary[hex.toLowerCase()]) {
                    defaultName = window.layerDictionary[hex.toLowerCase()];
                }
                
                state.colorsMap.set(key, { 
                    key: key, origHex: hex, origR: v.r, origG: v.g, origB: v.b, origA: v.a, origZ: Math.round(v.z), 
                    currentHex: oldItem ? oldItem.currentHex : hex, 
                    currentR: oldItem ? oldItem.currentR : v.r, currentG: oldItem ? oldItem.currentG : v.g, currentB: oldItem ? oldItem.currentB : v.b, currentA: oldItem ? oldItem.currentA : v.a, 
                    customName: oldItem && oldItem.customName ? oldItem.customName : defaultName, 
                    count: 1 
                });
            }
        }
    }
    updateModifiedCount();
}

function renderFileList() {
    if (state.files.length === 0) { filesContainer.classList.add('hidden'); return; } filesContainer.classList.remove('hidden'); fileCount.textContent = state.files.length; fileList.innerHTML = '';
    state.files.forEach(file => {
        const div = document.createElement('div'); div.className = 'flex flex-col bg-slate-800/80 rounded border border-slate-700/50 mb-1.5 text-[11px] overflow-hidden transition-all shrink-0';
        div.innerHTML = `<div class="file-header flex items-center justify-between p-1.5 cursor-pointer hover:bg-slate-700/50 transition-colors"><div class="flex items-center space-x-1.5 truncate"><i data-lucide="chevron-right" id="file-icon-${file.id}" class="w-3 h-3 text-slate-400 shrink-0 transition-transform duration-200"></i><i data-lucide="file-code" class="w-3 h-3 text-emerald-400 shrink-0"></i><span class="file-name font-medium text-slate-200 truncate text-[10px]"></span></div><button type="button" class="remove-file text-slate-400 hover:text-rose-400 transition p-0.5" title="Удалить файл"><i data-lucide="x" class="w-3 h-3"></i></button></div><div id="file-settings-${file.id}" class="hidden px-1.5 pb-1.5 pt-0 space-y-1.5"><div class="flex items-center justify-between bg-slate-900/50 px-1.5 py-1 rounded border border-slate-700/50"><span class="text-[9px] text-slate-400" title="Опустить или поднять весь файл">Смещение Z:</span><input type="number" class="z-offset w-16 bg-transparent text-right text-[10px] font-mono font-bold text-emerald-400 outline-none focus:bg-slate-950 transition-colors rounded px-1" step="1"></div></div>`;
        const nameNode = div.querySelector('.file-name'); nameNode.textContent = file.name; nameNode.title = file.name;
        div.querySelector('.file-header').addEventListener('click', () => window.toggleFileExpanded(file.id));
        div.querySelector('.remove-file').addEventListener('click', event => { event.stopPropagation(); window.removeFile(file.id); });
        const offsetInput = div.querySelector('.z-offset'); offsetInput.value = file.zOffset || 0; offsetInput.addEventListener('change', () => window.applyFileZOffset(file.id, offsetInput.value));
        fileList.appendChild(div);
    });
    if (window.lucide) window.lucide.createIcons();
}

window.toggleFileExpanded = function(fileId) { const settingsBlock = document.getElementById(`file-settings-${fileId}`); const icon = document.getElementById(`file-icon-${fileId}`); if (!settingsBlock || !icon) return; if (settingsBlock.classList.contains('hidden')) { settingsBlock.classList.remove('hidden'); icon.classList.add('rotate-90'); } else { settingsBlock.classList.add('hidden'); icon.classList.remove('rotate-90'); } };
window.applyFileZOffset = function(fileId, inputVal) {
    const file = state.files.find(f => f.id === fileId); if (!file) return; const newZOffset = parseFloat(inputVal) || 0; const currentZOffset = file.zOffset || 0; const deltaZ = newZOffset - currentZOffset; if (deltaZ === 0) return; window.showLoading("Смещение Z координаты...", "Пересчет геометрии файла");
    setTimeout(() => {
        try { file.zOffset = newZOffset; file.meshesData.forEach(data => { for (let i = 0; i < data.positions.length; i += 3) data.positions[i + 2] += deltaZ; data.originalColorsList.forEach(orig => { orig.z += deltaZ; }); }); file.vertices.forEach(v => { v.z += deltaZ; }); const parser = new DOMParser(); const doc = parser.parseFromString(file.text, 'application/xml'); doc.querySelectorAll('VertexBuffer').forEach(vb => { const vDataNode = vb.querySelector('Data2') || vb.querySelector('Data'); if (!vDataNode) return; const rawLines = vDataNode.textContent.split('\n'); let newVLines = rawLines.map(line => { const p = line.trim().split(/\s+/).filter(Boolean); if (p.length >= 7) { p[2] = (parseFloat(p[2]) + deltaZ).toFixed(6); return `                ${p[0]} ${p[1]} ${p[2]}   ${p.slice(3).join(' ')}`; } return line; }); vDataNode.textContent = "\n" + newVLines.join("\n") + "\n              "; const geomItem = vb.closest('Geometry') || vb.closest('Item'); if (geomItem) { ['BoundingBoxMin', 'BoundingBoxMax', 'BoundingSphereCenter'].forEach(tag => { const node = geomItem.querySelector(tag); if (node && node.hasAttribute('z')) node.setAttribute('z', (parseFloat(node.getAttribute('z')) + deltaZ).toFixed(6)); }); } }); const serializer = new XMLSerializer(); let newXml = serializer.serializeToString(doc); newXml = newXml.replace(/\s+xmlns="[^"]*"/g, ''); file.text = newXml; extractUniqueColors(); renderPalette(document.getElementById('colorSearchInput') ? document.getElementById('colorSearchInput').value : ''); build3DScene(false); updateExportState(); window.showToast(`Файл "${file.name}" смещен по Z на ${deltaZ > 0 ? '+' : ''}${deltaZ}`, "success"); } catch (err) { console.error(err); window.showToast("Ошибка при смещении Z", "error"); } finally { window.hideLoading(); }
    }, 50);
};

window.removeFile = function(fileId) { state.files = state.files.filter(f => f.id !== fileId); extractUniqueColors(); renderFileList(); renderPalette(); build3DScene(false); updateExportState(); };
window.updateColorName = function(key, newName) { const item = state.colorsMap.get(key); if (item) item.customName = newName.trim(); };

function renderPalette(filterText = '') {
    const paletteContainer = document.getElementById('paletteContainer'); const uniqueColorCount = document.getElementById('uniqueColorCount'); if (!paletteContainer) return; paletteContainer.innerHTML = '';
    if (state.colorsMap.size === 0) { paletteContainer.innerHTML = `<div class="py-12 text-center text-slate-500"><i data-lucide="palette" class="w-8 h-8 mx-auto mb-1 stroke-1"></i><p class="text-xs">Файлы не загружены</p></div>`; if (uniqueColorCount) uniqueColorCount.textContent = '0 цветов'; if (window.lucide) window.lucide.createIcons(); return; }
    const search = filterText.toLowerCase().trim(); const sortedColors = Array.from(state.colorsMap.values()).sort((a, b) => { const aIsTransparent = a.origA < 255, bIsTransparent = b.origA < 255; if (aIsTransparent && !bIsTransparent) return 1; if (!aIsTransparent && bIsTransparent) return -1; return b.count - a.count; });
    sortedColors.forEach(item => {
        const hexLabel = item.origHex.toLowerCase(), currHexLabel = item.currentHex.toLowerCase(), rgbLabel = `rgb(${item.origR}, ${item.origG}, ${item.origB})`, customNameLabel = (item.customName || '').toLowerCase(); if (search && !hexLabel.includes(search) && !currHexLabel.includes(search) && !rgbLabel.includes(search) && !customNameLabel.includes(search)) return; const isModified = item.currentHex !== item.origHex || item.currentA !== item.origA; const safeKey = item.key.replace(/[^a-zA-Z0-9]/g, '_');
        const card = document.createElement('div'); card.id = `color-card-${safeKey}`; card.className = `p-2 rounded-lg border transition-all duration-200 shrink-0 ${isModified ? 'bg-emerald-950/20 border-emerald-500/40' : 'bg-slate-900/80 border-slate-800'}`;
        card.innerHTML = `<div class="flex items-start justify-between gap-1"><div class="flex items-start space-x-2 w-full min-w-0"><div class="relative w-6 h-6 rounded overflow-hidden border border-slate-700 shrink-0 color-picker-wrapper mt-0.5"><div id="alpha-preview-${safeKey}" class="absolute inset-0 pointer-events-none" style="background-color: rgba(${item.currentR}, ${item.currentG}, ${item.currentB}, ${item.currentA / 255});"></div><input type="color" id="color-picker-${safeKey}" value="${item.currentHex}" class="color-picker opacity-0 w-full h-full cursor-pointer absolute inset-0 m-0 p-0"></div><div class="flex flex-col flex-1 min-w-0"><div class="flex items-center flex-wrap gap-1 mb-1"><input type="text" id="hex-input-${safeKey}" value="${item.currentHex.toUpperCase()}" class="hex-input w-[48px] bg-transparent border border-transparent hover:border-slate-700 focus:border-emerald-500 rounded text-[9px] font-mono font-bold text-slate-300 hover:text-white focus:text-emerald-400 outline-none uppercase p-0 m-0 transition-colors shrink-0"><span id="mod-badge-${safeKey}" class="text-[8px] text-emerald-400 bg-emerald-500/20 px-1 rounded font-medium shrink-0 ${isModified ? '' : 'hidden'}">mod</span>${state.separateByZ ? `<span class="text-[8px] text-blue-400 bg-blue-500/20 px-1 rounded font-medium shrink-0">Z:${item.origZ}</span>` : ''}</div><input type="text" id="name-input-${safeKey}" placeholder="Назвать слой..." class="name-input bg-slate-950 border border-slate-700 hover:border-slate-500 focus:border-emerald-500 rounded text-[10px] px-1 py-0.5 text-slate-200 outline-none w-full max-w-[120px] placeholder-slate-600 transition-colors"></div></div><div class="flex flex-col items-end shrink-0 gap-1"><div class="flex items-center space-x-0.5"><button type="button" data-action="focus" title="Телепорт" class="p-1 text-emerald-400 hover:bg-emerald-500/20 rounded transition"><i data-lucide="target" class="w-3.5 h-3.5"></i></button><button type="button" data-action="invert" title="Инверсия" class="p-1 text-amber-300 hover:bg-slate-700 rounded transition"><i data-lucide="flip-horizontal" class="w-3.5 h-3.5"></i></button><button type="button" data-action="reset" id="reset-btn-${safeKey}" title="Сброс" class="p-1 text-slate-300 hover:text-white hover:bg-slate-700 rounded transition ${isModified ? '' : 'hidden'}"><i data-lucide="rotate-ccw" class="w-3.5 h-3.5"></i></button><button type="button" data-action="delete" title="Удалить" class="p-1 text-rose-400 hover:bg-rose-500/20 rounded transition"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button></div><span class="text-[9px] text-slate-400 bg-slate-800 px-1 py-0.5 rounded border border-slate-700/50 font-mono text-center">${item.count}</span></div></div><div class="mt-2 pt-1.5 border-t border-slate-800/60 flex items-center space-x-2 text-[9px] text-slate-400"><span class="font-medium shrink-0">Alpha:</span><input type="range" id="alpha-range-${safeKey}" min="0" max="255" value="${item.currentA}" class="alpha-range w-full accent-emerald-400 bg-slate-800 h-1 rounded cursor-pointer"><input type="number" min="0" max="255" value="${item.currentA}" id="alpha-num-${safeKey}" class="alpha-num w-8 bg-slate-950 border border-slate-700 rounded text-center text-slate-200 text-[9px] py-0.5 font-mono outline-none focus:border-emerald-500"></div>`;
        const nameInput = card.querySelector('.name-input'); nameInput.value = item.customName || ''; nameInput.addEventListener('change', () => window.updateColorName(item.key, nameInput.value));
        card.querySelector('.color-picker').addEventListener('input', event => window.fastUpdateColor(item.key, event.target.value, null));
        card.querySelector('.hex-input').addEventListener('change', event => window.fastUpdateColor(item.key, event.target.value, null));
        card.querySelector('.alpha-range').addEventListener('input', event => window.fastUpdateColor(item.key, null, event.target.value));
        card.querySelector('.alpha-num').addEventListener('change', event => window.fastUpdateColor(item.key, null, event.target.value));
        card.querySelector('[data-action="focus"]').addEventListener('click', () => window.focusOnColor(item.key));
        card.querySelector('[data-action="invert"]').addEventListener('click', () => window.invertSingleColor(item.key));
        card.querySelector('[data-action="reset"]').addEventListener('click', () => window.resetSingleColor(item.key));
        card.querySelector('[data-action="delete"]').addEventListener('click', () => window.deleteColor(item.key));
        paletteContainer.appendChild(card);
    });
    if (uniqueColorCount) uniqueColorCount.textContent = `${state.colorsMap.size} цветов`; if (window.lucide) window.lucide.createIcons();
}

window.fastUpdateColor = function(key, newHex, newAlpha) {
    const item = state.colorsMap.get(key); if (!item) return;
    if (newHex !== null) { let formattedHex = newHex.trim(); if (!formattedHex.startsWith('#')) formattedHex = '#' + formattedHex; if (/^#[0-9A-F]{6}$/i.test(formattedHex)) { const { r, g, b } = hexToRgb(formattedHex); item.currentHex = formattedHex.toLowerCase(); item.currentR = r; item.currentG = g; item.currentB = b; } else { const safeKey = key.replace(/[^a-zA-Z0-9]/g, '_'); const hexInput = document.getElementById(`hex-input-${safeKey}`); if (hexInput) hexInput.value = item.currentHex.toUpperCase(); return; } }
    if (newAlpha !== null) item.currentA = Math.max(0, Math.min(255, parseInt(newAlpha, 10) || 0));
    const pointers = fastColorPointers.get(key); if (pointers) { const rNorm = item.currentR / 255, gNorm = item.currentG / 255, bNorm = item.currentB / 255, aNorm = item.currentA / 255; for (let p = 0; p < pointers.length; p++) { const ptr = pointers[p]; const array = ptr.attribute.array; const indices = ptr.indices; for (let i = 0; i < indices.length; i++) { const idx = indices[i]; array[idx] = rNorm; array[idx + 1] = gNorm; array[idx + 2] = bNorm; array[idx + 3] = aNorm; } ptr.attribute.needsUpdate = true; } }
    const safeKey = key.replace(/[^a-zA-Z0-9]/g, '_'); const isModified = item.currentHex !== item.origHex || item.currentA !== item.origA; const hexInput = document.getElementById(`hex-input-${safeKey}`), colorPicker = document.getElementById(`color-picker-${safeKey}`); const alphaNum = document.getElementById(`alpha-num-${safeKey}`), alphaPreview = document.getElementById(`alpha-preview-${safeKey}`); const alphaRange = document.getElementById(`alpha-range-${safeKey}`); const resetBtn = document.getElementById(`reset-btn-${safeKey}`), modBadge = document.getElementById(`mod-badge-${safeKey}`); const colorCard = document.getElementById(`color-card-${safeKey}`);
    if (hexInput && document.activeElement !== hexInput) hexInput.value = item.currentHex.toUpperCase(); if (colorPicker) colorPicker.value = item.currentHex; if (alphaNum) alphaNum.value = item.currentA; if (alphaRange) alphaRange.value = item.currentA; if (alphaPreview) alphaPreview.style.backgroundColor = `rgba(${item.currentR}, ${item.currentG}, ${item.currentB}, ${item.currentA / 255})`;
    if (resetBtn) resetBtn.classList.toggle('hidden', !isModified); if (modBadge) modBadge.classList.toggle('hidden', !isModified); if (colorCard) { if (isModified) { colorCard.classList.remove('bg-slate-900/80', 'border-slate-800'); colorCard.classList.add('bg-emerald-950/20', 'border-emerald-500/40'); } else { colorCard.classList.add('bg-slate-900/80', 'border-slate-800'); colorCard.classList.remove('bg-emerald-950/20', 'border-emerald-500/40'); } } updateModifiedCount(); requestSceneRender();
};

window.invertSingleColor = function(key) { const item = state.colorsMap.get(key); if (!item) return; window.fastUpdateColor(key, rgbToHex(255 - item.currentR, 255 - item.currentG, 255 - item.currentB), item.currentA); };
if(invertAllColorsBtn) { invertAllColorsBtn.addEventListener('click', () => { state.colorsMap.forEach(item => window.fastUpdateColor(item.key, rgbToHex(255 - item.currentR, 255 - item.currentG, 255 - item.currentB), item.currentA)); window.showToast("Все цвета инвертированы"); }); }
window.resetSingleColor = function(key) { const item = state.colorsMap.get(key); if (!item) return; window.fastUpdateColor(key, item.origHex, item.origA); };
if(resetAllColorsBtn) { resetAllColorsBtn.addEventListener('click', () => { state.colorsMap.forEach(item => window.fastUpdateColor(item.key, item.origHex, item.origA)); window.showToast("Все цвета сброшены"); }); }

function updateModifiedCount() { let mod = 0; state.colorsMap.forEach(item => { if (item.currentHex !== item.origHex || item.currentA !== item.origA) mod++; }); state.modifiedColorsCount = mod; if(modifiedCount) modifiedCount.textContent = `Изменено: ${mod}`; }

window.updateExportState = function() {
    const hasFiles = state.files.length > 0;
    const hasVectors = window.getVectorsForJSON && window.getVectorsForJSON().length > 0;
    const canExport = hasFiles || hasVectors;
    if(exportZipBtn) exportZipBtn.disabled = !canExport; 
    if(saveProjectBtn) saveProjectBtn.disabled = !canExport;
};

function build3DScene(resetCamera = true) {
    fastColorPointers.clear();
    const objectsToRemove = scene.children.filter(child => child.isMesh && child.userData.isMapMesh);
    const disposedGeometries = new Set();
    objectsToRemove.forEach(obj => { if (obj.geometry && !disposedGeometries.has(obj.geometry)) { obj.geometry.dispose(); disposedGeometries.add(obj.geometry); } if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose()); else obj.material.dispose(); scene.remove(obj); });

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity; let totalVertices = 0;
    state.files.forEach(file => {
        totalVertices += file.vertices.length;
        file.meshesData.forEach(data => {
            const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3)); const updatedColors = new Float32Array(data.positions.length / 3 * 4); const colorAttr = new THREE.BufferAttribute(updatedColors, 4); const localIndicesMap = new Map();
            for(let i=0; i < data.originalColorsList.length; i++) {
                const orig = data.originalColorsList[i]; const zSuffix = state.separateByZ ? `_${Math.round(orig.z)}` : ''; const key = makeRgbaKey(orig.r, orig.g, orig.b, orig.a) + zSuffix; const colorItem = state.colorsMap.get(key);
                updatedColors[i*4] = (colorItem ? colorItem.currentR : orig.r) / 255; updatedColors[i*4+1] = (colorItem ? colorItem.currentG : orig.g) / 255; updatedColors[i*4+2] = (colorItem ? colorItem.currentB : orig.b) / 255; updatedColors[i*4+3] = (colorItem ? colorItem.currentA : orig.a) / 255;
                if (!localIndicesMap.has(key)) localIndicesMap.set(key, []); localIndicesMap.get(key).push(i * 4);
                const x = data.positions[i*3], y = data.positions[i*3+1], z = data.positions[i*3+2]; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
            }
            localIndicesMap.forEach((indices, key) => { if (!fastColorPointers.has(key)) fastColorPointers.set(key, []); fastColorPointers.get(key).push({ attribute: colorAttr, indices: indices }); });
            geometry.setAttribute('customColor', colorAttr); if (data.indices.length > 0) geometry.setIndex(new THREE.BufferAttribute(data.indices, 1)); geometry.computeBoundingSphere(); geometry.computeBoundingBox();
            
            let layerRenderOrder = 50; 
            const nLower = file.name.toLowerCase();
            if (nLower.includes('sea')) layerRenderOrder = 10;
            else if (nLower.includes('back')) layerRenderOrder = 20;
            else if (nLower.includes('mcl') || nLower.includes('vector')) layerRenderOrder = 60;
            else if (nLower.includes('fore')) layerRenderOrder = 70;
            else {
                const match = nLower.match(/tile_(\d)_(\d)/);
                if (match) layerRenderOrder = 30 + (parseInt(match[2], 10) * 3) + parseInt(match[1], 10);
                else layerRenderOrder = 40;
            }

            const opaqueMaterial = new THREE.ShaderMaterial({ vertexShader: `attribute vec4 customColor; varying vec4 vColor; void main() { vColor = customColor; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`, fragmentShader: `varying vec4 vColor; void main() { if (vColor.a < 0.99) discard; gl_FragColor = vec4(vColor.rgb, 1.0); }`, side: THREE.DoubleSide, transparent: false, depthWrite: true, depthTest: true });
            const transparentMaterial = new THREE.ShaderMaterial({ vertexShader: `attribute vec4 customColor; varying vec4 vColor; void main() { vColor = customColor; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`, fragmentShader: `varying vec4 vColor; void main() { if (vColor.a >= 0.99) discard; gl_FragColor = vColor; }`, side: THREE.DoubleSide, transparent: true, depthWrite: false, depthTest: true });
            
            const opaqueMesh = new THREE.Mesh(geometry, opaqueMaterial); 
            opaqueMesh.userData = { isMapMesh: true }; 
            opaqueMesh.renderOrder = layerRenderOrder; 
            scene.add(opaqueMesh); 
            
            const transparentMesh = new THREE.Mesh(geometry, transparentMaterial); 
            transparentMesh.userData = { isMapMesh: true }; 
            transparentMesh.renderOrder = layerRenderOrder + 0.1;
            scene.add(transparentMesh);
        });
    });

    if (minX !== Infinity) {
        const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2, centerZ = (minZ + maxZ) / 2; const maxDim = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 100); 
        window.mapBounds = { centerX, centerY, centerZ, maxZ, maxDim };
        if (resetCamera) { camera.position.set(centerX, centerY, maxZ + maxDim * 1.5); controls.target.set(centerX, centerY, centerZ); controls.update(); }
    } else window.mapBounds = null;
    if(vertexStats) vertexStats.textContent = `Вершин: ${totalVertices.toLocaleString('ru-RU')}`;
    requestSceneRender();
}

if(resetViewBtn) { resetViewBtn.addEventListener('click', () => { if (window.mapBounds) { camera.position.set(window.mapBounds.centerX, window.mapBounds.centerY, window.mapBounds.maxZ + window.mapBounds.maxDim * 1.5); controls.target.set(window.mapBounds.centerX, window.mapBounds.centerY, window.mapBounds.centerZ); controls.update(); } }); }

function saveProjectJson() {
    const vectorsData = window.getVectorsForJSON ? window.getVectorsForJSON() : [];
    if (state.files.length === 0 && vectorsData.length === 0) {
        window.showToast("Нечего сохранять!", "error");
        return;
    }
    
    const hexList = Array.from(state.colorsMap.values()).map(item => item.customName ? `${item.currentHex} - ${item.customName}` : item.currentHex);
    
    const projectData = {
        COLORS_LIST: hexList, version: "8.0", timestamp: new Date().toISOString(),
        solidSea: window.isSeaSolid,
        separateByZ: state.separateByZ,
        files: state.files.map(f => ({ name: f.name.replace(' (/map/)', ''), text: f.text })),
        colors: Array.from(state.colorsMap.values()),
        vectors: vectorsData,
        vectorFont: window.getVectorFontForJSON ? window.getVectorFontForJSON() : null
    };
    const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `gta_map_project_${Date.now()}.json`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    window.showToast("Проект сохранен в JSON!");
}

async function loadProjectJson(file) {
    window.showLoading("Загрузка JSON...");
    try {
        if (file.size > IMPORT_LIMITS.maxTotalBytes) throw new Error('JSON проекта слишком большой');
        const text = await file.text(); const data = JSON.parse(text); if (!data.files && !data.vectors) throw new Error("Неверный формат");
        state.files = []; state.colorsMap.clear(); 
        
        if (data.solidSea !== undefined) {
            window.isSeaSolid = data.solidSea;
            const toggleSeaBtn = document.getElementById('toggleSeaBtn');
            if (toggleSeaBtn) {
                if (window.isSeaSolid) {
                    toggleSeaBtn.classList.remove('bg-slate-800', 'text-slate-400', 'border-slate-700');
                    toggleSeaBtn.classList.add('bg-blue-900/40', 'text-blue-300', 'border-blue-500/50');
                } else {
                    toggleSeaBtn.classList.add('bg-slate-800', 'text-slate-400', 'border-slate-700');
                    toggleSeaBtn.classList.remove('bg-blue-900/40', 'text-blue-300', 'border-blue-500/50');
                }
            }
        }
        
        state.separateByZ = Boolean(data.separateByZ); const separateToggle = document.getElementById('separateZToggle'); if (separateToggle) separateToggle.checked = state.separateByZ;
        
        if (window.clearVectors) window.clearVectors(); 
        
        if(data.files) { for (const f of data.files) processSingleXmlText(f.text, f.name, false); }
        extractUniqueColors();
        if (data.colors && Array.isArray(data.colors)) { data.colors.forEach(savedColor => { if (state.colorsMap.has(savedColor.key)) { const current = state.colorsMap.get(savedColor.key); current.currentHex = savedColor.currentHex; current.currentR = savedColor.currentR; current.currentG = savedColor.currentG; current.currentB = savedColor.currentB; current.currentA = savedColor.currentA; current.customName = savedColor.customName || ""; } }); }
        
        if (data.vectorFont && window.loadVectorFontFromJSON) await window.loadVectorFontFromJSON(data.vectorFont);
        if (data.vectors && window.loadVectorsFromJSON) { window.loadVectorsFromJSON(data.vectors); }
        
        renderFileList(); renderPalette(); build3DScene(false); window.updateExportState(); window.showToast("Проект JSON загружен!");
    } catch (err) { console.error(err); window.showToast("Ошибка с JSON файлом", "error"); } finally { window.hideLoading(); }
}

if(saveProjectBtn) saveProjectBtn.addEventListener('click', saveProjectJson);
if(loadJsonInput) loadJsonInput.addEventListener('change', (e) => { if (e.target.files.length > 0) loadProjectJson(e.target.files[0]); });

window.makeBlenderFormat = function(xmlDoc) {
    let xmlStr = new XMLSerializer().serializeToString(xmlDoc);
    xmlStr = xmlStr.replace(/\s+xmlns="[^"]*"/g, '');
    
    xmlStr = xmlStr.replace(/<Position[^>]*>(?:[\s\S]*?)<\/Position>/g, '<Position />');
    xmlStr = xmlStr.replace(/<Position[^>]*\/>/g, '<Position />');
    xmlStr = xmlStr.replace(/<Colour0[^>]*>(?:[\s\S]*?)<\/Colour0>/g, '<Colour0 />');
    xmlStr = xmlStr.replace(/<Colour0[^>]*\/>/g, '<Colour0 />');
    xmlStr = xmlStr.replace(/<Normal[^>]*>(?:[\s\S]*?)<\/Normal>/g, '<Normal />');
    xmlStr = xmlStr.replace(/<Normal[^>]*\/>/g, '<Normal />');
    xmlStr = xmlStr.replace(/<TexCoord0[^>]*>(?:[\s\S]*?)<\/TexCoord0>/g, '<TexCoord0 />');
    xmlStr = xmlStr.replace(/<TexCoord0[^>]*\/>/g, '<TexCoord0 />');
    
    xmlStr = xmlStr.replace(/<Data2>/g, '<Data>');
    xmlStr = xmlStr.replace(/<\/Data2>/g, '</Data>');
    xmlStr = xmlStr.replace(/<Lights\s*\/>/g, '');
    xmlStr = xmlStr.replace(/<Lights>\s*<\/Lights>/g, '');
    xmlStr = xmlStr.replace(/\"\/>/g, '" />');

    xmlStr = xmlStr.replace(/x="0"\s+y="0"\s+z="0"\s+w="0"\s*\/>/g, 'x="0.0" y="0.0" z="0.0" w="0.0" />');
    
    xmlStr = xmlStr.replace(/<VertexBuffer>([\s\S]*?)<Data>([\s\S]*?)<\/Data>/g, function(match, layout, content) {
        let lines = content.trim().split('\n');
        let formattedLines = lines.map(line => {
            let p = line.trim().split(/\s+/).filter(Boolean);
            if (p.length >= 7) {
                let x = parseFloat(p[0]).toFixed(7);
                let y = parseFloat(p[1]).toFixed(7);
                let z = parseFloat(p[2]).toFixed(7);
                return `                ${x} ${y} ${z}   ${p.slice(3).join(' ')}`;
            }
            return line;
        }).filter(l => l.trim().length > 0).join('\n');
        return `<VertexBuffer>${layout}<Data>\n${formattedLines}\n              </Data>`;
    });

    xmlStr = xmlStr.replace(/<IndexBuffer>([\s\S]*?)<Data>([\s\S]*?)<\/Data>/g, function(match, layout, content) {
        let tokens = content.trim().split(/\s+/).filter(Boolean);
        let formattedLines = [];
        for (let i = 0; i < tokens.length; i += 24) {
            formattedLines.push(`                ${tokens.slice(i, i + 24).join(' ')}`);
        }
        return `<IndexBuffer>${layout}<Data>\n${formattedLines.join('\n')}\n              </Data>`;
    });

    if (xmlStr.includes('<?xml')) {
        xmlStr = xmlStr.replace(/<\?xml[^>]*\?>\s*/i, '<?xml version="1.0" encoding="UTF-8"?>\n');
    } else {
        xmlStr = '<?xml version="1.0" encoding="UTF-8"?>\n' + xmlStr;
    }
    xmlStr = xmlStr.replace(/<DrawableDictionary>\s*/i, '<DrawableDictionary>\n');
    xmlStr = xmlStr.replace(/<\/DrawableDictionary>/i, '\n</DrawableDictionary>');

    return xmlStr;
};

window.createEmptyItemXml = function(itemName) {
    return `  <Item>\n   <Name>${itemName}</Name>\n   <BoundingSphereCenter x="0.000000" y="0.000000" z="0.000000" />\n   <BoundingSphereRadius value="0.000000" />\n   <BoundingBoxMin x="0.000000" y="0.000000" z="0.000000" />\n   <BoundingBoxMax x="0.000000" y="0.000000" z="0.000000" />\n   <LodDistHigh value="9998" />\n   <LodDistMed value="9998" />\n   <LodDistLow value="9998" />\n   <LodDistVlow value="9998" />\n   <FlagsHigh value="1" />\n   <FlagsMed value="0" />\n   <FlagsLow value="0" />\n   <FlagsVlow value="0" />\n   <ShaderGroup>\n    <Shaders>\n     <Item>\n      <Name>minimap</Name>\n      <FileName>minimap.sps</FileName>\n      <RenderBucket value="0" />\n      <Parameters>\n       <Item name="useTessellation" type="Vector" x="0.0" y="0.0" z="0.0" w="0.0" />\n      </Parameters>\n     </Item>\n    </Shaders>\n   </ShaderGroup>\n   <DrawableModelsHigh>\n    <Item>\n     <RenderMask value="255" />\n     <Flags value="0" />\n     <HasSkin value="0" />\n     <BoneIndex value="0" />\n     <Unknown1 value="0" />\n     <Geometries>\n      <Item>\n       <ShaderIndex value="0" />\n       <BoundingBoxMin x="0.000000" y="0.000000" z="0.000000" />\n       <BoundingBoxMax x="0.000000" y="0.000000" z="0.000000" />\n       <VertexBuffer>\n        <Flags value="0" />\n        <Layout type="GTAV1">\n         <Position />\n         <Colour0 />\n        </Layout>\n        <Data>\n                0.0000000 0.0000000 0.0000000   0 0 0 0\n                0.0000000 0.0000000 0.0000000   0 0 0 0\n                0.0000000 0.0000000 0.0000000   0 0 0 0\n        </Data>\n       </VertexBuffer>\n       <IndexBuffer>\n        <Data>\n                0 1 2\n        </Data>\n       </IndexBuffer>\n      </Item>\n     </Geometries>\n    </Item>\n   </DrawableModelsHigh>\n  </Item>`;
};

window.createNewItemXml = function(t, itemName) {
    const centerX = (t.minX + t.maxX) / 2;
    const centerY = (t.minY + t.maxY) / 2;
    const centerZ = (t.minZ + t.maxZ) / 2;
    
    let maxRadiusSq = 0;
    t.vertices.forEach(line => {
        const p = line.trim().split(/\s+/).filter(Boolean);
        if (p.length >= 3) {
            const dx = parseFloat(p[0]) - centerX, dy = parseFloat(p[1]) - centerY, dz = parseFloat(p[2]) - centerZ;
            const distSq = dx*dx + dy*dy + dz*dz;
            if (distSq > maxRadiusSq) maxRadiusSq = distSq;
        }
    });
    const radius = Math.sqrt(maxRadiusSq);
    
    let iStr = "\n"; 
    for(let i=0; i<t.indices.length; i+=24) iStr += "                " + t.indices.slice(i, i+24).join(" ") + "\n";
    
    return `  <Item>\n   <Name>${itemName}</Name>\n   <BoundingSphereCenter x="${centerX.toFixed(6)}" y="${centerY.toFixed(6)}" z="${centerZ.toFixed(6)}" />\n   <BoundingSphereRadius value="${radius.toFixed(6)}" />\n   <BoundingBoxMin x="${t.minX.toFixed(6)}" y="${t.minY.toFixed(6)}" z="${t.minZ.toFixed(6)}" />\n   <BoundingBoxMax x="${t.maxX.toFixed(6)}" y="${t.maxY.toFixed(6)}" z="${t.maxZ.toFixed(6)}" />\n   <LodDistHigh value="9998" />\n   <LodDistMed value="9998" />\n   <LodDistLow value="9998" />\n   <LodDistVlow value="9998" />\n   <FlagsHigh value="1" />\n   <FlagsMed value="0" />\n   <FlagsLow value="0" />\n   <FlagsVlow value="0" />\n   <ShaderGroup>\n    <Shaders>\n     <Item>\n      <Name>minimap</Name>\n      <FileName>minimap.sps</FileName>\n      <RenderBucket value="0" />\n      <Parameters>\n       <Item name="useTessellation" type="Vector" x="0.0" y="0.0" z="0.0" w="0.0" />\n      </Parameters>\n     </Item>\n    </Shaders>\n   </ShaderGroup>\n   <DrawableModelsHigh>\n    <Item>\n     <RenderMask value="255" />\n     <Flags value="0" />\n     <HasSkin value="0" />\n     <BoneIndex value="0" />\n     <Unknown1 value="0" />\n     <Geometries>\n      <Item>\n       <ShaderIndex value="0" />\n       <BoundingBoxMin x="${t.minX.toFixed(6)}" y="${t.minY.toFixed(6)}" z="${t.minZ.toFixed(6)}" />\n       <BoundingBoxMax x="${t.maxX.toFixed(6)}" y="${t.maxY.toFixed(6)}" z="${t.maxZ.toFixed(6)}" />\n       <VertexBuffer>\n        <Flags value="0" />\n        <Layout type="GTAV1">\n         <Position />\n         <Colour0 />\n        </Layout>\n        <Data>\n${t.vertices.join('\n')}\n        </Data>\n       </VertexBuffer>\n       <IndexBuffer>\n        <Data>${iStr}               </Data>\n       </IndexBuffer>\n      </Item>\n     </Geometries>\n    </Item>\n   </DrawableModelsHigh>\n  </Item>`;
};

window.recalculateAllBounds = function(xmlDoc) {
    const getDirectChild = (parent, tag) => Array.from(parent.children).find(c => c.nodeName === tag);
    const rootItems = Array.from(xmlDoc.documentElement.children).filter(c => c.nodeName === 'Item');

    rootItems.forEach(rootItem => {
        let rootVerts = [];
        let hasValidGeom = false;

        const modelLists = ['DrawableModelsHigh', 'DrawableModelsMed', 'DrawableModelsLow', 'DrawableModelsVlow'];
        modelLists.forEach(listName => {
            const listNode = getDirectChild(rootItem, listName);
            if (!listNode) return;

            Array.from(listNode.children).filter(c => c.nodeName === 'Item').forEach(model => {
                let modelVerts = [];
                let modelHasGeom = false;

                const geomList = getDirectChild(model, 'Geometries');
                if (!geomList) return;

                Array.from(geomList.children).filter(c => c.nodeName === 'Item').forEach(geom => {
                    const vb = getDirectChild(geom, 'VertexBuffer');
                    if (!vb) return;
                    const vData = getDirectChild(vb, 'Data2') || getDirectChild(vb, 'Data');
                    if (!vData) return;

                    let geomVerts = [];
                    vData.textContent.split('\n').forEach(line => {
                        const p = line.trim().split(/\s+/).filter(Boolean);
                        if (p.length >= 3) {
                            const x = parseFloat(p[0]), y = parseFloat(p[1]), z = parseFloat(p[2]);
                            if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
                                geomVerts.push({x, y, z});
                            }
                        }
                    });

                    if (geomVerts.length === 0) {
                         geom.remove(); 
                         return;
                    }

                    const bounds = window.GeometryUtils.calculateBoundsFromVertices(geomVerts);
                    window.GeometryUtils.setDirectBounds(geom, bounds);
                    modelVerts.push(...geomVerts);
                    modelHasGeom = true;
                });

                if (modelHasGeom) {
                    const bounds = window.GeometryUtils.calculateBoundsFromVertices(modelVerts);
                    window.GeometryUtils.setDirectBounds(model, bounds);
                    rootVerts.push(...modelVerts);
                    hasValidGeom = true;
                } else {
                    model.remove(); 
                }
            });
        });

        if (hasValidGeom) {
            const bounds = window.GeometryUtils.calculateBoundsFromVertices(rootVerts);
            window.GeometryUtils.setDirectBounds(rootItem, bounds);
        } else {
            rootItem.remove(); 
        }
    });
};

async function exportModifiedZip() {
    const hasFiles = state.files.length > 0;
    const hasVectors = window.getVectorCount ? (window.getVectorCount() > 0) : false;
    if (!hasFiles && !hasVectors) return;

    window.showLoading("Сборка архива...", "Нарезка выполняется локально...");

    try {
        await new Promise(resolve => setTimeout(resolve, 50));
        const zip = new JSZip();
        const exportFiles = cloneFilesForExport(state.files);
        
        const mapFiles = exportFiles.filter(f => f.name.toLowerCase().startsWith('minimap_'));
        const customFiles = exportFiles.filter(f => !f.name.toLowerCase().startsWith('minimap_'));

        if (window.exportVectorsToXMLFiles) {
             window.exportVectorsToXMLFiles(mapFiles, customFiles);
        }

        for (const file of mapFiles) {
            const doc = parseXmlOrThrow(file.text, file.name); 
            let fileModified = false;
            
            if (doc.documentElement.nodeName === 'DrawableDictionary') {
                const rootItems = Array.from(doc.documentElement.children).filter(child => child.nodeName === 'Item');
                for (const item of rootItems) { 
                    let shaderGroup = Array.from(item.children).find(child => child.nodeName === 'ShaderGroup'); 
                    let existingFileName = 'minimap.sps', existingName = 'minimap', renderBucket = '0';

                    if (shaderGroup) {
                        let shaders = Array.from(shaderGroup.children).find(child => child.nodeName === 'Shaders');
                        if (shaders) {
                            const firstItem = Array.from(shaders.children).find(c => c.nodeName === 'Item');
                            if (firstItem) {
                                const fnNode = firstItem.querySelector('FileName'); if (fnNode) existingFileName = fnNode.textContent;
                                const nNode = firstItem.querySelector('Name'); if (nNode) existingName = nNode.textContent;
                                const rbNode = firstItem.querySelector('RenderBucket'); if (rbNode && rbNode.hasAttribute('value')) renderBucket = rbNode.getAttribute('value');
                            }
                        }
                        item.removeChild(shaderGroup);
                    }
                    
                    const shaderXmlString = `<ShaderGroup>\n   <Shaders>\n    <Item>\n     <Name>${existingName}</Name>\n     <FileName>${existingFileName}</FileName>\n     <RenderBucket value="${renderBucket}" />\n     <Parameters>\n      <Item name="useTessellation" type="Vector" x="0.0" y="0.0" z="0.0" w="0.0" />\n     </Parameters>\n    </Item>\n   </Shaders>\n  </ShaderGroup>`;
                    const shaderNodeTemplate = new DOMParser().parseFromString(shaderXmlString, "application/xml").documentElement;
                    
                    const modelsHighTag = Array.from(item.children).find(child => child.nodeName.startsWith('DrawableModels')); 
                    if (modelsHighTag) item.insertBefore(doc.importNode(shaderNodeTemplate, true), modelsHighTag); 
                    else item.appendChild(doc.importNode(shaderNodeTemplate, true)); 
                    fileModified = true; 
                }
            }
            
            if (window.isSeaSolid) {
                const allItems = Array.from(doc.querySelectorAll('Item')); let seaItems = []; let backItem = null;
                allItems.forEach(item => { const nameNode = item.querySelector('Name'); if (nameNode && item.querySelector('VertexBuffer')) { const txt = nameNode.textContent.trim().toLowerCase(); if (txt.includes('supertile_sea')) seaItems.push(item); else if (txt.includes('supertile_back')) backItem = item; } });
                if (seaItems.length > 0) {
                    fileModified = true;
                    if (!backItem) { 
                        seaItems.forEach(sea => { const nameNode = sea.querySelector('Name'); if(nameNode) nameNode.textContent = nameNode.textContent.replace(/sea/i, 'back'); }); 
                    } else {
                        const backVb = backItem.querySelector('VertexBuffer Data2') || backItem.querySelector('VertexBuffer Data'); const backIb = backItem.querySelector('IndexBuffer Data2') || backItem.querySelector('IndexBuffer Data');
                        if (backVb && backIb) {
                            let backVLines = []; backVb.textContent.split('\n').forEach(line => { const p = line.trim().split(/\s+/).filter(Boolean); if (p.length >= 7) backVLines.push(`                ${p[0]} ${p[1]} ${p[2]}   ${p.slice(3).join(' ')}`); }); 
                            let allBackTokens = backIb.textContent.trim().split(/\s+/).filter(t => t !== '');
                            
                            let combinedSeaVLines = []; let combinedSeaTokens = [];
                            seaItems.forEach(seaItem => { 
                                const seaVb = seaItem.querySelector('VertexBuffer Data2') || seaItem.querySelector('VertexBuffer Data'); const seaIb = seaItem.querySelector('IndexBuffer Data2') || seaItem.querySelector('IndexBuffer Data'); if (!seaVb || !seaIb) return; 
                                let seaVLines = []; seaVb.textContent.split('\n').forEach(line => { const p = line.trim().split(/\s+/).filter(Boolean); if (p.length >= 7) seaVLines.push(`                ${p[0]} ${p[1]} ${p[2]}   ${p.slice(3).join(' ')}`); }); 
                                const seaITokens = seaIb.textContent.trim().split(/\s+/).filter(t => t !== ''); 
                                const currentSeaVCount = combinedSeaVLines.length; 
                                const newSeaITokens = seaITokens.map(t => parseInt(t, 10) + currentSeaVCount); 
                                combinedSeaVLines = combinedSeaVLines.concat(seaVLines); combinedSeaTokens = combinedSeaTokens.concat(newSeaITokens); 
                                if (seaItem.parentNode) seaItem.parentNode.removeChild(seaItem); 
                            });
                            
                            const totalSeaVCount = combinedSeaVLines.length;
                            allBackTokens = allBackTokens.map(t => parseInt(t, 10) + totalSeaVCount);
                            
                            backVLines = combinedSeaVLines.concat(backVLines);
                            allBackTokens = combinedSeaTokens.concat(allBackTokens);
                            
                            backVb.textContent = "\n" + backVLines.join('\n') + "\n              "; let iStr = "\n"; for(let i = 0; i < allBackTokens.length; i += 24) { iStr += "                " + allBackTokens.slice(i, i+24).join(" ") + "\n"; } backIb.textContent = iStr + "              "; const geomItem = backVb.closest('Geometry') || backItem; geomItem.querySelectorAll('Vertices, VertexCount').forEach(n => { if (n.hasAttribute('value')) n.setAttribute('value', backVLines.length); }); geomItem.querySelectorAll('Indices, IndicesCount').forEach(n => { if (n.hasAttribute('value')) n.setAttribute('value', allBackTokens.length); }); geomItem.querySelectorAll('PrimitiveCount').forEach(n => { if (n.hasAttribute('value')) n.setAttribute('value', allBackTokens.length / 3); });
                        }
                    }
                }
            }

            const vertexBuffers = doc.querySelectorAll('VertexBuffer');
            for (let vb of vertexBuffers) {
                const geomItem = vb.closest('Geometry') || vb.closest('Item'); if (!geomItem) continue; 
                const vDataNode = vb.querySelector('Data2') || vb.querySelector('Data'); if (!vDataNode) continue; 
                const rawLines = vDataNode.textContent.split('\n'); let validVerts = []; 
                rawLines.forEach(line => { const p = line.trim().split(/\s+/).filter(Boolean); if (p.length >= 7) validVerts.push({ parts: p, r: parseInt(p[3]), g: parseInt(p[4]), b: parseInt(p[5]), a: parseInt(p[6]), z: parseFloat(p[2]) }); }); 
                
                let originalGeomModified = false; 
                for (let i = 0; i < validVerts.length; i++) { 
                    const vert = validVerts[i]; const origZ = Math.round(vert.z); 
                    const zSuffix = state.separateByZ ? `_${origZ}` : ''; 
                    const key = `${vert.r}_${vert.g}_${vert.b}_${vert.a}${zSuffix}`; 
                    const colorItem = state.colorsMap.get(key); 
                    if (colorItem && (colorItem.currentR !== vert.r || colorItem.currentG !== vert.g || colorItem.currentB !== vert.b || colorItem.currentA !== vert.a)) { 
                        originalGeomModified = true; vert.parts[3] = colorItem.currentR; vert.parts[4] = colorItem.currentG; vert.parts[5] = colorItem.currentB; vert.parts[6] = colorItem.currentA; 
                    } 
                }
                if (originalGeomModified) { 
                    fileModified = true; 
                    let updatedOriginalVLines = validVerts.map(v => `                ${v.parts[0]} ${v.parts[1]} ${v.parts[2]}   ${v.parts.slice(3).join(' ')}`); 
                    vDataNode.textContent = "\n" + updatedOriginalVLines.join('\n') + "\n              "; 
                }
            }
            
            const match = file.name.match(/minimap_(\d+)_(\d+)/i);
            if (match) {
                window.recalculateAllBounds(doc);
            }

            file.text = window.makeBlenderFormat(doc);
            zip.file(file.name, file.text);
        }

        const zipBlob = await zip.generateAsync({ type: "blob" }); 
        const downloadUrl = URL.createObjectURL(zipBlob); 
        const a = document.createElement('a'); 
        a.href = downloadUrl; 
        a.download = "gta5_modified_map.zip"; 
        document.body.appendChild(a); 
        a.click(); 
        document.body.removeChild(a); 
        URL.revokeObjectURL(downloadUrl);
        
        window.showToast("Архив скачан!");
    } catch (err) { 
        console.error(err); 
        window.showToast("Ошибка при экспорте", "error"); 
    } finally { 
        window.hideLoading(); 
    }
}

if(exportZipBtn) exportZipBtn.addEventListener('click', exportModifiedZip);

if (window.lucide) window.lucide.createIcons();
loadDefaultMapFromFolder();

const separateZToggle = document.getElementById('separateZToggle');
if (separateZToggle) {
    separateZToggle.addEventListener('change', (e) => {
        state.separateByZ = e.target.checked; window.showLoading("Перестроение палитры..."); setTimeout(() => { extractUniqueColors(); renderPalette(document.getElementById('colorSearchInput') ? document.getElementById('colorSearchInput').value : ''); build3DScene(false); window.hideLoading(); }, 50);
    });
}

const gridBtn = document.getElementById('toggleGridBtn');
let isGridVisible = false; let gridMesh = null;
function toggleMapGrid() {
    isGridVisible = !isGridVisible;
    if (isGridVisible) {
        if (!gridMesh) { const material = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, depthTest: false }); const points = []; const startX = -4500, endX = 4900, stepX = 1175; const startY = -4492, endY = 8000, stepY = 1388; const z = 0; for (let i = 0; i <= 8; i++) { const x = startX + i * stepX; points.push(new THREE.Vector3(x, startY, z)); points.push(new THREE.Vector3(x, endY, z)); } for (let i = 0; i <= 9; i++) { const y = startY + i * stepY; points.push(new THREE.Vector3(startX, y, z)); points.push(new THREE.Vector3(endX, y, z)); } const geometry = new THREE.BufferGeometry().setFromPoints(points); gridMesh = new THREE.LineSegments(geometry, material); gridMesh.renderOrder = 9999; }
        scene.add(gridMesh); window.showToast("Сетка радара (8x9) включена", "success");
    } else { if (gridMesh) scene.remove(gridMesh); window.showToast("Сетка выключена", "success"); } requestSceneRender(); return isGridVisible;
}
if (gridBtn) {
    gridBtn.addEventListener('click', () => { 
        const isActive = toggleMapGrid(); 
        if (isActive) { gridBtn.classList.add('bg-emerald-500/20', 'text-emerald-400', 'border-emerald-500/50'); gridBtn.classList.remove('bg-slate-800', 'text-slate-300', 'border-slate-700'); } 
        else { gridBtn.classList.remove('bg-emerald-500/20', 'text-emerald-400', 'border-emerald-500/50'); gridBtn.classList.add('bg-slate-800', 'text-slate-300', 'border-slate-700'); } 
        if (window.lucide) window.lucide.createIcons(); 
    });
}

window.processSingleXmlText = processSingleXmlText;
window.extractUniqueColors = extractUniqueColors;
window.renderFileList = renderFileList;
window.renderPalette = renderPalette;
window.build3DScene = build3DScene;

const toggleRightPanelBtn = document.getElementById('toggleRightPanelBtn');
const sidebarPanel = document.getElementById('sidebarPanel');
const rightPanelIcon = document.getElementById('rightPanelIcon');

if (toggleRightPanelBtn && sidebarPanel) {
    toggleRightPanelBtn.addEventListener('click', () => {
        sidebarPanel.classList.toggle('hidden-panel');
        const isHidden = sidebarPanel.classList.contains('hidden-panel');
        rightPanelIcon.setAttribute('data-lucide', isHidden ? 'panel-right-close' : 'panel-right-open');
        toggleRightPanelBtn.classList.toggle('text-emerald-400', !isHidden);
        toggleRightPanelBtn.classList.toggle('text-slate-400', isHidden);
        if (window.lucide) window.lucide.createIcons();
        setTimeout(resizeCanvas, 310);
    });
}

const toggleSeaBtn = document.getElementById('toggleSeaBtn');
if (toggleSeaBtn) {
    toggleSeaBtn.addEventListener('click', () => {
        window.isSeaSolid = !window.isSeaSolid;
        if (window.isSeaSolid) {
            toggleSeaBtn.classList.remove('bg-slate-800', 'text-slate-400', 'border-slate-700');
            toggleSeaBtn.classList.add('bg-blue-900/40', 'text-blue-300', 'border-blue-500/50');
        } else {
            toggleSeaBtn.classList.add('bg-slate-800', 'text-slate-400', 'border-slate-700');
            toggleSeaBtn.classList.remove('bg-blue-900/40', 'text-blue-300', 'border-blue-500/50');
        }
    });
}