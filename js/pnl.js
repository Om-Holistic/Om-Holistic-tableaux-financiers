'use strict';
// Compte d'exploitation : applique les charges aux résultats de la simulation,
// produit par produit, puis répartit les charges de structure Om Holistic entre les applications.

const pnlPos = (x, d = 0) => Number.isFinite(+x) ? Math.max(0, +x) : d;
if (typeof module !== 'undefined') var { chargeAt, appDates } = require('./model.js');

// Noms des produits : « CHRYSALISS seul » pour l'abonnement, « CHRYSALISS Refit » pour un programme.
const soloName = a => a.programs.length ? a.name + ' seul' : a.name;
const progName = (a, p) => a.name + ' ' + p.name;

// Colonnes d'une application : le produit seul puis chaque programme.
function productKeys(a) {
  return [{ key: 'sub', name: soloName(a) }, ...a.programs.map(p => ({ key: p.id, name: progName(a, p), off: !p.enabled }))];
}

const emptyCol = () => ({ ca: 0, fees: 0, variable: 0, coaching: 0, fixed: 0 });
const addCat = (cats, k, v) => { if (v) cats[k] = (cats[k] || 0) + v; };

// Compte d'exploitation d'une application pour un mois (hors structure).
function monthPnl(a, m, vat) {
  const ht = x => vat?.ttc ? x / (1 + pnlPos(vat.rate) / 100) : x;
  const units = { sub: { ca: m.directCA + m.postCA, clients: m.direct + m.post, inscriptions: 0, hours: 0 } };
  a.programs.forEach((p, i) => {
    const q = m.products[i];
    units[p.id] = { ca: q.sales, clients: q.clients, inscriptions: q.admissions, hours: q.coachHours };
  });
  const cols = {};
  for (const k in units) {
    cols[k] = emptyCol();
    cols[k].ca = ht(units[k].ca);
  }
  // Coaching : seules les heures des coachs embauchées coûtent (coût horaire), réparties selon les heures de chaque programme.
  const hiredCost = (m.hiredHours || 0) * pnlPos(a.coachRate);
  if (hiredCost) {
    const progs = a.programs.map(p => p.id), totalH = progs.reduce((t, k) => t + units[k].hours, 0);
    for (const k of progs) cols[k].coaching = hiredCost * (totalH ? units[k].hours / totalH : 1 / progs.length);
  }
  const common = { fixed: 0 }, cats = {};
  const dates = appDates([a]);
  for (const k in cols) addCat(cats, 'coaching', cols[k].coaching);
  for (const c of a.charges || []) {
    const amount = chargeAt(c, m.month, dates);
    if (amount === null || !amount) continue;
    const targets = c.scope && c.scope !== 'app' && cols[c.scope] ? [c.scope] : Object.keys(cols);
    const cat = c.category || 'autre';
    if (c.type === 'fixe' || c.type === 'unique') {
      if (targets.length === 1 && c.scope !== 'app') cols[targets[0]].fixed += amount; else common.fixed += amount;
      addCat(cats, cat, amount);
    } else {
      for (const k of targets) {
        const u = units[k];
        const v = c.type === 'ca' ? u.ca * amount / 100 : c.type === 'cliente' ? u.clients * amount : c.type === 'inscription' ? u.inscriptions * amount : 0;
        if (c.type === 'ca') cols[k].fees += v; else cols[k].variable += v;
        addCat(cats, cat, v);
      }
    }
  }
  return { month: m.month, cols, common, structure: 0, cats, structureCats: {} };
}

// Pour chaque application, la liste mensuelle de ses comptes, structure répartie comprise.
function buildPnl(state, sims) {
  const perApp = state.apps.map((a, i) => sims[i].months.map(m => monthPnl(a, m, state.vat)));
  const months = [...new Set(perApp.flat().map(e => e.month))];
  const index = perApp.map(list => new Map(list.map(e => [e.month, e])));
  const shared = state.shared || { key: 'ca', charges: [] };
  const dates = appDates(state.apps);
  for (const month of months) {
    const parts = shared.charges.map(c => [c.category || 'autre', chargeAt(c, month, dates) || 0]).filter(x => x[1]);
    const amount = parts.reduce((t, x) => t + x[1], 0);
    if (!amount) continue;
    const entries = index.map(ix => ix.get(month));
    const ca = entries.map(e => e ? Object.values(e.cols).reduce((t, c) => t + c.ca, 0) : 0);
    const totalCa = ca.reduce((t, x) => t + x, 0);
    const present = entries.filter(Boolean).length || 1;
    entries.forEach((e, i) => {
      if (!e) return;
      const share = shared.key === 'ca' && totalCa > 0 ? ca[i] / totalCa : 1 / present;
      e.structure = amount * share;
      for (const [cat, v] of parts) addCat(e.structureCats, cat, v * share);
    });
  }
  return perApp;
}

// Additionne des comptes mensuels et calcule marges, contributions et résultat.
function sumPnl(entries) {
  const cols = {}, out = { cols, commonFixed: 0, structure: 0, cats: {} };
  for (const e of entries) {
    for (const k in e.cols) {
      const c = cols[k] = cols[k] || emptyCol();
      for (const f in c) c[f] += e.cols[k][f];
    }
    out.commonFixed += e.common.fixed;
    out.structure += e.structure;
    for (const k in e.cats || {}) addCat(out.cats, k, e.cats[k]);
    for (const k in e.structureCats || {}) addCat(out.cats, k, e.structureCats[k]);
  }
  for (const c of Object.values(cols)) {
    c.margin = c.ca - c.fees - c.variable - c.coaching;
    c.contribution = c.margin - c.fixed;
  }
  const all = Object.values(cols);
  const add = f => all.reduce((s, c) => s + c[f], 0);
  out.total = { ca: add('ca'), fees: add('fees'), variable: add('variable'), coaching: add('coaching'), margin: add('margin'), fixed: add('fixed') + out.commonFixed, contribution: add('contribution') };
  out.total.charges = out.total.fees + out.total.variable + out.total.coaching + out.total.fixed + out.structure;
  out.total.result = out.total.contribution - out.commonFixed - out.structure;
  return out;
}

// Du résultat d'exploitation au résultat net selon une implantation, sur une période de `months` mois.
function afterTax(sc, caHT, result, months) {
  const pct = x => Math.max(0, +x || 0) / 100;
  const fixed = Math.max(0, +sc.fixedYear || 0) * months / 12;
  const r1 = result - fixed;
  const social = pct(sc.socialRate) * (sc.socialBase === 'ca' ? caHT : Math.max(0, r1));
  const r2 = r1 - social;
  const tax = pct(sc.taxRate) * (sc.taxBase === 'ca' ? caHT : Math.max(0, r2));
  const r3 = r2 - tax;
  const dist = pct(sc.distRate) * Math.max(0, r3);
  return { fixed, social, tax, dist, net: r3 - dist };
}

if (typeof module !== 'undefined') module.exports = { afterTax, soloName, progName, productKeys, monthPnl, buildPnl, sumPnl };
