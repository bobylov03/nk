/* NC meals — API на Netlify Functions (v2).
   Логика в ../../lib/core.mjs, здесь только Blobs и разбор Request/Response. */

import { getStore } from '@netlify/blobs';
import seed from '../../data/db.json' with { type: 'json' };
import { handle } from '../../lib/core.mjs';

export const config = { path: '/api/*' };

const SECRET = process.env.NC_SECRET || 'nc-dev-secret-change-me';
const ADMIN_PASSWORD = process.env.NC_ADMIN_PASSWORD || seed.admin.password;

const store = () => getStore({ name: 'nc-meals', consistency: 'strong' });
const imgStore = () => getStore({ name: 'nc-images' });

/* фотографии блюд: отдельное хранилище, чтобы не раздувать db */
const images = {
  async put(key, buf, type) {
    await imgStore().set(key, buf, { metadata: { type } });
  },
  async get(key) {
    const r = await imgStore().getWithMetadata(key, { type: 'arrayBuffer' });
    if (!r) return null;
    return { buf: Buffer.from(r.data), type: (r.metadata && r.metadata.type) || 'image/jpeg' };
  },
  async del(key) { await imgStore().delete(key); }
};

async function readDb() {
  const s = store();
  const data = await s.get('db', { type: 'json' });
  if (data) return migrate(data);
  const fresh = structuredClone(seed);
  await s.setJSON('db', fresh);
  return fresh;
}
const writeDb = (db) => store().setJSON('db', db);

/* блоб мог быть создан до появления оценок и профилей — дополняем на лету */
function migrate(db) {
  db.ratings = db.ratings || [];
  db.extras = db.extras || seed.extras || [];
  db.extraOrders = db.extraOrders || [];
  db.clients = (db.clients || []).map(c => ({
    photo: '', log: [], chefComments: [], favourites: [], chefNote: { date: '', text: '' }, ...c,
    profile: { diet: 'omnivore', dietNote: '', persons: 1, weekdays: [1,2,3,4,5,6,7], slotNote: '', ...(c.profile || {}) }
  }));
  db.slots = (db.slots || seed.slots).map(s => ({ extra: 0, custom: false, ...s }));
  db.dishes = (db.dishes || []).map(d => ({ cuisine: 'домашняя', ...d }));
  db.content = { ...seed.content, ...db.content };
  return db;
}

const json = (code, data) => new Response(JSON.stringify(data), {
  status: code,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

export default async function handler(req) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/\.netlify\/functions\/api/, '/api');

  let body = {};
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const raw = await req.text();
    if (raw) {
      try { body = JSON.parse(raw); }
      catch { return json(400, { error: 'Некорректный JSON' }); }
    }
  }

  try {
    const db = await readDb();
    const result = await handle({
      method: req.method,
      path,
      body,
      query: Object.fromEntries(url.searchParams),
      token: req.headers.get('x-nc-token') || '',
      db,
      secret: SECRET,
      adminPassword: ADMIN_PASSWORD,
      images
    });
    const { code, data, changed } = result;
    if (changed) await writeDb(db);
    if (result.binary) {
      return new Response(result.binary.buf, {
        status: 200,
        headers: {
          'content-type': result.binary.type,
          'cache-control': 'public, max-age=31536000, immutable'
        }
      });
    }
    return json(code, data);
  } catch (e) {
    return json(500, { error: e.message });
  }
}
