// Google Диск: вход через OAuth 2.0 (implicit flow с переходом на страницу Google и обратно)
// и один файл в скрытой папке приложения (appDataFolder, право drive.appdata — остальные файлы не видны).
// API Google разрешает запросы со страниц (CORS), поэтому прокси не нужен.
// Браузерному приложению Google выдаёт токен на час; продление — тихий повторный вход (prompt=none).

// email — чтобы знать, под каким аккаунтом входить при тихом продлении (login_hint)
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata email';
const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const NAME = 'carlog.json';

export class AuthError extends Error {}
export class NetworkError extends Error {}

export function redirectUri() { return location.origin + location.pathname; }

export function authUrl(clientId, { silent = false, hint = '' } = {}) {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: SCOPE,
    include_granted_scopes: 'true',
    state: 'gdrive',
  });
  if (silent) p.set('prompt', 'none');
  else p.set('prompt', 'select_account');
  if (hint) p.set('login_hint', hint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

// Ответ Google приходит во фрагменте адреса: #state=gdrive&access_token=...&expires_in=3599
// или #state=gdrive&error=interaction_required (тихий вход не удался).
export function takeResultFromHash() {
  if (!location.hash.includes('state=gdrive')) return null;
  const p = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', location.pathname + location.search);
  if (p.get('error')) return { error: p.get('error') };
  const token = p.get('access_token');
  const expiresIn = parseInt(p.get('expires_in') || '3600', 10);
  return token ? { token, expires: Date.now() + expiresIn * 1000 } : null;
}

async function call(url, opts = {}) {
  let res;
  try { res = await fetch(url, opts); }
  catch { throw new NetworkError(navigator.onLine === false ? 'Нет интернета' : 'Google Диск недоступен (сеть)'); }
  if (res.status === 401) throw new AuthError('Вход в Google истёк');
  if (res.status === 403) {
    const t = await res.text().catch(() => '');
    if (/insufficient|scope|PERMISSION/i.test(t)) throw new AuthError('Нет доступа к папке приложения на Google Диске');
    throw new NetworkError('Google Диск отказал: ' + t.slice(0, 120));
  }
  return res;
}

const auth = token => ({ Authorization: `Bearer ${token}` });

async function findFile(token) {
  const q = encodeURIComponent(`name='${NAME}' and trashed=false`);
  const res = await call(`${FILES}?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)&orderBy=modifiedTime desc`, { headers: auth(token) });
  if (!res.ok) throw new NetworkError(`Ошибка Google Диска: ${res.status}`);
  const { files } = await res.json();
  return files?.[0]?.id || null;
}

export async function download(token) {
  const id = await findFile(token);
  if (!id) return null;
  const res = await call(`${FILES}/${id}?alt=media`, { headers: auth(token) });
  if (!res.ok) throw new NetworkError(`Ошибка скачивания: ${res.status}`);
  return res.json();
}

export async function upload(token, data) {
  const body = JSON.stringify(data);
  const id = await findFile(token);
  let res;
  if (id) {
    res = await call(`${UPLOAD}/${id}?uploadType=media`, { method: 'PATCH', headers: { ...auth(token), 'Content-Type': 'application/json' }, body });
  } else {
    const boundary = 'carlog' + Math.random().toString(36).slice(2);
    const meta = JSON.stringify({ name: NAME, parents: ['appDataFolder'], mimeType: 'application/json' });
    const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
    res = await call(`${UPLOAD}?uploadType=multipart`, { method: 'POST', headers: { ...auth(token), 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart });
  }
  if (!res.ok) throw new NetworkError(`Ошибка загрузки: ${res.status}`);
}

export async function whoAmI(token) {
  try {
    const res = await call('https://www.googleapis.com/oauth2/v3/userinfo', { headers: auth(token) });
    return res.ok ? (await res.json()).email || null : null;
  } catch { return null; }
}
