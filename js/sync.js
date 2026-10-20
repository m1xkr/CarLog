// Синхронизация: скачать облачную копию, слить с локальной, при расхождении — загрузить обратно.
import { mergeDb, normalize, fingerprint, saveDb, saveSettings, emptyDb } from './store.js';
import * as disk from './yadisk.js';
import * as gd from './gdrive.js';

// Какое облако подключено. Яндекс — для тех, кто подключал его раньше (до выбора облака).
export function provider(s) {
  if (s.syncProvider === 'google' && s.googleToken) {
    return { name: 'google', expired: !s.googleExpires || s.googleExpires < Date.now() + 60000,
      download: () => gd.download(s.googleToken), upload: d => gd.upload(s.googleToken, d) };
  }
  if ((s.syncProvider === 'yandex' || !s.syncProvider) && s.yandexToken) {
    return { name: 'yandex', download: () => disk.download(s.yandexToken), upload: d => disk.upload(s.yandexToken, d) };
  }
  return null;
}

export function createSync(app) {
  let running = null, timer = null, again = false;

  async function run() {
    const s = app.settings;
    const p = provider(s);
    if (!p) { app.setSyncState('off'); return; }
    if (p.expired) { app.setSyncState('reauth', 'Нужно обновить вход в Google'); app.reauth?.(); return; }
    if (running) { again = true; return running; }
    app.setSyncState('busy');
    running = (async () => {
      try {
        const remoteRaw = await p.download();
        const remote = remoteRaw ? normalize(remoteRaw) : null;
        const merged = mergeDb(app.db, remote || emptyDb());
        if (app.afterMerge) app.afterMerge(merged);
        const localChanged = fingerprint(merged) !== fingerprint(app.db);
        if (localChanged) { app.db = merged; saveDb(merged); app.render(); }
        if (!remote || fingerprint(remote) !== fingerprint(merged)) {
          await p.upload({ ...merged, savedAt: new Date().toISOString() });
        }
        s.lastSync = Date.now(); s.lastSyncError = null; saveSettings(s);
        app.setSyncState('ok');
      } catch (e) {
        if (e instanceof disk.AuthError) s.yandexToken = null;
        if (e instanceof gd.AuthError) { s.googleExpires = 0; if (app.reauth?.()) return; }
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
