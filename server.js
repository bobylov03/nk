/* NC meals — сервер без внешних зависимостей. Запуск: node server.js */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DB_PATH = path.join(ROOT, 'data', 'db.json');
const PUBLIC = path.join(ROOT, 'public');

let db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)), 40);
}
const uid = (p) => p + crypto.randomBytes(4).toString('hex');
const sessions = new Map();                       // token -> { role, clientId }

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const CATS = ['breakfast', 'lunch', 'dinner', 'snack'];
const CAT_RU = { breakfast: 'Завтрак', lunch: 'Обед', dinner: 'Ужин', snack: 'Перекус' };

/* ---------- helpers ---------- */
const iso = (d) => d.toISOString().slice(0, 10);
const today = () => iso(new Date());
const plusDays = (n, from) => { const d = from ? new Date(from) : new Date(); d.setDate(d.getDate() + n); return iso(d); };

function dish(id) { return db.dishes.find(d => d.id === id) || null; }
function dayMenu(date) {
  const raw = db.menu[date] || {};
  const out = { date, slots: [] };
  CATS.forEach(c => {
    const d = dish(raw[c]);
    out.slots.push({ cat: c, catLabel: CAT_RU[c], dish: d });
  });
  out.totals = out.slots.reduce((a, s) => {
    if (s.dish) { a.kcal += s.dish.kcal; a.p += s.dish.p; a.f += s.dish.f; a.c += s.dish.c; }
    return a;
  }, { kcal: 0, p: 0, f: 0, c: 0 });
  return out;
}
function tariffById(id) { return db.tariffs.find(t => t.id === id) || db.tariffs[0]; }
function tariffByDays(days) { return db.tariffs.find(t => +t.days === +days) || db.tariffs[0]; }

/* Разбор «умной строки»: Название / категория / 420 ккал / 24-18-32 / 350 г / 18 / теги */
function parseSmart(text) {
  const parts = String(text || '').split('/').map(s => s.trim()).filter(Boolean);
  const out = { name: '', cat: null, kcal: 0, p: 0, f: 0, c: 0, weight: 0, price: 0, tags: [] };
  parts.forEach((raw, i) => {
    const low = raw.toLowerCase();
    if (i === 0) { out.name = raw; return; }
    const cat = CATS.find(c => low.startsWith(CAT_RU[c].toLowerCase().slice(0, 5)));
    if (cat) { out.cat = cat; return; }
    if (/ккал/.test(low)) { out.kcal = parseInt(low, 10) || 0; return; }
    const mac = raw.match(/^(\d+)\s*[-\/x]\s*(\d+)\s*[-\/x]\s*(\d+)$/);
    if (mac) { out.p = +mac[1]; out.f = +mac[2]; out.c = +mac[3]; return; }
    if (/\d/.test(low) && /(г|гр|g)$/.test(low)) { out.weight = parseInt(low, 10) || 0; return; }
    if (/^\d+([.,]\d+)?$/.test(low)) { out.price = parseFloat(low.replace(',', '.')) || 0; return; }
    out.tags = out.tags.concat(raw.split(',').map(s => s.trim()).filter(Boolean));
  });
  if (!out.cat) out.cat = 'lunch';
  return out;
}
/* CSV / вставка из Excel: строки, колонки через ; , или tab */
function parseTable(text) {
  return String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(line => {
    const c = line.split(/\t|;|,(?=(?:[^,]*$))/).length > 1 ? line.split(/\t|;/) : line.split(',');
    const col = c.map(x => String(x).trim());
    const cat = CATS.find(k => (col[1] || '').toLowerCase().startsWith(CAT_RU[k].toLowerCase().slice(0, 5))) || 'lunch';
    return {
      name: col[0] || '', cat,
      kcal: +col[2] || 0, p: +col[3] || 0, f: +col[4] || 0, c: +col[5] || 0,
      weight: +col[6] || 0, price: +col[7] || 0,
      tags: (col[8] || '').split(/[,·]/).map(s => s.trim()).filter(Boolean),
      ing: col[9] || ''
    };
  }).filter(r => r.name);
}

function clientDashboard(id) {
  const c = db.clients.find(x => x.id === id);
  if (!c) return null;
  const t = tariffByDays(c.planDays);
  return {
    client: { id: c.id, name: c.name, phone: c.phone, address: c.address, slot: c.slot, notes: c.notes, paused: c.paused, daysLeft: c.daysLeft, planDays: c.planDays, planName: t.name },
    today: dayMenu(today()),
    tomorrow: dayMenu(plusDays(1)),
    calendar: Array.from({ length: 28 }, (_, i) => {
      const date = plusDays(i - 3);
      const active = i >= 3 && i - 3 < c.daysLeft;
      return { date, day: +date.slice(8), active, paused: c.paused && (i === 4 || i === 5), hasMenu: !!db.menu[date] };
    }),
    history: c.history || [],
    requests: db.requests.filter(r => r.clientId === c.id),
    tariffs: db.tariffs,
    norms: c.norms || { kcal: 1900, p: 130, f: 70, c: 210 }
  };
}

/* ---------- API ---------- */
function api(req, res, url, body) {
  const p = url.pathname.replace(/\/$/, '');
  const M = req.method;
  const token = req.headers['x-nc-token'] || '';
  const sess = sessions.get(token) || null;
  const isAdmin = sess && sess.role === 'admin';
  const admin = () => { if (!isAdmin) { json(res, 401, { error: 'Нужен вход в админку' }); return false; } return true; };

  /* --- публичное --- */
  if (M === 'GET' && p === '/api/public') {
    return json(res, 200, {
      content: db.content, tariffs: db.tariffs,
      today: dayMenu(today()), tomorrow: dayMenu(plusDays(1)),
      excludeOptions: db.excludeOptions, slots: db.slots
    });
  }
  if (M === 'GET' && p === '/api/dishes') {
    return json(res, 200, { dishes: db.dishes, cats: CAT_RU });
  }
  if (M === 'POST' && p === '/api/orders') {
    const t = tariffById(body.tariffId);
    const order = {
      id: uid('o'), status: 'pending', createdAt: new Date().toISOString(),
      name: body.name || '', phone: body.phone || '', address: body.address || '', flat: body.flat || '',
      slot: body.slot || db.slots[0].id, note: body.note || '',
      tariffId: t.id, planDays: t.days, meals: +body.meals || t.meals,
      exclude: body.exclude || [], promo: (body.promo || '').toUpperCase(),
      sum: t.perDay * t.days
    };
    if (order.promo && db.promos[order.promo]) order.sum = Math.round(order.sum * (1 - db.promos[order.promo] / 100));
    db.orders.unshift(order);
    save();
    return json(res, 200, { order });
  }
  if (M === 'GET' && p === '/api/orders') {
    const phone = (url.searchParams.get('phone') || '').replace(/\D/g, '');
    const found = db.orders.filter(o => o.phone.replace(/\D/g, '') === phone && phone.length > 4);
    return json(res, 200, { orders: found });
  }
  if (M === 'GET' && p.startsWith('/api/orders/')) {
    const o = db.orders.find(x => x.id === p.split('/')[3]);
    return o ? json(res, 200, { order: o }) : json(res, 404, { error: 'Заявка не найдена' });
  }
  if (M === 'POST' && /^\/api\/orders\/[^/]+\/pay$/.test(p)) {
    const o = db.orders.find(x => x.id === p.split('/')[3]);
    if (!o) return json(res, 404, { error: 'Заявка не найдена' });
    if (o.status !== 'approved') return json(res, 400, { error: 'Заявка ещё не подтверждена' });
    o.status = 'paid'; o.pay = body.pay || 'card'; o.paidAt = new Date().toISOString();
    let c = db.clients.find(x => x.phone.replace(/\D/g, '') === o.phone.replace(/\D/g, ''));
    if (!c) {
      c = { id: uid('c'), name: o.name, phone: o.phone, address: o.address + (o.flat ? ', ' + o.flat : ''), slot: o.slot, notes: (o.exclude || []).join(', '), planDays: o.planDays, daysLeft: o.planDays, paused: false, history: [] };
      db.clients.unshift(c);
    } else {
      c.daysLeft += o.planDays; c.planDays = o.planDays;
    }
    c.history.unshift({ title: 'NC · ' + o.planDays + ' дней', meta: new Date().toLocaleDateString('ru-RU') + ' · ' + o.meals + ' приёма', sum: o.sum });
    o.clientId = c.id;
    save();
    return json(res, 200, { order: o, clientId: c.id });
  }

  /* --- клиент --- */
  if (M === 'POST' && p === '/api/client/login') {
    const phone = (body.phone || '').replace(/\D/g, '');
    const c = db.clients.find(x => x.phone.replace(/\D/g, '').endsWith(phone.slice(-9)) && phone.length >= 5);
    if (!c) return json(res, 404, { error: 'Клиент с таким телефоном не найден' });
    const tk = uid('t'); sessions.set(tk, { role: 'client', clientId: c.id });
    return json(res, 200, { token: tk, clientId: c.id });
  }
  if (M === 'GET' && /^\/api\/client\/[^/]+$/.test(p)) {
    const data = clientDashboard(p.split('/')[3]);
    return data ? json(res, 200, data) : json(res, 404, { error: 'Клиент не найден' });
  }
  if (M === 'POST' && /^\/api\/client\/[^/]+\/pause$/.test(p)) {
    const c = db.clients.find(x => x.id === p.split('/')[3]);
    if (!c) return json(res, 404, { error: 'Клиент не найден' });
    c.paused = !c.paused;
    db.requests.unshift({ id: uid('r'), clientId: c.id, client: c.name, type: 'pause', text: c.paused ? 'Пауза рациона' : 'Возобновление рациона', status: 'pending', createdAt: new Date().toISOString() });
    save();
    return json(res, 200, { paused: c.paused });
  }
  if (M === 'POST' && /^\/api\/client\/[^/]+\/swap$/.test(p)) {
    const c = db.clients.find(x => x.id === p.split('/')[3]);
    const d = dish(body.dishId);
    if (!c || !d) return json(res, 404, { error: 'Не найдено' });
    db.requests.unshift({
      id: uid('r'), clientId: c.id, client: c.name, type: 'swap', status: 'pending',
      date: body.date || plusDays(1), cat: body.cat, dishId: d.id,
      text: 'Запрос замены · ' + (CAT_RU[body.cat] || '') + ' → ' + d.name, createdAt: new Date().toISOString()
    });
    save();
    return json(res, 200, { ok: true });
  }
  if (M === 'POST' && /^\/api\/client\/[^/]+\/extend$/.test(p)) {
    const c = db.clients.find(x => x.id === p.split('/')[3]);
    const t = tariffById(body.tariffId);
    if (!c) return json(res, 404, { error: 'Клиент не найден' });
    const order = { id: uid('o'), status: 'pending', createdAt: new Date().toISOString(), clientId: c.id, name: c.name, phone: c.phone, address: c.address, slot: c.slot, tariffId: t.id, planDays: t.days, meals: t.meals, exclude: [], sum: t.perDay * t.days, note: 'Продление рациона' };
    db.orders.unshift(order);
    save();
    return json(res, 200, { order });
  }

  /* --- админка --- */
  if (M === 'POST' && p === '/api/admin/login') {
    if ((body.password || '') !== db.admin.password) return json(res, 401, { error: 'Неверный пароль' });
    const tk = uid('t'); sessions.set(tk, { role: 'admin' });
    return json(res, 200, { token: tk });
  }
  if (M === 'GET' && p === '/api/admin/state') {
    if (!admin()) return;
    const week = Array.from({ length: 7 }, (_, i) => {
      const date = plusDays(i);
      return { date, label: new Date(date).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric' }), menu: dayMenu(date) };
    });
    return json(res, 200, {
      dishes: db.dishes, tariffs: db.tariffs, content: db.content, clients: db.clients,
      orders: db.orders, requests: db.requests, week, slots: db.slots, cats: CAT_RU, promos: db.promos
    });
  }
  if (!p.startsWith('/api/admin') && M !== 'GET' && /^\/api\/(dishes|menu|tariffs|content|requests)/.test(p) && !isAdmin) {
    return json(res, 401, { error: 'Нужен вход в админку' });
  }
  if (M === 'POST' && p === '/api/dishes') {
    if (!admin()) return;
    const src = body.smart ? parseSmart(body.smart) : body;
    const d = {
      id: uid('d'), name: src.name || 'Без названия', cat: src.cat || 'lunch',
      kcal: +src.kcal || 0, p: +src.p || 0, f: +src.f || 0, c: +src.c || 0,
      weight: +src.weight || 0, price: +src.price || 0,
      tags: src.tags || [], ing: body.ing || src.ing || '', img: body.img || '',
      desc: body.desc || '', why: body.why || ''
    };
    db.dishes.unshift(d); save();
    return json(res, 200, { dish: d });
  }
  if (M === 'POST' && p === '/api/dishes/bulk') {
    if (!admin()) return;
    const rows = body.text ? parseTable(body.text) : (body.rows || []);
    const added = rows.map(r => Object.assign({ id: uid('d'), img: '', ing: '', tags: [], desc: '', why: '' }, r));
    db.dishes = added.concat(db.dishes); save();
    return json(res, 200, { added: added.length, dishes: db.dishes });
  }
  if (M === 'POST' && /^\/api\/dishes\/[^/]+\/duplicate$/.test(p)) {
    if (!admin()) return;
    const d = dish(p.split('/')[3]);
    if (!d) return json(res, 404, { error: 'Блюдо не найдено' });
    const copy = Object.assign({}, d, { id: uid('d'), name: d.name + ' (копия)' });
    db.dishes.unshift(copy); save();
    return json(res, 200, { dish: copy });
  }
  if (M === 'PUT' && /^\/api\/dishes\/[^/]+$/.test(p)) {
    if (!admin()) return;
    const d = dish(p.split('/')[3]);
    if (!d) return json(res, 404, { error: 'Блюдо не найдено' });
    ['name', 'cat', 'ing', 'img', 'desc', 'why'].forEach(k => { if (k in body) d[k] = body[k]; });
    ['kcal', 'p', 'f', 'c', 'weight', 'price'].forEach(k => { if (k in body) d[k] = +body[k] || 0; });
    if ('tags' in body) d.tags = Array.isArray(body.tags) ? body.tags : String(body.tags).split(',').map(s => s.trim()).filter(Boolean);
    save();
    return json(res, 200, { dish: d });
  }
  if (M === 'DELETE' && /^\/api\/dishes\/[^/]+$/.test(p)) {
    if (!admin()) return;
    db.dishes = db.dishes.filter(x => x.id !== p.split('/')[3]); save();
    return json(res, 200, { ok: true });
  }
  if (M === 'PUT' && p === '/api/menu') {
    if (!admin()) return;
    db.menu[body.date] = db.menu[body.date] || {};
    if (body.dishId) db.menu[body.date][body.cat] = body.dishId;
    else delete db.menu[body.date][body.cat];
    save();
    return json(res, 200, { menu: dayMenu(body.date) });
  }
  if (M === 'POST' && p === '/api/menu/autofill') {
    if (!admin()) return;
    const days = +body.days || 7;
    for (let i = 0; i < days; i++) {
      const date = plusDays(i);
      db.menu[date] = db.menu[date] || {};
      CATS.forEach((c, ci) => {
        if (!db.menu[date][c]) {
          const pool = db.dishes.filter(d => d.cat === c);
          if (pool.length) db.menu[date][c] = pool[(i * 2 + ci) % pool.length].id;
        }
      });
    }
    save();
    return json(res, 200, { ok: true });
  }
  if (M === 'PUT' && /^\/api\/tariffs\/[^/]+$/.test(p)) {
    if (!admin()) return;
    const t = tariffById(p.split('/')[3]);
    ['name', 'code'].forEach(k => { if (k in body) t[k] = body[k]; });
    ['perDay', 'days', 'meals'].forEach(k => { if (k in body) t[k] = +body[k] || 0; });
    save();
    return json(res, 200, { tariff: t });
  }
  if (M === 'PUT' && p === '/api/content') {
    if (!admin()) return;
    Object.assign(db.content, body); save();
    return json(res, 200, { content: db.content });
  }
  if (M === 'POST' && /^\/api\/orders\/[^/]+\/(approve|reject)$/.test(p)) {
    if (!admin()) return;
    const o = db.orders.find(x => x.id === p.split('/')[3]);
    if (!o) return json(res, 404, { error: 'Заявка не найдена' });
    o.status = p.endsWith('approve') ? 'approved' : 'rejected';
    o.decidedAt = new Date().toISOString();
    save();
    return json(res, 200, { order: o });
  }
  if (M === 'POST' && /^\/api\/requests\/[^/]+\/(approve|reject)$/.test(p)) {
    if (!admin()) return;
    const r = db.requests.find(x => x.id === p.split('/')[3]);
    if (!r) return json(res, 404, { error: 'Запрос не найден' });
    r.status = p.endsWith('approve') ? 'approved' : 'rejected';
    if (r.status === 'approved' && r.type === 'swap') {
      db.menu[r.date] = db.menu[r.date] || {};
      db.menu[r.date][r.cat] = r.dishId;
    }
    save();
    return json(res, 200, { request: r });
  }
  if (M === 'PUT' && /^\/api\/clients\/[^/]+$/.test(p)) {
    if (!admin()) return;
    const c = db.clients.find(x => x.id === p.split('/')[3]);
    if (!c) return json(res, 404, { error: 'Клиент не найден' });
    ['name', 'phone', 'address', 'slot', 'notes'].forEach(k => { if (k in body) c[k] = body[k]; });
    ['daysLeft', 'planDays'].forEach(k => { if (k in body) c[k] = +body[k] || 0; });
    if ('paused' in body) c.paused = !!body.paused;
    save();
    return json(res, 200, { client: c });
  }

  return json(res, 404, { error: 'Неизвестный метод API: ' + M + ' ' + p });
}

function json(res, code, data) {
  const s = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(s) });
  res.end(s);
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.join(PUBLIC, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end('403'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end('<h1>404</h1><p>Страница не найдена. <a href="/">На главную</a></p>'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  if (url.pathname.startsWith('/api/')) {
    let raw = '';
    req.on('data', ch => { raw += ch; if (raw.length > 2e6) req.destroy(); });
    req.on('end', () => {
      let body = {};
      if (raw) { try { body = JSON.parse(raw); } catch (e) { return json(res, 400, { error: 'Некорректный JSON' }); } }
      try { api(req, res, url, body); }
      catch (e) { json(res, 500, { error: e.message }); }
    });
    return;
  }
  serveStatic(req, res, url);
}).listen(PORT, () => {
  console.log('NC meals запущен: http://localhost:' + PORT);
  console.log('  главная     /            заказ    /order.html');
  console.log('  кабинет     /cabinet.html         админка  /admin.html  (пароль: ' + db.admin.password + ')');
});
