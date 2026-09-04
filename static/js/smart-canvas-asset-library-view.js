/**
 * Asset-library presentation helpers.
 *
 * The canvas entry owns assets, network requests, and drag/drop actions. This file
 * only renders asset cards and manages the two accessible custom select controls.
 */
(function () {
    'use strict';

    const { escapeHtml } = window.SmartCanvasUiUtils;

    function pickerItems(menu){
        return menu ? Array.from(menu.querySelectorAll('.asset-select-option:not([disabled])')) : [];
    }

    function createPickerController(entries){
        const pickers = entries.filter(({select, button, menu}) => select && button && menu);

        function closePicker({button, menu}){
            button.setAttribute('aria-expanded', 'false');
            button.closest('.asset-select-shell')?.classList.remove('open');
            menu.hidden = true;
        }

        function closeAll(exceptButton=null){
            pickers.forEach(picker => {
                if(picker.button !== exceptButton) closePicker(picker);
            });
        }

        function chooseValue(picker, value){
            const {select, button} = picker;
            const changed = select.value !== value;
            select.value = value;
            closePicker(picker);
            button.focus({preventScroll:true});
            if(changed) select.dispatchEvent(new Event('change', {bubbles:true}));
        }

        function syncPicker(picker){
            const {select, button, menu} = picker;
            closePicker(picker);
            const selected = select.selectedOptions?.[0] || select.options?.[0];
            const valueEl = button.querySelector('.asset-select-value');
            if(valueEl) valueEl.textContent = selected?.textContent || '';
            button.title = selected?.textContent || button.getAttribute('aria-label') || '';
            button.disabled = Boolean(select.disabled || !select.options.length);
            menu.innerHTML = '';
            Array.from(select.options).forEach(option => {
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'asset-select-option';
                item.setAttribute('role', 'option');
                item.setAttribute('aria-selected', option.selected ? 'true' : 'false');
                item.dataset.value = option.value;
                item.disabled = option.disabled;
                item.textContent = option.textContent || '';
                item.addEventListener('click', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    chooseValue(picker, option.value);
                });
                menu.appendChild(item);
            });
        }

        function openPicker(picker, focusEdge='selected'){
            const {button, menu} = picker;
            if(button.disabled) return;
            const willOpen = menu.hidden;
            closeAll(button);
            if(!willOpen){
                closePicker(picker);
                return;
            }
            menu.hidden = false;
            button.setAttribute('aria-expanded', 'true');
            button.closest('.asset-select-shell')?.classList.add('open');
            requestAnimationFrame(() => {
                const items = pickerItems(menu);
                const target = focusEdge === 'last'
                    ? items[items.length - 1]
                    : menu.querySelector('.asset-select-option[aria-selected="true"]') || items[0];
                target?.focus({preventScroll:true});
            });
        }

        function bindPicker(picker){
            const {button, menu} = picker;
            button.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                openPicker(picker);
            });
            button.addEventListener('keydown', event => {
                if(event.key === 'ArrowDown' || event.key === 'ArrowUp'){
                    event.preventDefault();
                    openPicker(picker, event.key === 'ArrowUp' ? 'last' : 'selected');
                } else if(event.key === 'Escape'){
                    closePicker(picker);
                }
            });
            menu.addEventListener('keydown', event => {
                const items = pickerItems(menu);
                const current = items.indexOf(document.activeElement);
                if(event.key === 'ArrowDown' || event.key === 'ArrowUp'){
                    event.preventDefault();
                    const delta = event.key === 'ArrowDown' ? 1 : -1;
                    items[(current + delta + items.length) % items.length]?.focus({preventScroll:true});
                } else if(event.key === 'Home' || event.key === 'End'){
                    event.preventDefault();
                    items[event.key === 'Home' ? 0 : items.length - 1]?.focus({preventScroll:true});
                } else if(event.key === 'Enter' || event.key === ' '){
                    event.preventDefault();
                    document.activeElement?.click?.();
                } else if(event.key === 'Escape'){
                    event.preventDefault();
                    closePicker(picker);
                    button.focus({preventScroll:true});
                } else if(event.key === 'Tab'){
                    closePicker(picker);
                }
            });
        }

        return Object.freeze({
            bindAll(){ pickers.forEach(bindPicker); },
            closeAll,
            syncAll(){ pickers.forEach(syncPicker); }
        });
    }

    function buildAssetCards({items, localMode, thumbnailHtml, mediaKind, deleteTitle}){
        return items.map(item => `
            <div class="asset-item" draggable="true" data-asset-id="${escapeHtml(item.id)}" data-url="${escapeHtml(item.url)}" data-name="${escapeHtml(item.name || 'asset')}" data-kind="${escapeHtml(mediaKind(item))}">
                ${thumbnailHtml(item)}
                ${localMode ? `<button class="asset-mini-btn" type="button" data-delete-local-asset="${escapeHtml(item.id)}" title="${escapeHtml(deleteTitle)}"><i data-lucide="trash-2"></i></button>` : `<button class="asset-mini-btn" type="button" data-delete-asset="${escapeHtml(item.id)}" title="${escapeHtml(deleteTitle)}"><i data-lucide="trash-2"></i></button>`}
            </div>
        `).join('');
    }

    function buildAssetGrid({items, localMode, smartClass, thumbnailHtml, mediaKind, deleteTitle}){
        const addCard = `<button class="asset-add-card" type="button" data-asset-add-files aria-label="批量添加素材" ${smartClass ? 'disabled title="智能分类不能直接添加素材，请选择文件夹"' : 'title="批量添加素材"'}><i data-lucide="image-plus"></i></button>`;
        return addCard + buildAssetCards({items, localMode, thumbnailHtml, mediaKind, deleteTitle});
    }

    window.SmartCanvasAssetLibraryView = Object.freeze({
        createPickerController,
        buildAssetCards,
        buildAssetGrid
    });
}());
