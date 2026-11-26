'use strict';
// Compte d'exploitation : applique les charges aux résultats de la simulation,
// produit par produit, puis répartit les charges de structure Om Holistic entre les applications.

const pnlPos = (x, d = 0) => Number.isFinite(+x) ? Math.max(0, +x) : d;
const inWindow = (c, month) => (!c.start || month >= c.start) && (!c.end || month <= c.end);

// Noms des produits : « CHRYSALISS seul » pour l'abonnement, « CHRYSALISS Refit » pour un programme.
const soloName = a => a.programs.length ? a.name + ' seul' : a.name;
const progName = (a, p) => a.name + ' ' + p.name;

// Colonnes d'une application : le produit seul puis chaque programme.
function productKeys(a) {
  return [{ key: 'sub', name: soloName(a) }, ...a.programs.map(p => ({ key: p.id, name: progName(a, p), off: !p.enabled }))];
}

const emptyCol = () => ({ ca: 0, fees: 0, variable: 0, coaching: 0, fixed: 0 });

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
    cols[k].coaching = units[k].hours * pnlPos(a.coachRate);
  }
  const common = { fixed: 0 };
  for (const c of a.charges || []) {
    if (!inWindow(c, m.month)) continue;
    const targets = c.scope && c.scope !== 'app' && cols[c.scope] ? [c.scope] : Object.keys(cols);
    const amount = pnlPos(c.amount);
    if (c.type === 'fixe') {
      if (targets.length === 1 && c.scope !== 'app') cols[targets[0]].fixed += amount; else common.fixed += amount;
    } else {
      for (const k of targets) {
        const u = units[k];
        if (c.type === 'ca') cols[k].fees += u.ca * amount / 100;
        else if (c.type === 'cliente') cols[k].variable += u.clients * amount;
        else if (c.type === 'inscription') cols[k].variable += u.inscriptions * amount;
      }
    }
  }
  return { month: m.month, cols, common, structure: 0 };
}

// Pour chaque application, la liste mensuelle de ses comptes, structure répartie comprise.
function buildPnl(state, sims) {
  const perApp = state.apps.map((a, i) => sims[i].months.map(m => monthPnl(a, m, state.vat)));
  const months = [...new Set(perApp.flat().map(e => e.month))];
  const index = perApp.map(list => new Map(list.map(e => [e.month, e])));
  const shared = state.shared || { key: 'ca', charges: [] };
  for (const month of months) {
    const amount = shared.charges.filter(c => inWindow(c, month)).reduce((s, c) => s + pnlPos(c.amount), 0);
    if (!amount) continue;
    const entries = index.map(ix => ix.get(month));
    const ca = entries.map(e => e ? Object.values(e.cols).reduce((s, c) => s + c.ca, 0) : 0);
    const totalCa = ca.reduce((s, x) => s + x, 0);
    const present = entries.filter(Boolean).length || 1;
    entries.forEach((e, i) => {
      if (!e) return;
      e.structure = shared.key === 'ca' && totalCa > 0 ? amount * ca[i] / totalCa : amount / present;
    });
  }
  return perApp;
}

// Additionne des comptes mensuels et calcule marges, contributions et résultat.
function sumPnl(entries) {
  const cols = {}, out = { cols, commonFixed: 0, structure: 0 };
  for (const e of entries) {
    for (const k in e.cols) {
      const c = cols[k] = cols[k] || emptyCol();
      for (const f in c) c[f] += e.cols[k][f];
    }
    out.commonFixed += e.common.fixed;
    out.structure += e.structure;
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

if (typeof module !== 'undefined') module.exports = { soloName, progName, productKeys, monthPnl, buildPnl, sumPnl };
