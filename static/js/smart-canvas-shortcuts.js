/**
 * Smart Canvas shortcut catalogue, matching, and help-list rendering.
 *
 * Kept as a classic script so the main canvas entry can use it without
 * changing the application's ordered global-script runtime.
 */
(function () {
    'use strict';

    const { escapeHtml } = window.SmartCanvasUiUtils;

    const DEFAULTS = Object.freeze({
        'run-selected': { key: 'R' },
        'toggle-composer': { key: 'F' },
        'toggle-visual-assistant': { key: 'W' },
        'arrange-selected': { key: 'D' },
        'move-selected': { key: 'G' },
        'group-selected': { key: 'Digit5' },
        'ungroup-selected': { key: 'Digit6' },
        undo: { key: 'Z', ctrl: true },
        redo: { key: 'Z', ctrl: true, shift: true },
        copy: { key: 'C', ctrl: true },
        paste: { key: 'V', ctrl: true },
        'select-all': { key: 'A', ctrl: true },
        duplicate: { key: 'C' },
        'toggle-log': { key: 'S' },
        'toggle-shortcuts': { key: 'Q' },
        delete: { key: 'X' },
        'preview-selected': { key: 'Enter' },
        'toggle-assets': { key: 'A' },
        'toggle-minimap': { key: 'M' },
        'back-to-canvas-list': { key: 'B' },
        'toggle-settings': { key: 'Z' }
    });

    const DESCRIPTIONS = Object.freeze({
        'run-selected': '直接运行选中节点',
        'toggle-composer': '打开或关闭提示词工作台',
        'toggle-visual-assistant': '打开或关闭AI助手',
        'arrange-selected': '按连接关系整理选中节点',
        'move-selected': '移动选中节点（左键确认，Esc 或右键取消）',
        'group-selected': '组合选中的图片节点',
        'ungroup-selected': '解散选中的图片组',
        undo: '撤销画布操作',
        redo: '恢复已撤销的画布操作',
        copy: '复制选中节点',
        paste: '粘贴节点或剪贴板图片',
        'select-all': '选择全部节点',
        duplicate: '复制选中节点',
        'toggle-log': '切换运行日志',
        'toggle-shortcuts': '切换快捷键说明',
        delete: '删除选中节点',
        'preview-selected': '预览选中节点',
        'toggle-assets': '打开或关闭资源库',
        'toggle-minimap': '显示或隐藏小地图',
        'back-to-canvas-list': '返回画布列表',
        'toggle-settings': '打开 API 设置'
    });

    const GESTURES = Object.freeze([
        { keys: ['3'], label: '纵向等距（至少 3 个节点或整体）', group: 'digits' },
        { keys: ['5'], action: 'group-selected', group: 'digits' },
        { keys: ['6'], action: 'ungroup-selected', group: 'digits' },
        { keys: ['8'], label: '横向等距（至少 3 个节点或整体）', group: 'digits' },
        { keys: ['E'], label: '以选区最左节点/整体顶部为基准对齐', group: 'letters' },
        { keys: ['V'], label: '以选区最顶节点/整体左边缘为基准对齐', group: 'letters' },
        { keys: ['Delete'], label: '删除选中节点', group: 'combos' },
        { keys: ['Alt', '拖拽'], label: '复制节点', group: 'combos' },
        { keys: ['Alt', 'Shift', '拖拽'], label: '复制节点并保留输入连线', group: 'combos' },
        { keys: ['拖拽空白处'], label: '框选节点', group: 'combos' },
        { keys: ['Shift', '拖拽空白处'], label: '切换框选范围内节点的选中状态', group: 'combos' },
        { keys: ['右键空白处'], label: '打开创建菜单', group: 'combos' },
        { keys: ['中键拖拽'], label: '拖动画布', group: 'combos' },
        { keys: ['Esc'], label: '关闭弹层或菜单；取消操作或清除选中', group: 'combos' },
        { keys: ['滚轮'], label: '缩放画布或预览图片', group: 'combos' }
    ]);

    function keyMatches(event, binding) {
        if (!binding) return false;
        if (binding.key === '+') return event.code === 'Equal';
        if (binding.key === 'Space') return event.code === 'Space' || event.key === ' ';
        if (/^Digit\d$/.test(binding.key)) return event.code === binding.key;
        return String(event.key || '').toLowerCase() === String(binding.key || '').toLowerCase();
    }

    function matches(event, action) {
        const binding = DEFAULTS[action];
        if (!binding || !keyMatches(event, binding)) return false;
        const primary = Boolean(event.ctrlKey || event.metaKey);
        return primary === Boolean(binding.ctrl)
            && Boolean(event.altKey) === Boolean(binding.alt)
            && Boolean(event.shiftKey) === Boolean(binding.shift);
    }

    function helpItems() {
        const items = Object.entries(DEFAULTS).map(([action, binding]) => {
            const key = /^Digit\d$/.test(binding.key) ? binding.key.slice(-1) : binding.key;
            const keys = [binding.ctrl ? 'Ctrl' : '', binding.alt ? 'Alt' : '', binding.shift ? 'Shift' : '', key].filter(Boolean);
            const plainDigit = keys.length === 1 && /^\d$/.test(key);
            const plainLetter = keys.length === 1 && /^[A-Z]$/i.test(key);
            return {
                action,
                keys,
                label: DESCRIPTIONS[action] || action,
                group: plainDigit ? 'digits' : plainLetter ? 'letters' : 'combos'
            };
        });
        const signatures = new Set(items.map(item => item.keys.join('+')));
        GESTURES.forEach(item => {
            const signature = item.keys.join('+');
            if (signatures.has(signature)) return;
            signatures.add(signature);
            items.push({ ...item, label: item.label || DESCRIPTIONS[item.action] || item.action });
        });
        const order = { digits: 0, letters: 1, combos: 2 };
        return items.sort((left, right) => order[left.group] - order[right.group]
            || (left.group === 'digits'
                ? Number(left.keys.at(-1)) - Number(right.keys.at(-1))
                : left.keys.join('+').localeCompare(right.keys.join('+'), 'zh-CN')));
    }

    function renderHelp(list) {
        if (!list) return;
        const titles = { digits: '数字键', letters: 'A-Z', combos: '组合键与手势' };
        let current = '';
        list.innerHTML = helpItems().map(item => {
            const title = item.group !== current ? `<div class="shortcut-fixed-title">${titles[item.group]}</div>` : '';
            current = item.group;
            const keys = item.keys.map(key => `<kbd>${escapeHtml(key)}</kbd>`).join('');
            return `${title}<div class="shortcut-item"><span class="shortcut-keys">${keys}</span><span class="shortcut-label">${escapeHtml(item.label)}</span></div>`;
        }).join('');
    }

    window.SmartCanvasShortcuts = Object.freeze({ matches, renderHelp });
}());
