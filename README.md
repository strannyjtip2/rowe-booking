# ROWE — Замена масла (онлайн-запись)

Мобильное PWA: запись, ближайшее окно, вход по телефону, авто, история, бонусная карта.

## Публичное демо (GitHub Pages)
**Клиент:** https://strannyjtip2.github.io/rowe-booking/  
**Админка:** https://strannyjtip2.github.io/rowe-booking/admin.html  

Pages отдаёт только статику — без Node/SQLite данные живут в `localStorage` **этого** телефона/браузера.  
PIN админки: `4242` · демо-код входа: `1111`

## Локальный сервер (полный режим, SQLite)
```bash
ADMIN_PIN=4242 PORT=3210 node server.js   # Node 22+, без npm install
# опционально: TG_BOT_TOKEN=... TG_CHAT_ID=...
```
Клиент: http://localhost:3210 · Админ: http://localhost:3210/admin

## Конфиг
`public/config.default.json` → копируется в `data/config.json`.  
Услуги, часы, посты (`bays`), уровни лояльности (`loyalty`) — с пометками «примеры».
