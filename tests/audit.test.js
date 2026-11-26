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
  const s = fresh(); s.vat.ttc = false;
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

test('coaching : coût = heures qui manquent × coût horaire', () => {
  const s = fresh(), a = s.apps[0];
  const sims = s.apps.map(x => E.simulate(x));
  const list = P.buildPnl(s, sims)[0];
  const extra = sims[0].months.reduce((t, m) => t + m.extraHours, 0);
  const cost = P.sumPnl(list).total.coaching;
  assert.ok(near(cost, extra * a.coachRate), `${cost} vs ${extra * a.coachRate}`);
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
  assert.strictEqual(hired, 0);
  // Toujours payées : le résultat du calcul, pas un réglage.
  for (const pm of [true, false]) {
    a.payMissing = pm;
    const paid = P.sumPnl(P.buildPnl(s, sims)[0]).total.coaching;
    assert.ok(Math.abs(paid - extra * a.coachRate) < 1e-6 * paid);
  }
});

test('canaux : la part vendue par les stores paie leur commission, pas les frais du site', () => {
  const s = M.defaultState(), a = s.apps[0];
  const sims = s.apps.map(x => E.simulate(x));
  const at = st => { a.channels = { store: st, storeRate: 15 }; const l = P.buildPnl(s, sims)[0]; return P.sumPnl(l).total; };
  const web = at(0), half = at(50), all = at(100);
  assert.ok(half.fees > web.fees && all.fees > half.fees);
  // 100 % stores : frais = 15 % du CA (les frais Stripe disparaissent)
  assert.ok(Math.abs(all.fees - all.ca * 0.15) < 1e-6 * all.ca, `${all.fees} vs ${all.ca * 0.15}`);
  assert.ok(Math.abs(all.result - (all.ca - all.charges)) < 1e-6 * all.ca);
});

test('acquisition : coût par nouvelle cliente, hors clientes venues de l\'abonnement', () => {
  const s = M.defaultState(), a = s.apps[0];
  a.sub.acq = 10; a.programs.forEach(q => { q.acq = 20; });
  const sims = s.apps.map(x => E.simulate(x));
  const ms = sims[0].months;
  const expected = ms.reduce((t, m) => t + m.newDirect.reduce((x, y) => x + y, 0) * 10 + m.products.reduce((x, q) => x + (q.admissions - q.fromSolo) * 20, 0), 0);
  const before = (() => { a.sub.acq = 0; a.programs.forEach(q => { q.acq = 0; }); return P.sumPnl(P.buildPnl(s, sims)[0]).total.variable; })();
  a.sub.acq = 10; a.programs.forEach(q => { q.acq = 20; });
  const after = P.sumPnl(P.buildPnl(s, sims)[0]).total.variable;
  assert.ok(Math.abs(after - before - expected) < 1e-6 * Math.max(1, expected));
});

test('trésorerie : solde = apport + encaissements − charges − impôts − rémunération', () => {
  const s = M.defaultState();
  s.cash = { start: 5000, payGoal: 1500, payFrom: '2029-01' };
  const all = s.apps.map(a => ({ a, ...E.simulate(a) }));
  const pnl = P.buildPnl(s, all);
  all.forEach((x, i) => { x.pnl = pnl[i]; });
  const t = P.treasury(s, all);
  const flows = t.months.reduce((b, m) => b + m.inflow - m.charges - m.taxes - m.pay, 5000);
  assert.ok(Math.abs(flows - t.months.at(-1).balance) < 1e-6 * Math.max(1, Math.abs(flows)));
  assert.equal(t.months.find(m => m.month === '2028-12').pay, 0);
  assert.equal(t.months.find(m => m.month === '2029-01').pay, 1500);
  assert.ok(t.low.balance <= Math.min(...t.months.map(m => m.balance)) + 1e-9);
  // Sans paiement en plusieurs fois, les encaissements valent le chiffre d'affaires.
  assert.ok(t.months.every(m => Math.abs(m.inflow - m.ca) < 1e-6));
});

test('trésorerie : le paiement en 3 fois retarde l\'argent sans changer le chiffre d\'affaires', () => {
  const s = M.defaultState();
  const run = n => { s.apps[0].programs.forEach(q => { q.installments = n; }); const all = s.apps.map(a => ({ a, ...E.simulate(a) })); const pnl = P.buildPnl(s, all); all.forEach((x, i) => { x.pnl = pnl[i]; }); return P.treasury(s, all); };
  const one = run(1), three = run(3);
  const ca = t => t.months.reduce((x, m) => x + m.ca, 0);
  assert.ok(Math.abs(ca(one) - ca(three)) < 1e-6 * ca(one));
  const k = one.months.findIndex(m => m.month === '2027-08');
  assert.ok(three.months[k].balance < one.months[k].balance);
});

test('scénarios : le central ne change rien, le prudent baisse, l\'ambitieux monte', () => {
  const s = M.defaultState();
  const res = sc => { const st = M.withScenario(s, sc); const all = st.apps.map(a => ({ a, ...E.simulate(a) })); return P.sumPnl(P.buildPnl(st, all).flat().filter(e => e.month.startsWith('2029'))).total; };
  const [pru, cen, amb] = s.scenarios.list.map(res);
  const plan = (() => { const all = s.apps.map(a => ({ a, ...E.simulate(a) })); return P.sumPnl(P.buildPnl(s, all).flat().filter(e => e.month.startsWith('2029'))).total; })();
  assert.ok(Math.abs(cen.result - plan.result) < 1e-6 * Math.max(1, Math.abs(plan.result)));
  assert.ok(pru.ca < cen.ca && amb.ca > cen.ca);
  assert.ok(pru.result < cen.result);
  // Prix +10 % : le chiffre d'affaires des programmes et abonnements monte d'environ 10 %.
  const up = res({ id: 'x', volume: 0, price: 10, duration: 0, costs: 0 });
  assert.ok(Math.abs(up.ca / cen.ca - 1.1) < 0.02, String(up.ca / cen.ca));
  // Le scénario ne modifie pas l'état d'origine.
  assert.equal(s.apps[0].volume, undefined);
});

test('trésorerie d\'une application seule : sans apport ni rémunération, quote-part de structure comprise', () => {
  const s = fresh(); s.cash.start = 50000; s.cash.payFrom = '2027-01'; s.cash.payGoal = 3000;
  const all = s.apps.map(a => ({ a, ...E.simulate(a) })); const pnl = P.buildPnl(s, all); all.forEach((x, i) => { x.pnl = pnl[i]; });
  const solo = P.treasury(s, [all[0]], true);
  assert.strictEqual(solo.start, 0);
  assert.ok(solo.months.every(m => m.pay === 0));
  // Chaque mois, les charges sont celles du compte d'exploitation de l'application, structure comprise.
  for (const m of solo.months) {
    const k = all[0].months.findIndex(x => x.month === m.month);
    assert.ok(near(m.charges, P.sumPnl([all[0].pnl[k]]).total.charges));
  }
  // Le solde suit encaissements − charges − impôts.
  let bal = 0; for (const m of solo.months) { bal += m.inflow - m.charges - m.taxes; assert.ok(near(m.balance, bal, 1e-9)); }
});
