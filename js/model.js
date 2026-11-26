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
    id: newId(), name, start, enabled: true, duration, coach: 20, coachSteps: [],
    pricing: pricing(start, prices),
    // Cohortes de test avant le lancement commercial (start) : nom, mois, nombre de clientes.
    cohorts: [],
    // Passerelles avec l'abonnement seul : % des clientes qui le gardent en fin de programme,
    // % des abonnées qui achètent ce programme chaque mois.
    toSolo: 40, fromSolo: 0,
    launch: true, launchWeeks: 12, launchRate: 2,
    initial: 2, target: 5, months: 24, step: 1,
    palierMode: false, paliers: [], promos: [], goal: defaultProgramGoal(), acq: 0
  };
}

function application(name) {
  return {
    name, restrict: false, waitlist: false, payMissing: true,
    // Canaux de vente : part du chiffre d'affaires encaissée par l'App Store / Google Play et leur commission.
    channels: { store: 0, storeRate: 15 },
    // Montée en puissance du coaching : à partir de tel mois, tant de clientes en même temps et tant d'heures par semaine.
    capacitySteps: [], coachRate: 0, charges: [],
    sub: {
      lockPrice: true,
      postPricing: pricing('2027-01', [9.99, 9.99, 9.99]),
      postDuration: 12,
      trialDays: 0, trialConversion: 100, goal: defaultGoal(), palierMode: false, paliers: [], acq: 0,
      directPricing: pricing('2027-01', [9.99, 9.99, 9.99]),
      start: '2027-01', initial: 1, target: 3, months: 24, step: 1, duration: 12
    },
    programs: []
  };
}

// Une charge : fixe (€ / mois), cliente (€ / mois par cliente), inscription (€ par inscription)
// ou ca (% du chiffre d'affaires). scope : 'app' (commune), 'sub' (abonnement) ou l'id d'un programme.
// Catégories de charges, regroupées comme dans un compte d'exploitation classique.
const CHARGE_CATEGORIES = [
  ['tech', 'Hébergement et services techniques'],
  ['contenu', 'Contenus et licences'],
  ['logiciels', 'Logiciels et abonnements'],
  ['paiement', 'Frais de paiement'],
  ['marketing', 'Publicité et communication'],
  ['honoraires', 'Honoraires, juridique et administratif'],
  ['banque', 'Banque et assurances'],
  ['locaux', 'Loyer et locaux'],
  ['impots', 'Impôts et taxes'],
  ['coaching', 'Coaching (sous-traitance ou salaires)'],
  ['personnel', 'Personnel et rémunération'],
  ['autre', 'Autres charges']
];
// Repère de démarrage d'une charge : elle suit le calendrier quand une date change.
const CHARGE_ANCHORS = [
  ['first', 'Début des prévisions (première cohorte)'],
  ['product', 'Démarrage du produit rattaché'],
  ['launch', 'Lancement commercial'],
  ['sub', 'Ouverture des abonnements'],
  ['date', 'Date précise']
];

// Une charge : catégorie, type, montant, rattachement, démarrage (repère + décalage, ou date), fin,
// paliers de montée en charge (au bout de X mois, nouveau montant), estimation ou montant confirmé.
function charge(name, type, amount, scope = 'app', start = '', end = '', more = {}) {
  return { id: newId(), name, category: 'autre', type, amount, scope, anchor: 'date', offset: 0, start, end, steps: [], estimate: true, note: '', ...more };
}
const ch = (name, category, type, amount, more = {}) => charge(name, type, amount, more.scope || 'app', '', '', { category, anchor: 'first', ...more });

// Dates repères d'une application (ou de toutes, pour les charges de structure).
function appDates(apps) {
  const min = xs => xs.filter(Boolean).sort()[0] || '';
  return {
    first: min(apps.map(appStart)),
    launch: min(apps.flatMap(a => [a.sub?.start, ...a.programs.map(p => p.start)])),
    sub: min(apps.map(a => a.sub?.start)),
    product: (scope) => {
      for (const a of apps) {
        if (scope === 'sub') return a.sub?.start || '';
        const p = a.programs.find(q => q.id === scope);
        if (p) return min([p.start, ...(p.cohorts || []).map(c => c.date)]);
      }
      return min(apps.map(appStart));
    }
  };
}
// Premier mois d'une charge ('' = dès le début).
function chargeStart(c, dates) {
  if (!c.anchor || c.anchor === 'date') return c.start || '';
  const base = c.anchor === 'product' ? dates.product(c.scope) : dates[c.anchor];
  return base ? addMonths(base, Math.round(+c.offset || 0)) : '';
}
const monthsFrom = (from, to) => { const [y1, m1] = from.split('-').map(Number), [y2, m2] = to.split('-').map(Number); return (y2 - y1) * 12 + m2 - m1; };
// Montant d'une charge pour un mois, ou null si elle ne s'applique pas ce mois-là.
function chargeAt(c, month, dates) {
  const start = chargeStart(c, dates);
  if (c.type === 'unique') return (start || dates.first) === month ? Math.max(0, +c.amount || 0) : null;
  if ((start && month < start) || (c.end && month > c.end)) return null;
  let amount = Math.max(0, +c.amount || 0);
  if (start) for (const st of [...(c.steps || [])].sort((x, y) => x.after - y.after)) if (monthsFrom(start, month) >= +st.after) amount = Math.max(0, +st.amount || 0);
  return amount;
}

// Calendrier d'exemple : cohorte alpha, deuxième cohorte, puis lancement commercial.
function chrysalisApp() {
  const a = application('CHRYSALISS');
  const refit = program('Refit', '2027-07', [60, 150, 250], 12);
  refit.cohorts = [{ name: 'Cohorte alpha', date: '2027-01', size: 8 }, { name: 'Deuxième cohorte', date: '2027-04', size: 15 }];
  refit.pricing = [{ label: 'Phase 1', start: '2027-01', price: 60 }, { label: 'Phase 2', start: '2027-07', price: 150 }, { label: 'Phase 3', start: '2027-10', price: 250 }];
  a.programs = [refit, program('Better Sleep', '2027-10', [60, 100, 150], 8), program('Calm Inside', '2028-01', [60, 100, 150], 8)];
  a.coachRate = 35;
  a.capacitySteps = [{ date: '2027-01', hours: 5, hired: 0 }, { date: '2027-07', hours: 10, hired: 0 }, { date: '2028-01', hours: 15, hired: 10 }];
  a.sub.start = '2027-07';
  a.sub.directPricing = pricing('2027-07', [9.9, 9.9, 9.9]);
  a.sub.postPricing = pricing('2027-07', [9.9, 9.9, 9.9]);
  a.charges = exampleCharges(a);
  return a;
}

// Charges estimées de CHRYSALISS : montants indicatifs, à confirmer (« estimation » tant que non confirmés).
function exampleCharges(a) {
  const refit = a.programs.find(p => /refit/i.test(p.name));
  const sleep = a.programs.find(p => /sleep/i.test(p.name));
  const calm = a.programs.find(p => /calm/i.test(p.name));
  return [
    ch('Hébergement de l\'application (Fly.io)', 'tech', 'fixe', 10, { steps: [{ after: 6, amount: 30 }, { after: 18, amount: 60 }], note: 'Petites machines pendant les tests, puis plus de puissance au lancement et avec la croissance.' }),
    ch('Base de données et sauvegardes', 'tech', 'fixe', 5, { steps: [{ after: 6, amount: 15 }, { after: 18, amount: 30 }], note: 'Base gérée et copies de sauvegarde quotidiennes hors de Fly.io.' }),
    ch('E-mails transactionnels (Resend, Postmark…)', 'tech', 'fixe', 20, { anchor: 'launch', note: 'Offre gratuite suffisante pendant les tests.' }),
    ch('Suivi des erreurs et disponibilité (Sentry…)', 'tech', 'fixe', 26, { anchor: 'launch', offset: 6, note: 'Offre gratuite au début, offre payante quand le trafic monte.' }),
    ch('Comptes utilisatrices (Clerk)', 'tech', 'fixe', 25, { anchor: 'launch', offset: 12, note: 'Gratuit jusqu\'à 10 000 utilisatrices actives par mois, offre Pro ensuite.' }),
    ch('Intelligence artificielle (OpenAI)', 'tech', 'cliente', 0.5, { note: 'Coût par cliente active et par mois, selon l\'usage des fonctions IA.' }),
    ch('Bibliothèque d\'exercices YMove', 'contenu', 'fixe', 29, { scope: refit ? refit.id : 'app', anchor: refit ? 'product' : 'first', estimate: false, note: 'Montant confirmé.' }),
    ch('Bibliothèque d\'exercices MuscleWiki', 'contenu', 'fixe', 11, { scope: refit ? refit.id : 'app', anchor: refit ? 'product' : 'first', note: '12 $ / mois, relevé dans le code de CHRYSALISS.' }),
    ...(sleep || calm ? [ch('Musiques et sons sous licence', 'contenu', 'fixe', 15, { scope: (sleep || calm).id, anchor: 'product', note: 'Pour les séances audio (sommeil, relaxation).' })] : []),
    ch('Commission Stripe', 'paiement', 'ca', 1.5, { note: 'Cartes européennes : 1,5 % + 0,25 € par paiement.' }),
    ch('Frais fixes Stripe par abonnement', 'paiement', 'cliente', 0.25, { scope: 'sub', note: '0,25 € par prélèvement mensuel.' }),
    ch('Frais fixes Stripe par inscription', 'paiement', 'inscription', 0.25, { note: '0,25 € par paiement de programme.' }),
    ch('Publicité en ligne (Meta, Google…)', 'marketing', 'fixe', 300, { anchor: 'launch', steps: [{ after: 6, amount: 600 }, { after: 18, amount: 1000 }], note: 'Budget à piloter : il conditionne le rythme d\'inscriptions.' }),
    ch('Newsletter et e-mailing (Brevo…)', 'marketing', 'fixe', 9, { anchor: 'launch', steps: [{ after: 12, amount: 25 }] }),
    ch('Outils de création (Canva Pro…)', 'logiciels', 'fixe', 12),
    ch('CGV, CGU et RGPD (juriste)', 'honoraires', 'unique', 600, { anchor: 'launch', note: 'Rédaction ou relecture avant la vente au public.' }),
    ch('Dépôt de la marque CHRYSALISS (INPI)', 'honoraires', 'unique', 190, { note: '190 € pour une classe, 40 € par classe en plus. À supprimer si déjà fait.' })
  ];
}
// Charges estimées d'une petite application (abonnement seul).
function smallAppCharges(name) {
  return [
    ch('Hébergement de l\'application (Fly.io)', 'tech', 'fixe', 5, { steps: [{ after: 6, amount: 15 }, { after: 18, amount: 30 }] }),
    ch('Base de données et sauvegardes', 'tech', 'fixe', 3, { steps: [{ after: 12, amount: 10 }] }),
    ch('E-mails transactionnels', 'tech', 'fixe', 10, { offset: 6 }),
    ch('Commission Stripe', 'paiement', 'ca', 1.5, { note: 'Cartes européennes : 1,5 % + 0,25 € par paiement.' }),
    ch('Frais fixes Stripe par abonnement', 'paiement', 'cliente', 0.25, { scope: 'sub' }),
    ch('Publicité en ligne', 'marketing', 'fixe', 100, { steps: [{ after: 6, amount: 200 }] }),
    ch(`Dépôt de la marque ${name} (INPI)`, 'honoraires', 'unique', 190, { note: 'À supprimer si déjà fait.' })
  ];
}

// Applications en cours de développement : abonnement seul, valeurs d'exemple à ajuster.
function smallApp(name, start, prices) {
  const a = application(name);
  a.sub.start = start;
  a.sub.directPricing = pricing(start, prices);
  a.sub.directPricing[0].label = 'Lancement';
  a.sub.initial = 2; a.sub.target = 10; a.sub.duration = 8;
  a.charges = smallAppCharges(name);
  return a;
}

function defaultShared() {
  return { key: 'ca', charges: [
    ch('Banque professionnelle', 'banque', 'fixe', 10),
    ch('Assurance responsabilité civile professionnelle', 'banque', 'fixe', 25),
    ch('Logiciel de comptabilité et facturation', 'logiciels', 'fixe', 15, { note: 'Tu tiens ta comptabilité toi-même : pas d\'expert-comptable.' }),
    ch('GitHub et outils de développement (IA de code…)', 'logiciels', 'fixe', 25),
    ch('Noms de domaine', 'tech', 'fixe', 3, { note: 'Environ 12 € par an et par domaine.' }),
    ch('Messagerie professionnelle (Google Workspace…)', 'logiciels', 'fixe', 7),
    ch('Site vitrine Om Holistic', 'marketing', 'fixe', 15),
    ch('Téléphone et internet (part professionnelle)', 'autre', 'fixe', 20),
    ch('Comptes développeur Apple et Google', 'honoraires', 'fixe', 9, { anchor: 'launch', note: '99 € par an chez Apple (+ 25 € une fois chez Google). À supprimer si les apps restent sur le web.' }),
    ch('Loyer et charges d\'un bureau', 'locaux', 'fixe', 0, { note: 'À compléter si tu quittes le travail à domicile : indique le mois de début.' }),
    ch('Salaire d\'une embauche (assistante, développeur…)', 'personnel', 'fixe', 0, { note: 'À compléter : coût total employeur par mois. Le coaching sous-traité se règle avec le coût horaire du coaching.' }),
    ch('Rémunération du dirigeant', 'personnel', 'fixe', 0, { note: 'À compléter selon ce que tu veux te verser. Les cotisations dépendent de l\'implantation.' }),
    ch('Formation et veille', 'autre', 'fixe', 0, { note: 'À compléter.' }),
    ch('Cotisation foncière des entreprises (CFE)', 'impots', 'fixe', 25, { offset: 12, note: 'Exonérée l\'année de création, environ 300 € par an ensuite selon la commune.' })
  ] };
}

// Implantations possibles de la société : chaque scénario a ses frais, cotisations et impôts.
// Taux INDICATIFS, à faire valider par un conseiller : ils servent à comparer, pas à déclarer.
function defaultImplantation() {
  const sc = (id, name, o) => ({ id, name, fixedYear: 0, socialRate: 0, socialBase: 'result', taxRate: 0, taxBase: 'result', distRate: 0, note: '', ...o });
  return { current: 'fr-micro', scenarios: [
    sc('fr-micro', 'France · micro-entreprise', { caLimit: 77700, socialRate: 21.2, socialBase: 'ca', taxRate: 1.7, taxBase: 'ca',
      note: 'Cotisations et impôt (versement libératoire) calculés sur le chiffre d\'affaires, sans déduire les charges. Plafond d\'environ 77 700 € de CA par an pour les services. Taux à vérifier selon l\'activité.' }),
    sc('fr-sasu', 'France · SASU à l\'impôt sur les sociétés', { taxRate: 15, distRate: 30,
      note: 'Impôt sur les sociétés à 15 % jusqu\'à 42 500 € de bénéfice (25 % au-delà), puis prélèvement forfaitaire de 30 % sur les dividendes versés. Sans salaire de la dirigeante.' }),
    sc('llc-fr', 'LLC Wyoming · tu vis en France', { fixedYear: 700, socialRate: 40, taxRate: 11,
      note: 'Une LLC à associée unique est en général transparente : le bénéfice est imposé en France, avec cotisations sociales. Frais : rapport annuel et agent enregistré au Wyoming, déclaration américaine (formulaire 5472). Risque de requalification : à valider absolument.' }),
    sc('llc-bz', 'LLC Wyoming · tu vis au Belize', { fixedYear: 700,
      note: 'Fiscalité souvent présentée comme territoriale : à faire confirmer, ainsi que le coût de la résidence et ce qui reste dû en France (clientes françaises, TVA européenne).' }),
    sc('llc-do', 'LLC Wyoming · tu vis en République dominicaine', { fixedYear: 700,
      note: 'Imposition des revenus étrangers à faire confirmer (règles spécifiques après 3 ans de résidence). Coût de la résidence à ajouter.' })
  ] };
}

function defaultState() {
  return {
    version: 13,
    vat: { ttc: false, rate: 20 },
    shared: defaultShared(),
    implantation: defaultImplantation(),
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

// Temps de coaching par cliente (minutes / semaine) en vigueur pour un mois :
// la valeur de base du programme, puis chaque baisse (ou hausse) datée à partir de son mois.
function coachAt(p, month) {
  let min = +p.coach || 0;
  const steps = (p.coachSteps || []).filter(c => c.date).sort((x, y) => x.date.localeCompare(y.date));
  for (const c of steps) if (c.date <= month) min = +c.minutes || 0;
  return Math.max(0, min);
}

// Convertit une sauvegarde v1 (betaPrice / launchPrice / price) en grilles de prix.
// La phase 1 reprend le tarif bêta, la phase 2 le tarif de lancement, la phase 3 le tarif standard.
// Objectif d'abonnées par défaut : trois paliers (6 mois, 1 an, 2 ans).
function defaultGoal() {
  return { kind: 'active', steps: [{ months: 6, count: 100 }, { months: 12, count: 300 }, { months: 24, count: 1000 }] };
}

// Objectif d'inscriptions par défaut d'un programme : 1 an puis 2 ans après le lancement.
function defaultProgramGoal() {
  return { steps: [{ months: 12, count: 150 }, { months: 24, count: 300 }] };
}

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
  // Version 6 : le nom s'écrit CHRYSALISS, en majuscules avec deux S.
  for (const a of state.apps) if (/^chrysal+is+$/i.test(a.name.trim())) a.name = 'CHRYSALISS';
  // Version 7 : conversion vers l'abonnement par programme, période d'essai.
  if ((state.version || 1) < 7) {
    for (const a of state.apps) {
      const conv = a.sub.conversion ?? 40;
      for (const p of a.programs) { if (p.toSolo === undefined) p.toSolo = conv; if (p.fromSolo === undefined) p.fromSolo = 0; }
      delete a.sub.conversion;
      if (a.sub.trialDays === undefined) { a.sub.trialDays = 0; a.sub.trialConversion = 100; }
    }
  }
  // Objectif d'abonnées (ajouté sans changer de version : simple valeur par défaut).
  for (const a of state.apps) {
    const g = a.sub.goal;
    if (!g) a.sub.goal = defaultGoal();
    else if (!g.steps) { g.steps = g.months > 12 ? [...defaultGoal().steps.filter(s => s.months < g.months), { months: g.months, count: g.count }] : [{ months: g.months, count: g.count }]; delete g.months; delete g.count; }
    if (!a.sub.paliers) { a.sub.paliers = []; a.sub.palierMode = false; }
    for (const p of a.programs) if (!p.goal) p.goal = defaultProgramGoal();
  }
  // Version 8 : catégories, démarrage relatif au calendrier, paliers. Les anciennes charges d'exemple sont remplacées.
  if ((state.version || 1) < 8) {
    const OLD = /\(exemple\)$|^Bibliothèque d'exercices YMove$/;
    for (const a of state.apps) {
      const onlyExamples = (a.charges || []).every(c => OLD.test(c.name));
      if (onlyExamples) a.charges = /^chrysal+is+$/i.test(a.name) ? exampleCharges(a) : smallAppCharges(a.name);
    }
    if (state.shared && state.shared.charges.every(c => OLD.test(c.name))) state.shared.charges = defaultShared().charges;
  }
  for (const c of [...state.apps.flatMap(a => a.charges || []), ...(state.shared?.charges || [])]) {
    if (!c.category) c.category = 'autre';
    if (!c.anchor) { c.anchor = 'date'; c.offset = 0; }
    if (!c.steps) c.steps = [];
    if (c.estimate === undefined) c.estimate = true;
    if (c.note === undefined) c.note = '';
    if (!c.type) c.type = 'fixe';
  }
  if (!state.implantation) state.implantation = defaultImplantation();
  // Version 9 : passerelle abonnement → programme exprimée en % par an (au lieu de % par mois).
  if ((state.version || 1) < 9) for (const a of state.apps) for (const p of a.programs) p.fromSolo = Math.min(100, (+p.fromSolo || 0) * 12);
  // Version 10 : la capacité ne se règle plus qu'en heures (les tiennes + coachs embauchées).
  if ((state.version || 1) < 10) for (const a of state.apps) for (const c of a.capacitySteps || []) { if (c.hired === undefined) c.hired = 0; delete c.capacity; }
  if ((state.version || 1) < 11) for (const a of state.apps) for (const q of a.programs || []) if (!Array.isArray(q.coachSteps)) q.coachSteps = [];
  if ((state.version || 1) < 12) for (const a of state.apps) if (a.payMissing === undefined) a.payMissing = true;
  if ((state.version || 1) < 13) for (const a of state.apps) {
    if (!a.channels) a.channels = { store: 0, storeRate: 15 };
    if (a.sub.acq === undefined) a.sub.acq = 0;
    for (const q of a.programs || []) if (q.acq === undefined) q.acq = 0;
  }
  state.version = 13;
  return state;
}

function isValidState(x) {
  return x && Array.isArray(x.apps) && x.apps.length > 0 && x.apps.every(a => a && a.sub && Array.isArray(a.programs));
}

if (typeof module !== 'undefined') module.exports = { defaultImplantation, CHARGE_CATEGORIES, CHARGE_ANCHORS, appDates, chargeStart, chargeAt, monthsFrom, smallAppCharges, exampleCharges, defaultShared, appStart, capacityAt, coachAt, addMonths, pricing, phasesOf, phaseAt, program, application, charge, smallApp, defaultState, migrate, isValidState, STORAGE_KEY };
