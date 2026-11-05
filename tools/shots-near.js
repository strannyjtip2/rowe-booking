const { chromium } = require('playwright-core');
const base = process.argv[2] || 'http://localhost:3210';
const out = (n) => __dirname + '/../screenshots/' + n + '.png';
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ru-RU', timezoneId: 'Europe/Moscow' })).newPage();
  p.on('pageerror', (e) => console.error('PAGEERROR', e.message));
  await p.goto(base + '/'); await p.waitForSelector('[data-near]');
  await p.screenshot({ path: out('client-0-home-nearest') });
  await p.click('[data-near] >> nth=1'); await p.waitForSelector('#unlock');
  await p.screenshot({ path: out('client-0b-time-locked') });
  await p.click('[data-id=oil]'); await p.waitForSelector('#f-name');
  await p.screenshot({ path: out('client-0c-form-after-onetap') });
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
