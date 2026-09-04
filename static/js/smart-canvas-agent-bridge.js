(function(global){
    'use strict';

    const API_ROOT = '/api/smart-canvas-agent';
    const CLIENT_KEY = 'smartCanvasAgentClientId.v1';
    const HEARTBEAT_MS = 4000;
    // 页面隐藏时仍需保活会话（Agent direct 写入依赖 revision 快照），但降频到 30s
    const HEARTBEAT_HIDDEN_MS = 30000;
    const POLL_FAST_MS = 1000;
    const POLL_IDLE_MS = 4000;
    let heartbeatTimer = 0;
    let pollTimer = 0;
    let pollDelay = POLL_FAST_MS;
    let pollBusy = false;
    let lastHeartbeatAt = 0;
    let lastStatusKey = '';
    let connected = false;

    function clientId(){
        let value = '';
        try { value = sessionStorage.getItem(CLIENT_KEY) || ''; } catch(error) {}
        if(value) return value;
        value = global.crypto?.randomUUID?.() || `smart-canvas-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        try { sessionStorage.setItem(CLIENT_KEY, value); } catch(error) {}
        return value;
    }

    async function request(path, options={}){
        const response = await fetch(`${API_ROOT}${path}`, {
            ...options,
            headers:{'Content-Type':'application/json', ...(options.headers || {})}
        });
        const data = await response.json().catch(() => ({}));
        if(!response.ok){
            const detail = data?.detail;
            throw new Error(typeof detail === 'string' ? detail : (detail?.message || `HTTP ${response.status}`));
        }
        return data;
    }

    function setStatus(state, label, detail=''){
        const key = `${state}|${label}|${detail}`;
        if(key === lastStatusKey) return;
        lastStatusKey = key;
        const button = document.getElementById('smartAgentStatus');
        const text = document.getElementById('smartAgentStatusText');
        if(!button || !text) return;
        button.classList.toggle('is-connected', state === 'connected');
        button.classList.toggle('is-pending', state === 'pending');
        button.classList.toggle('is-error', state === 'error');
        text.textContent = label;
        const accessible = detail ? `${label}：${detail}` : label;
        button.setAttribute('aria-label', accessible);
        button.dataset.agentState = state;
    }

    async function heartbeat(){
        if(document.hidden && Date.now() - lastHeartbeatAt < HEARTBEAT_HIDDEN_MS) return;
        lastHeartbeatAt = Date.now();
        const snapshot = global.SmartCanvasRuntime?.getSessionSnapshot?.();
        if(!snapshot?.canvas_id) return;
        try {
            await request('/session/heartbeat', {
                method:'POST',
                body:JSON.stringify({
                    client_id:clientId(),
                    canvas_id:snapshot.canvas_id,
                    selection:snapshot.selection || {},
                    page_url:location.href,
                    visible:document.visibilityState === 'visible'
                })
            });
            connected = true;
            setStatus('connected', 'Agent 已连接', `revision ${snapshot.revision || 0}`);
        } catch(error){
            connected = false;
            setStatus('error', 'Agent 连接失败', String(error?.message || error));
        }
    }

    function operationSummary(ops){
        const labels = {
            add_node:'新增节点', update_node:'更新节点', delete_node:'删除节点',
            move_nodes:'移动节点', connect_nodes:'连接节点', delete_connections:'删除连线',
            set_viewport:'设置视图'
        };
        const counts = new Map();
        (Array.isArray(ops) ? ops : []).forEach(op => {
            const type = String(op?.type || 'unknown');
            counts.set(type, (counts.get(type) || 0) + 1);
        });
        return Array.from(counts.entries()).map(([type, count]) => `${labels[type] || type} × ${count}`).join('\n');
    }

    async function resolve(requestId, approved){
        return request(`/requests/${encodeURIComponent(requestId)}/resolve`, {
            method:'POST',
            body:JSON.stringify({client_id:clientId(), approved:Boolean(approved)})
        });
    }

    function stageSummary(nodes){
        const items = Array.isArray(nodes) ? nodes : [];
        const referenceCount = items.reduce((sum, item) => sum + (Array.isArray(item?.references) ? item.references.length : 0), 0);
        const localCount = items.reduce((sum, item) => sum + (Array.isArray(item?.references) ? item.references.filter(ref => ref?.kind === 'local').length : 0), 0);
        const titles = items.slice(0, 6).map((item, index) => String(item?.node_title || `图生图节点 ${index + 1}`));
        const more = items.length > titles.length ? `\n另有 ${items.length - titles.length} 个节点` : '';
        return `暂存图生图节点 × ${items.length}\n参考素材 × ${referenceCount}（本地导入 ${localCount}）\n${titles.join('\n')}${more}`;
    }

    async function finishResolved(result){
        if(result?.request?.status === 'completed'){
            const revision = result.request.result?.revision || '';
            const staged = result.request.result?.staged_node_count;
            const detail = staged ? `${staged} 个节点，revision ${revision}` : `revision ${revision}`;
            setStatus('connected', 'Agent 已完成', detail);
            await global.SmartCanvasRuntime?.reloadCanvas?.();
        } else if(result?.request?.status === 'rejected'){
            setStatus('connected', 'Agent 已拒绝');
        } else if(result?.request?.status === 'failed'){
            setStatus('error', 'Agent 操作失败', result.request.error || 'revision 冲突或数据无效');
        }
    }

    async function processAgentRequest(agentRequest){
        if(agentRequest.kind === 'focus_nodes'){
            const ids = Array.isArray(agentRequest.payload?.node_ids) ? agentRequest.payload.node_ids : [];
            global.SmartCanvasRuntime?.focusNodes?.(ids);
            await resolve(agentRequest.id, true);
            return;
        }
        if(agentRequest.kind === 'stage_image_prompt'){
            const nodes = Array.isArray(agentRequest.payload?.nodes) ? agentRequest.payload.nodes : [];
            setStatus('pending', 'Agent 正在暂存', `${nodes.length} 个图生图节点，不执行生成`);
            await finishResolved(await resolve(agentRequest.id, true));
            return;
        }
        if(agentRequest.kind === 'apply_ops'){
            const ops = Array.isArray(agentRequest.payload?.ops) ? agentRequest.payload.ops : [];
            setStatus('pending', 'Agent 正在执行', `${ops.length} 个原子操作`);
            await finishResolved(await resolve(agentRequest.id, true));
            return;
        }
        await resolve(agentRequest.id, false);
    }

    async function pollPending(){
        if(pollBusy || !connected || document.visibilityState !== 'visible') return;
        pollBusy = true;
        try {
            const data = await request(`/requests/pending?client_id=${encodeURIComponent(clientId())}`);
            const pending = Array.isArray(data.requests) ? data.requests : [];
            pollDelay = pending.length ? POLL_FAST_MS : POLL_IDLE_MS;
            for(const agentRequest of pending){
                await processAgentRequest(agentRequest);
            }
            if(!pending.length){
                const snapshot = global.SmartCanvasRuntime?.getSessionSnapshot?.();
                setStatus('connected', 'Agent 已连接', `revision ${snapshot?.revision || 0}`);
            }
        } catch(error){
            connected = false;
            pollDelay = POLL_FAST_MS;
            setStatus('error', 'Agent 连接失败', String(error?.message || error));
        } finally {
            pollBusy = false;
        }
    }

    function schedulePoll(delay){
        clearTimeout(pollTimer);
        pollTimer = setTimeout(async () => {
            await pollPending();
            schedulePoll(pollDelay);
        }, Math.max(0, Number(delay) || 0));
    }

    function closeSession(){
        const body = JSON.stringify({client_id:clientId()});
        try {
            fetch(`${API_ROOT}/session/close`, {
                method:'POST',
                headers:{'Content-Type':'application/json'},
                body,
                keepalive:true
            });
        } catch(error) {}
    }

    function start(){
        clearInterval(heartbeatTimer);
        clearTimeout(pollTimer);
        heartbeat();
        heartbeatTimer = global.setInterval(heartbeat, HEARTBEAT_MS);
        schedulePoll(0);
        document.addEventListener('visibilitychange', () => {
            if(document.visibilityState !== 'visible') return;
            heartbeat();
            pollPending();
            schedulePoll(POLL_FAST_MS);
        });
        global.addEventListener('focus', heartbeat);
        global.addEventListener('pagehide', closeSession);
        global.addEventListener('beforeunload', closeSession);
    }

    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
    else start();
})(window);
