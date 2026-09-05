// ========================================
// СКРИНШОТ КАРТЫ В 1 КЛИК (БЕЗ МОДАЛКИ)
// ========================================
function takeScreenshot() {
    // Жестко задаем высокое качество (соотношение 2:3)
    const w = 3072;
    const h = 4608;

    window.showLoading("Создание скриншота...", "Рендеринг в высоком качестве...");
    
    setTimeout(() => {
        if (typeof transformControl !== 'undefined' && transformControl.object) transformControl.detach();

        const container = document.getElementById('mapCanvas').parentElement;
        const oldWidth = container.clientWidth;
        const oldHeight = container.clientHeight;

        const oldPos = camera.position.clone();
        const oldRot = camera.rotation.clone();
        const oldAspect = camera.aspect;
        const oldNear = camera.near; 
        const oldFar = camera.far;   

        const oldBg = scene.background;
        scene.background = null;
        
        const oldClearColor = new THREE.Color();
        renderer.getClearColor(oldClearColor);
        const oldClearAlpha = renderer.getClearAlpha();
        renderer.setClearColor(0x000000, 0);

        let mapW = 8192, mapH = 12288, mapCenterX = 0, mapCenterY = 2048, mapMaxZ = 15000, mapMinZ = -1000;

        if (window.mapBounds) {
            mapW = window.mapBounds.maxDim;
            mapH = window.mapBounds.maxDim * 1.5;
            mapCenterX = window.mapBounds.centerX;
            mapCenterY = window.mapBounds.centerY;
            mapMaxZ = window.mapBounds.maxZ;
            mapMinZ = -1000;
        }

        camera.rotation.set(0, 0, 0);

        if (camera.isOrthographicCamera) {
            camera.left = -mapW / 2; camera.right = mapW / 2;
            camera.top = mapH / 2; camera.bottom = -mapH / 2;
            camera.zoom = 1;
            camera.position.set(mapCenterX, mapCenterY, mapMaxZ + 5000);
            camera.near = 10; camera.far = (mapMaxZ - mapMinZ) + 10000;
        } else {
            camera.aspect = w / h;
            const fov = camera.fov * (Math.PI / 180);
            const distH = Math.abs((mapH / 2) / Math.tan(fov / 2));
            const camZ = distH + mapMaxZ;
            camera.position.set(mapCenterX, mapCenterY, camZ);
            camera.near = Math.max(10, camZ - mapMaxZ - 1000); 
            camera.far = camZ - mapMinZ + 5000;
        }
        camera.updateProjectionMatrix();

        const maxTile = 2048;
        const cols = Math.ceil(w / maxTile);
        const rows = Math.ceil(h / maxTile);

        const canvas2D = document.createElement('canvas');
        canvas2D.width = w;
        canvas2D.height = h;
        const ctx = canvas2D.getContext('2d');

        const originalPixelRatio = renderer.getPixelRatio();
        renderer.setPixelRatio(1);

        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const tileW = Math.min(maxTile, w - col * maxTile);
                const tileH = Math.min(maxTile, h - row * maxTile);

                renderer.setSize(tileW, tileH);
                camera.setViewOffset(w, h, col * maxTile, row * maxTile, tileW, tileH);
                
                renderer.clear(true, true, true);
                renderer.render(scene, camera);

                ctx.drawImage(renderer.domElement, 0, 0, tileW, tileH, col * maxTile, row * maxTile, tileW, tileH);
            }
        }

        camera.clearViewOffset();
        renderer.setPixelRatio(originalPixelRatio);
        renderer.setSize(oldWidth, oldHeight);
        
        camera.position.copy(oldPos);
        camera.rotation.copy(oldRot);
        camera.near = oldNear; camera.far = oldFar;
        camera.aspect = oldAspect;
        camera.updateProjectionMatrix();

        scene.background = oldBg;
        renderer.setClearColor(oldClearColor, oldClearAlpha);
        renderer.render(scene, camera);

        canvas2D.toBlob(function(blob) {
            if (!blob) {
                window.showToast("Ошибка памяти при рендере скриншота", "error");
                window.hideLoading();
                return;
            }
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.download = `GTA_Map_${w}x${h}.png`;
            link.href = url;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 5000); 
            window.hideLoading();
        }, 'image/png');
    }, 150);
}

// Привязываем к кнопке напрямую в JS
document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById('screenshotBtn');
    if (btn) {
        // Убираем старые onClick из HTML, если они были
        btn.removeAttribute('onclick');
        btn.addEventListener('click', takeScreenshot);
    }
});