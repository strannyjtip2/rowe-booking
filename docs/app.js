(function () {
  const S = window.Shared, Api = window.Api;
  const $app = document.getElementById('app'), $bar = document.getElementById('bar');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const st = { cfg: null, svc: null, days: [], date: null, time: null, error: '', done: null, step: 1, mode: 'server' };
  const saved = JSON.parse(localStorage.getItem('bk_client') || '{}');
  const money = (n) => `${Number(n).toLocaleString("ru-RU")} ${st.cfg.shop.currency || ''}`.trim();

  function bar(html, onclick) {
    if (!html) { $bar.hidden = true; return; }
    $bar.hidden = false; $bar.firstElementChild.innerHTML = html;
    const b = $bar.querySelector('[data-go]'); if (b && onclick) b.onclick = onclick;
  }
  function header() {
    const sh = st.cfg.shop;
    return `<header class="top"><img class="banner" src="logo.png" alt="${esc(sh.name)}"><p>${esc(sh.tagline || '')}</p>
      ${st.mode === 'local' ? '<span class="badge">демо-режим: данные только на этом устройстве</span>' : ''}</header>`;
  }

  /* ---------- аккаунт клиента ---------- */
  const TK = 'rowe_token';
  async function call(method, url, body) {
    try {
      if (url === 'api/auth/request') return Api.authRequest(body.phone);
      if (url === 'api/auth/verify') return Api.authVerify(body.phone, body.code);
      if (url === 'api/me' && method === 'GET') return Api.me();
      if (url === 'api/me' && method === 'PATCH') return Api.mePatch(body);
      if (url === 'api/me/logout') return Api.meLogout();
      if (url === 'api/me' && method === 'DELETE') return Api.meDelete();
      if (url === 'api/me/cars' && method === 'POST') return Api.carCreate(body);
      const m = url.match(/^api\/me\/cars\/([a-f0-9]+)$/);
      if (m && method === 'PATCH') return Api.carPatch(m[1], body);
      if (m && method === 'DELETE') return Api.carDelete(m[1]);
    } catch (e) {
      if (e.status === 401) { localStorage.removeItem(TK); st.me = null; }
      throw e;
    }
    const r = await fetch(url, { method, headers: { 'content-type': 'application/json', 'x-client-token': localStorage.getItem(TK) || '' }, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401 && url !== 'api/auth/verify') { localStorage.removeItem(TK); st.me = null; }
    if (!r.ok) throw new Error(d.error || 'Ошибка ' + r.status);
    return d;
  }
  async function loadMe() { st.me = null; if (!localStorage.getItem(TK)) return; try { st.me = await call('GET', 'api/me'); } catch (e) {} }
  const primaryCar = () => st.me && (st.me.cars.find((c) => c.primary) || st.me.cars[0]);
  const fmtPhone = (p) => { const d = String(p || ''); return d.length === 11 && d[0] === '7' ? `+7 ${d.slice(1, 4)} ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9)}` : '+' + d; };
  function dock(cur) {
    const root = document.getElementById('dock') || (() => { const d = document.createElement('nav'); d.id = 'dock'; d.className = 'dock'; document.body.appendChild(d); return d; })();
    let items;
    if (cur === 'login') items = [['book', '🏠', 'Домой'], ['login', '👤', 'Войти']];
    else if (!st.me) items = [['book', '🏠', 'Домой'], ['login', '👤', 'Войти']];
    else {
      items = [['book', '🏠', 'Домой'], ['cars', '🚗', 'Авто'], ['history', '📋', 'История']];
      if (st.me.loyalty) items.push(['bonus', '💳', 'Бонусы']);
      items.push(['profile', '👤', 'Профиль']);
    }
    root.innerHTML = items.map(([k, ico, l]) => `<button type="button" class="${k === cur ? 'on' : ''}" data-nav="${k}"><span class="ico">${ico}</span><span>${l}</span></button>`).join('');
    root.querySelectorAll('[data-nav]').forEach((el) => el.onclick = () => go(el.dataset.nav));
    document.body.classList.add('has-dock');
  }
  function bindNav() { $app.querySelectorAll('[data-nav]').forEach((el) => el.onclick = () => go(el.dataset.nav)); }
  function go(k) { scrollTo(0, 0); ({ book: () => stepServices(), login: () => viewLogin(), cars: viewCars, history: viewHistory, profile: viewProfile, bonus: viewBonus })[k](); }
  const page = (cur, title, html) => { $app.innerHTML = `<header class="top"></header><h2>${title}</h2>` + html; bar(null); dock(cur); bindNav(); };

  function viewLogin(phone, sent, err, demo) {
    page('login', 'Вход по телефону', `${err ? `<div class="err">${esc(err)}</div>` : ''}
      <div class="card"><label for="l-phone">Телефон</label><input id="l-phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+7 900 000-00-00" value="${esc(phone || '')}" ${sent ? 'readonly' : ''}>
      ${sent ? `<label for="l-code">Код из SMS</label><input id="l-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••">
        <div class="demo">Демо-режим: SMS не отправляется, код <b>${esc(demo || '1111')}</b></div>
        <button class="back" id="l-chg">Изменить номер</button>` : '<p class="muted small">Пришлём код подтверждения. Вход нужен, чтобы сохранять авто и историю визитов.</p>'}</div>
      <button class="back" data-nav="book">← К записи без входа</button>`);
    if (sent) document.getElementById('l-chg').onclick = () => viewLogin(phone);
    bar(`<button class="btn" data-go>${sent ? 'Войти' : 'Получить код'}</button>`, async () => {
      const ph = document.getElementById('l-phone').value;
      try {
        if (!sent) {
          const r = await call('POST', 'api/auth/request', { phone: ph });
          return viewLogin(ph, true, '', r.demoCode || '1111');
        }
        const r = await call('POST', 'api/auth/verify', { phone: ph, code: document.getElementById('l-code').value });
        localStorage.setItem(TK, r.token); await loadMe();
        if (!st.me) throw new Error('Не удалось загрузить профиль');
        if (st.pendingCar) { try { await call('POST', 'api/me/cars', st.pendingCar); } catch (e) {} st.pendingCar = null; await loadMe(); return viewCars(); }
        if (!st.me.client.name) return viewProfile(); stepServices();
      } catch (e) { viewLogin(ph, sent, e.message, demo || '1111'); }
    });
  }

  function viewProfile() {
    const c = st.me.client;
    page('profile', 'Профиль', `<div class="card"><label for="p-name">Имя</label><input id="p-name" autocomplete="name" placeholder="Как к вам обращаться" value="${esc(c.name || '')}">
      <label>Телефон</label><input value="${esc(fmtPhone(c.phone))}" readonly></div>
      ${st.me.loyalty ? `<button class="card bonus-link" data-nav="bonus"><span>💳 Бонусная карта</span><b>${esc(st.me.loyalty.tier.title)} · ${esc(st.me.loyalty.tier.percent)}%</b><span class="muted">›</span></button>` : ''}
      <button class="btn" id="p-save">Сохранить</button><p style="height:10px"></p>
      <button class="btn sec" id="p-out">Выйти</button><p style="height:24px"></p>
      <button class="btn danger" id="p-del">Удалить аккаунт</button>
      <p class="muted small center">Удаляются профиль и авто. Записи остаются у сервиса без привязки к аккаунту.</p>`);
    document.getElementById('p-save').onclick = async () => { await call('PATCH', 'api/me', { name: document.getElementById('p-name').value }); await loadMe(); viewProfile(); };
    document.getElementById('p-out').onclick = async () => { await call('POST', 'api/me/logout').catch(() => {}); localStorage.removeItem(TK); st.me = null; stepServices(); };
    document.getElementById('p-del').onclick = async () => { if (!confirm('Удалить аккаунт и все авто?')) return; await call('DELETE', 'api/me'); localStorage.removeItem(TK); st.me = null; stepServices(); };
  }

  function viewBonus() {
    const L = st.me.loyalty; if (!L) return viewProfile();
    const grp = (s) => s.replace(/(\d{4})(?=\d)/g, '$1 ');
    let qr = '';
    try { const q = qrcode(0, 'M'); q.addData('ROWE:' + L.card); q.make(); qr = q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); } catch (e) {}
    const pct = L.next ? Math.min(100, Math.round((L.spent - L.tier.from) / (L.next.from - L.tier.from) * 100)) : 100;
    page('bonus', 'Бонусная карта', `<div class="lcard" style="--tc:${esc(L.tier.color || '#E02A1F')}">
        <div class="lc-top"><img src="logo.png" alt="ROWE"><span class="lc-tier">${esc(L.tier.name)}</span></div>
        <div class="lc-pct">${esc(L.tier.percent)}%<small>скидка уровня «${esc(L.tier.title)}»</small></div>
        <div class="lc-no">${esc(grp(L.card))}</div><div class="lc-name">${esc(st.me.client.name || '')}</div></div>
      <div class="card qrbox"><div class="qr">${qr}</div><div class="muted small center">Покажите QR или номер карты на кассе</div></div>
      <h2>Уровень</h2><div class="card">
        <div class="kv"><span>Сумма выполненных записей</span><span>${money(L.spent)}</span></div>
        ${L.next ? `<div class="prog"><i style="width:${pct}%"></i></div><div class="small">До уровня «${esc(L.next.title)}» (${esc(L.next.percent)}%) осталось <b>${money(L.toNext)}</b></div>` : '<div class="small">У вас максимальный уровень 🎉</div>'}
      </div>
      <div class="card">${L.tiers.map((t) => `<div class="kv ${t.id === L.tier.id ? 'cur' : ''}"><span>${esc(t.title)} (${esc(t.name)})</span><span>${esc(t.percent)}% · от ${money(t.from)}</span></div>`).join('')}</div>`);
  }

  const carLine = (c) => esc(c.model) + (c.plate ? ` · <span class="plate">${esc(c.plate)}</span>` : '');
  function viewCars() {
    const cars = st.me.cars;
    page('cars', 'Мои авто', (cars.length ? cars.map((c) => `<div class="card carc ${c.primary ? 'prim' : ''}">
        <div class="t"><b>${carLine(c)}</b>${c.primary ? '<span class="st">Основное</span>' : ''}</div>
        <div class="kv"><span>Масло</span><span>${esc(c.oilType || '—')}${c.volume ? ', ' + esc(c.volume) + ' л' : ''}</span></div>
        <div class="kv"><span>Пробег при замене</span><span>${c.lastMileage ? esc(c.lastMileage) + ' км' : '—'}${c.lastDate ? ' · ' + esc(S.formatDate(c.lastDate, true)) : ''}</span></div>
        <div class="kv"><span>Следующая замена</span><span class="rem">${c.nextKm ? esc(c.nextKm) + ' км' : ''}${c.nextKm && c.nextDate ? ' или ' : ''}${c.nextDate ? esc(S.formatDate(c.nextDate, true)) : ''}${!c.nextKm && !c.nextDate ? '—' : ''}</span></div>
        <div class="acts"><button class="btn sm sec" data-ed="${c.id}">Изменить</button>${c.primary ? '' : `<button class="btn sm sec" data-pr="${c.id}">Сделать основным</button>`}</div></div>`).join('')
      : '<p class="empty">Добавьте авто — данные будут подставляться при записи.</p>') + '<button class="btn" id="c-add">+ Добавить авто</button>');
    document.getElementById('c-add').onclick = () => viewCarEdit();
    $app.querySelectorAll('[data-ed]').forEach((el) => el.onclick = () => viewCarEdit(cars.find((c) => c.id === el.dataset.ed)));
    $app.querySelectorAll('[data-pr]').forEach((el) => el.onclick = async () => { await call('PATCH', 'api/me/cars/' + el.dataset.pr, { primary: true }); await loadMe(); viewCars(); });
  }
  function viewCarEdit(c, err) {
    const v = c || {};
    const f = (id, l, ph, extra) => `<div><label for="c-${id}">${l}</label><input id="c-${id}" placeholder="${ph}" value="${esc(v[id] || '')}" ${extra || ''}></div>`;
    page('cars', c ? 'Изменить авто' : 'Новое авто', `${err ? `<div class="err">${esc(err)}</div>` : ''}<div class="card">
      ${f('model', 'Марка и модель', 'Toyota Camry')}<div class="grid2">${f('plate', 'Госномер', 'А123ВС777')}${f('year', 'Год', '2019', 'inputmode="numeric"')}</div>
      <div class="grid2">${f('oilType', 'Залитое масло', 'ROWE 5W-30')}${f('volume', 'Объём, л', '4.5', 'inputmode="decimal"')}</div>
      <div class="grid2">${f('lastMileage', 'Пробег при замене', '85000', 'inputmode="numeric"')}<div><label for="c-lastDate">Дата замены</label><input id="c-lastDate" type="date" value="${esc(v.lastDate || '')}"></div></div>
      <div class="grid2">${f('nextKm', 'След. замена, км', '95000', 'inputmode="numeric"')}<div><label for="c-nextDate">След. замена, дата</label><input id="c-nextDate" type="date" value="${esc(v.nextDate || '')}"></div></div>
      </div><button class="back" data-nav="cars">← Мои авто</button>${c ? '<button class="btn danger sm" id="c-del" style="margin-top:14px">Удалить авто</button>' : ''}`);
    if (c) document.getElementById('c-del').onclick = async () => { if (!confirm('Удалить авто?')) return; await call('DELETE', 'api/me/cars/' + c.id); await loadMe(); viewCars(); };
    bar('<button class="btn" data-go>Сохранить</button>', async () => {
      const body = {}; for (const k of ['model', 'plate', 'year', 'oilType', 'volume', 'lastMileage', 'lastDate', 'nextKm', 'nextDate']) body[k] = document.getElementById('c-' + k).value;
      try { await call(c ? 'PATCH' : 'POST', 'api/me/cars' + (c ? '/' + c.id : ''), body); await loadMe(); viewCars(); } catch (e) { viewCarEdit(c ? { ...c, ...body } : null, e.message); }
    });
  }

  const STATUS = { new: 'Ожидает подтверждения', confirmed: 'Подтверждена', done: 'Выполнена', cancelled: 'Отменена' };
  function viewHistory() {
    const h = st.me.history;
    page('history', 'История визитов', h.length ? h.map((b) => `<div class="card bk ${b.status}">
        <div class="t"><b>${esc(b.serviceName)}</b><span class="st">${STATUS[b.status] || ''}</span></div>
        <div class="small muted">${esc(S.formatDate(b.date, true))}, ${esc(b.time)} · ${money(b.price)}</div>
        <div class="small">${esc(b.car)}${b.mileage ? ' · ' + esc(b.mileage) + ' км' : ''}</div>
        ${b.nextChange && b.status !== 'cancelled' ? `<div class="rem">🔔 След. замена: ${esc(S.formatDate(b.nextChange.date, true))} или ${esc(b.nextChange.km)} км</div>` : ''}
        <button class="btn sm sec" data-rep="${esc(b.serviceId)}" style="margin-top:8px">Записаться снова</button></div>`).join('') : '<p class="empty">Пока нет визитов.</p>');
    $app.querySelectorAll('[data-rep]').forEach((el) => el.onclick = () => { if (S.getService(st.cfg, el.dataset.rep)) pickService(el.dataset.rep); });
  }

  async function nearestBlock() {
    if (st.lock) return `<div class="card near"><div class="near-h">⏱ Выбрано время</div><b class="near-t">${esc(S.formatDate(st.lock.date))}, ${esc(st.lock.time)}</b>
      <div class="muted small">Теперь выберите услугу ниже</div><button class="back" id="unlock">✕ Сбросить время</button></div>`;
    try {
      const def = st.cfg.services[0];
      const days = await Api.availability(def.id);
      const d = days[0]; if (!d) return '';
      const today = S.nowIn(st.cfg.timezone).date;
      const lbl = d.date === today ? 'сегодня' : d.date === S.addDays(today, 1) ? 'завтра' : S.formatDate(d.date);
      return `<div class="card near"><div class="near-h">⚡ Ближайшее окно — ${esc(lbl)}</div>
        <div class="near-slots">${d.times.slice(0, 4).map((t) => `<button class="chip" data-near="${d.date}|${t}">${t}</button>`).join('')}</div>
        <div class="muted small">Нажмите время — затем выберите услугу</div></div>`;
    } catch (e) { return ''; }
  }

  async function stepServices() {
    st.step = 1;
    const near = await nearestBlock();
    $app.innerHTML = header() + near + '<h2>Выберите услугу</h2>' + st.cfg.services.map((s) => `
      <button class="card svc" data-id="${esc(s.id)}">
        <div class="row"><b>${esc(s.name)}</b><span class="price">${s.price ? esc(s.priceFrom ? 'от ' : '') + money(s.price) : ''}</span></div>
        ${s.desc ? `<div class="desc">${esc(s.desc)}</div>` : ''}
        <span class="meta">${esc(S.describeSchedule(s))}</span>
      </button>`).join('') +
      `<p class="muted small center">${esc(st.cfg.shop.address || '')}${st.cfg.shop.phone ? ' · <a style="color:inherit" href="tel:' + esc(st.cfg.shop.phone.replace(/[^+\d]/g, '')) + '">' + esc(st.cfg.shop.phone) + '</a>' : ''}</p>`;
    bar(null);
    $app.querySelectorAll('.svc').forEach((el) => el.onclick = () => pickService(el.dataset.id));
    dock('book');
    $app.querySelectorAll('[data-near]').forEach((el) => el.onclick = () => { const [date, time] = el.dataset.near.split('|'); st.lock = { date, time }; stepServices(); scrollTo(0, 0); });
    const u = document.getElementById('unlock'); if (u) u.onclick = () => { st.lock = null; stepServices(); };
  }

  async function pickService(id) {
    st.svc = S.getService(st.cfg, id); st.date = st.time = null; st.error = '';
    $app.innerHTML = '<p class="empty">Загрузка свободного времени…</p>'; bar(null);
    try { st.days = await Api.availability(id); } catch (e) { st.days = []; st.error = e.message; }
    if (st.lock) {
      const L = st.lock; st.lock = null;
      const d = st.days.find((x) => x.date === L.date);
      if (d && d.times.includes(L.time)) { st.date = L.date; st.time = L.time; return stepForm(); }
      st.date = d ? L.date : null;
      st.error = `Время ${S.formatDate(L.date)}, ${L.time} не подходит для этой услуги (не хватает длительности). Выберите другое.`;
    }
    stepSlots();
  }

  function stepSlots() {
    st.step = 2;
    const s = st.svc, d = st.days.find((x) => x.date === st.date);
    const chips = st.days.map((x) => {
      const [, m, dd] = x.date.split('-');
      return `<button class="chip ${x.date === st.date ? 'sel' : ''}" data-d="${x.date}"><small>${S.DAY_SHORT[S.dow(x.date)]}</small><b>${Number(dd)}</b><small>${S.MONTHS[Number(m) - 1].slice(0, 3)}</small></button>`;
    }).join('');
    $app.innerHTML = `<button class="back" id="back">← Все услуги</button>
      <div class="card svc"><div class="row"><b>${esc(s.name)}</b><span class="price">${money(s.price)}</span></div><span class="meta">${esc(S.describeSchedule(s))}</span></div>
      ${st.error ? `<div class="err">${esc(st.error)}</div>` : ''}
      <h2>${s.mode === 'multiday' ? 'Дата заезда' : 'Дата'}</h2>
      ${st.days.length ? `<div class="days">${chips}</div>` : '<p class="empty">Свободных окон пока нет. Позвоните нам.</p>'}
      ${d ? `<h2>${s.mode === 'multiday' ? 'Время заезда' : 'Свободное время'}</h2><div class="times">${d.times.map((t) => `<button class="chip ${t === st.time ? 'sel' : ''}" data-t="${t}">${t}</button>`).join('')}</div>` : ''}
      ${d && s.mode === 'multiday' ? `<div class="info">🚗 Заезд: <b>${S.formatDate(d.date)}, ${d.times[0]}</b><br>🔑 Выдача: <b>${S.formatDate(d.pickupDate)}, ${esc(d.pickupLabel)}</b></div>` : ''}`;
    document.getElementById('back').onclick = () => stepServices();
    dock('book');
    $app.querySelectorAll('[data-d]').forEach((el) => el.onclick = () => { st.date = el.dataset.d; st.time = st.svc.mode === 'multiday' ? st.days.find((x) => x.date === st.date).times[0] : null; st.error = ''; stepSlots(); });
    $app.querySelectorAll('[data-t]').forEach((el) => el.onclick = () => { st.time = el.dataset.t; stepSlots(); });
    bar(`<button class="btn" data-go ${st.date && st.time ? '' : 'disabled'}>Продолжить</button>`, () => { if (st.date && st.time) stepForm(); });
  }

  const whenText = (b) => b.mode === 'multiday'
    ? `Заезд ${S.formatDate(b.date)}, ${b.time}`
    : `${S.formatDate(b.date)}, ${b.time}–${b.endTime}`;

  function stepForm(vals) {
    st.step = 3;
    const pc = primaryCar();
    const v = vals || (st.me ? { name: st.me.client.name || '', phone: fmtPhone(st.me.client.phone), car: pc ? pc.model + (pc.plate ? ' · ' + pc.plate : '') : '', year: pc ? pc.year || '' : '', mileage: '', oil: 'ours', comment: '', carId: pc ? pc.id : '' }
      : { name: saved.name || '', phone: saved.phone || '', car: saved.car || '', year: saved.year || '', mileage: '', oil: 'ours', comment: '' });
    const preview = S.snapshot(st.cfg, st.svc, st.date, st.time);
    $app.innerHTML = `<button class="back" id="back">← Выбор времени</button><h2>Ваши данные</h2>
      <div class="card sum">
        <div><span>Услуга</span><span>${esc(st.svc.name)}</span></div>
        <div><span>${preview.mode === 'multiday' ? 'Заезд' : 'Время'}</span><span>${esc(preview.mode === 'multiday' ? S.formatDate(st.date) + ', ' + st.time : S.formatDate(st.date) + ', ' + st.time + '–' + preview.endTime)}</span></div>
        ${preview.mode === 'multiday' ? `<div><span>Выдача</span><span>${esc(S.formatDate(preview.pickupDate) + ', ' + preview.pickupLabel)}</span></div>` : ''}
        <div><span>Стоимость</span><span>${money(st.svc.price)}</span></div>
      </div>
      ${st.error ? `<div class="err">${esc(st.error)}</div>` : ''}
      <label for="f-name">Имя</label><input id="f-name" autocomplete="name" value="${esc(v.name)}">
      <label for="f-phone">Телефон</label><input id="f-phone" type="tel" autocomplete="tel" inputmode="tel" placeholder="+971 …" value="${esc(v.phone)}">
      ${st.me && st.me.cars.length ? `<label for="f-carsel">Авто</label><select id="f-carsel">${st.me.cars.map((c) => `<option value="${c.id}" ${c.id === v.carId ? 'selected' : ''}>${esc(c.model)}${c.plate ? ' · ' + esc(c.plate) : ''}${c.primary ? ' (основное)' : ''}</option>`).join('')}<option value="" ${v.carId ? '' : 'selected'}>Другое авто…</option></select>
        ${pc && v.carId ? `<div class="demo">Подставлено из «Мои авто»${(st.me.cars.find((c) => c.id === v.carId) || {}).lastMileage ? ' · прошлая замена на ' + esc(st.me.cars.find((c) => c.id === v.carId).lastMileage) + ' км' : ''}</div>` : ''}` : ''}
      <label for="f-car">Марка и модель авто</label><input id="f-car" placeholder="Toyota Camry" value="${esc(v.car)}">
      <div class="grid2"><div><label for="f-year">Год</label><input id="f-year" inputmode="numeric" placeholder="2019" value="${esc(v.year)}"></div>
      <div><label for="f-mileage">Пробег, км</label><input id="f-mileage" inputmode="numeric" placeholder="85000" value="${esc(v.mileage)}"></div></div>
      <label for="f-oil">Масло</label><select id="f-oil"><option value="ours" ${v.oil !== 'own' ? 'selected' : ''}>Наше масло</option><option value="own" ${v.oil === 'own' ? 'selected' : ''}>Своё масло (привезу)</option></select>
      <label for="f-comment">Комментарий (необязательно)</label><textarea id="f-comment">${esc(v.comment)}</textarea>`;
    document.getElementById('back').onclick = () => { st.error = ''; stepSlots(); };
    dock('book');
    const sel = document.getElementById('f-carsel');
    if (sel) sel.onchange = () => { const c = st.me.cars.find((x) => x.id === sel.value); stepForm({ ...read(), carId: sel.value, car: c ? c.model + (c.plate ? ' · ' + c.plate : '') : '', year: c ? c.year || '' : '' }); };
    const read = () => ({ name: val('f-name'), phone: val('f-phone'), car: val('f-car'), year: val('f-year'), mileage: val('f-mileage'), oil: val('f-oil'), comment: val('f-comment'), carId: document.getElementById('f-carsel') ? document.getElementById('f-carsel').value : '' });
    bar(`<button class="btn" data-go>Записаться</button>`, async () => {
      const f = read(); const btn = $bar.querySelector('[data-go]');
      const ce = S.validateContact(f); if (ce) { st.error = ce; return stepForm(f); }
      btn.disabled = true; btn.textContent = 'Отправляем…';
      try {
        const b = await Api.book({ serviceId: st.svc.id, date: st.date, time: st.time, ...f });
        localStorage.setItem('bk_client', JSON.stringify({ name: f.name, phone: f.phone, car: f.car, year: f.year }));
        st.done = b; st.doneInput = f; if (st.me) await loadMe(); stepDone();
      } catch (e) {
        if (e.status === 409 || /занят|недоступ|нет/.test(e.message)) {
          st.error = e.message + '. Выберите другое время.'; st.days = await Api.availability(st.svc.id).catch(() => []);
          st.date = st.time = null; return stepSlots();
        }
        st.error = e.message; stepForm(f);
      }
    });
  }
  const val = (id) => document.getElementById(id).value;

  function ics(b) {
    const z = (d, t) => d.replace(/-/g, '') + 'T' + t.replace(':', '') + '00';
    const end = b.mode === 'multiday' ? z(b.pickupDate, '18:00') : z(b.date, b.endTime);
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//booking//RU', 'BEGIN:VEVENT', 'UID:' + b.id + '@booking', 'DTSTAMP:' + new Date().toISOString().replace(/[-:]|\.\d+/g, ''),
      'DTSTART;TZID=' + st.cfg.timezone + ':' + z(b.date, b.time), 'DTEND;TZID=' + st.cfg.timezone + ':' + end,
      'SUMMARY:' + b.serviceName + ' — ' + st.cfg.shop.name, 'LOCATION:' + (st.cfg.shop.address || ''), 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  }

  function stepDone() {
    st.step = 4; const b = st.done;
    $app.innerHTML = `<div class="ok-ico">✅</div><h2 class="center ok-h" style="margin-top:0">Вы записаны!</h2>
      <p class="center muted">Мы свяжемся с вами для подтверждения.</p>
      <div class="card sum">
        <div><span>Услуга</span><span>${esc(b.serviceName)}</span></div>
        <div><span>${b.mode === 'multiday' ? 'Заезд' : 'Время'}</span><span>${esc(whenText(b).replace('Заезд ', ''))}</span></div>
        ${b.mode === 'multiday' ? `<div><span>Выдача</span><span>${esc(S.formatDate(b.pickupDate) + ', ' + b.pickupLabel)}</span></div>` : ''}
        <div><span>Авто</span><span>${esc(b.car)}${b.year ? ', ' + esc(b.year) : ''}</span></div>
        ${b.mileage ? `<div><span>Пробег</span><span>${esc(b.mileage)} км</span></div>` : ''}
        <div><span>Масло</span><span>${b.oil === 'own' ? 'своё' : 'наше'}</span></div>
        ${b.nextChange ? `<div><span>След. замена</span><span class="rem">${esc(S.formatDate(b.nextChange.date, true))} или ${esc(b.nextChange.km)} км</span></div>` : ''}
        <div><span>Стоимость</span><span>${money(b.price)}</span></div>
        <div><span>Адрес</span><span>${esc(st.cfg.shop.address || '')}</span></div>
      </div>
      ${st.mode === 'server' && !st.me ? `<div class="card near"><div class="near-h">🚗 Сохранить авто?</div><div class="small">Войдите по телефону — авто, пробег и дата следующей замены сохранятся, а в следующий раз форма заполнится сама.</div><p style="height:8px"></p><button class="btn" id="save-car">Сохранить авто</button></div>` : ''}
      <button class="btn sec" id="ics">📅 Добавить в календарь</button>
      <p style="height:10px"></p><button class="btn sec" id="again">Записаться ещё</button>`;
    document.getElementById('again').onclick = () => stepServices();
    dock('book');
    const sc = document.getElementById('save-car');
    if (sc) sc.onclick = () => { const i = st.doneInput || {}; st.pendingCar = { model: i.car, year: i.year, lastMileage: i.mileage, nextKm: b.nextChange ? String(b.nextChange.km).replace('+', '') : '', nextDate: b.nextChange ? b.nextChange.date : '' }; viewLogin(i.phone); };
    document.getElementById('ics').onclick = () => {
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([ics(b)], { type: 'text/calendar' })); a.download = 'zapis.ics'; a.click();
    };
    bar(null);
  }

  (async function init() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    st.mode = await Api.init();
    st.cfg = await Api.config();
    await loadMe();
    document.title = st.cfg.shop.name + ' — запись';
    stepServices();
  })().catch((e) => { $app.innerHTML = '<p class="empty">Не удалось загрузить: ' + esc(e.message) + '</p>'; });
})();
