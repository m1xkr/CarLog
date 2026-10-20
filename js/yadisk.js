// Яндекс Диск: вход через OAuth (implicit flow) и чтение/запись одного файла в папке приложения.
// Приложению нужен только доступ «Доступ к папке приложения на Диске» (cloud_api:disk.app_folder).

const API = 'https://cloud-api.yandex.net/v1/disk/resources';
export const REMOTE_PATH = 'app:/carlog.json';

export class AuthError extends Error {}
export class NetworkError extends Error {}

export function redirectUri() {
  return location.origin + location.pathname;
}

export function authUrl(clientId, manual = false) {
  const p = new URLSearchParams({
    response_type: 'token',
    client_id: clientId,
    redirect_uri: manual ? 'https://oauth.yandex.ru/verification_code' : redirectUri(),
    force_confirm: 'no',
  });
  return `https://oauth.yandex.ru/authorize?${p}`;
}

// После возврата из Яндекса токен приходит во фрагменте адреса: #access_token=...&expires_in=...
export function takeTokenFromHash() {
  if (!location.hash.includes('access_token=')) return null;
  const p = new URLSearchParams(location.hash.slice(1));
  const token = p.get('access_token');
  const expiresIn = parseInt(p.get('expires_in') || '0', 10);
  history.replaceState(null, '', location.pathname + location.search);
  return token ? { token, expires: expiresIn ? Date.now() + expiresIn * 1000 : null } : null;
}

// Прокси нужен, если какой-то из серверов Яндекса не разрешает запросы со страниц (CORS).
// Хосты, которые уже не ответили напрямую, дальше сразу идут через прокси.
let proxyUrl = '';
const viaProxy = new Set();
export function setProxy(url) { proxyUrl = (url || '').trim().replace(/\/+$/, ''); }

const STEP = {
  meta: 'запрос к API Диска', get: 'скачивание файла', put: 'загрузка файла', info: 'проверка входа',
};

async function call(url, opts = {}, step = 'meta') {
  const host = new URL(url).host;
  // все файловые серверы Диска (uploader*, downloader*) ведут себя одинаково — запоминаем их группой
  const key = host === 'cloud-api.yandex.net' ? host : 'files';
  const base = proxyUrl && /\/[^/]+$/.test(new URL(proxyUrl).pathname) ? proxyUrl : proxyUrl + '/';
  const direct = () => fetch(url, opts);
  const proxied = () => fetch(`${base}?url=${encodeURIComponent(url)}`, opts);
  let res;
  try {
    res = proxyUrl && viaProxy.has(key) ? await proxied() : await direct();
  } catch (e) {
    if (navigator.onLine === false) throw new NetworkError('Нет интернета');
    if (!proxyUrl || viaProxy.has(key)) {
      throw new NetworkError(`Браузер не пускает к Диску на шаге «${STEP[step]}» (${host}, CORS)${proxyUrl ? ' — прокси тоже не ответил' : ''}`);
    }
    viaProxy.add(key);
    try { res = await proxied(); }
    catch { throw new NetworkError(`Прокси не отвечает на шаге «${STEP[step]}»`); }
  }
  if ((res.status === 401 || (res.status === 403 && host === 'cloud-api.yandex.net'))) throw new AuthError('Вход в Яндекс истёк, войдите заново');
  return res;
}

// Проверка по шагам — показывает, какой именно сервер не отвечает из браузера.
export async function diagnose(token) {
  const out = [];
  const run = async (name, fn) => {
    try { out.push({ name, ok: true, note: await fn() || '' }); }
    catch (e) { out.push({ name, ok: false, note: e.message }); }
  };
  await run('Вход и доступ к Диску', async () => { const r = await call('https://cloud-api.yandex.net/v1/disk/', { headers: auth(token) }, 'info'); if (!r.ok) throw new Error('код ' + r.status); });
  let href = null;
  await run('Ссылка на скачивание', async () => {
    const r = await call(`${API}/download?path=${encodeURIComponent(REMOTE_PATH)}`, { headers: auth(token) });
    if (r.status === 404) return 'файла ещё нет — это нормально';
    if (!r.ok) throw new Error('код ' + r.status);
    href = (await r.json()).href;
  });
  if (href) await run('Скачивание файла', async () => { const r = await call(href, {}, 'get'); if (!r.ok) throw new Error('код ' + r.status); return `${new URL(href).host}`; });
  let up = null;
  await run('Ссылка на загрузку', async () => {
    const r = await call(`${API}/upload?path=${encodeURIComponent('app:/carlog-check.txt')}&overwrite=true`, { headers: auth(token) });
    if (!r.ok) throw new Error('код ' + r.status);
    up = await r.json();
  });
  if (up) await run('Загрузка файла', async () => { const r = await call(up.href, { method: up.method || 'PUT', body: 'ok' }, 'put'); if (!r.ok && r.status !== 201 && r.status !== 202) throw new Error('код ' + r.status); return new URL(up.href).host; });
  out.push({ name: 'Через прокси', ok: true, note: viaProxy.size ? [...viaProxy].map(k => k === 'files' ? 'файловые серверы' : k).join(', ') : (proxyUrl ? 'не понадобился' : 'не задан') });
  return out;
}

const auth = token => ({ Authorization: `OAuth ${token}` });

// Возвращает объект из облака или null, если файла ещё нет.
export async function download(token) {
  const meta = await call(`${API}/download?path=${encodeURIComponent(REMOTE_PATH)}`, { headers: auth(token) });
  if (meta.status === 404) return null;
  if (!meta.ok) throw new NetworkError(`Ошибка Диска: ${meta.status}`);
  const { href } = await meta.json();
  const file = await call(href, {}, 'get');
  if (!file.ok) throw new NetworkError(`Ошибка скачивания: ${file.status}`);
  return await file.json();
}

export async function upload(token, data) {
  const meta = await call(`${API}/upload?path=${encodeURIComponent(REMOTE_PATH)}&overwrite=true`, { headers: auth(token) });
  if (!meta.ok) throw new NetworkError(`Ошибка Диска: ${meta.status}`);
  const { href, method } = await meta.json();
  const put = await call(href, { method: method || 'PUT', body: JSON.stringify(data) }, 'put');
  if (!put.ok && put.status !== 201 && put.status !== 202) throw new NetworkError(`Ошибка загрузки: ${put.status}`);
}

export async function userInfo(token) {
  const res = await call('https://cloud-api.yandex.net/v1/disk/', { headers: auth(token) }, 'info');
  if (!res.ok) throw new NetworkError(`Ошибка Диска: ${res.status}`);
  return res.json();
}
