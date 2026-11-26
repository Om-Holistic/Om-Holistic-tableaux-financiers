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
    field(`Achat du programme depuis l'abonnement (% par an)\nPart des abonnées ${soloName(a)} qui achètent ${q.name} dans l'année`, path + '.fromSolo', q.fromSolo) +
    field(`Abonnement gardé après le programme (%)\nPart des clientes ${progName(a, q)} qui gardent ${soloName(a)} à la fin`, path + '.toSolo', q.toSolo) +
    '</div>' + linkCount(a, q);
}
// Ce que la passerelle représente concrètement : achats par an et abonnées concernées, un an après le lancement du programme.
function linkCount(a, q) {
  if (!(+q.fromSolo > 0) || !q.start) return '';
  const j = a.programs.indexOf(q), from = addMonths(q.start, 12), to = addMonths(q.start, 23);
  const ms = simulate(a).months.filter(m => m.month >= from && m.month <= to);
  if (!ms.length) return '';
  const buys = ms.reduce((t, m) => t + m.products[j].fromSolo, 0), subs = ms[0].direct + ms[0].post;
  return `<p class="muted">Soit environ <b>${num(Math.round(buys))} achats de ${esc(q.name)}</b> entre ${monthName(from)} et ${monthName(to)}, pour environ ${num(Math.round(subs))} abonnées ${esc(soloName(a))} au début de cette période.</p>`;
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

// Chiffres clés affichés sur une carte repliée : petites tuiles « libellé / valeur ».
const pstats = items => `<span class="pstats">${items.filter(Boolean).map(([l, v, cls]) => `<span class="ps${cls ? ' ' + cls : ''}"><small>${l}</small><b>${v}</b></span>`).join('')}</span>`;
const shortMonth = k => k ? MONTHS[+k.slice(5) - 1].slice(0, 4).replace(/\.$/, '') + (MONTHS[+k.slice(5) - 1].length > 4 ? '.' : '') + ' ' + k.slice(0, 4) : '—';
// Simulation de l'application affichée, partagée par les cartes de la page Produits.
let prodSim = null;
// Douze premiers mois de vente d'un produit, à partir d'une date.
function firstYear(from, f) {
  if (!prodSim || !from) return null;
  const end = addMonths(from, 12);
  return prodSim.months.filter(m => m.month >= from && m.month < end).reduce((t, m) => t + f(m), 0);
}
const priceRange = grid => { const xs = phasesOf(grid).map(ph => +ph.price || 0); return xs.length ? (Math.min(...xs) === Math.max(...xs) ? price(xs[0]) : `${price(Math.min(...xs)).replace(/\s?€$/, '')} → ${price(Math.max(...xs))}`) : '—'; };

function programCard(a, q, j, p) {
  const t = p + '.programs.' + j;
  const open = view.open.has('p' + j) ? 'open' : '';
  const launch = q.start ? 'lancement ' + monthName(q.start) : 'sans lancement prévu';
  const cohorts = q.cohorts.map((c, k) => lineEditor(c, `${t}.cohorts.${k}`, [['name', 'Nom', 'text'], ['size', 'Clientes'], ['date', 'Démarrage', 'month']], 'Retirer cette cohorte')).join('');
  const calSummary = [q.cohorts.length ? `${q.cohorts.length} cohorte${q.cohorts.length > 1 ? 's' : ''} de test` : 'pas de cohorte de test', launch].join(' · ');
  const insSummary = `${q.launch ? `${num(q.launchRate)} / sem. pendant ${num(q.launchWeeks)} sem., puis ` : ''}${q.palierMode && q.paliers.length ? q.paliers.map(r => num(r.rate)).join(' → ') + ' / sem. (paliers)' : num(q.initial) + ' → ' + num(q.target) + ' / sem.'}`;
  return `<details class="card product" id="p${j}" ${open}><summary><span>${esc(progName(a, q))} <span class="tag ${q.enabled ? 'on' : ''}">${q.enabled ? 'Actif' : 'Inactif'}</span>${(() => { const gp = q.enabled && (q.goal?.steps || []).length ? programGoalPlan(a, j, (prodSim || simulate(a)).months) : null;
        return gp && gp.segs.length && !(q.palierMode && !q.launch && JSON.stringify(q.paliers) === JSON.stringify(gp.segs)) ? ' <span class="tag todo">Objectif à appliquer</span>' : ''; })()}<br><span class="sum-sub">${calSummary}</span>
      ${pstats([['Prix', priceRange(q.pricing)], ['Durée', `${num(q.duration)} sem.`], ['Coaching', `${num(+q.coach || 0)}${(q.coachSteps || []).length ? ' → ' + num(coachAt(q, '9999-12')) : ''} min`],
        q.enabled && q.start ? ['1re année', `${num(firstYear(q.start, m => m.products[j].admissions) || 0)} inscr.`, 'hi'] : null,
        q.enabled && q.start ? ['CA 1re année', money(firstYear(q.start, m => m.products[j].sales) || 0), 'hi'] : null])}</span></summary>
      <div class="grid head4">
        <label>Programme<span class="tbox"><input data-path="${t}.enabled" type="checkbox" ${q.enabled ? 'checked' : ''}>Actif</span></label>
        ${field('Nom du programme', t + '.name', q.name, 'text')}${field('Durée (semaines)', t + '.duration', q.duration)}${field('Coaching / cliente (min / sem.)', t + '.coach', q.coach)}
      </div>
      <p class="muted">${+q.coach > 0 ? `Soit ${num(Math.round(+q.coach * 10 / 60 * 10) / 10)} h par semaine pour 10 clientes en même temps. ` : ''}${(q.coachSteps || []).length ? `Baisses prévues : ${q.coachSteps.filter(c => c.date).map(c => `${num(+c.minutes || 0)} min dès ${monthName(c.date)}`).join(', ')}. ` : ''}Pour prévoir une baisse dans le temps : <a href="#produits" data-goto="produits" data-open="pr-cap" data-anchor="pr-cap">Capacité de coaching</a>.</p>
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
      ${section('link-p' + j, 'sub', `Passerelles avec ${soloName(a)}`, `${num(q.toSolo)} % gardent ${esc(soloName(a))} · ${num(q.fromSolo)} % des abonnées l'achètent / an`, `
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
      const overH = r.capHours !== null && r.hours > r.capHours;
      res = `<div class="goal-res"><b>${num(r.rate)} inscription${r.rate > 1 ? 's' : ''} / semaine</b><span>${monthName(r.at)} · plan actuel : ${num(Math.round(r.planYear))} / an${r.fromSoloYear >= 1 ? ` · dont ${num(Math.round(r.fromSoloYear))} / an venues de ${esc(soloName(a))}` : ''}</span></div>
        <div class="goal-cap ${overH ? 'bad' : 'ok'}">${num(Math.round(r.hours * 10) / 10)} h de coaching par semaine pour ce programme (${num(Math.ceil(r.parallel))} clientes en même temps à ${num(r.minutes)} min).
        ${r.capHours === null ? 'Capacité illimitée.' : `Heures disponibles à cette date, tous programmes : ${num(r.capHours)} h.${overH ? ' <b>Insuffisant.</b>' : ''}`}</div>
        ${overH ? (() => {
          // Besoin total à cette date : ce programme à l'objectif, plus les autres programmes tels que simulés.
          const m = sim.find(x => x.month === r.at);
          const othersH = a.programs.reduce((s2, p2, k2) => s2 + (k2 !== j && m ? m.products[k2].active * coachAt(p2, r.at) / 60 : 0), 0);
          const hours = Math.ceil((r.hours + othersH) * 10) / 10;
          return capacityAlert(a, state.apps.indexOf(a), { month: r.at, next: '', hours, limit: r.capHours, missingHours: Math.max(0, hours - r.capHours) }, `goal-alert-${j}-${k}`);
        })() : ''}`;
    }
    return `<div class="goal-step"><span class="badge">${k + 1}</span><div>${lineEditor(st, `${t}.goal.steps.${k}`, [['months', 'Au bout de (mois)'], ['count', 'Inscriptions par an']], 'Supprimer ce palier')}${res}</div></div>`;
  }).join('');
  const applied = q.palierMode && !q.launch && JSON.stringify(q.paliers) === JSON.stringify(plan.segs);
  const last = plan.segs[plan.segs.length - 1];
  return section('goal-p' + j, 'ins', 'Objectif d\'inscriptions', g.steps.map(st => `${num(+st.count || 0)} / an à ${num(+st.months || 0)} mois`).join(' · ') + (last && !applied ? ' · <b class="neg">pas encore appliqué</b>' : ''), `
    ${last && !applied ? `<div class="goal-pending"><p><b>Objectif pas encore appliqué.</b> Les résultats suivent toujours ton rythme actuel. Un objectif est un calcul : il ne change rien tant que tu ne l'appliques pas.</p>
      <div class="row"><button data-pgoal="${t}">Appliquer maintenant</button></div></div>` : ''}
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
  return section('goal-sd', 'ins', 'Objectif d\'abonnées', g.steps.map(st => `${num(+st.count || 0)} à ${num(+st.months || 0)} mois`).join(' · ') + (g.kind === 'new' ? ' (nouvelles / an)' : '') + (plan.segs.length && !applied ? ' · <b class="neg">pas encore appliqué</b>' : ''), `
    ${plan.segs.length && !applied ? `<div class="goal-pending"><p><b>Objectif pas encore appliqué.</b> Les résultats suivent toujours ton rythme actuel. Un objectif est un calcul : il ne change rien tant que tu ne l'appliques pas.</p>
      <div class="row"><button data-goal="${p}">Appliquer maintenant</button></div></div>` : ''}
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
  prodSim = simulate(a);
  const p = 'apps.' + i;
  const g = a.sub.directPricing;
  // Le produit « seul » : l'abonnement, avec en option ce qui se passe après un programme.
  const solo = `<details class="card product solo" id="sd" ${view.open.has('sd') ? 'open' : ''}><summary><span>${esc(soloName(a))}${(() => { const gp = cachedGoalPlan(a); return gp.segs.length && !(a.sub.palierMode && JSON.stringify(a.sub.paliers) === JSON.stringify(gp.segs)) ? ' <span class="tag todo">Objectif à appliquer</span>' : ''; })()}<br><span class="sum-sub">Abonnement mensuel · ${a.sub.start ? 'ouverture ' + monthName(a.sub.start) : 'pas encore ouvert'}</span>
      ${pstats([['Prix', priceRange(g) + ' / mois'], +a.sub.trialDays > 0 ? ['Essai', `${num(a.sub.trialDays)} j`] : null,
        a.sub.start ? ['Abonnées à 1 an', num(((m => m ? m.direct + m.post : 0)(prodSim && prodSim.months.find(m => m.month === addMonths(a.sub.start, 11))))), 'hi'] : null,
        a.sub.start ? ['CA 1re année', money(firstYear(a.sub.start, m => m.directCA + m.postCA) || 0), 'hi'] : null])}</span></summary>
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
      ${a.programs.length ? section('conv-sp', 'sub', 'Passerelles avec les programmes', a.programs.map(q => `${esc(q.name)} : ${num(q.fromSolo)} % y vont / an · ${num(q.toSolo)} % restent`).join(' · '), `
        <p class="muted">Mêmes réglages que le bloc « Passerelles » de chaque programme : une modification ici se retrouve là-bas.</p>
        ${a.programs.map((q, j) => `<h4>${esc(progName(a, q))}${q.enabled ? '' : ' (désactivé)'}</h4>${linkFields(a, q, p + '.programs.' + j)}`).join('')}
        <h4>Abonnement après un programme</h4>
        ${fields(a.sub, p + '.sub', [['postDuration', 'Durée moyenne d\'abonnement après un programme (mois)']])}
        <h4>Prix mensuel après un programme</h4>
        ${a.sub.postPricing.map((ph, k) => `<div class="phase-row"><span class="badge">${k + 1}</span>${lineEditor(ph, p + '.sub.postPricing.' + k, [['label', 'Nom', 'text'], ['price', 'Prix (€)'], ['start', 'À partir de', 'month']])}</div>`).join('')}`) : ''}
    </details>`;
  const programs = a.programs.map((q, j) => programCard(a, q, j, p)).join('');
  const progs = a.programs.filter(q => q.enabled);
  const next = timelineItems(a).find(it => it.date >= thisMonth);
  const prices = progs.flatMap(q => phasesOf(q.pricing).map(ph => +ph.price || 0));
  const cap = capacityAt(a, thisMonth), mins = progs.map(q => coachAt(q, thisMonth));
  const range = (xs, f) => xs.length ? (Math.min(...xs) === Math.max(...xs) ? f(xs[0]) : `${f(Math.min(...xs))} → ${f(Math.max(...xs))}`) : '—';
  return `${banner({ label: `Produits de ${esc(a.name)}`, big: `${progs.length + 1} produit${progs.length ? 's' : ''}`,
      note: next ? `Prochaine date : ${next.text.replace(/<[^>]+>/g, '')} · ${monthName(next.date)}` : 'Aucune date à venir',
      tiles: [
        { label: 'Abonnement', value: price(phaseAt(g, thisMonth).price), hint: 'par mois aujourd\'hui', go: { page: 'produits', open: 'sd', anchor: 'sd' } },
        ...(progs.length ? [
          { label: 'Prix des programmes', mini: 'Programmes', value: range(prices, x => price(x)), hint: `${progs.length} programme${progs.length > 1 ? 's' : ''} actif${progs.length > 1 ? 's' : ''}`, go: { page: 'produits', open: 'p0', anchor: 'p0' } },
          { label: 'Heures de coaching', value: cap ? `${num((+cap.hours || 0) + (+cap.hired || 0))} h` : 'illimitées', hint: cap ? `par semaine dès ${monthName(cap.date)}` : 'aucun palier', go: { page: 'produits', open: 'pr-cap', anchor: 'pr-cap' } },
          { label: 'Temps par cliente', value: range(mins, x => num(x) + ' min'), hint: 'par semaine aujourd\'hui', go: { page: 'produits', open: 'pr-cap', anchor: 'pr-coachtime' } }
        ] : [{ label: 'Calendrier', value: num(timelineCount(a)), hint: 'dates', go: { page: 'produits', open: 'pr-cal', anchor: 'pr-cal' } }])
      ] })}
    <p class="muted">Chaque produit de ${esc(a.name)} se déplie pour régler son calendrier, ses prix et son rythme de ventes.</p>
    ${calendarCard(a)}${solo}${programs}
    <div class="row"><button data-add="${p}.programs">Ajouter un programme</button></div>
    ${a.programs.length ? capacityCard(a, p) : ''}`;
}

// Tous les jalons d'une application, dans l'ordre chronologique.
// Chaque jalon indique où il se règle et y mène d'un geste.
function timelineItems(a) {
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
  (a.capacitySteps || []).forEach(c => c.date && items.push({ date: c.date, kind: 'cap', text: 'Capacité de coaching', sub: `${num(c.hours)} h toi${+c.hired ? ` + ${num(c.hired)} h coachs` : ''} / semaine`, go: { page: 'produits', open: 'pr-cap', anchor: 'pr-cap', from: 'Produits › Capacité de coaching' } }));
  items.sort((x, y) => x.date.localeCompare(y.date));
  return items;
}
function timeline(a) {
  const items = timelineItems(a);
  if (!items.length) return '<p class="muted">Aucune date pour l\'instant : ajoute une cohorte de test ou une date de lancement dans Produits et prix.</p>';
  return `<ol class="timeline">${items.map(it => `<li class="${it.kind}"><a href="#${it.go.page}" data-goto="${it.go.page}" data-open="${it.go.open}" data-anchor="${it.go.anchor}">
      <span class="when">${monthName(it.date)}</span><span class="what">${it.text}${it.sub ? ` · <span class="muted">${it.sub}</span>` : ''}<span class="from">${it.go.from} ›</span></span></a></li>`).join('')}</ol>`;
}

// Calendrier de l'application : rassemble les dates saisies dans chaque produit (lecture seule).
const timelineCount = a => (timeline(a).match(/<li /g) || []).length;
function calendarCard(a) {
  const n = timelineCount(a);
  return `<details class="card product tool-cal" id="pr-cal" ${view.open.has('pr-cal') ? 'open' : ''}><summary><span>Calendrier de ${esc(a.name)}<br><span class="sum-sub">${n} dates · à partir de ${monthName(appStart(a))}</span>
      ${(() => { const items = timelineItems(a), nx = items.find(it => it.date >= thisMonth), launches = items.filter(it => it.kind === 'launch');
        return pstats([['Début', shortMonth(appStart(a))], launches.length ? ['Lancements', launches.map(it => shortMonth(it.date)).filter((v, i, xs) => xs.indexOf(v) === i).slice(0, 3).join(' · ')] : null,
          nx ? ['Prochaine date', `${nx.text.replace(/<[^>]+>/g, '').split(' · ')[0]} · ${shortMonth(nx.date)}`, 'hi'] : null]); })()}</span></summary>
      <p class="muted">Ce calendrier ne se saisit pas ici : il rassemble les dates saisies dans chaque produit et dans la capacité de coaching. Touche une date pour aller la modifier. Les prévisions commencent à la première date.</p>
      ${timeline(a)}</details>`;
}
// Temps de coaching par cliente, programme par programme, avec ses baisses prévues dans le temps.
function coachTimeBlock(a, p) {
  const rows = a.programs.map((q, j) => ({ q, j })).filter(x => x.q.enabled).map(({ q, j }) => {
    const t = `${p}.programs.${j}`;
    const steps = (q.coachSteps || []).map((c, k) => lineEditor(c, `${t}.coachSteps.${k}`, [['date', 'À partir de', 'month'], ['minutes', 'Minutes / cliente / semaine']], 'Retirer cette baisse')).join('');
    const now = coachAt(q, '9999-12');
    return `<div class="coach-prog"><p class="coach-name"><b>${esc(progName(a, q))}</b>${(q.coachSteps || []).length ? ` <span class="muted">· ${num(+q.coach || 0)} → ${num(now)} min</span>` : ''}</p>
      <div class="grid">${field('Au départ (minutes / cliente / semaine)', `${t}.coach`, q.coach)}</div>
      ${steps}
      <div class="row"><button data-add="${t}.coachSteps">Prévoir une baisse</button></div></div>`;
  }).join('');
  return `<div class="coach-time" id="pr-coachtime"><h3 class="cap-h">Temps de coaching par cliente</h3>
      <p class="muted">C'est le premier levier : moins de minutes par cliente, c'est plus de clientes avec les mêmes heures. Si l'application prend le relais, prévois une baisse à une date. Elle s'applique à toutes les clientes en cours à partir de ce mois.</p>
      ${rows || '<p class="muted">Aucun programme actif.</p>'}</div>`;
}
// Capacité de coaching : des heures par semaine (les tiennes + celles des coachs embauchées), communes à tous les programmes.
function capacityCard(a, p) {
  const progs = a.programs.filter(q => q.enabled);
  const steps = (a.capacitySteps || []).map((c, j) => {
    const mins = progs.map(q => coachAt(q, c.date || appStart(a))).filter(x => x > 0);
    const avgMin = mins.length ? mins.reduce((t, x) => t + x, 0) / mins.length : 0;
    const total = (+c.hours || 0) + (+c.hired || 0);
    return lineEditor(c, `${p}.capacitySteps.${j}`, [['date', 'À partir de', 'month'], ['hours', 'Mes heures / semaine'], ['hired', 'Coachs embauchées (h / semaine)']], 'Retirer ce palier')
      + `<p class="muted cap-derived">${num(total)} h par semaine${avgMin ? ` · environ ${num(Math.floor(total * 60 / avgMin))} clientes en même temps à ${num(Math.round(avgMin))} min chacune` : ''}${+c.hired && +a.coachRate ? ` · coachs : ${money(+c.hired * a.coachRate * 52 / 12)} / mois` : ''}</p>`;
  }).join('');
  const last = (a.capacitySteps || [])[a.capacitySteps.length - 1];
  return `<details class="card product tool-cap" id="pr-cap" ${view.open.has('pr-cap') ? 'open' : ''}><summary><span>Capacité de coaching<br><span class="sum-sub">${last ? `${a.capacitySteps.length} paliers, tous les programmes` : 'illimitée, aucun palier'}</span>
      ${(() => { const cur = capacityAt(a, thisMonth), ms = progs.map(q => +q.coach || 0), hired = last ? +last.hired || 0 : 0;
        const peak = prodSim && prodSim.weekly && prodSim.weekly.length ? Math.max(...prodSim.weekly.map(w => w.people)) : null;
        return pstats([cur ? ['Au départ', `${num((+cur.hours || 0) + (+cur.hired || 0))} h / sem.`] : null, last ? ['Au dernier palier', `${num((+last.hours || 0) + hired)} h / sem.`, 'hi'] : null,
          ms.length ? ['Temps / cliente', `${num(Math.min(...ms))}${Math.max(...ms) !== Math.min(...ms) ? '–' + num(Math.max(...ms)) : ''} min`] : null,
          hired && +a.coachRate ? ['Coachs', `${money(hired * a.coachRate * 52 / 12)} / mois`] : null,
          peak !== null ? ['Pic de clientes', num(peak)] : null]); })()}</span></summary>
      ${coachTimeBlock(a, p)}
      <h3 class="cap-h">Heures de coaching disponibles</h3>
      <p class="muted">Indique les heures que tu consacres au coaching chaque semaine (pas tes autres heures de travail), et celles de coachs embauchées. Le nombre de clientes possible en découle, selon le temps par cliente de chaque programme. Ajoute un palier à chaque changement.</p>
      ${steps || '<p class="muted">Aucun palier : capacité illimitée.</p>'}
      <div class="row"><button data-add="${p}.capacitySteps">Ajouter un palier</button></div>
      ${fields(a, p, [['coachRate', 'Coût horaire des coachs embauchées (€)']])}
      <p class="muted">Les heures de coachs embauchées sont payées chaque semaine à ce coût, utilisées ou non. Tes propres heures ne coûtent rien ici (ta rémunération est dans Charges).</p>
      ${check('Refuser les inscriptions quand les heures ne suffisent plus', p + '.restrict', a.restrict)}
      ${a.restrict ? check('Mettre les inscriptions refusées en liste d\'attente', p + '.waitlist', a.waitlist) : ''}
      ${a.restrict ? '' : check('Payer les heures qui manquent au coût horaire des coachs', p + '.payMissing', a.payMissing)}
      <p class="muted">Décoché : l'outil inscrit toutes les clientes prévues et te signale en rouge les mois où les heures manquent${a.payMissing ? ' ; ces heures en trop sont alors comptées comme des heures de coachs embauchées, au coût horaire ci-dessus, pour que le résultat reste réaliste' : ''}. Coché : il n'inscrit que ce que tes heures permettent.</p></details>`;
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
  let lastExport = null; try { lastExport = localStorage.getItem('om-last-export'); } catch { /* stockage indisponible */ }
  const days = lastExport ? Math.floor((Date.now() - new Date(lastExport)) / 86400000) : null;
  const im = state.implantation, cur = im.scenarios.find(x => x.id === im.current) || im.scenarios[0];
  return `${banner({ label: 'Réglages', big: `${state.apps.length} application${state.apps.length > 1 ? 's' : ''}`,
      note: state.apps.map(x => esc(x.name)).join(' · '),
      tiles: [
        { label: 'TVA', value: state.vat.ttc ? `${num(state.vat.rate)} %` : 'HT', hint: state.vat.ttc ? 'prix saisis TTC' : 'prix saisis hors taxe', go: { page: 'reglages', open: 'st-vat' } },
        { label: 'Implantation', mini: false, value: cur ? esc(cur.name) : '—', cls: 'txt', hint: 'taux à valider', go: { page: 'reglages', open: 'st-implant' } },
        { label: 'Dernière sauvegarde', mini: 'Sauvegarde', value: days === null ? 'Jamais' : days === 0 ? 'Aujourd\'hui' : `Il y a ${days} j`, cls: days === null || days > 14 ? 'warn-v' : '', hint: 'export du fichier', go: { page: 'reglages', open: 'st-save' } },
        { label: 'Données', mini: false, value: 'Cet appareil', cls: 'txt', hint: 'exporte pour changer d\'appareil' }
      ] })}
    <details class="card product solo" id="st-app" ${view.open.has('st-app') || !view.open.size ? 'open' : ''}><summary><span>${esc(a.name)}<br><span class="sum-sub">${a.programs.length ? a.programs.length + ' programme' + (a.programs.length > 1 ? 's' : '') + ' et ' : ''}l'abonnement ${esc(soloName(a))}</span></span></summary>
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
      detail: (() => {
        const ins = ms.reduce((s, m) => s + m.products[i].admissions, 0), solo = ms.reduce((s, m) => s + m.products[i].fromSolo, 0);
        const ca = ms.reduce((s, m) => s + m.products[i].sales, 0);
        return `${num(Math.round(ins))} inscriptions${solo >= 1 ? `, dont <b>${num(Math.round(solo))} venues de ${esc(soloName(a))}</b> (${num(+p.fromSolo || 0)} % par an)` : ''} · prix moyen ${ins ? price(Math.round(ca / ins)) : '—'} · ${num(last?.products[i].active || 0)} en cours en fin de période`;
      })() }));
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

// ---------- Bandeaux en tête de page ----------
// Un chiffre clé à gauche, quatre tuiles de même taille à droite (2 × 2), sur toutes les pages.
const periodChip = () => periodName().replace(/^(en|au|sur) /, '').replace(/^./, c => c.toUpperCase());
// Replié par défaut (une ligne : chiffre clé + 2 ou 3 repères) ; déplié, la note et les quatre tuiles.
// Le choix replié / déplié est mémorisé sur l'appareil et vaut pour toutes les pages.
const bannerOpen = () => { try { return localStorage.getItem('om-banner') === 'open'; } catch { return false; } };
function banner({ label, chip, big, bigCls = '', note = '', bar = '', tiles }) {
  const tile = t => {
    const inner = `<span class="t-l">${t.label}</span><b class="${t.cls || ''}">${t.value}</b>${t.hint ? `<span class="t-h">${t.hint}</span>` : ''}`;
    return t.go ? `<a class="b-tile" href="#${t.go.page}" data-goto="${t.go.page}" data-open="${t.go.open || ''}" data-anchor="${t.go.anchor || t.go.open || ''}">${inner}</a>` : `<div class="b-tile">${inner}</div>`;
  };
  const minis = tiles.filter(t => t.mini !== false).slice(0, 3).map((t, k) => `<span class="b-mini${k === 2 ? ' m3' : ''}"><small>${t.mini || t.label}</small><b class="${t.cls || ''}">${t.value}</b></span>`).join('');
  return `<details class="hero banner" ${bannerOpen() ? 'open' : ''}>
      <summary class="b-sum"><span class="b-head"><span class="b-label"><small>${label}</small>${chip ? `<span class="chip">${chip}</span>` : ''}</span>
        <b class="b-big ${bigCls}">${big}</b></span><span class="b-minis">${minis}</span></summary>
      <div class="b-body"><div class="b-main">${note ? `<p class="b-note">${note}</p>` : ''}${bar}</div>
      <div class="b-tiles">${tiles.map(tile).join('')}</div></div>
    </details>`;
}
const shareBar = (sales, subs) => { const t = sales + subs || 1; return `<div class="share"><i style="width:${(sales / t * 100).toFixed(1)}%;background:var(--sage)"></i><i style="width:${(subs / t * 100).toFixed(1)}%;background:var(--clay)"></i></div>`; };
const pctOf = (x, t) => t ? Math.round(x / t * 100) + ' %' : '—';

function synthesePage() {
  const r = results();
  const total = r.sum('total'), sales = r.sum('sales'), subs = r.sum('directCA') + r.sum('postCA'), net = r.sum('net'), cost = r.sum('cost');
  const margin = r.sum('caHT') ? net / r.sum('caHT') * 100 : 0;
  const last = r.byMonth.at(-1) || {};
  const pct = x => total ? (x / total * 100).toFixed(1) : 0;
  const best = r.byMonth.reduce((b, m) => !b || m.total > b.total ? m : b, null);
  const first = r.byMonth[0] || {}, subsEnd = (last.direct || 0) + (last.post || 0), subsGain = subsEnd - ((first.direct || 0) + (first.post || 0));
  return `${banner({ label: 'Chiffre d\'affaires', chip: periodChip(), big: money(total),
      note: `${best ? `Meilleur mois : ${monthName(best.month)} (${money(best.total)})` : ''}${r.byMonth.length ? ` · moyenne ${money(total / r.byMonth.length)} par mois` : ''}<br>Programmes ${money(sales)} · abonnements ${money(subs)}`,
      bar: `<div class="share"><i style="width:${pct(sales)}%;background:var(--sage)"></i><i style="width:${pct(subs)}%;background:var(--clay)"></i></div>`,
      tiles: [
        { label: 'Résultat d\'exploitation', mini: 'Résultat', value: money(net), cls: net < 0 ? 'neg-hero' : 'pos-hero', hint: `${margin.toFixed(0)} % du CA HT`, go: { page: 'resultat' } },
        { label: 'Charges', value: money(cost), hint: `${pctOf(cost, r.sum('caHT'))} du CA HT`, go: { page: 'charges' } },
        { label: 'Inscriptions', value: num(r.sum('admissions')), hint: `${num(last.active || 0)} en programme en fin de période`, go: { page: 'previsionnel' } },
        { label: 'Abonnées', value: num(subsEnd), hint: `en fin de période · ${subsGain >= 0 ? '+' : ''}${num(subsGain)}`, go: { page: 'previsionnel' } }
      ] })}
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
  const first = ms[0] || {}, subsEnd = (last.direct || 0) + (last.post || 0), subsGain = subsEnd - ((first.direct || 0) + (first.post || 0));
  const posMonths = ms.filter(m => m.net >= 0).length, caHT = sum('caHT');
  const progSales = sum('sales'), subSales = sum('directCA') + sum('postCA');
  return `${banner({ label: 'Résultat', chip: periodChip(), big: money(net), bigCls: net < 0 ? 'neg-hero' : '',
      note: `${pctOf(net, caHT)} du CA HT · ${posMonths} mois positif${posMonths > 1 ? 's' : ''} sur ${ms.length}`,
      tiles: [
        { label: 'Chiffre d\'affaires', mini: 'CA', value: money(total), hint: shareBar(progSales, subSales) + `<span>${pctOf(progSales, total)} programmes</span>` },
        { label: 'Charges', value: money(cost), hint: `${pctOf(cost, caHT)} du CA HT`, go: { page: 'charges' } },
        { label: 'Abonnées', value: num(subsEnd), hint: `fin de période · ${subsGain >= 0 ? '+' : ''}${num(subsGain)}` },
        { label: 'En programme', value: num(last.active || 0), hint: `fin de période · ${num(sum('admissions'))} inscriptions` }
      ] })}
    <div class="legend"><span><i style="background:var(--sage)"></i>Programmes</span><span><i style="background:var(--clay)"></i>Abonnements</span></div>
    ${blocks || '<p class="muted">Aucun mois dans cette période.</p>'}
    <details class="card" id="pv-table"><summary>Tableau détaillé ${periodName()}</summary><div class="scroll"><table>${table(heads, [...ms.map(line), line(tot)], [...ms.map(() => ''), 'total'])}</table></div></details>
    <details class="card" id="pv-prod" ${view.open.has('pv-prod') || !view.open.size ? 'open' : ''}><summary>Par produit</summary><p class="muted">Touche un produit pour ouvrir ses réglages.</p><div>${productLines(r)}</div></details>
    ${r.scope.some(x => x.a.programs.length) ? capacityBlock(r) : ''}`;
}

// Manque d'heures : premier mois dépassé et besoin jusqu'au palier suivant.
function capacityShortfall(a, weekly) {
  const first = weekly.find(w => w.hours > w.limit + 1e-9);
  if (!first) return null;
  const month = first.date.slice(0, 7);
  const next = (a.capacitySteps || []).map(c => c.date).filter(d => d && d > month).sort()[0];
  const win = weekly.filter(w => w.date.slice(0, 7) >= month && (!next || w.date.slice(0, 7) < next));
  const hours = Math.ceil(Math.max(...win.map(w => w.hours)) * 10) / 10;
  return { month, next, hours, limit: first.limit, missingHours: Math.max(0, hours - first.limit) };
}
// Alerte avec les leviers : plus d'heures pour toi, une embauche, ou moins de temps par cliente.
function capacityAlert(a, ai, sf, id) {
  const p = 'apps.' + ai;
  const miss = Math.ceil(sf.missingHours * 10) / 10;
  const progs = a.programs.map((q, j) => ({ q, j })).filter(x => x.q.enabled && coachAt(x.q, sf.month) > 0);
  // Réduction proportionnelle de tous les programmes pour que les heures nécessaires tiennent dans les heures disponibles.
  const ratio = sf.hours > 0 ? Math.floor(sf.limit / sf.hours * 100) / 100 : 1, pct = Math.round((1 - ratio) * 100);
  return `<div class="cap-alert" id="${id}">
      <p><b>${monthName(sf.month).replace(/^./, c => c.toUpperCase())}</b>${sf.next ? ` (jusqu'à ton palier de ${monthName(sf.next)})` : ''} : il manque <b>${num(miss)} h</b> de coaching par semaine (${num(sf.hours)} h nécessaires pour ${num(sf.limit)} h disponibles).</p>
      <div class="levers">
        <button data-capfix="${ai}" data-mode="own" data-month="${sf.month}" data-miss="${Math.ceil(sf.missingHours)}">J'ajoute ${num(Math.ceil(sf.missingHours))} h pour moi</button>
        <button data-capfix="${ai}" data-mode="hired" data-month="${sf.month}" data-miss="${Math.ceil(sf.missingHours)}">J'embauche ${num(Math.ceil(sf.missingHours))} h de coach</button>
        <a class="lever" href="#produits" data-goto="produits" data-open="pr-cap" data-anchor="pr-cap" data-app="${ai}">Coût d'une coach</a>
      </div>
      ${pct > 0 && pct < 100 ? `<div class="levers"><button data-coachfix="${ai}" data-month="${sf.month}" data-ratio="${ratio}">Je réduis le temps par cliente de ${num(pct)} %</button></div>
      <p class="muted">${progs.map(({ q }) => `${esc(progName(a, q))} : ${num(coachAt(q, sf.month))} → ${num(Math.floor(coachAt(q, sf.month) * ratio))} min`).join(' · ')}, à partir de ${monthName(sf.month)}.</p>` : ''}
      <p class="muted">Chaque bouton ajoute un palier en ${monthName(sf.month)} (ou complète celui de ce mois), puis t'emmène dans « Capacité de coaching », où tu peux ajuster.</p>
    </div>`;
}

// Capacité de coaching : par mois, les heures nécessaires (pic du mois) face aux heures disponibles.
function capacityChart(x) {
  const months = new Map();
  for (const w of x.weekly) {
    const k = w.date.slice(0, 7);
    if (!inPeriod(k)) continue;
    const m = months.get(k) || { month: k, people: 0, hours: 0, limit: w.limit };
    m.people = Math.max(m.people, w.people); m.hours = Math.max(m.hours, w.hours); m.limit = w.limit;
    months.set(k, m);
  }
  const list = [...months.values()];
  if (!list.length) return '';
  const W = Math.max(320, list.length * 26), H = 170, left = 34, bottom = 22, top = 8;
  const raw = Math.max(5, ...list.map(m => Math.max(m.hours, m.limit === Infinity ? 0 : m.limit)));
  const tick = Math.max(5, Math.ceil(raw / 4 / 5) * 5), max = Math.ceil(raw / tick) * tick;
  const y = v => top + (H - top - bottom) * (1 - v / max), bw = (W - left) / list.length;
  const every = Math.max(1, Math.ceil(list.length / 12));
  const MOIS = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];
  const capPath = list.map((m, i) => m.limit === Infinity ? '' : `${i && list[i - 1].limit !== Infinity ? 'L' : 'M'}${left + i * bw},${y(m.limit)} L${left + (i + 1) * bw},${y(m.limit)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Heures de coaching nécessaires et disponibles">`
    + Array.from({ length: max / tick + 1 }, (_, k) => k * tick).map(t => `<line class="grid-line" x1="${left}" x2="${W}" y1="${y(t)}" y2="${y(t)}"/><text x="${left - 6}" y="${y(t) + 3}" text-anchor="end">${t} h</text>`).join('')
    + list.map((m, i) => {
      const bx = left + i * bw + bw * .18, w = bw * .64, over = m.hours > m.limit + 1e-9;
      const label = i % every === 0 ? `<text x="${bx + w / 2}" y="${H - 6}" text-anchor="middle">${MOIS[+m.month.slice(5) - 1]}${list.length > 12 ? ' ' + m.month.slice(2, 4) : ''}</text>` : '';
      return `<g><title>${monthName(m.month)} : ${m.hours.toFixed(1)} h de coaching par semaine${m.limit === Infinity ? '' : ` pour ${num(m.limit)} h disponibles`} (${num(m.people)} clientes en même temps)</title>
        <rect x="${bx}" y="${y(m.hours)}" width="${w}" height="${y(0) - y(m.hours)}" rx="2" fill="${over ? 'var(--bad)' : 'var(--k-ins)'}"/></g>${label}`;
    }).join('')
    + (capPath ? `<path d="${capPath}" fill="none" stroke="var(--ink)" stroke-width="2" stroke-dasharray="5 4"/>` : '') + '</svg>';
}

function capacityBlock(r) {
  const apps = r.scope.filter(x => x.a.programs.length);
  const wr = apps.flatMap(x => x.weekly.filter(w => inPeriod(w.date.slice(0, 7))).map(w => ({ ...w, name: x.a.name })));
  const over = wr.filter(w => w.hours > w.limit + 1e-9).length;
  return `<h2>Capacité de coaching</h2><div class="kpis">
      <div class="kpi"><small>Pic de clientes en même temps</small><b>${num(Math.max(0, ...wr.map(w => w.people)))}</b></div>
      <div class="kpi"><small>Pic d'heures de coaching / semaine</small><b>${Math.max(0, ...wr.map(w => w.hours)).toFixed(1)} h</b></div>
      <div class="kpi"><small>Semaines où les heures manquent</small><b class="${over ? 'bad' : 'good'}">${over}</b></div>
      <div class="kpi"><small>En attente en fin de période</small><b>${num(wr.at(-1)?.waiting || 0)}</b></div>
    </div>
    ${apps.map(x => `<div class="card"><div class="legend"><span><i style="background:var(--k-ins)"></i>Heures de coaching nécessaires / semaine</span><span><i style="background:var(--bad)"></i>Heures insuffisantes</span><span><i class="dash"></i>Heures disponibles</span></div>
      <div class="chart cap-chart">${capacityChart(x)}</div>
      ${(() => { const ai = state.apps.indexOf(x.a), sf = capacityShortfall(x.a, x.weekly.filter(w => inPeriod(w.date.slice(0, 7)))); return sf ? capacityAlert(x.a, ai, sf, 'pv-alert-' + ai) : '<p class="muted">Tes heures de coaching suffisent sur toute la période.</p>'; })()}
      <p class="muted"><a href="#produits" data-goto="produits" data-open="pr-cap" data-anchor="pr-cap" data-app="${state.apps.indexOf(x.a)}">Voir la capacité de coaching</a></p></div>`).join('')}
    <details class="card" id="c-weeks"><summary>Capacité semaine par semaine</summary>
      <div class="scroll"><table>${table(['Semaine', 'Application', 'Demande', 'Inscriptions', 'En cours', 'Heures nécessaires', 'Heures disponibles', 'En attente'],
        wr.map(w => [w.date, esc(w.name), num(w.demand), num(w.admitted), num(w.people), w.hours.toFixed(1), w.limit === Infinity ? '—' : `${num(w.own)}${w.hired ? ' + ' + num(w.hired) : ''}`, num(w.waiting)]))}</table></div></details>`;
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
  const ref = addMonths(dates.launch || dates.first, 12);
  const fixedAt = (list, ds) => list.reduce((t, c) => t + (c.type === 'fixe' ? chargeAt(c, ref, ds) || 0 : 0), 0);
  const list = a.charges || [], todo = list.filter(c => badge(c).includes('todo')).length, est = list.filter(c => badge(c).includes('est')).length;
  const r = results();
  return `${banner({ label: `Charges fixes de ${esc(a.name)}`, chip: 'par mois', big: money(fixedAt(list, dates)),
      note: `En ${monthName(ref)}, un an après le lancement, hors structure`,
      tiles: [
        { label: 'Total des charges', mini: `Total ${periodChip()}`, value: money(r.sum('cost')), hint: `${periodName()} · ${pctOf(r.sum('cost'), r.sum('caHT'))} du CA HT`, go: { page: 'resultat', open: 'r-nature' } },
        { label: 'Structure Om Holistic', value: money(fixedAt(sh.charges, all)), hint: 'par mois, toutes applis' },
        { label: 'À compléter', value: num(todo), cls: todo ? 'warn-v' : '', hint: `sur ${list.length} charges` },
        { label: 'Estimations', value: num(est), hint: `${list.length - est - todo} confirmée${list.length - est - todo > 1 ? 's' : ''}` }
      ] })}
    <details class="card" id="ch-ramp" ${view.open.has('ch-ramp') || !view.open.size ? 'open' : ''}><summary>Montée en charge de ${esc(a.name)}</summary>${chargeRamp(a.charges || [], dates, a.programs.length ? ['le coaching'] : [])}</details>
    <h2>Charges de ${esc(a.name)}</h2>
    <p class="muted">Classées comme dans un compte d'exploitation. Chaque charge démarre à une date repère de ton calendrier (et la suit si elle bouge), peut monter par paliers et reste une estimation tant que tu ne l'as pas confirmée. Rattache-la au produit qui la provoque pour voir sa vraie rentabilité.</p>
    ${chargeGroups(a.charges || [], p + '.charges', a, dates, scopes)}
    <div class="row"><button data-add="${p}.charges">Ajouter une charge</button></div>
    ${a.programs.length ? `<div class="card" id="ch-coach"><h4>Coaching</h4><p class="muted">Le coût du coaching vient des heures de coachs embauchées et de leur coût horaire (${money(+a.coachRate || 0)} / h), réglés dans <a href="#produits" data-goto="produits" data-open="pr-cap" data-anchor="pr-cap">Produits › Capacité de coaching</a>.</p></div>` : ''}
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
function implantCalc(r) {
  const im = state.implantation;
  const sums = r.all.map(x => r.summary(x));
  const ca = sums.reduce((t, s) => t + s.total.ca, 0), result = sums.reduce((t, s) => t + s.total.result, 0);
  const months = new Set(r.all.flatMap(x => x.months.filter(m => inPeriod(m.month)).map(m => m.month))).size || 1;
  // Vue d'une seule application : impôts et cotisations se calculent sur la société entière (toutes les applis),
  // puis on n'affiche que la part de cette application, au prorata de son résultat (ou de son CA si le total est négatif).
  let share = 1, appName = '';
  if (view.app !== 'all') {
    const own = r.summary(r.scope[0]).total;
    share = result > 0 ? Math.max(0, own.result) / result : ca > 0 ? own.ca / ca : 0;
    appName = r.scope[0].a.name;
  }
  const scale = x => ({ sc: x.sc, fixed: x.fixed * share, social: x.social * share, tax: x.tax * share, dist: x.dist * share, net: x.net * share });
  const res = im.scenarios.map(sc => scale({ sc, ...afterTax(sc, ca, result, months) }));
  const yearCa = ca * 12 / months;
  const over = x => +x.sc.caLimit > 0 && yearCa > +x.sc.caLimit;
  const allowed = res.filter(x => !over(x));
  const pool = allowed.length ? allowed : res;
  const best = pool.reduce((b, x) => x.net > b.net ? x : b, pool[0]);
  const cur = res.find(x => x.sc.id === im.current) || res[0];
  const own = view.app !== 'all' ? r.summary(r.scope[0]).total : null;
  return { im, ca: own ? own.ca : ca, result: own ? own.result : result, months, res, yearCa, over, best, cur, share, appName, totalResult: result };
}
// Bandeau en tête du Résultat : l'implantation choisie et son effet immédiat sur le net.
function implantBar(r) {
  const { im, ca, result, cur, best, over, appName, share } = implantCalc(r);
  const gap = best.net - cur.net;
  return `<details class="card implant-bar" id="r-imp" ${view.open.has('r-imp') ? 'open' : ''}><summary><span>Implantation : ${esc(cur.sc.name)}<br><span class="sum-sub">Net pour toi ${money(cur.net)} · frais, cotisations et impôts ${money(-(cur.fixed + cur.social + cur.tax + cur.dist) || 0)}</span></span></summary>
    <div class="grid">${select('Implantation de la société', 'implantation.current', im.current, im.scenarios.map(x => [x.id, x.name])).replace('<label>', '<label class="wide">')}</div>
    <div class="net-split"><div><span>Résultat d'exploitation${appName ? ' de ' + esc(appName) : ''}</span><b>${money(result)}</b></div><div><span>Frais, cotisations et impôts</span><b>${money(-(cur.fixed + cur.social + cur.tax + cur.dist) || 0)}</b></div><div class="net"><span>Net pour toi</span><b>${money(cur.net)}</b></div></div>
    <p class="muted">${over(cur) ? '<b class="neg">Plafond de chiffre d\'affaires dépassé pour ce statut.</b> ' : ''}${gap > 0.5 ? `Le scénario « ${esc(best.sc.name)} » donnerait ${money(gap)} de plus.` : 'C\'est le scénario le plus favorable avec les taux saisis.'} ${appName ? `Impôts et cotisations calculés sur toute la société, puis répartis : part de ${esc(appName)} ${Math.round(share * 100)} %. ` : ''}Taux indicatifs à valider. <a href="#resultat" data-goto="resultat" data-open="r-implant" data-anchor="r-implant">Comparer les implantations</a></p>
  </details>`;
}

function implantCard(r) {
  const { im, ca, result, res, yearCa, over, best, cur, appName, share } = implantCalc(r);
  const row = x => [`${x.sc.id === im.current ? '<b>' : ''}${esc(x.sc.name)}${x.sc.id === im.current ? '</b>' : ''}${x === best ? ' <span class="tag on">Meilleur</span>' : ''}${over(x) ? ' <span class="tag todo">Plafond de CA dépassé</span>' : ''}`,
    signed(-x.fixed || 0), signed(-x.social || 0), signed(-(x.tax + x.dist) || 0), `<b>${signed(x.net)}</b>`, ca ? `${(x.net / ca * 100).toFixed(0)} %` : '—'];
  return `<details class="card" id="r-implant" ${view.open.has('r-implant') || !view.open.size ? 'open' : ''}><summary><span>Résultat net selon l'implantation<br><span class="sum-sub">${esc(cur.sc.name)} : ${money(cur.net)} ${periodName()}</span></span></summary>
    <div class="grid">${select('Implantation retenue', 'implantation.current', im.current, im.scenarios.map(x => [x.id, x.name])).replace('<label>', '<label class="wide">')}</div>
    <div class="net-split"><div><span>Résultat d'exploitation</span><b>${money(result)}</b></div><div><span>Frais de structure</span><b>${money(-cur.fixed || 0)}</b></div><div><span>Cotisations sociales</span><b>${money(-cur.social || 0)}</b></div><div><span>Impôts</span><b>${money(-(cur.tax + cur.dist) || 0)}</b></div><div class="net"><span>Net pour toi</span><b class="${cur.net < 0 ? 'neg' : ''}">${money(cur.net)}</b></div></div>
    ${over(cur) ? `<p class="warn">Le chiffre d'affaires de la société, toutes applications (environ ${money(yearCa)} par an), dépasse le plafond de ${money(+cur.sc.caLimit)} de ce statut.</p>` : ''}
    <h4>Comparaison des implantations</h4>
    <div class="scroll"><table class="pnl">${table(['Implantation', 'Frais', 'Cotisations', 'Impôts', 'Net', '% du CA'], res.map(row))}</table></div>
    <p class="warn">Taux indicatifs, à faire valider par un conseiller fiscal. Le lieu où tu vis décide en général de ton imposition, et la TVA européenne reste due sur les ventes aux clientes européennes quelle que soit l'implantation. Toutes les applications Om Holistic sont comptées ensemble pour calculer les impôts et cotisations${appName ? `, puis seule la part de ${esc(appName)} est affichée ici (${Math.round(share * 100)} % du résultat de la société)` : ''}.</p>
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
  const ic = implantCalc(r);
  const top = bars.reduce((b, c) => !b || (c.v[key] || 0) > (b.v[key] || 0) ? c : b, null);
  return `${banner({ label: 'Résultat d\'exploitation', chip: periodChip(), big: money(total.result), bigCls: total.result < 0 ? 'neg-hero' : '',
      note: `Marge d'exploitation de ${rate.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} % du chiffre d'affaires`,
      tiles: [
        { label: `Chiffre d'affaires${state.vat.ttc ? ' HT' : ''}`, mini: 'CA', value: money(total.ca) },
        { label: 'Charges', value: money(total.ca - total.result), hint: `${pctOf(total.ca - total.result, total.ca)} du CA`, go: { page: 'charges' } },
        { label: 'Net pour toi', value: money(ic.cur.net), cls: ic.cur.net < 0 ? 'neg-hero' : '', hint: `${esc(ic.cur.sc.name)}${ic.appName ? ` · part de ${esc(ic.appName)}` : ''}`, go: { page: 'resultat', open: 'r-implant' } },
        { label: view.app === 'all' ? 'Meilleure application' : 'Meilleur produit', mini: false, value: top ? esc(top.name) : '—', cls: 'txt', hint: top ? money(top.v[key] || 0) + (view.app === 'all' ? ' de résultat' : ' de contribution') : '' }
      ] })}
    ${implantBar(r)}
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
  // Une zone rangée dans une autre (ex. TVA dans « Toutes les applications ») : on ouvre aussi ses parents.
  for (let d = target && target.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) d.open = true;
  if (target) { target.scrollIntoView({ block: 'center' }); target.classList.add('flash'); setTimeout(() => target.classList.remove('flash'), 1600); }
  else window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
// Bandeau replié / déplié : mémorisé pour toutes les pages.
document.addEventListener('toggle', e => { if (e.target.classList && e.target.classList.contains('banner')) { try { localStorage.setItem('om-banner', e.target.open ? 'open' : 'closed'); } catch { /* stockage indisponible */ } } }, true);

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
      capacitySteps: () => { const l = o[k][o[k].length - 1]; return { date: l ? addMonths(l.date || thisMonth, 6) : thisMonth, hours: l ? +l.hours || 0 : 10, hired: l ? +l.hired || 0 : 0 }; },
      coachSteps: () => { const l = o[k][o[k].length - 1]; return { date: l ? addMonths(l.date || thisMonth, 6) : addMonths(thisMonth, 6), minutes: Math.max(0, Math.round((l ? +l.minutes : +o.coach || 0) * 0.75)) }; },
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
    const a = state.apps[+t.dataset.capfix], month = t.dataset.month, miss = +t.dataset.miss, key = t.dataset.mode === 'hired' ? 'hired' : 'hours';
    a.capacitySteps = a.capacitySteps || [];
    let step = a.capacitySteps.find(c => c.date === month);
    if (!step) {
      const before = capacityAt(a, month);
      step = { date: month, hours: +before?.hours || 0, hired: +before?.hired || 0 };
      a.capacitySteps.push(step);
      a.capacitySteps.sort((x, y) => x.date.localeCompare(y.date));
    }
    step[key] = (+step[key] || 0) + miss;
    // Les paliers suivants gardent au moins ce niveau.
    for (const c of a.capacitySteps) if (c.date > month) c[key] = Math.max(+c[key] || 0, step[key]);
    save();
    view.app = t.dataset.capfix;
    view.goto = { open: 'pr-cap', anchor: 'pr-cap' };
    if (location.hash === '#produits') route(); else location.hash = 'produits';
  } else if (t.dataset.coachfix) {
    const a = state.apps[+t.dataset.coachfix], month = t.dataset.month, ratio = +t.dataset.ratio;
    for (const q of a.programs) {
      if (!q.enabled) continue;
      const before = coachAt(q, month);
      if (!(before > 0)) continue;
      q.coachSteps = q.coachSteps || [];
      let st = q.coachSteps.find(c => c.date === month);
      if (!st) { st = { date: month, minutes: before }; q.coachSteps.push(st); q.coachSteps.sort((x, y) => x.date.localeCompare(y.date)); }
      st.minutes = Math.floor(before * ratio);
      // Les baisses suivantes ne remontent pas au-dessus de ce niveau.
      for (const c of q.coachSteps) if (c.date > month) c.minutes = Math.min(+c.minutes || 0, st.minutes);
    }
    save();
    view.app = t.dataset.coachfix;
    view.goto = { open: 'pr-cap', anchor: 'pr-coachtime' };
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
    try { localStorage.setItem('om-last-export', new Date().toISOString()); } catch { /* stockage indisponible */ }
    render();
  }
});

route();
