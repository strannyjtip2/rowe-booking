(function () {
  const S = window.Shared, Api = window.Api, A = Api.admin;
  const $app = document.getElementById('app'), $bar = document.getElementById('bar');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const st = { tab: 'bookings', filter: 'upcoming', bookings: [], cfg: null, today: '' };
  const STATUS = { new: 'Новая', confirmed: 'Подтверждена', done: 'Выполнена', cancelled: 'Отменена' };
  const ORDER = [1, 2, 3, 4, 5, 6, 0];
  $bar.hidden = true;

  function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2000); }

  /* ---------- вход ---------- */
  function loginScreen(err) {
    $app.innerHTML = `<div class="pinbox"><img src="logo.png" alt=""><h1>Владелец</h1><p class="muted">Введите PIN</p>
      ${err ? `<div class="err">${esc(err)}</div>` : ''}
      <input id="pin" type="password" inputmode="numeric" autocomplete="current-password" autofocus>
      <p></p><button class="btn" id="go">Войти</button>
      ${Api.mode === 'local' ? '<p class="muted small">Демо-режим без сервера. PIN по умолчанию: 1234</p>' : ''}</div>`;
    const go = async () => {
      const pin = document.getElementById('pin').value;
      try { await A.login(pin); sessionStorage.setItem('bk_pin', pin); await start(); } catch (e) { loginScreen(e.message); }
    };
    document.getElementById('go').onclick = go;
    document.getElementById('pin').onkeydown = (e) => { if (e.key === 'Enter') go(); };
  }

  async function start() {
    st.cfg = await A.config();
    st.today = S.nowIn(st.cfg.timezone).date;
    await reload();
  }
  async function reload() { st.bookings = await A.list(); render(); }

  /* ---------- каркас ---------- */
  function render() {
    const tabs = [['bookings', 'Записи'], ['services', 'Услуги'], ['hours', 'График']];
    $app.innerHTML = `<header class="top"><div class="brand"><img src="logo.png" alt=""><div><h1>${esc(st.cfg.shop.name)}</h1><p>Панель владельца ${Api.mode === 'local' ? '· демо (локально)' : ''}</p></div></div></header>
      <div class="tabs">${tabs.map(([k, n]) => `<button data-tab="${k}" class="${st.tab === k ? 'on' : ''}">${n}</button>`).join('')}</div>
      <div id="body"></div>`;
    $app.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { st.tab = b.dataset.tab; render(); });
    ({ bookings: renderBookings, services: renderServices, hours: renderHours })[st.tab]();
  }

  /* ---------- записи ---------- */
  function renderBookings() {
    const f = st.filter;
    let list = st.bookings.filter((b) => f === 'cancelled' ? b.status === 'cancelled' : f === 'all' ? true : b.status !== 'cancelled' && b.status !== 'done' && (b.mode === 'multiday' ? b.pickupDate : b.date) >= st.today);
    const newCount = st.bookings.filter((b) => b.status === 'new').length;
    let html = `<button class="btn" id="add">＋ Добавить запись вручную</button>
      <div class="filters" style="margin-top:12px">${[['upcoming', 'Предстоящие'], ['all', 'Все'], ['cancelled', 'Отменённые']].map(([k, n]) => `<button class="chip ${f === k ? 'sel' : ''}" data-f="${k}">${n}</button>`).join('')}</div>
      ${newCount ? `<p class="small muted">Новых, ждут подтверждения: <b style="color:var(--accent)">${newCount}</b></p>` : ''}`;
    if (!list.length) html += '<p class="empty">Записей нет</p>';
    let last = '';
    for (const b of list) {
      if (b.date !== last) { last = b.date; html += `<div class="dayhead">${S.formatDate(b.date, true)}${b.date === st.today ? ' · сегодня' : ''}</div>`; }
      const tel = b.phone.replace(/[^+\d]/g, ''), wa = tel.replace(/\D/g, '');
      const when = b.mode === 'multiday' ? `Заезд ${b.time} → выдача ${S.formatDate(b.pickupDate)} ${esc(b.pickupLabel || '')}` : `${b.time}–${b.endTime}`;
      html += `<div class="card bk ${b.status}"><div class="t"><b>${esc(b.serviceName)}</b><span class="st">${STATUS[b.status]}</span></div>
        <div class="small muted">${when} · ${Number(b.price).toLocaleString("ru-RU")} ${esc(st.cfg.shop.currency || '')}</div>
        <div class="who"><b>${esc(b.name)}</b> · ${esc(b.car)}${b.year ? ' ' + esc(b.year) : ''}${b.mileage ? ' · ' + esc(b.mileage) + ' км' : ''} · масло ${b.oil === 'own' ? 'своё' : 'наше'}</div>
        ${b.loyalty ? `<div class="small">💳 ${esc(b.loyalty.tier)} · скидка ${esc(b.loyalty.percent)}% · карта ${esc(b.loyalty.card)}</div>` : '<div class="small muted">💳 без бонусной карты</div>'}
        ${b.nextChange ? `<div class="rem">🔔 След. замена: ${esc(S.formatDate(b.nextChange.date, true))} или ${esc(b.nextChange.km)} км</div>` : ''}
        <div class="small">📞 <a style="color:var(--accent)" href="tel:${esc(tel)}">${esc(b.phone)}</a>${b.comment ? '<br>💬 ' + esc(b.comment) : ''}${b.ownerNote ? '<br>📝 ' + esc(b.ownerNote) : ''}</div>
        <div class="acts">
          ${b.status === 'new' ? `<button class="btn sm" data-a="confirmed" data-id="${b.id}">✔ Подтвердить</button>` : ''}
          ${b.status === 'confirmed' ? `<button class="btn sm sec" data-a="done" data-id="${b.id}">Выполнена</button>` : ''}
          ${b.status !== 'cancelled' ? `<button class="btn sm sec" data-edit="${b.id}">Перенести / изменить</button>` : `<button class="btn sm sec" data-a="new" data-id="${b.id}">Восстановить</button>`}
          <a class="btn sm sec" href="https://wa.me/${wa}" target="_blank" rel="noopener">WhatsApp</a>
          ${b.status !== 'cancelled' ? `<button class="btn sm danger" data-a="cancelled" data-id="${b.id}">Отменить</button>` : `<button class="btn sm danger" data-del="${b.id}">Удалить</button>`}
        </div></div>`;
    }
    document.getElementById('body').innerHTML = html;
    document.getElementById('add').onclick = () => editSheet(null);
    $app.querySelectorAll('[data-f]').forEach((el) => el.onclick = () => { st.filter = el.dataset.f; renderBookings(); });
    $app.querySelectorAll('[data-edit]').forEach((el) => el.onclick = () => editSheet(st.bookings.find((b) => b.id === el.dataset.edit)));
    $app.querySelectorAll('[data-a]').forEach((el) => el.onclick = async () => {
      if (el.dataset.a === 'cancelled' && !confirm('Отменить запись? Время освободится.')) return;
      try { await A.update(el.dataset.id, { status: el.dataset.a }); toast('Готово'); await reload(); } catch (e) { alert(e.message); }
    });
    $app.querySelectorAll('[data-del]').forEach((el) => el.onclick = async () => { if (confirm('Удалить запись навсегда?')) { await A.remove(el.dataset.del); await reload(); } });
  }

  function editSheet(b) {
    const isNew = !b;
    const v = b || { serviceId: st.cfg.services[0].id, date: st.today, time: '10:00', name: '', phone: '', car: '', comment: '', ownerNote: '' };
    const ov = document.createElement('div'); ov.className = 'overlay';
    ov.innerHTML = `<div class="sheet"><h3>${isNew ? 'Новая запись' : 'Перенос / изменение'}</h3>
      <div id="se" ></div>
      ${isNew ? `<label>Услуга</label><select id="e-svc">${st.cfg.services.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select>` : `<p class="muted small">${esc(b.serviceName)}</p>`}
      <div class="grid2"><div><label>Дата</label><input id="e-date" type="date" value="${esc(v.date)}"></div>
      <div><label>Время ${!isNew && b.mode !== 'multiday' ? '(начало)' : ''}</label><input id="e-time" type="time" step="900" value="${esc(v.time)}"></div></div>
      <label>Имя</label><input id="e-name" value="${esc(v.name)}">
      <label>Телефон</label><input id="e-phone" type="tel" value="${esc(v.phone)}">
      <label>Автомобиль / адрес</label><input id="e-car" value="${esc(v.car)}">
      <label>Комментарий клиента</label><textarea id="e-comment">${esc(v.comment || '')}</textarea>
      ${isNew ? '' : `<label>Заметка для себя</label><textarea id="e-note">${esc(v.ownerNote || '')}</textarea>`}
      <p></p><button class="btn" id="e-save">Сохранить</button><p></p><button class="btn sec" id="e-close">Закрыть</button></div>`;
    document.body.appendChild(ov);
    const g = (id) => document.getElementById(id).value;
    document.getElementById('e-close').onclick = () => ov.remove();
    ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
    const show = (m) => { document.getElementById('se').innerHTML = m ? `<div class="err">${esc(m)}</div>` : ''; };
    if (isNew) {
      const sel = document.getElementById('e-svc');
      sel.onchange = () => { const s = S.getService(st.cfg, sel.value); if (s.mode === 'multiday') document.getElementById('e-time').value = s.dropoffTime; };
    }
    document.getElementById('e-save').onclick = async () => {
      const body = { date: g('e-date'), time: g('e-time'), name: g('e-name'), phone: g('e-phone'), car: g('e-car'), comment: g('e-comment') };
      if (!isNew) body.ownerNote = g('e-note');
      const run = async (force) => {
        try {
          if (isNew) await A.create({ ...body, serviceId: g('e-svc'), force }); else await A.update(b.id, { ...body, force });
          ov.remove(); toast('Сохранено'); await reload();
        } catch (e) {
          if (e.canForce && !force) { if (confirm(e.message + '.\nВсё равно сохранить на это время?')) return run(true); } else show(e.message);
        }
      };
      run(false);
    };
  }

  /* ---------- общие помощники для форм конфига ---------- */
  const getP = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
  function setP(o, p, v) { const ks = p.split('.'); const last = ks.pop(); const t = ks.reduce((x, k) => x[k], o); if (v === '' || v == null) delete t[last]; else t[last] = v; }
  function inp(p, label, o = {}) {
    const val = getP(st.cfg, p);
    return `<div><label>${label}</label><input data-p="${p}" ${o.num ? 'data-num="1" inputmode="decimal"' : ''} ${o.type ? `type="${o.type}"` : ''} value="${esc(val == null ? '' : val)}" ${o.ph ? `placeholder="${esc(o.ph)}"` : ''}></div>`;
  }
  function bindInputs(root) {
    root.querySelectorAll('[data-p]').forEach((el) => {
      el.oninput = el.onchange = () => {
        let v = el.value;
        if (el.dataset.num && v !== '') v = Number(v);
        if (el.tagName === 'SELECT') v = Number(v);
        setP(st.cfg, el.dataset.p, v);
      };
    });
  }
  async function saveCfg() {
    try { await A.saveConfig(st.cfg); toast('Сохранено ✔'); } catch (e) { alert(e.message); }
  }

  /* ---------- услуги ---------- */
  function renderServices() {
    const dayOpts = (i, key) => `<select data-p="services.${i}.${key}" data-sel="1">${ORDER.map((d) => `<option value="${d}" ${Number(st.cfg.services[i][key]) === d ? 'selected' : ''}>${S.DAY_FULL[d]}</option>`).join('')}</select>`;
    document.getElementById('body').innerHTML = `<p class="muted small">Здесь задаются услуги: название, цена, длительность. Для многодневных работ (керамика и т.п.) укажите день и время заезда и выдачу.</p>` +
      st.cfg.services.map((s, i) => `<div class="card svc-ed"><h4>${esc(s.name || 'Новая услуга')}</h4>
        ${inp(`services.${i}.name`, 'Название')}
        ${inp(`services.${i}.desc`, 'Описание')}
        <div class="grid2">${inp(`services.${i}.price`, 'Цена (' + esc(st.cfg.shop.currency || '') + ')', { num: 1 })}
        <div><label>Тип</label><select data-mode="${i}"><option value="hourly" ${s.mode !== 'multiday' ? 'selected' : ''}>В течение дня</option><option value="multiday" ${s.mode === 'multiday' ? 'selected' : ''}>Несколько дней</option></select></div></div>
        ${s.mode === 'multiday' ? `
          <div class="grid2"><div><label>День заезда</label>${dayOpts(i, 'dropoffDay')}</div>${inp(`services.${i}.dropoffTime`, 'Время заезда', { type: 'time' })}</div>
          <div class="grid2"><div><label>День выдачи</label>${dayOpts(i, 'pickupDay')}</div>${inp(`services.${i}.pickupNote`, 'Выдача (текст)', { ph: 'после обеда' })}</div>
          <div class="grid2">${inp(`services.${i}.pickupTime`, 'Время выдачи', { type: 'time' })}${inp(`services.${i}.capacityPerDay`, 'Машин за заезд', { num: 1 })}</div>`
        : `<div class="grid2">${inp(`services.${i}.durationMin`, 'Длительность, мин', { num: 1 })}<div></div></div>`}
        <p></p><button class="btn sm danger" data-rm="${i}">Удалить услугу</button></div>`).join('') +
      `<button class="btn sec" id="addsvc">＋ Добавить услугу</button><p></p><button class="btn" id="save">Сохранить</button>
       <details><summary>Расширенно: весь конфиг как JSON</summary><textarea class="json" id="json">${esc(JSON.stringify(st.cfg, null, 2))}</textarea><p></p><button class="btn sec" id="savejson">Применить JSON</button></details>`;
    const body = document.getElementById('body');
    bindInputs(body);
    body.querySelectorAll('[data-mode]').forEach((el) => el.onchange = () => {
      const s = st.cfg.services[el.dataset.mode]; s.mode = el.value;
      if (s.mode === 'multiday') Object.assign(s, { dropoffDay: 5, dropoffTime: '10:00', pickupDay: 0, pickupTime: '14:00', pickupNote: 'после обеда', capacityPerDay: 2, durationMin: 0 });
      else { s.durationMin = 60; ['dropoffDay', 'dropoffTime', 'pickupDay', 'pickupTime', 'pickupNote', 'capacityPerDay'].forEach((k) => delete s[k]); }
      renderServices();
    });
    body.querySelectorAll('[data-rm]').forEach((el) => el.onclick = () => { if (confirm('Удалить услугу? Старые записи сохранятся.')) { st.cfg.services.splice(el.dataset.rm, 1); renderServices(); } });
    document.getElementById('addsvc').onclick = () => { st.cfg.services.push({ id: 's' + Math.random().toString(36).slice(2, 7), name: '', desc: '', price: 0, durationMin: 60, mode: 'hourly' }); renderServices(); window.scrollTo(0, document.body.scrollHeight); };
    document.getElementById('save').onclick = saveCfg;
    document.getElementById('savejson').onclick = () => { try { st.cfg = JSON.parse(document.getElementById('json').value); saveCfg().then(renderServices); } catch (e) { alert('Ошибка JSON: ' + e.message); } };
  }

  /* ---------- график ---------- */
  function renderHours() {
    const c = st.cfg;
    document.getElementById('body').innerHTML = `<h2 style="margin-top:4px">Рабочие часы</h2>
      <div class="card">${ORDER.map((d) => { const h = c.hours[d]; return `<div class="hrs"><b>${S.DAY_SHORT[d]}</b>
        <input type="time" data-h="${d}" data-k="open" value="${h ? h.open : ''}" ${h ? '' : 'disabled'}>
        <input type="time" data-h="${d}" data-k="close" value="${h ? h.close : ''}" ${h ? '' : 'disabled'}>
        <input type="checkbox" data-off="${d}" title="выходной" ${h ? '' : 'checked'} style="width:22px;height:22px"></div>`; }).join('')}
        <p class="small muted">Галочка справа = выходной.</p></div>
      <h2>Параметры записи</h2><div class="card">
        <div class="grid2">${inp('slotStepMin', 'Шаг времени, мин', { num: 1 })}${inp('bays', 'Постов (машин одновременно)', { num: 1 })}</div>
        <div class="grid2">${inp('horizonDays', 'Запись вперёд, дней', { num: 1 })}${inp('minLeadHours', 'Не позже чем за, ч', { num: 1 })}</div>
        <label>Нерабочие даты (ГГГГ-ММ-ДД через запятую)</label><input id="closed" value="${esc((c.closedDates || []).join(', '))}" placeholder="2026-12-02, 2026-12-03"></div>
      <h2>О студии</h2><div class="card">${inp('shop.name', 'Название')}${inp('shop.tagline', 'Подзаголовок')}${inp('shop.phone', 'Телефон')}${inp('shop.address', 'Адрес')}${inp('shop.currency', 'Валюта')}</div>
      <button class="btn" id="save">Сохранить</button>`;
    const body = document.getElementById('body');
    bindInputs(body);
    body.querySelectorAll('[data-h]').forEach((el) => el.onchange = () => { c.hours[el.dataset.h][el.dataset.k] = el.value; });
    body.querySelectorAll('[data-off]').forEach((el) => el.onchange = () => { c.hours[el.dataset.off] = el.checked ? null : { open: '09:00', close: '19:00' }; renderHours(); });
    document.getElementById('closed').oninput = (e) => { c.closedDates = e.target.value.split(/[\s,;]+/).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)); };
    document.getElementById('save').onclick = saveCfg;
  }

  (async function init() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    await Api.init();
    const pin = sessionStorage.getItem('bk_pin');
    if (pin) { try { await A.login(pin); return await start(); } catch (e) { sessionStorage.removeItem('bk_pin'); } }
    loginScreen();
  })();
})();
