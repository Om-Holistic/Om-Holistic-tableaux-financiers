'use strict';
const test = require('node:test');
const assert = require('node:assert');
const m = require('../js/model.js');
const e = require('../js/engine.js');

test('notoriété : chaque canal grandit en S de son départ à son objectif', () => {
  const c = m.audienceChannel('Instagram', 1000, 20000, '2026-11', '2029-11', 30);
  assert.equal(e.channelAt(c, '2026-01'), 1000);
  assert.equal(e.channelAt(c, '2026-11'), 1000);
  assert.equal(e.channelAt(c, '2031-01'), 20000);
  const mid = e.channelAt(c, '2028-05');
  assert.ok(mid > 9000 && mid < 12000, String(mid));
});

test('notoriété : personnes touchées = audience × part touchée, tous canaux', () => {
  const a = { audience: { channels: [m.audienceChannel('A', 1000, 1000, '2026-11', '2029-11', 30), m.audienceChannel('B', 30000, 30000, '2026-11', '2029-11', 5)] } };
  assert.equal(e.audienceAt(a, '2027-06'), 300 + 1500);
});

test('sans pub = part de l\'audience, et un produit lancé plus tard profite de l\'audience déjà construite', () => {
  const a = m.prefillAudience(m.defaultState().apps[0]);
  a.programs.forEach(p => { p.launch = false; p.campaigns = []; p.cohorts = []; p.fromSolo = 0; });
  a.capacitySteps = [];
  const sim = e.simulate(a), at = k => sim.months.find(x => x.month === k);
  const j = a.programs.findIndex(p => /calm/i.test(p.name)), month = m.addMonths(a.programs[j].start, 2);
  const expected = e.audienceAt(a, month) * a.programs[j].audienceRate / 100;
  const got = at(month).products[j].admissions;
  assert.ok(Math.abs(got - expected) / expected < 0.15, `${got} vs ${expected}`);
  assert.ok(e.audienceAt(a, a.programs[j].start) > e.audienceAt(a, a.programs.find(p => /refit/i.test(p.name)).start));
});

test('pré-remplissage : taux par produit, coup de pouce de lancement, boule de neige 15 %', () => {
  const a = m.prefillAudience(m.defaultState().apps[0]);
  const by = n => a.programs.find(p => new RegExp(n, 'i').test(p.name));
  assert.equal(a.sub.shape, 'brand'); assert.equal(a.sub.audienceRate, 0.4);
  assert.equal(by('refit').audienceRate, 0.25); assert.equal(by('refit').launchRate, 10);
  assert.equal(by('sleep').audienceRate, 0.1); assert.equal(by('calm').audienceRate, 0.07);
  assert.ok([a.sub, ...a.programs].every(q => q.viral === 15 && q.organic));
});

test('migration : notoriété ajoutée, rythmes existants inchangés', () => {
  const s = m.defaultState();
  delete s.apps[0].audience; delete s.apps[0].sub.audienceRate;
  const before = s.apps[0].sub.shape;
  m.migrate(s);
  assert.equal(s.apps[0].audience.channels.length, 3);
  assert.equal(s.apps[0].sub.audienceRate, 0);
  assert.equal(s.apps[0].sub.shape, before);
});
