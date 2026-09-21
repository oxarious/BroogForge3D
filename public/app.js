(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const active = job => ['queued', 'running'].includes(job.status);
  const state = { engines: [], jobs: [], selected: null, file: null, preview: null, enginesReady: false, submitting: false, stopped: false, polling: false, timer: null, modelUrl: '', modelReady: false, pending: new Set(), view: 'studio' };
  const icons = () => window.lucide?.createIcons();
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
  const selectedJob = () => state.jobs.find(job => String(job.id) === state.selected);
  const selectedEngine = () => state.engines.find(engine => String(engine.id) === $('engine-select').value);
  const engineName = id => state.engines.find(engine => String(engine.id) === String(id))?.name || String(id || 'Unknown engine');
  const jobSettings = job => job.kind === 'mesh' ? `${job.profile || 'Rig'} / GLB` : `${job.resolution} / Seed ${job.seed}`;
  const date = value => { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? 'Date unavailable' : parsed.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };
  const safeUrl = value => { try { if (!value) return ''; const url = new URL(value, location.href); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } };
  const downloadUrl = job => { const url = new URL(safeUrl(job.outputUrl)); url.searchParams.set('download', '1'); return url.href; };
  const assetJobs = () => state.jobs.filter(job => job.status === 'complete' && safeUrl(job.outputUrl));
  function notice(message) { $('notice-text').textContent = message; $('notice').hidden = false; }
  async function api(path, options = {}) {
    const response = await fetch(path, { ...options, signal: AbortSignal.timeout(15000), cache: 'no-store' });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { if (response.ok) throw new Error('The local server returned an invalid response.'); }
    if (!response.ok) throw new Error(data?.error || data?.message || `Request failed (${response.status}).`);
    return data;
  }
  function switchView(view) {
    if (!['studio', 'library', 'engines', 'process', 'textures'].includes(view)) view = 'studio';
    state.view = view;
    document.querySelectorAll('[data-view]').forEach(button => { const chosen = button.dataset.view === view; button.classList.toggle('active', chosen); if (chosen) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
    document.querySelectorAll('.view').forEach(section => { section.hidden = section.id !== `${view}-view`; });
    const title = view[0].toUpperCase() + view.slice(1);
    $('breadcrumb-view').textContent = title;
    document.title = `BroogForge | ${title}`;
    if (location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`);
    document.dispatchEvent(new CustomEvent('broog:view', { detail: view }));
  }
  function updateControls() {
    const engine = selectedEngine();
    $('generate').disabled = state.stopped || state.submitting || !state.file || !state.enginesReady || !engine?.installed || !$('resolution').value;
    $('cancel-selected').disabled = !selectedJob() || !active(selectedJob()) || state.pending.has(state.selected) || state.stopped;
    $('engine-select').disabled = !state.enginesReady || !state.engines.length || state.submitting || state.stopped;
    $('resolution').disabled = !state.enginesReady || !engine?.installed || !$('resolution').options.length || state.submitting || state.stopped;
    $('image-input').disabled = state.submitting || state.stopped;
    $('clear-image').disabled = state.submitting || state.stopped;
    $('seed').disabled = state.submitting || state.stopped;
    $('random-seed').disabled = state.submitting || state.stopped;
    $('generate').querySelector('span').textContent = state.submitting ? 'Submitting...' : 'Generate asset';
  }
  function engineSettings() {
    const engine = selectedEngine();
    const previous = $('resolution').value;
    const resolutions = (engine?.resolutions || []).map(Number).filter(value => [512, 1024].includes(value));
    $('resolution').innerHTML = [...new Set(resolutions)].sort().map(value => `<option value="${value}">${value}</option>`).join('');
    $('resolution').value = resolutions.includes(Number(previous)) ? previous : resolutions.includes(512) ? '512' : String(resolutions[0] || '');
    $('engine-note').textContent = !engine ? 'No engines reported by the local server.' : !engine.installed ? engine.reason || 'This engine is not installed.' : !resolutions.length ? 'No supported resolution is available.' : engine.description || 'Installed locally.';
    $('resolution-warning').hidden = $('resolution').value !== '1024';
    updateControls();
  }
  function renderEngines() {
    const previous = $('engine-select').value;
    const generators = state.engines.filter(engine => engine.kind !== 'mesh');
    $('engine-select').innerHTML = generators.length ? generators.map(engine => `<option value="${escape(engine.id)}" ${engine.installed ? '' : 'disabled'}>${escape(engine.name)}${engine.installed ? '' : ' (unavailable)'}</option>`).join('') : '<option value="">No engines available</option>';
    const choice = generators.find(engine => String(engine.id) === previous && engine.installed) || generators.find(engine => engine.installed);
    $('engine-select').value = choice ? String(choice.id) : '';
    const installed = state.engines.filter(engine => engine.installed).length;
    $('engine-count').textContent = installed;
    $('engines-summary').textContent = `${installed} / ${state.engines.length} installed`;
    $('engine-list').innerHTML = state.engines.length ? state.engines.map(engine => `<article class="engine-row"><div class="engine-icon">${icon('cpu')}</div><div class="engine-copy"><h2>${escape(engine.name)}</h2><p>${escape(engine.description || 'No description supplied.')}</p>${!engine.installed ? `<p class="engine-reason">${escape(engine.reason || 'Not installed.')}</p>` : ''}<span class="engine-resolutions">${escape((engine.resolutions || []).join(' / ') || 'No resolutions reported')}</span></div><div class="engine-actions"><span class="badge ${engine.installed ? 'complete' : 'failed'}">${engine.installed ? 'Installed' : 'Unavailable'}</span><button class="button secondary" data-use-engine="${escape(engine.id)}" ${engine.installed && !state.stopped ? '' : 'disabled'}>${icon('arrow-up-right')}Use engine</button></div></article>`).join('') : '<div class="library-empty"><h2>No engines available</h2><p>The local server has not reported any engines.</p></div>';
    engineSettings();
    const processChoice = $('process-engine').value;
    $('process-engine').innerHTML = state.engines.filter(e => e.kind === 'mesh').map(e => `<option value="${escape(e.id)}" ${e.installed ? '' : 'disabled'}>${escape(e.name)}${e.installed ? '' : ' (unavailable)'}</option>`).join('');
    if (state.engines.some(e => e.id === processChoice && e.installed)) $('process-engine').value = processChoice;
    renderProcess();
  }
  function renderSystem(system) {
    state.system = system;
    if (system.error) notice(system.error);
    $('gpu-name').textContent = system.gpu || 'GPU unavailable';
    $('gpu-memory').textContent = Number.isFinite(system.vramMb) && system.vramMb > 0 ? `${(system.vramMb / 1024).toFixed(1)} GB VRAM` : 'VRAM unavailable';
    $('system-status').className = 'system-status online';
    $('system-status').innerHTML = `<span class="dot"></span>${system.busy ? 'Compute busy' : 'Compute idle'}`;
    renderProcess();
  }
  function renderJobs() {
    const list = $('job-list');
    const scroll = list.scrollTop;
    const focus = document.activeElement;
    const focusKey = list.contains(focus) ? [focus.dataset.selectJob ? 'selectJob' : focus.dataset.cancelJob ? 'cancelJob' : 'deleteJob', focus.dataset.selectJob || focus.dataset.cancelJob || focus.dataset.deleteJob] : null;
    const jobs = [...state.jobs].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    $('queue-count').textContent = jobs.length;
    const running = jobs.filter(job => job.status === 'running').length;
    const queued = jobs.filter(job => job.status === 'queued').length;
    $('queue-summary').textContent = running || queued ? `${running} running / ${queued} queued` : 'No active jobs';
    list.innerHTML = jobs.length ? jobs.map(job => `<div class="job-row ${String(job.id) === state.selected ? 'selected' : ''}">
      <button class="job-select" data-select-job="${escape(job.id)}" aria-pressed="${String(job.id) === state.selected}">
        ${safeUrl(job.inputUrl) ? `<img class="job-thumb" src="${escape(safeUrl(job.inputUrl))}" alt="" loading="lazy">` : icon('box')}
        <span class="job-copy"><strong>${escape(engineName(job.engineId))}</strong><small>${escape(jobSettings(job))} / ${escape(date(job.createdAt))}</small></span>
      </button><span class="badge ${['queued','running','complete','failed','cancelled'].includes(job.status) ? job.status : ''}">${escape(job.status)}</span>
      <button class="icon-button" data-${active(job) ? 'cancel' : 'delete'}-job="${escape(job.id)}" aria-label="${active(job) ? 'Cancel' : 'Remove'} job ${escape(job.id)}" title="${active(job) ? 'Cancel job' : 'Remove record'}" ${state.pending.has(String(job.id)) || state.stopped ? 'disabled' : ''}>${icon(active(job) ? 'square' : 'trash-2')}</button>
    </div>`).join('') : `<div class="empty-list">${icon('list-ordered')}<span>No jobs yet</span></div>`;
    list.scrollTop = scroll;
    if (focusKey) [...list.querySelectorAll('button')].find(button => button.dataset[focusKey[0]] === focusKey[1])?.focus({ preventScroll: true });
    renderSelected();
    renderLibrary();
    renderProcess();
    updateControls();
    icons();
  }
  function renderSelected() {
    const job = selectedJob();
    const log = $('job-log');
    const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 24;
    const logText = job ? [...(Array.isArray(job.log) ? job.log : []), ...(job.error ? [`ERROR: ${job.error}`] : [])].join('\n') || 'No log output yet.' : 'Waiting for a job.';
    if (log.textContent !== logText) { log.textContent = logText; if (atBottom) log.scrollTop = log.scrollHeight; }
    $('log-title').textContent = job ? `JOB ${String(job.id).slice(0, 12)}` : 'JOB LOG';
    $('job-stage').textContent = job ? job.stage || job.status : 'Idle';
    $('job-progress').hidden = !job || !active(job);
    $('job-progress').setAttribute('aria-valuetext', job ? `${job.status}: ${job.stage || 'Waiting for engine'}` : 'Waiting');
    $('model-label').textContent = job ? `${engineName(job.engineId)} / ${String(job.id).slice(0, 12)}` : 'No asset selected';
    const url = job?.status === 'complete' ? safeUrl(job.outputUrl) : '';
    setModel(url);
    $('viewer-empty').hidden = Boolean(url);
    $('viewer-empty-title').textContent = !job ? 'Ready when you are' : job.status === 'running' ? 'Generation in progress' : job.status === 'queued' ? 'In the queue' : job.status === 'failed' ? 'Generation failed' : job.status === 'cancelled' ? 'Generation cancelled' : 'No model output';
    $('viewer-empty-copy').textContent = !job ? 'No generated asset yet.' : active(job) ? job.stage || 'Waiting for engine output.' : job.error || (job.status === 'complete' ? 'This job has no downloadable GLB.' : 'No 3D asset was produced.');
    $('viewer-detail').textContent = url ? `GLB / ${jobSettings(job)}` : 'GLB / Waiting for output';
    $('download-model').hidden = !url;
    if (url) { $('download-model').href = downloadUrl(job); $('download-model').download = `broogforge-${job.id}.glb`; } else $('download-model').removeAttribute('href');
  }
  function setModel(url) {
    if (url === state.modelUrl) return;
    state.modelUrl = url;
    state.modelReady = false;
    const viewer = $('model-viewer');
    viewer.hidden = !url;
    viewer.removeAttribute('auto-rotate');
    viewer.setAttribute('camera-orbit', '35deg 70deg auto');
    $('rotate-model').setAttribute('aria-pressed', 'false');
    $('rotate-model').disabled = true;
    $('reset-camera').disabled = true;
    $('model-status').hidden = !url;
    $('model-status').classList.remove('error');
    $('model-status').textContent = 'Loading 3D asset...';
    if (url) { viewer.setAttribute('src', url); if (!customElements.get('model-viewer')) $('model-status').textContent = 'Loading local 3D viewer...'; } else viewer.removeAttribute('src');
  }
  function renderLibrary() {
    const assets = assetJobs();
    const query = $('library-search').value.trim().toLowerCase();
    const filtered = assets.filter(job => `${job.id} ${engineName(job.engineId)} ${job.seed}`.toLowerCase().includes(query)).sort((a, b) => ($('library-sort').value === 'oldest' ? 1 : -1) * (new Date(a.createdAt) - new Date(b.createdAt)));
    $('library-count').textContent = assets.length;
    $('asset-summary').textContent = `${filtered.length}${query ? ` of ${assets.length}` : ''} asset${filtered.length === 1 ? '' : 's'}`;
    const markup = filtered.length ? filtered.map(job => `<article class="asset-card">
      <button class="asset-preview" data-open-asset="${escape(job.id)}" aria-label="Open asset ${escape(job.id)} in 3D viewer">
        ${safeUrl(job.inputUrl) ? `<img src="${escape(safeUrl(job.inputUrl))}" alt="Reference for ${escape(engineName(job.engineId))} asset" loading="lazy">` : icon('box')}<span>${job.kind === 'mesh' ? 'PROCESSED GLB' : 'REFERENCE IMAGE'}</span>
      </button><div class="asset-info"><h3>${escape(engineName(job.engineId))} / ${escape(String(job.id).slice(0,8))}</h3><p>${escape(jobSettings(job))}<br>${escape(date(job.createdAt))}</p></div>
      <div class="asset-actions"><a class="button secondary" href="${escape(downloadUrl(job))}" download="broogforge-${escape(job.id)}.glb">${icon('download')}GLB</a><button class="icon-button" data-delete-job="${escape(job.id)}" title="Remove record" aria-label="Remove asset record ${escape(job.id)}" ${state.pending.has(String(job.id)) || state.stopped ? 'disabled' : ''}>${icon('trash-2')}</button></div>
    </article>`).join('') : `<div class="library-empty">${icon('layers-3')}<h2>${query ? 'No matching assets' : 'Your library is empty'}</h2><p>${query ? 'No assets match this search.' : 'Completed assets will appear here.'}</p></div>`;
    if ($('asset-library').dataset.rendered !== markup) { $('asset-library').innerHTML = markup; $('asset-library').dataset.rendered = markup; icons(); }
  }
  async function poll() {
    clearTimeout(state.timer);
    if (document.hidden || state.stopped || state.polling) return;
    state.polling = true;
    const results = await Promise.allSettled([api('/api/engines'), api('/api/jobs'), api('/api/system')]);
    if (state.stopped) { state.polling = false; return; }
    const [engines, jobs, system] = results;
    state.enginesReady = engines.status === 'fulfilled' && Array.isArray(engines.value);
    if (state.enginesReady) {
      const changed = JSON.stringify(engines.value) !== JSON.stringify(state.engines);
      state.engines = engines.value;
      if (changed || $('engine-select').options[0]?.text === 'Loading engines...') renderEngines();
      else if ($('engine-note').textContent.includes('could not be refreshed')) engineSettings();
    } else { $('engine-note').textContent = 'Engine availability could not be refreshed. Generation is paused.'; }
    if (jobs.status === 'fulfilled' && Array.isArray(jobs.value)) {
      state.jobs = jobs.value;
      if (!selectedJob()) state.selected = state.jobs.length ? String([...state.jobs].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0].id) : null;
      renderJobs();
    }
    const systemReady = system.status === 'fulfilled' && system.value && typeof system.value === 'object';
    if (systemReady) renderSystem(system.value);
    else { $('system-status').className = 'system-status offline'; $('system-status').innerHTML = '<span class="dot"></span>Compute unavailable'; }
    const healthy = state.enginesReady && jobs.status === 'fulfilled' && Array.isArray(jobs.value) && systemReady;
    $('connection').className = `connection ${healthy ? 'online' : 'offline'}`;
    $('connection').innerHTML = `<span class="dot"></span>${healthy ? 'Local server connected' : 'Connection interrupted / retrying'}`;
    $('shutdown').disabled = !systemReady;
    if (healthy) $('last-sync').textContent = `Synced ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    updateControls();
    icons();
    state.polling = false;
    if (!document.hidden && !state.stopped) state.timer = setTimeout(poll, 3000);
  }
  function clearImage() {
    if (state.preview) URL.revokeObjectURL(state.preview);
    state.file = state.preview = null;
    $('image-input').value = '';
    $('reference-preview').hidden = true;
    $('reference-preview').removeAttribute('src');
    $('upload-empty').hidden = false;
    $('clear-image').hidden = true;
    $('image-meta').textContent = 'No image selected';
    updateControls();
  }
  async function acceptImage(file) {
    if (!file || state.submitting || state.stopped) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { notice('Choose a PNG, JPG, or WEBP image.'); $('image-input').value = ''; return; }
    const url = URL.createObjectURL(file);
    const probe = new Image();
    probe.src = url;
    try { await probe.decode(); } catch { URL.revokeObjectURL(url); notice('This image could not be decoded. Choose a different file.'); return; }
    if (state.preview) URL.revokeObjectURL(state.preview);
    state.file = file; state.preview = url;
    $('reference-preview').src = url;
    $('reference-preview').hidden = false;
    $('upload-empty').hidden = true;
    $('clear-image').hidden = false;
    $('image-meta').textContent = `${file.name} / ${probe.naturalWidth} x ${probe.naturalHeight} / ${(file.size / 1048576).toFixed(2)} MB`;
    updateControls();
  }
  async function submit(event) {
    event.preventDefault();
    if ($('generate').disabled || !$('generation-form').reportValidity()) return;
    const engine = selectedEngine();
    const seed = Number($('seed').value);
    const resolution = Number($('resolution').value);
    if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647 || !engine?.installed || !(engine.resolutions || []).map(Number).includes(resolution)) { notice('Check the selected engine, seed, and resolution.'); return; }
    const body = new FormData();
    body.append('image', state.file); body.append('engineId', engine.id); body.append('seed', String(seed)); body.append('resolution', String(resolution));
    state.submitting = true; updateControls();
    try {
      const job = await api('/api/jobs', { method: 'POST', body });
      if (!job?.id) throw new Error('The server did not return a job ID. Check the queue before retrying.');
      state.selected = String(job.id);
      state.jobs = [job, ...state.jobs.filter(item => String(item.id) !== state.selected)];
      renderJobs();
    } catch (error) { notice(`${error.message} Check the queue before submitting again.`); }
    finally { state.submitting = false; updateControls(); await poll(); }
  }
  function confirm(title, copy, action) {
    $('confirm-title').textContent = title; $('confirm-copy').textContent = copy; $('confirm-action').textContent = action;
    const dialog = $('confirm-dialog');
    dialog.returnValue = '';
    dialog.showModal();
    return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }));
  }
  async function jobAction(id, remove = false) {
    const job = state.jobs.find(item => String(item.id) === id);
    if (!job || state.pending.has(id) || state.stopped || (remove && active(job))) return;
    if (remove && !await confirm('Remove job record?', 'This removes the record from the queue and library. Files on disk are not deleted.', 'Remove record')) return;
    state.pending.add(id); renderJobs();
    try {
      await api(`/api/jobs/${encodeURIComponent(id)}${remove ? '' : '/cancel'}`, { method: remove ? 'DELETE' : 'POST' });
      if (remove) { state.jobs = state.jobs.filter(item => String(item.id) !== id); if (state.selected === id) state.selected = state.jobs[0] ? String(state.jobs[0].id) : null; }
    } catch (error) { notice(error.message); }
    finally { state.pending.delete(id); renderJobs(); await poll(); }
  }
  async function shutdown() {
    if (state.stopped || !await confirm('Shut down BroogForge?', `${state.jobs.some(active) ? 'There are active jobs. They may be interrupted. ' : ''}The local server will stop and this workspace will disconnect.`, 'Shut down')) return;
    $('shutdown').disabled = true;
    try {
      await api('/api/shutdown', { method: 'POST' });
      state.stopped = true; clearTimeout(state.timer);
      $('connection').className = 'connection offline'; $('connection').innerHTML = '<span class="dot"></span>Local server stopped';
      $('system-status').className = 'system-status offline'; $('system-status').innerHTML = '<span class="dot"></span>Offline';
      $('last-sync').textContent = 'Server shut down';
      notice('The local server has shut down. Restart it and reload this page to reconnect.');
      renderEngines(); renderJobs();
    } catch (error) { notice(`Shutdown could not be confirmed: ${error.message}`); $('shutdown').disabled = false; }
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    if (button.dataset.view) switchView(button.dataset.view);
    if (button.dataset.selectJob || button.dataset.openAsset) { state.selected = button.dataset.selectJob || button.dataset.openAsset; renderJobs(); if (button.dataset.openAsset) { switchView('studio'); $('viewport-title').scrollIntoView({ block: 'center' }); $('reset-camera').focus({ preventScroll: true }); } }
    if (button.dataset.cancelJob) void jobAction(button.dataset.cancelJob);
    if (button.dataset.deleteJob) void jobAction(button.dataset.deleteJob, true);
    if (button.dataset.useEngine) {
      const mesh = state.engines.find(e => e.id === button.dataset.useEngine)?.kind === 'mesh';
      $(mesh ? 'process-engine' : 'engine-select').value = button.dataset.useEngine;
      if (mesh) renderProcess(); else engineSettings();
      switchView(mesh ? 'process' : 'studio');
    }
    if (button.dataset.inspectJob) { state.selected = button.dataset.inspectJob; renderJobs(); }
    if (button.dataset.previewJob) { state.selected = button.dataset.previewJob; renderJobs(); switchView('studio'); }
  });
  const mb = bytes => `${(Number(bytes || 0) / 1048576).toFixed(2)} MB`;
  function renderProcess() {
    const focus = document.activeElement;
    const focusKey = $('process-view').contains(focus) ? ['inspectJob','previewJob','cancelJob'].find(key => focus.dataset[key]) : null;
    const focusValue = focusKey ? focus.dataset[focusKey] : null;
    const logFocused = focus.classList?.contains('process-log');
    const jobsScroll = $('process-jobs').scrollTop;
    const system = state.system || {};
    const waiting = state.jobs.filter(active);
    const elapsed = job => { const start = Date.parse(job.startedAt); return Number.isFinite(start) ? `${Math.max(0, Math.round(((job.finishedAt ? Date.parse(job.finishedAt) : Date.now()) - start) / 1000))}s` : 'Queued'; };
    $('process-stats').innerHTML = [
      ['Active queue', waiting.length, `${state.jobs.filter(j => j.status === 'running').length} running / ${state.jobs.filter(j => j.status === 'queued').length} waiting`],
      ['GPU load', Number.isFinite(system.utilization) ? `${system.utilization}%` : '--', Number.isFinite(system.temperature) ? `${system.temperature} C` : 'Telemetry unavailable'],
      ['GPU memory', Number.isFinite(system.usedMb) ? `${(system.usedMb / 1024).toFixed(1)} GB` : '--', `${((system.vramMb || 0) / 1024).toFixed(1)} GB total`],
      ['Completed assets', assetJobs().length, `${state.jobs.filter(j => j.status === 'failed').length} failed jobs`]
    ].map(([label,value,note]) => `<div><span>${escape(label)}</span><strong>${escape(value)}</strong><small>${escape(note)}</small></div>`).join('');
    $('engine-flow').innerHTML = state.engines.map((engine, index) => `<div class="flow-step"><span class="flow-number">0${index+1}</span><div><strong>${escape(engine.name)}</strong><span>${engine.kind === 'mesh' ? engine.id === 'unirig' ? 'Rig' : 'Optimize' : 'Generate'}</span></div><span class="badge ${engine.installed ? 'complete' : 'queued'}">${engine.installed ? 'Available' : 'Setup needed'}</span></div>`).join('');
    const source = $('process-source').value;
    const options = '<option value="">Upload a GLB</option>' + assetJobs().map(j => `<option value="${escape(j.id)}">${escape(engineName(j.engineId))} / ${escape(j.id.slice(0,8))} / ${mb(j.bytes)}</option>`).join('');
    if ($('process-source').dataset.options !== options) { $('process-source').innerHTML = options; $('process-source').dataset.options = options; if (assetJobs().some(j => j.id === source)) $('process-source').value = source; }
    $('mesh-upload-field').hidden = Boolean($('process-source').value);
    const engine = state.engines.find(e => e.id === $('process-engine').value);
    $('process-engine-note').textContent = engine?.description || 'No processing engine is available.';
    $('profile-field').hidden = engine?.id !== 'gltf-transform';
    $('profile-note').textContent = { balanced: '65% or 150k triangle target / WebP up to 2048 px', compact: '35% or 60k triangle target / WebP up to 1024 px', lossless: 'Deduplicate, prune and weld / original texture encoding' }[$('process-profile').value];
    $('process-submit').disabled = state.stopped || state.processing || !state.enginesReady || !engine?.installed || !($('process-source').value || $('mesh-input').files.length);
    $('process-submit').querySelector('span').textContent = state.processing ? 'Submitting...' : 'Queue processing';
    $('process-active-count').textContent = `${waiting.length} active`;
    $('process-jobs').innerHTML = state.jobs.slice(0,15).map(j => `<button class="process-job ${j.id === state.selected ? 'chosen' : ''}" data-inspect-job="${escape(j.id)}"><span><strong>${escape(engineName(j.engineId))}</strong><small>${escape(j.id.slice(0,8))} / ${elapsed(j)}</small></span><span class="badge ${escape(j.status)}">${escape(j.status)}</span></button>`).join('') || '<p class="muted">No jobs yet</p>';
    const job = selectedJob();
    const detail = $('process-detail');
    const log = detail.querySelector('pre');
    const scroll = log?.scrollTop || 0;
    const bottom = !log || log.scrollTop + log.clientHeight >= log.scrollHeight - 24;
    if (!job) { detail.innerHTML = ''; return; }
    const progress = Number.isFinite(job.progress) ? `<progress max="100" value="${job.progress}" aria-label="Stage progress"></progress>` : active(job) && job.step ? `<progress max="${job.step.total}" value="${job.step.current}" aria-label="Sampling steps"></progress><p class="field-note">Sampling step ${job.step.current} of ${job.step.total}</p>` : active(job) ? '<progress aria-label="Working"></progress>' : '';
    const metric = job.metrics;
    detail.innerHTML = `<div class="detail-heading"><div><span class="eyebrow">${escape(job.id.slice(0,8))}</span><h3>${escape(job.stage)}</h3></div><span>${elapsed(job)}</span></div>${progress}
      ${job.sourceJobId ? `<p class="lineage">Source <button class="text-button" data-inspect-job="${escape(job.sourceJobId)}">${escape(job.sourceJobId.slice(0,8))}</button></p>` : ''}
      ${metric ? `<div class="result-metrics"><div><small>File size</small><strong>${mb(metric.before.bytes)} &rarr; ${mb(metric.after.bytes)}</strong></div><div><small>Triangles</small><strong>${Number(metric.before.triangles).toLocaleString()} &rarr; ${Number(metric.after.triangles).toLocaleString()}</strong></div></div>` : ''}
      ${job.geometry ? `<div class="result-metrics"><div><small>GLB size</small><strong>${mb(job.geometry.bytes)}</strong></div><div><small>Triangles</small><strong>${Number(job.geometry.triangles).toLocaleString()}</strong></div></div>` : ''}
      ${metric && metric.profile !== 'lossless' && metric.after.triangles > (metric.profile === 'compact' ? 60000 : 150000) ? '<p class="process-error">Triangle budget not reached within the shape-preservation limit. Further cleanup may be needed before web use.</p>' : ''}
      <ol class="stage-history">${(job.history || []).map(item => `<li><span>${escape(item.stage)}</span><time>${escape(new Date(item.at).toLocaleTimeString())}</time></li>`).join('')}</ol>
      ${job.error ? `<p class="process-error">${escape(job.error)}</p>` : ''}
      <div class="detail-actions">${active(job) ? `<button class="button secondary" data-cancel-job="${escape(job.id)}" ${state.stopped ? 'disabled' : ''}>${icon('square')}Cancel</button>` : ''}${job.outputUrl ? `<button class="button secondary" data-preview-job="${escape(job.id)}">${icon('box')}Preview</button><a class="button secondary" href="${escape(downloadUrl(job))}">${icon('download')}GLB</a>` : ''}${job.startedAt ? `<a class="icon-button" href="/api/jobs/${escape(job.id)}/log" title="Download job log" aria-label="Download job log">${icon('file-text')}</a>` : ''}</div>
      <pre class="process-log" tabindex="0" aria-label="Process log">${escape((job.log || []).join('\n') || 'Waiting for worker output.')}</pre>`;
    const newLog = detail.querySelector('pre');
    newLog.scrollTop = bottom ? newLog.scrollHeight : scroll;
    $('process-jobs').scrollTop = jobsScroll;
    if (focusKey) [...$('process-view').querySelectorAll('button')].find(button => button.dataset[focusKey] === focusValue)?.focus({preventScroll:true});
    if (logFocused) newLog.focus({preventScroll:true});
    icons();
  }
  $('process-source').addEventListener('change', renderProcess);
  $('process-engine').addEventListener('change', renderProcess);
  $('process-profile').addEventListener('change', renderProcess);
  $('mesh-input').addEventListener('change', renderProcess);
  $('process-form').addEventListener('submit', async event => {
    event.preventDefault();
    if ($('process-submit').disabled) return;
    const body = new FormData();
    body.append('engineId', $('process-engine').value);
    body.append('profile', $('process-profile').value);
    if ($('process-source').value) body.append('sourceJobId', $('process-source').value);
    else body.append('model', $('mesh-input').files[0]);
    state.processing = true; renderProcess();
    try {
      const job = await api('/api/process', { method: 'POST', body });
      state.selected = job.id; state.jobs.unshift(job); renderJobs();
    } catch (error) { notice(error.message); }
    finally { state.processing = false; renderProcess(); await poll(); }
  });
  $('generation-form').addEventListener('submit', submit);
  $('engine-select').addEventListener('change', engineSettings);
  $('resolution').addEventListener('change', () => { $('resolution-warning').hidden = $('resolution').value !== '1024'; });
  $('random-seed').addEventListener('click', () => { $('seed').value = crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff; });
  $('image-input').addEventListener('change', event => void acceptImage(event.target.files[0]));
  $('clear-image').addEventListener('click', clearImage);
  $('drop-zone').addEventListener('dragover', event => { event.preventDefault(); $('drop-zone').classList.add('dragging'); });
  $('drop-zone').addEventListener('dragleave', () => $('drop-zone').classList.remove('dragging'));
  $('drop-zone').addEventListener('drop', event => { event.preventDefault(); $('drop-zone').classList.remove('dragging'); void acceptImage(event.dataTransfer.files[0]); });
  window.addEventListener('dragover', event => { if ([...event.dataTransfer.types].includes('Files')) event.preventDefault(); });
  window.addEventListener('drop', event => { if ([...event.dataTransfer.types].includes('Files')) event.preventDefault(); });
  $('cancel-selected').addEventListener('click', () => void jobAction(state.selected));
  $('dismiss-notice').addEventListener('click', () => { $('notice').hidden = true; });
  $('library-search').addEventListener('input', renderLibrary);
  $('library-sort').addEventListener('change', renderLibrary);
  $('shutdown').addEventListener('click', shutdown);
  $('rotate-model').addEventListener('click', () => { const enabled = $('model-viewer').toggleAttribute('auto-rotate'); $('rotate-model').setAttribute('aria-pressed', String(enabled)); });
  $('reset-camera').addEventListener('click', () => { const viewer = $('model-viewer'); viewer.cameraOrbit = '35deg 70deg auto'; viewer.cameraTarget = 'auto auto auto'; viewer.fieldOfView = 'auto'; viewer.resetTurntableRotation?.(0); viewer.jumpCameraToGoal?.(); });
  $('fullscreen').addEventListener('click', async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.querySelector('.viewport-panel').requestFullscreen(); } catch { notice('Fullscreen is not available in this browser.'); } });
  $('model-viewer').addEventListener('load', () => { if (!state.modelUrl) return; state.modelReady = true; $('model-status').hidden = true; $('rotate-model').disabled = false; $('reset-camera').disabled = false; });
  $('model-viewer').addEventListener('error', () => { if (!state.modelUrl) return; state.modelReady = false; $('model-status').hidden = false; $('model-status').classList.add('error'); $('model-status').textContent = 'The GLB could not be displayed. The original download is still available.'; $('rotate-model').disabled = true; $('reset-camera').disabled = true; });
  document.addEventListener('visibilitychange', () => { clearTimeout(state.timer); if (!document.hidden) void poll(); });
  window.addEventListener('hashchange', () => switchView(location.hash.slice(1)));
  window.addEventListener('pagehide', () => { clearTimeout(state.timer); if (state.preview) URL.revokeObjectURL(state.preview); });
  switchView(location.hash.slice(1));
  renderLibrary(); icons(); void poll();
})();
