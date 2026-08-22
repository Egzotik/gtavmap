// ==========================================
// ИНСТРУМЕНТЫ ВЕКТОРОВ (Текст, SVG, Фигуры)
// ==========================================

const vectorState = {
    objects: [],
    activeObj: null,
    loadedFont: null,
    loadedFontName: 'Roboto Black',
    loadedFontData: null
};

function getMeshes(object, includeStrokes = false) {
    const meshes = [];
    if (!object) return meshes;
    object.traverse(child => { if (child.isMesh && (includeStrokes || !child.userData.isStroke)) meshes.push(child); });
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

// Очистка векторов
window.clearVectors = function() {
    if (window.vectorTransformControl) window.vectorTransformControl.detach();
    vectorState.objects.forEach(obj => { scene.remove(obj); disposeObject3D(obj); });
    vectorState.objects = [];
    vectorState.activeObj = null;
    document.getElementById('vectorLayersList').innerHTML = '<div class="text-[10px] text-slate-500 text-center py-2">Слоев нет</div>';
    document.getElementById('vectorPropsPanel').classList.add('hidden');
    if (window.updateExportState) window.updateExportState();
    if (window.requestSceneRender) window.requestSceneRender();
};

document.addEventListener("DOMContentLoaded", () => {
    const transformControl = new THREE.TransformControls(camera, renderer.domElement);
    window.vectorTransformControl = transformControl;
    scene.add(transformControl);

    // Загрузка русского шрифта (Roboto) по умолчанию
    const ttfLoader = new THREE.TTFLoader();
    ttfLoader.load('vendor/roboto-black-webfont.ttf', (parsed) => {
        vectorState.loadedFont = new THREE.Font(parsed);
        vectorState.loadedFontName = 'Roboto Black';
    }, undefined, () => window.showToast("Не удалось загрузить стандартный шрифт", "error"));
    
    // Свой шрифт
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

    // Горячие клавиши (W, E, R)
    let isShiftDown = false;
    let initialScale = new THREE.Vector3();
    
    window.addEventListener('keydown', (e) => { 
        if (e.key === 'Shift') isShiftDown = true; 
        
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
        }
    });

    transformControl.addEventListener('change', () => {
        if (window.requestSceneRender) window.requestSceneRender();
        if (transformControl.mode === 'scale' && transformControl.dragging && vectorState.activeObj && isShiftDown) {
            const currScale = vectorState.activeObj.scale;
            const ratioX = currScale.x / initialScale.x;
            const ratioY = currScale.y / initialScale.y;
            const ratioZ = currScale.z / initialScale.z;
            
            let maxRatio = ratioX;
            if (Math.abs(ratioY - 1) > Math.abs(maxRatio - 1)) maxRatio = ratioY;
            if (Math.abs(ratioZ - 1) > Math.abs(maxRatio - 1)) maxRatio = ratioZ;
            
            vectorState.activeObj.scale.set(initialScale.x * maxRatio, initialScale.y * maxRatio, initialScale.z * maxRatio);
        }
        
        if (vectorState.activeObj && transformControl.mode === 'scale') {
            const currentScale = vectorState.activeObj.scale.x;
            const scaleSlider = document.getElementById('vecPropScale');
            const scaleNum = document.getElementById('vecPropScaleNum');
            if (scaleSlider && scaleNum) {
                scaleSlider.value = currentScale;
                scaleNum.value = currentScale.toFixed(2);
            }
        }
    });

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    renderer.domElement.addEventListener('pointerdown', (e) => {
        if (transformControl.axis !== null) return; 
        if (e.button !== 0) return; 

        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, camera);
        
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

    function generateStrokeGeometry(shapes, strokeWidth, quality) {
        if (!shapes || shapes.length === 0) return null;
        let strokeGeometries = [];
        
        shapes.forEach(shape => {
            const ptsData = shape.extractPoints(quality);
            
            const processPath = (pts) => {
                if (pts.length === 0) return;
                if (pts.length > 1 && pts[0].distanceTo(pts[pts.length - 1]) > 0.001) {
                    pts.push(pts[0].clone());
                }
                const geo = THREE.SVGLoader.pointsToStroke(pts, { 
                    strokeWidth: strokeWidth, 
                    strokeLineJoin: 'round', 
                    strokeLineCap: 'round' 
                });
                if (geo) strokeGeometries.push(geo);
            };

            processPath(ptsData.shape);
            ptsData.holes.forEach(processPath);
        });
        
        if (strokeGeometries.length === 0) return null;
        return THREE.BufferGeometryUtils.mergeBufferGeometries(strokeGeometries);
    }

    function selectObject(obj) {
        vectorState.activeObj = obj;
        if (obj) {
            transformControl.attach(obj);
            document.getElementById('vectorPropsPanel').classList.remove('hidden');
            
            const firstMesh = getPrimaryMesh(obj);
            
            if (firstMesh && firstMesh.userData.isText) {
                document.getElementById('vecPropTextContainer').classList.remove('hidden');
                document.getElementById('vecPropTextValue').value = firstMesh.userData.text;
            } else {
                document.getElementById('vecPropTextContainer').classList.add('hidden');
            }

            if (firstMesh && firstMesh.material) {
                document.getElementById('vecPropColor').value = "#" + firstMesh.material.color.getHexString();
                document.getElementById('vecPropAlpha').value = firstMesh.material.opacity;
                document.getElementById('vecPropScale').value = obj.scale.x;
                document.getElementById('vecPropScaleNum').value = obj.scale.x.toFixed(2);
                
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
                }
            }
        } else {
            transformControl.detach();
            document.getElementById('vectorPropsPanel').classList.add('hidden');
        }
        renderLayersList();
        if (window.requestSceneRender) window.requestSceneRender();
    }

    transformControl.addEventListener('change', () => {
        if (vectorState.activeObj) {
            if (transformControl.mode === 'scale') {
                const currentScale = vectorState.activeObj.scale.x;
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

    document.getElementById('vecPropTextValue')?.addEventListener('input', (e) => {
        if (!vectorState.activeObj) return;
        const newText = e.target.value;
        if (!newText.trim()) { const currentTextMesh = getPrimaryMesh(vectorState.activeObj); e.target.value = currentTextMesh?.userData.text || 'Текст'; window.showToast('Текст не может быть пустым', 'error'); return; }
        const obj = vectorState.activeObj;
        const meshes = getMeshes(obj, false);
        
        meshes.forEach(mesh => {
            if (mesh.userData.isText && vectorState.loadedFont) {
                const qual = mesh.userData.quality || 12;
                const shapes = vectorState.loadedFont.generateShapes(newText, 10);
                const newGeo = new THREE.ShapeGeometry(shapes, qual);
                newGeo.userData.shapes = shapes;
                
                newGeo.computeBoundingBox();
                const centerX = -0.5 * (newGeo.boundingBox.max.x - newGeo.boundingBox.min.x);
                const centerY = -0.5 * (newGeo.boundingBox.max.y - newGeo.boundingBox.min.y);
                newGeo.translate(centerX, centerY, 0);
                newGeo.userData.tX = centerX;
                newGeo.userData.tY = centerY;
                
                mesh.geometry.dispose();
                mesh.geometry = newGeo;
                mesh.userData.text = newText;
                obj.name = newText || 'Текст';
                
                getStrokeMeshes(obj).filter(stroke => stroke.userData.parentMeshId === mesh.uuid).forEach(stroke => { stroke.userData.strokeWidth = -1; });
            }
        });
        applyPropsToActive();
        renderLayersList();
    });

    document.getElementById('vecPropQuality')?.addEventListener('input', (e) => { document.getElementById('vecPropQualityNum').value = e.target.value; applyPropsToActive(true); });
    document.getElementById('vecPropQualityNum')?.addEventListener('input', (e) => { document.getElementById('vecPropQuality').value = e.target.value; applyPropsToActive(true); });
    
    document.getElementById('vecPropScale')?.addEventListener('input', (e) => { document.getElementById('vecPropScaleNum').value = e.target.value; applyPropsToActive(); });
    document.getElementById('vecPropScaleNum')?.addEventListener('input', (e) => { document.getElementById('vecPropScale').value = e.target.value; applyPropsToActive(); });

    document.getElementById('vecPropRot')?.addEventListener('input', (e) => { document.getElementById('vecPropRotNum').value = e.target.value; applyPropsToActive(); });
    document.getElementById('vecPropRotNum')?.addEventListener('input', (e) => { document.getElementById('vecPropRot').value = e.target.value; applyPropsToActive(); });

    document.getElementById('vecPropStrokeWidth')?.addEventListener('input', (e) => { document.getElementById('vecPropStrokeWidthNum').value = e.target.value; applyPropsToActive(false, true); });
    document.getElementById('vecPropStrokeWidthNum')?.addEventListener('input', (e) => { document.getElementById('vecPropStrokeWidth').value = e.target.value; applyPropsToActive(false, true); });

    document.getElementById('vecPropColor')?.addEventListener('input', () => applyPropsToActive(false, false, true));
    document.getElementById('vecPropAlpha')?.addEventListener('input', () => applyPropsToActive(false, false, true));
    document.getElementById('vecPropStroke')?.addEventListener('change', () => applyPropsToActive());
    document.getElementById('vecPropStrokeColor')?.addEventListener('input', () => applyPropsToActive());

    function applyPropsToActive(forceRebuildText = false, forceRebuildStroke = false, markStyleOverride = false) {
        if (!vectorState.activeObj) return;
        const colorHex = document.getElementById('vecPropColor').value;
        const alpha = parseFloat(document.getElementById('vecPropAlpha').value);
        const useStroke = document.getElementById('vecPropStroke').checked;
        const strokeHex = document.getElementById('vecPropStrokeColor').value;
        const strokeWidth = parseFloat(document.getElementById('vecPropStrokeWidthNum').value) || 10;
        const scaleVal = parseFloat(document.getElementById('vecPropScaleNum').value) || 1;
        const rotVal = parseFloat(document.getElementById('vecPropRotNum').value) || 0;
        const qualityVal = parseInt(document.getElementById('vecPropQualityNum').value) || 12;
        const textVal = document.getElementById('vecPropTextValue').value;

        document.getElementById('vecPropStrokeTools').classList.toggle('hidden', !useStroke);

        const obj = vectorState.activeObj;
        if (obj.userData.isSvg && markStyleOverride) obj.userData.styleOverridden = true;
        
        obj.scale.set(scaleVal, scaleVal, scaleVal);
        obj.rotation.z = THREE.MathUtils.degToRad(rotVal);
        
        const primaryMeshes = getMeshes(obj, false);
        const firstMesh = primaryMeshes[0];
        if (!firstMesh) return;

        if (forceRebuildText && firstMesh.userData.isText && vectorState.loadedFont) {
            const shapes = vectorState.loadedFont.generateShapes(textVal, 10);
            const newGeo = new THREE.ShapeGeometry(shapes, qualityVal);
            newGeo.userData.shapes = shapes;
            
            newGeo.computeBoundingBox();
            const centerX = -0.5 * (newGeo.boundingBox.max.x - newGeo.boundingBox.min.x);
            const centerY = -0.5 * (newGeo.boundingBox.max.y - newGeo.boundingBox.min.y);
            newGeo.translate(centerX, centerY, 0);
            newGeo.userData.tX = centerX;
            newGeo.userData.tY = centerY;
            
            firstMesh.geometry.dispose();
            firstMesh.geometry = newGeo;
            firstMesh.userData.text = textVal;
            firstMesh.userData.quality = qualityVal;
            obj.name = textVal || 'Текст';
            
            forceRebuildStroke = true;
        }

        primaryMeshes.forEach(mesh => {
            if (!obj.userData.isSvg || obj.userData.styleOverridden) {
                mesh.material.color.set(colorHex);
                mesh.material.opacity = alpha;
                mesh.material.transparent = alpha < 1;
            }
            mesh.renderOrder = 999;
            mesh.position.z = 0.5;

            let strokeMesh = getStrokeMeshes(obj).find(stroke => stroke.userData.parentMeshId === mesh.uuid);
            if (useStroke && mesh.geometry.userData && mesh.geometry.userData.shapes) {
                if (!strokeMesh || strokeMesh.userData.strokeWidth !== strokeWidth || forceRebuildStroke) {
                    const strokeGeo = generateStrokeGeometry(mesh.geometry.userData.shapes, strokeWidth * 0.1, qualityVal);
                    if (strokeGeo) {
                        if (!strokeMesh) {
                            strokeMesh = new THREE.Mesh(strokeGeo, new THREE.MeshBasicMaterial({ color: strokeHex, depthWrite: false }));
                            strokeMesh.userData.isStroke = true;
                            strokeMesh.userData.parentMeshId = mesh.uuid;
                            mesh.parent.add(strokeMesh);
                        } else { strokeMesh.geometry.dispose(); strokeMesh.geometry = strokeGeo; }
                        strokeMesh.userData.strokeWidth = strokeWidth;
                        strokeMesh.geometry.translate(mesh.geometry.userData.tX || 0, mesh.geometry.userData.tY || 0, 0);
                    }
                }
                if (strokeMesh) {
                    strokeMesh.material.color.set(strokeHex); strokeMesh.material.opacity = alpha; strokeMesh.material.transparent = alpha < 1;
                    strokeMesh.position.z = -0.5; strokeMesh.renderOrder = 998; strokeMesh.scale.set(1, 1, 1);
                }
            } else if (strokeMesh) {
                if (strokeMesh.parent) strokeMesh.parent.remove(strokeMesh);
                disposeObject3D(strokeMesh);
            }
        });
        if (window.requestSceneRender) window.requestSceneRender();
    }

    function duplicateObject(obj) {
        const data = window.getVectorsForJSON().find(d => d.uuid === obj.uuid);
        if (data) {
            const cloneData = JSON.parse(JSON.stringify(data)); 
            cloneData.uuid = THREE.MathUtils.generateUUID(); 
            cloneData.position.x += 50; 
            cloneData.position.y -= 50;
            cloneData.name = cloneData.name + " (Копия)";
            window.loadVectorsFromJSON([cloneData]); 
            window.showToast("Слой скопирован", "success");
        }
    }

    function renderLayersList() {
        const list = document.getElementById('vectorLayersList');
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
                    if (window.vectorTransformControl && window.vectorTransformControl.object === obj) window.vectorTransformControl.detach();
                    scene.remove(obj);
                    disposeObject3D(obj);
                    vectorState.objects = vectorState.objects.filter(o => o !== obj);
                    if (isActive) selectObject(null);
                    else renderLayersList();
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

    function spawnVectorMesh(geometry, name, icon, isText = false, textContent = '', defaultScale = 1) {
        const material = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 1, depthWrite: false });
        const mesh = new THREE.Mesh(geometry, material); 
        
        geometry.computeBoundingBox();
        const centerX = -0.5 * (geometry.boundingBox.max.x - geometry.boundingBox.min.x);
        const centerY = -0.5 * (geometry.boundingBox.max.y - geometry.boundingBox.min.y);
        geometry.translate(centerX, centerY, 0); 
        
        geometry.userData.tX = centerX;
        geometry.userData.tY = centerY;

        const group = new THREE.Group();
        group.uuid = THREE.MathUtils.generateUUID(); 
        group.add(mesh);
        
        group.scale.set(defaultScale, defaultScale, 1);
        
        let spawnZ = window.mapBounds ? window.mapBounds.maxZ + 50 : 50;
        group.position.set(window.mapBounds ? window.mapBounds.centerX : 0, window.mapBounds ? window.mapBounds.centerY : 0, spawnZ);
        
        group.name = name;
        group.userData.icon = icon;
        group.renderOrder = 999; 
        
        if (isText) {
            mesh.userData.isText = true;
            mesh.userData.text = textContent;
            mesh.userData.quality = 12;
            mesh.userData.font = vectorState.loadedFont;
        }
        
        scene.add(group);
        vectorState.objects.push(group);
        selectObject(group);
        if (window.updateExportState) window.updateExportState();
        if (window.requestSceneRender) window.requestSceneRender();
    }

    document.getElementById('btnAddSquare')?.addEventListener('click', () => {
        const shape = new THREE.Shape(); shape.moveTo(-0.5, -0.5); shape.lineTo(0.5, -0.5); shape.lineTo(0.5, 0.5); shape.lineTo(-0.5, 0.5); shape.lineTo(-0.5, -0.5);
        const geo = new THREE.ShapeGeometry(shape); geo.userData.shapes = [shape];
        spawnVectorMesh(geo, 'Квадрат', 'square', false, '', 100); 
    });

    document.getElementById('btnAddCircle')?.addEventListener('click', () => {
        const shape = new THREE.Shape(); shape.absarc(0, 0, 0.5, 0, Math.PI * 2, false);
        const geo = new THREE.ShapeGeometry(shape); geo.userData.shapes = [shape];
        spawnVectorMesh(geo, 'Круг', 'circle', false, '', 100);
    });

    document.getElementById('btnAddTriangle')?.addEventListener('click', () => {
        const shape = new THREE.Shape(); shape.moveTo(0, 0.5); shape.lineTo(0.433, -0.25); shape.lineTo(-0.433, -0.25); shape.lineTo(0, 0.5);
        const geo = new THREE.ShapeGeometry(shape); geo.userData.shapes = [shape];
        spawnVectorMesh(geo, 'Треугольник', 'triangle', false, '', 100);
    });
    
    document.getElementById('btnAddText')?.addEventListener('click', () => {
        const text = document.getElementById('vectorTextInput').value || 'GTA 5';
        if (!vectorState.loadedFont) { window.showToast("Шрифт загружается...", "error"); return; }
        
        const shapes = vectorState.loadedFont.generateShapes(text, 10);
        const geometry = new THREE.ShapeGeometry(shapes, 12);
        geometry.userData.shapes = shapes; 
        
        spawnVectorMesh(geometry, text, 'type', true, text, 10); 
    });

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
                const fillColor = path.userData.style.fill;
                if (fillColor !== undefined && fillColor !== 'none') {
                    const material = new THREE.MeshBasicMaterial({
                        color: new THREE.Color().setStyle(fillColor),
                        opacity: path.userData.style.fillOpacity !== undefined ? path.userData.style.fillOpacity : 1,
                        transparent: true, side: THREE.DoubleSide, depthWrite: false
                    });
                    const shapes = THREE.SVGLoader.createShapes(path);
                    shapes.forEach((shape) => {
                        const geo = new THREE.ShapeGeometry(shape);
                        geo.userData.shapes = [shape]; 
                        group.add(new THREE.Mesh(geo, material));
                    });
                }
            });
            if (getMeshes(group, false).length === 0) throw new Error('SVG не содержит поддерживаемых залитых контуров');

            const box = new THREE.Box3().setFromObject(group);
            const center = box.getCenter(new THREE.Vector3());
            group.position.x = -center.x;
            group.position.y = -center.y;
            
            const wrapper = new THREE.Group();
            wrapper.add(group);
            wrapper.scale.y = -1; 
            wrapper.name = group.name;
            wrapper.userData.icon = 'image';
            wrapper.userData.isSvg = true; 
            wrapper.userData.svgString = svgString;
            wrapper.userData.styleOverridden = false;
            wrapper.uuid = group.uuid;

            let spawnZ = window.mapBounds ? window.mapBounds.maxZ + 50 : 50;
            wrapper.position.set(window.mapBounds ? window.mapBounds.centerX : 0, window.mapBounds ? window.mapBounds.centerY : 0, spawnZ);
            wrapper.renderOrder = 999;
            
            scene.add(wrapper);
            vectorState.objects.push(wrapper);
            selectObject(wrapper);
            if (window.updateExportState) window.updateExportState();
            if (window.requestSceneRender) window.requestSceneRender();
            window.showToast("SVG загружен!");
            e.target.value = "";
          } catch (err) {
            console.error(err);
            window.showToast(err.message || "Ошибка SVG", "error");
          }
        };
        reader.readAsText(file);
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
    
    // ВАЖНО: Идеальное форматирование для OpenIV. <Data> вместо <Data2>, w удалены из BoundingBox.
    window.createNewItemXml = function(t, itemName) {
        const centerX = (t.minX + t.maxX) / 2, centerY = (t.minY + t.maxY) / 2, centerZ = (t.minZ + t.maxZ) / 2;
        const dx = t.maxX - t.minX, dy = t.maxY - t.minY, dz = t.maxZ - t.minZ;
        const radius = Math.sqrt(dx*dx + dy*dy + dz*dz) / 2; 
        
        let iStr = "\n"; 
        for(let i=0; i<t.indices.length; i+=24) iStr += "                " + t.indices.slice(i, i+24).join(" ") + "\n";
        
        return `<Item>\n  <Name>${itemName}</Name>\n  <BoundingSphereCenter x="${centerX.toFixed(6)}" y="${centerY.toFixed(6)}" z="${centerZ.toFixed(6)}" />\n  <BoundingSphereRadius value="${radius.toFixed(6)}" />\n  <BoundingBoxMin x="${t.minX.toFixed(6)}" y="${t.minY.toFixed(6)}" z="${t.minZ.toFixed(6)}" />\n  <BoundingBoxMax x="${t.maxX.toFixed(6)}" y="${t.maxY.toFixed(6)}" z="${t.maxZ.toFixed(6)}" />\n  <LodDistHigh value="9998" />\n  <LodDistMed value="9998" />\n  <LodDistLow value="9998" />\n  <LodDistVlow value="9998" />\n  <FlagsHigh value="1" />\n  <FlagsMed value="0" />\n  <FlagsLow value="0" />\n  <FlagsVlow value="0" />\n  <ShaderGroup>\n   <Shaders>\n    <Item>\n     <Name>minimap</Name>\n     <FileName>minimap.sps</FileName>\n     <RenderBucket value="0" />\n     <Parameters>\n      <Item name="useTessellation" type="Vector" x="0.0" y="0.0" z="0.0" w="0.0" />\n     </Parameters>\n    </Item>\n   </Shaders>\n  </ShaderGroup>\n  <DrawableModelsHigh>\n   <Item>\n    <RenderMask value="255" />\n    <Flags value="0" />\n    <HasSkin value="0" />\n    <BoneIndex value="0" />\n    <Unknown1 value="0" />\n    <Geometries>\n     <Item>\n      <ShaderIndex value="0" />\n      <BoundingBoxMin x="${t.minX.toFixed(6)}" y="${t.minY.toFixed(6)}" z="${t.minZ.toFixed(6)}" />\n      <BoundingBoxMax x="${t.maxX.toFixed(6)}" y="${t.maxY.toFixed(6)}" z="${t.maxZ.toFixed(6)}" />\n      <VertexBuffer>\n       <Flags value="0" />\n       <Layout type="GTAV1">\n        <Position />\n        <Colour0 />\n       </Layout>\n       <Data>\n${t.vertices.join('\n')}\n       </Data>\n      </VertexBuffer>\n      <IndexBuffer>\n       <Data>${iStr}              </Data>\n      </IndexBuffer>\n     </Item>\n    </Geometries>\n   </Item>\n  </DrawableModelsHigh>\n  <Lights />\n </Item>`;
    };

    window.exportVectorsToXMLFiles = function(stateFilesArray) {
        if (vectorState.objects.length === 0) return 0;
        
        const startX = -4500, stepX = 1175, topY = 8000, stepY = 1388;

        const { clipTriangleToCell } = window.GeometryUtils;

        let allVectorTriangles = [];

        vectorState.objects.forEach(wrapper => {
            wrapper.updateMatrixWorld(true);
            wrapper.traverse((child) => {
                if (child.isMesh && child.geometry) {
                    const geo = child.geometry.clone();
                    geo.applyMatrix4(child.matrixWorld);

                    const matColor = child.material.color || new THREE.Color(1,1,1);
                    const opacity = child.material.opacity !== undefined ? child.material.opacity : 1;
                    const r = Math.round(matColor.r * 255);
                    const g = Math.round(matColor.g * 255);
                    const b = Math.round(matColor.b * 255);
                    const a = Math.round(opacity * 255);

                    const posAttr = geo.attributes.position;
                    const indexAttr = geo.index;
                    if (!posAttr) return;

                    const getVertex = (idx) => ({ x: posAttr.getX(idx), y: posAttr.getY(idx), z: posAttr.getZ(idx), r: r, g: g, b: b, a: a });
                    const faceCount = indexAttr ? indexAttr.count / 3 : posAttr.count / 3;

                    for (let i = 0; i < faceCount; i++) {
                        const idx1 = indexAttr ? indexAttr.getX(i * 3) : i * 3;
                        const idx2 = indexAttr ? indexAttr.getX(i * 3 + 1) : i * 3 + 1;
                        const idx3 = indexAttr ? indexAttr.getX(i * 3 + 2) : i * 3 + 2;

                        const v1 = getVertex(idx1), v2 = getVertex(idx2), v3 = getVertex(idx3);
                        const avgZ = (v1.z + v2.z + v3.z) / 3;
                        allVectorTriangles.push({ v1, v2, v3, z: avgZ });
                    }
                    geo.dispose();
                }
            });
        });

        allVectorTriangles.sort((a, b) => a.z - b.z);

        const tiles = {};

        allVectorTriangles.forEach(tri => {
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

                    if (clippedPoly.length >= 3) {
                        const tileKey = `${gx}_${gy}`;
                        if (!tiles[tileKey]) {
                            tiles[tileKey] = { gx: gx, gy: gy, vertices: [], indices: [], vertexMap: new Map(), minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
                        }
                        const tile = tiles[tileKey];
                        const addVertex = (v) => {
                            const vStr = `                ${v.x.toFixed(7)} ${v.y.toFixed(7)} ${v.z.toFixed(7)}   ${Math.round(v.r)} ${Math.round(v.g)} ${Math.round(v.b)} ${Math.round(v.a)}`;
                            if (tile.vertexMap.has(vStr)) return tile.vertexMap.get(vStr);
                            const newIdx = tile.vertices.length; tile.vertices.push(vStr); tile.vertexMap.set(vStr, newIdx);
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

        let modifiedCount = 0;
        
        Object.keys(tiles).forEach(key => {
            const t = tiles[key]; 
            if (t.vertices.length === 0) return;
            
            const targetFileName = `minimap_${t.gx}_${t.gy}.ydd.xml`;
            const fullItemName = `supertile_fore_${t.gx}_${t.gy}_tile_2_2`;

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
                        if (!vDataNode || !iDataNode) throw new Error(`${targetFileName}: tile_2_2 не содержит полные VertexBuffer/IndexBuffer`);
                        
                        const geomItem = vb.closest('Item') || vb.closest('Geometry');
                        const mergeResult = window.GeometryUtils.applyYddGeometryMerge(vDataNode, iDataNode, geomItem, t.vertices, t.indices);
                        geometryChanged = mergeResult.addedTriangleCount > 0;
                    } else {
                        // ВОТ ЭТОТ БЛОК БЫЛ УТЕРЯН! 
                        // Заменяем твою пустую заготовку на полноценный слой с геометрией
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
                styleOverridden: Boolean(obj.userData.styleOverridden)
            };
            
            const firstMesh = getPrimaryMesh(obj);
            if (firstMesh) {
                if (firstMesh.material) {
                    data.color = "#" + firstMesh.material.color.getHexString();
                    data.opacity = firstMesh.material.opacity;
                }
                
                if (firstMesh.userData.isText) {
                    data.isText = true;
                    data.text = firstMesh.userData.text;
                    data.quality = firstMesh.userData.quality || 12;
                }
                
                if (obj.userData.isSvg) {
                    data.isSvg = true;
                    data.svgString = obj.userData.svgString;
                }
                
                const strokeMesh = getStrokeMeshes(obj)[0];
                if (strokeMesh) {
                    data.hasStroke = true;
                    data.strokeColor = "#" + strokeMesh.material.color.getHexString();
                    data.strokeWidth = strokeMesh.userData.strokeWidth || 10;
                }
            }
            return data;
        });
    };
    
    window.loadVectorsFromJSON = function(vectorsData) {
        if (!vectorsData || !Array.isArray(vectorsData)) return;
        
        vectorsData.forEach(data => {
            if (data.isSvg && data.svgString) {
                const svgLoader = new THREE.SVGLoader();
                const svgData = svgLoader.parse(data.svgString);
                
                const group = new THREE.Group();
                group.uuid = data.uuid || THREE.MathUtils.generateUUID();
                group.name = data.name;
                group.userData.icon = data.icon;
                
                svgData.paths.forEach((path) => {
                    const fillColor = path.userData.style.fill;
                    if (fillColor !== undefined && fillColor !== 'none') {
                        const material = new THREE.MeshBasicMaterial({
                            color: new THREE.Color().setStyle(fillColor),
                            opacity: path.userData.style.fillOpacity !== undefined ? path.userData.style.fillOpacity : 1,
                            transparent: true, side: THREE.DoubleSide, depthWrite: false
                        });
                        const shapes = THREE.SVGLoader.createShapes(path);
                        shapes.forEach((shape) => {
                            const geo = new THREE.ShapeGeometry(shape);
                            geo.userData.shapes = [shape];
                            group.add(new THREE.Mesh(geo, material));
                        });
                    }
                });
                
                const box = new THREE.Box3().setFromObject(group);
                const center = box.getCenter(new THREE.Vector3());
                group.position.x = -center.x;
                group.position.y = -center.y;
                
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
                        const shapes = vectorState.loadedFont.generateShapes(data.text, 10);
                        const geometry = new THREE.ShapeGeometry(shapes, quality);
                        geometry.userData.shapes = shapes;
                        spawnLoadedVectorMesh(geometry, data);
                    }
                    if (attempts > 50) clearInterval(checkFont); 
                }, 100);
            } else if (data.icon === 'square') {
                const shape = new THREE.Shape(); shape.moveTo(-0.5, -0.5); shape.lineTo(0.5, -0.5); shape.lineTo(0.5, 0.5); shape.lineTo(-0.5, 0.5); shape.lineTo(-0.5, -0.5);
                const geo = new THREE.ShapeGeometry(shape); geo.userData.shapes = [shape];
                spawnLoadedVectorMesh(geo, data);
            } else if (data.icon === 'circle') {
                const shape = new THREE.Shape(); shape.absarc(0, 0, 0.5, 0, Math.PI * 2, false);
                const geo = new THREE.ShapeGeometry(shape); geo.userData.shapes = [shape];
                spawnLoadedVectorMesh(geo, data);
            } else if (data.icon === 'triangle') {
                const shape = new THREE.Shape(); shape.moveTo(0, 0.5); shape.lineTo(0.433, -0.25); shape.lineTo(-0.433, -0.25); shape.lineTo(0, 0.5);
                const geo = new THREE.ShapeGeometry(shape); geo.userData.shapes = [shape];
                spawnLoadedVectorMesh(geo, data);
            }
        });
        renderLayersList();
    };
    
    function spawnLoadedVectorMesh(geometry, data) {
        const material = new THREE.MeshBasicMaterial({ color: data.color || 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: data.opacity ?? 1, depthWrite: false });
        const mesh = new THREE.Mesh(geometry, material);
        
        geometry.computeBoundingBox();
        const centerX = -0.5 * (geometry.boundingBox.max.x - geometry.boundingBox.min.x);
        const centerY = -0.5 * (geometry.boundingBox.max.y - geometry.boundingBox.min.y);
        geometry.translate(centerX, centerY, 0); 
        geometry.userData.tX = centerX;
        geometry.userData.tY = centerY;
        
        if (data.isText) {
            mesh.userData.isText = true;
            mesh.userData.text = data.text;
            mesh.userData.quality = data.quality || 12;
            mesh.userData.font = vectorState.loadedFont;
        }

        const group = new THREE.Group();
        group.uuid = data.uuid || THREE.MathUtils.generateUUID();
        group.add(mesh);
        group.name = data.name;
        group.userData.icon = data.icon;
        
        applyTransformAndProperties(group, data);
    }
    
    function applyTransformAndProperties(wrapper, data) {
        wrapper.position.set(data.position.x, data.position.y, data.position.z);
        wrapper.rotation.set(data.rotation.x, data.rotation.y, data.rotation.z);
        wrapper.scale.set(data.scale.x, data.scale.y, data.scale.z);
        wrapper.renderOrder = 999;

        if (!data.isSvg || data.styleOverridden) {
            getMeshes(wrapper, false).forEach(mesh => {
                if (data.color && mesh.material && mesh.material.color) mesh.material.color.set(data.color);
                if (data.opacity !== undefined && mesh.material) {
                    mesh.material.opacity = data.opacity;
                    mesh.material.transparent = data.opacity < 1;
                }
            });
        }
        
        if (data.hasStroke) {
            getMeshes(wrapper, false).forEach(firstMesh => {
              if (firstMesh.geometry && firstMesh.geometry.userData.shapes) {
                firstMesh.renderOrder = 999; firstMesh.position.z = 0.5;
                const strokeGeo = generateStrokeGeometry(firstMesh.geometry.userData.shapes, data.strokeWidth * 0.1, firstMesh.userData.quality || 12);
                if (strokeGeo) {
                    const restoredOpacity = data.opacity ?? 1;
                    const strokeMesh = new THREE.Mesh(strokeGeo, new THREE.MeshBasicMaterial({ color: data.strokeColor, opacity: restoredOpacity, transparent: restoredOpacity < 1, depthWrite: false }));
                    strokeMesh.userData.isStroke = true;
                    strokeMesh.userData.strokeWidth = data.strokeWidth;
                    strokeMesh.userData.quality = firstMesh.userData.quality || 12;
                    strokeMesh.userData.parentMeshId = firstMesh.uuid;
                    
                    strokeMesh.position.z = -0.5;
                    strokeMesh.renderOrder = 998;
                    
                    if (data.isText || data.icon !== 'image') {
                        const tX = firstMesh.geometry.userData.tX || 0;
                        const tY = firstMesh.geometry.userData.tY || 0;
                        strokeMesh.geometry.translate(tX, tY, 0);
                    }
                    firstMesh.parent.add(strokeMesh);
                }
              }
            });
        }
        
        scene.add(wrapper);
        vectorState.objects.push(wrapper);
        if (window.updateExportState) window.updateExportState();
        if (window.requestSceneRender) window.requestSceneRender();
    }
});
