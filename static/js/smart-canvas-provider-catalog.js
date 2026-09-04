(function(root){
    'use strict';

    const SPECIAL_PROVIDER_IDS = Object.freeze(['modelscope', 'volcengine']);

    function list(value){ return Array.isArray(value) ? value : []; }
    function enabled(provider){ return provider && provider.enabled !== false; }
    function uniqueModels(value, fallback=[]){
        const source = Array.isArray(value) ? value : list(fallback);
        return [...new Set(source)];
    }
    function providersWithModels(providers, field, excludedIds=[]){
        const excluded = new Set(excludedIds);
        return list(providers).filter(provider => enabled(provider) && !excluded.has(provider.id) && list(provider[field]).length);
    }
    function providerById(providers, providerId, fallback=null){
        return list(providers).find(provider => provider?.id === providerId) || fallback;
    }
    function imageProviders(providers){
        return providersWithModels(providers, 'image_models', SPECIAL_PROVIDER_IDS);
    }
function videoProviders(providers, defaultVideoModels=[]){
        const configured = providersWithModels(providers, 'video_models', SPECIAL_PROVIDER_IDS);
        return configured.length ? configured : [{id:'comfly', name:'Comfly', video_models:list(defaultVideoModels), enabled:true}];
    }
    function volcengineProvider(providers, defaultVideoModels=[]){
        return providerById(providers, 'volcengine', {
            id:'volcengine',
            name:'火山引擎',
            image_models:[],
            video_models:list(defaultVideoModels),
            enabled:true,
        });
    }
    function modelscopeProvider(providers){
        return providerById(providers, 'modelscope', null);
    }
    function modelscopeImageModels(providers, fallback=['Tongyi-MAI/Z-Image-Turbo']){
        const provider = modelscopeProvider(providers);
        return Array.isArray(provider?.image_models) ? provider.image_models : list(fallback);
    }

    function imageModels(providers, providerId){
        if(providerId === 'volcengine') return list(volcengineProvider(providers).image_models);
        return list(providerById(providers, providerId)?.image_models);
    }
    function videoModels(providers, providerId, defaultVideoModels=[]){
        if(providerId === 'volcengine') return uniqueModels(volcengineProvider(providers, defaultVideoModels).video_models, defaultVideoModels);
        return uniqueModels(providerById(providers, providerId)?.video_models, defaultVideoModels);
    }
    function volcengineVideoModels(providers, defaultVideoModels=[]){
        return uniqueModels(providerById(providers, 'volcengine')?.video_models, defaultVideoModels);
    }
    function findVideoProvider(providers, providerId, defaultVideoModels=[]){
        const providersList = videoProviders(providers, defaultVideoModels);
        return providerId === 'volcengine'
            ? volcengineProvider(providers, defaultVideoModels)
            : providerById(providersList, providerId, providersList[0] || null);
    }
    function findImageProvider(providers, providerId){
        return providerId === 'volcengine'
            ? volcengineProvider(providers)
            : providerById(providers, providerId, imageProviders(providers)[0] || null);
    }
function providerPlatform(providers, providerId){
        const provider = providerById(providers, providerId, null);
        const protocol = String(provider?.protocol || '').toLowerCase();
        const base = String(provider?.base_url || '').toLowerCase();
        if(protocol === 'apimart' || base.includes('apimart.ai')) return 'apimart';
        if(protocol === 'volcengine' || providerId === 'volcengine') return 'volcengine';
        return '';
    }

    root.SmartCanvasProviderCatalog = Object.freeze({
        imageProviders,
        videoProviders,
        volcengineProvider,
        modelscopeProvider,
        modelscopeImageModels,
        imageModels,
        videoModels,
        volcengineVideoModels,
        findImageProvider,
        findVideoProvider,
        providerPlatform,
        uniqueModels,
    });
})(typeof window !== 'undefined' ? window : globalThis);

