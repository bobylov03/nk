/* NC meals — общее ядро API.
   Не зависит от способа хранения и от транспорта: получает db, отдаёт { code, data, changed }.
   Используется и server.mjs (локально, файл), и netlify/functions/api.mjs (прод, Blobs). */

import crypto from 'node:crypto';

export const TZ = 'Asia/Tbilisi';
export const CATS = ['breakfast', 'lunch', 'dinner', 'snack'];
export const CAT_RU = { breakfast: 'Завтрак', lunch: 'Обед', dinner: 'Ужин', snack: 'Перекус' };

/* ---------- справочники анкеты ---------- */
export const OPTS = {
  goals: ['Поддержание веса', 'Снижение веса', 'Набор мышечной массы', 'Больше энергии',
    'Улучшить пищевые привычки', 'Экономить время', 'Просто вкусно питаться', 'Другое'],
  medical: ['диабет', 'заболевания ЖКТ', 'аллергии', 'непереносимость лактозы', 'целиакия',
    'заболевания щитовидной железы', 'беременность', 'грудное вскармливание', 'другое'],
  products: ['лук', 'говядина', 'курица', 'индейка', 'рыба', 'морепродукты', 'яйца',
    'молочные продукты', 'грибы', 'орехи', 'мёд', 'кинза', 'оливки', 'авокадо', 'острое', 'другое'],
  diets: [
    { id: 'omnivore', icon: '🥩', name: 'Всеядный', desc: 'Ем всё: мясо, рыбу, птицу, яйца, молочные продукты, овощи, фрукты' },
    { id: 'pollotarian', icon: '🐔', name: 'Поллотарианец', desc: 'Ем птицу, не ем красное мясо' },
    { id: 'pescatarian', icon: '🐟', name: 'Пескетарианец', desc: 'Ем рыбу и морепродукты, не ем мясо и птицу' },
    { id: 'lacto-ovo', icon: '🧀', name: 'Лакто-ово-вегетарианец', desc: 'Без мяса и рыбы, но с яйцами и молочными продуктами' },
    { id: 'lacto', icon: '🥛', name: 'Лактовегетарианец', desc: 'Молочные продукты — да, мясо, рыба и яйца — нет' },
    { id: 'ovo', icon: '🥚', name: 'Ово-вегетарианец', desc: 'Яйца — да, мясо, рыба и молочные продукты — нет' },
    { id: 'vegetarian', icon: '🌱', name: 'Вегетарианец', desc: 'Без мяса и рыбы' },
    { id: 'vegan', icon: '🌿', name: 'Веган', desc: 'Полностью без продуктов животного происхождения, включая мёд' },
    { id: 'wfpb', icon: '🥗', name: 'Растительное цельное', desc: 'Whole-food plant-based: упор на минимально обработанные продукты' },
    { id: 'carnivore', icon: '🥩', name: 'Карнивор', desc: 'Почти только продукты животного происхождения' },
    { id: 'keto', icon: '🥓', name: 'Кето', desc: 'Мало углеводов, много жиров' },
    { id: 'gluten-free', icon: '🌾', name: 'Безглютеновое', desc: 'Исключаю продукты с глютеном' },
    { id: 'dairy-free', icon: '🥛', name: 'Безмолочное', desc: 'Исключаю молочные продукты' },
    { id: 'kosher', icon: '🕍', name: 'Кошерное', desc: 'По еврейским религиозным правилам' },
    { id: 'halal', icon: '☪️', name: 'Халяль', desc: 'По исламским правилам' }
  ],
  priorities: ['вкус', 'разнообразие', 'высокая калорийность', 'похудение', 'большое количество белка',
    'красивые блюда', 'минимум готовки', 'скорость доставки', 'премиальные продукты'],
  cuisines: ['Домашняя', 'Европейская', 'Азиатская', 'Средиземноморская', 'Смешанная'],
  soups: ['Да', 'Иногда', 'Нет'],
  meals: [3, 4, 5],
  portions: ['уменьшенная', 'обычная', 'увеличенная'],
  persons: [1, 2],
  weekdays: [
    { n: 1, short: 'пн' }, { n: 2, short: 'вт' }, { n: 3, short: 'ср' }, { n: 4, short: 'чт' },
    { n: 5, short: 'пт' }, { n: 6, short: 'сб' }, { n: 7, short: 'вс' }
  ]
};
export const PRIORITY_LIMIT = 3;

export function emptyProfile() {
  return {
    diet: 'omnivore', dietNote: '',
    goals: [], medical: [], medicalNote: '', dislikes: [], dislikesNote: '',
    likes: [], likesNote: '', never: '', meals: 4, soups: 'Иногда', cuisine: 'Смешанная',
    favDishes: '', kbju: { on: false, kcal: 0, p: 0, f: 0, c: 0, note: '' },
    priorities: [], delivery: { address: '', entrance: '', floor: '', intercom: '', note: '', slot: 's1' },
    extra: '', weight: '', portion: 'обычная',
    persons: 1, weekdays: [1, 2, 3, 4, 5, 6, 7], slotNote: ''
  };
}

/* ---------- словари для статистики ---------- */
const VEG = ['томат', 'черри', 'огурец', 'капуст', 'морков', 'брокколи', 'горошек', 'тыкв', 'кабач',
  'баклажан', 'перец', 'лук', 'чеснок', 'шпинат', 'салат', 'руккол', 'свёкл', 'свекл', 'картоф',
  'сельдер', 'петрушк', 'укроп', 'кинз', 'базилик', 'редис', 'цукини', 'спарж', 'фасол', 'нут',
  'кукуруз', 'авокадо', 'оливк', 'зелень'];
const FISH = ['лосос', 'форел', 'треск', 'тунец', 'сибас', 'дорадо', 'скумбр', 'хек', 'судак',
  'креветк', 'кальмар', 'мидии', 'морепродукт', 'рыб', 'сельд', 'анчоус'];

/* ---------- даты ---------- */
export const iso = (d) => new Intl.DateTimeFormat('en-CA',
  { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
export const today = () => iso(new Date());
export const plusDays = (n, from) => {
  const d = new Date((from ? String(from).slice(0, 10) : today()) + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dateRu = (date, opts) => new Date(date + 'T12:00:00Z')
  .toLocaleDateString('ru-RU', { timeZone: 'UTC', ...opts });

/* ---------- токены ---------- */
export function signToken(payload, secret, ttl = 1000 * 60 * 60 * 24 * 30) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttl })).toString('base64url');
  return body + '.' + crypto.createHmac('sha256', secret).update(body).digest('base64url');
}
export function readToken(token, secret) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const expect = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return data.exp > Date.now() ? data : null;
  } catch { return null; }
}

/* ---------- мелочи ---------- */
const uid = (p) => p + crypto.randomBytes(4).toString('hex');
const digits = (s) => String(s || '').replace(/\D/g, '');
const arr = (v) => Array.isArray(v) ? v.filter(x => typeof x === 'string').map(x => x.trim()).filter(Boolean) : [];
const str = (v) => typeof v === 'string' ? v.trim() : '';

/* «Кухня Натальи»: имя в родительном падеже. Несклоняемые (Натали, Мари) остаются как есть. */
export function possessive(name) {
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  if (!first) return '';
  const low = first.toLowerCase();
  if (/[иоуеэюы]$/.test(low)) return first;
  if (/я$/.test(low)) return first.slice(0, -1) + 'и';
  if (/а$/.test(low)) return (/[жчшщгкх]а$/.test(low) ? first.slice(0, -1) + 'и' : first.slice(0, -1) + 'ы');
  if (/й$/.test(low)) return first.slice(0, -1) + 'я';
  if (/ь$/.test(low)) return first.slice(0, -1) + 'я';
  return first + 'а';
}

/* 1 кухня · 2 кухни · 5 кухонь */
export const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
};

function dishOf(db, id) { return db.dishes.find(d => d.id === id) || null; }

export function dayMenu(db, date) {
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
const slotById = (db, id) => db.slots.find(s => s.id === id) || db.slots[0];

/* Сколько дней доставки выпадает на период с учётом выбранных дней недели.
   ISO-день: понедельник = 1, воскресенье = 7. */
export function deliveryDays(from, to, weekdays) {
  const w = (weekdays && weekdays.length) ? weekdays : [1, 2, 3, 4, 5, 6, 7];
  let n = 0;
  for (let d = from; d <= to; d = plusDays(1, d)) {
    const day = new Date(d + 'T12:00:00Z').getUTCDay();
    if (w.includes(day === 0 ? 7 : day)) n++;
  }
  return n;
}

/* Итог цикла: сколько дней доставлено и сколько порций съедено.
   Учитывает приёмы пищи в день, число человек и график по дням недели. */
export function cycleSummary(db, c) {
  const profile = { ...emptyProfile(), ...(c.profile || {}) };
  const start = c.cycleStart || plusDays(-Math.max(0, (c.planDays || 0) - (c.daysLeft || 0)));
  const end = today();
  /* план = столько-то ДНЕЙ ДОСТАВКИ, поэтому счётчик упирается в planDays,
     иначе у клиента с давним стартом цикла набежали бы лишние дни */
  const passed = Math.max(0, deliveryDays(start, end, profile.weekdays));
  const days = Math.min(passed, +c.planDays || passed);
  const perDay = (+profile.meals || 4) * (+profile.persons || 1);
  const mine = db.ratings.filter(r => r.clientId === c.id);
  return {
    start, end, days,
    meals: profile.meals, persons: profile.persons,
    weekdays: profile.weekdays,
    dishes: days * perDay,
    planDays: c.planDays,
    rated: mine.length,
    loved: mine.filter(r => r.stars === 5 || r.mark === 'love').length,
    done: (c.daysLeft || 0) <= 0
  };
}
const tariffByDays = (db, days) => db.tariffs.find(t => +t.days === +days) || db.tariffs[0];

/* ---------- разбор строк для админки ---------- */
export function parseSmart(text) {
  const parts = String(text || '').split('/').map(s => s.trim()).filter(Boolean);
  const out = { name: '', cat: null, kcal: 0, p: 0, f: 0, c: 0, weight: 0, price: 0, tags: [] };
  parts.forEach((raw, i) => {
    const low = raw.toLowerCase();
    if (i === 0) { out.name = raw; return; }
    const cat = CATS.find(c => low.startsWith(CAT_RU[c].toLowerCase().slice(0, 5)));
    if (cat) { out.cat = cat; return; }
    if (/ккал/.test(low)) { out.kcal = parseInt(low, 10) || 0; return; }
    const mac = raw.match(/^(\d+)\s*[-/x]\s*(\d+)\s*[-/x]\s*(\d+)$/);
    if (mac) { out.p = +mac[1]; out.f = +mac[2]; out.c = +mac[3]; return; }
    if (/\d/.test(low) && /(г|гр|g)$/.test(low)) { out.weight = parseInt(low, 10) || 0; return; }
    if (/^\d+([.,]\d+)?$/.test(low)) { out.price = parseFloat(low.replace(',', '.')) || 0; return; }
    out.tags = out.tags.concat(raw.split(',').map(s => s.trim()).filter(Boolean));
  });
  if (!out.cat) out.cat = 'lunch';
  return out;
}
export function parseTable(text) {
  return String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(line => {
    const c = line.split(/\t|;/).length > 1 ? line.split(/\t|;/) : line.split(',');
    const col = c.map(x => String(x).trim());
    const cat = CATS.find(k => (col[1] || '').toLowerCase().startsWith(CAT_RU[k].toLowerCase().slice(0, 5))) || 'lunch';
    return {
      name: col[0] || '', cat,
      kcal: +col[2] || 0, p: +col[3] || 0, f: +col[4] || 0, c: +col[5] || 0,
      weight: +col[6] || 0, price: +col[7] || 0,
      tags: (col[8] || '').split(/[,·]/).map(s => s.trim()).filter(Boolean),
      ing: col[9] || '', cuisine: col[10] || 'домашняя'
    };
  }).filter(r => r.name);
}

/* ---------- статистика клиента ---------- */
export function clientStats(db, c) {
  const from = today().slice(0, 7) + '-01';
  const dates = Object.keys(db.menu).filter(d => d >= from && d <= today()).sort();
  const dishes = [];
  dates.forEach(d => CATS.forEach(cat => {
    const dish = dishOf(db, (db.menu[d] || {})[cat]);
    if (dish) dishes.push(dish);
  }));
  const uniq = [...new Map(dishes.map(d => [d.id, d])).values()];
  const ing = uniq.map(d => String(d.ing || '').toLowerCase()).join(', ');
  const hit = (list) => list.filter(w => ing.includes(w)).length;
  const cuisines = [...new Set(uniq.map(d => d.cuisine).filter(Boolean))];
  const mine = db.ratings.filter(r => r.clientId === c.id);
  return {
    monthLabel: dateRu(today(), { month: 'long' }),
    items: [
      { icon: '🍤', n: uniq.length, label: plural(uniq.length, 'новое блюдо', 'новых блюда', 'новых блюд') },
      { icon: '🥬', n: hit(VEG), label: plural(hit(VEG), 'вид овощей и зелени', 'вида овощей и зелени', 'видов овощей и зелени') },
      { icon: '🐟', n: hit(FISH), label: plural(hit(FISH), 'вид рыбы и морепродуктов', 'вида рыбы и морепродуктов', 'видов рыбы и морепродуктов') },
      { icon: '🌍', n: cuisines.length, label: plural(cuisines.length, 'кухня мира', 'кухни мира', 'кухонь мира') }
    ],
    cuisines,
    rated: mine.length,
    loved: mine.filter(r => r.mark === 'love' || r.stars === 5).length
  };
}

/* ---------- сборка кабинета ---------- */
export const dietLabel = (id) => {
  const d = OPTS.diets.find(x => x.id === id);
  return d ? d.icon + ' ' + d.name : '';
};

/* Фавориты клиента: то, что он отметил сердечком в коллекции,
   плюс блюда с пятью звёздами или отметкой «в любимые» из оценок.
   Рядом с каждым — его собственная оценка, если она была. */
export function clientFavourites(db, c) {
  const rated = db.ratings.filter(r => r.clientId === c.id);
  const best = new Map();
  rated.forEach(r => {
    const cur = best.get(r.dishId);
    if (!cur || (r.updatedAt || r.createdAt || '') > (cur.updatedAt || cur.createdAt || '')) best.set(r.dishId, r);
  });
  const ids = new Set([
    ...(c.favourites || []),
    ...rated.filter(r => r.stars === 5 || r.mark === 'love').map(r => r.dishId)
  ]);
  return [...ids].map(id => {
    const dish = dishOf(db, id);
    if (!dish) return null;
    const r = best.get(id) || null;
    return {
      dish,
      starred: (c.favourites || []).includes(id),
      stars: r ? r.stars : 0,
      mark: r ? r.mark : null,
      text: r ? r.text : '',
      date: r ? r.date : ''
    };
  }).filter(Boolean).sort((a, b) => (b.stars - a.stars) || a.dish.name.localeCompare(b.dish.name));
}

export function clientDashboard(db, id) {
  const c = db.clients.find(x => x.id === id);
  if (!c) return null;
  const t = tariffByDays(db, c.planDays);
  const profile = { ...emptyProfile(), ...(c.profile || {}) };
  const mine = db.ratings.filter(r => r.clientId === c.id);
  const byDish = new Map(mine.map(r => [r.dishId, r]));
  const yesterday = plusDays(-1);

  return {
    client: {
      id: c.id, name: c.name, phone: c.phone, address: c.address, slot: c.slot, notes: c.notes,
      paused: c.paused, daysLeft: c.daysLeft, planDays: c.planDays, planName: t.name,
      photo: c.photo || '', kitchen: 'Кухня ' + possessive(c.name)
    },
    chefNote: (c.chefNote && c.chefNote.date === today() && c.chefNote.text) ? c.chefNote : null,
    today: dayMenu(db, today()),
    tomorrow: dayMenu(db, plusDays(1)),
    yesterday: dayMenu(db, yesterday),
    profile,
    options: OPTS,
    priorityLimit: PRIORITY_LIMIT,
    ratings: mine,
    rateMap: Object.fromEntries(byDish),
    favourites: clientFavourites(db, c),
    favouriteIds: c.favourites || [],
    stats: clientStats(db, c),
    cycle: cycleSummary(db, c),
    cycleText: db.content.cycle_text || '',
    cycleTitle: db.content.cycle_title || 'Рацион завершён',
    cycleCta: db.content.cycle_cta || 'Собрать следующий рацион',
    calendar: Array.from({ length: 28 }, (_, i) => {
      const date = plusDays(i - 3);
      const active = i >= 3 && i - 3 < c.daysLeft;
      return { date, day: +date.slice(8), active, paused: c.paused && (i === 4 || i === 5), hasMenu: !!db.menu[date] };
    }),
    history: c.history || [],
    requests: db.requests.filter(r => r.clientId === c.id),
    tariffs: db.tariffs,
    slots: db.slots,
    norms: profile.kbju.on && profile.kbju.kcal
      ? { kcal: +profile.kbju.kcal, p: +profile.kbju.p, f: +profile.kbju.f, c: +profile.kbju.c }
      : (c.norms || { kcal: 1900, p: 130, f: 70, c: 210 })
  };
}

/* ---------- нормализация присланного профиля ---------- */
function sanitizeProfile(input, base) {
  const p = { ...emptyProfile(), ...(base || {}) };
  const b = input || {};
  if ('diet' in b) p.diet = OPTS.diets.some(d => d.id === b.diet) ? b.diet : p.diet;
  if ('goals' in b) p.goals = arr(b.goals).filter(x => OPTS.goals.includes(x));
  if ('medical' in b) p.medical = arr(b.medical).filter(x => OPTS.medical.includes(x));
  if ('dislikes' in b) p.dislikes = arr(b.dislikes).filter(x => OPTS.products.includes(x));
  if ('likes' in b) p.likes = arr(b.likes).filter(x => OPTS.products.includes(x));
  if ('priorities' in b) p.priorities = arr(b.priorities).filter(x => OPTS.priorities.includes(x)).slice(0, PRIORITY_LIMIT);
  ['medicalNote', 'dislikesNote', 'likesNote', 'never', 'favDishes', 'extra', 'weight', 'dietNote'].forEach(k => {
    if (k in b) p[k] = str(b[k]).slice(0, 2000);
  });
  if ('meals' in b) p.meals = OPTS.meals.includes(+b.meals) ? +b.meals : p.meals;
  if ('persons' in b) p.persons = OPTS.persons.includes(+b.persons) ? +b.persons : p.persons;
  if ('weekdays' in b) {
    const w = (Array.isArray(b.weekdays) ? b.weekdays : []).map(Number).filter(n => n >= 1 && n <= 7);
    p.weekdays = w.length ? [...new Set(w)].sort((a, x) => a - x) : p.weekdays;
  }
  if ('slotNote' in b) p.slotNote = str(b.slotNote).slice(0, 300);
  if ('soups' in b) p.soups = OPTS.soups.includes(b.soups) ? b.soups : p.soups;
  if ('cuisine' in b) p.cuisine = OPTS.cuisines.includes(b.cuisine) ? b.cuisine : p.cuisine;
  if ('portion' in b) p.portion = OPTS.portions.includes(b.portion) ? b.portion : p.portion;
  if (b.kbju) {
    const k = b.kbju, cal = k.calc || {};
    p.kbju = {
      on: !!k.on,
      mode: ['off', 'calc', 'manual'].includes(k.mode) ? k.mode : (k.on ? 'manual' : 'off'),
      kcal: +k.kcal || 0, p: +k.p || 0, f: +k.f || 0, c: +k.c || 0,
      note: str(k.note).slice(0, 2000),
      calc: {
        sex: cal.sex === 'm' ? 'm' : cal.sex === 'f' ? 'f' : '',
        age: +cal.age || '', height: +cal.height || '', weight: +cal.weight || '',
        activity: str(cal.activity), goal: str(cal.goal)
      }
    };
  }
  if (b.delivery) {
    const d = b.delivery;
    p.delivery = {
      address: str(d.address), entrance: str(d.entrance), floor: str(d.floor),
      intercom: str(d.intercom), note: str(d.note),
      slot: str(d.slot) || p.delivery.slot
    };
  }
  return p;
}

function logChange(c, text) {
  c.log = c.log || [];
  c.log.unshift({ at: new Date().toISOString(), text });
  c.log = c.log.slice(0, 40);
}

/* «Личное дело» для админки */
function dossier(db, c) {
  const profile = { ...emptyProfile(), ...(c.profile || {}) };
  const mine = db.ratings.filter(r => r.clientId === c.id)
    .map(r => ({ ...r, dish: dishOf(db, r.dishId) })).filter(x => x.dish);
  const loved = mine.filter(r => r.stars === 5 || r.mark === 'love');
  const never = mine.filter(r => r.mark === 'never');
  const lastPaid = db.orders.find(o => o.clientId === c.id && o.status === 'paid');
  return {
    client: { ...c, kitchen: 'Кухня ' + possessive(c.name) },
    profile,
    dietLabel: dietLabel(profile.diet),
    stats: clientStats(db, c),
    cycle: cycleSummary(db, c),
    ratings: mine.slice(0, 12),
    loved, never,
    favourites: clientFavourites(db, c),
    favouriteCuisines: [...new Set(loved.map(r => r.dish.cuisine).filter(Boolean))],
    favouriteIngredients: [...new Set(loved.flatMap(r =>
      String(r.dish.ing || '').split(',').map(s => s.trim()).filter(Boolean)))].slice(0, 14),
    history: c.history || [],
    log: c.log || [],
    requests: db.requests.filter(r => r.clientId === c.id).slice(0, 10),
    lastDelivery: lastPaid ? (lastPaid.paidAt || lastPaid.createdAt) : null,
    chefNote: c.chefNote || { date: '', text: '' },
    chefComments: c.chefComments || []
  };
}

/* =======================================================================
   Роутер. Возвращает { code, data, changed }.
   ======================================================================= */
export async function handle({ method: M, path, body = {}, query = {}, token = '', db, secret, adminPassword }) {
  const p = String(path).replace(/\/$/, '');
  const seg = p.split('/');
  const sess = readToken(token, secret);
  const isAdmin = !!sess && sess.role === 'admin';
  const ok = (data) => ({ code: 200, data, changed: false });
  const saved = (data) => ({ code: 200, data, changed: true });
  const err = (code, error) => ({ code, data: { error }, changed: false });

  /* ---------- публичное ---------- */
  if (M === 'GET' && p === '/api/public') {
    return ok({
      content: db.content, tariffs: db.tariffs,
      today: dayMenu(db, today()), tomorrow: dayMenu(db, plusDays(1)),
      excludeOptions: db.excludeOptions, slots: db.slots,
      options: OPTS, priorityLimit: PRIORITY_LIMIT
    });
  }
  if (M === 'GET' && p === '/api/dishes') return ok({ dishes: db.dishes, cats: CAT_RU });

  /* Диагностика. Значений не раскрывает — только «задано / не задано». */
  if (M === 'GET' && p === '/api/health') {
    return ok({
      version: 'nc-2.1',
      envAdminPassword: !!process.env.NC_ADMIN_PASSWORD,
      envSecret: !!process.env.NC_SECRET,
      usingSeedPassword: adminPassword === 'CHANGE_ME_IN_NETLIFY_ENV',
      counts: {
        dishes: db.dishes.length,
        clients: db.clients.length,
        orders: db.orders.length,
        ratings: (db.ratings || []).length
      },
      hasCollectionPage: true,
      slots: db.slots.map(x => x.label)
    });
  }

  if (M === 'GET' && p === '/api/reviews') {
    const list = db.ratings.filter(r => r.published && r.text)
      .map(r => {
        const d = dishOf(db, r.dishId);
        const c = db.clients.find(x => x.id === r.clientId);
        return d ? {
          id: r.id, stars: r.stars, text: r.text, dish: d.name, img: d.img,
          author: c ? c.name.split(' ')[0] : 'Клиент', date: r.date
        } : null;
      }).filter(Boolean).slice(0, 12);
    return ok({ reviews: list });
  }

  /* повторный заказ: «мы помним ваши предпочтения» */
  if (M === 'POST' && p === '/api/client/lookup') {
    const phone = digits(body.phone);
    const c = phone.length >= 5 && db.clients.find(x => digits(x.phone).endsWith(phone.slice(-9)));
    if (!c) return ok({ found: false });
    return ok({
      found: true, clientId: c.id, name: c.name,
      kitchen: 'Кухня ' + possessive(c.name),
      profile: { ...emptyProfile(), ...(c.profile || {}) }
    });
  }

  if (M === 'POST' && p === '/api/promo/check') {
    const code = str(body.promo).toUpperCase();
    if (!code) return err(400, 'Введите промокод');
    const off = db.promos[code];
    if (!off) return err(404, 'Такого промокода нет');
    return ok({ promo: code, discount: +off });
  }
  if (M === 'POST' && p === '/api/orders') {
    if (!body.terms) return err(400, 'Нужно принять Условия сервиса');
    const t = tariffById(db, body.tariffId);
    const profile = sanitizeProfile(body.profile, null);
    const order = {
      id: uid('o'), status: 'pending', createdAt: new Date().toISOString(),
      name: str(body.name), phone: str(body.phone),
      address: profile.delivery.address || str(body.address),
      flat: str(body.flat), slot: profile.delivery.slot || db.slots[0].id,
      note: profile.delivery.note || str(body.note),
      tariffId: t.id, planDays: t.days, meals: profile.meals || +body.meals || t.meals,
      exclude: profile.dislikes.length ? profile.dislikes : arr(body.exclude),
      promo: str(body.promo).toUpperCase(),
      sum: t.perDay * t.days,
      profile, clientId: str(body.clientId) || null,
      terms: !!body.terms, termsAt: body.terms ? new Date().toISOString() : null
    };
    order.promoDiscount = 0;
    order.sumFull = order.sum;
    if (order.promo && db.promos[order.promo]) {
      order.promoDiscount = +db.promos[order.promo];
      order.sum = Math.round(order.sum * (1 - order.promoDiscount / 100));
    } else if (order.promo) {
      order.promoInvalid = true;      // код ввели, но он не сработал — видно в админке
    }
    const sl = slotById(db, order.slot);
    order.slotExtra = +sl.extra || 0;
    order.slotLabel = sl.label;
    order.slotNote = profile.slotNote;
    if (order.slotExtra) order.sum += order.slotExtra;
    db.orders.unshift(order);
    return saved({ order });
  }
  if (M === 'GET' && p === '/api/orders' && !isAdmin) {
    const phone = digits(query.phone);
    return ok({ orders: phone.length > 4 ? db.orders.filter(o => digits(o.phone) === phone) : [] });
  }
  if (M === 'POST' && /^\/api\/orders\/[^/]+\/pay$/.test(p)) {
    const o = db.orders.find(x => x.id === seg[3]);
    if (!o) return err(404, 'Заявка не найдена');
    if (o.status !== 'approved') return err(400, 'Заявка ещё не подтверждена');
    o.status = 'paid'; o.pay = str(body.pay) || 'card'; o.paidAt = new Date().toISOString();
    let c = db.clients.find(x => digits(x.phone) === digits(o.phone));
    if (!c) {
      c = {
        id: uid('c'), name: o.name, phone: o.phone,
        address: o.address + (o.flat ? ', ' + o.flat : ''), slot: o.slot,
        notes: (o.exclude || []).join(', '), planDays: o.planDays, daysLeft: o.planDays,
        paused: false, history: [], profile: o.profile || emptyProfile(),
        photo: '', chefNote: { date: '', text: '' }, chefComments: [], log: [],
        favourites: [], cycleStart: today(), cycleDone: false
      };
      db.clients.unshift(c);
      logChange(c, 'Клиент создан из заявки ' + o.id);
    } else {
      c.daysLeft += o.planDays; c.planDays = o.planDays;
      if (o.profile) c.profile = o.profile;
      c.cycleStart = today(); c.cycleDone = false;
      logChange(c, 'Продление на ' + o.planDays + ' дней');
    }
    c.history = c.history || [];
    c.history.unshift({
      title: 'NC · ' + o.planDays + ' дней',
      meta: dateRu(today()) + ' · ' + o.meals + ' приёма', sum: o.sum
    });
    o.clientId = c.id;
    return saved({ order: o, clientId: c.id });
  }
  if (M === 'GET' && /^\/api\/orders\/[^/]+$/.test(p)) {
    const o = db.orders.find(x => x.id === seg[3]);
    return o ? ok({ order: o }) : err(404, 'Заявка не найдена');
  }

  /* ---------- кабинет ---------- */
  if (M === 'POST' && p === '/api/client/login') {
    const phone = digits(body.phone);
    const c = phone.length >= 5 && db.clients.find(x => digits(x.phone).endsWith(phone.slice(-9)));
    if (!c) return err(404, 'Клиент с таким телефоном не найден');
    return ok({ token: signToken({ role: 'client', clientId: c.id }, secret), clientId: c.id });
  }

  const isClientRoute = /^\/api\/client\/[^/]+/.test(p) && seg[3] !== 'login' && seg[3] !== 'lookup';
  if (isClientRoute) {
    const id = seg[3];
    const c = db.clients.find(x => x.id === id);
    if (!c) return err(404, 'Клиент не найден');
    if (!isAdmin && (!sess || sess.clientId !== id)) return err(401, 'Нужен вход в кабинет');

    if (M === 'GET' && seg.length === 4) return ok(clientDashboard(db, id));

    if (M === 'PUT' && seg[4] === 'profile') {
      c.profile = sanitizeProfile(body, c.profile);
      if (c.profile.delivery.address) c.address = c.profile.delivery.address;
      if (c.profile.delivery.slot) c.slot = c.profile.delivery.slot;
      c.notes = [c.profile.dislikes.join(', '), c.profile.medicalNote].filter(Boolean).join(' · ');
      logChange(c, 'Клиент обновил предпочтения');
      return saved({ profile: c.profile, client: clientDashboard(db, id).client });
    }
    /* лёгкий запрос для страницы коллекции: что отмечено и что оценено */
    if (M === 'GET' && seg[4] === 'favourites') {
      return ok({
        favourites: c.favourites || [],
        ratings: db.ratings.filter(r => r.clientId === c.id)
          .map(r => ({ dishId: r.dishId, stars: r.stars, mark: r.mark }))
      });
    }
    if (M === 'POST' && seg[4] === 'favourite') {
      const d = dishOf(db, body.dishId);
      if (!d) return err(404, 'Блюдо не найдено');
      c.favourites = c.favourites || [];
      const i = c.favourites.indexOf(d.id);
      const added = i < 0;
      if (added) c.favourites.push(d.id); else c.favourites.splice(i, 1);
      logChange(c, (added ? 'Добавил(а) в любимые: ' : 'Убрал(а) из любимых: ') + d.name);
      return saved({ favourites: c.favourites, added });
    }
    if (M === 'POST' && seg[4] === 'pause') {
      c.paused = !c.paused;
      db.requests.unshift({
        id: uid('r'), clientId: c.id, client: c.name, type: 'pause',
        text: c.paused ? 'Пауза рациона' : 'Возобновление рациона',
        status: 'pending', createdAt: new Date().toISOString()
      });
      logChange(c, c.paused ? 'Поставил рацион на паузу' : 'Возобновил рацион');
      return saved({ paused: c.paused });
    }
    if (M === 'POST' && seg[4] === 'slot') {
      const s = db.slots.find(x => x.id === body.slot);
      if (!s) return err(400, 'Неизвестное окно доставки');
      c.slot = s.id;
      c.profile = { ...emptyProfile(), ...(c.profile || {}) };
      c.profile.delivery.slot = s.id;
      logChange(c, 'Сменил окно доставки на ' + s.label);
      return saved({ slot: s.id });
    }
    if (M === 'POST' && seg[4] === 'swap') {
      const d = dishOf(db, body.dishId);
      if (!d) return err(404, 'Блюдо не найдено');
      db.requests.unshift({
        id: uid('r'), clientId: c.id, client: c.name, type: 'swap', status: 'pending',
        date: str(body.date) || plusDays(1), cat: body.cat, dishId: d.id,
        text: 'Запрос замены · ' + (CAT_RU[body.cat] || '') + ' → ' + d.name,
        createdAt: new Date().toISOString()
      });
      return saved({ ok: true });
    }
    if (M === 'POST' && seg[4] === 'extend') {
      const t = tariffById(db, body.tariffId);
      const order = {
        id: uid('o'), status: 'pending', createdAt: new Date().toISOString(), clientId: c.id,
        name: c.name, phone: c.phone, address: c.address, slot: c.slot,
        tariffId: t.id, planDays: t.days, meals: t.meals, exclude: [],
        sum: t.perDay * t.days, note: 'Продление рациона', profile: c.profile || emptyProfile()
      };
      db.orders.unshift(order);
      return saved({ order });
    }
    /* оценка блюда */
    if (M === 'POST' && seg[4] === 'rate') {
      const d = dishOf(db, body.dishId);
      if (!d) return err(404, 'Блюдо не найдено');
      const date = str(body.date) || plusDays(-1);
      const stars = Math.max(0, Math.min(5, +body.stars || 0));
      const mark = ['love', 'never', 'repeat'].includes(body.mark) ? body.mark : null;
      const text = str(body.text).slice(0, 1200);
      let r = db.ratings.find(x => x.clientId === c.id && x.dishId === d.id && x.date === date);
      if (!r) {
        r = { id: uid('rt'), clientId: c.id, dishId: d.id, date, stars: 0, mark: null, text: '', published: false, createdAt: new Date().toISOString() };
        db.ratings.unshift(r);
      }
      if ('stars' in body) r.stars = stars;
      if ('mark' in body) r.mark = r.mark === mark ? null : mark;
      if ('text' in body) { r.text = text; r.published = false; }
      r.updatedAt = new Date().toISOString();
      if (r.mark === 'never') {
        db.requests.unshift({
          id: uid('r'), clientId: c.id, client: c.name, type: 'never', status: 'pending',
          dishId: d.id, text: 'Больше не готовить · ' + d.name, createdAt: new Date().toISOString()
        });
      }
      logChange(c, 'Оценил «' + d.name + '»' + (r.stars ? ' на ' + r.stars + '★' : ''));
      return saved({ rating: r });
    }
    return err(404, 'Неизвестный метод кабинета');
  }

  /* ---------- админка ---------- */
  if (M === 'POST' && p === '/api/admin/login') {
    if (str(body.password) !== adminPassword) return err(401, 'Неверный пароль');
    return ok({ token: signToken({ role: 'admin' }, secret) });
  }
  if (!isAdmin) return err(401, 'Нужен вход в админку');

  if (M === 'GET' && p === '/api/admin/state') {
    const week = Array.from({ length: 7 }, (_, i) => {
      const date = plusDays(i);
      return { date, label: dateRu(date, { weekday: 'short', day: 'numeric' }), menu: dayMenu(db, date) };
    });
    return ok({
      dishes: db.dishes, tariffs: db.tariffs, content: db.content, clients: db.clients,
      orders: db.orders, requests: db.requests, week, slots: db.slots, cats: CAT_RU,
      promos: db.promos, options: OPTS,
      ratings: db.ratings.map(r => {
        const d = dishOf(db, r.dishId);
        const c = db.clients.find(x => x.id === r.clientId);
        return { ...r, dishName: d ? d.name : '—', clientName: c ? c.name : '—' };
      })
    });
  }
  if (M === 'GET' && p === '/api/orders') return ok({ orders: db.orders });

  /* резервная копия: выгрузка и восстановление всей базы */
  if (M === 'GET' && p === '/api/admin/backup') {
    return ok({ backup: { ...db, admin: undefined }, at: new Date().toISOString() });
  }
  if (M === 'POST' && p === '/api/admin/restore') {
    const b = body.backup;
    if (!b || typeof b !== 'object') return err(400, 'Файл не похож на резервную копию');
    for (const k of ['dishes', 'tariffs', 'slots', 'clients', 'orders']) {
      if (!Array.isArray(b[k])) return err(400, 'В копии нет раздела «' + k + '» — восстановление отменено');
    }
    const keepAdmin = db.admin;
    Object.keys(db).forEach(k => { delete db[k]; });
    Object.assign(db, b, { admin: keepAdmin });
    db.requests = db.requests || [];
    db.ratings = db.ratings || [];
    db.menu = db.menu || {};
    db.promos = db.promos || {};
    return saved({ ok: true, dishes: db.dishes.length, clients: db.clients.length, orders: db.orders.length });
  }

  if (M === 'GET' && /^\/api\/clients\/[^/]+\/dossier$/.test(p)) {
    const c = db.clients.find(x => x.id === seg[3]);
    return c ? ok(dossier(db, c)) : err(404, 'Клиент не найден');
  }
  if (M === 'PUT' && /^\/api\/clients\/[^/]+\/chef-note$/.test(p)) {
    const c = db.clients.find(x => x.id === seg[3]);
    if (!c) return err(404, 'Клиент не найден');
    c.chefNote = { date: str(body.date) || today(), text: str(body.text).slice(0, 1200) };
    logChange(c, 'Шеф оставил сообщение');
    return saved({ chefNote: c.chefNote });
  }
  if (M === 'POST' && /^\/api\/clients\/[^/]+\/comment$/.test(p)) {
    const c = db.clients.find(x => x.id === seg[3]);
    if (!c) return err(404, 'Клиент не найден');
    const text = str(body.text).slice(0, 2000);
    if (!text) return err(400, 'Пустой комментарий');
    c.chefComments = c.chefComments || [];
    c.chefComments.unshift({ id: uid('cm'), at: new Date().toISOString(), text });
    c.chefComments = c.chefComments.slice(0, 60);
    return saved({ chefComments: c.chefComments });
  }
  if (M === 'DELETE' && /^\/api\/clients\/[^/]+\/comment\/[^/]+$/.test(p)) {
    const c = db.clients.find(x => x.id === seg[3]);
    if (!c) return err(404, 'Клиент не найден');
    c.chefComments = (c.chefComments || []).filter(x => x.id !== seg[5]);
    return saved({ chefComments: c.chefComments });
  }
  if (M === 'PUT' && /^\/api\/clients\/[^/]+\/profile$/.test(p)) {
    const c = db.clients.find(x => x.id === seg[3]);
    if (!c) return err(404, 'Клиент не найден');
    c.profile = sanitizeProfile(body, c.profile);
    logChange(c, 'Шеф обновил анкету');
    return saved({ profile: c.profile });
  }
  if (M === 'PUT' && /^\/api\/clients\/[^/]+$/.test(p)) {
    const c = db.clients.find(x => x.id === seg[3]);
    if (!c) return err(404, 'Клиент не найден');
    ['name', 'phone', 'address', 'slot', 'notes', 'photo'].forEach(k => { if (k in body) c[k] = str(body[k]); });
    ['daysLeft', 'planDays'].forEach(k => { if (k in body) c[k] = +body[k] || 0; });
    if ('paused' in body) c.paused = !!body.paused;
    logChange(c, 'Данные изменены в админке');
    return saved({ client: c });
  }

  if (M === 'POST' && /^\/api\/ratings\/[^/]+\/(publish|hide)$/.test(p)) {
    const r = db.ratings.find(x => x.id === seg[3]);
    if (!r) return err(404, 'Отзыв не найден');
    r.published = p.endsWith('publish');
    return saved({ rating: r });
  }

  if (M === 'POST' && p === '/api/dishes') {
    const src = body.smart ? parseSmart(body.smart) : body;
    const d = {
      id: uid('d'), name: str(src.name) || 'Без названия', cat: src.cat || 'lunch',
      kcal: +src.kcal || 0, p: +src.p || 0, f: +src.f || 0, c: +src.c || 0,
      weight: +src.weight || 0, price: +src.price || 0,
      tags: arr(src.tags), ing: str(body.ing || src.ing), img: str(body.img),
      desc: str(body.desc), why: str(body.why),
      cuisine: str(body.cuisine || src.cuisine) || 'домашняя'
    };
    db.dishes.unshift(d);
    return saved({ dish: d });
  }
  if (M === 'POST' && p === '/api/dishes/bulk') {
    const rows = body.text ? parseTable(body.text) : (body.rows || []);
    const added = rows.map(r => Object.assign(
      { id: uid('d'), img: '', ing: '', tags: [], desc: '', why: '', cuisine: 'домашняя' }, r));
    db.dishes = added.concat(db.dishes);
    return saved({ added: added.length, dishes: db.dishes });
  }
  if (M === 'POST' && /^\/api\/dishes\/[^/]+\/duplicate$/.test(p)) {
    const d = dishOf(db, seg[3]);
    if (!d) return err(404, 'Блюдо не найдено');
    const copy = { ...d, id: uid('d'), name: d.name + ' (копия)' };
    db.dishes.unshift(copy);
    return saved({ dish: copy });
  }
  if (M === 'PUT' && /^\/api\/dishes\/[^/]+$/.test(p)) {
    const d = dishOf(db, seg[3]);
    if (!d) return err(404, 'Блюдо не найдено');
    ['name', 'cat', 'ing', 'img', 'desc', 'why', 'cuisine'].forEach(k => { if (k in body) d[k] = str(body[k]); });
    ['kcal', 'p', 'f', 'c', 'weight', 'price'].forEach(k => { if (k in body) d[k] = +body[k] || 0; });
    if ('tags' in body) {
      d.tags = Array.isArray(body.tags) ? arr(body.tags)
        : String(body.tags).split(',').map(s => s.trim()).filter(Boolean);
    }
    return saved({ dish: d });
  }
  if (M === 'DELETE' && /^\/api\/dishes\/[^/]+$/.test(p)) {
    db.dishes = db.dishes.filter(x => x.id !== seg[3]);
    return saved({ ok: true });
  }
  if (M === 'PUT' && p === '/api/menu') {
    db.menu[body.date] = db.menu[body.date] || {};
    if (body.dishId) db.menu[body.date][body.cat] = body.dishId;
    else delete db.menu[body.date][body.cat];
    return saved({ menu: dayMenu(db, body.date) });
  }
  if (M === 'POST' && p === '/api/menu/autofill') {
    const days = +body.days || 7;
    for (let i = 0; i < days; i++) {
      const date = plusDays(i);
      db.menu[date] = db.menu[date] || {};
      CATS.forEach((cat, ci) => {
        if (!db.menu[date][cat]) {
          const pool = db.dishes.filter(d => d.cat === cat);
          if (pool.length) db.menu[date][cat] = pool[(i * 2 + ci) % pool.length].id;
        }
      });
    }
    return saved({ ok: true });
  }
  if (M === 'PUT' && /^\/api\/tariffs\/[^/]+$/.test(p)) {
    const t = tariffById(db, seg[3]);
    ['name', 'code'].forEach(k => { if (k in body) t[k] = str(body[k]); });
    ['perDay', 'days', 'meals'].forEach(k => { if (k in body) t[k] = +body[k] || 0; });
    return saved({ tariff: t });
  }
  if (M === 'PUT' && p === '/api/slots') {
    const list = Array.isArray(body.slots) ? body.slots : [];
    if (!list.length) return err(400, 'Нужно хотя бы одно окно доставки');
    db.slots = list.slice(0, 8).map((x, i) => ({
      id: str(x.id) || 's' + (i + 1),
      label: str(x.label) || 'Окно ' + (i + 1),
      extra: +x.extra || 0,
      custom: !!x.custom
    }));
    return saved({ slots: db.slots });
  }
  if (M === 'PUT' && p === '/api/promos') {
    const list = Array.isArray(body.promos) ? body.promos : [];
    const out = {};
    list.forEach(x => {
      const code = str(x.code).toUpperCase().replace(/\s+/g, '');
      const off = Math.max(0, Math.min(90, +x.discount || 0));
      if (code && off) out[code] = off;
    });
    db.promos = out;
    return saved({ promos: db.promos });
  }
  if (M === 'PUT' && p === '/api/content') {
    Object.assign(db.content, body);
    return saved({ content: db.content });
  }
  if (M === 'POST' && /^\/api\/orders\/[^/]+\/(approve|reject)$/.test(p)) {
    const o = db.orders.find(x => x.id === seg[3]);
    if (!o) return err(404, 'Заявка не найдена');
    o.status = p.endsWith('approve') ? 'approved' : 'rejected';
    o.decidedAt = new Date().toISOString();
    return saved({ order: o });
  }
  if (M === 'POST' && /^\/api\/requests\/[^/]+\/(approve|reject)$/.test(p)) {
    const r = db.requests.find(x => x.id === seg[3]);
    if (!r) return err(404, 'Запрос не найден');
    r.status = p.endsWith('approve') ? 'approved' : 'rejected';
    if (r.status === 'approved' && r.type === 'swap') {
      db.menu[r.date] = db.menu[r.date] || {};
      db.menu[r.date][r.cat] = r.dishId;
    }
    return saved({ request: r });
  }

  return err(404, 'Неизвестный метод API: ' + M + ' ' + p);
}
