(function(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.MapPresets = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
    const rgb = hex => [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16));
    const hex = channels => '#' + channels.map(value => Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, '0')).join('');
    function classify(hexColor, dictionary) {
        const label = dictionary[String(hexColor).toLowerCase()];
        if (typeof label !== 'string' || !label.trim()) return null;
        return /океан|мор[ея]|реки|вода|водье|ocean|sea|water|river|річ/i.test(label) ? 'water' : 'land';
    }
    function waterLevel(label) {
        const match = String(label || '').match(/Уровень\s+(\d+)/i);
        if (/реки|пресная|river|fresh/i.test(String(label || ''))) return 14;
        return match ? Number(match[1]) : 7;
    }
    function waterColor(originalHex, dictionary, gradientColors) {
        const level = waterLevel(dictionary[String(originalHex).toLowerCase()]);
        const amount = Math.max(0, Math.min(1, (level - 1) / 13));
        const colors = gradientColors.map(rgb);
        if (colors.length === 1) return hex(colors[0]);
        const scaled = amount * (colors.length - 1);
        const start = Math.min(colors.length - 2, Math.floor(scaled));
        const localAmount = scaled - start;
        return hex(colors[start].map((value, index) => value + (colors[start + 1][index] - value) * localAmount));
    }
    function changesForWater(colors, dictionary, gradientColors) {
        return Array.from(colors).flatMap(item => classify(item.origHex, dictionary) === 'water'
            ? [{ key: item.key, hex: waterColor(item.origHex, dictionary, gradientColors) }]
            : []);
    }
    return { classify, waterLevel, waterColor, changesForWater };
});
