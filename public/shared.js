/* Общая логика расписания: работает и на сервере (Node), и в браузере (localStorage-режим). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shared = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const DAY_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  const DAY_FULL = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
  const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

  const pad = (n) => String(n).padStart(2, '0');
  const toMin = (hm) => { const [h, m] = String(hm || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
  const toHM = (min) => pad(Math.floor(min / 60)) + ':' + pad(min % 60);
  const dow = (d) => new Date(d + 'T00:00:00Z').getUTCDay();
  const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

  function nowIn(tz, now) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now || new Date());
    const g = (t) => parts.find((p) => p.type === t).value;
    return { date: `${g('year')}-${g('month')}-${g('day')}`, min: Number(g('hour')) * 60 + Number(g('minute')) };
  }

  const isActive = (b) => b.status !== 'cancelled';
  const getService = (cfg, id) => (cfg.services || []).find((s) => s.id === id);

  function pickupDateFor(service, date) {
    for (let i = 1; i <= 7; i++) if (dow(addDays(date, i)) === Number(service.pickupDay)) return addDays(date, i);
    return addDays(date, 1);
  }
  const pickupLabel = (s) => s.pickupNote || s.pickupTime || '';

  function formatDate(d, withYear) {
    const [y, m, dd] = d.split('-').map(Number);
    return `${DAY_SHORT[dow(d)]}, ${dd} ${MONTHS[m - 1]}${withYear ? ' ' + y : ''}`;
  }
  function formatDuration(min) {
    const h = Math.floor(min / 60), m = min % 60;
    return (h ? h + ' ч' : '') + (h && m ? ' ' : '') + (m ? m + ' мин' : '');
  }
  function describeSchedule(s) {
    if (s.mode === 'multiday')
      return `Заезд: ${DAY_FULL[s.dropoffDay]}, ${s.dropoffTime} · Выдача: ${DAY_FULL[s.pickupDay]}, ${pickupLabel(s)}`;
    return `Длительность: ${formatDuration(s.durationMin)}`;
  }

  /* Снимок брони по входным данным */
  function snapshot(cfg, service, date, time) {
    const b = { serviceId: service.id, serviceName: service.name, price: service.price, mode: service.mode || 'hourly', date, time };
    if (service.mode === 'multiday') {
      b.durationMin = 0;
      b.pickupDate = pickupDateFor(service, date);
      b.pickupLabel = pickupLabel(service);
    } else {
      b.durationMin = Number(service.durationMin) || 60;
      b.endTime = toHM(toMin(time) + b.durationMin);
    }
    return b;
  }

  /* Проверка, можно ли поставить бронь. excludeId — при переносе. Возвращает строку-ошибку или null */
  function checkSlot(cfg, bookings, service, date, time, now, excludeId) {
    const t = nowIn(cfg.timezone, now);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{2}:\d{2}$/.test(time || '')) return 'Неверная дата или время';
    if ((cfg.closedDates || []).includes(date)) return 'В этот день не работаем';
    const lead = (cfg.minLeadHours || 0) * 60;
    if (date < t.date || (date === t.date && toMin(time) < t.min + lead)) return 'Это время уже недоступно';
    if (date > addDays(t.date, cfg.horizonDays || 21)) return 'Слишком далёкая дата';
    const others = bookings.filter((b) => isActive(b) && b.id !== excludeId);
    if (service.mode === 'multiday') {
      if (dow(date) !== Number(service.dropoffDay)) return `Заезд возможен только в: ${DAY_FULL[service.dropoffDay]}`;
      if (time !== service.dropoffTime) return 'Неверное время заезда';
      const n = others.filter((b) => b.serviceId === service.id && b.date === date).length;
      if (n >= (service.capacityPerDay || 1)) return 'На эту дату мест нет';
      return null;
    }
    const h = (cfg.hours || {})[dow(date)];
    if (!h) return 'В этот день не работаем';
    const dur = Number(service.durationMin) || 60;
    const s = toMin(time), e = s + dur;
    if (s < toMin(h.open) || e > toMin(h.close)) return 'Вне рабочих часов';
    const busy = others.filter((b) => b.mode !== 'multiday' && b.date === date && toMin(b.time) < e && toMin(b.time) + (b.durationMin || 60) > s).length;
    if (busy >= (cfg.bays || 1)) return 'Это время уже занято';
    return null;
  }

  /* Свободные даты и слоты для услуги */
  function availability(cfg, bookings, service, now) {
    const t = nowIn(cfg.timezone, now);
    const out = [];
    const step = cfg.slotStepMin || 60;
    for (let i = 0; i <= (cfg.horizonDays || 21); i++) {
      const date = addDays(t.date, i);
      let times = [];
      if (service.mode === 'multiday') {
        if (dow(date) === Number(service.dropoffDay) && !checkSlot(cfg, bookings, service, date, service.dropoffTime, now)) times = [service.dropoffTime];
      } else {
        const h = (cfg.hours || {})[dow(date)];
        if (h) for (let m = toMin(h.open); m + (Number(service.durationMin) || 60) <= toMin(h.close); m += step)
          if (!checkSlot(cfg, bookings, service, date, toHM(m), now)) times.push(toHM(m));
      }
      if (times.length) {
        const d = { date, times };
        if (service.mode === 'multiday') { d.pickupDate = pickupDateFor(service, date); d.pickupLabel = pickupLabel(service); }
        out.push(d);
      }
    }
    return out;
  }

  function validateContact(b) {
    const name = String(b.name || '').trim(), phone = String(b.phone || '').trim(), car = String(b.car || '').trim();
    if (name.length < 2) return 'Укажите имя';
    if (phone.replace(/\D/g, '').length < 7) return 'Укажите телефон';
    if (car.length < 2) return 'Укажите автомобиль';
    return null;
  }

  function validateConfig(c) {
    if (!c || typeof c !== 'object') return 'Конфиг пустой';
    if (!Array.isArray(c.services) || !c.services.length) return 'Нужна хотя бы одна услуга';
    const ids = new Set();
    for (const s of c.services) {
      if (!s.id || !/^[a-z0-9_-]+$/i.test(s.id)) return 'У услуги неверный id';
      if (ids.has(s.id)) return 'Повторяющийся id: ' + s.id;
      ids.add(s.id);
      if (!s.name) return 'У услуги нет названия';
      if (s.mode === 'multiday') {
        if (![0, 1, 2, 3, 4, 5, 6].includes(Number(s.dropoffDay)) || ![0, 1, 2, 3, 4, 5, 6].includes(Number(s.pickupDay))) return 'Неверные дни заезда/выдачи у ' + s.name;
        if (!/^\d{2}:\d{2}$/.test(s.dropoffTime || '')) return 'Неверное время заезда у ' + s.name;
      } else if (!(Number(s.durationMin) >= 15)) return 'Длительность должна быть от 15 минут: ' + s.name;
    }
    return null;
  }

  /* Доп. поля замены масла + «следующая замена» (основа для напоминаний) */
  function oilFields(cfg, service, input, b) {
    const n = (v) => { const x = parseInt(String(v || '').replace(/\D/g, ''), 10); return isNaN(x) ? '' : x; };
    b.year = n(input.year); b.mileage = n(input.mileage); b.oil = input.oil === 'own' ? 'own' : 'ours';
    const r = cfg.reminder || { months: 6, km: 10000 };
    if (service.reminder) {
      const d = new Date(b.date + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + (r.months || 6));
      b.nextChange = { date: d.toISOString().slice(0, 10), km: b.mileage !== '' ? b.mileage + (r.km || 10000) : '+' + (r.km || 10000) };
    }
    return b;
  }
  return { oilFields, DAY_SHORT, DAY_FULL, MONTHS, toMin, toHM, dow, addDays, nowIn, isActive, getService, pickupDateFor, pickupLabel, formatDate, formatDuration, describeSchedule, snapshot, checkSlot, availability, validateContact, validateConfig };
});
