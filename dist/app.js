(() => {
  const dialog = document.getElementById('download-dialog');
  const title = document.getElementById('download-title');
  const message = document.getElementById('download-message');
  const progress = document.getElementById('download-progress');
  const percent = document.getElementById('download-percent');
  const save = document.getElementById('save-app');
  const retry = document.getElementById('retry-download');
  let busy = false, ready = false, manifest, lastTrigger;
  const releaseUrl = document.body.dataset.release || 'release.json';
  function showRelease(m) {
    document.querySelectorAll('[data-release-version]').forEach(el => el.textContent = m.version);
    document.querySelectorAll('[data-release-filename]').forEach(el => el.textContent = m.filename);
    document.querySelectorAll('[data-release-size]').forEach(el => el.textContent = Math.ceil(m.bytes / 1024 / 1024) + ' MB · One file');
  }
  const manifestReady = fetch(releaseUrl, {cache:'no-cache'}).then(r => { if (!r.ok) throw new Error('Release information unavailable'); return r.json(); }).then(m => { manifest = m; showRelease(m); return m; });
  // Keep a failed prefetch from becoming an unhandled rejection; clicking retries.
  manifestReady.catch(() => {});
  const fail = () => {
    title.textContent = 'The download was interrupted.';
    message.textContent = 'Check your internet connection and try again. You will still receive just one app file.';
    percent.textContent = 'No app file was saved.'; retry.hidden = false; progress.hidden = true;
  };
  async function prepare() {
    if (busy || ready) return;
    busy = true; retry.hidden = true; progress.hidden = false; progress.value = 0;
    title.textContent = 'Getting your app ready.'; message.textContent = 'Keep this page open. Your download will start when it is ready.'; percent.textContent = 'Preparing…';
    try {
      if (!manifest) {
        const response = await fetch(releaseUrl, {cache:'no-cache'});
        if (!response.ok) throw new Error('Release unavailable'); manifest = await response.json(); showRelease(manifest);
      }
      const parts = new Array(manifest.parts.length); let cursor = 0, received = 0;
      const controller = new AbortController();
      try {
        await Promise.all(Array.from({length: Math.min(3, manifest.parts.length)}, async () => {
          while (cursor < manifest.parts.length) {
            const index = cursor++;
            const response = await fetch(manifest.parts[index], {signal:controller.signal});
            if (!response.ok) throw new Error('Download unavailable');
            const bytes = new Uint8Array(await response.arrayBuffer());
            parts[index] = bytes; received += bytes.length;
            const amount = Math.min(95, Math.round(received / manifest.bytes * 95));
            progress.value = amount; percent.textContent = amount + '% prepared';
          }
        }));
      } catch (e) { controller.abort(); throw e; }
      const blob = new Blob(parts, {type:'application/octet-stream'});
      if (blob.size !== manifest.bytes) throw new Error('Incomplete download');
      percent.textContent = 'Checking your app…'; progress.value = 98;
      if (!globalThis.crypto?.subtle) throw new Error('A secure browser connection is required');
      const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
      const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2,'0')).join('');
      if (hash !== manifest.sha256.toLowerCase()) throw new Error('Integrity check failed');
      save.href = URL.createObjectURL(blob); save.download = manifest.filename; save.hidden = false;
      save.textContent = 'Save ' + manifest.filename + ' ↓';
      ready = true; progress.value = 100; percent.textContent = '100% · App checked and ready';
      title.textContent = 'DeviceBridge v' + manifest.version + ' is ready.';
      message.textContent = manifest.kind === 'installer'
        ? 'Run ' + manifest.filename + ' to install DeviceBridge. Then open the app from your desktop or Start menu. Install the same version on your other PC too.'
        : 'Open ' + manifest.filename + ' from your downloads. If the save did not start, use the button below. Download the same app on your other PC too.';
      save.click();
    } catch (e) { fail(); }
    finally { busy = false; }
  }
  document.querySelectorAll('[data-download]').forEach(button => button.addEventListener('click', () => {
    lastTrigger = button; if (!dialog.open) dialog.showModal(); prepare();
  }));
  document.getElementById('close-dialog').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => lastTrigger?.focus());
  retry.addEventListener('click', prepare);
  const stage = document.querySelector('.layout-stage');
  const caption = document.getElementById('layout-caption');
  const edges = {left:'left',right:'right',above:'top',below:'bottom'};
  document.querySelectorAll('[data-layout]').forEach(button => button.addEventListener('click', () => {
    const side = button.dataset.layout;
    if (!stage || !caption || !edges[side]) return;
    document.querySelectorAll('[data-layout]').forEach(choice => choice.setAttribute('aria-pressed', String(choice === button)));
    stage.classList.remove('is-moving'); stage.dataset.side = side;
    caption.textContent = 'Move past the ' + edges[side] + ' edge to use the other PC.';
    requestAnimationFrame(() => requestAnimationFrame(() => stage.classList.add('is-moving')));
  }));
})();
