/**
 * Static view builders for API settings provider and model surfaces.
 *
 * api-settings.js remains responsible for provider state, drag/drop, network
 * requests, persistence, and business event handling.
 */
(function () {
    'use strict';

    function create({escapeAttr, escapeHtml, tr}={}) {
        function providerCards(items, {selectedId='', isFixedProvider=()=>false}={}) {
            return items.map(item => {
                const active = item.id === selectedId ? 'active' : '';
                const stateClass = item.enabled === false
                    ? 'is-disabled'
                    : (item.has_key || item.has_wallet_key ? 'has-key' : 'missing-key');
                const protocolLabel = String(item.protocol || 'openai').toUpperCase();
                const draggable = isFixedProvider(item) ? '' : ' draggable="true"';

                return `
                    <button class="provider-card provider-card-sortable ${active} ${stateClass}" type="button" data-av-interaction="top" data-av-pointer="off" data-action="selectProvider" data-provider-id="${escapeAttr(item.id)}"${draggable}>
                        <span class="provider-drag-handle" aria-hidden="true"><i data-lucide="grip-vertical" class="w-3.5 h-3.5"></i></span>
                        <span class="provider-mark"><i data-lucide="${item.has_key ? 'key-round' : 'key'}" class="w-4 h-4"></i></span>
                        <span class="provider-info">
                            <div class="provider-name">${escapeHtml(item.name || item.id)}</div>
                            <div class="provider-meta">${escapeHtml(item.base_url || '未配置地址')}</div>
                        </span>
                        <span class="provider-side-meta">
                            <span class="provider-status-dot"></span>
                            <span class="provider-protocol-pill">${escapeHtml(protocolLabel)}</span>
                        </span>
                    </button>`;
            }).join('');
        }

        function providerModelBadge(model, label) {
            const text = `${model || ''} ${label || ''}`.toLowerCase();
            if(text.includes('gpt-image')) return 'G';
            if(text.includes('nano')) return 'N';
            if(text.includes('qwen')) return 'Q';
            if(text.includes('seedance')) return 'SD';
            if(text.includes('wan') || text.includes('万相')) return 'W';
            if(text.includes('luma')) return 'L';
            if(text.includes('vidu')) return 'V';
            if(text.includes('alibaba') || text.includes('阿里')) return 'A';
            if(text.includes('bytedance') || text.includes('字节')) return 'B';
            return 'RH';
        }

        function modelPicker({pickerState, filter='', currentTab='all', labelForModel=id=>id}={}) {
            const ids = Object.keys(pickerState?.category || {}).sort();
            const totals = {all:ids.length, image:0, chat:0, video:0};
            const selecteds = {all:0, image:0, chat:0, video:0};

            ids.forEach(id => {
                const category = pickerState.category[id];
                totals[category]++;
                if(pickerState.selected[id]) {
                    selecteds[category]++;
                    selecteds.all++;
                }
            });

            const normalizedFilter = String(filter || '').toLowerCase();
            const visibleIds = ids.filter(id => {
                const label = String(labelForModel(id) || '');
                if(normalizedFilter && !id.toLowerCase().includes(normalizedFilter) && !label.toLowerCase().includes(normalizedFilter)) return false;
                return currentTab === 'all' || pickerState.category[id] === currentTab;
            });

            const html = visibleIds.map((id, index) => {
                const checked = pickerState.selected[id];
                const label = String(labelForModel(id) || '');
                const badge = providerModelBadge(id, label);

                return `
                    <div class="picker-row ${checked ? 'has-sel' : ''}" data-action="togglePickerRow" data-index="${index}">
                        <div class="picker-checkbox ${checked ? 'checked' : ''}">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                        </div>
                        <div class="picker-model-badge">${escapeHtml(badge)}</div>
                        <div class="picker-model-name" title="${escapeAttr(id)}">
                            <div class="picker-model-label">${escapeHtml(label || id)}</div>
                            ${label && label !== id ? `<div class="picker-model-id">${escapeHtml(id)}</div>` : ''}
                        </div>
                    </div>`;
            }).join('');

            return {
                totals,
                selecteds,
                visibleIds,
                html:html || '<div style="padding:32px;text-align:center;color:var(--faint);font-size:12px">无匹配</div>'
            };
        }

        function modelProtocolSelect({kind, index, model, item, showProtocol=false}={}) {
            if(kind === 'video' || !showProtocol) return '';

            const map = item?.model_protocols && typeof item.model_protocols === 'object'
                ? item.model_protocols
                : {};
            const current = String(map[String(model || '').trim()] || '').toLowerCase();
            const option = (value, label) => `<option value="${value}" ${current === value ? 'selected' : ''}>${label}</option>`;

            return `<select class="model-protocol-select" title="该模型使用的协议，默认跟随平台全局协议" data-action="updateModelProtocol" data-kind="${escapeAttr(kind)}" data-index="${index}">
                <option value="" ${current === '' ? 'selected' : ''}>默认</option>
                ${option('openai', 'OpenAI')}
                ${option('gemini', 'Gemini')}
            </select>`;
        }

        function modelRows({kind, models=[], item, showProtocol=false, labelForModel=model=>model}={}) {
            if(!models.length) return `<div class="empty">${tr('api.noModels')}</div>`;

            return models.map((model, index) => {
                const label = String(labelForModel(model) || '');

                return `
                    <div class="model-row${showProtocol ? ' has-protocol' : ''}">
                        <div class="model-id-field">
                            ${label && label !== model ? `<div class="model-display-name">${escapeHtml(label)}</div>` : ''}
                            <input value="${escapeAttr(model)}" data-action="updateModel" data-kind="${escapeAttr(kind)}" data-index="${index}">
                        </div>
                        ${modelProtocolSelect({kind, index, model, item, showProtocol})}
                        <button class="icon-btn" type="button" data-action="removeModel" data-kind="${escapeAttr(kind)}" data-index="${index}" title="删除"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
                    </div>`;
            }).join('');
        }

        function loraTargetOptions(models=[], selected='') {
            const options = [...new Set([selected, ...models].filter(Boolean))];
            return options.map(model => (
                `<option value="${escapeAttr(model)}" ${model === selected ? 'selected' : ''}>${escapeHtml(model)}</option>`
            )).join('');
        }

        function loraRows({loras=[], targetModels=[], defaultModel='', normalizeStrength=value=>value}={}) {
            if(!loras.length) return `<div class="lora-empty">${tr('api.loraEmpty')}</div>`;

            return loras.map((lora, index) => {
                const target = lora.target_model || lora.model || defaultModel;
                const strength = normalizeStrength(lora.strength ?? lora.default_strength ?? 0.8);

                return `
                    <div class="lora-row">
                        <label class="lora-field">
                            <span>${tr('api.loraId')}</span>
                            <input value="${escapeAttr(lora.id || '')}" placeholder="${escapeAttr(tr('api.loraIdPlaceholder'))}" data-action="updateMsLora" data-field="id" data-index="${index}">
                        </label>
                        <label class="lora-field">
                            <span>${tr('api.loraTargetModel')}</span>
                            <select data-action="updateMsLora" data-field="target_model" data-index="${index}">${loraTargetOptions(targetModels, target)}</select>
                        </label>
                        <label class="lora-field">
                            <span>${tr('api.loraDefaultStrength')}</span>
                            <input type="number" min="0" max="2" step="0.05" value="${strength}" data-action="updateMsLora" data-field="strength" data-index="${index}">
                        </label>
                        <button class="icon-btn" type="button" data-action="removeMsLora" data-index="${index}" title="${escapeAttr(tr('common.delete'))}"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
                    </div>`;
            }).join('');
        }

        return Object.freeze({providerCards, modelPicker, modelRows, loraRows});
    }

    window.SmartCanvasApiSettingsView = Object.freeze({create});
}());
