// Скриншоты аккаунта: node tools/shots-account.js [base] [PIN]
const { chromium } = require('playwright-core');
const base = process.argv[2] || 'http://localhost:3210', pin = process.argv[3] || '4242';
const out = (n) => __dirname + '/../screenshots/' + n + '.png';
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ru-RU', timezoneId: 'Europe/Moscow' })).newPage();
  p.on('pageerror', (e) => console.error('PAGEERROR', e.message));
  p.on('dialog', (d) => d.accept());
  await p.goto(base + '/'); await p.waitForSelector('[data-nav=login]');
  await p.click('[data-nav=login]'); await p.fill('#l-phone', '+7 916 555-12-34'); await p.click('[data-go]');
  await p.waitForSelector('#l-code'); await p.fill('#l-code', '1111');
  await p.screenshot({ path: out('acc-1-login') });
  await p.click('[data-go]'); await p.waitForSelector('#p-name');
  await p.fill('#p-name', 'Андрей'); await p.click('#p-save'); await p.waitForTimeout(300);
  await p.screenshot({ path: out('acc-2-profile') });
  // авто
  await p.click('[data-nav=cars]'); await p.click('#c-add');
  for (const [k, v] of Object.entries({ model: 'Toyota Camry', plate: 'А123ВС777', year: '2019', oilType: 'ROWE Hightec Synt RS 5W-30', volume: '4.5', lastMileage: '75000', lastDate: '2026-05-10', nextKm: '85000', nextDate: '2026-11-10' })) await p.fill('#c-' + k, v);
  await p.screenshot({ path: out('acc-3-car-edit') });
  await p.click('[data-go]'); await p.waitForSelector('.carc');
  await p.click('#c-add'); await p.fill('#c-model', 'Kia Sportage'); await p.fill('#c-plate', 'М456ОР799'); await p.fill('#c-oilType', 'ROWE 0W-20'); await p.fill('#c-volume', '4.3'); await p.click('[data-go]'); await p.waitForSelector('.carc >> nth=1');
  await p.screenshot({ path: out('acc-4-cars') });
  // запись с подстановкой
  await p.click('[data-nav=book]'); await p.waitForSelector('[data-id=oil-filter]'); await p.click('[data-id=oil-filter]');
  await p.waitForSelector('.days'); await p.click('.days .chip >> nth=1'); await p.click('.times .chip >> nth=2'); await p.click('[data-go]');
  await p.waitForSelector('#f-carsel'); await p.fill('#f-mileage', '84800');
  await p.screenshot({ path: out('acc-5-booking-prefill') });
  await p.click('[data-go]'); await p.waitForSelector('.ok-ico');
  // админ отмечает «Выполнена» -> карточка авто обновится
  const H = { 'x-admin-pin': pin, 'content-type': 'application/json' };
  const all = (await (await fetch(base + '/api/admin/bookings', { headers: H })).json()).bookings;
  const mine = all.find((x) => x.clientPhone === '79165551234');
  await fetch(base + '/api/admin/bookings/' + mine.id, { method: 'PATCH', headers: H, body: JSON.stringify({ status: 'done' }) });
  await p.reload(); await p.waitForSelector('[data-nav=history]');
  await p.click('[data-nav=history]'); await p.waitForSelector('.bk');
  await p.screenshot({ path: out('acc-6-history') });
  await p.click('[data-nav=cars]'); await p.waitForSelector('.carc');
  await p.screenshot({ path: out('acc-7-cars-after-service') });
  // гость: предложение сохранить авто
  const g = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, locale: 'ru-RU', timezoneId: 'Europe/Moscow' })).newPage();
  await g.goto(base + '/'); await g.waitForSelector('[data-id=oil]'); await g.click('[data-id=oil]'); await g.waitForSelector('.days');
  await g.click('.days .chip >> nth=2'); await g.click('.times .chip >> nth=3'); await g.click('[data-go]');
  await g.fill('#f-name', 'Ольга'); await g.fill('#f-phone', '+7 926 000-11-22'); await g.fill('#f-car', 'Mazda CX-5'); await g.fill('#f-mileage', '60000');
  await g.click('[data-go]'); await g.waitForSelector('#save-car');
  await g.screenshot({ path: out('acc-8-guest-save-car'), fullPage: true });
  await p.goto(base + '/'); await p.waitForSelector('.nav');
  await p.screenshot({ path: out('acc-0-home-logged-in') });
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
