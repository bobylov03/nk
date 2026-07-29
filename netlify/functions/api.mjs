/* NC meals — API на Netlify Functions (v2) + Netlify Blobs.
   Порт server.js. Все пути и контракты сохранены: фронт менять не нужно.
   Локальный запуск: netlify dev   (или по-старому node server.js) */

import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';
import seed from '../../data/db.json' with { type: 'json' };

export const config = { path: '/api/*' };

const TZ = 'Asia/Tbilisi';
const SECRET = process.env.NC_SECRET || 'nc-dev-secret-change-me';
const ADMIN_PASSWORD = process.env.NC_ADMIN_PASSWORD || seed.admin.password;
const TOKEN_TTL = 1000 * 60 * 60 * 24 * 30;

const CATS = ['breakfast', 'lunch', 'dinner', 'snack'];
const CAT_RU = { breakfast: 'Завтрак', lunch: 'Обед', dinner: 'Ужин', snack: 'Перекус' };

/* ---------- хранилище (замена fs.readFileSync / writeFileSync) ---------- */
const store = () => getStore({ name: 'nc-meals', consistency: 'strong' });

async function readDb() {
  const s = store();
  const data = await s.get('db', { type: 'json' });
  if (data) return data;
  const fresh = JSON.parse(JSON.stringify(seed));   // первый запуск — засеваем из data/db.json
  await s.setJSON('db', fresh);
  return fresh;
}
const writeDb = (db) => store().setJSON('db', db);

/* ---------- токены: подписанные, без серверной памяти ---------- */
function signToken(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + TOKEN_TTL })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}
function readToken(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const expect = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return data.exp > Date.now() ? data : null;
  } catch { return null; }
}

/* ---------- helpers ---------- */
const uid = (p) => p + crypto.randomBytes(4).toString('hex');
const json = (code, data) => new Response(JSON.stringify(data), {
  status: code,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

/* даты считаем по Тбилиси, а не по UTC контейнера */
const iso = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const today = () => iso(new Date());
const plusDays = (n, from) => {
  const d = new Date((from ? String(from).slice(0, 10) : today()) + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dateRu = (date, opts) => new Date(date + 'T12:00:00Z').toLocaleDateString('ru-RU', { timeZone: 'UTC', ...opts });

function dishOf(db, id) { return db.dishes.find(d => d.id === id) || null; }
function dayMenu(db, date) {
  const raw = db.menu[date] || {};
  const out = { date, slots: [] };
  CATS.forEach(c => out.slots.push({ cat: c, catLabel: CAT_RU[c], dish: dishOf(db, raw[c]) }));
  out.totals = out.slots.reduce((a, s) => {
    if (s.dish) { a.kcal += s.dish.kcal; a.p += s.dish.p; a.f += s.dish.f; a.c += s.dish.c; }
    return a;
  }, { kcal: 0, p: 0, f: 0, c: 0 });
  return out;
}
const tariffById = (db, id) => db.tariffs.find(t => t.id === id) || db.tariffs[0];
const tariffByDays = (db, days) => db.tariffs.find(t => +t.days === +days) || db.tariffs[0];

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

function clientDashboard(db, id) {
  const c = db.clients.find(x => x.id === id);
  if (!c) return null;
  const t = tariffByDays(db, c.planDays);
  return {
    client: { id: c.id, name: c.name, phone: c.phone, address: c.address, slot: c.slot, notes: c.notes, paused: c.paused, daysLeft: c.daysLeft, planDays: c.planDays, planName: t.name },
    today: dayMenu(db, today()),
    tomorrow: dayMenu(db, plusDays(1)),
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

/* ---------- точка входа ---------- */
export default async function handler(req) {
  const url = new URL(req.url);
  const p = url.pathname.replace(/^\/\.netlify\/functions\/api/, '/api').replace(/\/$/, '');
  const M = req.method;
  const seg = p.split('/');

  let body = {};
  if (M !== 'GET' && M !== 'HEAD') {
    const raw = await req.text();
    if (raw) { try { body = JSON.parse(raw); } catch { return json(400, { error: 'Некорректный JSON' }); } }
  }

  const sess = readToken(req.headers.get('x-nc-token'));
  const isAdmin = !!sess && sess.role === 'admin';

  try {
    const db = await readDb();
    const save = () => writeDb(db);

    /* --- публичное --- */
    if (M === 'GET' && p === '/api/public') {
      return json(200, {
        content: db.content, tariffs: db.tariffs,
        today: dayMenu(db, today()), tomorrow: dayMenu(db, plusDays(1)),
        excludeOptions: db.excludeOptions, slots: db.slots
      });
    }
    if (M === 'GET' && p === '/api/dishes') {
      return json(200, { dishes: db.dishes, cats: CAT_RU });
    }
    if (M === 'POST' && p === '/api/orders') {
      const t = tariffById(db, body.tariffId);
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
      await save();
      return json(200, { order });
    }
    if (M === 'GET' && p === '/api/orders') {
      const phone = (url.searchParams.get('phone') || '').replace(/\D/g, '');
      const found = db.orders.filter(o => o.phone.replace(/\D/g, '') === phone && phone.length > 4);
      return json(200, { orders: found });
    }
    if (M === 'POST' && /^\/api\/orders\/[^/]+\/pay$/.test(p)) {
      const o = db.orders.find(x => x.id === seg[3]);
      if (!o) return json(404, { error: 'Заявка не найдена' });
      if (o.status !== 'approved') return json(400, { error: 'Заявка ещё не подтверждена' });
      o.status = 'paid'; o.pay = body.pay || 'card'; o.paidAt = new Date().toISOString();
      let c = db.clients.find(x => x.phone.replace(/\D/g, '') === o.phone.replace(/\D/g, ''));
      if (!c) {
        c = { id: uid('c'), name: o.name, phone: o.phone, address: o.address + (o.flat ? ', ' + o.flat : ''), slot: o.slot, notes: (o.exclude || []).join(', '), planDays: o.planDays, daysLeft: o.planDays, paused: false, history: [] };
        db.clients.unshift(c);
      } else {
        c.daysLeft += o.planDays; c.planDays = o.planDays;
      }
      c.history = c.history || [];
      c.history.unshift({ title: 'NC · ' + o.planDays + ' дней', meta: dateRu(today()) + ' · ' + o.meals + ' приёма', sum: o.sum });
      o.clientId = c.id;
      await save();
      return json(200, { order: o, clientId: c.id });
    }
    if (M === 'GET' && /^\/api\/orders\/[^/]+$/.test(p)) {
      const o = db.orders.find(x => x.id === seg[3]);
      return o ? json(200, { order: o }) : json(404, { error: 'Заявка не найдена' });
    }

    /* --- клиент --- */
    if (M === 'POST' && p === '/api/client/login') {
      const phone = (body.phone || '').replace(/\D/g, '');
      const c = db.clients.find(x => x.phone.replace(/\D/g, '').endsWith(phone.slice(-9)) && phone.length >= 5);
      if (!c) return json(404, { error: 'Клиент с таким телефоном не найден' });
      return json(200, { token: signToken({ role: 'client', clientId: c.id }), clientId: c.id });
    }
    if (M === 'GET' && /^\/api\/client\/[^/]+$/.test(p)) {
      const data = clientDashboard(db, seg[3]);
      return data ? json(200, data) : json(404, { error: 'Клиент не найден' });
    }
    if (M === 'POST' && /^\/api\/client\/[^/]+\/pause$/.test(p)) {
      const c = db.clients.find(x => x.id === seg[3]);
      if (!c) return json(404, { error: 'Клиент не найден' });
      c.paused = !c.paused;
      db.requests.unshift({ id: uid('r'), clientId: c.id, client: c.name, type: 'pause', text: c.paused ? 'Пауза рациона' : 'Возобновление рациона', status: 'pending', createdAt: new Date().toISOString() });
      await save();
      return json(200, { paused: c.paused });
    }
    if (M === 'POST' && /^\/api\/client\/[^/]+\/swap$/.test(p)) {
      const c = db.clients.find(x => x.id === seg[3]);
      const d = dishOf(db, body.dishId);
      if (!c || !d) return json(404, { error: 'Не найдено' });
      db.requests.unshift({
        id: uid('r'), clientId: c.id, client: c.name, type: 'swap', status: 'pending',
        date: body.date || plusDays(1), cat: body.cat, dishId: d.id,
        text: 'Запрос замены · ' + (CAT_RU[body.cat] || '') + ' → ' + d.name, createdAt: new Date().toISOString()
      });
      await save();
      return json(200, { ok: true });
    }
    if (M === 'POST' && /^\/api\/client\/[^/]+\/extend$/.test(p)) {
      const c = db.clients.find(x => x.id === seg[3]);
      const t = tariffById(db, body.tariffId);
      if (!c) return json(404, { error: 'Клиент не найден' });
      const order = { id: uid('o'), status: 'pending', createdAt: new Date().toISOString(), clientId: c.id, name: c.name, phone: c.phone, address: c.address, slot: c.slot, tariffId: t.id, planDays: t.days, meals: t.meals, exclude: [], sum: t.perDay * t.days, note: 'Продление рациона' };
      db.orders.unshift(order);
      await save();
      return json(200, { order });
    }

    /* --- админка --- */
    if (M === 'POST' && p === '/api/admin/login') {
      if ((body.password || '') !== ADMIN_PASSWORD) return json(401, { error: 'Неверный пароль' });
      return json(200, { token: signToken({ role: 'admin' }) });
    }

    if (/^\/api\/(admin|dishes|menu|tariffs|content|requests|clients)/.test(p) && !(M === 'GET' && (p === '/api/dishes')) && !isAdmin) {
      return json(401, { error: 'Нужен вход в админку' });
    }

    if (M === 'GET' && p === '/api/admin/state') {
      const week = Array.from({ length: 7 }, (_, i) => {
        const date = plusDays(i);
        return { date, label: dateRu(date, { weekday: 'short', day: 'numeric' }), menu: dayMenu(db, date) };
      });
      return json(200, {
        dishes: db.dishes, tariffs: db.tariffs, content: db.content, clients: db.clients,
        orders: db.orders, requests: db.requests, week, slots: db.slots, cats: CAT_RU, promos: db.promos
      });
    }
    if (M === 'POST' && p === '/api/dishes') {
      const src = body.smart ? parseSmart(body.smart) : body;
      const d = {
        id: uid('d'), name: src.name || 'Без названия', cat: src.cat || 'lunch',
        kcal: +src.kcal || 0, p: +src.p || 0, f: +src.f || 0, c: +src.c || 0,
        weight: +src.weight || 0, price: +src.price || 0,
        tags: src.tags || [], ing: body.ing || src.ing || '', img: body.img || '',
        desc: body.desc || '', why: body.why || ''
      };
      db.dishes.unshift(d); await save();
      return json(200, { dish: d });
    }
    if (M === 'POST' && p === '/api/dishes/bulk') {
      const rows = body.text ? parseTable(body.text) : (body.rows || []);
      const added = rows.map(r => Object.assign({ id: uid('d'), img: '', ing: '', tags: [], desc: '', why: '' }, r));
      db.dishes = added.concat(db.dishes); await save();
      return json(200, { added: added.length, dishes: db.dishes });
    }
    if (M === 'POST' && /^\/api\/dishes\/[^/]+\/duplicate$/.test(p)) {
      const d = dishOf(db, seg[3]);
      if (!d) return json(404, { error: 'Блюдо не найдено' });
      const copy = Object.assign({}, d, { id: uid('d'), name: d.name + ' (копия)' });
      db.dishes.unshift(copy); await save();
      return json(200, { dish: copy });
    }
    if (M === 'PUT' && /^\/api\/dishes\/[^/]+$/.test(p)) {
      const d = dishOf(db, seg[3]);
      if (!d) return json(404, { error: 'Блюдо не найдено' });
      ['name', 'cat', 'ing', 'img', 'desc', 'why'].forEach(k => { if (k in body) d[k] = body[k]; });
      ['kcal', 'p', 'f', 'c', 'weight', 'price'].forEach(k => { if (k in body) d[k] = +body[k] || 0; });
      if ('tags' in body) d.tags = Array.isArray(body.tags) ? body.tags : String(body.tags).split(',').map(s => s.trim()).filter(Boolean);
      await save();
      return json(200, { dish: d });
    }
    if (M === 'DELETE' && /^\/api\/dishes\/[^/]+$/.test(p)) {
      db.dishes = db.dishes.filter(x => x.id !== seg[3]); await save();
      return json(200, { ok: true });
    }
    if (M === 'PUT' && p === '/api/menu') {
      db.menu[body.date] = db.menu[body.date] || {};
      if (body.dishId) db.menu[body.date][body.cat] = body.dishId;
      else delete db.menu[body.date][body.cat];
      await save();
      return json(200, { menu: dayMenu(db, body.date) });
    }
    if (M === 'POST' && p === '/api/menu/autofill') {
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
      await save();
      return json(200, { ok: true });
    }
    if (M === 'PUT' && /^\/api\/tariffs\/[^/]+$/.test(p)) {
      const t = tariffById(db, seg[3]);
      ['name', 'code'].forEach(k => { if (k in body) t[k] = body[k]; });
      ['perDay', 'days', 'meals'].forEach(k => { if (k in body) t[k] = +body[k] || 0; });
      await save();
      return json(200, { tariff: t });
    }
    if (M === 'PUT' && p === '/api/content') {
      Object.assign(db.content, body); await save();
      return json(200, { content: db.content });
    }
    if (M === 'POST' && /^\/api\/orders\/[^/]+\/(approve|reject)$/.test(p)) {
      if (!isAdmin) return json(401, { error: 'Нужен вход в админку' });
      const o = db.orders.find(x => x.id === seg[3]);
      if (!o) return json(404, { error: 'Заявка не найдена' });
      o.status = p.endsWith('approve') ? 'approved' : 'rejected';
      o.decidedAt = new Date().toISOString();
      await save();
      return json(200, { order: o });
    }
    if (M === 'POST' && /^\/api\/requests\/[^/]+\/(approve|reject)$/.test(p)) {
      const r = db.requests.find(x => x.id === seg[3]);
      if (!r) return json(404, { error: 'Запрос не найден' });
      r.status = p.endsWith('approve') ? 'approved' : 'rejected';
      if (r.status === 'approved' && r.type === 'swap') {
        db.menu[r.date] = db.menu[r.date] || {};
        db.menu[r.date][r.cat] = r.dishId;
      }
      await save();
      return json(200, { request: r });
    }
    if (M === 'PUT' && /^\/api\/clients\/[^/]+$/.test(p)) {
      const c = db.clients.find(x => x.id === seg[3]);
      if (!c) return json(404, { error: 'Клиент не найден' });
      ['name', 'phone', 'address', 'slot', 'notes'].forEach(k => { if (k in body) c[k] = body[k]; });
      ['daysLeft', 'planDays'].forEach(k => { if (k in body) c[k] = +body[k] || 0; });
      if ('paused' in body) c.paused = !!body.paused;
      await save();
      return json(200, { client: c });
    }

    return json(404, { error: 'Неизвестный метод API: ' + M + ' ' + p });
  } catch (e) {
    return json(500, { error: e.message });
  }
}
