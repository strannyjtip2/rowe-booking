// Скриншоты и e2e-проверка: node tools/shots.js [baseUrl] [PIN] [prefix]
const { chromium } = require('playwright-core');
const base = process.argv[2] || 'http://localhost:3000', pin = process.argv[3] || '4242', pre = process.argv[4] || '';
const out = (n) => __dirname + '/../screenshots/' + pre + n + '.png';
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.error('PAGEERROR', e.message));
  p.on('console', (m) => m.type() === 'error' && console.error('CONSOLE', m.text()));
  // --- клиент
  await p.goto(base + '/'); await p.waitForSelector('.svc');
  await p.screenshot({ path: out('client-1-services') });
  await p.click('[data-id=to]'); await p.waitForSelector('.days');
  await p.click('.days .chip >> nth=2'); await p.waitForSelector('.times');
  await p.click('.times .chip >> nth=1');
  await p.screenshot({ path: out('client-2-slots') });
  await p.click('[data-go]'); await p.waitForSelector('#f-name');
  await p.fill('#f-name', 'Игорь'); await p.fill('#f-phone', '+7 999 777-88-99'); await p.fill('#f-car', 'Toyota Camry'); await p.fill('#f-year','2019'); await p.fill('#f-mileage','85000'); await p.fill('#f-comment', 'Масло 5W-30');
  await p.screenshot({ path: out('client-3-form') });
  await p.click('[data-go]'); await p.waitForSelector('.ok-ico');
  await p.screenshot({ path: out('client-4-done'), fullPage: true });
  // --- админка
  await p.goto(base + '/?admin'); await p.waitForSelector('#pin');
  await p.screenshot({ path: out('admin-0-login') });
  await p.fill('#pin', pin); await p.click('#go'); await p.waitForSelector('.bk');
  await p.screenshot({ path: out('admin-1-bookings') });
  await p.screenshot({ path: out('admin-1-bookings-full'), fullPage: true });
  await p.click('[data-edit] >> nth=0'); await p.waitForSelector('.sheet');
  await p.screenshot({ path: out('admin-2-edit') });
  await p.click('#e-close');
  await p.click('[data-tab=services]'); await p.waitForSelector('.svc-ed');
  await p.screenshot({ path: out('admin-3-services'), fullPage: true });
  await p.click('[data-tab=hours]'); await p.waitForSelector('.hrs');
  await p.screenshot({ path: out('admin-4-hours'), fullPage: true });
  // PWA
  const m = await p.evaluate(async () => { const r = await fetch('manifest.webmanifest'); return (await r.json()).name; });
  const sw = await p.evaluate(async () => !!(await navigator.serviceWorker?.getRegistration()));
  console.log('manifest:', m, '· serviceWorker registered:', sw);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
