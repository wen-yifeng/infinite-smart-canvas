(function attachSmartCanvasParameterView(global){
    'use strict';

    function escapeFallback(value){
        return String(value ?? '').replace(/[&<>"']/g, character => ({
            '&':'&amp;',
            '<':'&lt;',
            '>':'&gt;',
            '"':'&quot;',
            "'":'&#39;'
        }[character]));
    }

    function dependencies(deps={}){
        const escapeHtml = typeof deps.escapeHtml === 'function' ? deps.escapeHtml : escapeFallback;
        return {
            escapeHtml,
            escapeAttr:typeof deps.escapeAttr === 'function' ? deps.escapeAttr : escapeHtml,
            tr:typeof deps.tr === 'function' ? deps.tr : key => key,
            videoAspectIconClass:typeof deps.videoAspectIconClass === 'function' ? deps.videoAspectIconClass : () => '',
            defaultResolution:typeof deps.defaultResolution === 'function' ? deps.defaultResolution : () => '1k',
            isAutoSizeModel:typeof deps.isAutoSizeModel === 'function' ? deps.isAutoSizeModel : () => false,
            sourceImageRatioLabel:typeof deps.sourceImageRatioLabel === 'function' ? deps.sourceImageRatioLabel : () => '',
            ratioLabel:typeof deps.ratioLabel === 'function' ? deps.ratioLabel : () => '1:1',
            resolutionLabel:typeof deps.resolutionLabel === 'function' ? deps.resolutionLabel : () => '1K',
            apiImageSize:typeof deps.apiImageSize === 'function' ? deps.apiImageSize : () => ''
        };
    }

    function optionHtml(value, label, selected, deps={}){
        const {escapeHtml} = dependencies(deps);
        return `<option value="${escapeHtml(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${escapeHtml(label ?? value)}</option>`;
    }

    function renderProviderControl(providers, state={}, current=null, deps={}){
        const {escapeHtml, tr} = dependencies(deps);
        const items = Array.isArray(providers) ? providers : [];
        const selected = state.provider_id || '';
        const active = current || items.find(provider => provider?.id === selected) || null;
        return `<div class="smart-control provider-control" data-provider-scope="image">
        <button class="smart-pill" type="button"><i data-lucide="plug-zap"></i><span class="param-pill-label">平台</span><span class="param-pill-value sub">${escapeHtml(active?.name || selected || tr('smart.platform'))}</span><i class="provider-switch-caret" data-lucide="chevrons-up-down"></i></button>
        <div class="smart-popover compact-popover">
            <div class="smart-popover-title">${escapeHtml(tr('smart.apiPlatform'))}</div>
            <div class="model-list">
                ${items.map(provider => `<button type="button" class="direct-option ${provider.id === selected ? 'active' : ''}" data-smart-param="provider_id" data-smart-value="${escapeHtml(provider.id)}"><span>${escapeHtml(provider.name || provider.id)}</span></button>`).join('') || `<div class="muted-note">${escapeHtml(tr('smart.noApiPlatform'))}</div>`}
            </div>
        </div>
    </div>`;
    }

    function renderModelControl(models, state={}, deps={}){
        const {escapeHtml, escapeAttr, tr} = dependencies(deps);
        const items = Array.isArray(models) ? models : [];
        const selected = state.model || '';
        const label = selected || tr('smart.model');
        return `<div class="smart-control model-control click-popover-control">
        <button class="smart-pill" type="button" title="${escapeAttr(label)}"><i data-lucide="sparkles"></i><span class="param-pill-label">模型</span><span class="param-pill-value sub">${escapeHtml(label)}</span><i class="provider-switch-caret" data-lucide="chevrons-up-down"></i></button>
        <div class="smart-popover compact-popover">
            <div class="smart-popover-title">${escapeHtml(tr('smart.imageModel'))}</div>
            <div class="model-list">
                ${items.map(model => `<button type="button" class="direct-option ${model === selected ? 'active' : ''}" data-smart-param="model" data-smart-value="${escapeHtml(model)}"><span>${escapeHtml(model)}</span></button>`).join('') || `<div class="muted-note">${escapeHtml(tr('smart.noImageModel'))}</div>`}
            </div>
        </div>
    </div>`;
    }

    function renderVideoProviderControl(providers, state={}, current=null, deps={}){
        const {escapeHtml, tr} = dependencies(deps);
        const items = Array.isArray(providers) ? providers : [];
        const selected = state.videoProvider || '';
        const active = current || items.find(provider => provider?.id === selected) || null;
        return `<div class="smart-control provider-control" data-provider-scope="video">
        <button class="smart-pill" type="button"><i data-lucide="plug-zap"></i><span class="param-pill-label">平台</span><span class="param-pill-value sub">${escapeHtml(active?.name || selected || tr('smart.platform'))}</span><i class="provider-switch-caret" data-lucide="chevrons-up-down"></i></button>
        <div class="smart-popover compact-popover">
            <div class="smart-popover-title">${escapeHtml(tr('smart.videoPlatform'))}</div>
            <div class="model-list">
                ${items.map(provider => `<button type="button" class="direct-option ${provider.id === selected ? 'active' : ''}" data-smart-param="videoProvider" data-smart-value="${escapeHtml(provider.id)}"><span>${escapeHtml(provider.name || provider.id)}</span></button>`).join('') || `<div class="muted-note">${escapeHtml(tr('smart.noVideoPlatform'))}</div>`}
            </div>
        </div>
    </div>`;
    }

    function renderVideoModelControl(models, state={}, deps={}){
        const {escapeHtml, escapeAttr, tr} = dependencies(deps);
        const items = Array.isArray(models) ? models : [];
        const selected = state.videoModel || '';
        const label = selected || tr('smart.model');
        return `<div class="smart-control model-control click-popover-control">
        <button class="smart-pill" type="button" title="${escapeAttr(label)}"><i data-lucide="film"></i><span class="param-pill-label">模型</span><span class="param-pill-value sub">${escapeHtml(label)}</span></button>
        <div class="smart-popover compact-popover">
            <div class="smart-popover-title">${escapeHtml(tr('smart.videoModel'))}</div>
            <div class="model-list">
                ${items.map(model => `<button type="button" class="direct-option ${model === selected ? 'active' : ''}" data-smart-param="videoModel" data-smart-value="${escapeHtml(model)}"><span>${escapeHtml(model)}</span></button>`).join('') || `<div class="muted-note">${escapeHtml(tr('smart.noVideoModel'))}</div>`}
            </div>
        </div>
    </div>`;
    }

    function renderVideoDurationControl(state={}, deps={}){
        const {escapeHtml, tr} = dependencies(deps);
        const value = Math.max(1, Math.min(60, Number(state.videoDuration) || 5));
        const quickValues = [3, 4, 5, 6, 8, 10, 12, 15];
        return `<div class="smart-control duration-control" title="${escapeHtml(tr('smart.videoDurationTip'))}">
        <button class="smart-pill" type="button"><i data-lucide="timer"></i><span>${value}s</span></button>
        <div class="smart-popover compact-popover">
            <div class="smart-popover-title">${escapeHtml(tr('smart.videoDuration'))}</div>
            <div class="duration-grid">
                ${quickValues.map(duration => `<button type="button" class="duration-option ${duration === value ? 'active' : ''}" data-smart-param="videoDuration" data-smart-value="${duration}">${duration}s</button>`).join('')}
            </div>
            <label class="duration-custom">
                <span>${escapeHtml(tr('smart.custom'))}</span>
                <input type="number" min="1" max="60" step="1" data-param="videoDuration" value="${value}">
            </label>
        </div>
    </div>`;
    }

    function renderVideoAspectControl(state={}, deps={}){
        const {escapeHtml, tr, videoAspectIconClass} = dependencies(deps);
        const options = [
            ['16:9', '16:9'], ['9:16', '9:16'], ['1:1', '1:1'], ['4:3', '4:3'], ['3:4', '3:4'],
            ['21:9', '21:9'], ['9:21', '9:21'], ['keep_ratio', tr('smart.videoAspectKeep')], ['adaptive', tr('smart.videoAspectAdaptive')]
        ];
        const value = state.videoAspect || '16:9';
        const labels = Object.fromEntries(options);
        return `<div class="smart-control aspect-control">
        <button class="smart-pill" type="button"><i data-lucide="scan"></i><span>${escapeHtml(labels[value] || value)}</span></button>
        <div class="smart-popover">
            <div class="smart-popover-title">${escapeHtml(tr('smart.videoAspect'))}</div>
            <div class="ratio-grid">
                ${options.map(([option, label]) => `<button type="button" class="ratio-option ${option === value ? 'active' : ''}" data-smart-param="videoAspect" data-smart-value="${escapeHtml(option)}"><span class="ratio-icon ${videoAspectIconClass(option)}"></span><span>${escapeHtml(label)}</span></button>`).join('')}
            </div>
        </div>
    </div>`;
    }

    function renderVideoResolutionControl(state={}, deps={}){
        const {escapeHtml, tr} = dependencies(deps);
        const options = [['', tr('smart.videoResAuto')], ['480p', '480P'], ['720p', '720P'], ['1080p', '1080P']];
        const value = state.videoResolution || '';
        const labels = Object.fromEntries(options);
        return `<div class="smart-control resolution-control">
        <button class="smart-pill" type="button"><i data-lucide="monitor"></i><span>${escapeHtml(labels[value] || value || tr('smart.videoResAuto'))}</span></button>
        <div class="smart-popover compact-popover">
            <div class="smart-popover-title">${escapeHtml(tr('smart.videoResolution'))}</div>
            <div class="model-list">
                ${options.map(([option, label]) => `<button type="button" class="direct-option ${option === value ? 'active' : ''}" data-smart-param="videoResolution" data-smart-value="${escapeHtml(option)}"><span>${escapeHtml(label)}</span></button>`).join('')}
            </div>
        </div>
    </div>`;
    }

    function renderVideoToggleControl(key, label, state={}, deps={}){
        const {escapeHtml} = dependencies(deps);
        return `<button type="button" class="setting-check ${state[key] ? 'active' : ''}" data-toggle-param="${escapeHtml(key)}"><span class="check-box"></span><span>${escapeHtml(label)}</span></button>`;
    }

    function renderVideoTrustedAssetControl(state={}, deps={}){
        const {tr} = dependencies(deps);
        let html = renderVideoToggleControl('videoTrustedAsset', tr('smart.videoTrustedAsset'), state, deps);
        if(!state.videoTrustedAsset) return html;
        const source = ['library', 'cloud', 'manual'].includes(state.videoTrustedSource) ? state.videoTrustedSource : 'library';
        html += `<div class="trusted-source-row">
        <button type="button" class="smart-pill trusted-src-pill ${source === 'library' ? 'active' : ''}" data-trusted-source="library" title="使用素材库中已注册的认证素材链接（asset://）"><i data-lucide="library"></i><span>素材库链接</span></button>
        <button type="button" class="smart-pill trusted-src-pill ${source === 'cloud' ? 'active' : ''}" data-trusted-source="cloud" title="把当前输入图片/视频上传到云端直链"><i data-lucide="upload-cloud"></i><span>上传云端</span></button>
        <button type="button" class="smart-pill trusted-src-pill ${source === 'manual' ? 'active' : ''}" data-trusted-source="manual" title="手动输入媒体 URL 或 asset:// 地址"><i data-lucide="link"></i><span>输入网址</span></button>
    </div>`;
        return html;
    }

    function renderQualityControl(state={}, deps={}){
        const {escapeHtml, tr} = dependencies(deps);
        const value = state.quality || 'auto';
        const labels = {
            auto:tr('smart.qualityAuto'),
            low:tr('smart.qualityLow'),
            medium:tr('smart.qualityMid'),
            high:tr('smart.qualityHigh')
        };
        return `<div class="smart-control quality-control click-popover-control">
        <button class="smart-pill" type="button"><i data-lucide="sliders-horizontal"></i><span class="param-pill-label">质量</span><span class="param-pill-value">${escapeHtml(labels[value] || value)}</span></button>
        <div class="smart-popover compact-popover">
            <div class="smart-popover-title">${escapeHtml(tr('smart.quality'))}</div>
            <div class="seg-row">
                ${Object.entries(labels).map(([key, label]) => `<button type="button" class="${key === value ? 'active' : ''}" data-smart-param="quality" data-smart-value="${escapeHtml(key)}">${escapeHtml(label)}</button>`).join('')}
            </div>
        </div>
    </div>`;
    }

    function sizePickerScope(prefix='', state={}, deps={}){
        const {defaultResolution} = dependencies(deps);
        const resolutionKey = prefix ? `${prefix}Resolution` : 'resolution';
        const ratioKey = prefix ? `${prefix}Ratio` : 'ratio';
        const value = state[resolutionKey] || ((!prefix && state.engine === 'api') ? defaultResolution(state.model) : '1k');
        if(value === 'auto') return 'auto';
        if(value === 'custom' || state[ratioKey] === 'custom') return 'custom';
        return 'preset';
    }

    function sizePickerDefaultResolution(prefix='', state={}, deps={}){
        const {defaultResolution} = dependencies(deps);
        const value = (!prefix && state.engine === 'api') ? defaultResolution(state.model) : '1k';
        return value === 'auto' ? '1k' : value;
    }

    function sizePickerLabel(prefix='', state={}, deps={}){
        const {ratioLabel, resolutionLabel} = dependencies(deps);
        const scope = sizePickerScope(prefix, state, deps);
        if(scope === 'auto') return '自动';
        if(scope === 'custom'){
            const resolutionKey = prefix ? `${prefix}Resolution` : 'resolution';
            const ratioKey = prefix ? `${prefix}Ratio` : 'ratio';
            const resolutionText = resolutionLabel(prefix);
            const ratioText = ratioLabel(prefix);
            if(state[resolutionKey] === 'custom' && state[ratioKey] === 'custom') return `自定义 · ${resolutionText} · ${ratioText}`;
            if(state[resolutionKey] === 'custom') return `自定义 · ${resolutionText}`;
            if(state[ratioKey] === 'custom') return `自定义 · ${ratioText} · ${resolutionText}`;
            return `自定义 · ${resolutionText}`;
        }
        return `${ratioLabel(prefix)} · ${resolutionLabel(prefix)}`;
    }

    function imageRatioIconClass(value){
        return {
            square:'', portrait:'r-portrait', portrait43:'r-portrait43',
            landscape:'r-landscape', landscape43:'r-landscape43', story:'r-story',
            wide:'r-wide', ultrawide:'r-ultrawide', ultratall:'r-ultratall', source:'r-source'
        }[value] || '';
    }

    function imageRatioIconStyle(value, label){
        if(value !== 'source' && value !== 'custom') return '';
        const match = String(label || '').trim().match(/^(\d+(?:\.\d+)?)\s*[:：/]\s*(\d+(?:\.\d+)?)$/);
        if(!match) return '';
        const sourceWidth = Number(match[1]);
        const sourceHeight = Number(match[2]);
        if(!(sourceWidth > 0) || !(sourceHeight > 0)) return '';
        const ratio = sourceWidth / sourceHeight;
        const maxSide = 20;
        const minSide = 9;
        const width = ratio >= 1 ? maxSide : Math.max(minSide, Math.round(maxSide * ratio));
        const height = ratio >= 1 ? Math.max(minSide, Math.round(maxSide / ratio)) : maxSide;
        return `style="width:${width}px;height:${height}px"`;
    }

    function imageQualityLabels(deps={}){
        const {tr} = dependencies(deps);
        return {
            auto:tr('smart.qualityAuto'),
            low:tr('smart.qualityLow'),
            medium:tr('smart.qualityMid'),
            high:tr('smart.qualityHigh')
        };
    }

    function renderImageSizeQualityControl(state={}, deps={}){
        const {
            escapeHtml,
            defaultResolution,
            isAutoSizeModel,
            sourceImageRatioLabel,
            apiImageSize,
            ratioLabel,
            resolutionLabel
        } = dependencies(deps);
        const prefix = '';
        const includeSource = true;
        const ratioKey = 'ratio';
        const resolutionKey = 'resolution';
        const widthKey = 'customWidth';
        const heightKey = 'customHeight';
        const scope = sizePickerScope(prefix, state, deps);
        const resolutionOptions = state.engine === 'api' ? ['auto', '1k', '2k', '4k'] : ['1k', '2k', '4k'];
        const currentResolution = state[resolutionKey] || (state.engine === 'api' ? defaultResolution(state.model) : '1k');
        const currentRatio = state[ratioKey] || 'square';
        const currentCustomRatio = state.customRatio || (currentRatio === 'source' ? sourceImageRatioLabel(prefix) : '');
        const allowAuto = state.engine === 'api' && state.apiKind !== 'video' && isAutoSizeModel(state.model);
        const ratios = [
            ['square', '1:1', '正方形'], ['portrait', '2:3', '竖图'], ['landscape', '3:2', '横图'],
            ['portrait43', '3:4', '竖图'], ['landscape43', '4:3', '横图'], ['story', '9:16', '竖屏'],
            ['wide', '16:9', '宽屏'], ['ultrawide', '21:9', '超宽'], ['ultratall', '9:21', '超竖'],
            ...(includeSource ? [['source', '原图', '适配输入']] : [])
        ];
        const selectedRatio = ratios.find(([value]) => value === currentRatio);
        const ratioText = selectedRatio?.[1] || ratioLabel(prefix);
        const qualityLabels = imageQualityLabels(deps);
        const quality = state.quality || 'auto';
        const qualityText = qualityLabels[quality] || quality;
        const resolutionText = currentResolution === 'auto' ? '自动' : resolutionLabel(prefix);
        const count = Math.max(1, Math.min(8, Math.round(Number(state.count) || 1)));
        const countOptions = [1,2,3,4,5,6,7,8].map(value => `<button type="button" class="${value === count ? 'active' : ''}" data-smart-param="count" data-smart-value="${value}">${value} 张</button>`).join('');
        return `<div class="image-size-quality-controls"><div class="smart-control size-picker-control image-size-quality-control click-popover-control ${scope === 'auto' ? 'auto-mode' : ''} ${scope === 'custom' ? 'custom-mode' : ''}">
        <button class="smart-pill size-picker-pill" type="button"><i data-lucide="scan-line"></i><span class="size-picker-label"><span class="size-picker-type">尺寸质量</span><span class="size-quality-summary"><span class="ratio-icon ${imageRatioIconClass(currentRatio)}" ${imageRatioIconStyle(currentRatio, ratioText)} aria-hidden="true"></span><span>${escapeHtml(ratioText)}</span><span class="size-picker-dot"></span><span>${escapeHtml(resolutionText)}</span><span class="size-picker-dot"></span><span>${escapeHtml(qualityText)}</span><span class="size-picker-dot"></span><span>${count}张</span></span></span><i class="provider-switch-caret" data-lucide="chevrons-up-down"></i></button>
        <div class="smart-popover size-picker-popover image-size-quality-popover">
            <div class="size-picker-head">
                <div class="smart-popover-title">尺寸与质量</div>
                <div class="size-picker-scope">
                    <button type="button" class="${scope === 'auto' ? 'active' : ''}" data-size-scope="auto" data-size-prefix="" ${allowAuto ? '' : 'disabled'}>自动</button>
                    <button type="button" class="${scope === 'preset' ? 'active' : ''}" data-size-scope="preset" data-size-prefix="">系统参数</button>
                    <button type="button" class="${scope === 'custom' ? 'active' : ''}" data-size-scope="custom" data-size-prefix="">自定义</button>
                </div>
            </div>
            ${scope === 'auto' ? `<div class="size-picker-pane size-picker-auto"><div class="size-picker-note"><strong>自动尺寸</strong><span>使用模型默认尺寸，或由支持自动尺寸的模型自行决定。</span></div></div>` : ''}
            ${scope === 'preset' ? `<div class="size-picker-pane size-picker-preset image-size-quality-pane">
                <section class="size-picker-section"><div class="size-picker-section-title">比例</div><div class="size-picker-list">
                    ${ratios.map(([value, label, description]) => `<button type="button" class="size-picker-option size-ratio-option ${value === currentRatio ? 'active' : ''}" data-smart-param="${ratioKey}" data-smart-value="${escapeHtml(value)}" title="${escapeHtml(`${label} ${description}`)}" aria-label="${escapeHtml(`${label} ${description}`)}"><span class="ratio-icon ${imageRatioIconClass(value)}" aria-hidden="true"></span><span class="size-ratio-label">${escapeHtml(label)}</span></button>`).join('')}
                </div></section>
                <section class="size-picker-section"><div class="size-picker-section-title">清晰度</div><div class="size-picker-list">
                    ${resolutionOptions.filter(value => value !== 'auto').map(value => `<button type="button" class="size-picker-option ${value === currentResolution ? 'active' : ''}" data-smart-param="${resolutionKey}" data-smart-value="${value}"><span>${value.toUpperCase()}</span><small>${escapeHtml(apiImageSize(currentRatio, value, currentCustomRatio, '') || '')}</small></button>`).join('')}
                </div></section>
            </div>` : ''}
            ${scope === 'custom' ? `<div class="size-picker-pane size-picker-custom"><div class="size-custom-box"><div class="size-custom-title">自定义分辨率</div><div class="size-custom-row"><input type="number" data-param="${widthKey}" value="${escapeHtml(state[widthKey] || '')}" placeholder="宽度"><span>×</span><input type="number" data-param="${heightKey}" value="${escapeHtml(state[heightKey] || '')}" placeholder="高度"></div></div></div>` : ''}
            <section class="size-picker-section image-quality-section"><div class="size-picker-section-title">图片质量</div><div class="seg-row image-quality-options">
                ${Object.entries(qualityLabels).map(([key, label]) => `<button type="button" class="${key === quality ? 'active' : ''}" data-smart-param="quality" data-smart-value="${escapeHtml(key)}">${escapeHtml(label)}</button>`).join('')}
            </div></section>
            <section class="size-picker-section image-count-section"><div class="size-picker-section-title">输出张数</div><div class="seg-row image-count-options">${countOptions}</div></section>
        </div>
    </div></div>`;
    }

    function renderSizePickerControl(prefix='', includeSource=false, state={}, deps={}){
        const {
            escapeHtml,
            defaultResolution,
            isAutoSizeModel,
            sourceImageRatioLabel,
            apiImageSize
        } = dependencies(deps);
        const ratioKey = prefix ? `${prefix}Ratio` : 'ratio';
        const resolutionKey = prefix ? `${prefix}Resolution` : 'resolution';
        const customRatioKey = prefix ? `${prefix}CustomRatio` : 'customRatio';
        const widthKey = prefix ? `${prefix}CustomWidth` : 'customWidth';
        const heightKey = prefix ? `${prefix}CustomHeight` : 'customHeight';
        const scope = sizePickerScope(prefix, state, deps);
        const resolutionOptions = (!prefix && state.engine === 'api') ? ['auto', '1k', '2k', '4k'] : ['1k', '2k', '4k'];
        const currentResolution = state[resolutionKey] || ((!prefix && state.engine === 'api') ? defaultResolution(state.model) : '1k');
        const currentRatio = state[ratioKey] || 'square';
        const currentCustomRatio = state[customRatioKey] || (currentRatio === 'source' ? sourceImageRatioLabel(prefix) : '');
        const allowAuto = !prefix && state.engine === 'api' && state.apiKind !== 'video' && isAutoSizeModel(state.model);
        const ratios = [
            ['square', '1:1', '正方形'], ['portrait', '2:3', '竖图'], ['landscape', '3:2', '横图'],
            ['portrait43', '3:4', '竖图'], ['landscape43', '4:3', '横图'], ['story', '9:16', '竖屏'],
            ['wide', '16:9', '宽屏'], ['ultrawide', '21:9', '超宽'], ['ultratall', '9:21', '超竖'],
            ...(includeSource ? [['source', '原图', '适配输入']] : [])
        ];
        return `<div class="smart-control size-picker-control click-popover-control ${scope === 'auto' ? 'auto-mode' : ''} ${scope === 'custom' ? 'custom-mode' : ''}">
        <button class="smart-pill size-picker-pill" type="button"><i data-lucide="scan-line"></i><span class="size-picker-label"><span class="size-picker-type">尺寸</span><span class="size-picker-dot"></span><span class="size-picker-value">${escapeHtml(sizePickerLabel(prefix, state, deps))}</span></span></button>
        <div class="smart-popover size-picker-popover">
            <div class="size-picker-head">
                <div class="smart-popover-title">尺寸选择</div>
                <div class="size-picker-scope">
                    <button type="button" class="${scope === 'auto' ? 'active' : ''}" data-size-scope="auto" data-size-prefix="${escapeHtml(prefix)}" ${allowAuto ? '' : 'disabled'}>自动</button>
                    <button type="button" class="${scope === 'preset' ? 'active' : ''}" data-size-scope="preset" data-size-prefix="${escapeHtml(prefix)}">系统参数</button>
                    <button type="button" class="${scope === 'custom' ? 'active' : ''}" data-size-scope="custom" data-size-prefix="${escapeHtml(prefix)}">自定义</button>
                </div>
            </div>
            ${scope === 'auto' ? `<div class="size-picker-pane size-picker-auto"><div class="size-picker-note"><strong>自动尺寸</strong><span>使用模型默认尺寸，或由支持自动尺寸的模型自行决定。</span></div></div>` : ''}
            ${scope === 'preset' ? `<div class="size-picker-pane size-picker-preset">
                <div class="size-picker-list">
                    ${ratios.map(([value, label, description]) => `<button type="button" class="size-picker-option size-ratio-option ${value === currentRatio ? 'active' : ''}" data-smart-param="${ratioKey}" data-smart-value="${escapeHtml(value)}" title="${escapeHtml(`${label} ${description}`)}" aria-label="${escapeHtml(`${label} ${description}`)}"><span class="ratio-icon ${imageRatioIconClass(value)}" aria-hidden="true"></span><span class="size-ratio-label">${escapeHtml(label)}</span></button>`).join('')}
                </div>
                <div class="size-picker-list">
                    ${resolutionOptions.filter(value => value !== 'auto').map(value => `<button type="button" class="size-picker-option ${value === currentResolution ? 'active' : ''}" data-smart-param="${resolutionKey}" data-smart-value="${value}"><span>${value.toUpperCase()}</span><small>${escapeHtml(apiImageSize(currentRatio, value, currentCustomRatio, '') || '')}</small></button>`).join('')}
                </div>
            </div>` : ''}
            ${scope === 'custom' ? `<div class="size-picker-pane size-picker-custom">
                <div class="size-custom-box">
                    <div class="size-custom-title">自定义分辨率</div>
                    <div class="size-custom-row"><input type="number" data-param="${widthKey}" value="${escapeHtml(state[widthKey] || '')}" placeholder="宽度"><span>×</span><input type="number" data-param="${heightKey}" value="${escapeHtml(state[heightKey] || '')}" placeholder="高度"></div>
                </div>
            </div>` : ''}
        </div>
    </div>`;
    }

global.SmartCanvasParameterView = Object.freeze({
        optionHtml,
        renderProviderControl,
        renderModelControl,
        renderVideoProviderControl,
        renderVideoModelControl,
        renderVideoDurationControl,
        renderVideoAspectControl,
        renderVideoResolutionControl,
        renderVideoToggleControl,
        renderVideoTrustedAssetControl,
        renderQualityControl,
        renderImageSizeQualityControl,
        sizePickerScope,
        sizePickerDefaultResolution,
        sizePickerLabel,
        renderSizePickerControl,
    });
})(window);
