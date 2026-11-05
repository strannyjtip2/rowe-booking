#!/usr/bin/env node
/* Мини-сервер записи: Node 22+ без внешних зависимостей (node:sqlite). */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const S = require('./public/shared.js');

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PIN = String(process.env.ADMIN_PIN || '1234');
const TG_TOKEN = process.env.TG_BOT_TOKEN || '';
const TG_CHAT = process.env.TG_CHAT_ID || '';
const DATA = path.join(__dirname, 'data');
const PUBLIC = path.join(__dirname, 'public');
const CONFIG_FILE = path.join(DATA, 'config.json');
fs.mkdirSync(DATA, { recursive: true });
if (!fs.existsSync(CONFIG_FILE)) fs.copyFileSync(path.join(PUBLIC, 'config.default.json'), CONFIG_FILE);
if (ADMIN_PIN === '1234') console.warn('⚠ ADMIN_PIN по умолчанию (1234). Задайте свой: ADMIN_PIN=... node server.js');

const db = new DatabaseSync(path.join(DATA, 'bookings.db'));
db.exec(`CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY, date TEXT NOT NULL, time TEXT NOT NULL, status TEXT NOT NULL,
  json TEXT NOT NULL, created_at TEXT NOT NULL)`);

db.exec(`CREATE TABLE IF NOT EXISTS clients (phone TEXT PRIMARY KEY, name TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, phone TEXT NOT NULL, created_at TEXT);
CREATE TABLE IF NOT EXISTS otps (phone TEXT PRIMARY KEY, code TEXT, expires INTEGER, tries INTEGER);
CREATE TABLE IF NOT EXISTS cars (id TEXT PRIMARY KEY, phone TEXT NOT NULL, json TEXT NOT NULL)`);
const DEMO_OTP = process.env.DEMO_OTP === undefined ? '1111' : process.env.DEMO_OTP; // пусто => случайный код (только в лог)
const normPhone = (p) => String(p || '').replace(/\D/g, '').replace(/^8(\d{10})$/, '7$1');
function clientOf(req) {
  const t = String(req.headers['x-client-token'] || '');
  if (!t) return null;
  const s = db.prepare('SELECT phone FROM sessions WHERE token=?').get(t);
  return s ? db.prepare('SELECT * FROM clients WHERE phone=?').get(s.phone) : null;
}
const carsOf = (phone) => db.prepare('SELECT json FROM cars WHERE phone=?').all(phone).map((r) => JSON.parse(r.json)).sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0));
const saveCar = (phone, c) => db.prepare('INSERT OR REPLACE INTO cars (id,phone,json) VALUES (?,?,?)').run(c.id, phone, JSON.stringify(c));
function cleanCar(src, old) {
  const c = { ...(old || {}) };
  for (const k of ['model', 'plate', 'oilType', 'volume', 'lastMileage', 'lastDate', 'nextKm', 'nextDate', 'year']) if (k in src) c[k] = String(src[k] == null ? '' : src[k]).trim().slice(0, 60);
  return c;
}
function setPrimary(phone, id) { for (const c of carsOf(phone)) { c.primary = c.id === id; saveCar(phone, c); } }
/* ---- бонусная карта (уровни — в config.json → loyalty) ---- */
function cardNo(phone) {
  const h = crypto.createHash('sha256').update('rowe-card:' + phone).digest();
  let d = ''; for (let i = 0; d.length < 12; i++) d += String(h[i] % 10);
  return (getConfig().loyalty?.cardPrefix || '7700') + d;
}
function loyaltyOf(phone) {
  const L = getConfig().loyalty; if (!L || !L.enabled || !phone) return null;
  const spent = allBookings().filter((b) => b.status === 'done' && b.clientPhone === phone).reduce((s, b) => s + (Number(b.price) || 0), 0);
  const tiers = [...(L.tiers || [])].sort((a, b) => a.from - b.from);
  let tier = tiers[0], next = null;
  for (const t of tiers) if (spent >= t.from) tier = t; else { next = t; break; }
  const card = cardNo(phone);
  return { card, spent, tier, next, toNext: next ? next.from - spent : 0, tiers };
}

/* после выполненной масляной услуги — обновить карточку авто */
function applyToCar(b) {
  if (!b.clientPhone || !b.carId || !b.nextChange) return;
  const r = db.prepare('SELECT json FROM cars WHERE id=? AND phone=?').get(b.carId, b.clientPhone); if (!r) return;
  const c = JSON.parse(r.json);
  if (b.mileage !== '' && b.mileage != null) c.lastMileage = String(b.mileage);
  c.lastDate = b.date; c.nextDate = b.nextChange.date; c.nextKm = String(b.nextChange.km).replace('+', '');
  if (b.oilType) c.oilType = b.oilType;
  saveCar(b.clientPhone, c);
}

/* ---- конфиг (файл data/config.json, можно править руками — подхватывается сразу) ---- */
let cfgCache = null, cfgMtime = 0;
function getConfig() {
  const m = fs.statSync(CONFIG_FILE).mtimeMs;
  if (!cfgCache || m !== cfgMtime) {
    const c = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    const err = S.validateConfig(c);
    if (err) { if (cfgCache) { console.error('Ошибка в config.json:', err); return cfgCache; } throw new Error(err); }
    cfgCache = c; cfgMtime = m;
  }
  return cfgCache;
}
getConfig();

const allBookings = () => db.prepare('SELECT json FROM bookings ORDER BY date, time').all().map((r) => JSON.parse(r.json));
const getBooking = (id) => { const r = db.prepare('SELECT json FROM bookings WHERE id=?').get(id); return r ? JSON.parse(r.json) : null; };
function saveBooking(b) {
  db.prepare('INSERT OR REPLACE INTO bookings (id,date,time,status,json,created_at) VALUES (?,?,?,?,?,?)')
    .run(b.id, b.date, b.time, b.status, JSON.stringify(b), b.createdAt);
}

/* ---- Telegram-уведомления (если заданы TG_BOT_TOKEN и TG_CHAT_ID) ---- */
function bookingText(b) {
  const when = b.mode === 'multiday'
    ? `Заезд: ${S.formatDate(b.date)} ${b.time}\nВыдача: ${S.formatDate(b.pickupDate)} ${b.pickupLabel || ''}`
    : `${S.formatDate(b.date)}, ${b.time}–${b.endTime}`;
  return `${b.serviceName} (${Number(b.price).toLocaleString("ru-RU")} ${getConfig().shop.currency || ''})\n${when}\n${b.name} · ${b.phone}\nАвто: ${b.car}${b.year ? ', ' + b.year : ''}${b.mileage ? ' · ' + b.mileage + ' км' : ''} · масло ${b.oil === 'own' ? 'своё' : 'наше'}${b.nextChange ? '\nСлед. замена: ' + S.formatDate(b.nextChange.date, true) + ' / ' + b.nextChange.km + ' км' : ''}${b.comment ? '\nКомментарий: ' + b.comment : ''}`;
}
async function notify(title, b) {
  console.log(`[notify] ${title}\n${bookingText(b)}`);
  if (!TG_TOKEN || !TG_CHAT) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, text: `${title}\n\n${bookingText(b)}` }),
    });
  } catch (e) { console.error('Telegram error:', e.message); }
}

/* ---- утилиты ---- */
const hits = new Map(); // ограничение частоты: ip -> [timestamps]
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now); hits.set(key, arr);
  return arr.length > max;
}
const fails = new Map(); // ip -> {n, until}
function checkPin(req) {
  const ip = req.socket.remoteAddress + '|' + (req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || '');
  const f = fails.get(ip) || { n: 0, until: 0 };
  if (f.until > Date.now()) return 'locked';
  const given = Buffer.from(String(req.headers['x-admin-pin'] || ''));
  const real = Buffer.from(ADMIN_PIN);
  const ok = given.length === real.length && crypto.timingSafeEqual(given, real);
  if (ok) { fails.delete(ip); return 'ok'; }
  f.n++; if (f.n >= 5) { f.until = Date.now() + 5 * 60e3; f.n = 0; }
  fails.set(ip, f);
  return 'bad';
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = ''; req.on('data', (c) => { d += c; if (d.length > 200e3) { reject(new Error('too big')); req.destroy(); } });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); } });
  });
}
const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
const clean = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const newId = () => crypto.randomBytes(5).toString('hex');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/admin') pathname = '/admin.html';
  const file = path.normalize(path.join(PUBLIC, pathname));
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

/* ---- маршруты ---- */
async function handleApi(req, res, url) {
  const p = url.pathname, m = req.method;
  const cfg = getConfig();
  const publicCfg = { shop: cfg.shop, services: cfg.services, timezone: cfg.timezone };

  if (m === 'GET' && p === '/api/config') return send(res, 200, publicCfg);

  if (m === 'GET' && p === '/api/availability') {
    const svc = S.getService(cfg, url.searchParams.get('service'));
    if (!svc) return send(res, 404, { error: 'Услуга не найдена' });
    return send(res, 200, { days: S.availability(cfg, allBookings(), svc) });
  }

  if (m === 'POST' && p === '/api/bookings') {
    if (rateLimit('book:' + req.socket.remoteAddress, 10, 60e3)) return send(res, 429, { error: 'Слишком много запросов, попробуйте позже' });
    const body = await readBody(req);
    const svc = S.getService(cfg, body.serviceId);
    if (!svc) return send(res, 404, { error: 'Услуга не найдена' });
    const cErr = S.validateContact(body); if (cErr) return send(res, 400, { error: cErr });
    const sErr = S.checkSlot(cfg, allBookings(), svc, body.date, body.time);
    if (sErr) return send(res, 409, { error: sErr });
    const b = { id: newId(), ...S.snapshot(cfg, svc, body.date, body.time), name: clean(body.name, 80), phone: clean(body.phone, 30), car: clean(body.car, 80), comment: clean(body.comment, 500), status: 'new', createdAt: new Date().toISOString() }; S.oilFields(cfg, svc, body, b);
    const me = clientOf(req);
    b.clientPhone = me ? me.phone : normPhone(b.phone);
    if (me && body.carId && carsOf(me.phone).some((c) => c.id === body.carId)) b.carId = clean(body.carId, 20);
    saveBooking(b);
    notify('🆕 Новая запись', b);
    return send(res, 201, { booking: b });
  }

  /* ----- клиент: вход по телефону (демо-OTP), профиль, авто, история ----- */
  if (m === 'POST' && p === '/api/auth/request') {
    const body = await readBody(req); const phone = normPhone(body.phone);
    if (phone.length < 10) return send(res, 400, { error: 'Введите номер телефона' });
    if (rateLimit('otp:' + req.socket.remoteAddress, 5, 60e3)) return send(res, 429, { error: 'Слишком часто, подождите минуту' });
    const code = DEMO_OTP || String(crypto.randomInt(1000, 10000));
    db.prepare('INSERT OR REPLACE INTO otps (phone,code,expires,tries) VALUES (?,?,?,0)').run(phone, code, Date.now() + 5 * 60e3);
    console.log(`[otp] ${phone}: ${code}`); // TODO: отправка SMS
    return send(res, 200, { ok: true, demoCode: DEMO_OTP || undefined });
  }
  if (m === 'POST' && p === '/api/auth/verify') {
    const body = await readBody(req); const phone = normPhone(body.phone);
    const o = db.prepare('SELECT * FROM otps WHERE phone=?').get(phone);
    if (!o || o.expires < Date.now() || o.tries >= 5) return send(res, 400, { error: 'Код устарел, запросите новый' });
    if (String(body.code || '').trim() !== o.code) { db.prepare('UPDATE otps SET tries=tries+1 WHERE phone=?').run(phone); return send(res, 400, { error: 'Неверный код' }); }
    db.prepare('DELETE FROM otps WHERE phone=?').run(phone);
    if (!db.prepare('SELECT 1 FROM clients WHERE phone=?').get(phone)) db.prepare('INSERT INTO clients (phone,name,created_at) VALUES (?,?,?)').run(phone, '', new Date().toISOString());
    const token = crypto.randomBytes(24).toString('hex');
    db.prepare('INSERT INTO sessions (token,phone,created_at) VALUES (?,?,?)').run(token, phone, new Date().toISOString());
    return send(res, 200, { token });
  }
  if (p === '/api/me' || p.startsWith('/api/me/')) {
    const me = clientOf(req);
    if (!me) return send(res, 401, { error: 'Нужно войти' });
    if (m === 'GET' && p === '/api/me') {
      const history = allBookings().filter((b) => (b.clientPhone || normPhone(b.phone)) === me.phone).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
      return send(res, 200, { client: me, cars: carsOf(me.phone), history, loyalty: loyaltyOf(me.phone) });
    }
    if (m === 'PATCH' && p === '/api/me') { const body = await readBody(req); db.prepare('UPDATE clients SET name=? WHERE phone=?').run(clean(body.name, 80), me.phone); return send(res, 200, { ok: true }); }
    if (m === 'POST' && p === '/api/me/logout') { db.prepare('DELETE FROM sessions WHERE token=?').run(String(req.headers['x-client-token'])); return send(res, 200, { ok: true }); }
    if (m === 'DELETE' && p === '/api/me') {
      for (const t of ['sessions', 'cars', 'clients']) db.prepare(`DELETE FROM ${t} WHERE phone=?`).run(me.phone);
      for (const b of allBookings()) if (b.clientPhone === me.phone) { delete b.clientPhone; delete b.carId; saveBooking(b); } // записи остаются у сервиса, но отвязаны
      return send(res, 200, { ok: true });
    }
    if (m === 'POST' && p === '/api/me/cars') {
      const body = await readBody(req); const c = cleanCar(body); c.id = newId();
      if (!c.model) return send(res, 400, { error: 'Укажите марку и модель' });
      const first = !carsOf(me.phone).length; saveCar(me.phone, c); if (first || body.primary) setPrimary(me.phone, c.id);
      return send(res, 201, { car: c });
    }
    const cm = p.match(/^\/api\/me\/cars\/([a-f0-9]+)$/);
    if (cm) {
      const r = db.prepare('SELECT json FROM cars WHERE id=? AND phone=?').get(cm[1], me.phone);
      if (!r) return send(res, 404, { error: 'Авто не найдено' });
      if (m === 'DELETE') { db.prepare('DELETE FROM cars WHERE id=?').run(cm[1]); const rest = carsOf(me.phone); if (rest.length && !rest.some((c) => c.primary)) setPrimary(me.phone, rest[0].id); return send(res, 200, { ok: true }); }
      if (m === 'PATCH') { const body = await readBody(req); const c = cleanCar(body, JSON.parse(r.json)); saveCar(me.phone, c); if (body.primary) setPrimary(me.phone, c.id); return send(res, 200, { car: c }); }
    }
    return send(res, 404, { error: 'Не найдено' });
  }

  /* ----- админ ----- */
  if (p.startsWith('/api/admin/')) {
    const auth = checkPin(req);
    if (auth === 'locked') return send(res, 429, { error: 'Слишком много попыток. Подождите 5 минут.' });
    if (auth !== 'ok') return send(res, 401, { error: 'Неверный PIN' });

    if (m === 'GET' && p === '/api/admin/ping') return send(res, 200, { ok: true });
    if (m === 'GET' && p === '/api/admin/bookings') {
      const isClient = new Set(db.prepare('SELECT phone FROM clients').all().map((r) => r.phone));
      const cache = {};
      const list = allBookings().map((b) => { const ph = b.clientPhone; if (!ph || !isClient.has(ph)) return b; const l = cache[ph] || (cache[ph] = loyaltyOf(ph)); return l ? { ...b, loyalty: { tier: l.tier.title || l.tier.name, percent: l.tier.percent, card: l.card, spent: l.spent } } : b; });
      return send(res, 200, { bookings: list });
    }
    if (m === 'GET' && p === '/api/admin/config') return send(res, 200, { config: cfg });

    if (m === 'PUT' && p === '/api/admin/config') {
      const body = await readBody(req);
      const err = S.validateConfig(body.config);
      if (err) return send(res, 400, { error: err });
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(body.config, null, 2));
      cfgCache = null; getConfig();
      return send(res, 200, { ok: true });
    }

    if (m === 'POST' && p === '/api/admin/bookings') { // запись вручную (по телефону)
      const body = await readBody(req);
      const svc = S.getService(cfg, body.serviceId);
      if (!svc) return send(res, 404, { error: 'Услуга не найдена' });
      const cErr = S.validateContact(body); if (cErr) return send(res, 400, { error: cErr });
      if (!body.force) { const sErr = S.checkSlot(cfg, allBookings(), svc, body.date, body.time); if (sErr) return send(res, 409, { error: sErr, canForce: true }); }
      const b = { id: newId(), ...S.snapshot(cfg, svc, body.date, body.time), name: clean(body.name, 80), phone: clean(body.phone, 30), car: clean(body.car, 80), comment: clean(body.comment, 500), status: 'confirmed', createdAt: new Date().toISOString(), manual: true }; S.oilFields(cfg, svc, body, b); b.clientPhone = normPhone(b.phone);
      saveBooking(b);
      return send(res, 201, { booking: b });
    }

    const mm = p.match(/^\/api\/admin\/bookings\/([a-f0-9]+)$/);
    if (mm) {
      const b = getBooking(mm[1]);
      if (!b) return send(res, 404, { error: 'Запись не найдена' });
      if (m === 'DELETE') { db.prepare('DELETE FROM bookings WHERE id=?').run(b.id); return send(res, 200, { ok: true }); }
      if (m === 'PATCH') {
        const body = await readBody(req);
        const next = { ...b };
        for (const k of ['name', 'phone', 'car', 'comment', 'ownerNote']) if (k in body) next[k] = clean(body[k], k === 'comment' || k === 'ownerNote' ? 500 : 80);
        if (['new', 'confirmed', 'done', 'cancelled'].includes(body.status)) next.status = body.status;
        const moved = (body.date && body.date !== b.date) || (body.time && body.time !== b.time);
        if (moved) {
          const svc = S.getService(cfg, b.serviceId) || { id: b.serviceId, mode: b.mode, durationMin: b.durationMin };
          if (!body.force && next.status !== 'cancelled') {
            const sErr = S.checkSlot(cfg, allBookings(), svc, body.date || b.date, body.time || b.time, undefined, b.id);
            if (sErr) return send(res, 409, { error: sErr, canForce: true });
          }
          Object.assign(next, S.snapshot(cfg, { ...svc, name: b.serviceName, price: b.price }, body.date || b.date, body.time || b.time));
        }
        saveBooking(next);
        if (next.status === 'done' && b.status !== 'done') applyToCar(next);
        if (moved) notify('🔁 Запись перенесена', next);
        else if (next.status === 'cancelled' && b.status !== 'cancelled') notify('❌ Запись отменена', next);
        return send(res, 200, { booking: next });
      }
    }
  }
  return send(res, 404, { error: 'Не найдено' });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (url.pathname === '/data' || url.pathname.startsWith('/data/')) { res.writeHead(404); return res.end(); }
    serveStatic(req, res, decodeURIComponent(url.pathname));
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 400, { error: 'Некорректный запрос' });
  }
}).listen(PORT, () => console.log(`Запись: http://localhost:${PORT}  ·  админка: http://localhost:${PORT}/admin  ·  Telegram: ${TG_TOKEN ? 'вкл' : 'выкл'}`));
