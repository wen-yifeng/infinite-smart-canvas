(function(global){
    'use strict';

    const BUILTIN_NODE_TYPES = Object.freeze({
        'smart-image':Object.freeze({
            title:'图片节点',
            accepts:Object.freeze(['smart-image']),
            outputs:Object.freeze(['smart-image']),
            canRun:true,
            defaultWidth:440,
            defaultHeight:440
        }),
        'smart-chat':Object.freeze({
            title:'AI 对话',
            accepts:Object.freeze(['smart-image']),
            outputs:Object.freeze([]),
            canRun:false,
            defaultWidth:420,
            defaultHeight:360
        })
    });

    function nodeTypeKey(node){
        const key = String(node?.type || 'smart-image').trim().toLowerCase();
        return key || 'smart-image';
    }

    function cloneDefinition(definition){
        if(!definition) return null;
        return {
            ...definition,
            accepts:[...(definition.accepts || [])],
            outputs:[...(definition.outputs || [])]
        };
    }

    function create(initial={}){
        const definitions = new Map(Object.entries(BUILTIN_NODE_TYPES).map(([key, value]) => [key, cloneDefinition(value)]));
        const renderers = new Map();
        Object.entries(initial).forEach(([type, renderer]) => {
            const key = String(type || '').trim().toLowerCase();
            if(definitions.has(key) && typeof renderer === 'function') renderers.set(key, renderer);
        });
        const registry = {
            registerType(type, definition={}){
                const key = String(type || '').trim().toLowerCase();
                if(!definitions.has(key)) throw new TypeError(`untrusted node type: ${key || '(empty)'}`);
                definitions.set(key, {...definitions.get(key), ...cloneDefinition(definition)});
                return registry;
            },
            definitionFor(value){
                const key = typeof value === 'string' ? String(value).trim().toLowerCase() : nodeTypeKey(value);
                return cloneDefinition(definitions.get(key));
            },
            canConnect(source, target){
                const sourceType = nodeTypeKey(source);
                const targetType = nodeTypeKey(target);
                const sourceDefinition = definitions.get(sourceType);
                const targetDefinition = definitions.get(targetType);
                if(!sourceDefinition || !targetDefinition) return false;
                return (sourceDefinition.outputs || []).includes(targetType) && (targetDefinition.accepts || []).includes(sourceType);
            },
            register(type, renderer){
                const key = String(type || '').trim().toLowerCase();
                if(!definitions.has(key)) throw new TypeError(`untrusted node type: ${key || '(empty)'}`);
                if(typeof renderer !== 'function') throw new TypeError('renderer must be a function');
                renderers.set(key, renderer);
                return registry;
            },
            keyFor:nodeTypeKey,
            render(node, context={}){
                const key = nodeTypeKey(node);
                const renderer = definitions.has(key) ? renderers.get(key) : null;
                if(typeof renderer !== 'function') return '';
                return renderer(node, context);
            },
            has(type){
                const key = String(type || '').trim().toLowerCase();
                return definitions.has(key) && renderers.has(key);
            }
        };
        return Object.freeze(registry);
    }

    global.SmartCanvasNodeRendererRegistry = Object.freeze({
        nodeTypeKey,
        definitionFor(type){ return cloneDefinition(BUILTIN_NODE_TYPES[String(type || '').trim().toLowerCase()]); },
        create
    });
})(window);
