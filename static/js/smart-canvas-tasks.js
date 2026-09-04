/*
 * Provider-agnostic task lifecycle for Smart Canvas.
 *
 * The legacy editor still owns node rendering and provider-specific result
 * mapping. This controller owns only the reusable boundaries around those
 * concerns: status normalization, idempotent client submission, one poller per
 * task, event wake-ups, finite retry/backoff, cancellation and task snapshots.
 */
(function attachSmartCanvasTasks(global){
    const STATUS_ALIASES = Object.freeze({
        pending:'queued', waiting:'queued', created:'queued', accepted:'queued',
        processing:'running', in_progress:'running', inprogress:'running', started:'running',
        success:'succeeded', successful:'succeeded', complete:'succeeded', completed:'succeeded', done:'succeeded',
        error:'failed', failure:'failed',
        canceled:'cancelled', abort:'cancelled', aborted:'cancelled',
        expired:'stale', restart_interrupted:'interrupted'
    });
    const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'stale', 'interrupted']);

    function normalizeTaskStatus(value){
        const raw = String(value || 'queued').trim().toLowerCase().replace(/[\s-]+/g, '_');
        return STATUS_ALIASES[raw] || raw || 'queued';
    }

    function isTerminalTaskStatus(value){
        return TERMINAL_STATUSES.has(normalizeTaskStatus(value));
    }

    class SmartCanvasTaskTerminalError extends Error {
        constructor(task, message=''){
            const status = normalizeTaskStatus(task?.status);
            super(message || task?.error || task?.message || `Task ended with status: ${status}`);
            this.name = 'SmartCanvasTaskTerminalError';
            this.code = `task_${status}`;
            this.status = status;
            this.task = task || {};
            this.terminal = true;
        }
    }

    class SmartCanvasTaskStoppedError extends Error {
        constructor(reason='stopped'){
            super(reason === 'context-changed' ? 'Task polling stopped because the canvas changed.' : 'Task polling stopped.');
            this.name = 'SmartCanvasTaskStoppedError';
            this.code = 'task_stopped';
            this.reason = reason;
            this.stopped = true;
        }
    }

    class SmartCanvasTaskTimeoutError extends Error {
        constructor(taskId, attempts){
            super(`Task polling timed out: ${taskId}`);
            this.name = 'SmartCanvasTaskTimeoutError';
            this.code = 'task_timeout';
            this.taskId = taskId;
            this.attempts = attempts;
        }
    }

    class SmartCanvasTaskController {
        constructor(options={}){
            this.events = options.events instanceof Map ? options.events : new Map();
            this.activePolls = options.activePolls instanceof Map ? options.activePolls : new Map();
            this.taskCache = options.taskCache instanceof Map ? options.taskCache : new Map();
            this.states = options.states instanceof Map ? options.states : new Map();
            this.creationCache = new Map();
            this.waiters = new Map();
            this.controllers = new Map();
            this.listeners = new Set();
            this.context = String(options.context || '');
            this.closed = false;
            this.maxEvents = Math.max(20, Number(options.maxEvents) || 500);
            this.maxTaskCache = Math.max(20, Number(options.maxTaskCache) || 500);
            this.maxCreationEntries = Math.max(10, Number(options.maxCreationEntries) || 200);
            this.defaultPollInterval = Math.max(0, Number(options.pollInterval) || 2000);
            this.defaultMaxAttempts = Math.max(1, Number(options.maxAttempts) || 900);
            this.defaultMaxConsecutiveErrors = Math.max(0, Number(options.maxConsecutiveErrors) || 4);
            this.defaultBackoffBase = Math.max(0, Number(options.backoffBase) || 500);
            this.defaultBackoffMax = Math.max(this.defaultBackoffBase, Number(options.backoffMax) || 5000);
            this.now = typeof options.now === 'function' ? options.now : () => Date.now();
            this.timerSet = typeof options.setTimeout === 'function' ? options.setTimeout : (...args) => setTimeout(...args);
            this.timerClear = typeof options.clearTimeout === 'function' ? options.clearTimeout : timer => clearTimeout(timer);
            this.onStateChange = typeof options.onStateChange === 'function' ? options.onStateChange : null;
        }

        subscribe(listener){
            if(typeof listener !== 'function') return () => {};
            this.listeners.add(listener);
            return () => this.listeners.delete(listener);
        }

        emit(event){
            const payload = {...event, summary:this.getSummary()};
            if(this.onStateChange){
                try { this.onStateChange(payload, this); } catch(_) {}
            }
            this.listeners.forEach(listener => {
                try { listener(payload, this); } catch(error) { this.timerSet(() => { throw error; }, 0); }
            });
            return payload;
        }

        setContext(context){
            const next = String(context || '');
            if(next !== this.context && this.activePolls.size) this.stopAll('context-changed');
            this.context = next;
            this.closed = false;
            this.emit({type:'context', context:next});
            return next;
        }

        generateRunKey(prefix='run'){
            const random = global.crypto?.randomUUID
                ? global.crypto.randomUUID()
                : `${this.now()}_${Math.random().toString(36).slice(2)}`;
            return `${prefix}_${random}`.replace(/[^A-Za-z0-9:_-]/g, '').slice(0, 160);
        }

        idempotencyKey(base, index=0){
            const value = String(base || this.generateRunKey('task'));
            return `${value}:${Math.max(0, Number(index) || 0)}`.slice(0, 200);
        }

        createOnce(key, create){
            if(typeof create !== 'function') return Promise.reject(new TypeError('create must be a function'));
            const normalizedKey = String(key || '').trim();
            if(!normalizedKey) return Promise.resolve().then(create);
            const existing = this.creationCache.get(normalizedKey);
            if(existing) return existing.promise;
            const entry = {createdAt:this.now(), promise:null, value:undefined};
            entry.promise = Promise.resolve().then(create).then(value => {
                entry.value = value;
                entry.promise = Promise.resolve(value);
                this.creationCache.delete(normalizedKey);
                this.creationCache.set(normalizedKey, entry);
                this.pruneCreationCache();
                this.emit({type:'create-succeeded', key:normalizedKey, value});
                return value;
            }, error => {
                this.creationCache.delete(normalizedKey);
                this.emit({type:'create-failed', key:normalizedKey, error});
                throw error;
            });
            this.creationCache.set(normalizedKey, entry);
            this.pruneCreationCache();
            this.emit({type:'create-started', key:normalizedKey});
            return entry.promise;
        }

        pruneCreationCache(){
            while(this.creationCache.size > this.maxCreationEntries){
                const oldest = this.creationCache.keys().next().value;
                this.creationCache.delete(oldest);
            }
        }

        normalizeTask(task={}){
            const snapshot = task && typeof task === 'object' ? {...task} : {};
            snapshot.id = String(snapshot.id || snapshot.task_id || '');
            snapshot.status = normalizeTaskStatus(snapshot.status);
            return snapshot;
        }

        updatedAt(task){
            return Number(task?.updated_at || task?.updatedAt || 0) || 0;
        }

        cacheTask(task, {full=false, source='poll'}={}){
            const snapshot = this.normalizeTask(task);
            const taskId = snapshot.id;
            if(!taskId) return snapshot;
            const previous = this.taskCache.get(taskId);
            if(previous && this.updatedAt(previous.task) > this.updatedAt(snapshot)) return previous.task;
            this.taskCache.delete(taskId);
            this.taskCache.set(taskId, {task:snapshot, full:Boolean(full), source, cachedAt:this.now()});
            while(this.taskCache.size > this.maxTaskCache){
                const oldest = this.taskCache.keys().next().value;
                if(this.activePolls.has(oldest)) break;
                this.taskCache.delete(oldest);
            }
            return snapshot;
        }

        notifyEvent(task={}){
            const snapshot = this.normalizeTask(task);
            const taskId = snapshot.id;
            if(!taskId) return false;
            const previous = this.events.get(taskId);
            if(previous && this.updatedAt(previous) > this.updatedAt(snapshot)) return false;
            this.events.delete(taskId);
            this.events.set(taskId, snapshot);
            this.cacheTask(snapshot, {full:false, source:'event'});
            while(this.events.size > this.maxEvents){
                const oldest = this.events.keys().next().value;
                if(oldest === taskId || this.waiters.has(oldest)) break;
                this.events.delete(oldest);
            }
            const waiters = this.waiters.get(taskId);
            if(waiters){
                this.waiters.delete(taskId);
                [...waiters].forEach(finish => finish(snapshot));
            }
            this.updateState(taskId, {status:snapshot.status, updatedAt:this.now(), source:'event'});
            this.emit({type:'task-event', task:snapshot});
            return true;
        }

        waitForEvent(taskId, afterUpdatedAt=0, timeout=this.defaultPollInterval, signal=null){
            const id = String(taskId || '');
            if(!id) return this.delay(timeout, signal).then(() => null);
            const cached = this.events.get(id);
            if(cached && this.updatedAt(cached) > Number(afterUpdatedAt || 0)) return Promise.resolve(cached);
            if(signal?.aborted) return Promise.reject(new SmartCanvasTaskStoppedError(signal.reason || 'stopped'));
            return new Promise((resolve, reject) => {
                const waiters = this.waiters.get(id) || new Set();
                let settled = false;
                let timer = null;
                let onAbort = () => {};
                const finish = value => {
                    if(settled) return;
                    settled = true;
                    if(timer !== null) this.timerClear(timer);
                    waiters.delete(finish);
                    if(!waiters.size) this.waiters.delete(id);
                    if(signal) signal.removeEventListener?.('abort', onAbort);
                    resolve(value || null);
                };
                onAbort = () => {
                    if(settled) return;
                    settled = true;
                    if(timer !== null) this.timerClear(timer);
                    waiters.delete(finish);
                    if(!waiters.size) this.waiters.delete(id);
                    signal?.removeEventListener?.('abort', onAbort);
                    reject(new SmartCanvasTaskStoppedError(signal?.reason || 'stopped'));
                };
                waiters.add(finish);
                this.waiters.set(id, waiters);
                timer = this.timerSet(() => finish(null), Math.max(0, Number(timeout) || 0));
                signal?.addEventListener?.('abort', onAbort, {once:true});
            });
        }

        delay(ms, signal=null){
            if(signal?.aborted) return Promise.reject(new SmartCanvasTaskStoppedError(signal.reason || 'stopped'));
            return new Promise((resolve, reject) => {
                let settled = false;
                let timer = null;
                let onAbort = () => {};
                const finish = () => {
                    if(settled) return;
                    settled = true;
                    if(timer !== null) this.timerClear(timer);
                    signal?.removeEventListener?.('abort', onAbort);
                    resolve();
                };
                onAbort = () => {
                    if(settled) return;
                    settled = true;
                    if(timer !== null) this.timerClear(timer);
                    signal?.removeEventListener?.('abort', onAbort);
                    reject(new SmartCanvasTaskStoppedError(signal?.reason || 'stopped'));
                };
                timer = this.timerSet(finish, Math.max(0, Number(ms) || 0));
                signal?.addEventListener?.('abort', onAbort, {once:true});
            });
        }

        updateState(taskId, changes={}){
            const id = String(taskId || '');
            if(!id) return {};
            const previous = this.states.get(id) || {taskId:id, phase:'idle', status:'queued', attempts:0, consecutiveErrors:0, startedAt:0, updatedAt:0};
            const next = {...previous, ...changes, taskId:id};
            if(changes.status !== undefined) next.status = normalizeTaskStatus(changes.status);
            this.states.set(id, next);
            return next;
        }

        getTaskState(taskId){
            const state = this.states.get(String(taskId || ''));
            return state ? {...state} : null;
        }

        getSummary(){
            const states = [...this.states.values()];
            const active = states.filter(state => ['starting', 'polling', 'waiting', 'backoff'].includes(state.phase));
            const latest = states.slice().sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))[0] || null;
            return {
                context:this.context,
                activeCount:this.activePolls.size,
                activeTaskIds:[...this.activePolls.keys()],
                statuses:active.reduce((counts, state) => {
                    const status = normalizeTaskStatus(state.status);
                    counts[status] = (counts[status] || 0) + 1;
                    return counts;
                }, {}),
                latest:latest ? {...latest} : null
            };
        }

        defaultDecision(task){
            const status = normalizeTaskStatus(task?.status);
            if(status === 'succeeded') return {done:true, value:task?.result ?? task};
            if(TERMINAL_STATUSES.has(status)) throw new SmartCanvasTaskTerminalError(task);
            return {done:false};
        }

        async settleCached(taskId, options={}){
            const cached = this.taskCache.get(taskId);
            if(!cached || !cached.full || !isTerminalTaskStatus(cached.task?.status)) return {hit:false, value:undefined};
            const decision = await (typeof options.classify === 'function' ? options.classify(cached.task) : this.defaultDecision(cached.task));
            return {hit:Boolean(decision?.done), value:decision?.value};
        }

        poll(taskId, options={}){
            const id = String(taskId || '').trim();
            if(!id) return Promise.reject(new Error('Task id is required'));
            if(this.closed) return Promise.reject(new SmartCanvasTaskStoppedError('destroyed'));
            if(this.activePolls.has(id)) return this.activePolls.get(id);
            const controller = typeof AbortController === 'function' ? new AbortController() : null;
            if(controller) this.controllers.set(id, controller);
            let settledError = null;
            const work = (async () => {
                const cached = await this.settleCached(id, options);
                if(cached.hit) return cached.value;
                return this.runPoll(id, options, controller?.signal || null);
            })();
            const promise = work.catch(error => {
                settledError = error;
                const current = this.states.get(id) || {};
                const stopped = Boolean(error?.stopped || error?.code === 'task_stopped');
                const timedOut = Boolean(error?.timeout || error?.code === 'task_timeout');
                const currentStatus = normalizeTaskStatus(current.status);
                const status = stopped
                    ? 'interrupted'
                    : timedOut
                        ? 'stale'
                        : (TERMINAL_STATUSES.has(currentStatus) ? currentStatus : 'failed');
                this.updateState(id, {
                    phase:'terminal',
                    status,
                    lastError:String(error?.message || error || ''),
                    error,
                    updatedAt:this.now()
                });
                throw error;
            }).finally(() => {
                if(this.activePolls.get(id) === promise) this.activePolls.delete(id);
                this.controllers.delete(id);
                const current = this.states.get(id) || {};
                const state = this.updateState(id, {phase:'settled', updatedAt:this.now(), finishedAt:this.now(), status:current.status});
                this.emit({type:'poll-settled', taskId:id, state:{...state}, task:state.task || null, result:state.result, error:settledError || state.error || null});
            });
            this.activePolls.set(id, promise);
            this.updateState(id, {phase:'starting', status:'queued', attempts:0, consecutiveErrors:0, startedAt:this.now(), updatedAt:this.now(), scope:String(options.scope || '')});
            this.emit({type:'poll-started', taskId:id});
            return promise;
        }

        async runPoll(taskId, options, signal){
            const fetchTask = options.fetchTask;
            if(typeof fetchTask !== 'function') throw new TypeError('fetchTask must be provided');
            const classify = typeof options.classify === 'function' ? options.classify : task => this.defaultDecision(task);
            const pollInterval = Math.max(0, Number(options.pollInterval ?? this.defaultPollInterval) || 0);
            const maxAttempts = Math.max(1, Number(options.maxAttempts ?? this.defaultMaxAttempts) || 1);
            const maxConsecutiveErrors = Math.max(0, Number(options.maxConsecutiveErrors ?? this.defaultMaxConsecutiveErrors) || 0);
            const backoffBase = Math.max(0, Number(options.backoffBase ?? this.defaultBackoffBase) || 0);
            const backoffMax = Math.max(backoffBase, Number(options.backoffMax ?? this.defaultBackoffMax) || backoffBase);
            let lastUpdatedAt = 0;
            let consecutiveErrors = 0;
            for(let attempt = 1; attempt <= maxAttempts; attempt += 1){
                if(signal?.aborted) throw new SmartCanvasTaskStoppedError(signal.reason || 'stopped');
                this.updateState(taskId, {phase:'polling', attempts:attempt, consecutiveErrors, updatedAt:this.now()});
                this.emit({type:'poll-attempt', taskId, attempt});
                let task;
                try {
                    task = this.normalizeTask(await fetchTask(taskId, {signal, attempt, lastUpdatedAt}));
                    if(!task.id) task.id = taskId;
                    task = this.cacheTask(task, {full:true, source:'poll'});
                    lastUpdatedAt = this.updatedAt(task) || lastUpdatedAt;
                    consecutiveErrors = 0;
                    this.updateState(taskId, {status:task.status, phase:'polling', consecutiveErrors:0, lastError:'', error:null, updatedAt:this.now(), task});
                    this.emit({type:'task-updated', taskId, task, attempt});
                } catch(error){
                    if(error?.stopped || signal?.aborted) throw error?.stopped ? error : new SmartCanvasTaskStoppedError(signal?.reason || 'stopped');
                    consecutiveErrors += 1;
                    this.updateState(taskId, {phase:'backoff', consecutiveErrors, lastError:String(error?.message || error), updatedAt:this.now()});
                    this.emit({type:'poll-error', taskId, attempt, consecutiveErrors, error});
                    if(consecutiveErrors > maxConsecutiveErrors) throw error;
                    const delay = Math.min(backoffMax, backoffBase * Math.pow(2, Math.max(0, consecutiveErrors - 1)));
                    await this.delay(delay, signal);
                    continue;
                }
                const decision = await classify(task, {taskId, attempt, signal, controller:this});
                if(decision?.done){
                    this.updateState(taskId, {phase:'terminal', status:task.status, result:decision.value, lastError:'', error:null, updatedAt:this.now()});
                    this.emit({type:'task-terminal', taskId, task, result:decision.value});
                    return decision.value;
                }
                if(attempt >= maxAttempts) break;
                this.updateState(taskId, {phase:'waiting', status:task.status, updatedAt:this.now()});
                this.emit({type:'poll-waiting', taskId, task, attempt});
                await this.waitForEvent(taskId, lastUpdatedAt, pollInterval, signal);
            }
            const error = new SmartCanvasTaskTimeoutError(taskId, maxAttempts);
            this.updateState(taskId, {phase:'terminal', status:'stale', lastError:error.message, updatedAt:this.now()});
            this.emit({type:'task-timeout', taskId, error});
            throw error;
        }

        stop(taskId, reason='stopped'){
            const id = String(taskId || '');
            const controller = this.controllers.get(id);
            if(!controller) return false;
            try { controller.abort(reason); } catch(_) { controller.abort(); }
            this.updateState(id, {phase:'stopping', updatedAt:this.now(), stopReason:reason});
            this.emit({type:'poll-stopping', taskId:id, reason});
            return true;
        }

        stopAll(reason='stopped'){
            const ids = [...this.controllers.keys()];
            ids.forEach(taskId => this.stop(taskId, reason));
            return ids.length;
        }

        destroy(reason='destroyed'){
            this.closed = true;
            const count = this.stopAll(reason);
            this.waiters.forEach(waiters => [...waiters].forEach(finish => finish(null)));
            this.waiters.clear();
            this.emit({type:'destroyed', reason, count});
            return count;
        }
    }

    global.SmartCanvasTaskController = SmartCanvasTaskController;
    global.SmartCanvasTaskTerminalError = SmartCanvasTaskTerminalError;
    global.SmartCanvasTaskStoppedError = SmartCanvasTaskStoppedError;
    global.SmartCanvasTaskTimeoutError = SmartCanvasTaskTimeoutError;
    global.normalizeSmartCanvasTaskStatus = normalizeTaskStatus;
    global.isSmartCanvasTaskTerminal = isTerminalTaskStatus;
})(typeof window !== 'undefined' ? window : globalThis);
