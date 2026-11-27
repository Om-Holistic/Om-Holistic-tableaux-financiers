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

test('campagnes pub : inscriptions = budget ÷ coût par cliente, et le budget va dans les charges', () => {
  const s = M.defaultState(), a = s.apps[0], q = a.programs[0];
  a.programs.forEach((p, i) => { if (i) p.enabled = false; p.fromSolo = 0; });
  q.cohorts = []; q.organic = false; q.viral = 0;
  q.campaigns = [{ start: q.start, end: '2028-12', budget: 1000, cac: 50 }, { start: '2029-01', end: '', budget: 3000, cac: 60 }];
  const sim = E.simulate(a);
  const year = y => sim.months.filter(m => m.month.startsWith(y)).reduce((t, m) => t + m.products[0].admissions, 0);
  assert.ok(Math.abs(year('2028') - 1000 / 50 * 12) < 2, String(year('2028')));
  assert.ok(Math.abs(year('2029') - 3000 / 60 * 12) < 3, String(year('2029')));
  const pnl = P.buildPnl(s, s.apps.map(x => E.simulate(x)));
  const acq = y => pnl[0].filter(e => e.month.startsWith(y)).reduce((t, e) => t + (e.lines[':acq'] || 0), 0);
  assert.ok(Math.abs(acq('2028') - 1000 * 12) < 1e-6, String(acq('2028')));
  assert.ok(Math.abs(acq('2029') - 3000 * 12) < 1e-6, String(acq('2029')));
});

test('campagnes pub : elles s\'ajoutent au rythme sans pub et s\'arrêtent à leur fin', () => {
  const s = M.defaultState(), a = s.apps[0];
  a.programs.forEach(p => { p.enabled = false; });
  const base = E.simulate(a);
  a.sub.viral = 0; a.sub.campaigns = [{ start: '2029-01', end: '2029-06', budget: 2000, cac: 20 }];
  const sim = E.simulate(a);
  const paid = (r, y) => r.months.filter(m => m.month.startsWith(y)).reduce((t, m) => t + m.newDirect.reduce((u, v) => u + v, 0), 0);
  assert.ok(Math.abs(paid(sim, '2029') - paid(base, '2029') - 2000 / 20 * 6) < 4, String(paid(sim, '2029') - paid(base, '2029')));
  assert.ok(Math.abs(paid(sim, '2030') - paid(base, '2030')) < 1e-6);
});

test('ancien budget pub par paliers : converti en campagnes datées', () => {
  const old = M.defaultState(), q = old.apps[0].programs[0];
  delete q.campaigns; delete q.organic; q.adMode = true; q.acq = 40; q.adSteps = [{ start: '2028-01', budget: 1000 }, { start: '2028-07', budget: 2000 }];
  const n = M.migrate(old).apps[0].programs[0];
  assert.strictEqual(n.organic, false);
  assert.deepStrictEqual(n.campaigns, [{ start: '2028-01', end: '2028-06', budget: 1000, cac: 40 }, { start: '2028-07', end: '', budget: 2000, cac: 40 }]);
});

test('croissance en S : départ au rythme initial, maturité au rythme visé, accélération au milieu', () => {
  const p = { initial: 2, target: 100, months: 36, shape: 's' }, d = Math.round(36 * 52 / 12);
  assert.ok(Math.abs(E.weeklyRate(p, 0) - 2) < 1e-9);
  assert.ok(Math.abs(E.weeklyRate(p, d) - 100) < 1e-9 && E.weeklyRate(p, d + 50) === 100);
  const q1 = E.weeklyRate(p, d / 4) - 2, mid = E.weeklyRate(p, d / 2);
  assert.ok(q1 < 10, String(q1)); assert.ok(Math.abs(mid - 51) < 1, String(mid));
});

test('ancien rythme : il garde sa forme en paliers réguliers', () => {
  const old = M.defaultState(); for (const q of [old.apps[0].sub, ...old.apps[0].programs]) delete q.shape;
  const s = M.migrate(old);
  assert.strictEqual(s.apps[0].sub.shape, 'lin'); assert.strictEqual(s.apps[0].programs[0].shape, 'lin');
});

test('boule de neige : 20 % de clientes en plus, sans coût', () => {
  const s = M.defaultState(), a = s.apps[0], q = a.programs[0];
  a.programs.forEach((p, i) => { if (i) p.enabled = false; p.fromSolo = 0; });
  q.cohorts = []; q.organic = false; q.viral = 20; q.campaigns = [{ start: '2028-01', end: '', budget: 1000, cac: 50 }];
  const n = E.simulate(a).months.filter(m => m.month.startsWith('2029')).reduce((t, m) => t + m.products[0].admissions, 0);
  assert.ok(Math.abs(n - 20 * 12 * 1.2) < 3, String(n));
});

test('objectif total : la pub comble l\'écart laissé par le sans pub, et l\'atteint', () => {
  const s = M.defaultState(), a = s.apps[0];
  a.programs.forEach(p => { p.enabled = false; });
  a.sub.goal = { kind: 'active', steps: [{ months: 12, count: 500 }, { months: 36, count: 3000 }], cac: 30 };
  const plan = E.pubGap(a, null);
  assert.strictEqual(plan.segs.length, 2);
  for (const sg of plan.segs) { assert.ok(sg.free < sg.count); assert.ok(Math.abs(sg.reached - sg.count) / sg.count < 0.02, `${sg.reached} / ${sg.count}`); }
  assert.strictEqual(plan.campaigns.at(-1).end, '');
  assert.ok(plan.campaigns.every(c => c.cac === 30 && c.budget > 0));
  // Programme : inscriptions par an, passerelles comprises.
  const q = a.programs[0]; q.enabled = true; q.goal = { steps: [{ months: 18, count: 800 }], cac: 60 };
  const p2 = E.pubGap(a, 0);
  assert.ok(Math.abs(p2.segs[0].reached - 800) / 800 < 0.05, String(p2.segs[0].reached));
});
