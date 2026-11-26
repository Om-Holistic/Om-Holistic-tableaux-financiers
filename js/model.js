'use strict';
// Modèle de données : valeurs par défaut, grilles de prix en 3 phases et
// migration des anciennes sauvegardes (format v1 sans grilles de prix).

const STORAGE_KEY = 'om-finance-v1';
const PHASE_LABELS = ['Phase 1', 'Phase 2', 'Phase 3'];

// Ajoute k mois à une clé "AAAA-MM".
function addMonths(month, k) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + k, 1));
  return d.toISOString().slice(0, 7);
}

// Grille de prix : trois phases, chacune avec un nom, un mois de début et un prix.
function pricing(start, prices, gaps = [0, 2, 5]) {
  return prices.map((price, i) => ({ label: PHASE_LABELS[i], start: addMonths(start, gaps[i]), price }));
}

// Phases utilisables, triées par date de début (une phase sans date est ignorée).
function phasesOf(grid) {
  return (grid || []).map((p, index) => ({ ...p, index })).filter(p => p.start).sort((a, b) => a.start.localeCompare(b.start));
}

// Phase en vigueur pour un mois donné. Avant la première phase, on applique la première.
function phaseAt(grid, month) {
  const phases = phasesOf(grid);
  if (!phases.length) return { index: 0, price: 0, label: '' };
  let current = phases[0];
  for (const p of phases) if (p.start <= month) current = p;
  return current;
}

const newId = () => Math.random().toString(36).slice(2, 9);

function program(name, start, prices, duration) {
  return {
    id: newId(), name, start, enabled: true, duration, coach: 20,
    pricing: pricing(start, prices),
    // Cohortes de test avant le lancement commercial (start) : nom, mois, nombre de clientes.
    cohorts: [],
    launch: true, launchWeeks: 12, launchRate: 2,
    initial: 2, target: 5, months: 24, step: 1,
    palierMode: false, paliers: [], promos: []
  };
}

function application(name) {
  return {
    name, restrict: false, waitlist: false,
    // Montée en puissance du coaching : à partir de tel mois, tant de clientes en même temps et tant d'heures par semaine.
    capacitySteps: [], coachRate: 0, charges: [],
    sub: {
      lockPrice: true,
      postPricing: pricing('2027-01', [9.99, 9.99, 9.99]),
      conversion: 40, postDuration: 12,
      directPricing: pricing('2027-01', [9.99, 9.99, 9.99]),
      start: '2027-01', initial: 1, target: 3, months: 24, step: 1, duration: 12
    },
    programs: []
  };
}

// Une charge : fixe (€ / mois), cliente (€ / mois par cliente), inscription (€ par inscription)
// ou ca (% du chiffre d'affaires). scope : 'app' (commune), 'sub' (abonnement) ou l'id d'un programme.
function charge(name, type, amount, scope = 'app', start = '', end = '') {
  return { id: newId(), name, type, amount, scope, start, end };
}

// Calendrier d'exemple : cohorte alpha, deuxième cohorte, puis lancement commercial.
function chrysalisApp() {
  const a = application('Chrysalis');
  const refit = program('Refit', '2027-07', [60, 150, 250], 12);
  refit.cohorts = [{ name: 'Cohorte alpha', date: '2027-01', size: 8 }, { name: 'Deuxième cohorte', date: '2027-04', size: 15 }];
  refit.pricing = [{ label: 'Phase 1', start: '2027-01', price: 60 }, { label: 'Phase 2', start: '2027-07', price: 150 }, { label: 'Phase 3', start: '2027-10', price: 250 }];
  a.programs = [refit, program('Better Sleep', '2027-10', [60, 100, 150], 8), program('Calm Inside', '2028-01', [60, 100, 150], 8)];
  a.capacitySteps = [{ date: '2027-01', capacity: 10, hours: 8 }, { date: '2027-07', capacity: 25, hours: 20 }, { date: '2028-01', capacity: 40, hours: 35 }];
  a.sub.start = '2027-07';
  a.sub.directPricing = pricing('2027-07', [9.9, 9.9, 9.9]);
  a.sub.postPricing = pricing('2027-07', [9.9, 9.9, 9.9]);
  a.charges = exampleCharges(a);
  return a;
}

function exampleCharges(a) {
  const refit = a.programs.find(p => /refit/i.test(p.name));
  return [
    charge('Hébergement et base de données (exemple)', 'fixe', 30),
    charge('Bibliothèque d\'exercices YMove', 'fixe', 29, refit ? refit.id : 'app'),
    charge('IA et envois d\'e-mails (exemple)', 'cliente', 0.5),
    charge('Frais de paiement Stripe (exemple)', 'ca', 2)
  ];
}

// Applications en cours de développement : abonnement seul, valeurs d'exemple à ajuster.
function smallApp(name, start, prices) {
  const a = application(name);
  a.sub.start = start;
  a.sub.directPricing = pricing(start, prices);
  a.sub.directPricing[0].label = 'Lancement';
  a.sub.initial = 2; a.sub.target = 10; a.sub.duration = 8;
  a.charges = [charge('Hébergement (exemple)', 'fixe', 15), charge('Frais de paiement (exemple)', 'ca', 2)];
  return a;
}

function defaultShared() {
  return { key: 'ca', charges: [charge('Expert-comptable (exemple)', 'fixe', 100), charge('Banque et assurance (exemple)', 'fixe', 40)] };
}

function defaultState() {
  return {
    version: 5,
    vat: { ttc: false, rate: 20 },
    shared: defaultShared(),
    apps: [chrysalisApp(), smallApp('Bujo', '2027-06', [9.9, 9.9, 9.9]), smallApp('Doodle Studio', '2027-09', [9.9, 9.9, 9.9])]
  };
}

// Premier mois simulé : la plus ancienne date de cohorte, de lancement ou d'abonnement.
function appStart(a) {
  const dates = [a.sub?.start, ...a.programs.flatMap(p => [p.start, ...(p.cohorts || []).map(c => c.date)])].filter(Boolean).sort();
  return dates[0] || new Date().toISOString().slice(0, 7);
}

// Palier de capacité en vigueur pour un mois (le premier palier s'applique avant sa date). null si aucun palier.
function capacityAt(a, month) {
  const steps = (a.capacitySteps || []).filter(c => c.date).sort((x, y) => x.date.localeCompare(y.date));
  if (!steps.length) return null;
  let cur = steps[0];
  for (const c of steps) if (c.date <= month) cur = c;
  return cur;
}

// Convertit une sauvegarde v1 (betaPrice / launchPrice / price) en grilles de prix.
// La phase 1 reprend le tarif bêta, la phase 2 le tarif de lancement, la phase 3 le tarif standard.
function migrate(state) {
  for (const a of state.apps) {
    const s = a.sub = a.sub || {};
    if (!s.postPricing) s.postPricing = pricing(s.start || a.start, [s.price, s.price, s.price].map(x => x ?? 9.99));
    if (!s.directPricing) s.directPricing = pricing(s.start || a.start, [s.directPrice, s.directPrice, s.directPrice].map(x => x ?? 9.99));
    if (s.lockPrice === undefined) s.lockPrice = true;
    delete s.price; delete s.directPrice;
    for (const p of a.programs) {
      p.paliers = p.paliers || []; p.promos = p.promos || [];
      if (!p.pricing) {
        const launchEnd = addMonths(p.start, Math.round((+p.launchWeeks || 0) * 12 / 52));
        p.pricing = [
          { label: PHASE_LABELS[0], start: p.beta ? p.betaStart : '', price: p.betaPrice ?? p.price },
          { label: PHASE_LABELS[1], start: p.launch ? p.start : '', price: p.launchPrice ?? p.price },
          { label: PHASE_LABELS[2], start: p.launch ? launchEnd : p.start, price: p.price }
        ];
      }
      delete p.betaPrice; delete p.launchPrice; delete p.price;
      if (!p.id) p.id = newId();
      // Version 5 : les cohortes bêta régulières deviennent une liste de cohortes nommées.
      if (!Array.isArray(p.cohorts)) {
        p.cohorts = [];
        if (p.beta && p.betaStart) {
          const n = Math.min(12, Math.floor(+p.betaCount || 0)), every = Math.max(1, Math.floor(+p.betaInterval || 1));
          for (let i = 0; i < n; i++) p.cohorts.push({ name: i === 0 ? 'Cohorte alpha' : 'Cohorte ' + (i + 1), date: addMonths(p.betaStart, i * every), size: +p.betaSize || 0 });
        }
      }
      ['beta', 'betaStart', 'betaCount', 'betaSize', 'betaInterval'].forEach(k => delete p[k]);
    }
    // Version 3 : charges détaillées. L'ancien montant mensuel unique devient une charge fixe commune.
    if (!Array.isArray(a.charges)) {
      a.charges = +a.cost > 0 ? [charge('Charges mensuelles', 'fixe', +a.cost)] : exampleCharges(a);
    }
    delete a.cost;
    // Version 5 : capacité unique + évolutions → paliers de montée en puissance.
    if (!Array.isArray(a.capacitySteps)) {
      a.capacitySteps = a.programs.length && a.capacity !== undefined
        ? [{ date: a.start || appStart(a), capacity: +a.capacity || 0, hours: +a.hours || 0 }, ...(a.capacityChanges || []).map(c => ({ date: c.date, capacity: +c.capacity || 0, hours: +a.hours || 0 }))]
        : [];
    }
    ['start', 'capacity', 'hours', 'capacityChanges'].forEach(k => delete a[k]);
    if (a.coachRate === undefined) a.coachRate = 0;
  }
  if (!state.shared) state.shared = defaultShared();
  if (!state.vat) state.vat = { ttc: false, rate: 20 };
  // Bujo et Doodle Studio sont ajoutées une fois, avec des valeurs d'exemple.
  if ((state.version || 1) < 3) {
    if (!state.apps.some(a => /bujo/i.test(a.name))) state.apps.push(smallApp('Bujo', '2027-06', [9.9, 9.9, 9.9]));
    if (!state.apps.some(a => /doodle|doddle/i.test(a.name))) state.apps.push(smallApp('Doodle Studio', '2027-09', [9.9, 9.9, 9.9]));
  }
  // Version 4 : Bujo et Doodle Studio passent à 9,90 € / mois (prix annoncé), si leurs prix d'exemple n'ont pas été modifiés.
  if ((state.version || 1) < 4) {
    for (const a of state.apps) {
      const g = a.sub.directPricing;
      if (/bujo|doodle/i.test(a.name) && g.map(x => x.price).join() === '2.99,3.99,4.99') {
        g.forEach(x => { x.price = 9.9; }); g[0].label = 'Lancement';
      }
    }
  }
  state.version = 5;
  return state;
}

function isValidState(x) {
  return x && Array.isArray(x.apps) && x.apps.length > 0 && x.apps.every(a => a && a.sub && Array.isArray(a.programs));
}

if (typeof module !== 'undefined') module.exports = { appStart, capacityAt, addMonths, pricing, phasesOf, phaseAt, program, application, charge, smallApp, defaultState, migrate, isValidState, STORAGE_KEY };
