'use strict';
// Compte d'exploitation : applique les charges aux résultats de la simulation,
// produit par produit, puis répartit les charges de structure Om Holistic entre les applications.

const pnlPos = (x, d = 0) => Number.isFinite(+x) ? Math.max(0, +x) : d;
if (typeof module !== 'undefined') var { chargeAt, appDates, campaignBudget } = require('./model.js');

// Noms des produits : « CHRYSALISS seul » pour l'abonnement, « CHRYSALISS Refit » pour un programme.
const soloName = a => a.programs.length ? a.name + ' seul' : a.name;
const progName = (a, p) => a.name + ' ' + p.name;

// Colonnes d'une application : le produit seul puis chaque programme.
function productKeys(a) {
  return [{ key: 'sub', name: soloName(a) }, ...a.programs.map(p => ({ key: p.id, name: progName(a, p), off: !p.enabled }))];
}

const emptyCol = () => ({ ca: 0, fees: 0, variable: 0, coaching: 0, fixed: 0, vat: 0, vatIn: 0 });

// ---- TVA ----
// Régime de TVA d'une implantation : franchise (micro-entreprise sous le seuil), société française (TVA collectée et récupérée),
// société étrangère (LLC : TVA européenne et britannique dès le premier euro via les guichets OSS, sans récupération sur les charges).
const vatMode = sc => !sc ? 'fr' : sc.vat || (sc.id === 'fr-micro' ? 'franchise' : /^llc/.test(sc.id || '') ? 'foreign' : 'fr');
const curScenario = state => { const im = state.implantation; return im ? im.scenarios.find(x => x.id === im.current) || im.scenarios[0] : null; };
// Zones de clientes d'une application, parts ramenées à 100 %.
function zoneShares(a, vat) {
  const zones = vat?.zones?.length ? vat.zones : [{ id: 'fr', rate: pnlPos(vat?.rate), web: true }];
  const w = zones.map(z => pnlPos(a.zones?.[z.id], vat?.zones?.length ? 0 : 100)), tot = w.reduce((t, x) => t + x, 0);
  return zones.map((z, k) => ({ z, w: tot ? w[k] / tot : z.id === 'fr' ? 1 : 0 }));
}
// Une vente telle que saisie (gross) : ce qui reste hors taxe, dont la part des stores, et la TVA que tu collectes sur ton site.
// ex : zones exonérées ce mois-là (franchise de la micro-entreprise).
function splitSale(gross, a, vat, ex = {}) {
  const store = Math.min(100, pnlPos(a.channels?.store)) / 100, ttc = !!vat?.ttc;
  let ht = 0, storeHT = 0, tva = 0;
  for (const { z, w } of zoneShares(a, vat)) {
    if (!w) continue;
    const r = pnlPos(z.rate) / 100, x = gross * w, sx = x * store, wx = x - sx;
    storeHT += ttc ? sx / (1 + r) : sx; // les stores collectent et reversent la taxe de la cliente
    if (z.web && !ex[z.id]) { const h = ttc ? wx / (1 + r) : wx; ht += h; tva += ttc ? wx - h : wx * r; } else ht += wx;
  }
  return { ht: ht + storeHT, store: storeHT, tva };
}
// Part hors taxe d'une vente, hors franchise : pour les indicateurs.
const htShare = (state, a) => splitSale(1, a, state.vat).ht;
// Catégories de charges qui portent une TVA française récupérable.
const VAT_CATS = new Set(['tech', 'contenu', 'logiciels', 'honoraires', 'locaux', 'autre']);
const vatCharge = (cat, amount, d) => d && VAT_CATS.has(cat) ? amount * d : 0;

// Mois où la micro-entreprise reste en franchise, pour la France et pour l'UE (ventes de l'année civile, toutes applications).
function franchiseMonths(state, sims) {
  const vat = state.vat || {}, sc = curScenario(state), out = new Map();
  if (vatMode(sc) !== 'franchise') return out;
  const gross = m => m.directCA + m.postCA + m.products.reduce((t, q) => t + q.sales, 0);
  const tot = new Map(), eu = new Map();
  state.apps.forEach((a, i) => {
    const store = Math.min(100, pnlPos(a.channels?.store)) / 100, wEu = (zoneShares(a, vat).find(x => x.z.id === 'eu') || { w: 0 }).w;
    for (const m of sims[i].months) {
      const g = gross(m);
      tot.set(m.month, (tot.get(m.month) || 0) + g);
      eu.set(m.month, (eu.get(m.month) || 0) + g * (1 - store) * wEu);
    }
  });
  const months = [...tot.keys()].sort(), year = {}, euYear = {};
  for (const mo of months) { const y = mo.slice(0, 4); year[y] = (year[y] || 0) + tot.get(mo); euYear[y] = (euYear[y] || 0) + eu.get(mo); }
  const lim = pnlPos(vat.franchise, 37500), euLim = pnlPos(vat.euLimit, 10000), run = {}, euRun = {};
  for (const mo of months) {
    const y = mo.slice(0, 4), py = String(+y - 1);
    run[y] = (run[y] || 0) + tot.get(mo); euRun[y] = (euRun[y] || 0) + eu.get(mo);
    const fr = (year[py] || 0) <= lim && run[y] <= lim;
    out.set(mo, { fr, eu: fr && (euYear[py] || 0) <= euLim && euRun[y] <= euLim });
  }
  return out;
}
const addCat = (cats, k, v) => { if (v) cats[k] = (cats[k] || 0) + v; };

// Compte d'exploitation d'une application pour un mois (hors structure).
// vat : réglages de TVA ; ctx : { mode, ex } régime de l'implantation et zones en franchise ce mois-là.
function monthPnl(a, m, vat, ctx = { mode: 'fr', ex: {} }) {
  // TVA récupérable : en société française, et en micro-entreprise une fois la franchise perdue.
  const fr = vat?.zones?.length ? pnlPos(vat.rate, 20) / 100 : 0;
  const deduct = ctx.mode === 'fr' || (ctx.mode === 'franchise' && !ctx.ex.fr) ? Math.min(100, pnlPos(vat?.recover)) / 100 * fr / (1 + fr) : 0;
  const units = { sub: { ca: m.directCA + m.postCA, clients: m.direct + m.post, inscriptions: 0, hours: 0, fresh: (m.newDirect || []).reduce((t, x) => t + x, 0), acq: campaignBudget(a.sub, m.month) } };
  a.programs.forEach((p, i) => {
    const q = m.products[i];
    // Nouvelles clientes à acquérir : les inscriptions, sauf celles venues de l'abonnement (déjà clientes).
    units[p.id] = { ca: q.sales, clients: q.clients, inscriptions: q.admissions, hours: q.coachHours, fresh: q.admissions - (q.fromSolo || 0), acq: campaignBudget(p, m.month) };
  });
  const cols = {}, storeHT = {};
  for (const k in units) {
    cols[k] = emptyCol();
    const v = splitSale(units[k].ca, a, vat, ctx.ex);
    cols[k].ca = v.ht; cols[k].vat = v.tva; storeHT[k] = v.store;
  }
  // Coaching : seules les heures des coachs embauchées coûtent (coût horaire), réparties selon les heures de chaque programme.
  // Les heures qui manquent (besoin − tes heures) sont toujours payées à des coachs.
  const hiredCost = (m.extraHours || 0) * pnlPos(a.coachRate);
  if (hiredCost) {
    const progs = a.programs.map(p => p.id), totalH = progs.reduce((t, k) => t + units[k].hours, 0);
    for (const k of progs) cols[k].coaching = hiredCost * (totalH ? units[k].hours / totalH : 1 / progs.length);
  }
  // lines : montant de chaque charge (par identifiant), plus le coaching, les stores et l'acquisition, pour le détail de la page Charges.
  const common = { fixed: 0, vatIn: 0 }, cats = {}, lines = {};
  const dates = appDates([a]);
  for (const k in cols) { addCat(cats, 'coaching', cols[k].coaching); addCat(lines, ':coaching', cols[k].coaching); }
  // Canaux : la part vendue par l'App Store / Google Play paie leur commission, et pas les frais de paiement du site.
  // Commission des stores : sur le prix hors taxe, puisque les stores reversent la taxe eux-mêmes.
  const store = Math.min(100, pnlPos(a.channels?.store)) / 100, storeRate = Math.min(100, pnlPos(a.channels?.storeRate)) / 100;
  for (const k in cols) {
    const fee = storeHT[k] * storeRate;
    cols[k].fees += fee; addCat(cats, 'paiement', fee); addCat(lines, ':store', fee);
    // Campagnes pub : leur budget du mois, imputé au produit qu'elles promeuvent.
    const acq = units[k].acq || 0;
    cols[k].variable += acq; addCat(cats, 'marketing', acq); addCat(lines, ':acq', acq);
  }
  for (const c of a.charges || []) {
    const raw = chargeAt(c, m.month, dates);
    if (raw === null || !raw) continue;
    const targets = c.scope && c.scope !== 'app' && cols[c.scope] ? [c.scope] : Object.keys(cols);
    const cat = c.category || 'autre';
    // Charges saisies telles que payées : la TVA récupérable en sort et part en déduction de la TVA à reverser.
    const tvaIn = vatCharge(cat, raw, deduct), amount = raw - tvaIn;
    // Les frais de paiement du site ne portent que sur la part vendue hors des stores.
    const web = cat === 'paiement' ? 1 - store : 1;
    if (c.type === 'fixe' || c.type === 'unique') {
      if (targets.length === 1 && c.scope !== 'app') cols[targets[0]].fixed += amount; else common.fixed += amount;
      common.vatIn += tvaIn;
      addCat(cats, cat, amount); addCat(lines, c.id, amount);
    } else {
      for (const k of targets) {
        const u = units[k];
        const v = web * (c.type === 'ca' ? u.ca * amount / 100 : c.type === 'cliente' ? u.clients * amount : c.type === 'inscription' ? u.inscriptions * amount : 0);
        if (c.type === 'ca') cols[k].fees += v; else cols[k].variable += v;
        cols[k].vatIn += vatCharge(cat, v, deduct / (1 - deduct || 1));
        addCat(cats, cat, v); addCat(lines, c.id, v);
      }
    }
  }
  return { month: m.month, cols, common, structure: 0, structureVatIn: 0, deduct, cats, structureCats: {}, lines, structureLines: {} };
}

// Pour chaque application, la liste mensuelle de ses comptes, structure répartie comprise.
function buildPnl(state, sims) {
  const mode = vatMode(curScenario(state)), fr = franchiseMonths(state, sims);
  const perApp = state.apps.map((a, i) => sims[i].months.map(m => monthPnl(a, m, state.vat, { mode, ex: fr.get(m.month) || {} })));
  const months = [...new Set(perApp.flat().map(e => e.month))];
  const index = perApp.map(list => new Map(list.map(e => [e.month, e])));
  const shared = state.shared || { key: 'ca', charges: [] };
  const dates = appDates(state.apps);
  for (const month of months) {
    const entries = index.map(ix => ix.get(month));
    const d = (entries.find(Boolean) || {}).deduct || 0;
    const raw = shared.charges.map(c => [c.category || 'autre', chargeAt(c, month, dates) || 0, c.id]).filter(x => x[1]);
    const vatIn = raw.reduce((t, x) => t + vatCharge(x[0], x[1], d), 0);
    const parts = raw.map(([cat, v, id]) => [cat, v - vatCharge(cat, v, d), id]);
    const amount = parts.reduce((t, x) => t + x[1], 0);
    if (!amount) continue;
    const ca = entries.map(e => e ? Object.values(e.cols).reduce((t, c) => t + c.ca, 0) : 0);
    const totalCa = ca.reduce((t, x) => t + x, 0);
    const present = entries.filter(Boolean).length || 1;
    entries.forEach((e, i) => {
      if (!e) return;
      const share = shared.key === 'ca' && totalCa > 0 ? ca[i] / totalCa : 1 / present;
      e.structure = amount * share; e.structureVatIn = vatIn * share;
      for (const [cat, v, id] of parts) { addCat(e.structureCats, cat, v * share); addCat(e.structureLines, id, v * share); }
    });
  }
  return perApp;
}

// Additionne des comptes mensuels et calcule marges, contributions et résultat.
function sumPnl(entries) {
  const cols = {}, out = { cols, commonFixed: 0, structure: 0, vatIn: 0, cats: {}, lines: {}, structureLines: {} };
  for (const e of entries) {
    for (const k in e.cols) {
      const c = cols[k] = cols[k] || emptyCol();
      for (const f in c) c[f] += e.cols[k][f];
    }
    out.commonFixed += e.common.fixed;
    out.structure += e.structure;
    out.vatIn += (e.common.vatIn || 0) + (e.structureVatIn || 0);
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
  // TVA collectée sur le site, TVA récupérable sur les charges : elles passent par la trésorerie, pas par le résultat.
  out.total.vat = add('vat'); out.total.vatIn = add('vatIn') + out.vatIn;
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
  const months = [...new Set(all.flatMap(x => x.months.map(m => m.month)))].sort();
  let balance = pnlPos(cash.start), low = { month: months[0], balance }, cumResult = 0, vatDue = 0;
  const quarterly = (state.vat?.period || 'trimestre') !== 'mois';
  const out = [];
  for (const month of months) {
    let ca = 0, charges = 0, adjust = 0, raised = 0, vat = 0, vatIn = 0;
    // TVA du mois précédent (ou du trimestre écoulé) reversée ce mois-ci ; un crédit de TVA se reporte.
    let vatPaid = 0;
    if ((!quarterly || ['01', '04', '07', '10'].includes(month.slice(5))) && vatDue > 0) { vatPaid = vatDue; vatDue = 0; }
    for (const x of all) {
      // Levée de fonds (plan avec levée) : l'argent arrive le mois de la levée.
      if (x.a.funding && x.a.funding.month === month) raised += pnlPos(x.a.funding.amount);
      const k = x.months.findIndex(m => m.month === month);
      if (k < 0) continue;
      const t = sumPnl([x.pnl[k]]).total;
      ca += t.ca; charges += t.charges; vat += t.vat; vatIn += t.vatIn;
      const gross = x.months[k].total, ht = gross ? t.ca / gross : 1;
      // Paiement en plusieurs fois : la vente compte dans le chiffre d'affaires du mois, l'argent arrive sur n mois.
      x.a.programs.forEach((p, i) => {
        const n = Math.max(1, Math.round(pnlPos(p.installments, 1)));
        if (n === 1) return;
        let got = 0;
        for (let j = 0; j < n; j++) { const mm = x.months[k - j]; if (mm) got += mm.products[i].sales / n; }
        adjust += ht * (got - x.months[k].products[i].sales);
      });
    }
    const result = ca - charges, tx = afterTax(sc, ca, result, 1);
    const pay = cash.payFrom && month >= cash.payFrom ? pnlPos(cash.payGoal) : 0;
    // Encaissé : ventes HT plus la TVA collectée sur le site ; payé : charges avec leur TVA récupérable.
    const inflow = ca + vat + adjust + raised, outflow = charges + vatIn + tx.fixed + tx.social + tx.tax + vatPaid;
    vatDue += vat - vatIn;
    balance += inflow - outflow - pay;
    cumResult += result;
    if (balance < low.balance) low = { month, balance };
    out.push({ month, ca, inflow, raised, charges: charges + vatIn, vat, vatIn, vatPaid, taxes: tx.fixed + tx.social + tx.tax, pay, result, net: tx.net, balance });
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

if (typeof module !== 'undefined') module.exports = { vatMode, splitSale, htShare, franchiseMonths, treasury, afterTax, soloName, progName, productKeys, monthPnl, buildPnl, sumPnl };
