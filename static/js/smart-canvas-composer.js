(function(global){
    'use strict';

    const DEFAULTS = Object.freeze({
        collapsedLabel: '展开编辑器',
        expandedLabel: '关闭编辑器',
    });

    function noop() {}

    class SmartCanvasComposer {
        constructor(options = {}) {
            this.root = options.root || null;
            this.collapseButton = options.collapseButton || null;
            this.promptInput = options.promptInput || null;
            this.apiKindToggle = options.apiKindToggle || null;
            this.translate = typeof options.translate === 'function' ? options.translate : key => key;
            this.refreshIcons = typeof options.refreshIcons === 'function' ? options.refreshIcons : noop;
            this.onToggleDock = typeof options.onToggleDock === 'function' ? options.onToggleDock : noop;
            this.onApiKindChange = typeof options.onApiKindChange === 'function' ? options.onApiKindChange : noop;
            this.onCloseMentionPicker = typeof options.onCloseMentionPicker === 'function' ? options.onCloseMentionPicker : noop;
            this._bound = false;
            this.bind();
        }

        bind() {
            if (this._bound) return;
            this._bound = true;
            this.collapseButton?.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                this.onToggleDock();
            });
            this.apiKindToggle?.querySelectorAll?.('[data-kind]').forEach(button => {
                button.addEventListener('click', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    this.onApiKindChange(button.dataset?.kind || '');
                });
            });
        }

        destroy() {
            if (!this._bound) return;
            this._bound = false;
        }

        syncDock({collapsed = false} = {}) {
            this.root?.classList?.toggle('collapsed', Boolean(collapsed));
            this.root?.classList?.toggle('screen-docked', true);
            if (this.collapseButton) {
                const label = collapsed ? DEFAULTS.collapsedLabel : DEFAULTS.expandedLabel;
                this.collapseButton.title = label;
                this.collapseButton.setAttribute('aria-label', label);
                this.collapseButton.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
                this.collapseButton.innerHTML = `<i data-lucide="${collapsed ? 'chevron-right' : 'x'}"></i>`;
                this.refreshIcons(this.collapseButton);
            }
        }

        setPromptLocked(locked) {
            if (!this.promptInput) return;
            const value = Boolean(locked);
            this.promptInput.dataset.promptLocked = value ? '1' : '0';
            this.promptInput.setAttribute('contenteditable', value ? 'false' : 'true');
            this.promptInput.classList.toggle('prompt-input-locked', value);
            if (value) this.onCloseMentionPicker();
        }

        setPromptText(text) {
            if (this.promptInput) this.promptInput.textContent = text || '';
        }

        clearPrompt({preserveDraft = false} = {}) {
            if (!this.promptInput) return;
            if (preserveDraft) {
                this.promptInput.dataset.preserveDraftOnce = '1';
                this.onCloseMentionPicker();
                return;
            }
            this.promptInput.textContent = '';
            this.onCloseMentionPicker();
        }


        syncApiKind(kind = 'image') {
            if (!this.apiKindToggle) return;
            this.apiKindToggle.style.display = 'inline-flex';
            this.apiKindToggle.querySelectorAll?.('[data-kind]').forEach(button => {
                button.classList.toggle('active', button.dataset?.kind === kind);
            });
        }

    }

    global.SmartCanvasComposer = SmartCanvasComposer;
    global.SmartCanvasComposerDefaults = DEFAULTS;
})(window);
