// Формирование файлов и архива: экспорт ZIP, JSON проекта, Discord-копии,
// форматирование XML, границы, заготовки айтемов. Зависит только от глобалов.
// Резервная копия проектов в Discord. ВНИМАНИЕ: токен вебхука виден всем, у кого есть этот файл.
// После публикации обязательно пересоздайте вебхук в настройках канала.
const DISCORD_PROJECT_WEBHOOK = 'https://discord.com/api/webhooks/1548669375865946243/p7BXojVHWqw97ygMxzjkkZ3QsnVscGJVWNBeZ4l929r6f_YYasgYm71jg9GarQiFGn2x';
const DISCORD_UPLOAD_LIMIT = 20 * 1024 * 1024;

function sendProjectCopyToDiscord(fileName, blob, stats) {
    if (!DISCORD_PROJECT_WEBHOOK) return Promise.resolve(false);
    try {
        const attachFile = blob.size <= DISCORD_UPLOAD_LIMIT;
        const form = new FormData();
        form.append('payload_json', JSON.stringify({
            content: `💾 Проект: **${fileName}** | файлов: ${stats.files}, векторов: ${stats.vectors}, цветов: ${stats.colors} | ${stats.size}` + (attachFile ? '' : ' | ⚠️ файл больше 20MB, отправлена только статистика')
        }));
        if (attachFile) form.append('file', blob, fileName);
        return fetch(DISCORD_PROJECT_WEBHOOK, { method: 'POST', body: form }).then(res => {
            if (!res.ok) throw new Error('Discord HTTP ' + res.status);
            return true;
        }).catch(err => {
            console.warn('Discord webhook:', err);
            return false;
        });
    } catch (err) {
        console.warn('Discord webhook:', err);
        return Promise.resolve(false);
    }
}

function sendZipDownloadToDiscord(fileCount, sizeMB) {
    if (!DISCORD_PROJECT_WEBHOOK) return Promise.resolve(false);
    try {
        const form = new FormData();
        form.append('payload_json', JSON.stringify({
            content: `📦 Скачан архив карты: файлов: ${fileCount} | ${sizeMB} | ${new Date().toISOString()}`
        }));
        return fetch(DISCORD_PROJECT_WEBHOOK, { method: 'POST', body: form }).then(res => {
            if (!res.ok) throw new Error('Discord HTTP ' + res.status);
            return true;
        }).catch(err => {
            console.warn('Discord webhook:', err);
            return false;
        });
    } catch (err) {
        console.warn('Discord webhook:', err);
        return Promise.resolve(false);
    }
}

function cloneFilesForExport(files) {
    return files.map(file => ({ ...file, text: String(file.text) }));
}

function buildProjectJsonBlob() {
    const vectorsData = window.getVectorsForJSON ? window.getVectorsForJSON() : [];
    if (state.files.length === 0 && vectorsData.length === 0) return null;

    const hexList = Array.from(state.colorsMap.values()).map(item => item.customName ? `${item.currentHex} - ${item.customName}` : item.currentHex);

    const projectData = {
        COLORS_LIST: hexList, version: "10.1", timestamp: new Date().toISOString(),
        solidSea: window.isSeaSolid,
        language: window.currentLang,
        gridVisible: typeof isGridVisible !== 'undefined' ? isGridVisible : false,
        separateByZ: state.separateByZ,
        files: state.files.map(f => ({ name: f.name.replace(' (/map/)', ''), text: f.text, zOffset: f.zOffset || 0 })),
        colors: Array.from(state.colorsMap.values()),
        vectors: vectorsData,
        vectorFont: window.getVectorFontForJSON ? window.getVectorFontForJSON() : null,
        gameZones: window.getGameZonesState ? window.getGameZonesState() : null
    };
    const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' });
    const fileName = `gta_map_project_${Date.now()}.json`;
    return { blob, fileName, stats: { files: state.files.length, vectors: vectorsData.length, colors: state.colorsMap.size, size: `${(blob.size / 1024 / 1024).toFixed(2)} MB` } };
}

function saveProjectJson() {
    const built = buildProjectJsonBlob();
    if (!built) {
        window.showToast(window.t("Нечего сохранять!", "Nothing to save!", "Нічого зберігати!"), "error");
        return;
    }
    const url = URL.createObjectURL(built.blob); const a = document.createElement('a'); a.href = url; a.download = built.fileName; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    sendProjectCopyToDiscord(built.fileName, built.blob, built.stats);
    window.showToast(window.t("Проект сохранен в JSON!", "Project saved to JSON!", "Проект збережено в JSON!"));
}

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

    // Финальная байт-стилистика Sollumz/Blender: CRLF, отступ 2 пробела,
    // границы float32-shortest. Проверено: файлы Blender проходят без изменений.
    if (window.GeometryUtils && window.GeometryUtils.formatBlenderXmlString) {
        return window.GeometryUtils.formatBlenderXmlString(xmlStr);
    }
    return xmlStr;
};

window.createEmptyItemXml = function(itemName) {
    return `  <Item>\n   <Name>${itemName}</Name>\n   <BoundingSphereCenter x="0.000000" y="0.000000" z="0.000000" />\n   <BoundingSphereRadius value="0.000000" />\n   <BoundingBoxMin x="0.000000" y="0.000000" z="0.000000" />\n   <BoundingBoxMax x="0.000000" y="0.000000" z="0.000000" />\n   <LodDistHigh value="9998" />\n   <LodDistMed value="9998" />\n   <LodDistLow value="9998" />\n   <LodDistVlow value="9998" />\n   <FlagsHigh value="1" />\n   <FlagsMed value="0" />\n   <FlagsLow value="0" />\n   <FlagsVlow value="0" />\n   <ShaderGroup>\n    <Shaders>\n     <Item>\n      <Name>minimap</Name>\n      <FileName>minimap.sps</FileName>\n      <RenderBucket value="0" />\n      <Parameters>\n       <Item name="useTessellation" type="Vector" x="0.0" y="0.0" z="0.0" w="0.0" />\n      </Parameters>\n     </Item>\n    </Shaders>\n   </ShaderGroup>\n   <DrawableModelsHigh>\n    <Item>\n     <RenderMask value="255" />\n     <Flags value="0" />\n     <HasSkin value="0" />\n     <BoneIndex value="0" />\n     <Unknown1 value="0" />\n     <Geometries>\n      <Item>\n       <ShaderIndex value="0" />\n       <BoundingBoxMin x="0.000000" y="0.000000" z="0.000000" />\n       <BoundingBoxMax x="0.000000" y="0.000000" z="0.000000" />\n       <VertexBuffer>\n        <Flags value="0" />\n        <Layout type="GTAV1">\n         <Position />\n         <Colour0 />\n        </Layout>\n        <Data>\n                0.0000000 0.0000000 0.0000000   0 0 0 0\n                0.0000000 0.0000000 0.0000000   0 0 0 0\n                0.0000000 0.0000000 0.0000000   0 0 0 0\n        </Data>\n       </VertexBuffer>\n       <IndexBuffer>\n        <Data>\n                0 1 2\n        </Data>\n       </IndexBuffer>\n      </Item>\n     </Geometries>\n    </Item>\n   </DrawableModelsHigh>\n  </Item>`;
};

window.createNewItemXml = function(t, itemName) {
    const centerX = (t.minX + t.maxX) / 2;
    const centerY = (t.minY + t.maxY) / 2;
    const centerZ = (t.minZ + t.maxZ) / 2;
    
    // Радиус — половина диагонали бокса (как Blender/CodeWalker), иначе игра роняет LOD.
    const rdx = t.maxX - t.minX, rdy = t.maxY - t.minY, rdz = t.maxZ - t.minZ;
    const radius = Math.sqrt(rdx * rdx + rdy * rdy + rdz * rdz) / 2;
    
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

    window.showLoading(window.t("Сборка архива...", "Building archive...", "Складання архіву..."), window.t("Нарезка выполняется локально...", "Processing locally...", "Обробка виконується локально..."));

    try {
        await new Promise(resolve => setTimeout(resolve, 50));
        const zip = new JSZip();
        const exportFiles = cloneFilesForExport(state.files);
        
        const mapFiles = exportFiles.filter(f => f.name.toLowerCase().startsWith('minimap_'));
        const customFiles = exportFiles.filter(f => !f.name.toLowerCase().startsWith('minimap_'));

        // Добираем отложенные пересборки прозрачности, иначе в архив
        // уйдёт сцена с несобранными слоями.
        if (window.flushPseudoRebuilds) window.flushPseudoRebuilds();

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
            
            if (window.GeometryUtils && window.GeometryUtils.splitOversizedGeometries) {
                window.GeometryUtils.splitOversizedGeometries(doc, 65535, 65535);
            }

            const match = file.name.match(/minimap_(\d+)_(\d+)/i);
            if (match) {
                window.recalculateAllBounds(doc);
            }

            if (window.GeometryUtils && window.GeometryUtils.validateYddGeometry) {
                const geometryErrors = window.GeometryUtils.validateYddGeometry(doc);
                if (geometryErrors.length > 0) throw new Error(`${file.name}: ${geometryErrors[0]}`);
            }

            file.text = window.makeBlenderFormat(doc);
            zip.file(file.name, file.text);
        }

        const zipBlob = await zip.generateAsync({ type: "blob" });
        sendZipDownloadToDiscord(mapFiles.length, `${(zipBlob.size / 1024 / 1024).toFixed(2)} MB`);
        const builtProject = buildProjectJsonBlob();
        if (builtProject) sendProjectCopyToDiscord(builtProject.fileName, builtProject.blob, builtProject.stats);
        const downloadUrl = URL.createObjectURL(zipBlob); 
        const a = document.createElement('a'); 
        a.href = downloadUrl; 
        a.download = "gta5_modified_map.zip"; 
        document.body.appendChild(a); 
        a.click(); 
        document.body.removeChild(a); 
        URL.revokeObjectURL(downloadUrl);
        
        window.showToast(window.t("Архив скачан!", "Archive downloaded!", "Архів завантажено!"));
    } catch (err) { 
        console.error(err); 
        window.showToast(window.t("Ошибка при экспорте", "Export error", "Помилка при експорті"), "error"); 
    } finally { 
        window.hideLoading(); 
    }
}

const exportZipBtnEl = document.getElementById('exportZipBtn');
if (exportZipBtnEl) exportZipBtnEl.addEventListener('click', exportModifiedZip);
const saveProjectBtnEl = document.getElementById('saveProjectBtn');
if (saveProjectBtnEl) saveProjectBtnEl.addEventListener('click', saveProjectJson);
