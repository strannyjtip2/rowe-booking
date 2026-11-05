/* Слой данных: если есть сервер (/api) — работает с ним, иначе localStorage-режим (только это устройство). */
(function () {
  const S = window.Shared;
  const LS_CFG = 'bk_config', LS_BOOK = 'bk_bookings';
  let defaultCfg = null;

  const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
  const lsSet = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(5))).map((x) => x.toString(16).padStart(2, '0')).join('');
  const clean = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
  const fail = (msg, extra) => Object.assign(new Error(msg), extra || {});

  async function loadDefault() {
    if (defaultCfg) return defaultCfg;
    const r = await fetch('config.default.json');
    defaultCfg = await r.json();
    return defaultCfg;
  }
  const localCfg = async () => lsGet(LS_CFG, null) || (await loadDefault());

  async function req(method, url, body, pin) {
    const r = await fetch(url, { method, headers: { 'content-type': 'application/json', ...(pin ? { 'x-admin-pin': pin } : {}), ...(localStorage.getItem('rowe_token') ? { 'x-client-token': localStorage.getItem('rowe_token') } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw fail(data.error || 'Ошибка ' + r.status, { status: r.status, canForce: data.canForce });
    return data;
  }

  const Api = {
    mode: 'server',
    async init() {
      try {
        const r = await fetch('api/config', { cache: 'no-store' });
        if (!r.ok) throw 0;
        const ct = (r.headers.get('content-type') || '').toLowerCase();
        if (!ct.includes('json')) throw 0;
        const data = await r.json();
        if (!data || !data.shop || !Array.isArray(data.services)) throw 0;
        this.mode = 'server';
      } catch (e) { this.mode = 'local'; }
      return this.mode;
    },
    async config() {
      if (this.mode === 'server') return req('GET', 'api/config');
      const c = await localCfg();
      return { shop: c.shop, services: c.services, timezone: c.timezone };
    },
    async availability(serviceId) {
      if (this.mode === 'server') return (await req('GET', 'api/availability?service=' + encodeURIComponent(serviceId))).days;
      const c = await localCfg();
      return S.availability(c, lsGet(LS_BOOK, []), S.getService(c, serviceId));
    },
    async book(input) {
      if (this.mode === 'server') return (await req('POST', 'api/bookings', input)).booking;
      return localCreate(input, 'new', false);
    },
    admin: {
      pin: '',
      async login(pin) {
        if (Api.mode === 'server') { await req('GET', 'api/admin/ping', null, pin); }
        else { const c = await localCfg(); if (String(c.adminPin || '1234') !== String(pin)) throw fail('Неверный PIN'); }
        this.pin = pin;
      },
      async list() {
        if (Api.mode === 'server') return (await req('GET', 'api/admin/bookings', null, this.pin)).bookings;
        const books = lsGet(LS_BOOK, []).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
        const clients = lsGet('rowe_clients', {});
        return books.map((b) => {
          const ph = b.clientPhone || String(b.phone||'').replace(/\D/g,'');
          if (!clients[ph] || typeof loyaltyLocal !== 'function') return b;
          const l = loyaltyLocal(ph, books); if (!l) return b;
          return { ...b, loyalty: { tier: l.tier.title || l.tier.name, percent: l.tier.percent, card: l.card, spent: l.spent } };
        });
      },
      async config() {
        if (Api.mode === 'server') return (await req('GET', 'api/admin/config', null, this.pin)).config;
        return localCfg();
      },
      async saveConfig(config) {
        const err = S.validateConfig(config); if (err) throw fail(err);
        if (Api.mode === 'server') return req('PUT', 'api/admin/config', { config }, this.pin);
        const old = await localCfg(); config.adminPin = config.adminPin || old.adminPin; lsSet(LS_CFG, config);
      },
      async create(input) {
        if (Api.mode === 'server') return (await req('POST', 'api/admin/bookings', input, this.pin)).booking;
        return localCreate(input, 'confirmed', !!input.force);
      },
      async update(id, patch) {
        if (Api.mode === 'server') return (await req('PATCH', 'api/admin/bookings/' + id, patch, this.pin)).booking;
        const c = await localCfg(); const all = lsGet(LS_BOOK, []);
        const b = all.find((x) => x.id === id); if (!b) throw fail('Запись не найдена');
        const next = { ...b };
        for (const k of ['name', 'phone', 'car', 'comment', 'ownerNote']) if (k in patch) next[k] = clean(patch[k], 500);
        if (['new', 'confirmed', 'done', 'cancelled'].includes(patch.status)) next.status = patch.status;
        if ((patch.date && patch.date !== b.date) || (patch.time && patch.time !== b.time)) {
          const svc = S.getService(c, b.serviceId) || { id: b.serviceId, mode: b.mode, durationMin: b.durationMin };
          if (!patch.force && next.status !== 'cancelled') {
            const e = S.checkSlot(c, all, svc, patch.date || b.date, patch.time || b.time, undefined, id);
            if (e) throw fail(e, { canForce: true });
          }
          Object.assign(next, S.snapshot(c, { ...svc, name: b.serviceName, price: b.price }, patch.date || b.date, patch.time || b.time));
        }
        lsSet(LS_BOOK, all.map((x) => (x.id === id ? next : x)));
        return next;
      },
      async remove(id) {
        if (Api.mode === 'server') return req('DELETE', 'api/admin/bookings/' + id, null, this.pin);
        lsSet(LS_BOOK, lsGet(LS_BOOK, []).filter((x) => x.id !== id));
      },
    },
  };

  async function localCreate(input, status, force) {
    const c = await localCfg(); const all = lsGet(LS_BOOK, []);
    const svc = S.getService(c, input.serviceId); if (!svc) throw fail('Услуга не найдена');
    const ce = S.validateContact(input); if (ce) throw fail(ce);
    if (!force) { const e = S.checkSlot(c, all, svc, input.date, input.time); if (e) throw fail(e, { status: 409, canForce: true }); }
    const b = { id: newId(), ...S.snapshot(c, svc, input.date, input.time), name: clean(input.name, 80), phone: clean(input.phone, 30), car: clean(input.car, 80), comment: clean(input.comment, 500), status, createdAt: new Date().toISOString() };
    S.oilFields(c, svc, input, b); b.clientPhone = String(b.phone||"").replace(/\D/g,"").replace(/^8(\d{10})$/,"7$1"); if (input.carId) b.carId = clean(input.carId, 20);
    all.push(b); lsSet(LS_BOOK, all);
    return b;
  }

  /* ---- локальный аккаунт (для GitHub Pages / демо без сервера) ---- */
  const LS_CLI = 'rowe_clients', LS_SESS = 'rowe_sess', LS_OTP = 'rowe_otp', LS_CARS = 'rowe_cars';
  const normP = (p) => String(p || '').replace(/\D/g, '').replace(/^8(\d{10})$/, '7$1');
  const DEMO = '1111';
  function cardNo(phone) {
    let h = 0; for (let i = 0; i < phone.length; i++) h = (h * 31 + phone.charCodeAt(i)) >>> 0;
    return '7700' + String(h).padStart(12, '0').slice(-12);
  }
  function loyaltyLocal(phone, bookings) {
    const L = (lsGet(LS_CFG, null) || defaultCfg)?.loyalty; if (!L || !L.enabled) return null;
    const spent = bookings.filter((b) => b.status === 'done' && (b.clientPhone || normP(b.phone)) === phone).reduce((s, b) => s + (Number(b.price) || 0), 0);
    const tiers = [...(L.tiers || [])].sort((a, b) => a.from - b.from);
    let tier = tiers[0], next = null;
    for (const t of tiers) if (spent >= t.from) tier = t; else { next = t; break; }
    return { card: cardNo(phone), spent, tier, next, toNext: next ? next.from - spent : 0, tiers };
  }
  function localMe() {
    const tok = localStorage.getItem('rowe_token'); if (!tok) return null;
    const phone = lsGet(LS_SESS, {})[tok]; if (!phone) return null;
    const clients = lsGet(LS_CLI, {}); const client = clients[phone] || { phone, name: '', created_at: new Date().toISOString() };
    const cars = (lsGet(LS_CARS, {})[phone] || []).sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0));
    const history = lsGet(LS_BOOK, []).filter((b) => (b.clientPhone || normP(b.phone)) === phone).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
    return { client, cars, history, loyalty: loyaltyLocal(phone, lsGet(LS_BOOK, [])) };
  }
  function ensureLocalClient(phone) {
    const clients = lsGet(LS_CLI, {}); if (!clients[phone]) { clients[phone] = { phone, name: '', created_at: new Date().toISOString() }; lsSet(LS_CLI, clients); }
  }

  Api.authRequest = async (phone) => {
    phone = normP(phone); if (phone.length < 10) throw fail('Введите номер телефона');
    if (Api.mode === 'server') return req('POST', 'api/auth/request', { phone });
    const otps = lsGet(LS_OTP, {}); otps[phone] = { code: DEMO, expires: Date.now() + 5 * 60e3, tries: 0 }; lsSet(LS_OTP, otps);
    return { ok: true, demoCode: DEMO };
  };
  Api.authVerify = async (phone, code) => {
    phone = normP(phone);
    if (Api.mode === 'server') return req('POST', 'api/auth/verify', { phone, code });
    // Pages/local демо: код 1111 всегда принимаем (даже без OTP / после истечения / другой ключ телефона)
    if (String(code || '').trim() !== DEMO) {
      const otps = lsGet(LS_OTP, {}); const o = otps[phone];
      if (o) { o.tries = (o.tries || 0) + 1; lsSet(LS_OTP, otps); }
      throw fail('Неверный код. В демо введите ' + DEMO);
    }
    const otps = lsGet(LS_OTP, {}); delete otps[phone]; lsSet(LS_OTP, otps);
    if (phone.length < 10) throw fail('Введите номер телефона');
    ensureLocalClient(phone);
    const token = newId() + newId(); const sess = lsGet(LS_SESS, {}); sess[token] = phone; lsSet(LS_SESS, sess);
    return { token };
  };
  Api.me = async () => {
    if (Api.mode === 'server') return req('GET', 'api/me');
    const m = localMe(); if (!m) throw fail('Нужно войти', { status: 401 }); return m;
  };
  Api.mePatch = async (body) => {
    if (Api.mode === 'server') return req('PATCH', 'api/me', body);
    const m = localMe(); if (!m) throw fail('Нужно войти', { status: 401 });
    const clients = lsGet(LS_CLI, {}); clients[m.client.phone].name = clean(body.name, 80); lsSet(LS_CLI, clients); return { ok: true };
  };
  Api.meLogout = async () => {
    if (Api.mode === 'server') return req('POST', 'api/me/logout');
    const tok = localStorage.getItem('rowe_token'); const sess = lsGet(LS_SESS, {}); delete sess[tok]; lsSet(LS_SESS, sess); return { ok: true };
  };
  Api.meDelete = async () => {
    if (Api.mode === 'server') return req('DELETE', 'api/me');
    const m = localMe(); if (!m) throw fail('Нужно войти', { status: 401 });
    const ph = m.client.phone; const clients = lsGet(LS_CLI, {}); delete clients[ph]; lsSet(LS_CLI, clients);
    const cars = lsGet(LS_CARS, {}); delete cars[ph]; lsSet(LS_CARS, cars);
    const tok = localStorage.getItem('rowe_token'); const sess = lsGet(LS_SESS, {}); delete sess[tok]; lsSet(LS_SESS, sess);
    return { ok: true };
  };
  Api.carCreate = async (body) => {
    if (Api.mode === 'server') return req('POST', 'api/me/cars', body);
    const m = localMe(); if (!m) throw fail('Нужно войти', { status: 401 });
    if (!String(body.model || '').trim()) throw fail('Укажите марку и модель');
    const c = { id: newId(), ...body, primary: !m.cars.length || !!body.primary };
    const all = lsGet(LS_CARS, {}); const list = all[m.client.phone] || [];
    if (c.primary) list.forEach((x) => x.primary = false);
    list.push(c); all[m.client.phone] = list; lsSet(LS_CARS, all); return { car: c };
  };
  Api.carPatch = async (id, body) => {
    if (Api.mode === 'server') return req('PATCH', 'api/me/cars/' + id, body);
    const m = localMe(); if (!m) throw fail('Нужно войти', { status: 401 });
    const all = lsGet(LS_CARS, {}); const list = all[m.client.phone] || [];
    const i = list.findIndex((x) => x.id === id); if (i < 0) throw fail('Авто не найдено');
    Object.assign(list[i], body); if (body.primary) list.forEach((x) => x.primary = x.id === id);
    all[m.client.phone] = list; lsSet(LS_CARS, all); return { car: list[i] };
  };
  Api.carDelete = async (id) => {
    if (Api.mode === 'server') return req('DELETE', 'api/me/cars/' + id);
    const m = localMe(); if (!m) throw fail('Нужно войти', { status: 401 });
    const all = lsGet(LS_CARS, {}); let list = (all[m.client.phone] || []).filter((x) => x.id !== id);
    if (list.length && !list.some((x) => x.primary)) list[0].primary = true;
    all[m.client.phone] = list; lsSet(LS_CARS, all); return { ok: true };
  };

  window.Api = Api;
})();
