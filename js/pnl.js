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
  const units = { sub: { ca: m.directCA + m.postCA, clients: m.direct + m.post, inscriptions: 0, hours: 0, fresh: (m.newDirect || []).reduce((t, x) => t + x, 0), acq: pnlPos(a.sub.acq) } };
  a.programs.forEach((p, i) => {
    const q = m.products[i];
    // Nouvelles clientes à acquérir : les inscriptions, sauf celles venues de l'abonnement (déjà clientes).
    units[p.id] = { ca: q.sales, clients: q.clients, inscriptions: q.admissions, hours: q.coachHours, fresh: q.admissions - (q.fromSolo || 0), acq: pnlPos(p.acq) };
  });
  const cols = {};
  for (const k in units) {
    cols[k] = emptyCol();
    cols[k].ca = ht(units[k].ca);
  }
  // Coaching : seules les heures des coachs embauchées coûtent (coût horaire), réparties selon les heures de chaque programme.
  const hiredCost = ((m.hiredHours || 0) + (a.payMissing ? m.extraHours || 0 : 0)) * pnlPos(a.coachRate);
  if (hiredCost) {
    const progs = a.programs.map(p => p.id), totalH = progs.reduce((t, k) => t + units[k].hours, 0);
    for (const k of progs) cols[k].coaching = hiredCost * (totalH ? units[k].hours / totalH : 1 / progs.length);
  }
  // lines : montant de chaque charge (par identifiant), plus le coaching, les stores et l'acquisition, pour le détail de la page Charges.
  const common = { fixed: 0 }, cats = {}, lines = {};
  const dates = appDates([a]);
  for (const k in cols) { addCat(cats, 'coaching', cols[k].coaching); addCat(lines, ':coaching', cols[k].coaching); }
  // Canaux : la part vendue par l'App Store / Google Play paie leur commission, et pas les frais de paiement du site.
  const store = Math.min(100, pnlPos(a.channels?.store)) / 100, storeRate = Math.min(100, pnlPos(a.channels?.storeRate)) / 100;
  for (const k in cols) {
    const fee = cols[k].ca * store * storeRate;
    cols[k].fees += fee; addCat(cats, 'paiement', fee); addCat(lines, ':store', fee);
    // Coût d'acquisition : par nouvelle cliente (inscription ou nouvelle abonnée payante).
    const acq = Math.max(0, units[k].fresh || 0) * (units[k].acq || 0);
    cols[k].variable += acq; addCat(cats, 'marketing', acq); addCat(lines, ':acq', acq);
  }
  for (const c of a.charges || []) {
    const amount = chargeAt(c, m.month, dates);
    if (amount === null || !amount) continue;
    const targets = c.scope && c.scope !== 'app' && cols[c.scope] ? [c.scope] : Object.keys(cols);
    const cat = c.category || 'autre';
    // Les frais de paiement du site ne portent que sur la part vendue hors des stores.
    const web = cat === 'paiement' ? 1 - store : 1;
    if (c.type === 'fixe' || c.type === 'unique') {
      if (targets.length === 1 && c.scope !== 'app') cols[targets[0]].fixed += amount; else common.fixed += amount;
      addCat(cats, cat, amount); addCat(lines, c.id, amount);
    } else {
      for (const k of targets) {
        const u = units[k];
        const v = web * (c.type === 'ca' ? u.ca * amount / 100 : c.type === 'cliente' ? u.clients * amount : c.type === 'inscription' ? u.inscriptions * amount : 0);
        if (c.type === 'ca') cols[k].fees += v; else cols[k].variable += v;
        addCat(cats, cat, v); addCat(lines, c.id, v);
      }
    }
  }
  return { month: m.month, cols, common, structure: 0, cats, structureCats: {}, lines, structureLines: {} };
}

// Pour chaque application, la liste mensuelle de ses comptes, structure répartie comprise.
function buildPnl(state, sims) {
  const perApp = state.apps.map((a, i) => sims[i].months.map(m => monthPnl(a, m, state.vat)));
  const months = [...new Set(perApp.flat().map(e => e.month))];
  const index = perApp.map(list => new Map(list.map(e => [e.month, e])));
  const shared = state.shared || { key: 'ca', charges: [] };
  const dates = appDates(state.apps);
  for (const month of months) {
    const parts = shared.charges.map(c => [c.category || 'autre', chargeAt(c, month, dates) || 0, c.id]).filter(x => x[1]);
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
      for (const [cat, v, id] of parts) { addCat(e.structureCats, cat, v * share); addCat(e.structureLines, id, v * share); }
    });
  }
  return perApp;
}

// Additionne des comptes mensuels et calcule marges, contributions et résultat.
function sumPnl(entries) {
  const cols = {}, out = { cols, commonFixed: 0, structure: 0, cats: {}, lines: {}, structureLines: {} };
  for (const e of entries) {
    for (const k in e.cols) {
      const c = cols[k] = cols[k] || emptyCol();
      for (const f in c) c[f] += e.cols[k][f];
    }
    out.commonFixed += e.common.fixed;
    out.structure += e.structure;
    for (const k in e.cats || {}) addCat(out.cats, k, e.cats[k]);
    for (const k in e.structureCats || {}) addCat(out.cats, k, e.structureCats[k]);
    for (const k in e.lines || {}) addCat(out.lines, k, e.lines[k]);
    for (const k in e.structureLines || {}) addCat(out.structureLines, k, e.structureLines[k]);
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
  // Impôt sur les sociétés à deux taux : taux réduit jusqu'au plafond annuel de bénéfice (proratisé), taux normal au-delà.
  const base = sc.taxBase === 'ca' ? caHT : Math.max(0, r2), cap = Math.max(0, +sc.taxLimit || 0) * months / 12;
  const tax = cap && +sc.taxRate2 > 0 ? pct(sc.taxRate) * Math.min(base, cap) + pct(sc.taxRate2) * Math.max(0, base - cap) : pct(sc.taxRate) * base;
  const r3 = r2 - tax;
  const dist = pct(sc.distRate) * Math.max(0, r3);
  return { fixed, social, tax, dist, net: r3 - dist };
}

// Trésorerie de la société (toutes les applications), mois par mois.
// Encaissements : chiffre d'affaires HT, les programmes payés en plusieurs fois étant étalés sur leurs mensualités.
// Décaissements : toutes les charges, puis frais de structure, cotisations et impôts de l'implantation (calculés mois par mois,
// approximation : l'impôt réel se paie souvent l'année suivante), puis ta rémunération à partir du mois choisi.
// solo : une application seule, comme une société à part (sans apport de départ ni ta rémunération,
// avec sa quote-part de structure et ses propres impôts) : c'est ce que regarde un investisseur de cette application.
function treasury(state, all, solo = false) {
  const cash = solo ? {} : state.cash || {}, sc = (state.implantation.scenarios.find(x => x.id === state.implantation.current) || state.implantation.scenarios[0]) || {};
  const ht = x => state.vat?.ttc ? x / (1 + pnlPos(state.vat.rate) / 100) : x;
  const months = [...new Set(all.flatMap(x => x.months.map(m => m.month)))].sort();
  let balance = pnlPos(cash.start), low = { month: months[0], balance }, cumResult = 0;
  const out = [];
  for (const month of months) {
    let ca = 0, charges = 0, adjust = 0, raised = 0;
    for (const x of all) {
      // Levée de fonds (plan avec levée) : l'argent arrive le mois de la levée.
      if (x.a.funding && x.a.funding.month === month) raised += pnlPos(x.a.funding.amount);
      const k = x.months.findIndex(m => m.month === month);
      if (k < 0) continue;
      const t = sumPnl([x.pnl[k]]).total;
      ca += t.ca; charges += t.charges;
      // Paiement en plusieurs fois : la vente compte dans le chiffre d'affaires du mois, l'argent arrive sur n mois.
      x.a.programs.forEach((p, i) => {
        const n = Math.max(1, Math.round(pnlPos(p.installments, 1)));
        if (n === 1) return;
        let got = 0;
        for (let j = 0; j < n; j++) { const mm = x.months[k - j]; if (mm) got += mm.products[i].sales / n; }
        adjust += ht(got - x.months[k].products[i].sales);
      });
    }
    const result = ca - charges, tx = afterTax(sc, ca, result, 1);
    const pay = cash.payFrom && month >= cash.payFrom ? pnlPos(cash.payGoal) : 0;
    const inflow = ca + adjust + raised, outflow = charges + tx.fixed + tx.social + tx.tax;
    balance += inflow - outflow - pay;
    cumResult += result;
    if (balance < low.balance) low = { month, balance };
    out.push({ month, ca, inflow, raised, charges, taxes: tx.fixed + tx.social + tx.tax, pay, result, net: tx.net, balance });
  }
  // Point mort : premier mois à partir duquel le résultat mensuel reste positif.
  let breakEven = null;
  for (let k = out.length - 1; k >= 0 && out[k].result >= 0; k--) breakEven = out[k].month;
  // Objectif de revenu : premier mois à partir duquel le net mensuel (après impôts) reste au-dessus de l'objectif.
  let payReached = null;
  const goal = pnlPos(cash.payGoal);
  if (goal) for (let k = out.length - 1; k >= 0 && out[k].net >= goal; k--) payReached = out[k].month;
  return { months: out, low, breakEven, payReached, start: pnlPos(cash.start), goal };
}

if (typeof module !== 'undefined') module.exports = { treasury, afterTax, soloName, progName, productKeys, monthPnl, buildPnl, sumPnl };
