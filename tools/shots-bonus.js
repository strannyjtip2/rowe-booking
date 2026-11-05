// node tools/shots-bonus.js [base] [PIN] — вход тест-клиентом, бонусная карта, админка
const { chromium } = require('playwright-core');
const base = process.argv[2] || 'http://localhost:3210', pin = process.argv[3] || '4242';
const out = (n) => __dirname + '/../screenshots/' + n + '.png';
const PH = '+7 916 555-12-34';
const H = { 'x-admin-pin': pin, 'content-type': 'application/json' };
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
  const p = await ctx.newPage(); p.on('pageerror', (e) => console.error('PAGEERROR', e.message));
  await p.goto(base + '/'); await p.waitForSelector('[data-nav=login]'); await p.click('[data-nav=login]');
  await p.fill('#l-phone', PH); await p.click('[data-go]'); await p.waitForSelector('#l-code'); await p.fill('#l-code', '1111'); await p.click('[data-go]');
  await p.waitForSelector('.nav'); await p.click('[data-nav=profile]'); await p.waitForSelector('.bonus-link');
  await p.screenshot({ path: out('bonus-1-profile-link') });
  await p.click('.bonus-link'); await p.waitForSelector('.qr svg');
  await p.screenshot({ path: out('bonus-2-card-bronze'), fullPage: true });
  // добираем до Silver: прошлые визиты, отмеченные «Выполнена»
  for (const d of ['2026-06-10', '2026-08-12', '2026-09-20', '2026-10-15', '2026-10-30']) {
    const r = await (await fetch(base + '/api/admin/bookings', { method: 'POST', headers: H, body: JSON.stringify({ serviceId: 'to', date: d, time: '10:00', name: 'Андрей', phone: PH, car: 'Toyota Camry', force: true }) })).json();
    await fetch(base + '/api/admin/bookings/' + r.booking.id, { method: 'PATCH', headers: H, body: JSON.stringify({ status: 'done' }) });
  }
  await p.reload(); await p.waitForSelector('.nav'); await p.click('[data-nav=bonus]'); await p.waitForSelector('.qr svg');
  await p.screenshot({ path: out('bonus-3-card-silver'), fullPage: true });
  const tm = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  await fetch(base + '/api/admin/bookings', { method: 'POST', headers: H, body: JSON.stringify({ serviceId: 'oil-filter', date: tm, time: '08:00', name: 'Андрей', phone: PH, car: 'Toyota Camry · А123ВС777', mileage: 95000, force: true }) });
  await p.goto(base + '/admin'); await p.waitForSelector('#pin'); await p.fill('#pin', pin); await p.click('#go'); await p.waitForSelector('.bk');
  await p.screenshot({ path: out('bonus-4-admin-tier') });
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
