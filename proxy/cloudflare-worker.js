// Прокси для Бортжурнала — Cloudflare Workers (вариант, если Yandex Cloud недоступен).
// Пересылает запросы к серверам Яндекс Диска и добавляет заголовки CORS. Пропускает только адреса Яндекса.

const ALLOWED_ORIGIN = 'https://m1xkr.github.io';
const ALLOWED_HOST = /(^|\.)yandex\.(net|ru)$/;

export default {
  async fetch(request) {
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '86400',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    let url;
    try { url = new URL(new URL(request.url).searchParams.get('url')); } catch { return new Response('bad url', { status: 400, headers: cors }); }
    if (url.protocol !== 'https:' || !ALLOWED_HOST.test(url.hostname)) return new Response('host not allowed', { status: 403, headers: cors });
    const headers = {};
    if (request.headers.get('Authorization')) headers.Authorization = request.headers.get('Authorization');
    if (request.headers.get('Content-Type')) headers['Content-Type'] = request.headers.get('Content-Type');
    const res = await fetch(url, { method: request.method, headers, body: request.method === 'PUT' ? await request.arrayBuffer() : undefined, redirect: 'follow' });
    const out = new Headers(cors);
    out.set('Content-Type', res.headers.get('Content-Type') || 'application/octet-stream');
    return new Response(res.body, { status: res.status, headers: out });
  },
};
