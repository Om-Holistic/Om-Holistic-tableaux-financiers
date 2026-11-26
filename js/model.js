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

function program(name, start, prices, duration) {
  return {
    name, start, enabled: true, duration, coach: 20,
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
    capacityChanges: [], cost: 0,
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

function defaultState() {
  const chrysalis = application('Chrysalis');
  chrysalis.programs = [
    program('Refit', '2026-11', [60, 150, 250], 12),
    program('Better Sleep', '2027-05', [60, 100, 150], 8),
    program('Calm Inside', '2027-08', [60, 100, 150], 8)
  ];
  return { version: 2, apps: [chrysalis] };
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
    }
  }
  state.version = 2;
  return state;
}

function isValidState(x) {
  return x && Array.isArray(x.apps) && x.apps.length > 0 && x.apps.every(a => a && a.sub && Array.isArray(a.programs));
}

if (typeof module !== 'undefined') module.exports = { addMonths, pricing, phasesOf, phaseAt, program, application, defaultState, migrate, isValidState, STORAGE_KEY };
