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

async function call(url, opts = {}) {
  let res;
  try {
    res = await fetch(url, opts);
  } catch (e) {
    throw new NetworkError(navigator.onLine === false ? 'Нет интернета' : 'Диск недоступен из браузера (сеть или CORS)');
  }
  if (res.status === 401 || res.status === 403) throw new AuthError('Вход в Яндекс истёк, войдите заново');
  return res;
}

const auth = token => ({ Authorization: `OAuth ${token}` });

// Возвращает объект из облака или null, если файла ещё нет.
export async function download(token) {
  const meta = await call(`${API}/download?path=${encodeURIComponent(REMOTE_PATH)}`, { headers: auth(token) });
  if (meta.status === 404) return null;
  if (!meta.ok) throw new NetworkError(`Ошибка Диска: ${meta.status}`);
  const { href } = await meta.json();
  const file = await call(href);
  if (!file.ok) throw new NetworkError(`Ошибка скачивания: ${file.status}`);
  return await file.json();
}

export async function upload(token, data) {
  const meta = await call(`${API}/upload?path=${encodeURIComponent(REMOTE_PATH)}&overwrite=true`, { headers: auth(token) });
  if (!meta.ok) throw new NetworkError(`Ошибка Диска: ${meta.status}`);
  const { href, method } = await meta.json();
  const put = await call(href, { method: method || 'PUT', body: JSON.stringify(data) });
  if (!put.ok && put.status !== 201 && put.status !== 202) throw new NetworkError(`Ошибка загрузки: ${put.status}`);
}

export async function userInfo(token) {
  const res = await call('https://cloud-api.yandex.net/v1/disk/', { headers: auth(token) });
  if (!res.ok) throw new NetworkError(`Ошибка Диска: ${res.status}`);
  return res.json();
}
