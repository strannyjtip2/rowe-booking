const { chromium } = require('playwright-core');
const base = process.argv[2] || 'http://localhost:3210';
const out = (n) => __dirname + '/../screenshots/' + n + '.png';
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, locale: 'ru-RU' })).newPage();
  const clip = async (n) => { await p.waitForTimeout(300); const bb = await p.locator('#dock').boundingBox(); await p.screenshot({ path: out(n), clip: { x: 0, y: bb.y - 10, width: 390, height: bb.height + 10 } }); };
  await p.goto(base + '/'); await p.waitForSelector('[data-nav=login]'); await clip('outline-dock-guest');
  await p.click('[data-nav=login]'); await p.fill('#l-phone', '+7 916 555-12-34'); await p.click('[data-go]');
  await p.waitForSelector('#l-code'); await p.fill('#l-code', '1111'); await p.click('[data-go]'); await p.waitForSelector('[data-nav=cars]');
  await p.click('[data-nav=book]'); await clip('outline-dock-logged-in');
  await p.click('[data-nav=history]'); await clip('outline-dock-history-active');
  await p.screenshot({ path: out('outline-dock-history-full') });
  await b.close();
})();
