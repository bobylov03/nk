/* NC meals — локальный сервер. Вся логика API живёт в lib/core.mjs,
   здесь только статика, чтение/запись файла и разбор запроса.
   Запуск: node server.mjs   (по умолчанию http://localhost:3000) */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle } from './lib/core.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DB_PATH = path.join(ROOT, 'data', 'db.json');
const PORT = process.env.PORT || 3000;
const SECRET = process.env.NC_SECRET || 'nc-dev-secret-change-me';

const IMG_DIR = path.join(ROOT, 'data', 'images');
fs.mkdirSync(IMG_DIR, { recursive: true });

/* локально фото лежат файлами в data/images — на Netlify их место в Blobs */
const images = {
  async put(key, buf, type) {
    fs.writeFileSync(path.join(IMG_DIR, key), buf);
    fs.writeFileSync(path.join(IMG_DIR, key + '.type'), type);
  },
  async get(key) {
    const f = path.join(IMG_DIR, path.basename(key));
    if (!fs.existsSync(f)) return null;
    const t = fs.existsSync(f + '.type') ? fs.readFileSync(f + '.type', 'utf8') : 'image/jpeg';
    return { buf: fs.readFileSync(f), type: t };
  },
  async del(key) {
    const f = path.join(IMG_DIR, path.basename(key));
    if (fs.existsSync(f)) fs.unlinkSync(f);
    if (fs.existsSync(f + '.type')) fs.unlinkSync(f + '.type');
  }
};

const readDb = () => JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
const writeDb = (db) => fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8'
};

function sendJson(res, code, data) {
  const buf = Buffer.from(JSON.stringify(data));
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(buf);
}

function sendStatic(res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  if (!path.extname(rel)) rel += '.html';                 // /cabinet → /cabinet.html
  const file = path.join(PUBLIC, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Не найдено');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return sendStatic(res, req.url);

  let body = {};
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    if (raw) {
      try { body = JSON.parse(raw); }
      catch { return sendJson(res, 400, { error: 'Некорректный JSON' }); }
    }
  }

  try {
    const db = readDb();
    const result = await handle({
      method: req.method,
      path: url.pathname,
      body,
      query: Object.fromEntries(url.searchParams),
      token: req.headers['x-nc-token'] || '',
      db,
      secret: SECRET,
      adminPassword: process.env.NC_ADMIN_PASSWORD || db.admin.password,
      images
    });
    const { code, data, changed } = result;
    if (changed) writeDb(db);
    if (result.binary) {
      res.writeHead(200, { 'Content-Type': result.binary.type, 'Cache-Control': 'public, max-age=31536000, immutable' });
      return res.end(result.binary.buf);
    }
    sendJson(res, code, data);
  } catch (e) {
    console.error(e);
    sendJson(res, 500, { error: e.message });
  }
}).listen(PORT, () => {
  console.log('NC meals → http://localhost:' + PORT);
  console.log('админка   → http://localhost:' + PORT + '/admin.html');
});
