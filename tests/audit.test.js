'use strict';
// Audit des calculs : propriétés qui doivent toujours être vraies, quels que soient les réglages.
const test = require('node:test');
const assert = require('node:assert');
const M = require('../js/model.js');
const E = require('../js/engine.js');
const P = require('../js/pnl.js');

const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
const fresh = () => M.defaultState();
const year = (months, y, f) => months.filter(m => m.month.startsWith(y)).reduce((t, m) => t + f(m), 0);

test('le chiffre d\'affaires est la somme des produits', () => {
  for (const a of fresh().apps) for (const m of E.simulate(a).months) {
    assert.ok(near(m.sales, m.products.reduce((t, p) => t + p.sales, 0)), m.month + ' ventes');
    assert.ok(near(m.postCA, m.products.reduce((t, p) => t + p.post, 0)), m.month + ' après programme');
    assert.ok(near(m.total, m.sales + m.directCA + m.postCA), m.month + ' total');
    assert.ok(near(m.admissions, m.products.reduce((t, p) => t + p.admissions, 0)), m.month + ' inscriptions');
  }
});

test('ventes d\'un programme = inscriptions × prix en vigueur (prix fixe)', () => {
  const s = fresh(), a = s.apps[0], q = a.programs[0];
  q.pricing = [{ label: 'Phase 1', start: '2027-01', price: 100 }];
  a.restrict = false;
  for (const m of E.simulate(a).months) assert.ok(near(m.products[0].sales, m.products[0].admissions * 100), m.month);
});

test('plus d\'inscriptions prévues = plus de chiffre d\'affaires et de résultat (sans restriction)', () => {
  const s = fresh(), a = s.apps[0];
  const before = E.simulate(a).months;
  a.programs[0].palierMode = true; a.programs[0].launch = false; a.programs[0].paliers = [{ rate: 100, weeks: 300 }]; a.programs[0].target = 100;
  const after = E.simulate(a).months;
  assert.ok(year(after, '2030', m => m.total) > year(before, '2030', m => m.total) * 2);
});

test('restriction : les heures de coaching ne dépassent jamais la limite', () => {
  const s = fresh(), a = s.apps[0];
  a.restrict = true; a.waitlist = true;
  a.programs[0].palierMode = true; a.programs[0].paliers = [{ rate: 50, weeks: 300 }];
  for (const w of E.simulate(a).weekly) assert.ok(w.hours <= w.limit + 1e-6, w.date);
});

test('abonnements : sans résiliation ni essai, le stock est la somme des nouvelles abonnées', () => {
  const s = fresh(), a = s.apps[1];
  a.sub.duration = 0; a.sub.trialDays = 0;
  let sum = 0;
  for (const m of E.simulate(a).months) { sum += m.newDirect.reduce((t, x) => t + x, 0); assert.ok(near(m.direct, sum), m.month); }
});

test('abonnements : le CA du mois = abonnées × prix mensuel (prix unique)', () => {
  const s = fresh(), a = s.apps[1];
  a.sub.directPricing = M.pricing('2027-01', [9.9, 9.9, 9.9]);
  for (const m of E.simulate(a).months) assert.ok(near(m.directCA, m.direct * 9.9), m.month);
});

test('compte d\'exploitation : résultat = CA − toutes les charges, par mois et par application', () => {
  const s = fresh();
  const sims = s.apps.map(a => E.simulate(a));
  const pnl = P.buildPnl(s, sims);
  pnl.forEach((list, i) => list.forEach(e => {
    const t = P.sumPnl([e]).total;
    assert.ok(near(t.result, t.ca - t.charges), e.month);
    const cats = P.sumPnl([e]).cats;
    assert.ok(near(Object.values(cats).reduce((x, v) => x + v, 0), t.charges), e.month + ' catégories = charges');
    const m = sims[i].months.find(x => x.month === e.month);
    assert.ok(near(t.ca, m.total), e.month + ' CA du compte = CA simulé (prix HT)');
  }));
});

test('charges de structure : réparties entièrement entre les applications', () => {
  const s = fresh();
  const sims = s.apps.map(a => E.simulate(a));
  const pnl = P.buildPnl(s, sims);
  const dates = M.appDates(s.apps);
  const months = [...new Set(pnl.flat().map(e => e.month))];
  for (const month of months) {
    const expected = s.shared.charges.reduce((t, c) => t + (M.chargeAt(c, month, dates) || 0), 0);
    const got = pnl.reduce((t, list) => t + (list.find(e => e.month === month)?.structure || 0), 0);
    assert.ok(near(got, expected), month);
  }
});

test('TVA : saisie TTC, le compte d\'exploitation est HT', () => {
  const s = fresh(); s.vat = { ttc: true, rate: 20 };
  const sims = s.apps.map(a => E.simulate(a));
  const e = P.buildPnl(s, sims)[0].find(x => x.month === '2029-06');
  const m = sims[0].months.find(x => x.month === '2029-06');
  assert.ok(near(P.sumPnl([e]).total.ca, m.total / 1.2));
});

test('coaching : coût = heures embauchées × coût horaire (heures manquantes non payées)', () => {
  const s = fresh(), a = s.apps[0];
  a.payMissing = false;
  const sims = s.apps.map(x => E.simulate(x));
  const list = P.buildPnl(s, sims)[0];
  const hired = sims[0].months.reduce((t, m) => t + m.hiredHours, 0);
  const cost = P.sumPnl(list).total.coaching;
  assert.ok(near(cost, hired * a.coachRate), `${cost} vs ${hired * a.coachRate}`);
});

test('implantation : le net ne dépasse jamais le résultat (taux positifs)', () => {
  for (const sc of M.defaultImplantation().scenarios) for (const [ca, res] of [[100000, 60000], [400000, 300000], [50000, -10000]]) {
    const r = P.afterTax(sc, ca, res, 12);
    assert.ok(r.net <= res + 1e-6, sc.name);
    assert.ok(near(r.net, res - r.fixed - r.social - r.tax - r.dist), sc.name + ' décomposition');
  }
});

test('passerelle : les abonnées seules qui achètent un programme n\'augmentent pas l\'abonnement', () => {
  const s = fresh(), a = s.apps[0];
  a.programs.forEach(p => { p.fromSolo = 0; });
  const base = E.simulate(a).months;
  a.programs[1].fromSolo = 50;
  const withLink = E.simulate(a).months;
  assert.ok(year(withLink, '2029', m => m.products[1].admissions) > year(base, '2029', m => m.products[1].admissions));
  assert.ok(year(withLink, '2029', m => m.direct) <= year(base, '2029', m => m.direct) + 1e-6);
});

test('heures manquantes : payées au coût des coachs quand les inscriptions ne sont pas refusées', () => {
  const s = M.defaultState(), a = s.apps[0];
  a.restrict = false;
  a.programs[0].palierMode = true; a.programs[0].launch = false; a.programs[0].paliers = [{ rate: 40, weeks: 300 }];
  const sims = s.apps.map(x => E.simulate(x));
  const extra = sims[0].months.reduce((t, m) => t + m.extraHours, 0), hired = sims[0].months.reduce((t, m) => t + m.hiredHours, 0);
  assert.ok(extra > 0, 'des heures manquent');
  a.payMissing = true;
  const paid = P.sumPnl(P.buildPnl(s, sims)[0]).total.coaching;
  assert.ok(Math.abs(paid - (hired + extra) * a.coachRate) < 1e-6 * paid);
  a.payMissing = false;
  const unpaid = P.sumPnl(P.buildPnl(s, sims)[0]).total.coaching;
  assert.ok(Math.abs(unpaid - hired * a.coachRate) < 1e-6 * Math.max(1, unpaid));
});
