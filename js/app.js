'use strict';
// Interface : navigation entre pages, formulaires de paramètres et tableaux de résultats.

const $ = id => document.getElementById(id);
const money = x => Math.round(x).toLocaleString('fr-FR').replace(/\s/g, '\u00a0') + '\u00a0€';
const price = x => { const v = +x || 0; return v.toLocaleString('fr-FR', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 }) + '\u00a0€'; };
const num = x => Math.round(x).toLocaleString('fr-FR').replace(/\s/g, '\u00a0');
const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const thisMonth = new Date().toISOString().slice(0, 7);

// ---------- État ----------

let state = defaultState();
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
  if (isValidState(saved)) state = migrate(saved);
} catch { /* sauvegarde illisible : on garde les valeurs par défaut */ }
const save = () => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* stockage indisponible */ } };

const view = { page: 'synthese', app: '0', year: new Date().getFullYear() + 1, period: 0 };
const PAGES = ['synthese', 'resultat', 'previsionnel', 'charges', 'produits', 'reglages'];
const SETTINGS_PAGES = ['charges', 'produits', 'reglages'];

// ---------- Champs de formulaire liés à l'état par un chemin "apps.0.programs.1.name" ----------

function field(label, path, value, type = 'number') {
  const extra = type === 'number' ? ' min="0" step="any"' : '';
  // Un libellé « titre\nexplication » s'affiche sur deux lignes.
  const [head, more] = String(label).split('\n');
  const text = more ? `<span class="lh">${esc(head)}</span><span class="lx">${esc(more)}</span>` : esc(label);
  return `<label${more ? ' class="two"' : ''}>${text}<input data-path="${esc(path)}" type="${type}"${extra} value="${esc(value)}"></label>`;
}
function check(label, path, value) {
  return `<label class="line"><input data-path="${esc(path)}" type="checkbox" ${value ? 'checked' : ''}>${esc(label)}</label>`;
}
function select(label, path, value, options) {
  return `<label>${esc(label)}<select data-path="${esc(path)}">${options.map(([v, l]) => `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
}
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const monthName = k => k ? MONTHS[+k.slice(5) - 1] + ' ' + k.slice(0, 4) : '';
// Choix d'un mois en deux listes (mois, année) plutôt que le calendrier du navigateur.
function monthField(label, path, value, emptyText = '—') {
  const [y, m] = value ? value.split('-') : ['', ''];
  const years = []; for (let k = 2025; k <= 2034; k++) years.push(String(k));
  return `<label class="wide">${esc(label)}<span class="monthpick" data-mpath="${esc(path)}">
    <select aria-label="${esc(label)} : mois"><option value="">${esc(emptyText)}</option>${MONTHS.map((n, i) => { const v = String(i + 1).padStart(2, '0'); return `<option value="${v}" ${v === m ? 'selected' : ''}>${n}</option>`; }).join('')}</select>
    <select aria-label="${esc(label)} : année"><option value="">—</option>${years.map(v => `<option ${v === y ? 'selected' : ''}>${v}</option>`).join('')}</select></span></label>`;
}
// Période d'une charge sur une ligne : « du … au … », avec « dès le début » et « sans fin ».
function periodEditor(c, t) {
  const text = !c.start && !c.end ? 'Toujours' : `${c.start ? 'De ' + monthName(c.start) : 'Dès le début'} ${c.end ? 'à ' + monthName(c.end) : 'et sans fin'}`;
  return `<div class="period"><div class="period-head"><span>Période</span><b>${text}</b></div>
    <div class="period-row"><span class="pw">du</span>${monthField('Début', t + '.start', c.start, 'dès le début')}</div>
    <div class="period-row"><span class="pw">au</span>${monthField('Fin', t + '.end', c.end, 'sans fin')}</div></div>`;
}
function fields(obj, prefix, defs) {
  return '<div class="grid">' + defs.map(([k, l, t]) => t === 'month' ? monthField(l, prefix + '.' + k, obj[k]) : field(l, prefix + '.' + k, obj[k], t)).join('') + '</div>';
}
// Les deux passerelles entre un programme et l'abonnement seul, chacune sur toute la largeur.
function linkFields(a, q, path) {
  return '<div class="grid one">' +
    field(`Achat du programme depuis l'abonnement (% par mois)\nPart des abonnées ${soloName(a)} qui achètent ${q.name} chaque mois`, path + '.fromSolo', q.fromSolo) +
    field(`Abonnement gardé après le programme (%)\nPart des clientes ${progName(a, q)} qui gardent ${soloName(a)} à la fin`, path + '.toSolo', q.toSolo) +
    '</div>';
}
function resolve(path) {
  const keys = path.split('.'), last = keys.pop();
  return [keys.reduce((o, k) => o[k], state), last];
}

// Une ligne compacte : champs côte à côte, bouton de suppression au bout de la ligne.
const TRASH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>';
function lineEditor(obj, path, defs, removeLabel) {
  const cells = defs.map(([k, l, t]) => t === 'month' ? monthField(l, path + '.' + k, obj[k]) : field(l, path + '.' + k, obj[k], t)).join('');
  const del = removeLabel ? `<button class="icon danger" data-remove="${esc(path)}" aria-label="${esc(removeLabel)}" title="${esc(removeLabel)}">${TRASH}</button>` : '';
  return `<div class="lrow">${cells}${del}</div>`;
}

// Sous-bloc dépliable, coloré selon son type (calendrier, prix, inscriptions, promotions, abonnement).
function section(id, kind, title, summary, body) {
  return `<details class="sec sec-${kind}" id="${esc(id)}" ${view.open.has(id) ? 'open' : ''}>
    <summary><span class="sec-t">${esc(title)}</span><span class="sec-s">${summary}</span></summary><div class="sec-b">${body}</div></details>`;
}

// Grille de prix en trois phases : chaque phase est une pastille numérotée.
function pricingEditor(grid, path, title, anchor) {
  const now = phaseAt(grid, thisMonth);
  const rows = grid.map((ph, k) => `<div class="phase-row"><span class="badge">${k + 1}</span>${lineEditor(ph, path + '.' + k, [['label', 'Nom', 'text'], ['price', 'Prix (€)'], ['start', 'À partir de', 'month']])}</div>`).join('');
  const summary = grid.map(ph => price(ph.price)).join(' › ');
  return section(anchor, 'price', title, summary, `${rows}
    <p class="muted">Une phase sans date est ignorée. Avant la première date, le prix de la première phase s'applique. Ce mois-ci : <b>${esc(now.label)}</b> à ${price(now.price)}.</p>`);
}

const growth = [['initial', 'Départ / semaine'], ['target', 'Objectif / semaine'], ['months', 'Progression (mois)'], ['step', 'Augmentation par palier']];

// ---------- Pages de paramètres ----------

function programCard(a, q, j, p) {
  const t = p + '.programs.' + j;
  const open = view.open.has('p' + j) ? 'open' : '';
  const launch = q.start ? 'lancement ' + monthName(q.start) : 'sans lancement prévu';
  const cohorts = q.cohorts.map((c, k) => lineEditor(c, `${t}.cohorts.${k}`, [['name', 'Nom', 'text'], ['size', 'Clientes'], ['date', 'Démarrage', 'month']], 'Retirer cette cohorte')).join('');
  const calSummary = [q.cohorts.length ? `${q.cohorts.length} cohorte${q.cohorts.length > 1 ? 's' : ''} de test` : 'pas de cohorte de test', launch].join(' · ');
  const insSummary = `${q.launch ? `${num(q.launchRate)} / sem. pendant ${num(q.launchWeeks)} sem., puis ` : ''}${q.palierMode && q.paliers.length ? q.paliers.map(r => num(r.rate)).join(' → ') + ' / sem. (paliers)' : num(q.initial) + ' → ' + num(q.target) + ' / sem.'}`;
  return `<details class="card product" id="p${j}" ${open}><summary><span>${esc(progName(a, q))}<br><span class="sum-sub">${num(q.duration)} semaines · ${calSummary}</span></span><span class="tag ${q.enabled ? 'on' : ''}">${q.enabled ? 'Actif' : 'Inactif'}</span></summary>
      ${check('Programme actif', t + '.enabled', q.enabled)}
      ${fields(q, t, [['name', 'Nom du programme', 'text'], ['duration', 'Durée (semaines)'], ['coach', 'Minutes de coaching / cliente / semaine']])}
      ${section('cal-p' + j, 'cal', 'Calendrier', calSummary, `
        <p class="muted">Les cohortes de test démarrent ensemble le premier lundi de leur mois. Ajoute-en autant que tu veux (alpha, deuxième, troisième…).</p>
        ${cohorts || '<p class="muted">Aucune cohorte de test.</p>'}
        <div class="row"><button data-add="${t}.cohorts">Ajouter une cohorte de test</button></div>
        ${fields(q, t, [['start', 'Lancement commercial', 'month']])}
        <p class="muted">À partir du lancement, les inscriptions arrivent en continu selon le rythme ci-dessous. Laisse vide si le lancement n'est pas encore fixé.</p>`)}
      ${pricingEditor(q.pricing, t + '.pricing', 'Prix (total payé à l\'inscription)', 'price-p' + j)}
      ${section('ins-p' + j, 'ins', 'Inscriptions après le lancement', insSummary, `
        <h4>Premières semaines</h4>${check('Rythme spécifique au démarrage', t + '.launch', q.launch)}
        ${q.launch ? fields(q, t, [['launchWeeks', 'Pendant (semaines)'], ['launchRate', 'Clientes / semaine']]) : ''}
        <h4>Ensuite, montée en puissance</h4>${fields(q, t, growth)}
        ${check('Paliers personnalisés', t + '.palierMode', q.palierMode)}
        ${q.palierMode ? q.paliers.map((r, k) => lineEditor(r, t + '.paliers.' + k, [['rate', 'Clientes / semaine'], ['weeks', 'Pendant (semaines)']], 'Supprimer le palier')).join('') + `<div class="row"><button data-add="${t}.paliers">Ajouter un palier</button></div>` : ''}`)}
      ${programGoalSection(a, q, j, t)}
      ${section('link-p' + j, 'sub', `Passerelles avec ${soloName(a)}`, `${num(q.toSolo)} % gardent ${esc(soloName(a))} · ${num(q.fromSolo)} % des abonnées l'achètent / mois`, `
        <p class="muted">Aussi réglable dans la carte ${esc(soloName(a))}, bloc « Passerelles avec les programmes ».</p>
        ${linkFields(a, q, t)}
        <p class="muted">Les abonnées qui achètent le programme gardent leur abonnement. Elles occupent une place de coaching et ne sont pas recomptées à la fin du programme.</p>`)}
      ${section('promo-p' + j, 'promo', 'Promotions ponctuelles', q.promos.length ? `${q.promos.length} promotion${q.promos.length > 1 ? 's' : ''}` : 'aucune', `
        ${q.promos.map((r, k) => lineEditor(r, t + '.promos.' + k, [['start', 'Début', 'month'], ['end', 'Fin', 'month'], ['price', 'Prix (€)']], 'Supprimer la promotion')).join('')}
        <div class="row"><button data-add="${t}.promos">Ajouter une promotion</button></div>
        <p class="muted">Une promotion remplace le prix de la phase pendant ses mois.</p>`)}
      <div class="row"><button class="danger" data-remove="${t}">Supprimer le programme</button></div>
    </details>`;
}

// Objectif d'inscriptions d'un programme : rythme nécessaire et capacité de coaching qu'il demande.
function programGoalSection(a, q, j, t) {
  const g = q.goal, sim = simulate(a).months, plan = programGoalPlan(a, j, sim);
  const byStep = new Map(plan.steps.map(s => [s.months + ':' + s.count, s]));
  const rows = g.steps.map((st, k) => {
    const r = byStep.get(+st.months + ':' + +st.count);
    let res = '<div class="goal-res"><span class="muted">à compléter</span></div>';
    if (r) {
      const over = r.capacity !== null && Math.ceil(r.parallel) > r.capacity;
      const overH = r.capHours !== null && r.hours > r.capHours;
      res = `<div class="goal-res"><b>${num(r.rate)} inscription${r.rate > 1 ? 's' : ''} / semaine</b><span>${monthName(r.at)} · plan actuel : ${num(Math.round(r.planYear))} / an${r.fromSoloYear >= 1 ? ` · dont ${num(Math.round(r.fromSoloYear))} / an venues de ${esc(soloName(a))}` : ''}</span></div>
        <div class="goal-cap ${over || overH ? 'bad' : 'ok'}">${num(Math.ceil(r.parallel))} clientes en même temps · ${num(Math.round(r.hours * 10) / 10)} h de coaching / semaine pour ce programme.
        ${r.capacity === null ? 'Capacité illimitée.' : `Capacité prévue à cette date, tous programmes : ${num(r.capacity)} clientes et ${num(r.capHours)} h.${over || overH ? ' <b>Insuffisante.</b>' : ''}`}</div>
        ${over || overH ? (() => {
          // Besoin total à cette date : ce programme à l'objectif, plus les autres programmes tels que simulés.
          const m = sim.find(x => x.month === r.at), others = a.programs.reduce((s2, p2, k2) => s2 + (k2 !== j && m ? m.products[k2].active : 0), 0);
          const othersH = a.programs.reduce((s2, p2, k2) => s2 + (k2 !== j && m ? m.products[k2].active * (+p2.coach || 0) / 60 : 0), 0);
          const people = Math.ceil(r.parallel + others), hours = Math.ceil((r.hours + othersH) * 10) / 10;
          return capacityAlert(a, state.apps.indexOf(a), { month: r.at, next: '', people, hours, cap: r.capacity, limit: r.capHours, places: Math.max(0, people - r.capacity), missingHours: Math.max(0, hours - r.capHours) }, `goal-alert-${j}-${k}`);
        })() : ''}`;
    }
    return `<div class="goal-step"><span class="badge">${k + 1}</span><div>${lineEditor(st, `${t}.goal.steps.${k}`, [['months', 'Au bout de (mois)'], ['count', 'Inscriptions par an']], 'Supprimer ce palier')}${res}</div></div>`;
  }).join('');
  const applied = q.palierMode && !q.launch && JSON.stringify(q.paliers) === JSON.stringify(plan.segs);
  const last = plan.segs[plan.segs.length - 1];
  return section('goal-p' + j, 'ins', 'Objectif d\'inscriptions', g.steps.map(st => `${num(+st.count || 0)} / an à ${num(+st.months || 0)} mois`).join(' · '), `
    <h4>Paliers, comptés depuis le lancement commercial (${q.start ? monthName(q.start) : 'date à fixer'})</h4>
    ${rows}
    <div class="row"><button data-add="${t}.goal.steps">Ajouter un palier</button></div>
    <p class="muted">Une cliente reste ${num(q.duration)} semaines : le nombre de clientes en même temps est le rythme d'inscriptions multiplié par la durée. Les cohortes de test ne comptent pas dans l'objectif.</p>
    ${last ? `<p class="muted"><b>Appliquer</b> remplace le rythme du bloc « Inscriptions après le lancement » : il décoche le rythme spécifique au démarrage, coche « Paliers personnalisés » et y écrit ${plan.segs.map(x => `${num(x.rate)} / sem. pendant ${num(x.weeks)} sem.`).join(', puis ')}, puis ${num(last.rate)} / sem. ensuite. Ton ancien rythme reste enregistré : décoche « Paliers personnalisés » et recoche le démarrage pour y revenir.</p>
    <div class="row"><button data-pgoal="${t}" ${applied ? 'disabled' : ''}>${applied ? 'Rythme appliqué' : 'Appliquer ces paliers aux inscriptions'}</button></div>` : ''}`);
}

// Objectif d'abonnées par paliers : quel rythme d'abonnements faut-il, palier après palier ?
let goalCache = { key: '', plan: null };
function cachedGoalPlan(a) {
  const key = JSON.stringify([a.sub, a.programs.length]);
  if (goalCache.key !== key) goalCache = { key, plan: goalPlan(a) };
  return goalCache.plan;
}
function goalSection(a, p) {
  const g = a.sub.goal, plan = cachedGoalPlan(a), d = +a.sub.duration || 0;
  const sim = simulate(a).months;
  const byStep = new Map(plan.steps.map(s => [s.months + ':' + s.count, s]));
  const unit = g.kind === 'new' ? 'nouvelles / an' : 'abonnées';
  const rows = g.steps.map((st, k) => {
    const r = byStep.get(+st.months + ':' + +st.count);
    const m = r && sim.find(x => x.month === r.at);
    const now = !m ? '' : g.kind === 'new' ? `${num(Math.round(m.newDirect.reduce((s, x) => s + x, 0) * 12))} nouvelles / an` : `${num(Math.round(m.direct))} abonnées`;
    const res = r ? `<div class="goal-res"><b>${num(r.rate)} ${plan.conv < 1 ? 'essais' : 'abonnées'} / semaine</b><span>${monthName(r.at)} · plan actuel : ${now}</span></div>` : '<div class="goal-res"><span class="muted">à compléter</span></div>';
    return `<div class="goal-step"><span class="badge">${k + 1}</span><div>${lineEditor(st, `${p}.sub.goal.steps.${k}`, [['months', 'Au bout de (mois)'], ['count', g.kind === 'new' ? 'Nouvelles abonnées / an' : 'Abonnées en même temps']], 'Supprimer ce palier')}${res}</div></div>`;
  }).join('');
  const last = plan.steps[plan.steps.length - 1];
  const priceAt = last ? phaseAt(a.sub.directPricing, last.at).price : 0;
  const stable = last && d > 0 ? last.paid * 52 / 12 * d : null;
  const after = !last ? '' : `<div class="goal"><div><span>Rythme final</span><b>${num(last.rate)} / semaine</b><small>${num(Math.round(last.paid * 52))} nouvelles abonnées payantes par an</small></div>
      ${stable ? `<div><span>Abonnées une fois stabilisé</span><b>${num(Math.round(stable))}</b><small>soit environ ${money(stable * priceAt)} de CA par mois au prix de ${price(priceAt)}</small></div>` : ''}</div>`;
  const applied = a.sub.palierMode && JSON.stringify(a.sub.paliers) === JSON.stringify(plan.segs);
  return section('goal-sd', 'ins', 'Objectif d\'abonnées', g.steps.map(st => `${num(+st.count || 0)} à ${num(+st.months || 0)} mois`).join(' · ') + (g.kind === 'new' ? ' (nouvelles / an)' : ''), `
    <div class="grid">${select('Je vise', p + '.sub.goal.kind', g.kind, [['active', 'des abonnées en même temps'], ['new', 'des nouvelles abonnées par an']]).replace('<label>', '<label class="wide">')}</div>
    <h4>Paliers, comptés depuis l'ouverture (${a.sub.start ? monthName(a.sub.start) : 'date à fixer'})</h4>
    ${rows}
    <div class="row"><button data-add="${p}.sub.goal.steps">Ajouter un palier</button></div>
    ${after}
    <p class="muted">Pour chaque palier, l'outil cherche le plus petit rythme qui l'atteint à la date voulue, en tenant compte des résiliations${plan.conv < 1 ? ' et de l\'essai gratuit' : ''}. Les abonnées qui viennent d'un programme s'ajoutent en plus.</p>
    ${plan.segs.length ? `<p class="muted"><b>Appliquer</b> coche « Paliers personnalisés » dans « Ouverture et rythme d'abonnements » et y écrit ces rythmes (${plan.segs.map(x => `${num(x.rate)} / sem. pendant ${num(x.weeks)} sem.`).join(', puis ')}, puis ${num(plan.segs[plan.segs.length - 1].rate)} / sem. ensuite). Toutes les pages sont recalculées. Ton ancien rythme reste enregistré : décoche « Paliers personnalisés » pour y revenir.</p>` : ''}
    ${plan.segs.length ? `<div class="row"><button data-goal="${p}" ${applied ? 'disabled' : ''}>${applied ? 'Rythme appliqué' : 'Appliquer ces paliers au rythme d\'abonnements'}</button></div>` : ''}`);
}

function productsPage(a, i) {
  const p = 'apps.' + i;
  const g = a.sub.directPricing;
  // Le produit « seul » : l'abonnement, avec en option ce qui se passe après un programme.
  const solo = `<details class="card product solo" id="sd" ${view.open.has('sd') ? 'open' : ''}><summary><span>${esc(soloName(a))}<br><span class="sum-sub">Abonnement mensuel · ${price(phaseAt(g, thisMonth).price)} · ${a.sub.start ? 'ouverture ' + monthName(a.sub.start) : 'pas encore ouvert'}</span></span></summary>
      ${check('Les abonnées gardent le prix de la phase où elles se sont abonnées', p + '.sub.lockPrice', a.sub.lockPrice)}
      ${section('open-sd', 'cal', 'Ouverture et rythme d\'abonnements', `${a.sub.start ? monthName(a.sub.start) : '—'} · ${a.sub.palierMode && a.sub.paliers.length ? a.sub.paliers.map(r => num(r.rate)).join(' → ') + ' / sem. (paliers)' : num(a.sub.initial) + ' → ' + num(a.sub.target) + ' / sem.'}`, `${fields(a.sub, p + '.sub', [['start', 'Ouverture des abonnements', 'month'], ['duration', 'Durée moyenne d\'abonnement (mois)']])}
        ${check('Paliers personnalisés (rempli par « Objectif d\'abonnées »)', p + '.sub.palierMode', a.sub.palierMode)}
        ${a.sub.palierMode ? a.sub.paliers.map((r, k) => lineEditor(r, p + '.sub.paliers.' + k, [['rate', 'Abonnées / semaine'], ['weeks', 'Pendant (semaines)']], 'Supprimer le palier')).join('') + `<div class="row"><button data-add="${p}.sub.paliers">Ajouter un palier</button></div><p class="muted">Après le dernier palier, le rythme reste à l'objectif / semaine : ${num(a.sub.target)}.</p>` : fields(a.sub, p + '.sub', growth)}
        <p class="muted">0 mois = aucune résiliation. Sinon résiliation mensuelle = 1 / durée.</p>`)}
      ${goalSection(a, p)}
      ${pricingEditor(g, p + '.sub.directPricing', 'Prix mensuel', 'price-sd')}
      ${section('trial-sd', 'promo', 'Période d\'essai', +a.sub.trialDays > 0 ? `${num(a.sub.trialDays)} jours gratuits · ${num(a.sub.trialConversion)} % passent payantes` : 'aucune', `
        ${fields(a.sub, p + '.sub', [['trialDays', 'Durée de l\'essai gratuit (jours)'], ['trialConversion', 'Essais qui deviennent payants (%)']])}
        <p class="muted">Le rythme d'abonnements ci-dessus compte alors les essais. Seule la part indiquée devient payante, à la fin de l'essai. 0 jour = pas d'essai.</p>`)}
      ${a.programs.length ? section('conv-sp', 'sub', 'Passerelles avec les programmes', a.programs.map(q => `${esc(q.name)} : ${num(q.fromSolo)} % y vont / mois · ${num(q.toSolo)} % restent`).join(' · '), `
        <p class="muted">Mêmes réglages que le bloc « Passerelles » de chaque programme : une modification ici se retrouve là-bas.</p>
        ${a.programs.map((q, j) => `<h4>${esc(progName(a, q))}${q.enabled ? '' : ' (désactivé)'}</h4>${linkFields(a, q, p + '.programs.' + j)}`).join('')}
        <h4>Abonnement après un programme</h4>
        ${fields(a.sub, p + '.sub', [['postDuration', 'Durée moyenne d\'abonnement après un programme (mois)']])}
        <h4>Prix mensuel après un programme</h4>
        ${a.sub.postPricing.map((ph, k) => `<div class="phase-row"><span class="badge">${k + 1}</span>${lineEditor(ph, p + '.sub.postPricing.' + k, [['label', 'Nom', 'text'], ['price', 'Prix (€)'], ['start', 'À partir de', 'month']])}</div>`).join('')}`) : ''}
    </details>`;
  const programs = a.programs.map((q, j) => programCard(a, q, j, p)).join('');
  return `<p class="muted">Chaque produit de ${esc(a.name)} se déplie pour régler son calendrier, ses prix et son rythme de ventes.</p>
    ${calendarCard(a)}${solo}${programs}
    <div class="row"><button data-add="${p}.programs">Ajouter un programme</button></div>
    ${a.programs.length ? capacityCard(a, p) : ''}`;
}

// Tous les jalons d'une application, dans l'ordre chronologique.
// Chaque jalon indique où il se règle et y mène d'un geste.
function timeline(a) {
  const items = [];
  a.programs.forEach((q, j) => {
    if (!q.enabled) return;
    const cal = { page: 'produits', open: 'p' + j, anchor: 'cal-p' + j, from: `Produits › ${esc(progName(a, q))} › Calendrier` };
    q.cohorts.forEach(c => c.date && items.push({ date: c.date, kind: 'test', text: `${esc(c.name)} · ${esc(progName(a, q))}`, sub: `${num(c.size)} clientes`, go: cal }));
    if (q.start) items.push({ date: q.start, kind: 'launch', text: `Lancement commercial · ${esc(progName(a, q))}`, sub: '', go: cal });
    const pr = { page: 'produits', open: 'p' + j, anchor: 'price-p' + j, from: `Produits › ${esc(progName(a, q))} › Prix` };
    phasesOf(q.pricing).forEach(ph => items.push({ date: ph.start, kind: 'price', text: `${esc(ph.label)} de prix · ${esc(progName(a, q))}`, sub: price(ph.price), go: pr }));
  });
  if (a.sub.start) items.push({ date: a.sub.start, kind: 'launch', text: `Ouverture des abonnements · ${esc(soloName(a))}`, sub: '', go: { page: 'produits', open: 'sd', anchor: 'open-sd', from: `Produits › ${esc(soloName(a))}` } });
  (a.capacitySteps || []).forEach(c => c.date && items.push({ date: c.date, kind: 'cap', text: 'Capacité de coaching', sub: `${num(c.capacity)} clientes · ${num(c.hours)} h / semaine`, go: { page: 'produits', open: 'pr-cap', anchor: 'pr-cap', from: 'Produits › Capacité de coaching' } }));
  items.sort((x, y) => x.date.localeCompare(y.date));
  if (!items.length) return '<p class="muted">Aucune date pour l\'instant : ajoute une cohorte de test ou une date de lancement dans Produits et prix.</p>';
  return `<ol class="timeline">${items.map(it => `<li class="${it.kind}"><a href="#${it.go.page}" data-goto="${it.go.page}" data-open="${it.go.open}" data-anchor="${it.go.anchor}">
      <span class="when">${monthName(it.date)}</span><span class="what">${it.text}${it.sub ? ` · <span class="muted">${it.sub}</span>` : ''}<span class="from">${it.go.from} ›</span></span></a></li>`).join('')}</ol>`;
}

// Calendrier de l'application : rassemble les dates saisies dans chaque produit (lecture seule).
const timelineCount = a => (timeline(a).match(/<li /g) || []).length;
function calendarCard(a) {
  const n = timelineCount(a);
  return `<details class="card product tool-cal" id="pr-cal" ${view.open.has('pr-cal') ? 'open' : ''}><summary><span>Calendrier de ${esc(a.name)}<br><span class="sum-sub">${n} dates · à partir de ${monthName(appStart(a))}</span></span></summary>
      <p class="muted">Ce calendrier ne se saisit pas ici : il rassemble les dates saisies dans chaque produit et dans la capacité de coaching. Touche une date pour aller la modifier. Les prévisions commencent à la première date.</p>
      ${timeline(a)}</details>`;
}
// Capacité de coaching : commune à tous les programmes de l'application.
function capacityCard(a, p) {
  const steps = (a.capacitySteps || []).map((c, j) => lineEditor(c, `${p}.capacitySteps.${j}`, [['date', 'À partir de', 'month'], ['capacity', 'Clientes en même temps'], ['hours', 'Heures / semaine']], 'Retirer ce palier')).join('');
  const last = (a.capacitySteps || [])[a.capacitySteps.length - 1];
  return `<details class="card product tool-cap" id="pr-cap" ${view.open.has('pr-cap') ? 'open' : ''}><summary><span>Capacité de coaching<br><span class="sum-sub">${last ? `${a.capacitySteps.length} paliers · jusqu'à ${num(last.capacity)} clientes et ${num(last.hours)} h / semaine` : 'illimitée'} · tous les programmes</span></span></summary>
      <p class="muted">Ajoute un palier à chaque fois que tu peux accompagner plus de clientes : par exemple 10 pendant la cohorte alpha, 25 au lancement, 40 un an plus tard.</p>
      ${steps || '<p class="muted">Aucun palier : capacité illimitée.</p>'}
      <div class="row"><button data-add="${p}.capacitySteps">Ajouter un palier de capacité</button></div>
      ${check('Refuser les inscriptions au-delà de la capacité', p + '.restrict', a.restrict)}
      ${a.restrict ? check('Mettre les inscriptions refusées en liste d\'attente', p + '.waitlist', a.waitlist) : ''}</details>`;
}

function implantSection() {
  const im = state.implantation;
  const cur = im.scenarios.find(x => x.id === im.current) || im.scenarios[0];
  const bases = [['result', 'du bénéfice'], ['ca', 'du chiffre d\'affaires']];
  return section('st-implant', 'cal', 'Implantation de la société', esc(cur ? cur.name : '—'), `
    <div class="grid">${select('Implantation retenue', 'implantation.current', im.current, im.scenarios.map(x => [x.id, x.name])).replace('<label>', '<label class="wide">')}</div>
    <p class="warn">Taux indicatifs à faire valider par un conseiller. Ils servent à comparer les scénarios dans l'onglet Résultat.</p>
    ${im.scenarios.map((sc, k) => { const t = 'implantation.scenarios.' + k, id = 'imp-' + sc.id; return `<details class="card charge" id="${id}" ${view.open.has(id) ? 'open' : ''}><summary><span>${esc(sc.name)}<br><span class="sum-sub">frais ${money(+sc.fixedYear || 0)} / an · cotisations ${num(+sc.socialRate || 0)} % · impôt ${num(+sc.taxRate || 0)} %${+sc.distRate ? ` · dividendes ${num(+sc.distRate)} %` : ''}</span></span></summary>
      ${fields(sc, t, [['name', 'Nom du scénario', 'text']])}
      <div class="grid">${field('Frais de structure (€ / an)', t + '.fixedYear', sc.fixedYear)}${field('Cotisations sociales (%)', t + '.socialRate', sc.socialRate)}${select('Calculées sur', t + '.socialBase', sc.socialBase, bases)}
        ${field('Impôt (%)', t + '.taxRate', sc.taxRate)}${select('Calculé sur', t + '.taxBase', sc.taxBase, bases)}${field('Impôt sur les dividendes (%)', t + '.distRate', sc.distRate)}${field('Plafond de CA (€ / an, 0 = aucun)', t + '.caLimit', sc.caLimit || 0)}</div>
      ${fields(sc, t, [['note', 'Remarques', 'text']])}
      ${sc.note ? `<p class="muted">${esc(sc.note)}</p>` : ''}
      <div class="row"><button class="danger" data-remove="${t}">Supprimer ce scénario</button></div></details>`; }).join('')}
    <div class="row"><button data-add="implantation.scenarios">Ajouter un scénario</button></div>`);
}

function settingsPage(a, i) {
  const p = 'apps.' + i;
  const vat = state.vat.ttc ? `prix saisis TTC · TVA ${num(state.vat.rate)} %` : 'prix saisis HT';
  return `<details class="card product solo" id="st-app" ${view.open.has('st-app') || !view.open.size ? 'open' : ''}><summary><span>${esc(a.name)}<br><span class="sum-sub">${a.programs.length ? a.programs.length + ' programme' + (a.programs.length > 1 ? 's' : '') + ' et ' : ''}l'abonnement ${esc(soloName(a))}</span></span></summary>
      ${fields(a, p, [['name', 'Nom de l\'application', 'text']])}
      <ul class="where">
        <li><a href="#produits">Produits et prix</a> : calendrier, cohortes de test, lancement, durée, prix en 3 phases, rythme d'inscriptions, objectifs d'abonnées, promotions, passerelles, période d'essai${a.programs.length ? ', capacité de coaching' : ''}.</li>
        <li><a href="#charges">Charges</a> : charges de l'application, coût du coaching, charges de structure Om Holistic.</li>
      </ul>
      ${state.apps.length > 1 ? `<div class="row"><button class="danger" data-remove-app="${i}">Supprimer l'application ${esc(a.name)}</button></div>` : ''}
    </details>
    <details class="card product tool-all" id="st-all" ${view.open.has('st-all') || !view.open.size ? 'open' : ''}><summary><span>Toutes les applications<br><span class="sum-sub">${state.apps.map(x => esc(x.name)).join(' · ')}</span></span></summary>
      ${section('st-vat', 'price', 'TVA', vat, `${check('Mes prix sont saisis TTC (le compte d\'exploitation les convertit en HT)', 'vat.ttc', state.vat.ttc)}
        ${state.vat.ttc ? fields(state.vat, 'vat', [['rate', 'Taux de TVA (%)']]) : ''}`)}
      ${implantSection()}
      ${section('st-save', 'sub', 'Sauvegarde', 'export et import du fichier de paramètres', `<p class="muted">Tes paramètres restent dans ce navigateur. Exporte-les régulièrement pour les garder ou les ouvrir sur un autre appareil.</p>
        <div class="row"><button id="export">Exporter les paramètres</button><label class="file"><span>Importer des paramètres</span><input id="import" type="file" accept=".json"></label></div>
        <p id="importMsg" class="warn"></p>`)}
      ${section('st-new', 'ins', 'Ajouter une application', 'nouvelle application avec son abonnement', '<div class="row"><button id="addApp">Ajouter une application</button></div>')}
      ${section('st-reset', 'promo', 'Revenir aux exemples', 'remplace tous tes paramètres', `<p class="muted">Remplace toutes les applications, produits et charges par les valeurs d'exemple. Pense à exporter avant.</p>
        <div class="row">${view.confirmReset ? '<button class="danger" id="resetYes">Oui, tout remplacer par les exemples</button><button id="resetNo">Annuler</button>' : '<button class="danger" id="reset">Revenir aux valeurs d\'exemple</button>'}</div>`)}
    </details>`;
}

// ---------- Pages de résultats ----------

function inPeriod(month) {
  const y = +month.slice(0, 4), mo = +month.slice(5);
  if (view.period === 7) return true;
  if (y !== view.year) return false;
  if (view.period === 0) return true;
  if (view.period <= 2) return Math.ceil(mo / 6) === view.period;
  return Math.ceil(mo / 3) === view.period - 2;
}
const periodName = () => view.period === 7 ? "sur tout l'horizon" : (['en ', 'au 1er semestre ', 'au 2e semestre ', 'au 1er trimestre ', 'au 2e trimestre ', 'au 3e trimestre ', 'au 4e trimestre '][view.period] + view.year);
const table = (heads, rows, cls = []) => '<thead><tr>' + heads.map(h => `<th>${h}</th>`).join('') + '</tr></thead><tbody>'
  + rows.map((r, i) => `<tr class="${cls[i] || ''}">` + r.map(v => `<td>${v}</td>`).join('') + '</tr>').join('') + '</tbody>';
const signed = x => `<span class="${x < 0 ? 'neg' : ''}">${money(x)}</span>`;

function results() {
  const all = state.apps.map(a => ({ a, ...simulate(a) }));
  const pnl = buildPnl(state, all);
  // Charges et résultat de chaque mois, à partir du compte d'exploitation.
  all.forEach((x, i) => {
    x.pnl = pnl[i];
    x.months.forEach((m, k) => {
      const t = sumPnl([pnl[i][k]]).total;
      m.cost = t.charges; m.net = t.result; m.caHT = t.ca;
    });
  });
  const scope = view.app === 'all' ? all : [all[+view.app] || all[0]];
  const rows = scope.flatMap(x => x.months.filter(m => inPeriod(m.month)));
  const keys = [...new Set(rows.map(r => r.month))].sort();
  const F = ['sales', 'directCA', 'postCA', 'total', 'caHT', 'admissions', 'net', 'cost', 'active', 'direct', 'post'];
  const byMonth = keys.map(k => ({ month: k, ...Object.fromEntries(F.map(f => [f, rows.filter(r => r.month === k).reduce((s, r) => s + r[f], 0)])) }));
  const sum = f => rows.reduce((s, r) => s + r[f], 0);
  const summary = x => sumPnl(x.pnl.filter(e => inPeriod(e.month)));
  return { all, scope, keys, byMonth, sum, summary };
}

// Une ligne par produit, avec sa part du CA de la période.
function productLines(r) {
  const lines = [];
  for (const x of r.scope) {
    const ms = x.months.filter(m => inPeriod(m.month)), last = ms.at(-1);
    const a = x.a, direct = last?.direct || 0, post = last?.post || 0;
    const ai = state.apps.indexOf(a);
    lines.push({ name: esc(soloName(a)), go: { open: 'sd', app: ai }, color: 'var(--clay)', ca: ms.reduce((s, m) => s + m.directCA + m.postCA, 0),
      detail: a.programs.length ? `${num(direct + post)} abonnées en fin de période, dont ${num(post)} après un programme` : `${num(direct)} abonnées en fin de période` });
    a.programs.forEach((p, i) => lines.push({ name: esc(progName(a, p)), go: { open: 'p' + i, app: ai }, off: !p.enabled, color: 'var(--sage)', ca: ms.reduce((s, m) => s + m.products[i].sales, 0),
      detail: `${num(ms.reduce((s, m) => s + m.products[i].admissions, 0))} inscriptions · ${num(last?.products[i].active || 0)} en cours en fin de période` }));
  }
  const max = Math.max(1, ...lines.map(l => l.ca));
  const link = l => `<a class="golink" href="#produits" data-goto="produits" data-open="${l.go.open}" data-anchor="${l.go.open}"${view.app === 'all' ? ` data-app="${l.go.app}"` : ''}>${l.name}</a>`;
  return lines.map(l => `<div class="prod"><span>${link(l)}${l.off ? ' <span class="tag">Inactif</span>' : ''}</span><b>${money(l.ca)}</b>
    <span class="meter"><i style="width:${(l.ca / max * 100).toFixed(1)}%;background:${l.color}"></i></span><span class="muted">${l.detail}</span></div>`).join('');
}

// Barres empilées : programmes (sauge) et abonnements (argile), sur une échelle arrondie.
function chart(byMonth) {
  const W = Math.max(320, byMonth.length * 26), H = 190, left = 44, bottom = 22, top = 8;
  const raw = Math.max(1, ...byMonth.map(m => m.total));
  const mag = 10 ** Math.floor(Math.log10(raw)), max = Math.ceil(raw / mag / 2) * mag * 2 || 1;
  const y = v => top + (H - top - bottom) * (1 - v / max), bw = (W - left) / Math.max(1, byMonth.length);
  const ticks = [0, .25, .5, .75, 1].map(f => f * max);
  const short = v => v >= 1000 ? (v / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' k' : num(v);
  const every = Math.max(1, Math.ceil(byMonth.length / 12));
  const MOIS = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Chiffre d'affaires mensuel">`
    + ticks.map(t => `<line class="grid-line" x1="${left}" x2="${W}" y1="${y(t)}" y2="${y(t)}"/><text x="${left - 6}" y="${y(t) + 3}" text-anchor="end">${short(t)}</text>`).join('')
    + byMonth.map((m, i) => {
      const x = left + i * bw + bw * .15, w = bw * .7, subs = m.directCA + m.postCA;
      const label = i % every === 0 ? `<text x="${x + w / 2}" y="${H - 6}" text-anchor="middle">${MOIS[+m.month.slice(5) - 1]}${byMonth.length > 12 ? ' ' + m.month.slice(2, 4) : ''}</text>` : '';
      return `<g><title>${m.month} : ${money(m.total)} (programmes ${money(m.sales)}, abonnements ${money(subs)})</title>
        <rect x="${x}" y="${y(m.sales)}" width="${w}" height="${y(0) - y(m.sales)}" rx="2" fill="var(--sage)"/>
        <rect x="${x}" y="${y(m.total)}" width="${w}" height="${Math.max(0, y(m.sales) - y(m.total))}" rx="2" fill="var(--clay)"/></g>${label}`;
    }).join('') + '</svg>';
}

function synthesePage() {
  const r = results();
  const total = r.sum('total'), sales = r.sum('sales'), subs = r.sum('directCA') + r.sum('postCA'), net = r.sum('net'), cost = r.sum('cost');
  const margin = r.sum('caHT') ? net / r.sum('caHT') * 100 : 0;
  const last = r.byMonth.at(-1) || {};
  const pct = x => total ? (x / total * 100).toFixed(1) : 0;
  return `<div class="hero">
      <div><small>Chiffre d'affaires ${periodName()}</small><div class="big">${money(total)}</div></div>
      <div style="display:flex;flex-direction:column;gap:10px">
        <div class="share"><i style="width:${pct(sales)}%;background:var(--sage)"></i><i style="width:${pct(subs)}%;background:var(--clay)"></i></div>
        <div class="split"><div><span>Programmes</span><b>${money(sales)}</b></div><div><span>Abonnements</span><b>${money(subs)}</b></div></div>
      </div>
    </div>
    <div class="kpis">
      <div class="kpi"><a href="#resultat"><small>Résultat d'exploitation</small><b class="${net < 0 ? 'bad' : 'good'}">${money(net)}</b><small>${margin.toFixed(0)} % du CA HT</small></a></div>
      <div class="kpi"><small>Charges</small><b>${money(cost)}</b></div>
      <div class="kpi"><small>Inscriptions aux programmes</small><b>${num(r.sum('admissions'))}</b></div>
      <div class="kpi"><small>Abonnées en fin de période</small><b>${num((last.direct || 0) + (last.post || 0))}</b></div>
    </div>
    <div class="two">
      <details class="card" id="s-chart" open><summary>Évolution mensuelle</summary>
        <div class="legend"><span><i style="background:var(--sage)"></i>Programmes</span><span><i style="background:var(--clay)"></i>Abonnements</span></div>
        <div class="chart">${chart(r.byMonth)}</div></details>
      <details class="card" id="s-prod" open><summary>Revenus par produit</summary><div>${productLines(r)}</div></details>
    </div>`;
}

function previsionnelPage() {
  const r = results();
  const ms = r.byMonth, last = ms.at(-1) || {};
  const sum = f => ms.reduce((t, m) => t + m[f], 0);
  const total = sum('total'), net = sum('net'), cost = sum('cost');
  const maxMonth = Math.max(1, ...ms.map(m => m.total));
  // Un mois = une carte : CA (barre programmes / abonnements), charges, résultat, clientes.
  const card = m => {
    const subs = m.directCA + m.postCA;
    return `<div class="mcard"><div class="mh"><b>${monthName(m.month).replace(/ \d+$/, '')}</b><span class="${m.net < 0 ? 'neg' : 'pos'}">${money(m.net)}</span></div>
      <div class="mbar" title="Programmes ${money(m.sales)} · abonnements ${money(subs)}"><i style="width:${(m.sales / maxMonth * 100).toFixed(1)}%;background:var(--sage)"></i><i style="width:${(subs / maxMonth * 100).toFixed(1)}%;background:var(--clay)"></i></div>
      <dl><dt>Chiffre d'affaires</dt><dd><b>${money(m.total)}</b></dd><dt>Programmes</dt><dd>${money(m.sales)}</dd><dt>Abonnements</dt><dd>${money(subs)}</dd><dt>Charges</dt><dd>${money(-m.cost)}</dd></dl>
      <small>${num(m.active)} en programme · ${num(m.direct + m.post)} abonnées</small></div>`;
  };
  const quarters = new Map();
  for (const m of ms) { const q = m.month.slice(0, 4) + ' · T' + Math.ceil(+m.month.slice(5) / 3); (quarters.get(q) || quarters.set(q, []).get(q)).push(m); }
  const blocks = [...quarters].map(([q, qm], i) => {
    const t = f => qm.reduce((s, m) => s + m[f], 0);
    const id = 'q' + q.replace(/\W/g, '');
    const open = view.open.has(id) || (!view.open.size && i === 0) ? 'open' : '';
    const qn = t('net');
    return `<details class="card quarter" id="${id}" ${open}><summary><span>${q}<br><span class="sum-sub">CA ${money(t('total'))} · charges ${money(t('cost'))} · résultat <b class="${qn < 0 ? 'neg' : 'pos'}">${money(qn)}</b></span></span></summary>
      <div class="months">${qm.map(card).join('')}</div></details>`;
  }).join('');
  const heads = ['Mois', 'Programmes', 'Abo. direct', 'Abo. après prog.', 'CA', 'Charges', 'Résultat', 'En programme', 'Abonnées'];
  const line = m => [m.month, money(m.sales), money(m.directCA), money(m.postCA), `<b>${money(m.total)}</b>`, money(m.cost), signed(m.net), num(m.active), num(m.direct + m.post)];
  const tot = { month: 'Total', sales: sum('sales'), directCA: sum('directCA'), postCA: sum('postCA'), total, cost, net, active: last.active || 0, direct: last.direct || 0, post: last.post || 0 };
  return `<div class="hero">
      <div><small>Résultat ${periodName()}</small><div class="big ${net < 0 ? 'neg-hero' : ''}">${money(net)}</div></div>
      <div class="split"><div><span>Chiffre d'affaires</span><b>${money(total)}</b></div><div><span>Charges</span><b>${money(cost)}</b></div>
        <div><span>Abonnées en fin de période</span><b>${num((last.direct || 0) + (last.post || 0))}</b></div><div><span>En programme en fin de période</span><b>${num(last.active || 0)}</b></div></div>
    </div>
    <div class="legend"><span><i style="background:var(--sage)"></i>Programmes</span><span><i style="background:var(--clay)"></i>Abonnements</span></div>
    ${blocks || '<p class="muted">Aucun mois dans cette période.</p>'}
    <details class="card" id="pv-table"><summary>Tableau détaillé ${periodName()}</summary><div class="scroll"><table>${table(heads, [...ms.map(line), line(tot)], [...ms.map(() => ''), 'total'])}</table></div></details>
    <details class="card" id="pv-prod" ${view.open.has('pv-prod') || !view.open.size ? 'open' : ''}><summary>Par produit</summary><p class="muted">Touche un produit pour ouvrir ses réglages.</p><div>${productLines(r)}</div></details>
    ${r.scope.some(x => x.a.programs.length) ? capacityBlock(r) : ''}`;
}

// Manque de capacité : premier mois dépassé et besoin jusqu'au palier de capacité suivant.
function capacityShortfall(a, weekly) {
  const isOver = w => w.people > w.cap || w.hours > w.limit;
  const first = weekly.find(isOver);
  if (!first) return null;
  const month = first.date.slice(0, 7);
  const next = (a.capacitySteps || []).map(c => c.date).filter(d => d && d > month).sort()[0];
  const win = weekly.filter(w => w.date.slice(0, 7) >= month && (!next || w.date.slice(0, 7) < next));
  const people = Math.ceil(Math.max(...win.map(w => w.people))), hours = Math.ceil(Math.max(...win.map(w => w.hours)) * 10) / 10;
  return { month, next, people, hours, cap: first.cap, limit: first.limit,
    places: first.cap === Infinity ? 0 : Math.max(0, people - first.cap), missingHours: first.limit === Infinity ? 0 : Math.max(0, hours - first.limit) };
}
// Alerte avec les trois leviers : capacité, temps par cliente, coût d'une embauche.
function capacityAlert(a, ai, sf, id) {
  const p = 'apps.' + ai;
  const what = [sf.places > 0 ? `il manque <b>${num(sf.places)} place${sf.places > 1 ? 's' : ''}</b> (${num(sf.people)} clientes en même temps pour ${num(sf.cap)})` : '',
    sf.missingHours > 0 ? `il manque <b>${num(Math.round(sf.missingHours * 10) / 10)} h</b> de coaching par semaine (${num(sf.hours)} h pour ${num(sf.limit)} h)` : ''].filter(Boolean).join(' et ');
  const progs = a.programs.map((q, j) => ({ q, j })).filter(x => x.q.enabled);
  return `<div class="cap-alert" id="${id}">
      <p><b>${monthName(sf.month).replace(/^./, c => c.toUpperCase())}</b>${sf.next ? ` (jusqu'à ton palier de ${monthName(sf.next)})` : ''} : ${what}.</p>
      <div class="levers">
        <button data-capfix="${ai}" data-month="${sf.month}" data-people="${sf.people}" data-hours="${Math.ceil(sf.hours)}">Augmenter la capacité en ${monthName(sf.month)}</button>
        <a class="lever" href="#charges" data-goto="charges" data-open="" data-anchor="ch-coach" data-app="${ai}">Coût d'une embauche</a>
      </div>
      <details class="fold" id="${id}-time" ${view.open.has(id + '-time') ? 'open' : ''}><summary>Réduire le temps par cliente</summary>
        ${sf.places > 0 ? '<p class="muted">Utile pour les heures seulement : moins de temps par cliente ne crée pas de places en plus.</p>' : ''}
        <div class="grid">${progs.map(({ q, j }) => field(`${progName(a, q)} (minutes / cliente / semaine)`, `${p}.programs.${j}.coach`, q.coach)).join('')}</div>
      </details>
      <p class="muted">« Augmenter la capacité » ajoute un palier en ${monthName(sf.month)} avec ${num(sf.people)} places et ${num(Math.ceil(sf.hours))} h par semaine, puis t'emmène dans « Capacité de coaching » pour l'ajuster.</p>
    </div>`;
}

// Capacité de coaching : par mois, le pic de clientes en même temps face à la capacité prévue.
function capacityChart(x) {
  const months = new Map();
  for (const w of x.weekly) {
    const k = w.date.slice(0, 7);
    if (!inPeriod(k)) continue;
    const m = months.get(k) || { month: k, people: 0, hours: 0, cap: w.cap, limit: w.limit };
    m.people = Math.max(m.people, w.people); m.hours = Math.max(m.hours, w.hours); m.cap = w.cap; m.limit = w.limit;
    months.set(k, m);
  }
  const list = [...months.values()];
  if (!list.length) return '';
  const W = Math.max(320, list.length * 26), H = 170, left = 34, bottom = 22, top = 8;
  const raw = Math.max(5, ...list.map(m => Math.max(m.people, m.cap === Infinity ? 0 : m.cap)));
  const tick = Math.max(5, Math.ceil(raw / 4 / 5) * 5), max = Math.ceil(raw / tick) * tick;
  const y = v => top + (H - top - bottom) * (1 - v / max), bw = (W - left) / list.length;
  const every = Math.max(1, Math.ceil(list.length / 12));
  const MOIS = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];
  const capPath = list.map((m, i) => m.cap === Infinity ? '' : `${i && list[i - 1].cap !== Infinity ? 'L' : 'M'}${left + i * bw},${y(m.cap)} L${left + (i + 1) * bw},${y(m.cap)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Clientes en même temps et capacité">`
    + Array.from({ length: max / tick + 1 }, (_, k) => k * tick).map(t => `<line class="grid-line" x1="${left}" x2="${W}" y1="${y(t)}" y2="${y(t)}"/><text x="${left - 6}" y="${y(t) + 3}" text-anchor="end">${t}</text>`).join('')
    + list.map((m, i) => {
      const bx = left + i * bw + bw * .18, w = bw * .64, over = m.people > m.cap || m.hours > m.limit;
      const label = i % every === 0 ? `<text x="${bx + w / 2}" y="${H - 6}" text-anchor="middle">${MOIS[+m.month.slice(5) - 1]}${list.length > 12 ? ' ' + m.month.slice(2, 4) : ''}</text>` : '';
      return `<g><title>${monthName(m.month)} : ${num(m.people)} clientes en même temps${m.cap === Infinity ? '' : ` pour ${num(m.cap)} places`}, ${m.hours.toFixed(1)} h de coaching${m.limit === Infinity ? '' : ` pour ${num(m.limit)} h`}</title>
        <rect x="${bx}" y="${y(m.people)}" width="${w}" height="${y(0) - y(m.people)}" rx="2" fill="${over ? 'var(--bad)' : 'var(--k-ins)'}"/></g>${label}`;
    }).join('')
    + (capPath ? `<path d="${capPath}" fill="none" stroke="var(--ink)" stroke-width="2" stroke-dasharray="5 4"/>` : '') + '</svg>';
}

function capacityBlock(r) {
  const apps = r.scope.filter(x => x.a.programs.length);
  const wr = apps.flatMap(x => x.weekly.filter(w => inPeriod(w.date.slice(0, 7))).map(w => ({ ...w, name: x.a.name })));
  const over = wr.filter(w => w.people > w.cap || w.hours > w.limit).length;
  return `<h2>Capacité de coaching</h2><div class="kpis">
      <div class="kpi"><small>Pic de clientes en même temps</small><b>${num(Math.max(0, ...wr.map(w => w.people)))}</b></div>
      <div class="kpi"><small>Pic d'heures de coaching / semaine</small><b>${Math.max(0, ...wr.map(w => w.hours)).toFixed(1)} h</b></div>
      <div class="kpi"><small>Semaines au-dessus de la capacité</small><b class="${over ? 'bad' : 'good'}">${over}</b></div>
      <div class="kpi"><small>En attente en fin de période</small><b>${num(wr.at(-1)?.waiting || 0)}</b></div>
    </div>
    ${apps.map(x => `<div class="card"><div class="legend"><span><i style="background:var(--k-ins)"></i>Clientes en même temps (pic du mois)</span><span><i style="background:var(--bad)"></i>Au-dessus de la capacité</span><span><i class="dash"></i>Capacité prévue</span></div>
      <div class="chart cap-chart">${capacityChart(x)}</div>
      ${(() => { const ai = state.apps.indexOf(x.a), sf = capacityShortfall(x.a, x.weekly.filter(w => inPeriod(w.date.slice(0, 7)))); return sf ? capacityAlert(x.a, ai, sf, 'pv-alert-' + ai) : '<p class="muted">La capacité prévue suffit sur toute la période.</p>'; })()}
      <p class="muted"><a href="#produits" data-goto="produits" data-open="pr-cap" data-anchor="pr-cap" data-app="${state.apps.indexOf(x.a)}">Voir la capacité de coaching</a></p></div>`).join('')}
    <details class="card" id="c-weeks"><summary>Capacité semaine par semaine</summary>
      <div class="scroll"><table>${table(['Semaine', 'Application', 'Demande', 'Inscriptions', 'En cours', 'Capacité', 'Heures', 'En attente'],
        wr.map(w => [w.date, esc(w.name), num(w.demand), num(w.admitted), num(w.people), w.cap === Infinity ? '—' : w.cap, w.hours.toFixed(1) + (w.limit === Infinity ? '' : ' / ' + w.limit), num(w.waiting)]))}</table></div></details>`;
}

// ---------- Charges ----------

const CHARGE_TYPES = [['fixe', 'Fixe, par mois'], ['unique', 'Ponctuelle (une seule fois)'], ['cliente', 'Par cliente active, par mois'], ['inscription', 'Par inscription à un programme'], ['ca', 'Pourcentage du chiffre d\'affaires']];
const AMOUNT_LABEL = { fixe: 'Montant (€ / mois)', unique: 'Montant (€, une fois)', cliente: 'Montant (€ / cliente / mois)', inscription: 'Montant (€ / inscription)', ca: 'Pourcentage (%)' };
const CAT_NAME = Object.fromEntries(CHARGE_CATEGORIES);
const CAT_KIND = { tech: 'sub', contenu: 'ins', logiciels: 'ins', paiement: 'price', marketing: 'promo', honoraires: 'cal', banque: 'cal', locaux: 'cal', impots: 'price', coaching: 'ins', personnel: 'promo', autre: 'sub' };
const ANCHOR_NAME = { first: 'début des prévisions', product: 'démarrage du produit', launch: 'lancement commercial', sub: 'ouverture des abonnements' };
const unitOf = c => ({ fixe: ' / mois', unique: ' une fois', cliente: ' / cliente / mois', inscription: ' / inscription', ca: '' }[c.type] || '');
const amountText = (c, v) => c.type === 'ca' ? `${price(v).replace(' €', '')} % du CA` : `${price(v)}${unitOf(c)}`;
function whenText(c, dates) {
  const start = chargeStart(c, dates);
  const from = c.anchor && c.anchor !== 'date' ? `${ANCHOR_NAME[c.anchor]}${+c.offset ? ' + ' + num(+c.offset) + ' mois' : ''}` : '';
  const end = c.end ? ` jusqu'à ${monthName(c.end)}` : '';
  if (c.type === 'unique') return `en ${start ? monthName(start) : monthName(dates.first)}${from ? ' (' + from + ')' : ''}`;
  return `${start ? 'dès ' + monthName(start) : 'dès le début'}${from ? ' (' + from + ')' : ''}${end}`;
}
function chargeSummary(c, a, dates) {
  const prog = a && a.programs.find(p => p.id === c.scope);
  const scope = !a ? '' : c.scope === 'sub' ? ' · ' + esc(soloName(a)) : prog ? ' · ' + esc(progName(a, prog)) : '';
  const steps = (c.steps || []).length ? ' → ' + [...c.steps].sort((x, y) => x.after - y.after).map(st => `${amountText(c, st.amount)} à +${num(st.after)} mois`).join(' → ') : '';
  return `${amountText(c, c.amount)}${steps} · ${whenText(c, dates)}${scope}`;
}
const badge = c => !(+c.amount) && !(c.steps || []).some(st => +st.amount) ? '<span class="tag todo">À compléter</span>' : c.estimate ? '<span class="tag est">Estimation</span>' : '<span class="tag on">Confirmé</span>';

function chargeEditor(c, t, a, dates, scopes) {
  const id = 'ch' + c.id;
  const anchors = CHARGE_ANCHORS.filter(([k]) => k !== 'product' || (a && c.scope && c.scope !== 'app'));
  return `<details class="card charge" id="${id}" ${view.open.has(id) ? 'open' : ''}><summary><span>${esc(c.name)} ${badge(c)}<br><span class="sum-sub">${chargeSummary(c, a, dates)}</span></span></summary>
    ${fields(c, t, [['name', 'Nom', 'text']])}
    <div class="grid">${select('Catégorie', t + '.category', c.category, CHARGE_CATEGORIES).replace('<label>', '<label class="wide">')}${select('Type', t + '.type', c.type, a ? CHARGE_TYPES : CHARGE_TYPES.filter(([k]) => k === 'fixe' || k === 'unique'))}${field(AMOUNT_LABEL[c.type] || 'Montant', t + '.amount', c.amount)}</div>
    ${scopes ? '<div class="grid">' + select('Rattachée à', t + '.scope', c.scope || 'app', scopes).replace('<label>', '<label class="wide">') + '</div>' : ''}
    <h4>${c.type === 'unique' ? 'Quand' : 'Démarrage et fin'}</h4>
    <div class="grid">${select(c.type === 'unique' ? 'Payée au' : 'Commence au', t + '.anchor', c.anchor || 'date', anchors).replace('<label>', '<label class="wide">')}
      ${c.anchor === 'date' ? monthField('Mois', t + '.start', c.start, 'dès le début') : field('Décalage (mois après)', t + '.offset', c.offset || 0)}
      ${c.type === 'unique' ? '' : monthField('Fin', t + '.end', c.end, 'sans fin')}</div>
    <p class="muted">Calculé : ${whenText(c, dates)}. Si la date repère change dans ton calendrier, la charge suit.</p>
    ${c.type === 'unique' ? '' : `<h4>Montée en charge</h4>
    ${(c.steps || []).map((st, k) => lineEditor(st, `${t}.steps.${k}`, [['after', 'Au bout de (mois)'], ['amount', c.type === 'ca' ? 'Nouveau %' : 'Nouveau montant (€)']], 'Supprimer ce palier')).join('')}
    <div class="row"><button data-add="${t}.steps">Ajouter un palier</button></div>`}
    ${check('Montant confirmé (sinon, c\'est une estimation)', t + '.estimate_ok', !c.estimate)}
    ${fields(c, t, [['note', 'Hypothèse, source ou remarque', 'text']])}
    <div class="row"><button class="danger" data-remove="${t}">Supprimer la charge</button></div></details>`;
}

// Charges mensuelles fixes à quelques dates clés : on voit la montée en charge d'un coup d'œil.
function chargeRamp(list, dates, extra = []) {
  const base = dates.launch || dates.first;
  if (!base) return '';
  const cols = [['Début', dates.first], ['Lancement', dates.launch], ['+ 6 mois', addMonths(base, 6)], ['+ 1 an', addMonths(base, 12)], ['+ 2 ans', addMonths(base, 24)]].filter(x => x[1]);
  const fixedAt = (c, m) => c.type === 'fixe' ? chargeAt(c, m, dates) || 0 : 0;
  const cats = CHARGE_CATEGORIES.filter(([k]) => list.some(c => c.category === k && cols.some(([, m]) => fixedAt(c, m))));
  const rows = cats.map(([k, n]) => [`<span class="cat-dot k-${CAT_KIND[k]}"></span>${esc(n)}`, ...cols.map(([, m]) => money(list.filter(c => c.category === k).reduce((t, c) => t + fixedAt(c, m), 0)))]);
  const totals = cols.map(([, m]) => list.reduce((t, c) => t + fixedAt(c, m), 0));
  rows.push(['<b>Total par mois</b>', ...totals.map(v => `<b>${money(v)}</b>`)]);
  return `<div class="scroll"><table class="ramp">${table(['', ...cols.map(([l, m]) => `${l}<br><small>${monthName(m)}</small>`)], rows, [...cats.map(() => ''), 'total'])}</table></div>
    <p class="muted">Charges fixes mensuelles seulement. S'y ajoutent les charges ponctuelles, les frais proportionnels au CA, par cliente ou par inscription${extra.length ? ', et ' + extra.join(', ') : ''}.</p>`;
}

function chargeGroups(list, path, a, dates, scopes) {
  return CHARGE_CATEGORIES.map(([k, n]) => {
    const items = list.map((c, j) => ({ c, j })).filter(x => (x.c.category || 'autre') === k);
    if (!items.length) return '';
    const id = (a ? 'cg-' : 'sg-') + k;
    const todo = items.filter(x => badge(x.c).includes('todo')).length;
    return section(id, CAT_KIND[k], n, `${items.length} charge${items.length > 1 ? 's' : ''}${todo ? ` · ${todo} à compléter` : ''}`,
      items.map(({ c, j }) => chargeEditor(c, `${path}.${j}`, a, dates, scopes)).join(''));
  }).join('');
}

function chargesPage(a, i) {
  const p = 'apps.' + i;
  const scopes = [['app', 'Commune à tous les produits ' + a.name], ['sub', soloName(a)], ...a.programs.map(q => [q.id, progName(a, q)])];
  const dates = appDates([a]), all = appDates(state.apps);
  const sh = state.shared;
  return `<div class="hero"><div><small>Charges fixes de ${esc(a.name)} par mois</small><div class="big">${money((a.charges || []).reduce((t, c) => t + (c.type === 'fixe' ? chargeAt(c, addMonths(dates.launch || dates.first, 12), dates) || 0 : 0), 0))}</div><small>un an après le lancement, hors structure</small></div>
      <div class="split"><div><span>Charges</span><b>${(a.charges || []).length}</b></div><div><span>À compléter</span><b>${(a.charges || []).filter(c => badge(c).includes('todo')).length}</b></div>
        <div><span>Estimations</span><b>${(a.charges || []).filter(c => badge(c).includes('est')).length}</b></div><div><span>Confirmées</span><b>${(a.charges || []).filter(c => !c.estimate).length}</b></div></div></div>
    <details class="card" id="ch-ramp" ${view.open.has('ch-ramp') || !view.open.size ? 'open' : ''}><summary>Montée en charge de ${esc(a.name)}</summary>${chargeRamp(a.charges || [], dates, a.programs.length ? ['le coaching'] : [])}</details>
    <h2>Charges de ${esc(a.name)}</h2>
    <p class="muted">Classées comme dans un compte d'exploitation. Chaque charge démarre à une date repère de ton calendrier (et la suit si elle bouge), peut monter par paliers et reste une estimation tant que tu ne l'as pas confirmée. Rattache-la au produit qui la provoque pour voir sa vraie rentabilité.</p>
    ${chargeGroups(a.charges || [], p + '.charges', a, dates, scopes)}
    <div class="row"><button data-add="${p}.charges">Ajouter une charge</button></div>
    ${a.programs.length ? `<div class="card" id="ch-coach"><h4>Coaching</h4>${fields(a, p, [['coachRate', 'Coût du coaching (€ / heure)']])}
      <p class="muted">Multiplié par les heures de coaching de chaque programme (minutes par cliente et par semaine, dans Produits). Laisse 0 si tu coaches toi-même et ne te rémunères pas à l'heure. Si tu embauches, indique ici le coût horaire moyen (ou ajoute une charge fixe pour un salaire).</p></div>` : ''}
    <h2>Charges de structure Om Holistic</h2>
    <p class="muted">Communes à toutes les applications (banque, assurance, outils, locaux, personnel…), réparties entre elles.</p>
    <div class="card">${select('Répartition entre les applications', 'shared.key', sh.key, [['ca', 'Au prorata du chiffre d\'affaires'], ['egal', 'À parts égales']])}</div>
    <details class="card" id="sh-ramp" ${view.open.has('sh-ramp') ? 'open' : ''}><summary>Montée en charge de la structure</summary>${chargeRamp(sh.charges, all)}</details>
    ${chargeGroups(sh.charges, 'shared.charges', null, all, null)}
    <div class="row"><button data-add="shared.charges">Ajouter une charge de structure</button></div>`;
}

// ---------- Compte d'exploitation ----------

const PNL_ROWS = [
  ['ca', 'Chiffre d\'affaires', 'head'], ['fees', 'Commissions et frais de paiement', 'cost'], ['variable', 'Coûts par cliente et par inscription', 'cost'],
  ['coaching', 'Coaching', 'cost'], ['margin', 'Marge sur coûts variables', 'sub'], ['fixed', 'Charges fixes', 'cost'],
  ['contribution', 'Contribution', 'sub'], ['structure', 'Quote-part structure Om Holistic', 'cost'], ['result', 'Résultat d\'exploitation', 'total']
];

function pnlColumns(r) {
  if (view.app === 'all') {
    const cols = r.all.map(x => { const s = r.summary(x); return { name: x.a.name, go: { page: 'produits', app: state.apps.indexOf(x.a) }, v: { ...s.total, structure: s.structure } }; });
    const tot = {};
    for (const [k] of PNL_ROWS) tot[k] = cols.reduce((t, c) => t + c.v[k], 0);
    return { cols, total: tot };
  }
  const x = r.scope[0], s = r.summary(x);
  const cols = productKeys(x.a).map((k, j) => ({ name: k.name, off: k.off, go: { page: 'produits', open: j ? 'p' + (j - 1) : 'sd' }, v: { ...(s.cols[k.key] || {}), structure: null, result: null } }));
  cols.push({ name: 'Commun', common: true, go: { page: 'charges' }, v: { ca: null, fees: null, variable: null, coaching: null, margin: null, fixed: s.commonFixed, contribution: -s.commonFixed, structure: s.structure, result: null } });
  return { cols, total: { ...s.total, structure: s.structure } };
}

// Compte d'exploitation par nature de charge (présentation classique).
function natureCard(r) {
  const sums = r.scope.map(x => r.summary(x));
  const ca = sums.reduce((t, s) => t + s.total.ca, 0), result = sums.reduce((t, s) => t + s.total.result, 0);
  const cats = {};
  for (const s of sums) for (const k in s.cats) cats[k] = (cats[k] || 0) + s.cats[k];
  const lines = CHARGE_CATEGORIES.filter(([k]) => cats[k] > 0.005);
  const total = lines.reduce((t, [k]) => t + cats[k], 0);
  const pct = v => ca ? `${(v / ca * 100).toFixed(1)} %` : '—';
  const rows = [['<b>Chiffre d\'affaires' + (state.vat.ttc ? ' HT' : '') + '</b>', `<b>${money(ca)}</b>`, '100 %'],
    ...lines.map(([k, n]) => [`<span class="cat-dot k-${CAT_KIND[k]}"></span>${esc(n)}`, signed(-cats[k]), pct(cats[k])]),
    ['Total des charges', signed(-total), pct(total)], ['<b>Résultat d\'exploitation</b>', `<b>${signed(result)}</b>`, pct(result)]];
  return `<details class="card" id="r-nature" ${view.open.has('r-nature') ? 'open' : ''}><summary>Compte d'exploitation par nature</summary>
    <p class="muted">Les charges regroupées par catégorie, structure Om Holistic comprise${view.app === 'all' ? '' : ' (quote-part de ' + esc(r.scope[0].a.name) + ')'}. <a href="#charges">Voir les charges</a></p>
    <div class="scroll"><table class="pnl nature">${table(['', 'Montant', '% du CA'], rows, [...rows.map((_, i) => i === rows.length - 1 ? 'total' : i === rows.length - 2 ? 'sub' : '')])}</table></div></details>`;
}

// Résultat net de la société selon chaque implantation (toutes les applications).
function implantCard(r) {
  const im = state.implantation;
  const sums = r.all.map(x => r.summary(x));
  const ca = sums.reduce((t, s) => t + s.total.ca, 0), result = sums.reduce((t, s) => t + s.total.result, 0);
  const months = new Set(r.all.flatMap(x => x.months.filter(m => inPeriod(m.month)).map(m => m.month))).size || 1;
  const res = im.scenarios.map(sc => ({ sc, ...afterTax(sc, ca, result, months) }));
  const yearCa = ca * 12 / months;
  const over = x => +x.sc.caLimit > 0 && yearCa > +x.sc.caLimit;
  const allowed = res.filter(x => !over(x));
  const best = (allowed.length ? allowed : res).reduce((b, x) => x.net > b.net ? x : b, (allowed.length ? allowed : res)[0]);
  const cur = res.find(x => x.sc.id === im.current) || res[0];
  const row = x => [`${x.sc.id === im.current ? '<b>' : ''}${esc(x.sc.name)}${x.sc.id === im.current ? '</b>' : ''}${x === best ? ' <span class="tag on">Meilleur</span>' : ''}${over(x) ? ' <span class="tag todo">Plafond de CA dépassé</span>' : ''}`,
    signed(-x.fixed || 0), signed(-x.social || 0), signed(-(x.tax + x.dist) || 0), `<b>${signed(x.net)}</b>`, ca ? `${(x.net / ca * 100).toFixed(0)} %` : '—'];
  return `<details class="card" id="r-implant" ${view.open.has('r-implant') || !view.open.size ? 'open' : ''}><summary><span>Résultat net selon l'implantation<br><span class="sum-sub">${esc(cur.sc.name)} : ${money(cur.net)} ${periodName()}</span></span></summary>
    <div class="grid">${select('Implantation retenue', 'implantation.current', im.current, im.scenarios.map(x => [x.id, x.name])).replace('<label>', '<label class="wide">')}</div>
    <div class="net-split"><div><span>Résultat d'exploitation</span><b>${money(result)}</b></div><div><span>Frais de structure</span><b>${money(-cur.fixed || 0)}</b></div><div><span>Cotisations sociales</span><b>${money(-cur.social || 0)}</b></div><div><span>Impôts</span><b>${money(-(cur.tax + cur.dist) || 0)}</b></div><div class="net"><span>Net pour toi</span><b class="${cur.net < 0 ? 'neg' : ''}">${money(cur.net)}</b></div></div>
    ${over(cur) ? `<p class="warn">Ton chiffre d'affaires (environ ${money(yearCa)} par an) dépasse le plafond de ${money(+cur.sc.caLimit)} de ce statut.</p>` : ''}
    <h4>Comparaison des implantations</h4>
    <div class="scroll"><table class="pnl">${table(['Implantation', 'Frais', 'Cotisations', 'Impôts', 'Net', '% du CA'], res.map(row))}</table></div>
    <p class="warn">Taux indicatifs, à faire valider par un conseiller fiscal. Le lieu où tu vis décide en général de ton imposition, et la TVA européenne reste due sur les ventes aux clientes européennes quelle que soit l'implantation. Toutes les applications Om Holistic sont comptées ensemble.</p>
    <p class="muted"><a href="#reglages" data-goto="reglages" data-open="st-implant" data-anchor="st-implant">Modifier les taux et les frais de chaque implantation</a></p></details>`;
}

function resultatPage() {
  const r = results();
  const { cols, total } = pnlColumns(r);
  const rate = total.ca ? total.result / total.ca * 100 : 0;
  const cell = (row, v) => v === null || v === undefined ? '<span class="muted">—</span>' : row[2] === 'cost' ? (v ? signed(-v) : money(0)) : row[2] === 'head' ? money(v) : `<b>${signed(v)}</b>`;
  const rows = PNL_ROWS.map(row => [row[1], ...cols.map(c => cell(row, c.v[row[0]])), cell(row, total[row[0]])]);
  const cls = PNL_ROWS.map(row => row[2] === 'total' ? 'total' : row[2] === 'sub' ? 'sub' : '');
  // Chaque nom de produit (ou d'application) ouvre sa fiche de réglages.
  const link = (c, html) => `<a class="golink" href="#${c.go.page}" data-goto="${c.go.page}" data-open="${c.go.open || ''}" data-anchor="${c.go.open || ''}"${c.go.app !== undefined ? ` data-app="${c.go.app}"` : ''} title="Ouvrir les réglages">${html}</a>`;
  const tableHtml = `<div class="scroll"><table class="pnl">${table(['', ...cols.map(c => link(c, esc(c.name))), 'Total'], rows, cls)}</table></div>`;
  // Barres : chiffre d'affaires et contribution de chaque colonne.
  const bars = cols.filter(c => !c.common);
  const key = view.app === 'all' ? 'result' : 'contribution';
  const max = Math.max(1, ...bars.map(c => Math.max(c.v.ca || 0, Math.abs(c.v[key] || 0))));
  const barsHtml = bars.map(c => {
    const v = c.v[key] || 0;
    return `<div class="prod"><span>${link(c, esc(c.name))}${c.off ? ' <span class="tag">Inactif</span>' : ''}</span><b class="${v < 0 ? 'neg' : ''}">${money(v)}</b>
      <span class="meter"><i style="width:${((c.v.ca || 0) / max * 100).toFixed(1)}%;background:var(--sage-soft)"></i></span>
      <span class="meter"><i style="width:${(Math.abs(v) / max * 100).toFixed(1)}%;background:${v < 0 ? 'var(--bad)' : 'var(--good)'}"></i></span>
      <span class="muted">CA ${money(c.v.ca || 0)} · ${c.v.ca ? Math.round(v / c.v.ca * 100) : 0} % du CA</span></div>`;
  }).join('');
  return `<div class="hero">
      <div><small>Résultat d'exploitation ${periodName()}</small><div class="big ${total.result < 0 ? 'neg-hero' : ''}">${money(total.result)}</div></div>
      <div class="split"><div><span>Chiffre d'affaires${state.vat.ttc ? ' HT' : ''}</span><b>${money(total.ca)}</b></div><div><span>Marge d'exploitation</span><b>${rate.toFixed(1)} %</b></div></div>
    </div>
    <details class="card" id="r-bars" open><summary>${view.app === 'all' ? 'Résultat par application' : 'Contribution par produit'}</summary>
        <div class="legend"><span><i style="background:var(--sage-soft)"></i>Chiffre d'affaires</span><span><i style="background:var(--good)"></i>${view.app === 'all' ? 'Résultat' : 'Contribution'}</span></div>
        <div>${barsHtml}</div></details>
    <details class="card" id="r-table" open><summary>Compte d'exploitation ${view.app === 'all' ? 'par application' : 'par produit'}</summary><p class="muted">Touche le nom d'${view.app === 'all' ? 'une application' : 'un produit'} pour ouvrir ses réglages.</p>${tableHtml}</details>
    ${natureCard(r)}
    ${implantCard(r)}
    <details class="card" id="r-read"><summary>Comment lire ce compte</summary>
        <p class="muted">La <b>contribution</b> d'un produit, c'est ce qu'il rapporte une fois payés ses propres coûts : frais de paiement, coûts par cliente, coaching et charges fixes qui lui sont rattachées.
        Les charges communes de l'application et la quote-part de structure Om Holistic sont ensuite déduites pour obtenir le <b>résultat d'exploitation</b>, avant impôts et cotisations personnelles.</p></details>`;
}

// ---------- Rendu ----------

function renderToolbar() {
  const settings = SETTINGS_PAGES.includes(view.page);
  if (settings && view.app === 'all') view.app = '0';
  $('app').innerHTML = (settings ? '' : '<option value="all">Om Holistic · consolidé</option>')
    + state.apps.map((a, i) => `<option value="${i}">${esc(a.name)}</option>`).join('');
  $('app').value = view.app;
  document.querySelectorAll('.period-only').forEach(el => { el.hidden = settings; });
  const years = [...new Set(state.apps.flatMap(a => { const y = +appStart(a).slice(0, 4); return [0, 1, 2, 3, 4, 5].map(k => y + k); }))].sort();
  if (!years.includes(view.year)) view.year = years[0];
  $('year').innerHTML = years.map(y => `<option>${y}</option>`).join('');
  $('year').value = view.year;
  $('period').value = view.period;
  document.querySelectorAll('#tabs a').forEach(a => a.classList.toggle('current', a.hash === '#' + view.page));
}

function render(fresh = false) {
  // Garde ouvertes les zones dépliées, sauf en arrivant sur une nouvelle page.
  view.open = view.goto ? new Set([view.goto.open, view.goto.anchor]) : fresh ? new Set() : new Set([...document.querySelectorAll('#page details[open]')].map(d => d.id));
  renderToolbar();
  const i = +view.app || 0, a = state.apps[i];
  const pages = { synthese: synthesePage, resultat: resultatPage, previsionnel: previsionnelPage, charges: () => chargesPage(a, i), produits: () => productsPage(a, i), reglages: () => settingsPage(a, i) };
  $('page').innerHTML = pages[view.page]();
}

// ---------- Événements ----------

function route() {
  const page = location.hash.slice(1);
  view.page = PAGES.includes(page) ? page : 'synthese';
  render(true);
  // Arrivée depuis le calendrier : on ouvre la zone concernée et on la met en évidence.
  const target = view.goto && document.getElementById(view.goto.anchor);
  view.goto = null;
  if (target) { target.scrollIntoView({ block: 'center' }); target.classList.add('flash'); setTimeout(() => target.classList.remove('flash'), 1600); }
  else window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

document.addEventListener('change', async e => {
  const t = e.target;
  const pick = t.closest?.('.monthpick');
  if (pick) {
    const [m, y] = [...pick.querySelectorAll('select')].map(x => x.value);
    if ((m && y) || (!m && !y)) {
      const [o, k] = resolve(pick.dataset.mpath);
      o[k] = m && y ? `${y}-${m}` : '';
      save(); render();
    }
  } else if (t.dataset.path) {
    const [o, k] = resolve(t.dataset.path);
    if (k === 'estimate_ok') o.estimate = !t.checked;
    else o[k] = t.type === 'checkbox' ? t.checked : t.type === 'number' ? Math.max(0, +t.value || 0) : t.value;
    save();
    // On redessine après que le focus est passé au champ suivant, puis on lui rend le focus,
    // pour que les résumés se mettent à jour sans fermer le clavier.
    setTimeout(() => {
      const next = document.activeElement?.dataset?.path;
      render();
      if (next) document.querySelector(`[data-path="${CSS.escape(next)}"]`)?.focus({ preventScroll: true });
    }, 0);
  } else if (t.id === 'app') { view.app = t.value; render(true); }
  else if (t.id === 'year') { view.year = +t.value; render(); }
  else if (t.id === 'period') { view.period = +t.value; render(); }
  else if (t.id === 'import') {
    try {
      const x = JSON.parse(await t.files[0].text());
      if (!isValidState(x)) throw Error('Ce fichier ne ressemble pas à un export de ce tableau de bord.');
      state = migrate(x); view.app = '0'; save(); render();
    } catch (err) { $('importMsg').textContent = err.message; }
  }
});

document.addEventListener('click', e => {
  const go = e.target.closest?.('[data-goto]');
  if (go) {
    e.preventDefault();
    view.goto = { open: go.dataset.open, anchor: go.dataset.anchor };
    if (go.dataset.app !== undefined) view.app = go.dataset.app;
    if (location.hash === '#' + go.dataset.goto) route(); else location.hash = go.dataset.goto;
    return;
  }
  const t = e.target.closest?.('button') || e.target;
  if (t.dataset.add) {
    const [o, k] = resolve(t.dataset.add);
    const fresh = {
      programs: () => program('Nouveau programme', thisMonth, [100, 150, 200], 8),
      paliers: () => ({ rate: 2, weeks: 8 }),
      steps: () => { const l = o[k][o[k].length - 1];
        if (o.type) return l ? { after: +l.after + 12, amount: +l.amount } : { after: 12, amount: +o.amount || 0 };
        return l ? { months: +l.months + 12, count: +l.count * 3 } : { months: 6, count: 100 }; },
      promos: () => ({ start: thisMonth, end: thisMonth, price: 100 }),
      capacitySteps: () => ({ date: thisMonth, capacity: 20, hours: 15 }),
      cohorts: () => ({ name: ['Cohorte alpha', 'Deuxième cohorte', 'Troisième cohorte'][o[k].length] || `Cohorte ${o[k].length + 1}`, date: thisMonth, size: 10 }),
      scenarios: () => ({ id: newId(), name: 'Nouveau scénario', fixedYear: 0, socialRate: 0, socialBase: 'result', taxRate: 0, taxBase: 'result', distRate: 0, note: '' }),
      charges: () => charge('Nouvelle charge', 'fixe', 0, 'app', '', '', { anchor: 'first' })
    }[k];
    o[k].push(fresh()); save(); render();
  } else if (t.dataset.remove) {
    const [o, k] = resolve(t.dataset.remove);
    o.splice(+k, 1); save(); render();
  } else if (t.dataset.removeApp) {
    state.apps.splice(+t.dataset.removeApp, 1); view.app = '0'; save(); render();
  } else if (t.id === 'reset') { view.confirmReset = true; render();
  } else if (t.id === 'resetNo') { view.confirmReset = false; render();
  } else if (t.dataset.capfix) {
    const a = state.apps[+t.dataset.capfix], month = t.dataset.month;
    a.capacitySteps = a.capacitySteps || [];
    const step = a.capacitySteps.find(c => c.date === month);
    const people = +t.dataset.people, hours = +t.dataset.hours;
    if (step) { step.capacity = Math.max(+step.capacity || 0, people); step.hours = Math.max(+step.hours || 0, hours); }
    else {
      const before = capacityAt(a, month);
      a.capacitySteps.push({ date: month, capacity: Math.max(people, +before?.capacity || 0), hours: Math.max(hours, +before?.hours || 0) });
      a.capacitySteps.sort((x, y) => x.date.localeCompare(y.date));
    }
    save();
    view.app = t.dataset.capfix;
    view.goto = { open: 'pr-cap', anchor: 'pr-cap' };
    if (location.hash === '#produits') route(); else location.hash = 'produits';
  } else if (t.dataset.pgoal) {
    const [o, k] = resolve(t.dataset.pgoal), q = o[k], a = state.apps[+t.dataset.pgoal.split('.')[1]];
    const plan = programGoalPlan(a, a.programs.indexOf(q), simulate(a).months);
    if (plan.segs.length) { q.launch = false; q.palierMode = true; q.paliers = plan.segs; q.target = plan.segs[plan.segs.length - 1].rate; }
    save(); render();
  } else if (t.dataset.goal) {
    const [o, k] = resolve(t.dataset.goal), a = o[k], plan = goalPlan(a);
    if (plan.segs.length) { a.sub.palierMode = true; a.sub.paliers = plan.segs; a.sub.target = plan.segs[plan.segs.length - 1].rate; }
    save(); render();
  } else if (t.id === 'resetYes') { view.confirmReset = false; state = defaultState(); view.app = '0'; save(); render(true);
  } else if (t.id === 'addApp') {
    state.apps.push(application('Nouvelle application')); view.app = String(state.apps.length - 1); save(); render();
  } else if (t.id === 'export') {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
    link.download = 'om-holistic-finances.json';
    link.click();
  }
});

route();
