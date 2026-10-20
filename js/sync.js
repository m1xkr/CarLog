// Синхронизация: скачать облачную копию, слить с локальной, при расхождении — загрузить обратно.
import { mergeDb, normalize, fingerprint, saveDb, saveSettings } from './store.js';
import * as disk from './yadisk.js';

export function createSync(app) {
  let running = null, timer = null, again = false;

  async function run() {
    const s = app.settings;
    if (!s.yandexToken) { app.setSyncState('off'); return; }
    if (running) { again = true; return running; }
    app.setSyncState('busy');
    running = (async () => {
      try {
        const remoteRaw = await disk.download(s.yandexToken);
        const remote = remoteRaw ? normalize(remoteRaw) : null;
        const merged = remote ? mergeDb(app.db, remote) : app.db;
        const localChanged = fingerprint(merged) !== fingerprint(app.db);
        if (localChanged) { app.db = merged; saveDb(merged); app.render(); }
        if (!remote || fingerprint(remote) !== fingerprint(merged)) {
          await disk.upload(s.yandexToken, { ...merged, savedAt: new Date().toISOString() });
        }
        s.lastSync = Date.now(); s.lastSyncError = null; saveSettings(s);
        app.setSyncState('ok');
      } catch (e) {
        if (e instanceof disk.AuthError) { s.yandexToken = null; }
        s.lastSyncError = e.message; saveSettings(s);
        app.setSyncState('error', e.message);
      } finally {
        running = null;
        if (again) { again = false; schedule(500); }
      }
    })();
    return running;
  }

  function schedule(ms = 2000) {
    clearTimeout(timer);
    timer = setTimeout(run, ms);
  }

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(300); });
  window.addEventListener('online', () => schedule(300));

  return { run, schedule };
}
