document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('mapPresetsControls');
    if (!container) return;
    const colors = ['#b9edf2', '#06305c'];
    const translate = (ru, en, uk) => window.t ? window.t(ru, en, uk) : ru;

    container.innerHTML = `
        <label class="block text-[11px] font-semibold text-slate-200 mb-1">${translate('Цветовая цепочка воды', 'Water color gradient', 'Кольорова шкала води')}</label>
        <div id="waterGradientPreview" class="h-8 rounded-lg border border-slate-700"></div>
        <p id="waterGradientRange" class="text-[9px] text-slate-400 mt-1"></p>
        <div id="waterGradientStops" class="space-y-1.5 mt-2"></div>
        <div class="flex gap-2 mt-2">
            <button id="addWaterColor" type="button" class="flex-1 min-h-[34px] rounded-lg bg-slate-800 text-slate-200 text-xs">+ ${translate('Добавить цвет', 'Add color', 'Додати колір')}</button>
            <button id="applyWaterGradient" type="button" class="flex-1 min-h-[34px] rounded-lg bg-emerald-500/20 text-emerald-300 text-xs">${translate('Применить', 'Apply', 'Застосувати')}</button>
        </div>`;

    const stops = document.getElementById('waterGradientStops');
    const preview = document.getElementById('waterGradientPreview');
    const range = document.getElementById('waterGradientRange');
    const alphaRange = document.getElementById('waterAlphaRange');
    const alphaNum = document.getElementById('waterAlphaNum');
    const addButton = document.getElementById('addWaterColor');
    const applyButton = document.getElementById('applyWaterGradient');
    const titleLabel = container.querySelector('label');
    const panel = document.getElementById('mapPresetsPanel');
    const alphaPanel = document.getElementById('waterAlphaControls');
    const gradientBtn = document.getElementById('btnWaterGradient');
    const alphaBtn = document.getElementById('btnWaterAlpha');
    const paintToolBtn = (btn, on) => {
        if (!btn) return;
        btn.classList.toggle('bg-emerald-500/20', on);
        btn.classList.toggle('text-emerald-300', on);
        btn.classList.toggle('border-emerald-500/50', on);
    };
    if (gradientBtn && panel) gradientBtn.addEventListener('click', () => {
        panel.classList.toggle('hidden');
        if (!panel.classList.contains('hidden') && typeof panel.open === 'boolean') panel.open = true;
        paintToolBtn(gradientBtn, !panel.classList.contains('hidden'));
    });
    if (alphaBtn && alphaPanel) alphaBtn.addEventListener('click', () => {
        alphaPanel.classList.toggle('hidden');
        paintToolBtn(alphaBtn, !alphaPanel.classList.contains('hidden'));
    });

    function refresh() {
        stops.replaceChildren(...colors.map((color, index) => {
            const row = document.createElement('div');
            row.className = 'flex items-center gap-2 cursor-grab active:cursor-grabbing';
            row.draggable = true;
            row.dataset.index = index;
            const label = document.createElement('span');
            label.className = 'w-12 shrink-0 text-[10px] text-slate-400';
            label.textContent = index === 0 ? translate('Глубина', 'Deep', 'Глибина') : index === colors.length - 1 ? translate('Мелководье', 'Shallow', 'Мілководдя') : `${translate('Точка', 'Stop', 'Точка')} ${index + 1}`;
            const input = document.createElement('input');
            input.type = 'color'; input.value = color; input.className = 'h-8 flex-1 min-w-0 rounded-lg bg-slate-800 border border-slate-600 cursor-pointer';
            input.addEventListener('input', event => { colors[index] = event.target.value; refreshPreview(); });
            row.append(label, input);
            if (colors.length > 1) {
                const remove = document.createElement('button');
                remove.type = 'button'; remove.className = 'w-8 h-8 rounded-lg bg-slate-800 text-slate-400 hover:text-rose-300'; remove.textContent = '×';
                remove.title = translate('Удалить цвет', 'Remove color', 'Видалити колір');
                remove.addEventListener('click', () => { colors.splice(index, 1); refresh(); });
                row.appendChild(remove);
            }
            row.addEventListener('dragstart', event => {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', String(index));
                row.classList.add('opacity-50');
            });
            row.addEventListener('dragend', () => row.classList.remove('opacity-50'));
            row.addEventListener('dragover', event => event.preventDefault());
            row.addEventListener('drop', event => {
                event.preventDefault();
                const from = Number(event.dataTransfer.getData('text/plain'));
                const to = index;
                if (!Number.isInteger(from) || from === to || !colors[from]) return;
                const [moved] = colors.splice(from, 1);
                colors.splice(to, 0, moved);
                refresh();
            });
            return row;
        }));
        addButton.classList.toggle('hidden', colors.length >= 5);
        refreshPreview();
    }
    function refreshPreview() {
        preview.style.background = `linear-gradient(90deg, ${colors.join(', ')})`;
        range.textContent = `${colors[0].toUpperCase()} → ${colors[colors.length - 1].toUpperCase()} · ${colors.length} ${translate('цветов', 'colors', 'кольорів')}`;
    }
    addButton.addEventListener('click', () => {
        if (colors.length < 5) {
            const last = colors[colors.length - 1];
            colors.splice(colors.length - 1, 0, last);
            refresh();
        }
    });
    if (alphaRange) alphaRange.addEventListener('input', event => window.updateWaterAlpha?.(event.target.value));
    if (alphaNum) alphaNum.addEventListener('input', event => window.updateWaterAlpha?.(event.target.value));
    document.getElementById('applyWaterGradient').addEventListener('click', () => {
        if (!window.MapPresets || !window.state) return;
        const changes = window.MapPresets.changesForWater(window.state.colorsMap.values(), window.layerDictionary, colors);
        changes.forEach(change => window.fastUpdateColor(change.key, change.hex, null));
        window.showToast(translate(`Градиент воды применён: ${changes.length} цветов`, `Water gradient applied: ${changes.length} colors`, `Градієнт води застосовано: ${changes.length} кольорів`));
    });
    window.refreshMapPresets = () => refreshPreview();
    window.relocalizeMapPresets = () => {
        if (titleLabel) titleLabel.textContent = translate('Цветовая цепочка воды', 'Water color gradient', 'Кольорова шкала води');
        if (addButton) addButton.textContent = '+ ' + translate('Добавить цвет', 'Add color', 'Додати колір');
        if (applyButton) applyButton.textContent = translate('Применить', 'Apply', 'Застосувати');
        refresh();
    };
    refresh();
});
