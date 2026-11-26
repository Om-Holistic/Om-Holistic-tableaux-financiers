'use strict';
// Chaque fichier de l'appli est chargé avec le même numéro de version que la page,
// pour que l'iPhone et l'iPad ne gardent pas une ancienne copie en mémoire.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');

test('les fichiers portent le numéro de version de la page', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const v = (html.match(/name="om-version" content="([^"]+)"/) || [])[1];
  assert.ok(v, 'numéro de version absent');
  const assets = [...html.matchAll(/(?:src|href)="((?:js\/[\w.]+\.js|styles\.css)[^"]*)"/g)].map(m => m[1]);
  assert.ok(assets.length >= 6);
  for (const a of assets) assert.ok(a.endsWith('?v=' + v), `${a} n'a pas la version ${v}`);
});
