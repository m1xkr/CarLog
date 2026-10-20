// Прокси для Бортжурнала — Yandex Cloud Functions (среда Node.js 18+).
// Пересылает запросы приложения к серверам Яндекс Диска и добавляет заголовки CORS,
// которых нет у серверов скачивания/загрузки файлов. Пропускает только адреса Яндекса.
// Токен не хранится и не логируется: он просто передаётся дальше в заголовке Authorization.

const ALLOWED_ORIGIN = 'https://m1xkr.github.io';
const ALLOWED_HOST = /(^|\.)yandex\.(net|ru)$/;

module.exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };

  const target = (event.queryStringParameters || {}).url;
  let url;
  try { url = new URL(target); } catch { return { statusCode: 400, headers: cors, body: 'bad url' }; }
  if (url.protocol !== 'https:' || !ALLOWED_HOST.test(url.hostname)) return { statusCode: 403, headers: cors, body: 'host not allowed' };

  const headers = {};
  const h = Object.fromEntries(Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  if (h.authorization) headers.Authorization = h.authorization;
  if (h['content-type']) headers['Content-Type'] = h['content-type'];

  const init = { method: event.httpMethod, headers, redirect: 'follow' };
  if (event.httpMethod === 'PUT' && event.body) init.body = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : event.body;

  const res = await fetch(url, init);
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    statusCode: res.status,
    headers: { ...cors, 'Content-Type': res.headers.get('content-type') || 'application/octet-stream' },
    body: buf.toString('base64'),
    isBase64Encoded: true,
  };
};
