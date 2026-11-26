'use strict';
// Serveur de synchronisation d'Om Finances.
// Il range des boîtes chiffrées sur l'appareil : il ne voit jamais les chiffres, ni la phrase secrète.
// Chaque boîte a un identifiant (dérivé de la phrase secrète), un numéro de version et un jeton d'écriture.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = process.env.DATA_DIR || '/data';
const PORT = +process.env.PORT || 8080;
const ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://om-holistic.github.io').split(',').map(s => s.trim()).filter(Boolean);
const MAX = 2 * 1024 * 1024;      // taille maximale d'une boîte
const KEEP = 20;                  // anciennes versions gardées en secours
const LIMIT = 120;                // requêtes par minute et par adresse

const ID = /^[0-9a-f]{64}$/;
const hash = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const file = id => path.join(DIR, id + '.json');

function read(id) {
  try { return JSON.parse(fs.readFileSync(file(id), 'utf8')); } catch { return null; }
}
function write(id, rec) {
  const tmp = file(id) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(rec));
  fs.renameSync(tmp, file(id));
}
function archive(id, rec) {
  const dir = path.join(DIR, 'old', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, String(rec.v).padStart(8, '0') + '.json'), JSON.stringify(rec));
  const all = fs.readdirSync(dir).sort();
  for (const f of all.slice(0, Math.max(0, all.length - KEEP))) fs.unlinkSync(path.join(dir, f));
}

const hits = new Map();
setInterval(() => hits.clear(), 60000).unref();
function limited(ip) {
  const n = (hits.get(ip) || 0) + 1;
  hits.set(ip, n);
  return n > LIMIT;
}

function cors(req, res) {
  const o = req.headers.origin;
  if (o && (ORIGINS.includes('*') || ORIGINS.includes(o))) {
    res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Sync-Token');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
}
function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function body(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const parts = [];
    req.on('data', c => { size += c.length; if (size > MAX) { reject(Object.assign(Error('trop gros'), { code: 413 })); req.destroy(); } else parts.push(c); });
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', reject);
  });
}

async function handle(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') return send(res, 200, { ok: true });
  const ip = String(req.headers['fly-client-ip'] || req.socket.remoteAddress);
  if (limited(ip)) return send(res, 429, { error: 'trop de requêtes' });
  const m = url.pathname.match(/^\/v1\/box\/([^/]+)$/);
  if (!m || !ID.test(m[1])) return send(res, 404, { error: 'introuvable' });
  const id = m[1], rec = read(id);

  if (req.method === 'GET') {
    if (!rec) return send(res, 404, { error: 'vide' });
    return send(res, 200, { v: rec.v, at: rec.at, data: rec.data });
  }
  if (req.method === 'PUT') {
    const token = String(req.headers['x-sync-token'] || '');
    if (!/^[0-9a-f]{64}$/.test(token)) return send(res, 401, { error: 'jeton manquant' });
    let input;
    try { input = JSON.parse(await body(req)); } catch (e) { return send(res, e.code || 400, { error: 'requête illisible' }); }
    if (typeof input.data !== 'string' || !Number.isInteger(input.base) || input.base < 0) return send(res, 400, { error: 'requête incomplète' });
    if (rec && !same(rec.token, hash(token))) return send(res, 403, { error: 'mauvaise phrase secrète' });
    const cur = rec ? rec.v : 0;
    if (input.base !== cur) return send(res, 409, { v: cur, at: rec && rec.at, data: rec && rec.data });
    const next = { v: cur + 1, at: new Date().toISOString(), token: rec ? rec.token : hash(token), data: input.data };
    if (rec) archive(id, rec);
    write(id, next);
    return send(res, 200, { v: next.v, at: next.at });
  }
  return send(res, 405, { error: 'méthode non prise en charge' });
}

fs.mkdirSync(DIR, { recursive: true });
const server = http.createServer((req, res) => handle(req, res).catch(() => send(res, 500, { error: 'erreur du serveur' })));
if (require.main === module) server.listen(PORT, () => console.log('synchro prête sur le port ' + PORT));
module.exports = server;
