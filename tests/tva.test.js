'use strict';
const test = require('node:test');
const assert = require('node:assert');
const M = require('../js/model.js');
const E = require('../js/engine.js');
const P = require('../js/pnl.js');

const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e * Math.max(1, Math.abs(a), Math.abs(b));
const only = (zone) => Object.fromEntries(M.VAT_ZONES.map(z => [z.id, z.id === zone ? 100 : 0]));
const setup = (implant, zone = 'fr', store = 0) => {
  const s = M.defaultState();
  s.implantation.current = implant;
  for (const a of s.apps) { a.zones = only(zone); a.channels = { store, storeRate: 15 }; }
  const sims = s.apps.map(a => E.simulate(a));
  return { s, sims, pnl: P.buildPnl(s, sims) };
};
const totalAt = ({ sims, pnl }, k = 0) => sims[0].months.map((m, j) => ({ m, t: P.sumPnl([pnl[k][j]]).total }));

test('SAS : ventes en France sur le site, TVA de 20 % collectée', () => {
  for (const { m, t } of totalAt(setup('fr-sas'))) {
    assert.ok(near(t.ca, m.total / 1.2), m.month);
    assert.ok(near(t.vat, m.total - m.total / 1.2), m.month);
  }
});

test('micro-entreprise : pas de TVA tant que le seuil de franchise n\'est pas dépassé', () => {
  const r = setup('fr-micro'), rows = totalAt(r);
  const fr = P.franchiseMonths(r.s, r.sims);
  const exempt = rows.filter(({ m }) => fr.get(m.month)?.fr), taxed = rows.filter(({ m }) => !fr.get(m.month)?.fr);
  assert.ok(exempt.length && taxed.length, 'le plan doit passer le seuil');
  for (const { m, t } of exempt) { assert.ok(near(t.ca, m.total), m.month); assert.strictEqual(t.vat, 0); }
  for (const { m, t } of taxed) assert.ok(near(t.ca, m.total / 1.2), m.month);
});

test('LLC : TVA due dès le premier euro sur les ventes françaises, sans TVA récupérable', () => {
  const r = setup('llc-fr');
  for (const { m, t } of totalAt(r)) { assert.ok(near(t.ca, m.total / 1.2), m.month); assert.strictEqual(t.vatIn, 0); }
});

test('stores : ils reversent la taxe, leur commission porte sur le prix hors taxe', () => {
  for (const { m, t } of totalAt(setup('fr-sas', 'eu', 100))) {
    assert.strictEqual(t.vat, 0);
    assert.ok(near(t.ca, m.total / 1.21), m.month);
  }
  const l = setup('fr-sas', 'eu', 100).pnl[0];
  const s = P.sumPnl(l);
  assert.ok(near(s.lines[':store'], s.total.ca * 0.15));
});

test('clientes aux États-Unis : pas de TVA sur les ventes du site', () => {
  for (const { m, t } of totalAt(setup('fr-sas', 'us'))) { assert.ok(near(t.ca, m.total), m.month); assert.strictEqual(t.vat, 0); }
});

test('SAS : TVA récupérée sur les charges qui en portent', () => {
  const s = M.defaultState();
  s.implantation.current = 'fr-sas'; s.vat.recover = 100;
  s.apps[0].charges = [M.charge('Logiciel', 'fixe', 120), M.charge('Pub', 'fixe', 120)];
  s.apps[0].charges[0].category = 'logiciels'; s.apps[0].charges[1].category = 'marketing';
  s.shared = { key: 'ca', charges: [] };
  const sims = s.apps.map(a => E.simulate(a)), pnl = P.buildPnl(s, sims);
  const e = pnl[0].find(x => x.month === '2028-03'), t = P.sumPnl([e]);
  assert.ok(near(t.commonFixed, 100 + 120));
  assert.ok(near(t.total.vatIn, 20));
  // En LLC, rien n'est récupéré.
  s.implantation.current = 'llc-fr';
  const t2 = P.sumPnl([P.buildPnl(s, sims)[0].find(x => x.month === '2028-03')]);
  assert.ok(near(t2.commonFixed, 240));
});

test('ancien fichier : les zones et réglages de TVA sont ajoutés', () => {
  const old = M.defaultState(); old.vat = { ttc: true, rate: 20 }; delete old.apps[0].zones;
  const s = M.migrate(old);
  assert.strictEqual(s.vat.ttc, true);
  assert.strictEqual(s.vat.zones.length, 6);
  assert.ok(s.apps[0].zones && s.apps[0].zones.us > 0);
});
