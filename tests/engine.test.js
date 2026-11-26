// Lancer avec : node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const model = require('../js/model.js');
Object.assign(global, model);
const { simulate, weekShares } = require('../js/engine.js');

test('le prix suit la phase en vigueur', () => {
  const grid = [{ label: 'Phase 1', start: '2026-11', price: 60 }, { label: 'Phase 2', start: '2027-01', price: 150 }, { label: 'Phase 3', start: '2027-04', price: 250 }];
  assert.strictEqual(model.phaseAt(grid, '2026-10').price, 60);
  assert.strictEqual(model.phaseAt(grid, '2026-12').price, 60);
  assert.strictEqual(model.phaseAt(grid, '2027-02').price, 150);
  assert.strictEqual(model.phaseAt(grid, '2028-01').price, 250);
  grid[1].start = '';
  assert.strictEqual(model.phaseAt(grid, '2027-02').price, 60, 'une phase sans date est ignorée');
});

test('une semaine à cheval sur deux mois est répartie au prorata des jours', () => {
  const shares = weekShares(new Date('2027-03-29T00:00:00Z'));
  assert.deepStrictEqual(shares.map(s => s[0]), ['2027-03', '2027-04']);
  assert.ok(Math.abs(shares[0][1] - 3 / 7) < 1e-9);
});

test('CA des programmes = inscriptions × prix de phase', () => {
  const state = model.defaultState();
  const a = state.apps[0];
  a.programs = [a.programs[0]];
  a.programs[0].launch = false;
  a.programs[0].initial = a.programs[0].target = 2;
  a.programs[0].pricing = [{ label: 'P1', start: '2026-11', price: 100 }, { label: 'P2', start: '', price: 0 }, { label: 'P3', start: '', price: 0 }];
  a.sub.initial = a.sub.target = 0;
  const { months } = simulate(a);
  const sales = months.reduce((s, m) => s + m.sales, 0), adm = months.reduce((s, m) => s + m.admissions, 0);
  assert.ok(Math.abs(sales - adm * 100) < 1e-6);
  // Rythme régulier : pas de dents de scie entre mois de 4 et 5 lundis.
  const y = months.filter(m => m.month.startsWith('2028'));
  for (const m of y) {
    const days = new Date(Date.UTC(2028, +m.month.slice(5), 0)).getUTCDate();
    assert.ok(Math.abs(m.admissions - 2 * days / 7) < 1e-6, m.month);
  }
});

test('les abonnées gardent leur prix d\'entrée si demandé', () => {
  const a = model.defaultState().apps[0];
  a.programs = [];
  a.sub.duration = 0; a.sub.initial = a.sub.target = 1; a.sub.start = '2027-01';
  a.sub.directPricing = [{ label: 'P1', start: '2027-01', price: 5 }, { label: 'P2', start: '2027-07', price: 10 }, { label: 'P3', start: '', price: 0 }];
  const lock = simulate(a).months.find(m => m.month === '2027-12');
  a.sub.lockPrice = false;
  const free = simulate(a).months.find(m => m.month === '2027-12');
  assert.ok(Math.abs(free.directCA - free.direct * 10) < 1e-6);
  assert.ok(lock.directCA < free.directCA);
});

test('une sauvegarde v1 est convertie en grilles de prix', () => {
  const old = { apps: [{ name: 'Chrysalis', start: '2026-11', capacity: 40, hours: 35, cost: 0, capacityChanges: [],
    sub: { price: 9.99, conversion: 40, postDuration: 12, directPrice: 12, start: '2027-01', initial: 1, target: 3, months: 24, step: 1, duration: 12 },
    programs: [{ name: 'Refit', start: '2026-11', enabled: true, duration: 12, price: 250, coach: 20, beta: true, betaStart: '2026-11', betaCount: 1, betaSize: 10, betaInterval: 1, betaPrice: 60,
      launch: true, launchWeeks: 12, launchRate: 2, launchPrice: 150, initial: 2, target: 5, months: 24, step: 1, palierMode: false, paliers: [], promos: [] }] }] };
  const s = model.migrate(old);
  const p = s.apps[0].programs[0];
  assert.deepStrictEqual(p.pricing.map(x => x.price), [60, 150, 250]);
  assert.strictEqual(s.apps[0].sub.directPricing[0].price, 12);
  assert.strictEqual(p.price, undefined);
  assert.doesNotThrow(() => simulate(s.apps[0]));
  assert.ok(Array.isArray(s.apps[0].charges) && s.apps[0].cost === undefined);
  assert.deepStrictEqual(s.apps.map(a => a.name), ['Chrysalis', 'Bujo', 'Doodle Studio']);
});

const { buildPnl, sumPnl } = require('../js/pnl.js');

test('compte d\'exploitation : charges rattachées aux produits et structure répartie', () => {
  const state = model.defaultState();
  state.vat = { ttc: false, rate: 20 };
  const chrysalis = state.apps[0], refit = chrysalis.programs[0];
  chrysalis.coachRate = 30;
  chrysalis.charges = [
    model.charge('Stripe', 'ca', 2),
    model.charge('YMove', 'fixe', 29, refit.id),
    model.charge('Hébergement', 'fixe', 30),
    model.charge('Kit', 'inscription', 5, refit.id)
  ];
  state.shared = { key: 'egal', charges: [model.charge('Comptable', 'fixe', 90)] };
  const sims = state.apps.map(a => simulate(a));
  const pnl = buildPnl(state, sims);
  const k = sims[0].months.findIndex(m => m.month === '2027-10');
  const m = sims[0].months[k], s = sumPnl([pnl[0][k]]);
  const r = s.cols[refit.id];
  assert.ok(Math.abs(r.ca - m.products[0].sales) < 1e-6);
  assert.ok(Math.abs(r.fees - m.products[0].sales * 0.02) < 1e-6);
  assert.strictEqual(r.fixed, 29);
  assert.ok(Math.abs(r.variable - m.products[0].admissions * 5) < 1e-6);
  assert.ok(Math.abs(r.coaching - m.products[0].coachHours * 30) < 1e-6);
  assert.strictEqual(s.commonFixed, 30);
  // 3 applications présentes en octobre 2027 : 90 € répartis à parts égales.
  assert.ok(Math.abs(s.structure - 30) < 1e-6);
  const t = s.total;
  assert.ok(Math.abs(t.result - (t.ca - t.fees - t.variable - t.coaching - t.fixed - s.structure)) < 1e-6);
});

test('prix TTC convertis en HT dans le compte d\'exploitation', () => {
  const state = model.defaultState();
  state.vat = { ttc: true, rate: 20 };
  const sims = state.apps.map(a => simulate(a));
  const pnl = buildPnl(state, sims);
  const k = sims[0].months.findIndex(m => m.month === '2027-10');
  assert.ok(Math.abs(sumPnl([pnl[0][k]]).total.ca - sims[0].months[k].total / 1.2) < 1e-6);
});
