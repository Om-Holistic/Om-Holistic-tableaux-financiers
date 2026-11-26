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
    beta: false, betaStart: start, betaCount: 1, betaSize: 10, betaInterval: 1,
    launch: true, launchWeeks: 12, launchRate: 2,
    initial: 2, target: 5, months: 24, step: 1,
    palierMode: false, paliers: [], promos: []
  };
}

function application(name) {
  return {
    name, start: '2026-11', capacity: 40, hours: 35, restrict: false, waitlist: false,
    capacityChanges: [], coachRate: 0, charges: [],
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

function chrysalisApp() {
  const a = application('Chrysalis');
  a.programs = [
    program('Refit', '2026-11', [60, 150, 250], 12),
    program('Better Sleep', '2027-05', [60, 100, 150], 8),
    program('Calm Inside', '2027-08', [60, 100, 150], 8)
  ];
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
  a.start = start; a.capacity = 0; a.hours = 0;
  a.sub.start = start;
  a.sub.directPricing = pricing(start, prices);
  a.sub.initial = 2; a.sub.target = 10; a.sub.duration = 8;
  a.charges = [charge('Hébergement (exemple)', 'fixe', 15), charge('Frais de paiement (exemple)', 'ca', 2)];
  return a;
}

function defaultShared() {
  return { key: 'ca', charges: [charge('Expert-comptable (exemple)', 'fixe', 100), charge('Banque et assurance (exemple)', 'fixe', 40)] };
}

function defaultState() {
  return {
    version: 3,
    vat: { ttc: false, rate: 20 },
    shared: defaultShared(),
    apps: [chrysalisApp(), smallApp('Bujo', '2027-06', [2.99, 3.99, 4.99]), smallApp('Doodle Studio', '2027-09', [2.99, 3.99, 4.99])]
  };
}

// Convertit une sauvegarde v1 (betaPrice / launchPrice / price) en grilles de prix.
// La phase 1 reprend le tarif bêta, la phase 2 le tarif de lancement, la phase 3 le tarif standard.
function migrate(state) {
  for (const a of state.apps) {
    a.capacityChanges = a.capacityChanges || [];
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
    }
    // Version 3 : charges détaillées. L'ancien montant mensuel unique devient une charge fixe commune.
    if (!Array.isArray(a.charges)) {
      a.charges = +a.cost > 0 ? [charge('Charges mensuelles', 'fixe', +a.cost)] : exampleCharges(a);
    }
    delete a.cost;
    if (a.coachRate === undefined) a.coachRate = 0;
  }
  if (!state.shared) state.shared = defaultShared();
  if (!state.vat) state.vat = { ttc: false, rate: 20 };
  // Bujo et Doodle Studio sont ajoutées une fois, avec des valeurs d'exemple.
  if ((state.version || 1) < 3) {
    if (!state.apps.some(a => /bujo/i.test(a.name))) state.apps.push(smallApp('Bujo', '2027-06', [2.99, 3.99, 4.99]));
    if (!state.apps.some(a => /doodle|doddle/i.test(a.name))) state.apps.push(smallApp('Doodle Studio', '2027-09', [2.99, 3.99, 4.99]));
  }
  state.version = 3;
  return state;
}

function isValidState(x) {
  return x && Array.isArray(x.apps) && x.apps.length > 0 && x.apps.every(a => a && a.sub && Array.isArray(a.programs));
}

if (typeof module !== 'undefined') module.exports = { addMonths, pricing, phasesOf, phaseAt, program, application, charge, smallApp, defaultState, migrate, isValidState, STORAGE_KEY };
