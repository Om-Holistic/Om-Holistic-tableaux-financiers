'use strict';
// Synchronisation : chiffrement côté appareil et serveur de boîtes chiffrées.
const test = require('node:test');
const assert = require('node:assert');
const os = require('os'), fs = require('fs'), path = require('path');
const { SyncCrypto } = require('../js/sync.js');

test('même phrase, mêmes clés sur deux appareils ; phrase différente, tout change', async () => {
  const a = await SyncCrypto.derive('quatre mots que je retiens');
  const b = await SyncCrypto.derive('  quatre mots que je retiens ');
  const c = await SyncCrypto.derive('quatre mots que je retiens!');
  assert.deepStrictEqual(a, b);
  assert.notStrictEqual(a.id, c.id);
  assert.notStrictEqual(a.key, a.id);
  assert.notStrictEqual(a.id, a.token);
  assert.match(a.id, /^[0-9a-f]{64}$/);
});

test('le chiffrement fait l\'aller-retour et ne laisse rien lire', async () => {
  const { key } = await SyncCrypto.derive('quatre mots que je retiens');
  const obj = { state: { apps: [{ name: 'CHRYSALISS', prix: 250 }] }, device: 'iPad' };
  const box = await SyncCrypto.seal(key, obj);
  assert.ok(!box.includes('CHRYSALISS'));
  assert.notStrictEqual(box, await SyncCrypto.seal(key, obj)); // vecteur aléatoire à chaque envoi
  assert.deepStrictEqual(await SyncCrypto.open(key, box), obj);
  const other = (await SyncCrypto.derive('une autre phrase secrète')).key;
  await assert.rejects(SyncCrypto.open(other, box));
});

test('serveur : versions, conflit, jeton et anciennes versions', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-sync-'));
  process.env.DATA_DIR = dir;
  process.env.ALLOWED_ORIGINS = 'https://om-holistic.github.io';
  delete require.cache[require.resolve('../sync-server/server.js')];
  const server = require('../sync-server/server.js');
  await new Promise(r => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}/v1/box/` + 'a'.repeat(64);
  const tok = 'b'.repeat(64);
  const put = (body, t = tok) => fetch(base, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Sync-Token': t }, body: JSON.stringify(body) });
  try {
    assert.strictEqual((await fetch(base)).status, 404);
    let r = await put({ base: 0, data: 'v1:AAA' });
    assert.strictEqual(r.status, 200); assert.strictEqual((await r.json()).v, 1);
    r = await put({ base: 1, data: 'v1:BBB' });
    assert.strictEqual((await r.json()).v, 2);
    // Un appareil resté sur la version 1 ne peut pas écraser la 2 : il reçoit la version en ligne.
    r = await put({ base: 1, data: 'v1:CCC' });
    assert.strictEqual(r.status, 409);
    const c = await r.json(); assert.strictEqual(c.v, 2); assert.strictEqual(c.data, 'v1:BBB');
    // Sans le bon jeton, refus.
    assert.strictEqual((await put({ base: 2, data: 'v1:X' }, 'c'.repeat(64))).status, 403);
    assert.strictEqual((await put({ base: 2, data: 'v1:X' }, '')).status, 401);
    r = await fetch(base); const g = await r.json();
    assert.strictEqual(g.v, 2); assert.strictEqual(g.data, 'v1:BBB'); assert.strictEqual(g.token, undefined);
    assert.strictEqual(fs.readdirSync(path.join(dir, 'old', 'a'.repeat(64))).length, 1);
    // Identifiant mal formé et origine inconnue.
    assert.strictEqual((await fetch(base.replace(/a+$/, '../x'))).status, 404);
    r = await fetch(base, { method: 'OPTIONS', headers: { Origin: 'https://ailleurs.example' } });
    assert.strictEqual(r.headers.get('access-control-allow-origin'), null);
    r = await fetch(base, { method: 'OPTIONS', headers: { Origin: 'https://om-holistic.github.io' } });
    assert.strictEqual(r.headers.get('access-control-allow-origin'), 'https://om-holistic.github.io');
  } finally { server.close(); }
});
