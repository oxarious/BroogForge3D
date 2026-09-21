(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let state = null, pending = false, polling = false, selected = '', actionError = null;
  async function api(route, options = {}) {
    const response = await fetch(`/api/textures${route}`, { ...options, cache: 'no-store', signal: AbortSignal.timeout(route === '/handoff' ? 200000 : 20000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }
  function error(message) { $('texture-error').textContent = message || ''; $('texture-error').hidden = !message; }
  function render() {
    if (!state) return;
    $('texture-phase').textContent = state.busy ? 'Generating' : state.phase;
    $('texture-start').disabled = pending || state.busy || state.backendRunning || !state.setupComplete;
    $('texture-stop').disabled = pending || !state.backendRunning;
    $('texture-generate').disabled = pending || state.phase !== 'ready' || state.busy;
    $('texture-editor').disabled = pending || !state.editorAvailable;
    $('texture-handoff').disabled = pending || !$('texture-source').value;
    $('texture-models').textContent = state.models.length ? 'SD1.5 + ControlNet Depth + IP-Adapter Plus' : state.setupComplete ? 'Models installed' : 'Runtime setup incomplete';
    $('texture-url').value = state.url || '';
    $('texture-copy').disabled = !state.url;
    $('texture-log').textContent = state.log || 'Backend stopped.';
    error(actionError || (state.phase === 'failed' ? state.error : null));
    const history = $('texture-history');
    if (JSON.stringify(state.jobs.map(job => [job.id, job.status])) !== history.dataset.signature) {
      history.dataset.signature = JSON.stringify(state.jobs.map(job => [job.id, job.status]));
      history.replaceChildren(...(state.jobs.length ? state.jobs.map(job => new Option(`${new Date(job.createdAt).toLocaleString()} / ${job.status}`, job.id)) : [new Option('No projections yet', '')]));
      if (!state.jobs.some(job => job.id === selected)) selected = state.jobs[0]?.id || '';
      history.value = selected;
    }
    const job = state.jobs.find(job => job.id === selected);
    const preview = $('texture-preview');
    preview.hidden = job?.status !== 'complete';
    if (!preview.hidden) preview.src = job.imageUrl;
    $('texture-job-status').textContent = job ? job.error || job.stage : 'No projection selected';
    $('texture-download').hidden = job?.status !== 'complete';
    if (job?.imageUrl) $('texture-download').href = `${job.imageUrl}?download=1`;
  }
  async function poll() {
    if (polling || document.hidden || $('textures-view').hidden) return;
    polling = true;
    try {
      state = await api(''); render();
      const response = await fetch('/api/jobs', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('Could not load library assets.');
      const data = await response.json();
      const jobs = (Array.isArray(data) ? data : data.jobs).filter(job => job.status === 'complete');
      const source = $('texture-source'), value = source.value;
      if (source.dataset.signature !== jobs.map(job => job.id).join(',')) {
        source.dataset.signature = jobs.map(job => job.id).join(',');
        source.replaceChildren(new Option('Choose a library asset', ''), ...jobs.map(job => new Option(`${job.engineId || job.engine} / ${job.id.slice(0, 8)}`, job.id)));
        source.value = value;
      }
      $('texture-handoff').disabled = pending || !source.value;
    } catch (err) { error(err.message); } finally { polling = false; }
  }
  async function action(run) {
    if (pending) return;
    pending = true; actionError = null; render();
    try { await run(); await poll(); } catch (err) { actionError = err.message; }
    finally { pending = false; render(); }
  }
  $('texture-start').onclick = () => action(async () => { state = await api('/start', { method: 'POST' }); });
  $('texture-stop').onclick = () => {
    if (state?.busy && !confirm('Stop the backend and cancel the active projection?')) return;
    action(async () => { state = await api('/stop', { method: 'POST' }); });
  };
  $('texture-form').onsubmit = event => {
    event.preventDefault();
    action(async () => { const job = await api('/generate', { method: 'POST', body: new FormData(event.target) }); selected = job.id; });
  };
  $('texture-history').onchange = event => { selected = event.target.value; render(); };
  $('texture-source').onchange = event => { $('texture-handoff').disabled = !event.target.value || pending; };
  $('texture-handoff').onclick = () => action(async () => {
    const result = await api('/handoff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceJobId: $('texture-source').value }) });
    $('texture-handoff-result').textContent = result.directory;
  });
  $('texture-editor').onclick = () => action(() => api('/editor', { method: 'POST' }));
  $('texture-copy').onclick = () => navigator.clipboard.writeText($('texture-url').value).catch(err => error(err.message));
  document.addEventListener('broog:view', poll);
  document.addEventListener('visibilitychange', poll);
  setInterval(poll, 3000); poll();
})();
