/**
 * Accessible portal dropdowns for compact settings controls.
 *
 * Native selects remain the source of truth. The controller only renders and
 * positions their glass menu surfaces.
 */
(function () {
    'use strict';

    function create({selects=[]}={}){
        const glassSelectBindings = new Map();
        function closeGlassSelect(binding){
            if(!binding) return;
            binding.open = false;
            binding.trigger?.setAttribute('aria-expanded', 'false');
            binding.menu?.classList.remove('is-open');
            if(binding.menu) binding.menu.hidden = true;
        }
        function closeAllGlassSelects(except){
            glassSelectBindings.forEach(binding => { if(binding !== except) closeGlassSelect(binding); });
        }
        function positionGlassSelect(binding){
            if(!binding?.open || !binding.menu || !binding.trigger) return;
            const triggerRect = binding.trigger.getBoundingClientRect();
            const wrapperRect = binding.wrapper?.getBoundingClientRect();
            const portalHost = document.body;
            const hostRect = portalHost.getBoundingClientRect();
            const scaleX = portalHost.offsetWidth > 0 ? hostRect.width / portalHost.offsetWidth : 1;
            const scaleY = portalHost.offsetHeight > 0 ? hostRect.height / portalHost.offsetHeight : 1;
            const safeScaleX = Number.isFinite(scaleX) && scaleX > 0 ? scaleX : 1;
            const safeScaleY = Number.isFinite(scaleY) && scaleY > 0 ? scaleY : 1;
            const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
            const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
            const viewportInset = 8;
            const gap = 8;
            const controlTop = Math.min(triggerRect.top, wrapperRect?.top ?? triggerRect.top);
            const controlBottom = Math.max(triggerRect.bottom, wrapperRect?.bottom ?? triggerRect.bottom);
            const maxVisualWidth = Math.max(0, viewportWidth - (viewportInset * 2));

            // The page body is scaled by theme.js. Portal CSS coordinates therefore need
            // to be converted back into the body's unscaled coordinate system.
            // Keep the menu's natural content width; only enforce the trigger as a minimum.
            binding.menu.style.width = 'auto';
            binding.menu.style.minWidth = `${triggerRect.width / safeScaleX}px`;
            binding.menu.style.maxWidth = `${maxVisualWidth / safeScaleX}px`;
            binding.menu.style.maxHeight = 'none';
            binding.menu.style.overflowY = 'visible';

            const naturalRect = binding.menu.getBoundingClientRect();
            const naturalWidth = naturalRect.width;
            const naturalHeight = naturalRect.height;
            const spaceBelow = Math.max(0, viewportHeight - controlBottom - gap - viewportInset);
            const spaceAbove = Math.max(0, controlTop - gap - viewportInset);
            const openAbove = naturalHeight > spaceBelow && spaceAbove > spaceBelow;
            const availableHeight = openAbove ? spaceAbove : spaceBelow;

            if(naturalHeight > availableHeight){
                binding.menu.style.maxHeight = `${availableHeight / safeScaleY}px`;
                binding.menu.style.overflowY = 'auto';
            }

            const renderedHeight = Math.min(naturalHeight, availableHeight);
            const maxLeft = Math.max(viewportInset, viewportWidth - naturalWidth - viewportInset);
            const visualLeft = Math.max(viewportInset, Math.min(triggerRect.left, maxLeft));
            const visualTop = openAbove
                ? Math.max(viewportInset, controlTop - gap - renderedHeight)
                : Math.max(viewportInset, controlBottom + gap);

            binding.menu.style.left = `${(visualLeft - hostRect.left) / safeScaleX}px`;
            binding.menu.style.top = `${(visualTop - hostRect.top) / safeScaleY}px`;
            binding.menu.classList.toggle('opens-upward', openAbove);
        }
        function syncGlassSelect(select){
            const binding = glassSelectBindings.get(select);
            if(!binding) return;
            const options = Array.from(select.options);
            const selected = options.find(option => option.value === select.value) || options[select.selectedIndex] || options[0];
            if(selected && select.value !== selected.value) select.value = selected.value;
            binding.value.textContent = selected?.textContent?.trim() || '';
            binding.trigger.disabled = Boolean(select.disabled);
            binding.trigger.classList.toggle('is-disabled', Boolean(select.disabled));
            binding.trigger.setAttribute('aria-disabled', String(Boolean(select.disabled)));
            binding.menu.innerHTML = options.map((option, index) => `
                <button class="glass-select-option${option.value === selected?.value ? ' is-selected' : ''}" type="button" role="option" aria-selected="${option.value === selected?.value}" data-value="${escapeAttr(option.value)}"${option.disabled ? ' disabled' : ''}>
                    <span>${escapeHtml(option.textContent?.trim() || '')}</span>
                    <i data-lucide="check" class="glass-select-check" aria-hidden="true"></i>
                </button>
            `).join('');
            binding.menu.querySelectorAll('.glass-select-option').forEach(optionButton => {
                optionButton.addEventListener('click', () => {
                    if(optionButton.disabled) return;
                    select.value = optionButton.dataset.value || '';
                    closeGlassSelect(binding);
                    select.dispatchEvent(new Event('change', {bubbles:true}));
                    syncGlassSelect(select);
                });
            });
            refreshIcons();
        }
        function openGlassSelect(binding){
            if(!binding || binding.trigger.disabled) return;
            closeAllGlassSelects(binding);
            binding.open = true;
            binding.trigger.setAttribute('aria-expanded', 'true');
            binding.menu.hidden = false;
            binding.menu.classList.add('is-open');
            positionGlassSelect(binding);
            const selectedOption = binding.menu.querySelector('.glass-select-option.is-selected');
            selectedOption?.focus({preventScroll:true});
        }
        function toggleGlassSelect(binding){
            if(binding?.open) closeGlassSelect(binding);
            else openGlassSelect(binding);
        }
        function initGlassSelect(select){
            if(!select || glassSelectBindings.has(select)) return;
            const wrapper = select.closest('[data-glass-select]');
            const trigger = wrapper?.querySelector('.glass-select-trigger');
            if(!wrapper || !trigger) return;
            const menu = document.createElement('div');
            menu.id = trigger.getAttribute('aria-controls') || `${select.id}Menu`;
            menu.className = 'glass-select-menu';
            menu.setAttribute('role', 'listbox');
            menu.hidden = true;
            document.body.appendChild(menu);
            const binding = {select, wrapper, trigger, value:trigger.querySelector('.glass-select-value'), menu, open:false};
            glassSelectBindings.set(select, binding);
            select.classList.add('glass-select-native');
            trigger.addEventListener('click', event => { event.stopPropagation(); toggleGlassSelect(binding); });
            trigger.addEventListener('keydown', event => {
                if(['ArrowDown','ArrowUp','Enter',' '].includes(event.key)){
                    event.preventDefault();
                    if(!binding.open) openGlassSelect(binding);
                    else moveGlassSelectOption(binding, event.key === 'ArrowUp' ? -1 : 1);
                } else if(event.key === 'Escape') {
                    event.preventDefault(); closeGlassSelect(binding);
                }
            });
            menu.addEventListener('keydown', event => {
                if(event.key === 'Escape'){
                    event.preventDefault(); closeGlassSelect(binding); trigger.focus(); return;
                }
                if(event.key === 'ArrowDown' || event.key === 'ArrowUp'){
                    event.preventDefault(); moveGlassSelectOption(binding, event.key === 'ArrowUp' ? -1 : 1); return;
                }
                if(event.key === 'Home' || event.key === 'End'){
                    event.preventDefault(); focusGlassSelectOption(binding, event.key === 'Home' ? 0 : -1); return;
                }
                if(event.key === 'Tab') closeGlassSelect(binding);
            });
            select.addEventListener('change', () => syncGlassSelect(select));
            syncGlassSelect(select);
        }
        function focusGlassSelectOption(binding, index){
            const options = Array.from(binding.menu.querySelectorAll('.glass-select-option:not(:disabled)'));
            if(!options.length) return;
            const current = options.indexOf(document.activeElement);
            const target = options[Math.max(0, Math.min(options.length - 1, index < 0 ? options.length - 1 : index))] || options[Math.max(0, current)];
            target?.focus({preventScroll:true});
        }
        function moveGlassSelectOption(binding, delta){
            const options = Array.from(binding.menu.querySelectorAll('.glass-select-option:not(:disabled)'));
            if(!options.length) return;
            const current = Math.max(0, options.indexOf(document.activeElement));
            options[(current + delta + options.length) % options.length]?.focus({preventScroll:true});
        }
        function syncAll(){
            selects.forEach(syncGlassSelect);
        }

        function initAll(){
            selects.forEach(initGlassSelect);
            document.addEventListener('click', () => closeAllGlassSelects());
            window.addEventListener('resize', () => glassSelectBindings.forEach(positionGlassSelect));
            window.addEventListener('studio-ui-scale-change', () => glassSelectBindings.forEach(positionGlassSelect));
            let scrollTimer;
            window.addEventListener('scroll', () => {
                clearTimeout(scrollTimer);
                scrollTimer = setTimeout(() => glassSelectBindings.forEach(positionGlassSelect), 50);
            }, true);
        }

        return Object.freeze({sync:syncGlassSelect, syncAll, initAll});
    }

    window.SmartCanvasGlassSelect = Object.freeze({create});
}());