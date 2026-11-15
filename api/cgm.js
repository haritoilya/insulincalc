/* InsulinCalc — прокси к серверу CGM (Juggluco web server или Nightscout).
   Отдаёт сайту суточные суммы глюкозы за N дней, чтобы считать GMI по данным датчика.

   Настройки (Vercel → Project → Settings → Environment Variables), в коде их нет:
     CGM_URL             адрес сервера, например http://<IP-или-домен>:17580  (обязательно)
     CGM_SECRET          API secret (Juggluco «Web server → secret» / Nightscout API_SECRET), если задан
     CGM_TOKEN           токен доступа Nightscout (вместо secret), если используется
     CGM_ALLOWED_EMAILS  через запятую: Google-аккаунты, которым разрешено читать данные (обязательно)

   Запрос: GET /api/cgm?days=120&tz=-180   (tz — Date.getTimezoneOffset() браузера)
   Заголовок: Authorization: Bearer <Google access token пользователя сайта>
   Ответ: { days: [{ day: 'YYYY-MM-DD', sum: <ммоль/л>, n: <кол-во замеров> }], n, last } */
const crypto = require('crypto');

const MGDL = 18.0182;

function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

async function googleEmail(auth) {
  const m = /^Bearer\s+(.+)$/i.exec(auth || '');
  if (!m) return null;
  const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + m[1] } });
  if (!r.ok) return null;
  const u = await r.json();
  return u.email_verified === false ? null : String(u.email || '').toLowerCase();
}

module.exports = async function handler(req, res) {
  const base = (process.env.CGM_URL || '').replace(/\/+$/, '');
  const allowed = (process.env.CGM_ALLOWED_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!base || !allowed.length) return send(res, 501, { error: 'not_configured' });

  let email;
  try { email = await googleEmail(req.headers.authorization); } catch (e) { email = null; }
  if (!email) return send(res, 401, { error: 'auth' });
  if (allowed.indexOf(email) < 0) return send(res, 403, { error: 'forbidden' });

  const q = new URL(req.url, 'http://x').searchParams;
  const days = Math.max(1, Math.min(400, parseInt(q.get('days'), 10) || 120));
  const tz = Math.max(-840, Math.min(840, parseInt(q.get('tz'), 10) || 0));
  const from = Date.now() - days * 86400000;

  const url = new URL(base + '/api/v1/entries/sgv.json');
  url.searchParams.set('count', String(days * 1440)); // до 1 замера в минуту
  url.searchParams.set('find[date][$gte]', String(from));
  if (process.env.CGM_TOKEN) url.searchParams.set('token', process.env.CGM_TOKEN);
  const headers = { Accept: 'application/json' };
  if (process.env.CGM_SECRET) headers['api-secret'] = crypto.createHash('sha1').update(process.env.CGM_SECRET).digest('hex');

  let list;
  try {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 20000);
    const r = await fetch(url, { headers, signal: ctl.signal });
    clearTimeout(timer);
    if (!r.ok) return send(res, 502, { error: 'upstream', status: r.status });
    list = await r.json();
  } catch (e) {
    return send(res, 502, { error: 'upstream', message: String(e && e.message || e) });
  }
  if (!Array.isArray(list)) return send(res, 502, { error: 'format' });

  // суммы по дням (местное время пользователя)
  const map = {}; let n = 0, last = 0;
  for (const e of list) {
    const t = Number(e.date || e.mills || Date.parse(e.dateString));
    const mg = Number(e.sgv != null ? e.sgv : e.mbg);
    if (!isFinite(t) || t < from || !isFinite(mg) || mg < 20 || mg > 600) continue;
    const day = new Date(t - tz * 60000).toISOString().slice(0, 10);
    const d = map[day] || (map[day] = { day, sum: 0, n: 0 });
    d.sum += mg / MGDL; d.n++; n++; if (t > last) last = t;
  }
  const out = Object.keys(map).sort().map(k => ({ day: k, sum: Math.round(map[k].sum * 100) / 100, n: map[k].n }));
  send(res, 200, { days: out, n, last: last || null });
};
