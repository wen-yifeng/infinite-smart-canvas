/**
 * Prompt workbench presentation helpers.
 *
 * The canvas entry owns template data, selection, and persistence. This file only
 * builds the panel markup and preserves the panel's scroll position.
 */
(function () {
    'use strict';

    const { escapeHtml, escapeAttr, tr } = window.SmartCanvasUiUtils;

function snapshotScroll(panel){

    if(!panel) return null;

    return {

        panelTop:panel.scrollTop || 0,

        tabLeft:panel.querySelector('.prompt-template-tabs')?.scrollLeft || 0,

        listTop:panel.querySelector('.prompt-template-list')?.scrollTop || 0,

        detailTop:panel.querySelector('.prompt-template-preview-content')?.scrollTop || 0

    };

}

function restoreScroll(panel, snapshot){

    if(!snapshot || !panel) return;

    requestAnimationFrame(() => {

        panel.scrollTop = snapshot.panelTop || 0;

        const tabs = panel.querySelector('.prompt-template-tabs');

        const list = panel.querySelector('.prompt-template-list');

        const detail = panel.querySelector('.prompt-template-preview-content');

        if(tabs) tabs.scrollLeft = snapshot.tabLeft || 0;

        if(list) list.scrollTop = snapshot.listTop || 0;

        if(detail) detail.scrollTop = snapshot.detailTop || 0;

    });

}

function buildCategoryTabs({categories, activeGroups, groupCounts, groupEditMode, activeCategory, categoryLabel}){

    return groupEditMode ? `
        <div class="prompt-template-group-panel">

            <div class="prompt-template-group-title">

                <div>

                    <strong>${escapeHtml(tr('smart.tplGroupManage'))}</strong>

                    <span>${escapeHtml(tr('smart.tplGroupHint'))}</span>

                </div>

                <div class="prompt-template-group-tools">

                    <button type="button" data-template-cat-new><i data-lucide="plus"></i><span>${escapeHtml(tr('smart.tplAdd'))}</span></button>

                    <button type="button" class="primary" data-av-interaction="top" data-template-group-edit><i data-lucide="check"></i><span>${escapeHtml(tr('smart.tplDone'))}</span></button>

                </div>

            </div>

            <div class="prompt-template-group-list">

                ${activeGroups.map(group => `

                    <div class="prompt-template-group-row has-delete">

                        <button type="button" class="group-name ${group.id === activeCategory ? 'active' : ''}" data-template-cat="${escapeHtml(group.id)}">

                            <span>${escapeHtml(categoryLabel(group.id))}</span>

                            <small>${groupCounts[group.id] || 0}</small>

                        </button>

                        <button type="button" class="group-tool" data-template-cat-edit="${escapeHtml(group.id)}" title="${escapeAttr(tr('smart.tplRename'))}"><i data-lucide="pencil"></i></button>

                        <button type="button" class="group-tool danger" data-template-cat-delete="${escapeHtml(group.id)}" title="${escapeAttr(tr('common.delete'))}"><i data-lucide="trash-2"></i></button>

                    </div>

                `).join('')}

            </div>

        </div>

    ` : `

        <div class="prompt-template-nav">

            <div class="prompt-template-tabs">

                ${categories.map(cat => `

                    <button type="button" class="${cat.id === activeCategory ? 'active' : ''}" data-template-cat="${escapeHtml(cat.id)}">

                        <span>${escapeHtml(cat.name)}</span>

                        <small>${groupCounts[cat.id] || 0}</small>

                    </button>

                `).join('')}

            </div>

            <button type="button" class="prompt-template-manage-groups" data-template-group-edit><i data-lucide="settings-2"></i><span>${escapeHtml(tr('smart.tplManageGroups'))}</span></button>

        </div>

    `;

}

function buildBody({items, selected, editMode, canEditCurrentLibrary, selectedPreset, activeGroups, categoryLabel, templateName, templateScene}){

    return `
        <div class="prompt-template-list">

            <div class="prompt-template-list-tools">

                <button type="button" data-template-save-current><i data-lucide="bookmark-plus"></i><span>${escapeHtml(tr('smart.tplSaveCurrent'))}</span></button>

                <button type="button" data-template-new><i data-lucide="file-plus-2"></i><span>${escapeHtml(tr('smart.tplNewTemplate'))}</span></button>

            </div>

            ${items.length ? items.map(item => `<button type="button" class="prompt-template-card ${item.id === selected?.id ? 'active' : ''}" data-template-id="${escapeHtml(item.id)}">

                <span class="prompt-template-card-top">

                    <span class="prompt-template-name">${escapeHtml(templateName(item))}</span>

                    <span class="prompt-template-source">${escapeHtml(item.builtin ? tr('smart.tplBuiltin') : tr('smart.tplMine'))}</span>

                </span>

                <span class="prompt-template-scene">${escapeHtml(templateScene(item) || item.positive || '')}</span>

                <span class="prompt-template-tag">${escapeHtml(categoryLabel(item.category || 'mine'))}</span>

            </button>`).join('') : `<div class="prompt-template-list-empty">${escapeHtml(tr('smart.tplNoMatches'))}</div>`}

        </div>

        <div class="prompt-template-detail">

            ${selected ? `

                <div class="prompt-template-detail-head">

                    <div>

                        <strong>${escapeHtml(templateName(selected) || '')}</strong>

                        <span>${escapeHtml(categoryLabel(selected.category || ''))} · ${escapeHtml(selected.builtin ? tr('smart.tplBuiltinTemplate') : tr('smart.tplMineTemplate'))}</span>

                    </div>

                    ${editMode ? '' : `

                        <div class="prompt-template-icon-actions">

                            <button type="button" ${!canEditCurrentLibrary ? 'disabled' : ''} data-template-edit title="${escapeAttr(tr('smart.tplEditTemplate'))}"><i data-lucide="pencil"></i><span>${escapeHtml(tr('common.edit'))}</span></button>

                            <button type="button" ${!canEditCurrentLibrary ? 'disabled' : ''} class="danger" data-template-delete title="${escapeAttr(tr('smart.tplDeleteTemplate'))}"><i data-lucide="trash-2"></i><span>${escapeHtml(tr('common.delete'))}</span></button>

                        </div>

                    `}

                </div>

            ${editMode ? `

                <div class="prompt-template-edit-fields">

                    <label>${escapeHtml(tr('smart.tplName'))}</label>

                    <input data-template-edit-name value="${escapeAttr(selectedPreset.name || '')}" placeholder="${escapeAttr(tr('smart.tplName'))}">

                    <label>${escapeHtml(tr('smart.tplGroup'))}</label>

                    <select data-template-edit-category>

                        ${activeGroups.map(group => `<option value="${escapeAttr(group.id)}" ${group.id === (selectedPreset.category || selected?.category || 'mine') ? 'selected' : ''}>${escapeHtml(categoryLabel(group.id))}</option>`).join('')}

                    </select>

                    <label>${escapeHtml(tr('smart.tplContent'))}</label>

                    <textarea data-template-edit-text placeholder="${escapeAttr(tr('smart.tplContent'))}">${escapeHtml(selectedPreset.text || '')}</textarea>

                </div>

            ` : `

                <div class="prompt-template-preview-content">

                <div class="prompt-template-section">

                    <label>${escapeHtml(tr('smart.tplPositive'))}</label>

                    <p>${escapeHtml(selected?.positive || '')}</p>

                </div>

                ${selected?.negative ? `<div class="prompt-template-section">

                    <label>${escapeHtml(tr('smart.tplNegative'))}</label>

                    <p>${escapeHtml(selected.negative)}</p>

                </div>` : ''}

                ${Object.keys(selected?.params || {}).length ? `<div class="prompt-template-section">

                    <label>${escapeHtml(tr('smart.tplParams'))}</label>

                    <p>${escapeHtml(Object.entries(selected.params).map(([k,v]) => `${k}: ${v}`).join('\n'))}</p>

                </div>` : ''}

                </div>

            `}

            <div class="prompt-template-actions">

                ${editMode ? `

                    <button type="button" data-template-edit-cancel><i data-lucide="x"></i><span>${escapeHtml(tr('common.cancel'))}</span></button>

                    <button type="button" class="danger" data-template-delete><i data-lucide="trash-2"></i><span>${escapeHtml(tr('common.delete'))}</span></button>

                    <button type="button" class="primary" data-av-interaction="top" data-template-edit-save><i data-lucide="save"></i><span>${escapeHtml(tr('common.save'))}</span></button>

                ` : `

                    <button type="button" data-template-apply="positive"><i data-lucide="corner-down-left"></i><span>${escapeHtml(tr('smart.tplApplyPositive'))}</span></button>

                    <button type="button" class="primary" data-av-interaction="top" data-template-apply="full"><i data-lucide="wand-sparkles"></i><span>${escapeHtml(tr('smart.tplApplyFull'))}</span></button>

                `}

            </div>

            ` : `<div class="prompt-template-empty">${escapeHtml(tr('smart.tplPickOrCreate'))}</div>`}

        </div>

    `;

}

    window.SmartCanvasPromptWorkbenchView = Object.freeze({
        snapshotScroll,
        restoreScroll,
        buildCategoryTabs,
        buildBody
    });
}());
