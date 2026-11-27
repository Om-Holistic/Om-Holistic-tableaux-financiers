'use strict';
// Moteur de simulation : calcule semaine par semaine les admissions aux programmes,
// la capacité de coaching et les abonnements, puis agrège le tout par mois.
// Aucune dépendance au navigateur : ce fichier est aussi testé avec Node.

if (typeof module !== 'undefined') var { phaseAt, appStart, capacityAt, coachAt, addMonths, campaignClients } = require('./model.js');

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
// Clientes par semaine venues de la pub : somme, sur les campagnes du mois, de budget ÷ coût par cliente.
// Effet boule de neige : pour 100 clientes venues de la pub, viral % de plus arrivent par bouche-à-oreille et avis.
const adRate = (p, month) => campaignClients(p, month) * 12 / 52 * (1 + pos(p.viral) / 100);
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
  // Courbe en S : l'appli est d'abord peu connue, la croissance s'accélère avec les avis, puis se stabilise à maturité.
  if (p.shape === 's') {
    const t = Math.min(1, Math.max(0, w) / duration), L = x => 1 / (1 + Math.exp(-10 * (x - 0.5)));
    return a + (b - a) * (L(t) - L(0)) / (L(1) - L(0));
  }
  return a + Math.sign(b - a) * Math.min(Math.abs(b - a), Math.floor(Math.max(0, w) * changes / duration) * step);
}

// Notoriété en entonnoir, mois par mois : nouvelles abonnées Instagram (seule et par les relais),
// passage à la newsletter, découvertes dans les stores, et la taille du vivier qui en résulte.
// Paliers datés [{ month, n }] : avant le premier, before ; en S d'un palier au suivant ; après le dernier, le dernier.
function pointsAt(points, month, before) {
  const ps = (points || []).filter(q => q.month).slice().sort((x, y) => x.month.localeCompare(y.month));
  if (!ps.length || month < ps[0].month) return before ?? (ps[0] ? pos(ps[0].n) : 0);
  for (let k = 1; k < ps.length; k++) if (month < ps[k].month) {
    const t = monthsBetween(ps[k - 1].month, month) / Math.max(1, monthsBetween(ps[k - 1].month, ps[k].month)), sm = t * t * (3 - 2 * t);
    return pos(ps[k - 1].n) + (pos(ps[k].n) - pos(ps[k - 1].n)) * sm;
  }
  return pos(ps.at(-1).n);
}
let audCache = { key: '', map: null };
function audienceSeries(a) {
  const au = a.audience;
  if (!au || !au.insta) return new Map();
  const key = JSON.stringify(au);
  if (audCache.key === key) return audCache.map;
  const map = new Map(), from = au.from || '2026-11', last = HORIZON_END + '-12';
  let insta = pos(au.insta.count), news = pos(au.newsletter?.count), stores = 0;
  for (let m = from, k = 0; m <= last; m = addMonths(m, 1), k++) {
    const own = k > 0 ? pointsAt(au.insta.points, m) : 0;
    const relays = k > 0 ? (au.relays || []).filter(r => (!r.start || m >= r.start) && (!r.end || m <= r.end)).reduce((t, r) => t + pos(r.audience) * pos(r.rate) / 100, 0) : 0;
    const st = au.stores?.on ? pointsAt(au.stores.points, m, 0) : 0;
    const toNews = (own + relays) * pos(au.newsletter?.fromInsta) / 100;
    insta += own + relays; news += toNews; stores += st;
    map.set(m, { insta, news, stores, own, relays, toNews, st, pool: insta + news + stores });
  }
  audCache = { key, map };
  return map;
}
// Taille du vivier un mois donné (avant le premier mois : le point de départ).
function audienceAt(a, month) {
  const ser = audienceSeries(a), from = a.audience?.from;
  if (!ser.size) return 0;
  const row = ser.get(month) || (month < from ? ser.get(from) : [...ser.values()].at(-1));
  return row ? row.pool : 0;
}
// Ventes sans pub d'un produit, mois par mois, tirées du vivier :
// - les nouvelles venues du mois achètent à leur propre taux (audienceNew %, elles découvrent ton travail) ;
// - celles déjà là se décident plus lentement (audienceRate % par mois) ;
// - une acheteuse sort du vivier de ce produit : on ne la compte pas deux fois.
const prodCache = new Map();
function audienceBuyers(a, p, month) {
  const ser = audienceSeries(a), start = p.start || a.sub.start;
  if (!ser.size || !start || month < start) return 0;
  const key = JSON.stringify([a.audience, start, p.audienceRate, p.audienceNew]);
  let map = prodCache.get(key);
  if (!map) {
    map = new Map();
    const rNew = pos(p.audienceNew) / 100, rOld = pos(p.audienceRate) / 100;
    let prev = null, left = 0;
    for (const [m, row] of ser) {
      if (m < start) { prev = row.pool; continue; }
      // Au lancement, tout le vivier déjà constitué est « déjà là » ; ensuite, la croissance du mois = nouvelles venues.
      if (!map.size) { left = row.pool; prev = row.pool; }
      const fresh = Math.max(0, row.pool - prev), old = left * rOld, nw = fresh * rNew;
      left = Math.max(0, left - old + fresh - nw);
      map.set(m, old + nw);
      prev = row.pool;
    }
    if (prodCache.size > 50) prodCache.clear();
    prodCache.set(key, map);
  }
  return map.get(month) ?? [...map.values()].at(-1) ?? 0;
}
const organicRate = (a, p, d, w) => p.shape === 'brand' && !p.palierMode ? audienceBuyers(a, p, monthKey(d)) * 12 / 52 : weeklyRate(p, w);

// Taux de survie mensuel d'un abonnement : résiliation mensuelle = 1 / durée moyenne.
const survival = months => pos(months) > 0 ? 1 - Math.min(1, 1 / pos(months)) : 1;

const monthsBetween = (from, to) => { const [y1, m1] = from.split('-').map(Number), [y2, m2] = to.split('-').map(Number); return (y2 - y1) * 12 + m2 - m1; };
// Dernière année des prévisions (au moins 5 ans après le lancement de l'appli).
const HORIZON_END = 2034;

// Mois d'abonnement offerts après la fin d'un programme, convertis en semaines (0 = pas d'offre).
const giftWeeks = p => Math.round(pos(p.giftMonths) * 52 / 12);

function emptyMonth(month, a) {
  return {
    month, sales: 0, admissions: 0, finished: 0, active: 0,
    newDirect: [0, 0, 0], direct: 0, post: 0, gifted: 0, directCA: 0, postCA: 0, total: 0,
    paidNew: 0, products: a.programs.map(() => ({ sales: 0, admissions: 0, fromSolo: 0, finished: 0, finishedNew: 0, convertNew: 0, giftIn: 0, giftOut: 0, gifted: 0, active: 0, post: 0, clients: 0, coachHours: 0 })), trials: 0, hiredHours: 0, extraHours: 0
  };
}

// Abonnées CHRYSALISS seul qui achètent un programme : il faut connaître le nombre d'abonnées de chaque mois.
// On fait donc un premier passage sans ces achats (ils ne modifient pas ce nombre), puis le passage complet.
function simulate(a, soloStock) {
  if (!soloStock && a.programs.some(p => p.enabled && pos(p.fromSolo) > 0)) {
    const first = simulate(a, new Map());
    soloStock = new Map(first.months.map(m => [m.month, m.direct + m.post]));
  }
  soloStock = soloStock || new Map();
  const start = monthDate(appStart(a));
  const end = new Date(Date.UTC(Math.max(HORIZON_END, start.getUTCFullYear() + 5), 11, 31));
  const months = new Map();
  for (let d = start; d <= end; d = shiftMonth(d, 1)) months.set(monthKey(d), emptyMonth(monthKey(d), a));
  // Ajoute une valeur hebdomadaire aux mois couverts par la semaine.
  const credit = (d, fn) => { for (const [k, share] of weekShares(d)) { const m = months.get(k); if (m) fn(m, share); } };

  const events = [], weekly = [], pending = a.programs.map(() => 0);
  const coaching = a.programs.length > 0;

  // Calendrier de chaque programme : cohortes de test (premier lundi de leur mois), puis lancement commercial.
  const configs = a.programs.map(p => ({
    p,
    cohorts: (p.cohorts || []).filter(c => c.date).map(c => ({ week: +firstMonday(monthDate(c.date)), size: Math.floor(pos(c.size)) })),
    commercial: p.start ? firstMonday(monthDate(p.start)) : null
  }));

  const subStart = a.sub.start ? firstMonday(monthDate(a.sub.start)) : null;
  const vol = Number.isFinite(+a.volume) && +a.volume > 0 ? +a.volume : 1;

  for (let d = firstMonday(start); d <= end; d = addWeeks(d, 1)) {
    const m = months.get(monthKey(d));
    if (!m) continue;
    const active = events.filter(e => e.end > d);
    const step = capacityAt(a, monthKey(d));
    // Heures par cliente ce mois-ci : le temps de coaching peut baisser avec le temps (paliers du programme).
    const perH = i => coachAt(a.programs[i], monthKey(d)) / 60;
    // Une seule limite : les heures de coaching disponibles (les tiennes + celles des coachs embauchées).
    // Les heures des coachs ne se saisissent pas : ce sont les heures qui manquent, calculées (extraHours).
    const own = step ? pos(step.hours) : Infinity, hired = 0, limit = own;
    let availableH = Math.max(0, limit - active.reduce((s, e) => s + e.count * perH(e.i), 0));
    let demand = 0, admitted = 0;

    configs.forEach(({ p, cohorts, commercial }, i) => {
      if (!p.enabled) return;
      let want = cohorts.filter(c => c.week === +d).reduce((s, c) => s + c.size, 0);
      if (commercial) {
        const w = Math.floor((d - commercial) / WEEK);
        const inLaunch = p.launch && w >= 0 && w < pos(p.launchWeeks);
        want += w < 0 || p.organic === false ? 0 : inLaunch ? Math.floor(pos(p.launchRate)) : organicRate(a, p, d, w - (p.launch ? pos(p.launchWeeks) : 0));
      }
      // Scénario : plus ou moins d'inscriptions que prévu (1 = le plan tel que saisi). La pub dépend du budget, pas du scénario.
      want *= vol;
      if (commercial && d >= commercial) want += adRate(p, monthKey(d));
      // Abonnées CHRYSALISS seul qui achètent ce programme (pourcentage annuel, réparti par semaine), dès son lancement.
      let fromSolo = 0;
      if (commercial && d >= commercial && pos(p.fromSolo) > 0) {
        const prev = soloStock.get(monthKey(shiftMonth(monthDate(monthKey(d)), -1))) || 0;
        fromSolo = prev * Math.min(100, pos(p.fromSolo)) / 100 / 52;
        want += fromSolo;
      }
      if (a.waitlist) want += pending[i];
      demand += want;
      const perClient = perH(i);
      const count = a.restrict && perClient > 0 ? Math.min(want, Math.floor(availableH / perClient + 1e-9)) : want;
      pending[i] = a.waitlist ? want - count : 0;
      availableH = Math.max(0, availableH - count * perClient);
      if (!count) return;

      let price = pos(phaseAt(p.pricing, monthKey(d)).price);
      const promo = (p.promos || []).find(q => monthKey(d) >= q.start && monthKey(d) <= q.end);
      if (promo) price = pos(promo.price);

      const e = { i, count, solo: want > 0 ? count * fromSolo / want : 0, end: addWeeks(d, Math.max(1, Math.floor(pos(p.duration)))) };
      // CHRYSALISS offert après le programme : la conversion en abonnée payante a lieu à la fin de l'offre.
      e.convert = addWeeks(e.end, giftWeeks(p));
      events.push(e); active.push(e);
      credit(d, (mm, share) => {
        mm.sales += count * price * share; mm.admissions += count * share;
        mm.products[i].sales += count * price * share; mm.products[i].admissions += count * share;
        mm.products[i].fromSolo += e.solo * share;
      });
      admitted += count;
    });

    const people = active.reduce((s, e) => s + e.count, 0);
    const hours = active.reduce((s, e) => s + e.count * perH(e.i), 0);
    m.active = people;
    m.products.forEach((p, i) => { p.active = active.filter(e => e.i === i).reduce((s, e) => s + e.count, 0); });
    // Clientes moyennes du mois (semaines-clientes / semaines du mois) et heures de coaching, par programme.
    if (hired) credit(d, (mm, share) => { mm.hiredHours += hired * share; });
    // Heures qui dépassent la capacité (inscriptions non refusées) : comptées à part, payées comme des heures de coach si demandé.
    const extra = Number.isFinite(limit) ? Math.max(0, hours - limit) : 0;
    if (extra) credit(d, (mm, share) => { mm.extraHours += extra * share; });
    credit(d, (mm, share) => {
      const weeksInMonth = new Date(Date.UTC(+mm.month.slice(0, 4), +mm.month.slice(5), 0)).getUTCDate() / 7;
      for (const e of active) {
        mm.products[e.i].clients += e.count * share / weeksInMonth;
        mm.products[e.i].coachHours += e.count * perH(e.i) * share;
      }
    });
    if (coaching) weekly.push({ date: d.toISOString().slice(0, 10), people, hours, own, hired, limit, demand, admitted, waiting: pending.reduce((s, x) => s + x, 0),
      progs: a.programs.map((_, i) => { const n = active.filter(e => e.i === i).reduce((s, e) => s + e.count, 0); return { people: n, hours: n * perH(i) }; }) });

    // Abonnements directs : avec une période d'essai, seule une part des essais devient payante, à la fin de l'essai.
    if (subStart && d >= subStart) {
      const trial = pos(a.sub.trialDays);
      // Rythme sans pub (essais convertis), plus les campagnes : leur coût est celui d'une abonnée payante.
      const conv = trial > 0 ? Math.min(100, pos(a.sub.trialConversion, 100)) / 100 : 1;
      const count = (a.sub.organic === false ? 0 : vol * organicRate(a, a.sub, d, Math.floor((d - subStart) / WEEK)) * conv) + adRate(a.sub, monthKey(d));
      const paid = new Date(+d + trial * DAY);
      const phase = phaseAt(a.sub.directPricing, monthKey(paid)).index;
      credit(paid, (mm, share) => { mm.newDirect[phase] += count * share; });
      if (trial > 0) credit(d, (mm, share) => { mm.trials += count / conv * share; });
    }
    // Plan avec levée : abonnées payantes apportées par la publicité, montée en charge sur quelques mois.
    const paid = a.paid;
    if (subStart && d >= subStart && paid && pos(paid.perMonth) > 0 && paid.from && d >= firstMonday(monthDate(paid.from))) {
      const since = monthsBetween(paid.from, monthKey(d)), ramp = Math.max(1, pos(paid.ramp, 1));
      const count = pos(paid.perMonth) * 12 / 52 * Math.min(1, (since + 1) / ramp);
      const phase = phaseAt(a.sub.directPricing, monthKey(d)).index;
      credit(d, (mm, share) => { mm.newDirect[phase] += count * share; mm.paidNew += count * share; });
    }
  }

  // Fins de programme. Les clientes venues de CHRYSALISS seul y sont déjà abonnées : elles ne comptent pas dans la conversion.
  // Avec CHRYSALISS offert, les autres le gardent gratuitement jusqu'à la fin de l'offre, puis une part s'abonne en payant.
  for (const e of events) {
    const fresh = e.count - e.solo;
    credit(e.end, (m, share) => {
      m.finished += e.count * share; m.products[e.i].finished += e.count * share; m.products[e.i].finishedNew += fresh * share;
    });
    credit(e.convert, (m, share) => { m.products[e.i].convertNew += fresh * share; });
    if (e.convert > e.end) {
      credit(e.end, (m, share) => { m.products[e.i].giftIn += fresh * share; });
      credit(e.convert, (m, share) => { m.products[e.i].giftOut += fresh * share; });
    }
  }

  // Stocks d'abonnées, par phase de prix d'entrée (pour garder le prix d'entrée si demandé).
  const directGrid = a.sub.directPricing, postGrid = a.sub.postPricing;
  let direct = [0, 0, 0], post = a.programs.map(() => [0, 0, 0]);
  const revenue = (stock, grid, month) => a.sub.lockPrice
    ? stock.reduce((s, v, k) => s + v * pos(grid[k]?.price), 0)
    : stock.reduce((s, v) => s + v, 0) * pos(phaseAt(grid, month).price);

  const gifted = a.programs.map(() => 0);
  for (const m of months.values()) {
    m.products.forEach((q, i) => { gifted[i] = Math.max(0, gifted[i] + q.giftIn - q.giftOut); q.gifted = gifted[i]; });
    m.gifted = gifted.reduce((t, v) => t + v, 0);
    direct = direct.map((v, k) => v * survival(a.sub.duration) + m.newDirect[k]);
    const postPhase = phaseAt(postGrid, m.month).index;
    // Après un programme, même durée d'abonnement que les abonnées de l'application.
    post = post.map((stock, i) => stock.map((v, k) => v * survival(a.sub.duration)
      + (k === postPhase ? m.products[i].convertNew * Math.min(100, pos(a.programs[i].toSolo)) / 100 : 0)));
    m.direct = direct.reduce((s, v) => s + v, 0);
    m.post = post.reduce((s, stock) => s + stock.reduce((t, v) => t + v, 0), 0);
    m.directCA = revenue(direct, directGrid, m.month);
    m.products.forEach((p, i) => { p.post = revenue(post[i], postGrid, m.month); });
    m.postCA = m.products.reduce((s, p) => s + p.post, 0);
    m.total = m.sales + m.directCA + m.postCA;
  }
  return { months: [...months.values()], weekly };
}

// Objectifs d'abonnées par paliers : pour chaque palier (au bout de X mois, N abonnées),
// le plus petit rythme hebdomadaire qui l'atteint, en simulant (durée d'abonnement et essai compris).
// Ne compte que les abonnées directes : celles qui viennent d'un programme s'ajoutent en plus.
function goalPlan(a) {
  const g = a.sub.goal || {}, start = a.sub.start;
  const steps = (g.steps || []).filter(s => pos(s.months) > 0 && pos(s.count) > 0).sort((x, y) => x.months - y.months);
  const conv = pos(a.sub.trialDays) > 0 ? Math.max(1, Math.min(100, pos(a.sub.trialConversion, 100))) / 100 : 1;
  if (!start || !steps.length) return { segs: [], steps: [] };
  const base = JSON.parse(JSON.stringify(a));
  base.programs = [];
  const stockAt = (segs, month) => {
    base.sub.palierMode = true; base.sub.paliers = segs; base.sub.target = segs[segs.length - 1].rate;
    const m = simulate(base).months.find(x => x.month === month);
    return m ? m.direct : 0;
  };
  const segs = [], out = [];
  let used = 0;
  for (const st of steps) {
    const weeks = Math.round(pos(st.months) * 52 / 12) - used;
    if (weeks <= 0) continue;
    const at = addMonths(start, Math.round(pos(st.months)));
    let rate;
    if (g.kind === 'new') rate = Math.ceil(pos(st.count) / 52 / conv - 1e-9);
    else {
      let lo = 0, hi = 1;
      while (hi < 1e6 && stockAt([...segs, { rate: hi, weeks }], at) < pos(st.count)) { lo = hi; hi *= 2; }
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (stockAt([...segs, { rate: mid, weeks }], at) >= pos(st.count)) hi = mid; else lo = mid; }
      rate = hi;
    }
    segs.push({ rate, weeks });
    used += weeks;
    out.push({ months: pos(st.months), count: pos(st.count), at, rate, paid: rate * conv, reached: g.kind === 'new' ? rate * conv * 52 : stockAt(segs.slice(), at) });
  }
  return { segs, steps: out, conv };
}

// Objectif d'inscriptions d'un programme par paliers (au bout de X mois après le lancement, N inscriptions par an).
// Les abonnées de l'abonnement seul qui achètent le programme (d'après la simulation `sim`) comptent dans l'objectif.
// Pour chaque palier : rythme direct nécessaire, clientes en même temps et heures de coaching qu'il demande.
function programGoalPlan(a, j, sim) {
  const q = a.programs[j], g = q.goal || {};
  const steps = (g.steps || []).filter(s => pos(s.months) > 0 && pos(s.count) > 0).sort((x, y) => x.months - y.months);
  if (!q.start || !steps.length) return { segs: [], steps: [] };
  const segs = [], out = [];
  let used = 0;
  for (const st of steps) {
    const weeks = Math.round(pos(st.months) * 52 / 12) - used;
    if (weeks <= 0) continue;
    const at = addMonths(q.start, Math.round(pos(st.months)));
    const m = sim.find(x => x.month === at);
    const fromSoloYear = m ? m.products[j].fromSolo * 12 : 0;
    const rate = Math.ceil(Math.max(0, pos(st.count) - fromSoloYear) / 52 - 1e-9);
    const parallel = (rate + fromSoloYear / 52) * pos(q.duration);
    const step = capacityAt(a, at);
    segs.push({ rate, weeks });
    used += weeks;
    out.push({ months: pos(st.months), count: pos(st.count), at, rate, fromSoloYear, parallel, hours: parallel * coachAt(q, at) / 60, minutes: coachAt(q, at),
      capHours: step ? pos(step.hours) : null, planYear: m ? m.products[j].admissions * 12 : 0 });
  }
  return { segs, steps: out };
}

// Objectif total d'un produit (j = null : l'abonnement) : ce qu'apportent déjà le sans pub et les passerelles,
// l'écart que la pub doit combler, et les campagnes qui le comblent, palier par palier.
// Abonnement : 'active' = abonnées en même temps, 'new' = nouvelles abonnées par an. Programme : inscriptions par an.
function pubGap(a, j) {
  const q = j === null ? a.sub : a.programs[j], g = q.goal || {}, start = q.start;
  const kind = j === null ? (g.kind === 'new' ? 'new' : 'active') : 'year';
  const steps = (g.steps || []).filter(s => +s.months > 0 && +s.count > 0).map(s => ({ at: addMonths(start, Math.round(+s.months)), count: +s.count })).sort((x, y) => x.at.localeCompare(y.at));
  if (!start || !steps.length) return null;
  const lastCac = (q.campaigns || []).map(c => +c.cac).filter(c => c > 0).at(-1);
  const cac = pos(g.cac) || lastCac || 50;
  const copy = JSON.parse(JSON.stringify(a)), cq = j === null ? copy.sub : copy.programs[j];
  const value = (sim, at) => { const m = sim.months.find(x => x.month === at); if (!m) return 0;
    return kind === 'active' ? m.direct + m.post : kind === 'new' ? m.newDirect.reduce((t, v) => t + v, 0) * 12 : m.products[j].admissions * 12; };
  const span = (u, w) => monthsBetween(u, w) + 1;
  const s = survival(a.sub.duration);
  const toCampaign = sg => ({ start: sg.start, end: sg.end, budget: Math.round(sg.perMonth * cac), cac });
  cq.campaigns = [];
  const base = simulate(copy), segs = [];
  let prev = start;
  for (const st of steps) {
    if (st.at < prev) continue;
    const sg = { start: prev, end: st.at, perMonth: 0, at: st.at, count: st.count };
    const run = () => { cq.campaigns = [...segs, sg].map(toCampaign).filter(c => c.budget > 0); return value(simulate(copy), st.at); };
    if (kind === 'active') {
      // Une abonnée de plus par mois pendant L mois en laisse 1 + s + s² + … à la fin, à cause des résiliations.
      const L = span(prev, st.at), keep = s < 1 ? (1 - Math.pow(s, L)) / (1 - s) : L;
      for (let it = 0; it < 3; it++) sg.perMonth = Math.max(0, sg.perMonth + (st.count - run()) / keep / (1 + pos(q.viral) / 100));
    } else for (let it = 0; it < 3; it++) sg.perMonth = Math.max(0, sg.perMonth + (st.count - run()) / 12 / (1 + pos(q.viral) / 100));
    sg.free = value(base, st.at);
    segs.push(sg); prev = addMonths(st.at, 1);
  }
  if (segs.length) segs.at(-1).end = '';
  cq.campaigns = segs.map(toCampaign).filter(c => c.budget > 0);
  const planned = simulate(copy), now = simulate(a);
  segs.forEach(sg => { sg.reached = value(planned, sg.at); sg.current = value(now, sg.at); sg.budget = Math.round(sg.perMonth * cac); });
  return { kind, cac, segs, campaigns: cq.campaigns };
}

if (typeof module !== 'undefined') module.exports = { simulate, adRate, weeklyRate, pointsAt, audienceSeries, audienceAt, audienceBuyers, weekShares, goalPlan, programGoalPlan, pubGap };
