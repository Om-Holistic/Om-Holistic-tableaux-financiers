'use strict';
const test = require('node:test');
const assert = require('node:assert');
const m = require('../js/model.js');
const e = require('../js/engine.js');

const base = () => ({ sub: { start: '2027-01' }, programs: [], audience: m.defaultAudience('2026-11') });

test('vivier : les relais font grandir Instagram, une part passe à la newsletter', () => {
  const a = base();
  a.audience.insta = { ...a.audience.insta, points: [{ month: '2026-11', n: 0 }] };
  a.audience.relays = [m.relay('Sœur', 30000, 0.2, '2026-12')];
  a.audience.stores.on = false;
  const s = e.audienceSeries(a);
  assert.equal(s.get('2026-11').pool, 1040);
  const r = s.get('2027-02');
  assert.equal(Math.round(r.insta), 1000 + 3 * 60);
  assert.equal(Math.round(r.news), 40 + 3 * 6);
});

test('vivier : les stores ne comptent qu\'à partir de leur date', () => {
  const a = base(); a.audience.stores = { on: true, points: [{ month: '2028-01', n: 20 }, { month: '2030-01', n: 300 }] };
  const s = e.audienceSeries(a);
  assert.equal(s.get('2027-12').stores, 0);
  assert.ok(s.get('2028-01').stores >= 20);
});

test('sans pub : nouvelles venues et vivier déjà là, une acheteuse sort du vivier', () => {
  const a = base(); a.audience.relays = []; a.audience.stores.on = false;
  a.audience.insta = { ...a.audience.insta, points: [{ month: '2026-11', n: 0 }] };
  const p = { start: '2027-01', audienceRate: 10, audienceNew: 0 };
  // Vivier figé à 1 040 : 10 % le premier mois, puis 10 % de ce qui reste.
  assert.ok(Math.abs(e.audienceBuyers(a, p, '2027-01') - 104) < 0.01);
  assert.ok(Math.abs(e.audienceBuyers(a, p, '2027-02') - 93.6) < 0.01);
});

test('sans pub : les nouvelles venues achètent à leur propre taux', () => {
  const a = base(); a.audience.stores.on = false; a.audience.relays = [m.relay('R', 10000, 1, '2026-12')];
  a.audience.insta = { ...a.audience.insta, points: [{ month: '2026-11', n: 0 }] }; a.audience.newsletter.fromInsta = 0;
  const p = { start: '2027-01', audienceRate: 0, audienceNew: 5 };
  // 100 nouvelles abonnées par mois, 5 % achètent.
  assert.ok(Math.abs(e.audienceBuyers(a, p, '2027-03') - 5) < 0.01);
});

test('pré-remplissage et simulation : un produit lancé plus tard profite du vivier déjà construit', () => {
  const a = m.prefillAudience(m.defaultState().apps[0]);
  const by = n => a.programs.find(p => new RegExp(n, 'i').test(p.name));
  assert.equal(by('refit').audienceNew, 1); assert.equal(by('refit').audienceRate, 0.15); assert.equal(by('refit').launchRate, 10);
  assert.ok([a.sub, ...a.programs].every(q => q.viral === 15 && q.shape === 'brand'));
  assert.ok(e.audienceAt(a, by('calm').start) > e.audienceAt(a, by('refit').start));
  const sim = e.simulate(a);
  assert.ok(sim.months.find(x => x.month === m.addMonths(by('calm').start, 3)).products[a.programs.indexOf(by('calm'))].admissions > 0);
});

test('migration : l\'ancienne page Notoriété garde Instagram, newsletter et relevés', () => {
  const s = m.defaultState();
  s.apps[0].audience = { channels: [{ name: 'Mon Instagram', count: 1200, actuals: { '2026-11': 1150 } }, { name: 'Relais de ma sœur', count: 30000 }, { name: 'Newsletter', count: 55 }] };
  delete s.apps[0].sub.audienceNew;
  m.migrate(s);
  const au = s.apps[0].audience;
  assert.equal(au.insta.count, 1200); assert.equal(au.insta.actuals['2026-11'], 1150);
  assert.equal(au.newsletter.count, 55); assert.equal(au.relays.length, 1);
  assert.equal(s.apps[0].sub.audienceNew, 0);
});

test('paliers : en S d\'un palier à l\'autre, jusqu\'en 2032', () => {
  const ps = [{ month: '2027-01', n: 100 }, { month: '2029-01', n: 300 }, { month: '2032-12', n: 600 }];
  assert.equal(e.pointsAt(ps, '2026-06', 0), 0);
  assert.equal(e.pointsAt(ps, '2027-01'), 100);
  assert.equal(e.pointsAt(ps, '2028-01'), 200);
  assert.equal(e.pointsAt(ps, '2033-06'), 600);
  const a = { sub: { start: '2027-01' }, programs: [], audience: m.defaultAudience('2026-11') };
  assert.ok(e.audienceSeries(a).get('2032-12').pool > e.audienceSeries(a).get('2029-11').pool * 1.5);
});

test('migration : ancienne croissance départ → maturité convertie en paliers', () => {
  const s = m.defaultState();
  s.apps[0].audience.insta = { count: 1000, initial: 50, target: 200, months: 24, actuals: {} };
  s.apps[0].audience.stores = { on: true, start: '2028-01', initial: 10, target: 150, months: 24 };
  m.migrate(s);
  const au = s.apps[0].audience;
  assert.deepEqual(au.insta.points, [{ month: '2026-11', n: 50 }, { month: '2028-11', n: 200 }]);
  assert.equal(au.stores.points.at(-1).month, '2032-12');
});
