// ==========================================
// ИНСТРУМЕНТЫ ВЕКТОРОВ (Текст, SVG, Фигуры)
// ==========================================

const vectorState = {
    objects: [],
    activeObj: null,
    loadedFont: null,
    loadedFontName: 'Roboto Black',
    loadedFontData: null,
    pendingSelectId: null 
};

// --- СОСТОЯНИЕ РЕЖИМА РАЗМЕЩЕНИЯ ---
const placementState = {
    active: false, geo: null, name: '', icon: '', isText: false, textContent: '', defaultScale: 100,
    startPoint: new THREE.Vector3(), currentGroup: null, isDragging: false, prebuiltWrapper: null
};

function startPlacement(geometry, name, icon, isText = false, textContent = '', defaultScale = 100, prebuiltWrapper = null) {
    placementState.active = true;
    placementState.geo = geometry;
    placementState.name = name;
    placementState.icon = icon;
    placementState.isText = isText;
    placementState.textContent = textContent;
    placementState.defaultScale = defaultScale;
    placementState.prebuiltWrapper = prebuiltWrapper;
    
    renderer.domElement.style.cursor = 'crosshair';
    window.showToast("Кликните на карту, зажмите и потяните для масштаба.", "success");
    selectObject(null);
}

function getMeshes(object, includeStrokes = false) {
    const meshes = [];
    if (!object) return meshes;
    object.traverse(child => { if (child.isMesh && (includeStrokes || !child.userData.isStroke)) meshes.push(child); });
    return meshes;
}

function getPrimaryMesh(object) { return getMeshes(object, false)[0] || null; }
function getPrimaryVisibleMesh(object) { return getMeshes(object, false).find(m => m.visible) || getPrimaryMesh(object); }
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

window.clearVectors = function() {
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
                    const firstMesh = getPrimaryVisibleMesh(vectorState.activeObj);
                    if (firstMesh && firstMesh.userData.isText) applyPropsToActive(true);
                }
                window.showToast("Шрифт (.ttf/.otf) загружен!", "success");
            } catch(err) { window.showToast("Ошибка при разборе шрифта!", "error"); }
        };
        reader.readAsArrayBuffer(file);
    });

    let isShiftDown = false;
    let initialScale = new THREE.Vector3();
    
    window.addEventListener('keydown', (e) => { 
        if (e.key === 'Escape' && placementState.active) {
            placementState.active = false;
            placementState.isDragging = false;
            if (placementState.currentGroup) {
                scene.remove(placementState.currentGroup);
                disposeObject3D(placementState.currentGroup);
                vectorState.objects = vectorState.objects.filter(o => o !== placementState.currentGroup);
                placementState.currentGroup = null;
                renderLayersList();
                if (window.requestSceneRender) window.requestSceneRender();
            }
            renderer.domElement.style.cursor = 'default';
            controls.enabled = true;
            window.showToast("Создание фигуры отменено");
        }

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
            
            let maxRatio = Math.max(Math.abs(ratioX - 1), Math.abs(ratioY - 1)) === Math.abs(ratioX - 1) ? ratioX : ratioY;
            
            const signY = vectorState.activeObj.userData.isSvg ? -1 : 1;
            vectorState.activeObj.scale.set(initialScale.x * maxRatio, initialScale.y * maxRatio * signY, 1);
        }
        
        if (vectorState.activeObj && transformControl.mode === 'scale') {
            const currentScale = Math.abs(vectorState.activeObj.scale.x);
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
        if (window.isEyedropperActive) return;
        if (transformControl.axis !== null) return; 
        if (e.button !== 0) return; 

        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, camera);

        if (placementState.active) {
            controls.enabled = false; 
            const planeZ = window.mapBounds ? window.mapBounds.maxZ + 0.5 : 10;
            const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -planeZ);
            raycaster.ray.intersectPlane(plane, placementState.startPoint);
            
            if (placementState.startPoint) {
                if (placementState.prebuiltWrapper) {
                    placementState.currentGroup = placementState.prebuiltWrapper;
                    placementState.currentGroup.position.copy(placementState.startPoint);
                    placementState.currentGroup.scale.set(0.1, placementState.currentGroup.userData.isSvg ? -0.1 : 0.1, 1);
                    scene.add(placementState.currentGroup);
                    vectorState.objects.unshift(placementState.currentGroup); 
                    updateVectorsOrder();
                } else {
                    placementState.currentGroup = createVectorGroup(
                        placementState.geo, placementState.name, placementState.icon, 
                        placementState.isText, placementState.textContent, 0.1,
                        placementState.startPoint
                    );
                }
                placementState.isDragging = true;
                renderLayersList();
            }
            return;
        }
        
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

    renderer.domElement.addEventListener('pointermove', (e) => {
        if (placementState.isDragging && placementState.currentGroup) {
            const rect = renderer.domElement.getBoundingClientRect();
            mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            
            raycaster.setFromCamera(mouse, camera);
            const planeZ = window.mapBounds ? window.mapBounds.maxZ + 0.5 : 10;
            const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -planeZ);
            const currentPoint = new THREE.Vector3();
            raycaster.ray.intersectPlane(plane, currentPoint);
            
            if (currentPoint) {
                const dist = placementState.startPoint.distanceTo(currentPoint);
                const signY = placementState.currentGroup.userData.isSvg ? -1 : 1;
                const newScale = Math.max(1, dist); 
                placementState.currentGroup.scale.set(newScale, newScale * signY, 1);
                
                if (window.requestSceneRender) window.requestSceneRender();
            }
        }
    });

    renderer.domElement.addEventListener('pointerup', (e) => {
        if (placementState.isDragging && placementState.currentGroup) {
            controls.enabled = true; 
            placementState.isDragging = false;
            
            const signY = placementState.currentGroup.userData.isSvg ? -1 : 1;
            if (Math.abs(placementState.currentGroup.scale.x) < 5) {
                placementState.currentGroup.scale.set(placementState.defaultScale, placementState.defaultScale * signY, 1);
            }
            
            selectObject(placementState.currentGroup);
            placementState.active = false;
            placementState.currentGroup = null;
            renderer.domElement.style.cursor = 'default';
            if (window.requestSceneRender) window.requestSceneRender();
        }
    });

    function updateVectorsOrder() {
        const baseZ = window.mapBounds ? window.mapBounds.maxZ + 0.5 : 10;
        const len = vectorState.objects.length;
        vectorState.objects.forEach((o, i) => {
            o.position.z = baseZ + (len - i) * 0.01;
        });
        renderLayersList();
        if (window.requestSceneRender) window.requestSceneRender();
    }

    // ИСПРАВЛЕНИЕ: Обводка больше не имеет острых шипов и принудительно замыкает пути 
    function generateStrokeGeometry(shapesData, strokeWidth, quality) {
        if (!shapesData || shapesData.length === 0) return null;
        let strokeGeometries = [];
        
        shapesData.forEach(data => {
            const { shapes, offsetX, offsetY } = data;
            shapes.forEach(shape => {
                const ptsData = shape.extractPoints(quality);
                
                const processPath = (pts) => {
                    if (!pts || pts.length < 2) return;
                    
                    const vec2Pts = pts.map(p => new THREE.Vector2(p.x, p.y));
                    
                    // Защита от открытых контуров: смыкаем первую и последнюю точку
                    if (vec2Pts[0].distanceTo(vec2Pts[vec2Pts.length - 1]) > 0.0001) {
                        vec2Pts.push(vec2Pts[0].clone());
                    }
                    
                    const geo = THREE.SVGLoader.pointsToStroke(vec2Pts, { 
                        strokeWidth: strokeWidth, 
                        strokeLineJoin: 'round', // Устраняет дикие шипы (вместо miter)
                        strokeLineCap: 'round'
                    });
                    
                    if (geo) {
                        geo.translate(offsetX, offsetY, 0);
                        strokeGeometries.push(geo);
                    }
                };

                processPath(ptsData.shape);
                if (ptsData.holes) ptsData.holes.forEach(processPath);
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
        const svgTools = document.getElementById('vecSvgTools');

        if (obj) {
            transformControl.attach(obj);
            document.getElementById('vectorPropsPanel').classList.remove('hidden');
            
            if (svgTools) {
                if (obj.userData.isSvg) {
                    svgTools.classList.remove('hidden');
                    svgTools.classList.add('flex');
                } else {
                    svgTools.classList.add('hidden');
                    svgTools.classList.remove('flex');
                }
            }

            const firstMesh = getPrimaryVisibleMesh(obj);
            
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

            if (firstMesh && firstMesh.material) {
                document.getElementById('vecPropColor').value = "#" + firstMesh.material.color.getHexString();
                document.getElementById('vecPropAlpha').value = firstMesh.material.opacity;
                document.getElementById('vecPropScale').value = Math.abs(obj.scale.x);
                document.getElementById('vecPropScaleNum').value = Math.abs(obj.scale.x).toFixed(2);
                
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
            if (svgTools) {
                svgTools.classList.add('hidden');
                svgTools.classList.remove('flex');
            }
        }
        renderLayersList();
        if (window.requestSceneRender) window.requestSceneRender();
    }

    document.getElementById('vecBtnRemoveWhite')?.addEventListener('click', () => {
        if (!vectorState.activeObj || !vectorState.activeObj.userData.isSvg) return;
        const obj = vectorState.activeObj;
        const meshes = getMeshes(obj, false);
        let removed = 0;
        if (!obj.userData.hiddenMeshIndices) obj.userData.hiddenMeshIndices = [];
        
        meshes.forEach((mesh, idx) => {
            if (mesh.userData.originalColorHex === 'ffffff' && mesh.visible) {
                mesh.visible = false;
                if (!obj.userData.hiddenMeshIndices.includes(idx)) obj.userData.hiddenMeshIndices.push(idx);
                removed++;
            }
        });
        
        if (removed > 0) {
            window.showToast(`Удалено белых элементов: ${removed}`, 'success');
            selectObject(obj);
            if (window.requestSceneRender) window.requestSceneRender();
        } else {
            window.showToast('Белый фон не найден', 'error');
        }
    });

    document.getElementById('vecBtnRemoveBg')?.addEventListener('click', () => {
        if (!vectorState.activeObj || !vectorState.activeObj.userData.isSvg) return;
        const obj = vectorState.activeObj;
        const meshes = getMeshes(obj, false);
        let maxArea = -1;
        let bgIdx = -1;
        
        meshes.forEach((m, idx) => {
            if (!m.visible) return; 
            m.geometry.computeBoundingBox();
            const box = m.geometry.boundingBox;
            const area = (box.max.x - box.min.x) * (box.max.y - box.min.y);
            if (area > maxArea) {
                maxArea = area;
                bgIdx = idx;
            }
        });
        
        if (bgIdx !== -1) {
            if (!obj.userData.hiddenMeshIndices) obj.userData.hiddenMeshIndices = [];
            meshes[bgIdx].visible = false;
            if (!obj.userData.hiddenMeshIndices.includes(bgIdx)) obj.userData.hiddenMeshIndices.push(bgIdx);
            
            window.showToast("Самый большой контур скрыт", "success");
            selectObject(obj); 
            if (window.requestSceneRender) window.requestSceneRender();
        }
    });

    document.getElementById('vecPropTextValue')?.addEventListener('input', (e) => {
        if (!vectorState.activeObj) return;
        const newText = e.target.value;
        if (!newText.trim()) { const currentTextMesh = getPrimaryVisibleMesh(vectorState.activeObj); e.target.value = currentTextMesh?.userData.text || 'Текст'; window.showToast('Текст не может быть пустым', 'error'); return; }
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
                
                getStrokeMeshes(obj).filter(stroke => stroke.userData.parentMeshId === mesh.uuid).forEach(stroke => { stroke.userData.strokeWidth = -1; });
            }
        });
        applyPropsToActive();
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
        const lineHeightVal = parseFloat(document.getElementById('vecLineHeight') ? document.getElementById('vecLineHeight').value : 1.2) || 1.2;

        document.getElementById('vecPropStrokeTools').classList.toggle('hidden', !useStroke);

        const obj = vectorState.activeObj;
        if (obj.userData.isSvg && markStyleOverride) obj.userData.styleOverridden = true;
        
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

        // ИСПРАВЛЕНИЕ: Параллакс и Z-fighting. Ставим слой и обводку очень близко по Z.
        primaryMeshes.forEach(mesh => {
            let strokeMesh = getStrokeMeshes(obj).find(stroke => stroke.userData.parentMeshId === mesh.uuid);
            
            if (!mesh.visible) {
                if (strokeMesh) strokeMesh.visible = false;
                return;
            }

            if (!obj.userData.isSvg || obj.userData.styleOverridden) {
                mesh.material.color.set(colorHex);
                mesh.material.opacity = alpha;
                mesh.material.transparent = alpha < 1;
            }
            mesh.renderOrder = 999;
            mesh.position.z = 0.01;

            if (useStroke && mesh.geometry.userData && mesh.geometry.userData.shapesData) {
                if (!strokeMesh || strokeMesh.userData.strokeWidth !== strokeWidth || forceRebuildStroke) {
                    const strokeGeo = generateStrokeGeometry(mesh.geometry.userData.shapesData, strokeWidth * 0.1, qualityVal);
                    if (strokeGeo) {
                        if (!strokeMesh) {
                            strokeMesh = new THREE.Mesh(strokeGeo, new THREE.MeshBasicMaterial({ color: strokeHex, depthWrite: true, alphaTest: 0.01 }));
                            strokeMesh.userData.isStroke = true;
                            strokeMesh.frustumCulled = false;
                            strokeMesh.userData.parentMeshId = mesh.uuid;
                            mesh.parent.add(strokeMesh);
                        } else { strokeMesh.geometry.dispose(); strokeMesh.geometry = strokeGeo; }
                        strokeMesh.userData.strokeWidth = strokeWidth;
                        
                        const tX = mesh.geometry.userData.tX || 0;
                        const tY = mesh.geometry.userData.tY || 0;
                        strokeMesh.geometry.translate(tX, tY, 0);
                    }
                }
                if (strokeMesh) {
                    strokeMesh.visible = true;
                    strokeMesh.material.color.set(strokeHex); 
                    strokeMesh.material.opacity = alpha; 
                    strokeMesh.material.transparent = alpha < 1;
                    strokeMesh.position.z = -0.01;
                    strokeMesh.renderOrder = 998; 
                    strokeMesh.scale.set(1, 1, 1);
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

    function createVectorGroup(geometry, name, icon, isText, textContent, scale, position) {
        const material = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 1, depthWrite: true, alphaTest: 0.01 });
        const mesh = new THREE.Mesh(geometry, material); 
        mesh.frustumCulled = false; 
        
        const group = new THREE.Group();
        group.uuid = THREE.MathUtils.generateUUID(); 
        group.add(mesh);
        
        group.scale.set(scale, scale, 1);
        group.position.copy(position);
        
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
        
        if (window.updateExportState) window.updateExportState();
        if (window.requestSceneRender) window.requestSceneRender();
        return group;
    }

    // ИСПРАВЛЕНИЕ: Базовые размеры фигур увеличены до 10, чтобы они совпадали с текстом
    document.getElementById('btnAddSquare')?.addEventListener('click', () => {
        const shape = new THREE.Shape(); shape.moveTo(-5, -5); shape.lineTo(5, -5); shape.lineTo(5, 5); shape.lineTo(-5, 5); shape.lineTo(-5, -5);
        const geo = new THREE.ShapeGeometry(shape); 
        geo.userData.shapesData = [{ shapes: [shape], offsetX: 0, offsetY: 0 }];
        geo.userData.tX = 0; geo.userData.tY = 0;
        startPlacement(geo, 'Квадрат', 'square', false, '', 10); 
    });

    document.getElementById('btnAddCircle')?.addEventListener('click', () => {
        const shape = new THREE.Shape(); shape.absarc(0, 0, 5, 0, Math.PI * 2, false);
        const geo = new THREE.ShapeGeometry(shape); 
        geo.userData.shapesData = [{ shapes: [shape], offsetX: 0, offsetY: 0 }];
        geo.userData.tX = 0; geo.userData.tY = 0;
        startPlacement(geo, 'Круг', 'circle', false, '', 10);
    });

    document.getElementById('btnAddTriangle')?.addEventListener('click', () => {
        const shape = new THREE.Shape(); shape.moveTo(0, 5); shape.lineTo(4.33, -2.5); shape.lineTo(-4.33, -2.5); shape.lineTo(0, 5);
        const geo = new THREE.ShapeGeometry(shape); 
        geo.userData.shapesData = [{ shapes: [shape], offsetX: 0, offsetY: 0 }];
        geo.userData.tX = 0; geo.userData.tY = 0;
        startPlacement(geo, 'Треугольник', 'triangle', false, '', 10);
    });
    
    document.getElementById('btnAddMarker')?.addEventListener('click', () => {
        const shape = new THREE.Shape(); 
        shape.moveTo(0, -5);
        shape.bezierCurveTo(1.5, -1.5, 3, 0, 3, 2);
        shape.absarc(0, 2, 3, 0, Math.PI, false);
        shape.bezierCurveTo(-3, 0, -1.5, -1.5, 0, -5);
        
        const hole = new THREE.Path();
        hole.absarc(0, 2, 1.2, 0, Math.PI * 2, true);
        shape.holes.push(hole);

        const geo = new THREE.ShapeGeometry(shape); 
        geo.userData.shapesData = [{ shapes: [shape], offsetX: 0, offsetY: 0 }];
        geo.userData.tX = 0; geo.userData.tY = 0;
        startPlacement(geo, 'Маркер', 'map-pin', false, '', 10);
    });

    document.getElementById('btnAddText')?.addEventListener('click', () => {
        const textNode = document.getElementById('vectorTextInput');
        const text = textNode ? textNode.value || 'GTA 5' : 'GTA 5';
        if (!vectorState.loadedFont) { window.showToast("Шрифт загружается...", "error"); return; }
        
        const geometry = createTextGeometry(text, vectorState.loadedFont, 12, 'center', 1.2);
        const displayName = text.split('\n')[0] || 'Текст';
        startPlacement(geometry, displayName, 'type', true, text, 100); 
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
                    const colorObj = new THREE.Color().setStyle(fillColor);
                    const material = new THREE.MeshBasicMaterial({
                        color: colorObj,
                        opacity: path.userData.style.fillOpacity !== undefined ? path.userData.style.fillOpacity : 1,
                        transparent: true, side: THREE.DoubleSide, depthWrite: true, alphaTest: 0.01
                    });
                    
                    try {
                        const shapes = THREE.SVGLoader.createShapes(path);
                        shapes.forEach((shape) => {
                            const geo = new THREE.ShapeGeometry(shape);
                            geo.userData.shapesData = [{ shapes: [shape], offsetX: 0, offsetY: 0 }];
                            geo.userData.tX = 0; geo.userData.tY = 0;
                            const mesh = new THREE.Mesh(geo, material);
                            mesh.userData.originalColorHex = colorObj.getHexString();
                            mesh.frustumCulled = false;
                            group.add(mesh);
                        });
                    } catch (pathError) {
                        console.warn('Пропущен сложный или некорректный контур SVG:', pathError);
                    }
                }
            });
            
            if (getMeshes(group, false).length === 0) throw new Error('SVG не содержит поддерживаемых залитых контуров (или они вызвали ошибку)');

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
            wrapper.renderOrder = 999;
            
            startPlacement(null, wrapper.name, 'image', false, '', 100, wrapper);
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

                    const det = child.matrixWorld.determinant();
                    const flipWinding = det < 0;

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

        const tile1_1_Triangles = allMclTriangles.concat(shapeTriangles);

        processAndInject(tile1_1_Triangles, 'tile_1_1');
        processAndInject(textTriangles, 'tile_2_2');
        
        return modifiedCount;
    };
    
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
            
            const firstMesh = getPrimaryVisibleMesh(obj);
            if (firstMesh) {
                if (firstMesh.material) {
                    data.color = "#" + firstMesh.material.color.getHexString();
                    data.opacity = firstMesh.material.opacity;
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
                    data.hiddenMeshIndices = obj.userData.hiddenMeshIndices || [];
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
                        const colorObj = new THREE.Color().setStyle(fillColor);
                        const material = new THREE.MeshBasicMaterial({
                            color: colorObj,
                            opacity: path.userData.style.fillOpacity !== undefined ? path.userData.style.fillOpacity : 1,
                            transparent: true, side: THREE.DoubleSide, depthWrite: true, alphaTest: 0.01
                        });
                        try {
                            const shapes = THREE.SVGLoader.createShapes(path);
                            shapes.forEach((shape) => {
                                const geo = new THREE.ShapeGeometry(shape);
                                geo.userData.shapesData = [{ shapes: [shape], offsetX: 0, offsetY: 0 }];
                                geo.userData.tX = 0; geo.userData.tY = 0;
                                const mesh = new THREE.Mesh(geo, material);
                                mesh.userData.originalColorHex = colorObj.getHexString();
                                mesh.frustumCulled = false;
                                group.add(mesh);
                            });
                        } catch (pathError) { console.warn(pathError); }
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
                wrapper.userData.hiddenMeshIndices = data.hiddenMeshIndices || [];
                
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
                shape.bezierCurveTo(1.5, -1.5, 3, 0, 3, 2);
                shape.absarc(0, 2, 3, 0, Math.PI, false);
                shape.bezierCurveTo(-3, 0, -1.5, -1.5, 0, -5);
                
                const hole = new THREE.Path();
                hole.absarc(0, 2, 1.2, 0, Math.PI * 2, true);
                shape.holes.push(hole);

                const geo = new THREE.ShapeGeometry(shape); 
                geo.userData.shapesData = [{ shapes: [shape], offsetX: 0, offsetY: 0 }];
                geo.userData.tX = 0; geo.userData.tY = 0;
                spawnLoadedVectorMesh(geo, data);
            }
        });
        updateVectorsOrder();
    };
    
    function spawnLoadedVectorMesh(geometry, data) {
        const material = new THREE.MeshBasicMaterial({ color: data.color || 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: data.opacity ?? 1, depthWrite: true, alphaTest: 0.01 });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.frustumCulled = false;
        
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
        
        if (data.isText) group.userData.textAlign = data.textAlign || 'center';
        
        applyTransformAndProperties(group, data);
    }
    
    function applyTransformAndProperties(wrapper, data) {
        wrapper.position.set(data.position.x, data.position.y, data.position.z);
        wrapper.rotation.set(data.rotation.x, data.rotation.y, data.rotation.z);
        wrapper.scale.set(data.scale.x, data.scale.y, 1);
        wrapper.renderOrder = 999;

        if (data.isSvg && wrapper.userData.hiddenMeshIndices) {
            getMeshes(wrapper, false).forEach((mesh, idx) => {
                if (wrapper.userData.hiddenMeshIndices.includes(idx)) mesh.visible = false;
            });
        }

        if (!data.isSvg || data.styleOverridden) {
            getMeshes(wrapper, false).forEach(mesh => {
                if (!mesh.visible) return; 
                if (data.color && mesh.material && mesh.material.color) mesh.material.color.set(data.color);
                if (data.opacity !== undefined && mesh.material) {
                    mesh.material.opacity = data.opacity;
                    mesh.material.transparent = data.opacity < 1;
                }
            });
        }
        
        if (data.hasStroke) {
            getMeshes(wrapper, false).forEach(firstMesh => {
              if (firstMesh.geometry && firstMesh.geometry.userData.shapesData && firstMesh.visible) {
                firstMesh.renderOrder = 999; firstMesh.position.z = 0.01;
                const strokeGeo = generateStrokeGeometry(firstMesh.geometry.userData.shapesData, data.strokeWidth * 0.1, firstMesh.userData.quality || 12);
                if (strokeGeo) {
                    const restoredOpacity = data.opacity ?? 1;
                    const strokeMesh = new THREE.Mesh(strokeGeo, new THREE.MeshBasicMaterial({ color: data.strokeColor, opacity: restoredOpacity, transparent: restoredOpacity < 1, depthWrite: true, alphaTest: 0.01 }));
                    strokeMesh.userData.isStroke = true;
                    strokeMesh.frustumCulled = false;
                    strokeMesh.userData.strokeWidth = data.strokeWidth;
                    strokeMesh.userData.quality = firstMesh.userData.quality || 12;
                    strokeMesh.userData.parentMeshId = firstMesh.uuid;
                    
                    strokeMesh.position.z = -0.01;
                    strokeMesh.renderOrder = 998;
                    
                    const tX = firstMesh.geometry.userData.tX || 0;
                    const tY = firstMesh.geometry.userData.tY || 0;
                    strokeMesh.geometry.translate(tX, tY, 0);
                    firstMesh.parent.add(strokeMesh);
                }
              }
            });
        }
        
        scene.add(wrapper);
        vectorState.objects.unshift(wrapper); 
        
        if (vectorState.pendingSelectId === wrapper.uuid) {
            selectObject(wrapper);
            vectorState.pendingSelectId = null;
        }

        if (window.updateExportState) window.updateExportState();
        if (window.requestSceneRender) window.requestSceneRender();
    }
});
