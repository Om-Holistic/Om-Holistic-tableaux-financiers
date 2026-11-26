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
  a.programs[0].cohorts = [];
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
  assert.deepStrictEqual(s.apps.map(a => a.name), ['CHRYSALISS', 'Bujo', 'Doodle Studio']);
  // Ancienne bêta (1 cohorte de 10) → cohorte nommée ; capacité unique → palier.
  assert.deepStrictEqual(p.cohorts, [{ name: 'Cohorte alpha', date: '2026-11', size: 10 }]);
  assert.deepStrictEqual(s.apps[0].capacitySteps, [{ date: '2026-11', capacity: 40, hours: 35 }]);
  assert.strictEqual(s.apps[0].start, undefined);
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

test('Bujo et Doodle Studio : abonnement à 9,90 €, anciens prix d\'exemple mis à jour', () => {
  const s = model.defaultState();
  for (const a of s.apps.slice(1)) assert.deepStrictEqual(a.sub.directPricing.map(x => x.price), [9.9, 9.9, 9.9]);
  const old = model.defaultState(); old.version = 3;
  old.apps[1].sub.directPricing.forEach((x, i) => { x.price = [2.99, 3.99, 4.99][i]; });
  assert.strictEqual(model.migrate(old).apps[1].sub.directPricing[2].price, 9.9);
});

test('cohortes de test puis lancement, capacité par paliers', () => {
  const a = model.defaultState().apps[0];
  const refit = a.programs[0];
  a.programs = [refit];
  refit.cohorts = [{ name: 'Alpha', date: '2027-01', size: 8 }, { name: 'Deuxième', date: '2027-04', size: 15 }];
  refit.start = '2027-07'; refit.launch = false; refit.initial = refit.target = 1;
  a.sub.start = '';
  a.capacitySteps = [{ date: '2027-01', capacity: 10, hours: 8 }, { date: '2027-07', capacity: 25, hours: 20 }];
  assert.strictEqual(model.appStart(a), '2027-01');
  const { months, weekly } = simulate(a);
  assert.strictEqual(months[0].month, '2027-01');
  const adm = k => months.find(m => m.month === k).admissions;
  assert.ok(Math.abs(adm('2027-01') + adm('2027-02') + adm('2027-03') - 8) < 1e-9);
  assert.ok(Math.abs(adm('2027-04') + adm('2027-05') + adm('2027-06') - 15) < 1e-9);
  assert.ok(adm('2027-08') > 0);
  assert.strictEqual(weekly.find(w => w.date.startsWith('2027-02')).cap, 10);
  assert.strictEqual(weekly.find(w => w.date.startsWith('2027-08')).limit, 20);
  // Avec refus au-delà de la capacité, la deuxième cohorte (15) est plafonnée à 10 places moins les alphas encore en cours.
  a.restrict = true; a.capacitySteps = [{ date: '2027-01', capacity: 10, hours: 8 }];
  const capped = simulate(a).months;
  const sumAdm = capped.filter(m => m.month < '2027-07').reduce((s, m) => s + m.admissions, 0);
  assert.ok(sumAdm < 23);
});

test('passerelles : programme → abonnement seul, abonnement seul → programme, période d\'essai', () => {
  const base = () => {
    const a = model.defaultState().apps[0];
    a.programs = [a.programs[0]];
    const p = a.programs[0];
    p.cohorts = []; p.start = '2027-01'; p.launch = false; p.initial = p.target = 2; p.toSolo = 50; p.fromSolo = 0;
    a.sub.start = '2027-01'; a.sub.initial = a.sub.target = 5; a.sub.duration = 0; a.sub.postDuration = 0; a.capacitySteps = [];
    return a;
  };
  const sum = (ms, f) => ms.reduce((s, m) => s + f(m), 0);
  // 50 % des fins de programme deviennent abonnées (sans résiliation).
  let a = base(), r = simulate(a).months;
  const fin = sum(r, m => m.products[0].finished);
  assert.ok(Math.abs(r.at(-1).post - fin * 0.5) < 1e-6);
  // 10 % des abonnées seules achètent le programme chaque mois : plus d'inscriptions, mêmes abonnées après programme qu'avant pour les nouvelles.
  a = base(); a.programs[0].fromSolo = 10;
  const r2 = simulate(a).months;
  assert.ok(sum(r2, m => m.products[0].admissions) > sum(r, m => m.products[0].admissions));
  assert.ok(sum(r2, m => m.products[0].fromSolo) > 0);
  assert.ok(Math.abs(r2.at(-1).post - r.at(-1).post) < 1e-6, 'les clientes venues de l\'abonnement ne sont pas recomptées');
  // Essai de 14 jours, 60 % payantes : 60 % des abonnements, décalés de deux semaines.
  a = base(); a.programs = []; a.sub.trialDays = 14; a.sub.trialConversion = 60;
  const r3 = simulate(a).months;
  a.sub.trialDays = 0;
  const r4 = simulate(a).months;
  const y = ms => ms.filter(m => m.month.startsWith('2028')).reduce((s, m) => s + m.newDirect.reduce((t, v) => t + v, 0), 0);
  assert.ok(Math.abs(y(r3) - 0.6 * y(r4)) < 0.01 * y(r4));
  assert.ok(r3.find(m => m.month === '2027-01').newDirect.reduce((t, v) => t + v, 0) < 0.6 * r4.find(m => m.month === '2027-01').newDirect.reduce((t, v) => t + v, 0));
});

test('objectif : le rythme appliqué donne le nombre d\'abonnées visé', () => {
  const s = defaultState();
  const a = s.apps[0];
  a.programs.forEach(p => { p.enabled = false; });
  Object.assign(a.sub, { start: '2027-01', duration: 12, initial: 1, months: 12, trialDays: 0 });
  // 1000 abonnées en même temps avec 12 mois de durée : 1000 / 12 par mois, soit 20 par semaine.
  const weekly = Math.ceil(1000 / 12 * 12 / 52);
  a.sub.target = weekly;
  const m = simulate(a).months.find(x => x.month === '2031-01');
  assert.ok(m.direct > 950 && m.direct < 1250, String(m.direct));
});

test('objectif par paliers : chaque palier est atteint à sa date', () => {
  const { goalPlan } = require('../js/engine.js');
  const s = defaultState();
  const a = s.apps[0];
  Object.assign(a.sub, { start: '2027-01', duration: 12, trialDays: 14, trialConversion: 50 });
  const plan = goalPlan(a);
  assert.equal(plan.steps.length, 3);
  a.programs = [];
  Object.assign(a.sub, { palierMode: true, paliers: plan.segs, target: plan.segs[2].rate });
  const sim = simulate(a).months;
  for (const st of plan.steps) {
    const m = sim.find(x => x.month === st.at);
    assert.ok(m.direct >= st.count, `${st.at} ${m.direct} < ${st.count}`);
  }
  // Rythme minimal : un essai de moins par semaine au dernier palier ne suffit plus.
  a.sub.paliers = plan.segs.map((x, k) => k === 2 ? { ...x, rate: x.rate - 1 } : x);
  assert.ok(simulate(a).months.find(x => x.month === plan.steps[2].at).direct < 1000);
});

test('objectif d\'un programme : le rythme appliqué donne les inscriptions visées', () => {
  const { programGoalPlan } = require('../js/engine.js');
  const s = defaultState();
  const a = s.apps[0];
  a.capacitySteps = [];
  const q = a.programs[0];
  q.fromSolo = 0;
  q.goal = { steps: [{ months: 12, count: 100 }] };
  const plan = programGoalPlan(a, 0, simulate(a).months);
  assert.equal(plan.steps[0].rate, 2);
  assert.ok(Math.abs(plan.steps[0].parallel - 2 * q.duration) < 1e-9);
  Object.assign(q, { launch: false, palierMode: true, paliers: plan.segs, target: plan.segs[0].rate });
  const m = simulate(a).months.find(x => x.month === plan.steps[0].at);
  assert.ok(m.products[0].admissions * 12 >= 100, String(m.products[0].admissions * 12));
});
