'use strict';
// Moteur de simulation : calcule semaine par semaine les admissions aux programmes,
// la capacité de coaching et les abonnements, puis agrège le tout par mois.
// Aucune dépendance au navigateur : ce fichier est aussi testé avec Node.

if (typeof module !== 'undefined') var { phaseAt } = require('./model.js');

const DAY = 86400000, WEEK = 7 * DAY;
const pos = (x, d = 0) => Number.isFinite(+x) ? Math.max(0, +x) : d;
const monthDate = k => new Date(k + '-01T00:00:00Z');
const monthKey = d => d.toISOString().slice(0, 7);
const addWeeks = (d, k) => new Date(+d + k * WEEK);
const shiftMonth = (d, k) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + k, 1));
// Premier lundi à partir de la date (la date elle-même si c'est un lundi).
const firstMonday = d => new Date(+d + ((8 - d.getUTCDay()) % 7) * DAY);

// Une semaine qui chevauche deux mois est répartie au prorata des jours,
// pour que les mois de 4 et de 5 lundis ne créent pas de dents de scie.
function weekShares(d) {
  const next = shiftMonth(d, 1);
  const inFirst = Math.min(7, (next - d) / DAY) / 7;
  return inFirst >= 1 ? [[monthKey(d), 1]] : [[monthKey(d), inFirst], [monthKey(next), 1 - inFirst]];
}

// Rythme d'acquisition hebdomadaire après w semaines : progression linéaire
// par paliers de l'objectif de départ à l'objectif cible, ou paliers personnalisés.
function weeklyRate(p, w) {
  const a = Math.floor(pos(p.initial)), b = Math.floor(pos(p.target));
  const step = Math.max(1, Math.floor(pos(p.step, 1)));
  const duration = Math.max(1, Math.round(pos(p.months, 24) * 52 / 12));
  const changes = Math.ceil(Math.abs(b - a) / step);
  if (p.palierMode && p.paliers?.length) {
    for (const q of p.paliers) {
      if (w < pos(q.weeks)) return Math.floor(pos(q.rate));
      w -= pos(q.weeks);
    }
    return b;
  }
  return a + Math.sign(b - a) * Math.min(Math.abs(b - a), Math.floor(Math.max(0, w) * changes / duration) * step);
}

// Taux de survie mensuel d'un abonnement : résiliation mensuelle = 1 / durée moyenne.
const survival = months => pos(months) > 0 ? 1 - Math.min(1, 1 / pos(months)) : 1;

function emptyMonth(month, a) {
  return {
    month, sales: 0, admissions: 0, finished: 0, active: 0, cost: pos(a.cost),
    newDirect: [0, 0, 0], direct: 0, post: 0, directCA: 0, postCA: 0, total: 0, net: 0,
    products: a.programs.map(() => ({ sales: 0, admissions: 0, finished: 0, active: 0, post: 0 }))
  };
}

function simulate(a) {
  const start = monthDate(a.start);
  const end = new Date(Date.UTC(start.getUTCFullYear() + 5, 11, 31));
  const months = new Map();
  for (let d = start; d <= end; d = shiftMonth(d, 1)) months.set(monthKey(d), emptyMonth(monthKey(d), a));
  // Ajoute une valeur hebdomadaire aux mois couverts par la semaine.
  const credit = (d, fn) => { for (const [k, share] of weekShares(d)) { const m = months.get(k); if (m) fn(m, share); } };

  const events = [], weekly = [], pending = a.programs.map(() => 0);
  const capacityChanges = [...(a.capacityChanges || [])].sort((x, y) => x.date.localeCompare(y.date));

  // Calendrier de chaque programme : cohortes bêta puis début commercial
  // (repoussé après la fin de la dernière cohorte bêta si besoin).
  const configs = a.programs.map(p => {
    const beta = [];
    if (p.beta) {
      const every = Math.max(1, Math.floor(pos(p.betaInterval)));
      for (let i = 0; i < Math.min(100, Math.floor(pos(p.betaCount))); i++) beta.push(firstMonday(shiftMonth(monthDate(p.betaStart), i * every)));
    }
    let commercial = firstMonday(monthDate(p.start));
    if (beta.length) {
      const finish = addWeeks(beta.at(-1), Math.max(1, pos(p.duration)));
      if (finish > commercial) commercial = finish;
    }
    return { p, beta, commercial };
  });

  const subStart = firstMonday(monthDate(a.sub.start));

  for (let d = firstMonday(start); d <= end; d = addWeeks(d, 1)) {
    const m = months.get(monthKey(d));
    if (!m) continue;
    const active = events.filter(e => e.end > d);
    let cap = pos(a.capacity);
    for (const c of capacityChanges) if (monthKey(d) >= c.date) cap = pos(c.capacity);
    let available = Math.max(0, Math.floor(cap - active.reduce((s, e) => s + e.count, 0)));
    let demand = 0, admitted = 0;

    configs.forEach(({ p, beta, commercial }, i) => {
      if (!p.enabled) return;
      const isBeta = beta.some(b => +b === +d);
      const w = Math.floor((d - commercial) / WEEK);
      const inLaunch = p.launch && w >= 0 && w < pos(p.launchWeeks);
      let want = isBeta ? Math.floor(pos(p.betaSize))
        : w < 0 ? 0
        : inLaunch ? Math.floor(pos(p.launchRate))
        : weeklyRate(p, w - (p.launch ? pos(p.launchWeeks) : 0));
      if (a.waitlist) want += pending[i];
      demand += want;
      const count = a.restrict ? Math.min(want, available) : want;
      pending[i] = a.waitlist ? want - count : 0;
      available = Math.max(0, available - count);
      if (!count) return;

      let price = pos(phaseAt(p.pricing, monthKey(d)).price);
      const promo = (p.promos || []).find(q => monthKey(d) >= q.start && monthKey(d) <= q.end);
      if (promo) price = pos(promo.price);

      const e = { i, count, end: addWeeks(d, Math.max(1, Math.floor(pos(p.duration)))) };
      events.push(e); active.push(e);
      credit(d, (mm, share) => {
        mm.sales += count * price * share; mm.admissions += count * share;
        mm.products[i].sales += count * price * share; mm.products[i].admissions += count * share;
      });
      admitted += count;
    });

    const people = active.reduce((s, e) => s + e.count, 0);
    const hours = active.reduce((s, e) => s + e.count * pos(a.programs[e.i].coach) / 60, 0);
    m.active = people;
    m.products.forEach((p, i) => { p.active = active.filter(e => e.i === i).reduce((s, e) => s + e.count, 0); });
    weekly.push({ date: d.toISOString().slice(0, 10), people, hours, cap, demand, admitted, waiting: pending.reduce((s, x) => s + x, 0) });

    if (d >= subStart) {
      const count = weeklyRate(a.sub, Math.floor((d - subStart) / WEEK));
      const phase = phaseAt(a.sub.directPricing, monthKey(d)).index;
      credit(d, (mm, share) => { mm.newDirect[phase] += count * share; });
    }
  }

  for (const e of events) credit(e.end, (m, share) => { m.finished += e.count * share; m.products[e.i].finished += e.count * share; });

  // Stocks d'abonnées, par phase de prix d'entrée (pour garder le prix d'entrée si demandé).
  const directGrid = a.sub.directPricing, postGrid = a.sub.postPricing;
  let direct = [0, 0, 0], post = a.programs.map(() => [0, 0, 0]);
  const revenue = (stock, grid, month) => a.sub.lockPrice
    ? stock.reduce((s, v, k) => s + v * pos(grid[k]?.price), 0)
    : stock.reduce((s, v) => s + v, 0) * pos(phaseAt(grid, month).price);

  for (const m of months.values()) {
    direct = direct.map((v, k) => v * survival(a.sub.duration) + m.newDirect[k]);
    const postPhase = phaseAt(postGrid, m.month).index;
    post = post.map((stock, i) => stock.map((v, k) => v * survival(a.sub.postDuration)
      + (k === postPhase ? m.products[i].finished * Math.min(100, pos(a.sub.conversion)) / 100 : 0)));
    m.direct = direct.reduce((s, v) => s + v, 0);
    m.post = post.reduce((s, stock) => s + stock.reduce((t, v) => t + v, 0), 0);
    m.directCA = revenue(direct, directGrid, m.month);
    m.products.forEach((p, i) => { p.post = revenue(post[i], postGrid, m.month); });
    m.postCA = m.products.reduce((s, p) => s + p.post, 0);
    m.total = m.sales + m.directCA + m.postCA;
    m.net = m.total - m.cost;
  }
  return { months: [...months.values()], weekly };
}

if (typeof module !== 'undefined') module.exports = { simulate, weeklyRate, weekShares };
