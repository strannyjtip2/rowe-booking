// Демо-данные через API: node tools/seed.js [http://localhost:3000] [PIN]
const base = process.argv[2] || 'http://localhost:3000', pin = process.argv[3] || '1234';
const S = require('../public/shared.js');
(async () => {
  const cfg = await (await fetch(base + '/api/config')).json();
  const today = S.nowIn(cfg.timezone).date;
  const post = (url, body, h = {}) => fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(body) }).then((r) => r.json());
  const nextOf = (d, n) => { let x = S.addDays(today, 1); while (S.dow(x) !== d) x = S.addDays(x, 1); return x; };
  const mon = nextOf(1), fri = nextOf(5);
  const A = { 'x-admin-pin': pin };
  for (const [sv,d,t,n,ph,car,y,km,oil] of [['to',S.addDays(today,1),'10:00','Алексей К.','+7 916 123-45-67','BMW X5',2018,92000,'ours'],['oil',mon,'09:00','Марина','+7 925 765-43-21','Kia Rio',2021,41000,'own'],['atf',mon,'12:00','Дмитрий Л.','+7 903 111-22-33','Toyota Land Cruiser',2016,180000,'ours']])
    console.log(await post('/api/bookings',{serviceId:sv,date:d,time:t,name:n,phone:ph,car,year:y,mileage:km,oil}).then(r=>r.booking?.id||r));
})();
