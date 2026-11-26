'use strict';
// Interface : navigation entre pages, formulaires de paramètres et tableaux de résultats.

const $ = id => document.getElementById(id);
const money = x => (Math.round(x) || 0).toLocaleString('fr-FR').replace(/\s/g, '\u00a0') + '\u00a0€';
const price = x => { const v = +x || 0; return v.toLocaleString('fr-FR', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 }) + '\u00a0€'; };
// Montants compacts pour les bandeaux et les cartes : 18,4 k€ au-delà de 100 000 €, 2,8 M€ au-delà du million.
const short = x => { const a = Math.abs(x), f = (v, d) => v.toLocaleString('fr-FR', { maximumFractionDigits: d }).replace(/\s/g, '\u00a0');
  return a >= 1e9 ? f(x / 1e9, a >= 1e10 ? 0 : 1) + '\u00a0Md€' : a >= 1e6 ? f(x / 1e6, a >= 1e7 ? 0 : 1) + '\u00a0M€' : a >= 1e5 ? f(x / 1e3, 0) + '\u00a0k€' : money(x); };
// Remplace dans un texte déjà formaté les grands montants « 1 234 567 € » par leur forme compacte.
const compact = html => String(html).replace(/-?\d{1,3}(?:\u00a0\d{3})+\u00a0€/g, m => { const v = +m.replace(/[^\d-]/g, ''); return Math.abs(v) >= 1e5 ? short(v) : m; });
const num = x => Math.round(x).toLocaleString('fr-FR').replace(/\s/g, '\u00a0');
const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const thisMonth = new Date().toISOString().slice(0, 7);

// ---------- État ----------

let state = defaultState();
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
  if (isValidState(saved)) state = migrate(saved);
} catch { /* sauvegarde illisible : on garde les valeurs par défaut */ }
const save = () => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); localStorage.setItem('om-last-edit', new Date().toISOString()); } catch { /* stockage indisponible */ } snapshot('travail'); Sync.changed(); saveLabel(); };
const stored = k => { try { return localStorage.getItem(k); } catch { return null; } };
// Versions précédentes gardées sur cet appareil : avant chaque synchro, import, remise à zéro ou retour,
// à l'ouverture, et toutes les 20 minutes pendant que tu travailles. On garde les 15 dernières.
const HIST_KEY = 'om-history';
const history = () => { try { return JSON.parse(localStorage.getItem(HIST_KEY)) || []; } catch { return []; } };
function snapshot(why, st = state, force = false) {
  const list = history(), data = JSON.stringify(st), last = list[0];
  if (last && last.data === data) return;
  if (!force && why === 'travail' && last && Date.now() - new Date(last.at) < 20 * 60000) return;
  list.unshift({ at: new Date().toISOString(), why, data });
  for (let n = Math.min(list.length, 15); n > 0; n--) {
    try { localStorage.setItem(HIST_KEY, JSON.stringify(list.slice(0, n))); return; } catch { /* stockage plein : on garde moins de versions */ }
  }
}
snapshot('ouverture');
// Bouton Enregistrer : toujours au même endroit. Il confirme l'enregistrement, garde une version et synchronise.
// Les saisies restent aussi gardées sur l'appareil au fil de l'eau, pour ne jamais rien perdre.
const savedAt = () => stored('om-saved-at');
const unsaved = () => { const e = stored('om-last-edit'), s2 = savedAt(); return !!e && (!s2 || e > s2); };
function saveLabel() {
  const b = document.getElementById('saveBtn');
  if (!b) return;
  const at = savedAt(), d = at && new Date(at), today = d && d.toDateString() === new Date().toDateString();
  const t = d ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', ' h ') : '';
  const when = d ? (today ? 'à ' + t : 'le ' + d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' à ' + t) : '';
  const off = Sync.on && ['offline', 'error', 'conflict'].includes(Sync.status.state);
  b.classList.toggle('dirty', unsaved());
  b.classList.toggle('warn', !unsaved() && off);
  b.innerHTML = unsaved() ? '<span class="dot"></span>Enregistrer'
    : d ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>Enregistré ${when}${off ? ' · pas encore synchronisé' : ''}` : 'Enregistrer';
}
async function saveNow() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); localStorage.setItem('om-saved-at', new Date().toISOString()); } catch { /* stockage indisponible */ }
  snapshot('enregistré', state, true);
  saveLabel();
  if (Sync.on) { await Sync.now(); saveLabel(); }
}
// Rappel de sauvegarde : des modifications non exportées depuis plus de 14 jours (ou jamais exportées, modifiées il y a plus d'un jour).
function backupDue() {
  const edit = stored('om-last-edit'), exp = stored('om-last-export');
  if (Sync.on && Sync.at) return null; // synchronisé : une copie existe déjà sur le serveur
  if (!edit || (exp && exp >= edit)) return null;
  const days = d => (Date.now() - new Date(d)) / 86400000;
  if (exp ? days(exp) > 14 : days(edit) > 1) return exp ? `Dernière sauvegarde il y a ${Math.floor(days(exp))} jours` : 'Tes paramètres n\'ont jamais été exportés';
  return null;
}

const view = { page: 'synthese', app: '0', year: new Date().getFullYear() + 1, period: 0, cashFrom: '', cashTo: '' };
// Découpage de la page Trésorerie (mois, trimestre, semestre, année), mémorisé sur l'appareil.
view.plan = 'sans';
view.cashStep = (() => { try { return localStorage.getItem('om-cash-step') || 'm'; } catch { return 'm'; } })();
const PAGES = ['synthese', 'previsionnel', 'resultat', 'tresorerie', 'levee', 'charges', 'produits', 'reglages'];
const SETTINGS_PAGES = ['charges', 'produits', 'reglages'];

// ---------- Champs de formulaire liés à l'état par un chemin "apps.0.programs.1.name" ----------

function field(label, path, value, type = 'number') {
  // Les écarts de scénario peuvent être négatifs ; tous les autres nombres sont positifs.
  const extra = type === 'number' ? (String(path).startsWith('scenarios.') ? ' step="any"' : ' min="0" step="any"') : '';
  // Un libellé « titre\nexplication » s'affiche sur deux lignes.
  const [head, more] = String(label).split('\n');
  const text = more ? `<span class="lh">${esc(head)}</span><span class="lx">${esc(more)}</span>` : esc(label);
  // Grands nombres : la valeur mise en forme sous le champ (1000000 → 1 000 000).
  const echo = type === 'number' && Math.abs(+value) >= 10000 ? `<span class="echo">${num(+value)}</span>` : '';
  return `<label${more ? ' class="two"' : ''}>${text}<input data-path="${esc(path)}" type="${type}"${extra} value="${esc(value)}">${echo}</label>`;
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
function pricingEditor(grid, path, title, anchor, extra = '') {
  const now = phaseAt(grid, thisMonth);
  const rows = grid.map((ph, k) => `<div class="phase-row"><span class="badge">${k + 1}</span>${lineEditor(ph, path + '.' + k, [['label', 'Nom', 'text'], ['price', 'Prix (€)'], ['start', 'À partir de', 'month']])}</div>`).join('');
  const summary = grid.map(ph => price(ph.price)).join(' › ');
  return section(anchor, 'price', title, summary, `${rows}
    <p class="muted">Une phase sans date est ignorée. Avant la première date, le prix de la première phase s'applique. Ce mois-ci : <b>${esc(now.label)}</b> à ${price(now.price)}.</p>${extra}`);
}

const growth = [['initial', 'Départ / semaine'], ['target', 'Objectif / semaine'], ['months', 'Progression (mois)'], ['step', 'Augmentation par palier']];

// ---------- Pages de paramètres ----------

// Chiffres clés affichés sur une carte repliée : petites tuiles « libellé / valeur ».
const pstats = items => `<span class="pstats">${items.filter(Boolean).map(([l, v, cls]) => `<span class="ps${cls ? ' ' + cls : ''}"><small>${l}</small><b>${compact(v)}</b></span>`).join('')}</span>`;
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
      ${pricingEditor(q.pricing, t + '.pricing', 'Prix (total payé à l\'inscription)', 'price-p' + j, `<div class="grid">${field('Paiement en\nnombre de mensualités (1 = comptant)', t + '.installments', q.installments || 1)}</div>
        <p class="muted">Le chiffre d'affaires compte toujours au mois de l'inscription ; seule la trésorerie reçoit l'argent mensualité par mensualité.</p>`)}
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
  const cur = im.scenarios.find(x => x.id === curImplant()) || im.scenarios[0];
  const bases = [['result', 'du bénéfice'], ['ca', 'du chiffre d\'affaires']];
  return section('st-implant', 'cal', 'Implantation de la société', esc(cur ? cur.name : '—'), `
    <div class="grid">${select('Implantation retenue', implantPath(), curImplant(), im.scenarios.map(x => [x.id, x.name])).replace('<label>', '<label class="wide">')}</div>
    <p class="warn">Taux indicatifs à faire valider par un conseiller. Ils servent à comparer les scénarios dans l'onglet Résultat.</p>
    ${im.scenarios.map((sc, k) => { const t = 'implantation.scenarios.' + k, id = 'imp-' + sc.id; return `<details class="card charge" id="${id}" ${view.open.has(id) ? 'open' : ''}><summary><span>${esc(sc.name)}<br><span class="sum-sub">frais ${money(+sc.fixedYear || 0)} / an · cotisations ${num(+sc.socialRate || 0)} % · impôt ${num(+sc.taxRate || 0)} %${+sc.taxLimit ? ` puis ${num(+sc.taxRate2 || 0)} %` : ''}${+sc.distRate ? ` · dividendes ${num(+sc.distRate)} %` : ''}</span></span></summary>
      ${fields(sc, t, [['name', 'Nom du scénario', 'text']])}
      <div class="grid">${field('Frais de structure (€ / an)', t + '.fixedYear', sc.fixedYear)}${field('Cotisations sociales (%)', t + '.socialRate', sc.socialRate)}${select('Calculées sur', t + '.socialBase', sc.socialBase, bases)}
        ${field(+sc.taxLimit ? 'Impôt, taux réduit (%)' : 'Impôt (%)', t + '.taxRate', sc.taxRate)}${+sc.taxLimit ? field('Bénéfice au taux réduit (€ / an)', t + '.taxLimit', sc.taxLimit) + field('Impôt au-delà (%)', t + '.taxRate2', sc.taxRate2 || 0) : ''}${select('Calculé sur', t + '.taxBase', sc.taxBase, bases)}${field('Impôt sur les dividendes (%)', t + '.distRate', sc.distRate)}${field('Plafond de CA (€ / an, 0 = aucun)', t + '.caLimit', sc.caLimit || 0)}</div>
      ${fields(sc, t, [['note', 'Remarques', 'text']])}
      ${sc.note ? `<p class="muted">${esc(sc.note)}</p>` : ''}
      <div class="row"><button class="danger" data-remove="${t}">Supprimer ce scénario</button></div></details>`; }).join('')}
    <div class="row"><button data-add="implantation.scenarios">Ajouter un scénario</button></div>`);
}

// ---------- Synchronisation ----------

const when = d => d ? new Date(d).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
function syncText() {
  const s = Sync.status;
  if (!Sync.on) return 'Désactivée : tes paramètres restent sur cet appareil.';
  if (s.state === 'pending') return 'Envoi des dernières modifications…';
  if (s.state === 'conflict') return 'Deux versions différentes à départager.';
  if (s.state === 'offline' || s.state === 'error') return s.msg;
  return Sync.at ? `À jour · dernière synchro le ${when(Sync.at)}` : 'Connexion au serveur…';
}
// Bandeau en haut de toutes les pages quand les deux appareils ont modifié en même temps, ou en cas d'erreur.
function syncStrip() {
  const s = Sync.status;
  if (s.state === 'conflict' && s.remote) return `<div class="sync-strip conflict"><p><b>Tes chiffres ont aussi changé ailleurs.</b> Version de ton ${esc(s.remote.device || 'autre appareil')} du ${when(s.remote.at)}, et celle de cet appareil avec des modifications pas encore envoyées. Laquelle garder ?</p>
    <div class="row"><button data-sync="theirs">Prendre celle de ${esc(s.remote.device === 'ordinateur' ? 'l\'ordinateur' : 'l\'' + (s.remote.device || 'autre appareil'))}</button><button data-sync="mine">Garder celle-ci</button></div></div>`;
  if (s.state === 'error') return `<a class="sync-strip" href="#reglages" data-goto="reglages" data-open="st-sync" data-anchor="st-sync">${esc(s.msg)} ›</a>`;
  return '';
}
const BENCH_ROWS = [['arr', 'ARR (€) : amorçage à partir de « correct », série A à partir de « bon »', true], ['growth', 'Croissance du MRR (% / mois)', true], ['churn', 'Churn mensuel (%)', false], ['ltvcac', 'LTV / CAC', true], ['payback', 'Retour sur CAC (mois)', false], ['gm', 'Marge brute (%)', true], ['ebitda', 'Marge EBITDA (%)', true], ['rule40', 'Règle des 40', true], ['runway', 'Autonomie (mois)', true]];
function benchSection() {
  const B = state.bench || defaultBench();
  return section('st-bench', 'promo', 'Repères investisseurs', 'seuils bon et correct des indicateurs clés', `
    ${BENCH_ROWS.map(([k, n, up]) => `<h4>${n}</h4><div class="grid">${field(`Bon si ${up ? 'au moins' : 'au plus'}`, `bench.${k}.good`, B[k].good)}${field(`Correct si ${up ? 'au moins' : 'au plus'}`, `bench.${k}.ok`, B[k].ok)}</div>`).join('')}
    <div class="row"><button id="benchReset">Revenir aux repères par défaut</button></div>`);
}
function syncSection() {
  const summary = Sync.on ? 'activée sur cet appareil' : 'iPhone, iPad et ordinateur à jour';
  const body = Sync.on ? `<p class="sync-state ${Sync.status.state}" id="syncStatus">${esc(syncText())}</p>
      <p class="muted">Chaque modification est envoyée quelques secondes après, et l'appli récupère la dernière version quand tu y reviens. Tes chiffres sont chiffrés sur l'appareil avec ta phrase secrète : le serveur ne peut pas les lire.</p>
      <div class="row"><button id="syncNow">Synchroniser maintenant</button><button class="danger" id="syncOff">Désactiver sur cet appareil</button></div>`
    : `<p class="muted">Choisis une phrase secrète et tape la même sur chacun de tes appareils. Elle chiffre tes chiffres avant qu'ils quittent l'appareil. Garde-la bien : sans elle, personne ne peut récupérer la version en ligne (tes paramètres restent quand même sur chaque appareil).</p>
      <div class="grid"><label class="wide"><span>Phrase secrète (au moins 12 caractères)</span><input id="syncPhrase" type="password" autocomplete="new-password" autocapitalize="off" spellcheck="false" placeholder="par exemple : quatre mots que tu retiens"></label></div>
      <div class="row"><button id="syncOn">Activer la synchro</button></div>
      <p id="syncMsg" class="warn">${view.syncMsg ? esc(view.syncMsg) : ''}</p>`;
  return section('st-sync', 'cal', 'Synchronisation entre appareils', summary, body) + historySection();
}
function historySection() {
  const list = history();
  const when = d => new Date(d).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const cur = JSON.stringify(state);
  const rows = list.map((h, k) => `<li><span>${when(h.at)} · ${esc(h.why)}</span>${h.data !== cur ? `<button data-restore="${k}">Revenir à cette version</button>` : '<span class="muted">version actuelle</span>'}</li>`).join('');
  return section('st-hist', 'cal', 'Versions précédentes', list.length ? `${list.length} gardées sur cet appareil · la dernière ${when(list[0].at)}` : 'aucune pour l\'instant',
    list.length ? `<ul class="hist">${rows}</ul>` : '<p class="muted">Les versions apparaîtront ici au fil de ton travail.</p>');
}

function settingsPage(a, i) {
  const p = 'apps.' + i;
  const vat = state.vat.ttc ? `prix saisis TTC · TVA ${num(state.vat.rate)} %` : 'prix saisis HT';
  let lastExport = null; try { lastExport = localStorage.getItem('om-last-export'); } catch { /* stockage indisponible */ }
  const days = lastExport ? Math.floor((Date.now() - new Date(lastExport)) / 86400000) : null;
  const im = state.implantation, cur = im.scenarios.find(x => x.id === curImplant()) || im.scenarios[0];
  return `${banner({ label: 'Réglages', big: `${state.apps.length} application${state.apps.length > 1 ? 's' : ''}`,
      note: state.apps.map(x => esc(x.name)).join(' · '),
      tiles: [
        { label: 'TVA', value: state.vat.ttc ? `${num(state.vat.rate)} %` : 'HT', hint: state.vat.ttc ? 'prix saisis TTC' : 'prix saisis hors taxe', go: { page: 'reglages', open: 'st-vat' } },
        { label: 'Implantation', mini: false, value: cur ? esc(cur.name) : '—', cls: 'txt', hint: 'taux à valider', go: { page: 'reglages', open: 'st-implant' } },
        { label: 'Dernière sauvegarde', mini: 'Sauvegarde', value: days === null ? 'Jamais' : days === 0 ? 'Aujourd\'hui' : `Il y a ${days} j`, cls: days === null || days > 14 ? 'warn-v' : '', hint: 'export du fichier', go: { page: 'reglages', open: 'st-save' } },
        { label: 'Données', mini: 'Synchro', value: Sync.on ? 'Synchronisées' : 'Cet appareil', cls: 'txt', hint: Sync.on ? 'iPhone, iPad et ordinateur' : 'active la synchro', go: { page: 'reglages', open: 'st-sync' } }
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
      ${section('st-scen', 'ins', 'Scénarios', state.scenarios.list.map(x => esc(x.name)).join(' · ') + ' · affiché : ' + esc((currentScenario() || {}).name || ''), `
        <div class="grid">${select('Scénario affiché', 'scenarios.current', state.scenarios.current, state.scenarios.list.map(x => [x.id, x.name])).replace('<label>', '<label class="wide">')}</div>
        ${state.scenarios.list.map((x, k) => x.id === 'central' ? '' : `<h4>${esc(x.name)}</h4><div class="grid">${field('Inscriptions et\nabonnées (%)', `scenarios.list.${k}.volume`, x.volume)}${field('Prix\n(%)', `scenarios.list.${k}.price`, x.price)}${field('Durée\nd\'abonnement (%)', `scenarios.list.${k}.duration`, x.duration)}${field('Charges\n(%)', `scenarios.list.${k}.costs`, x.costs)}</div>`).join('')}
        <p class="muted">Écarts par rapport au plan saisi dans Produits et Charges, qui reste le scénario central. Une baisse s'écrit avec un moins (−30). Les pages de réglages montrent toujours le plan central.</p>`)}
      ${section('st-cash', 'cal', 'Trésorerie et revenu', `apport ${money(+state.cash.start || 0)} · revenu visé ${money(+state.cash.payGoal || 0)} / mois${state.cash.payFrom ? ' dès ' + monthName(state.cash.payFrom) : ''}`, `
        <div class="grid">${field('Apport de départ\nargent mis dans la société (€)', 'cash.start', state.cash.start)}${field('Revenu mensuel visé\nnet pour toi (€)', 'cash.payGoal', state.cash.payGoal)}</div>
        ${fields(state.cash, 'cash', [['payFrom', 'Je commence à me le verser à partir de', 'month']])}
        <p class="muted">Sans date, la trésorerie est montrée avant ta rémunération : tu vois ce que la société accumule. Avec une date, ton revenu est retiré chaque mois de la trésorerie. Ne remplis pas en plus la charge « Rémunération du dirigeant », pour ne pas la compter deux fois. Valeurs par défaut à ajuster : apport 0 €, revenu visé 2 000 € par mois.</p>`)}
      ${section('st-vat', 'price', 'TVA', vat, `${check('Mes prix sont saisis TTC (le compte d\'exploitation les convertit en HT)', 'vat.ttc', state.vat.ttc)}
        ${state.vat.ttc ? fields(state.vat, 'vat', [['rate', 'Taux de TVA (%)']]) : ''}`)}
      ${implantSection()}
      ${benchSection()}
      ${syncSection()}
      ${section('st-save', 'sub', 'Sauvegarde', 'export et import du fichier de paramètres', `<p class="muted">${Sync.on ? 'Tes paramètres sont synchronisés. Un export reste utile pour garder une copie datée.' : 'Tes paramètres restent dans ce navigateur. Exporte-les régulièrement, ou active la synchro pour les retrouver sur tes autres appareils.'}</p>
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

// Scénario affiché partout (Résultat, Chiffre d'affaires, Trésorerie, Vue d'ensemble) ; les pages de réglages gardent le plan saisi.
const currentScenario = () => (state.scenarios?.list || []).find(x => x.id === state.scenarios.current);
function results(sc = currentScenario()) {
  let st = sc && sc.id !== 'central' ? withScenario(state, sc) : state;
  if (view.plan === 'avec' && view.app !== 'all') st = applyRaisePlan(st, +view.app);
  const all = st.apps.map((a, i) => ({ a, i, ...simulate(a) }));
  const pnl = buildPnl(st, all);
  // Charges et résultat de chaque mois, à partir du compte d'exploitation.
  all.forEach((x, i) => {
    x.pnl = pnl[i];
    x.months.forEach((m, k) => {
      const t = sumPnl([pnl[i][k]]).total;
      m.cost = t.charges; m.net = t.result; m.caHT = t.ca;
    });
  });
  return scoped({ all, st });
}
// Même simulation, restreinte à l'application et à la période affichées (servira aussi année par année).
function scoped({ all, st }) {
  const scope = view.app === 'all' ? all : [all[+view.app] || all[0]];
  const rows = scope.flatMap(x => x.months.filter(m => inPeriod(m.month)));
  const keys = [...new Set(rows.map(r => r.month))].sort();
  const F = ['sales', 'directCA', 'postCA', 'total', 'caHT', 'admissions', 'net', 'cost', 'active', 'direct', 'post'];
  const byMonth = keys.map(k => ({ month: k, ...Object.fromEntries(F.map(f => [f, rows.filter(r => r.month === k).reduce((s, r) => s + r[f], 0)])) }));
  const sum = f => rows.reduce((s, r) => s + r[f], 0);
  const summary = x => sumPnl(x.pnl.filter(e => inPeriod(e.month)));
  return { all, scope, keys, byMonth, sum, summary, st };
}

// Une ligne par produit, avec sa part du CA de la période.
function productLines(r) {
  const lines = [];
  for (const x of r.scope) {
    const ms = x.months.filter(m => inPeriod(m.month)), last = ms.at(-1);
    const a = x.a, direct = last?.direct || 0, post = last?.post || 0;
    const ai = x.i;
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

// ---------- Tableau de bord : ce qui demande ton attention ----------
function alertsCard(r) {
  const items = [];
  const t = cashData();
  if (t.low.balance < 0) items.push(['bad', `Trésorerie négative en ${monthName(t.low.month)} : il faut ${money(-t.low.balance)} d'apport ou de prêt.`, { page: 'tresorerie' }]);
  for (const x of r.all) {
    const sf = capacityShortfall(x.a, x.weekly);
    if (sf) items.push(['bad', `${esc(x.a.name)} : il manque ${num(Math.ceil(sf.missingHours))} h de coaching par semaine dès ${monthName(sf.month)}.`, { page: 'produits', open: 'pr-cap', app: x.i }]);
    const a = state.apps[x.i];
    const pending = a.programs.filter((q, j) => { if (!q.enabled || !(q.goal?.steps || []).length) return false; const gp = programGoalPlan(a, j, simulate(a).months); return gp.segs.length && !(q.palierMode && !q.launch && JSON.stringify(q.paliers) === JSON.stringify(gp.segs)); }).length
      + (() => { const gp = cachedGoalPlan(a); return gp.segs.length && !(a.sub.palierMode && JSON.stringify(a.sub.paliers) === JSON.stringify(gp.segs)) ? 1 : 0; })();
    if (pending) items.push(['mid', `${esc(a.name)} : ${pending} objectif${pending > 1 ? 's' : ''} pas encore appliqué${pending > 1 ? 's' : ''}.`, { page: 'produits', app: x.i }]);
    const todo = (a.charges || []).filter(c => badge(c).includes('todo')).length;
    if (todo) items.push(['mid', `${esc(a.name)} : ${todo} charge${todo > 1 ? 's' : ''} à compléter.`, { page: 'charges', app: x.i }]);
  }
  const shTodo = state.shared.charges.filter(c => badge(c).includes('todo')).length;
  if (shTodo) items.push(['mid', `Structure Om Holistic : ${shTodo} charge${shTodo > 1 ? 's' : ''} à compléter (loyer, salaires…).`, { page: 'charges' }]);
  const b = backupDue();
  if (b) items.push(['mid', `${b} : exporte-les pour ne pas les perdre.`, { page: 'reglages', open: 'st-save' }]);
  if (t.breakEven) items.push(['ok', `Point mort en ${monthName(t.breakEven)} ; ton revenu de ${money(t.goal)} par mois ${t.payReached ? 'est atteint en ' + monthName(t.payReached) : 'n\'est pas encore atteint'}.`, { page: 'tresorerie' }]);
  const go = g => `href="#${g.page}" data-goto="${g.page}" data-open="${g.open || ''}" data-anchor="${g.open || ''}"${g.app !== undefined ? ` data-app="${g.app}"` : ''}`;
  return `<details class="card" id="s-alerts" ${view.open.has('s-alerts') || !view.open.size ? 'open' : ''}><summary><span>À surveiller<br><span class="sum-sub">${items.filter(x => x[0] !== 'ok').length} point${items.filter(x => x[0] !== 'ok').length > 1 ? 's' : ''} d'attention · toutes applications</span></span></summary>
    <ul class="alerts">${items.map(([k, text, g]) => `<li class="${k}"><a ${go(g)}>${text}<span class="from">›</span></a></li>`).join('') || '<li class="ok">Rien à signaler.</li>'}</ul></details>`;
}

// ---------- Réel face au prévu ----------
function actualsCard(r) {
  if (view.app === 'all') return `<details class="card" id="pv-real"><summary><span>Réel face au prévu<br><span class="sum-sub">choisis une application pour saisir ses chiffres réels</span></span></summary><p class="muted">Les chiffres réels se saisissent application par application : choisis-en une en haut de la page.</p></details>`;
  const x = r.scope[0], a = state.apps[x.i], act = a.actuals || {};
  const ms = x.months.filter(m => inPeriod(m.month));
  const inp = (month, f) => `<input class="real" type="number" min="0" step="any" inputmode="decimal" data-actual="${x.i}|${month}|${f}" value="${act[month]?.[f] ?? ''}" placeholder="—" aria-label="${f === 'ca' ? 'Chiffre d\'affaires' : 'Charges'} réel ${monthName(month)}">`;
  const gap = (real, plan) => real === undefined || real === '' ? '' : `<span class="${+real < plan ? 'neg' : 'pos'}">${+real - plan >= 0 ? '+' : ''}${short(+real - plan)}</span>`;
  const done = ms.filter(m => act[m.month] && (act[m.month].ca !== undefined && act[m.month].ca !== '')), sumPlan = done.reduce((t, m) => t + m.caHT, 0), sumReal = done.reduce((t, m) => t + +act[m.month].ca, 0);
  return `<details class="card" id="pv-real" ${view.open.has('pv-real') ? 'open' : ''}><summary><span>Réel face au prévu<br><span class="sum-sub">${done.length ? `${done.length} mois saisis · CA réel ${short(sumReal)} pour ${short(sumPlan)} prévus (${sumPlan ? (sumReal >= sumPlan ? '+' : '') + Math.round((sumReal / sumPlan - 1) * 100) + ' %' : '—'})` : 'saisis tes chiffres réels dès les premières ventes'}</span></span></summary>
    <p class="muted">Pour ${esc(a.name)}, ${periodName()}. Saisis chaque mois le chiffre d'affaires HT et les charges réellement constatés (dans ta comptabilité). L'écart te dit quelles hypothèses recaler.</p>
    <div class="scroll"><table class="real-t"><thead><tr><th>Mois</th><th>CA prévu</th><th>CA réel</th><th>Écart</th><th>Charges prévues</th><th>Charges réelles</th><th>Écart</th></tr></thead><tbody>
      ${ms.map(m => `<tr><td>${monthName(m.month)}</td><td>${money(m.caHT)}</td><td>${inp(m.month, 'ca')}</td><td>${gap(act[m.month]?.ca, m.caHT)}</td><td>${money(m.cost)}</td><td>${inp(m.month, 'charges')}</td><td>${act[m.month]?.charges === undefined || act[m.month]?.charges === '' ? '' : `<span class="${+act[m.month].charges > m.cost ? 'neg' : 'pos'}">${+act[m.month].charges - m.cost >= 0 ? '+' : ''}${short(+act[m.month].charges - m.cost)}</span>`}</td></tr>`).join('')}
    </tbody></table></div></details>`;
}

// Export PDF : ouvre toutes les zones, puis la fenêtre d'impression (sur iPad : Partager › Enregistrer en PDF).
const printButton = () => `<div class="row print-row"><button class="print-btn" id="printPdf">Exporter en PDF</button></div>`;

// ---------- Trésorerie ----------
// Toute la société, toutes applications : ce qui rentre, ce qui sort, et le solde en banque.
function cashData(sc) {
  return scopeTreasury(results(sc));
}
// Trésorerie de l'application choisie (comme une société à part : quote-part de structure et impôts compris,
// sans apport ni ta rémunération), ou de toute la société en vue consolidée.
const scopeTreasury = r => view.app === 'all' ? treasury(r.st, r.all) : treasury(r.st, r.scope, true);
const soloTag = r => view.app === 'all' ? 'Toute la société, toutes applications' : `${esc(r.scope[0].a.name)} seule, comme une société à part : sa quote-part de structure et ses impôts compris, sans apport de départ ni ta rémunération`;
const MSHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const monthShort = k => k ? MSHORT[+k.slice(5) - 1] + ' ' + k.slice(2, 4) : '—';
// Plage courte pour le bandeau : « 2027 », « T3 2027 » ou « janv. 27 – déc. 32 ».
function rangeChip(from, to) {
  if (!from) return '—';
  const y = from.slice(0, 4), m1 = +from.slice(5), m2 = +to.slice(5);
  if (y === to.slice(0, 4)) {
    if (m1 === 1 && m2 === 12) return y;
    if (m2 - m1 === 2 && m1 % 3 === 1) return `T${Math.ceil(m1 / 3)} ${y}`;
    if (m2 - m1 === 5 && m1 % 6 === 1) return `S${Math.ceil(m1 / 6)} ${y}`;
    if (m1 === m2) return monthShort(from);
  }
  return `${monthShort(from)} – ${monthShort(to)}`;
}
const STEPS = [['m', 'Mois'], ['q', 'Trimestre'], ['s', 'Semestre'], ['y', 'Année']];
const bucketOf = (month, step) => {
  const y = month.slice(0, 4), mo = +month.slice(5);
  return step === 'y' ? y : step === 's' ? `${y}-S${Math.ceil(mo / 6)}` : step === 'q' ? `${y}-T${Math.ceil(mo / 3)}` : month;
};
const bucketName = (k, step) => step === 'm' ? monthName(k) : step === 'y' ? k : `${step === 'q' ? 'T' : 'S'}${k.slice(-1)} ${k.slice(0, 4)}`;
// Regroupe les mois choisis par période : sommes des flux, solde de début et de fin.
function cashBuckets(months, step) {
  const out = [];
  for (const m of months) {
    const k = bucketOf(m.month, step);
    let b = out.at(-1);
    if (!b || b.key !== k) out.push(b = { key: k, from: m.month, to: m.month, open: m.balance - (m.inflow - m.charges - m.taxes - m.pay), inflow: 0, raised: 0, charges: 0, taxes: 0, pay: 0, low: m.balance });
    b.to = m.month; b.inflow += m.inflow; b.raised += m.raised || 0; b.charges += m.charges; b.taxes += m.taxes; b.pay += m.pay;
    b.balance = m.balance; b.low = Math.min(b.low, m.balance);
  }
  out.forEach(b => { b.flow = b.balance - b.open; });
  return out;
}
// Mois affichés : ceux de la période choisie en haut, ou la plage « du … au … » de la page.
function cashRange(all) {
  const ms = all.map(m => m.month);
  const from = view.cashFrom && ms.includes(view.cashFrom) ? view.cashFrom : ms.find(inPeriod);
  const to = view.cashTo && ms.includes(view.cashTo) ? view.cashTo : [...ms].reverse().find(inPeriod);
  if (!from || !to) return { from, to, months: [] };
  const [a, b] = from <= to ? [from, to] : [to, from];
  return { from: a, to: b, months: all.filter(m => m.month >= a && m.month <= b) };
}
// Barres : entrées vers le haut, sorties vers le bas ; courbe : solde en fin de période.
function cashChart(bs) {
  // Largeur réelle de la carte : le texte et les barres gardent leur taille, sur iPhone comme sur iPad.
  const avail = Math.max(300, ($('page')?.clientWidth || 360) - 34);
  const W = Math.max(avail, bs.length * 34), H = 210, left = 52, bottom = 24, top = 10, right = 8;
  const hi = Math.max(1, ...bs.map(b => Math.max(b.inflow, b.balance))), lo = Math.min(0, ...bs.map(b => Math.min(-(b.charges + b.taxes + b.pay), b.balance)));
  const y = v => top + (H - top - bottom) * (1 - (v - lo) / (hi - lo || 1));
  const slot = (W - left - right) / Math.max(1, bs.length), bw = Math.max(3, Math.min(28, slot * 0.5)), cx = i => left + slot * (i + 0.5);
  const ticks = [lo, 0, hi].filter((v, i, a) => a.indexOf(v) === i);
  const every = Math.ceil(bs.length / 12);
  const step = view.cashStep;
  const lab = b => step === 'm' ? (b.key.endsWith('-01') || bs.length <= 12 ? MSHORT[+b.key.slice(5) - 1].replace('.', '') + (b.key.endsWith('-01') ? ' ' + b.key.slice(2, 4) : '') : '') : bucketName(b.key, step).replace(/ (\d\d)(\d\d)$/, ' $2');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Trésorerie par période">`
    + ticks.map(v => `<line class="grid-line" x1="${left}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text x="${left - 6}" y="${y(v) + 3}" text-anchor="end">${short(v).replace(/ €$/, '')}</text>`).join('')
    + bs.map((b, i) => { const out = b.charges + b.taxes + b.pay;
      return `<g><title>${bucketName(b.key, step)} : entrées ${money(b.inflow)}, sorties ${money(out)}, solde ${money(b.balance)}</title>`
        + `<rect x="${cx(i) - bw / 2}" y="${y(b.inflow)}" width="${bw}" height="${Math.max(0, y(0) - y(b.inflow))}" rx="2" fill="var(--good)" opacity=".75"/>`
        + `<rect x="${cx(i) - bw / 2}" y="${y(0)}" width="${bw}" height="${Math.max(0, y(-out) - y(0))}" rx="2" fill="var(--sage)" opacity=".6"/></g>`; }).join('')
    + `<line x1="${left}" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="var(--ink-soft)" stroke-width="1"/>`
    + `<polyline points="${bs.map((b, i) => `${cx(i).toFixed(1)},${y(b.balance).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--clay)" stroke-width="2.5" stroke-linejoin="round"/>`
    + bs.map((b, i) => `<circle cx="${cx(i)}" cy="${y(b.balance)}" r="${bs.length > 24 ? 0 : 3}" fill="${b.balance < 0 ? 'var(--bad)' : 'var(--clay)'}"/>`).join('')
    + bs.map((b, i) => i % every === 0 || step === 'm' ? `<text x="${cx(i)}" y="${H - 6}" text-anchor="middle">${lab(b)}</text>` : '').join('')
    + '</svg>';
}
// Encaissements et charges de chaque application sur la plage (les impôts et ta rémunération sont ceux de la société).
function cashByApp(r, from, to) {
  return r.all.map(x => {
    const ks = x.months.map((m, k) => [m, k]).filter(([m]) => m.month >= from && m.month <= to);
    const t = sumPnl(ks.map(([, k]) => x.pnl[k])).total;
    return { name: x.a.name, ca: t.ca, charges: t.charges, result: t.ca - t.charges };
  });
}
function tresoreriePage() {
  const r = results(), t = scopeTreasury(r), c = view.app === 'all' ? state.cash || {} : {};
  const { from, to, months } = cashRange(t.months);
  const bs = cashBuckets(months, view.cashStep);
  const end = months.at(-1), first = months[0];
  const need = t.low.balance < 0 ? -t.low.balance : 0;
  const tot = f => bs.reduce((s, b) => s + b[f], 0);
  const opts = sel => t.months.map(m => `<option value="${m.month}" ${m.month === sel ? 'selected' : ''}>${monthName(m.month)}</option>`).join('');
  const rangeName = from && to ? (from === to ? monthName(from) : `${monthName(from)} – ${monthName(to)}`) : '—';
  const flow = end ? end.balance - (bs[0]?.open || 0) : 0;
  const lowIn = months.reduce((l, m) => !l || m.balance < l.balance ? m : l, null);
  // Relevé : une ligne fine par période (variation et solde), le détail se déplie au toucher.
  const maxFlow = Math.max(1, ...bs.map(b => Math.abs(b.flow)));
  const sign = v => (v > 0 ? '+' : '') + money(v);
  const detail = (o, inflow, charges, taxes, pay, close) => `<dl class="cl-d"><dt>Solde au début</dt><dd>${money(o)}</dd><dt>Encaissements</dt><dd class="pos">${sign(inflow)}</dd><dt>Charges</dt><dd>${money(-charges)}</dd><dt>Impôts et cotisations</dt><dd>${money(-taxes)}</dd>${pay ? `<dt>Ta rémunération</dt><dd>${money(-pay)}</dd>` : ''}<dt class="cl-end">Solde à la fin</dt><dd class="cl-end ${close < 0 ? 'neg' : ''}">${money(close)}</dd></dl>`;
  const line = (id, label, flow, close, body, cls = '') => `<details class="cl-row ${cls}" id="${id}" ${view.open.has(id) ? 'open' : ''}><summary><span class="cl-p">${label}</span>
      <span class="cl-bar"><i class="${flow < 0 ? 'dn' : 'up'}" style="width:${(Math.abs(flow) / maxFlow * 100).toFixed(1)}%"></i></span>
      <span class="cl-v ${flow < 0 ? 'neg' : 'pos'}">${short(flow).replace(/^(?!-)/, flow > 0.5 ? '+' : '')}</span><span class="cl-b ${close < 0 ? 'neg' : ''}">${short(close)}</span></summary>${body}</details>`;
  const ledger = bs.length ? `<div class="cl"><div class="cl-h"><span>Période</span><span></span><span>Variation</span><span>Solde</span></div>`
    + bs.map(b => line('cl-' + b.key, bucketName(b.key, view.cashStep), b.flow, b.balance, detail(b.open, b.inflow, b.charges, b.taxes, b.pay, b.balance))).join('')
    + (bs.length > 1 ? line('cl-total', 'Total', tot('flow'), end.balance, detail(bs[0].open, tot('inflow'), tot('charges'), tot('taxes'), tot('pay'), end.balance), 'cl-tot') : '') + '</div>' : '';
  const apps = from && view.app === 'all' ? cashByApp(r, from, to) : [];
  return `${banner({ label: 'Trésorerie', chip: view.cashFrom || view.cashTo ? rangeChip(from, to) + (currentScenario() && currentScenario().id !== 'central' ? ' · ' + esc(currentScenario().name) : '') : periodChip(), big: end ? money(end.balance) : '—', bigCls: end && end.balance < 0 ? 'neg-hero' : '',
      note: `Solde en banque fin ${end ? monthName(end.month) : ''} · ${flow >= 0 ? '+' : ''}${money(flow)} sur la période<br>${soloTag(r)}.${view.app === 'all' ? ` Apport de départ ${money(t.start)}${c.payFrom ? ` · ta rémunération de ${money(+c.payGoal || 0)} dès ${monthName(c.payFrom)}` : ' · avant ta rémunération'}.` : ''}`,
      tiles: [
        { label: 'Point bas', mini: 'Point bas', value: short(lowIn ? lowIn.balance : t.low.balance), cls: (lowIn ? lowIn.balance : t.low.balance) < 0 ? 'neg-hero' : '', hint: lowIn ? monthName(lowIn.month) : monthName(t.low.month) },
        { label: 'Point mort', value: t.breakEven ? monthShort(t.breakEven) : 'non atteint', cls: 'txt', hint: 'résultat positif chaque mois ensuite', go: { page: 'resultat' } },
        { label: 'Variation', value: (flow >= 0 ? '+' : '') + money(flow), cls: flow < 0 ? 'neg-hero' : 'pos-hero', hint: 'sur la période affichée' },
        { label: `Ton revenu (${short(t.goal)} / mois)`, mini: false, value: t.payReached ? monthName(t.payReached) : 'non atteint', cls: t.payReached ? 'txt pos-hero' : 'txt', hint: 'net après impôts, toutes applis', go: { page: 'reglages', open: 'st-cash' } }
      ] })}
    ${implantPick('tr-imp', 'les impôts et cotisations retirés de la trésorerie en dépendent')}
    ${need ? `<details class="card" id="tr-alert" open><summary><span>À surveiller<br><span class="sum-sub">point bas du plan : ${short(t.low.balance)} en ${monthName(t.low.month)}${lowIn && !months.some(m => m.month === t.low.month) ? ', hors de la période affichée' : ''}</span></span></summary>
      <ul class="alerts"><li class="bad"><a href="#reglages" data-goto="reglages" data-open="st-cash" data-anchor="st-cash">Il manque ${money(need)} en ${monthName(t.low.month)} : prévois un apport ou un prêt, ou décale des charges.<span class="from">›</span></a></li></ul></details>` : ''}
    ${bs.length ? `<details class="card" id="tr-chart" open><summary><span>Entrées, sorties et solde<br><span class="sum-sub">${lowIn ? `point bas de la période ${short(lowIn.balance)} en ${monthName(lowIn.month)}` : ''}</span></span></summary>
      <div class="legend"><span><i style="background:var(--good)"></i>Encaissements</span><span><i style="background:var(--sage)"></i>Sorties</span><span><i style="background:var(--clay)"></i>Solde</span></div>
      <div class="chart">${cashChart(bs)}</div></details>
    <details class="card" id="tr-table" open><summary><span>Par ${STEPS.find(x => x[0] === view.cashStep)[1].toLowerCase()}<br><span class="sum-sub">${rangeName} · touche une ligne pour le détail</span></span></summary>
      ${ledger}
      <p class="muted">Encaissements : l'argent reçu (les ventes payées en plusieurs fois arrivent sur plusieurs mois), hors TVA. Impôts et cotisations selon l'implantation choisie, comptés chaque mois (en réalité, une partie se paie l'année suivante).</p></details>
    <details class="card" id="tr-range" ${view.open.has('tr-range') ? 'open' : ''}><summary><span>Plage de mois<br><span class="sum-sub">${view.cashFrom || view.cashTo ? 'personnalisée : ' : 'celle choisie en haut : '}${rangeName}</span></span></summary>
      <div class="grid"><label>Du<select id="cashFrom">${opts(from)}</select></label><label>Au<select id="cashTo">${opts(to)}</select></label></div>
      ${view.cashFrom || view.cashTo ? '<div class="row"><button id="cashReset">Revenir à la période du haut</button></div>' : '<p class="muted">Pour voir par exemple de juin 2027 à mai 2028. Le découpage (mois, trimestre…) se choisit en haut.</p>'}</details>
    ${apps.length ? `<details class="card" id="tr-apps" ${view.open.has('tr-apps') ? 'open' : ''}><summary><span>Par application<br><span class="sum-sub">${apps.map(x => `${esc(x.name)} ${short(x.result)}`).join(' · ')}</span></span></summary>
      <div class="scroll"><table>${table(['Application', 'Chiffre d\'affaires HT', 'Charges', 'Apport à la trésorerie'], apps.map(x => [esc(x.name), money(x.ca), money(-x.charges), signed(x.result)]), [])}</table></div>
      <p class="muted">${rangeName}. Avant impôts, cotisations et ta rémunération, qui se calculent pour toute la société.</p></details>` : ''}` : '<p class="muted">Aucun mois dans cette période.</p>'}
    ${view.app === 'all' ? '<p class="muted"><a href="#reglages" data-goto="reglages" data-open="st-cash" data-anchor="st-cash">Régler l\'apport de départ et ton revenu</a></p>' : '<p class="muted">Choisis « Om Holistic · consolidé » en haut pour voir toute la société, avec ton apport et ta rémunération.</p>'}
    ${printButton()}`;
}

// ---------- Bandeaux en tête de page ----------
// Un chiffre clé à gauche, quatre tuiles de même taille à droite (2 × 2), sur toutes les pages.
const periodChip = () => periodName().replace(/^(en|au|sur) /, '').replace(/^./, c => c.toUpperCase()) + (currentScenario() && currentScenario().id !== 'central' ? ' · ' + esc(currentScenario().name) : '');
// Replié par défaut (une ligne : chiffre clé + 2 ou 3 repères) ; déplié, la note et les quatre tuiles.
// Le choix replié / déplié est mémorisé sur l'appareil et vaut pour toutes les pages.
const bannerOpen = () => { try { return localStorage.getItem('om-banner') === 'open'; } catch { return false; } };
function banner({ label, chip, big, bigCls = '', note = '', bar = '', tiles }) {
  const tile = t => {
    const inner = `<span class="t-l">${t.label}</span><b class="${t.cls || ''}">${compact(t.value)}</b>${t.hint ? `<span class="t-h">${compact(t.hint)}</span>` : ''}`;
    return t.go ? `<a class="b-tile" href="#${t.go.page}" data-goto="${t.go.page}" data-open="${t.go.open || ''}" data-anchor="${t.go.anchor || t.go.open || ''}">${inner}</a>` : `<div class="b-tile">${inner}</div>`;
  };
  const minis = tiles.filter(t => t.mini !== false).slice(0, 3).map((t, k) => `<span class="b-mini${k === 2 ? ' m3' : ''}"><small>${t.mini || t.label}</small><b class="${t.cls || ''}">${compact(t.value)}</b></span>`).join('');
  return `<details class="hero banner" ${bannerOpen() ? 'open' : ''}>
      <summary class="b-sum"><span class="b-head"><span class="b-label"><small>${label}</small>${chip ? `<span class="chip">${chip}</span>` : ''}</span>
        <b class="b-big ${bigCls}">${compact(big)}</b></span><span class="b-minis">${minis}</span></summary>
      <div class="b-body"><div class="b-main">${note ? `<p class="b-note">${compact(note)}</p>` : ''}${bar}</div>
      <div class="b-tiles">${tiles.map(tile).join('')}</div></div>
    </details>`;
}
const shareBar = (sales, subs) => { const t = sales + subs || 1; return `<div class="share"><i style="width:${(sales / t * 100).toFixed(1)}%;background:var(--sage)"></i><i style="width:${(subs / t * 100).toFixed(1)}%;background:var(--clay)"></i></div>`; };
const pctOf = (x, t) => t ? Math.round(x / t * 100) + ' %' : '—';

// Raccourci vers la page Trésorerie : solde de fin de période et point bas.
function cashLink(r) {
  const t = scopeTreasury(r), end = [...t.months].reverse().find(m => inPeriod(m.month));
  if (!end) return '';
  return `<a class="card cash-link" href="#tresorerie"><span><small>Trésorerie</small><b class="${end.balance < 0 ? 'neg' : ''}">${short(end.balance)}</b> fin ${monthName(end.month)}</span>
    <span class="muted">point bas ${short(t.low.balance)} en ${monthName(t.low.month)} ›</span></a>`;
}

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
    ${alertsCard(r)}
    ${cashLink(r)}
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
  const best = ms.reduce((b, m) => !b || m.total > b.total ? m : b, null);
  return `${banner({ label: 'Chiffre d\'affaires', chip: periodChip(), big: money(total),
      note: `${best ? `Meilleur mois : ${monthName(best.month)} (${money(best.total)})` : ''}${ms.length ? ` · moyenne ${money(total / ms.length)} par mois` : ''}<br>Programmes ${money(progSales)} · abonnements ${money(subSales)}`,
      bar: shareBar(progSales, subSales),
      tiles: [
        { label: 'Programmes', value: money(progSales), hint: `${pctOf(progSales, total)} du CA · ${num(sum('admissions'))} inscriptions` },
        { label: 'Résultat', value: money(net), cls: net < 0 ? 'neg-hero' : 'pos-hero', hint: `${pctOf(net, caHT)} du CA HT · ${posMonths} mois positif${posMonths > 1 ? 's' : ''} sur ${ms.length}`, go: { page: 'resultat' } },
        { label: 'Abonnées', value: num(subsEnd), hint: `fin de période · ${subsGain >= 0 ? '+' : ''}${num(subsGain)}` },
        { label: 'En programme', value: num(last.active || 0), hint: `fin de période · ${num(sum('admissions'))} inscriptions` }
      ] })}
    ${actualsCard(r)}
    <div class="legend"><span><i style="background:var(--sage)"></i>Programmes</span><span><i style="background:var(--clay)"></i>Abonnements</span></div>
    ${blocks || '<p class="muted">Aucun mois dans cette période.</p>'}
    <details class="card" id="pv-table"><summary>Tableau détaillé ${periodName()}</summary><div class="scroll"><table>${table(heads, [...ms.map(line), line(tot)], [...ms.map(() => ''), 'total'])}</table></div></details>
    <details class="card" id="pv-prod" ${view.open.has('pv-prod') || !view.open.size ? 'open' : ''}><summary>Par produit</summary><p class="muted">Touche un produit pour ouvrir ses réglages.</p><div>${productLines(r)}</div></details>
    ${r.scope.some(x => x.a.programs.length) ? capacityBlock(r) : ''}
    ${printButton()}`;
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
      ${(() => { const ai = x.i, sf = capacityShortfall(x.a, x.weekly.filter(w => inPeriod(w.date.slice(0, 7)))); return sf ? capacityAlert(x.a, ai, sf, 'pv-alert-' + ai) : '<p class="muted">Tes heures de coaching suffisent sur toute la période.</p>'; })()}
      <p class="muted"><a href="#produits" data-goto="produits" data-open="pr-cap" data-anchor="pr-cap" data-app="${x.i}">Voir la capacité de coaching</a></p></div>`).join('')}
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

function chargeGroups(list, path, a, dates, scopes, keep = () => true) {
  return CHARGE_CATEGORIES.map(([k, n]) => {
    const items = list.map((c, j) => ({ c, j })).filter(x => (x.c.category || 'autre') === k && keep(x.c));
    if (!items.length) return '';
    const id = (a ? 'cg-' : 'sg-') + k + (keep === isFixed ? '-f' : keep.length ? '-v' : '');
    const todo = items.filter(x => badge(x.c).includes('todo')).length;
    return section(id, CAT_KIND[k], n, `${items.length} charge${items.length > 1 ? 's' : ''}${todo ? ` · ${todo} à compléter` : ''}`,
      items.map(({ c, j }) => chargeEditor(c, `${path}.${j}`, a, dates, scopes)).join(''));
  }).join('');
}

// Valeur d'une nouvelle cliente sur sa durée de vie (chiffre d'affaires, avant charges), au prix de la dernière phase.
function clientValue(a, k) {
  const lastPrice = grid => { const ph = phasesOf(grid); return ph.length ? +ph[ph.length - 1].price || 0 : 0; };
  const sub = d => (+d > 0 ? +d : 24);
  if (k === 'sub') return lastPrice(a.sub.directPricing) * sub(a.sub.duration);
  const q = a.programs[k];
  return lastPrice(q.pricing) + Math.min(100, +q.toSolo || 0) / 100 * lastPrice(a.sub.postPricing) * sub(a.sub.postDuration);
}
// Canaux de vente et coût d'acquisition : ce que coûte une nouvelle cliente, face à ce qu'elle rapporte.
function acquisitionCard(a, p) {
  const ch = a.channels || { store: 0, storeRate: 15 };
  const sim = simulate(a).months, firstYear = sim.filter(m => m.month >= (appDates([a]).launch || appStart(a))).slice(0, 12);
  const pub = (a.charges || []).filter(c => c.category === 'marketing' && c.type === 'fixe').reduce((t, c) => t + firstYear.reduce((s, m) => s + (chargeAt(c, m.month, appDates([a])) || 0), 0), 0);
  const fresh = firstYear.reduce((t, m) => t + m.newDirect.reduce((x, y) => x + y, 0) + m.products.reduce((x, q) => x + q.admissions - (q.fromSolo || 0), 0), 0);
  const rows = [['sub', soloName(a), a.sub, p + '.sub'], ...a.programs.map((q, j) => q.enabled ? [j, progName(a, q), q, `${p}.programs.${j}`] : null).filter(Boolean)].map(([k, name, o, t]) => {
    const v = clientValue(a, k), acq = +o.acq || 0, avg = fresh ? pub / fresh : 0, cost = acq || avg, ratio = cost ? v / cost : null;
    return `<div class="acq-row"><div class="acq-name"><b>${esc(name)}</b><span class="muted">vaut environ ${money(v)} par cliente sur sa durée de vie</span></div>
      ${field('Coût d\'acquisition\n€ par nouvelle cliente', t + '.acq', o.acq || 0)}
      <span class="acq-ratio ${ratio === null ? '' : ratio >= 3 ? 'ok' : ratio >= 1 ? 'mid' : 'bad'}">${ratio === null ? 'coût non renseigné' : `rapporte ${ratio.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} × ${acq ? 'son coût' : 'la pub moyenne'}`}</span></div>`;
  }).join('');
  return `<details class="card" id="ch-acq" ${view.open.has('ch-acq') ? 'open' : ''}><summary><span>Canaux de vente et acquisition<br><span class="sum-sub">${+ch.store ? `${num(ch.store)} % par les stores à ${num(ch.storeRate)} %` : 'tout par le site (Stripe)'} · ${fresh ? `publicité ≈ ${money(pub / fresh)} par nouvelle cliente la 1re année` : 'acquisition à régler'}</span></span></summary>
    <h4>Où paient tes clientes</h4>
    <div class="grid">${field('Ventes passées par l\'App Store\net Google Play (%)', p + '.channels.store', ch.store)}${field('Commission des stores\n(%)', p + '.channels.storeRate', ch.storeRate)}</div>
    <p class="muted">15 % pour les petits éditeurs (moins d'un million de dollars par an), 30 % au-delà. Les frais Stripe de tes charges ne s'appliquent plus qu'à la part vendue sur ton site. Par défaut : tout sur le site, à ajuster.</p>
    <h4>Ce que coûte une nouvelle cliente</h4>
    <p class="muted">Ta publicité fixe (catégorie Marketing) revient à environ <b>${fresh ? money(pub / fresh) : '—'}</b> par nouvelle cliente la première année (${money(pub)} pour ${num(fresh)} nouvelles clientes). Tu peux aussi raisonner par cliente : indique un coût par nouvelle cliente, il s'ajoute à la publicité fixe (mets alors celle-ci à 0 pour ne pas compter deux fois).</p>
    ${rows}
    <p class="muted">Une cliente doit rapporter au moins 3 fois ce qu'elle coûte à acquérir pour que la croissance soit saine. Les clientes venues de l'abonnement ne coûtent rien à acquérir.</p></details>`;
}

// Compte d'exploitation de la période choisie en haut, présenté comme un compte de résultat différentiel :
// chiffre d'affaires, charges variables (par nature), marge sur coûts variables, charges fixes (par nature),
// part de la structure, résultat d'exploitation. Le total est celui de la page Résultat.
const isFixed = c => c.type === 'fixe' || c.type === 'unique';
function chargesPeriodCard(a, i, r) {
  const x = r.all[i], entries = x.pnl.filter(e => inPeriod(e.month));
  if (!entries.length) return `<div class="card" id="ch-period"><h4>Compte d'exploitation ${periodName()}</h4><p class="muted">${esc(a.name)} n'a encore aucun mois dans cette période.</p></div>`;
  const s = sumPnl(entries), dates = appDates([a]), all = appDates(state.apps);
  const appCharges = r.st.apps[i].charges || [], shared = r.st.shared.charges;
  const startOf = (c, ds) => { const st = chargeStart(c, ds); return st ? monthName(st) : 'dès le début'; };
  const ca = s.total.ca, total = s.total.charges;
  const ln = (id, cat, name, sub, v) => ({ id, cat, name, sub, v });
  // Lignes de charges variables : celles saisies, plus les coûts calculés (stores, acquisition, coaching).
  const variable = [
    ln(':store', 'paiement', 'Commissions App Store / Google Play', `${num(+a.channels?.store || 0)} % des ventes passent par les stores`, s.lines[':store'] || 0),
    ln(':acq', 'marketing', 'Acquisition de nouvelles clientes', 'coût par nouvelle cliente (Produits et prix)', s.lines[':acq'] || 0),
    ln(':coaching', 'coaching', 'Heures de coachs', `${money(+a.coachRate || 0)} / h`, s.lines[':coaching'] || 0),
    ...appCharges.filter(c => !isFixed(c)).map(c => ln(c.id, c.category || 'autre', c.name, amountText(c, +c.amount || 0), s.lines[c.id] || 0))];
  const fixed = appCharges.filter(isFixed).map(c => ln(c.id, c.category || 'autre', c.name, `${c.type === 'unique' ? 'une fois' : money(+c.amount || 0) + ' / mois'} · démarre ${startOf(c, dates)}`, s.lines[c.id] || 0));
  const struct = shared.map(c => ln(c.id, c.category || 'autre', c.name, `démarre ${startOf(c, all)} · ${r.st.shared.key === 'ca' ? 'au prorata du CA' : 'à parts égales'}`, s.structureLines[c.id] || 0));
  const quiet = [...variable, ...fixed, ...struct].filter(l => l.v <= 0.5 && !l.id.startsWith(':')).map(l => esc(l.name));
  const sum = ls => ls.reduce((t, l) => t + l.v, 0);
  // Une sous-rubrique par nature de charge (comme les comptes 60 à 64 d'un compte de résultat), dépliable.
  const byCat = (ls, pre) => CHARGE_CATEGORIES.map(([k, n]) => {
    const on = ls.filter(l => l.cat === k && l.v > 0.5).sort((p, q) => q.v - p.v);
    if (!on.length) return '';
    const v = sum(on);
    return section(`${pre}-${k}`, CAT_KIND[k], n, `<b>${money(v)}</b> · ${pctOf(v, ca)} du CA`,
      `<dl class="pl-lines">${on.map(l => `<dt>${esc(l.name)}<small>${l.sub}</small></dt><dd>${money(l.v)}</dd>`).join('')}</dl>`);
  }).join('');
  const vTot = sum(variable), fTot = sum(fixed), sTot = sum(struct), margin = ca - vTot, result = ca - total;
  const level = (id, title, v, body, open) => `<details class="pl-lvl" id="${id}" ${view.open.has(id) || (open && !view.open.size) ? 'open' : ''}><summary><span>${title}</span><b>${money(-v)}</b><small>${pctOf(v, ca)}</small></summary><div class="pl-body">${body || '<p class="muted">Aucune sur la période.</p>'}</div></details>`;
  const sub = (title, v, cls = '') => `<div class="pl-sub ${cls}"><span>${title}</span><b class="${v < 0 ? 'neg' : ''}">${money(v)}</b><small>${pctOf(v, ca)}</small></div>`;
  const sc = currentScenario();
  return `<details class="card" id="ch-period" ${view.open.has('ch-period') || !view.open.size ? 'open' : ''}><summary><span>Compte d'exploitation ${periodName()}<br><span class="sum-sub">charges ${money(total)} · résultat <b class="${result < 0 ? 'neg' : 'pos'}">${money(result)}</b></span></span></summary>
    <div class="pl">
      ${sub('Chiffre d\'affaires HT', ca, 'pl-ca')}
      ${level('pl-var', 'Charges variables', vTot, byCat(variable, 'pv'), true)}
      ${sub('Marge sur coûts variables', margin)}
      ${level('pl-fix', `Charges fixes de ${esc(a.name)}`, fTot, byCat(fixed, 'pf'))}
      ${level('pl-str', 'Quote-part de structure Om Holistic', sTot, byCat(struct, 'ps'))}
      ${sub('Résultat d\'exploitation', result, 'pl-res')}
    </div>
    <p class="muted">Pourcentages : part du chiffre d'affaires HT. Le résultat est celui de la page Résultat, ${periodName()}.${quiet.length ? ` Sans coût sur la période (pas encore démarrées ou terminées) : ${quiet.join(', ')}.` : ''}${sc && sc.id !== 'central' ? ` Scénario ${esc(sc.name)} : montants ajustés comme dans Résultat, les fiches plus bas montrent le plan central.` : ''}</p></details>`;
}

// Bloc dépliable de la page Charges (replié par défaut), total de la période dans l'en-tête.
const chargeFold = (id, title, sub, body) => `<details class="card" id="${id}" ${view.open.has(id) ? 'open' : ''}><summary><span>${title}<br><span class="sum-sub">${sub}</span></span></summary>${body}</details>`;

function chargesPage(a, i) {
  const p = 'apps.' + i;
  const scopes = [['app', 'Commune à tous les produits ' + a.name], ['sub', soloName(a)], ...a.programs.map(q => [q.id, progName(a, q)])];
  const dates = appDates([a]), all = appDates(state.apps);
  const sh = state.shared;
  const ref = addMonths(dates.launch || dates.first, 12);
  const fixedAt = (list, ds) => list.reduce((t, c) => t + (c.type === 'fixe' ? chargeAt(c, ref, ds) || 0 : 0), 0);
  const list = a.charges || [], todo = list.filter(c => badge(c).includes('todo')).length, est = list.filter(c => badge(c).includes('est')).length;
  const r = results(), cost = r.sum('cost');
  const nV = list.filter(c => !isFixed(c)).length, nF = list.length - nV;
  const pe = r.all[i].pnl.filter(e => inPeriod(e.month)), ps = pe.length ? sumPnl(pe) : null;
  const tot = ps && { v: ps.total.fees + ps.total.variable + ps.total.coaching, f: ps.total.fixed, s: ps.structure };
  return `${banner({ label: 'Charges', chip: periodChip(), big: money(cost),
      note: `${pctOf(cost, r.sum('caHT'))} du CA HT ${periodName()}, structure comprise : le même total que dans Résultat. Détail juste en dessous.`,
      tiles: [
        { label: 'Charges fixes par mois', mini: 'Fixes / mois', value: money(fixedAt(list, dates)), hint: `en ${monthName(ref)}, un an après le lancement, hors structure` },
        { label: 'Structure Om Holistic', mini: 'Structure', value: money(fixedAt(sh.charges, all)), hint: 'par mois, toutes applis' },
        { label: 'À compléter', value: num(todo), cls: todo ? 'warn-v' : '', hint: `sur ${list.length} charges` },
        { label: 'Estimations', value: num(est), hint: `${list.length - est - todo} confirmée${list.length - est - todo > 1 ? 's' : ''}` }
      ] })}
    ${chargesPeriodCard(a, i, r)}
    ${acquisitionCard(a, p)}
    <details class="card" id="ch-ramp" ${view.open.has('ch-ramp') || !view.open.size ? 'open' : ''}><summary>Montée en charge de ${esc(a.name)}</summary>${chargeRamp(a.charges || [], dates, a.programs.length ? ['le coaching'] : [])}</details>
    ${chargeFold('ch-var', `Charges variables de ${esc(a.name)}`, `${nV} charge${nV > 1 ? 's' : ''}${tot ? ` · ${money(tot.v)} ${periodName()}` : ''}`,
      `${chargeGroups(a.charges || [], p + '.charges', a, dates, scopes, c => !isFixed(c)) || '<p class="muted">Aucune pour l\'instant.</p>'}
      ${a.programs.length ? `<p class="muted">Coaching : heures de coachs × ${money(+a.coachRate || 0)} / h, réglé dans <a href="#produits" data-goto="produits" data-open="pr-cap" data-anchor="pr-cap">Produits › Capacité de coaching</a>.</p>` : ''}
      <div class="row"><button data-add="${p}.charges">Ajouter une charge</button></div>`)}
    ${chargeFold('ch-fix', `Charges fixes de ${esc(a.name)}`, `${nF} charge${nF > 1 ? 's' : ''}${tot ? ` · ${money(tot.f)} ${periodName()}` : ''}`,
      `${chargeGroups(a.charges || [], p + '.charges', a, dates, scopes, isFixed) || '<p class="muted">Aucune pour l\'instant.</p>'}
      <div class="row"><button data-add="${p}.charges">Ajouter une charge</button></div>`)}
    ${chargeFold('ch-str', 'Charges de structure Om Holistic', `${sh.charges.length} charge${sh.charges.length > 1 ? 's' : ''}${tot ? ` · quote-part ${money(tot.s)} ${periodName()}` : ''}`,
      `<div class="grid">${select('Répartition entre les applications', 'shared.key', sh.key, [['ca', 'Au prorata du chiffre d\'affaires'], ['egal', 'À parts égales']]).replace('<label>', '<label class="wide">')}</div>
      <details class="fold" id="sh-ramp" ${view.open.has('sh-ramp') ? 'open' : ''}><summary>Montée en charge de la structure</summary>${chargeRamp(sh.charges, all)}</details>
      ${chargeGroups(sh.charges, 'shared.charges', null, all, null)}
      <div class="row"><button data-add="shared.charges">Ajouter une charge de structure</button></div>`)}`;
}

// ---------- Compte d'exploitation ----------

const PNL_ROWS = [
  ['ca', 'Chiffre d\'affaires', 'head'], ['fees', 'Commissions et frais de paiement', 'cost'], ['variable', 'Coûts par cliente et par inscription', 'cost'],
  ['coaching', 'Coaching', 'cost'], ['margin', 'Marge sur coûts variables', 'sub'], ['fixed', 'Charges fixes', 'cost'],
  ['contribution', 'Contribution', 'sub'], ['structure', 'Quote-part structure Om Holistic', 'cost'], ['result', 'Résultat d\'exploitation', 'total']
];

function pnlColumns(r) {
  if (view.app === 'all') {
    const cols = r.all.map(x => { const s = r.summary(x); return { name: x.a.name, go: { page: 'produits', app: x.i }, v: { ...s.total, structure: s.structure } }; });
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
// Scénarios côte à côte et sensibilité du résultat aux hypothèses clés, sur la période affichée.
function scenarioTotals(sc) {
  const r = results(sc), { total } = pnlColumns(r), ic = implantCalc(r), t = cashData(sc);
  return { sc, ca: total.ca, charges: total.ca - total.result, result: total.result, net: ic.cur.net, low: t.low };
}
function scenarioCard() {
  const list = state.scenarios.list, cur = currentScenario() || list[0];
  const cols = list.map(scenarioTotals);
  const cell = (x, v, cls = '') => `<td class="${x.sc.id === cur.id ? 'cur' : ''} ${cls}">${v}</td>`;
  const row = (label, f, neg) => `<tr><td>${label}</td>${cols.map(x => cell(x, short(f(x)), neg && f(x) < 0 ? 'neg' : '')).join('')}</tr>`;
  // Sensibilité : 10 % de moins sur une hypothèse, toutes choses égales par ailleurs.
  const base = cols.find(x => x.sc.id === cur.id) || cols[0];
  const tests = [['volume', -10, 'Inscriptions et abonnées −10 %'], ['price', -10, 'Prix −10 %'], ['duration', -10, 'Durée d\'abonnement −10 %'], ['costs', 10, 'Charges +10 %']]
    .map(([k, d, label]) => ({ label, delta: scenarioTotals({ ...cur, id: 'sens', [k]: (+cur[k] || 0) + d }).result - base.result }));
  const max = Math.max(1, ...tests.map(x => Math.abs(x.delta)));
  return `<details class="card" id="r-scen" ${view.open.has('r-scen') || !view.open.size ? 'open' : ''}><summary><span>Scénarios et sensibilité<br><span class="sum-sub">affiché partout : ${esc(cur.name)} · ${list.map(x => `${esc(x.name)} ${short(cols.find(c => c.sc.id === x.id).result)}`).join(' · ')}</span></span></summary>
    <div class="grid">${select('Scénario affiché dans tous les tableaux', 'scenarios.current', state.scenarios.current, list.map(x => [x.id, x.name])).replace('<label>', '<label class="wide">')}</div>
    <div class="scroll"><table class="scen"><thead><tr><th></th>${cols.map(x => `<th class="${x.sc.id === cur.id ? 'cur' : ''}">${esc(x.sc.name)}</th>`).join('')}</tr></thead><tbody>
      ${row('Chiffre d\'affaires', x => x.ca)}${row('Charges', x => x.charges)}${row('<b>Résultat d\'exploitation</b>', x => x.result, true)}${row('Net pour toi', x => x.net, true)}
      <tr><td>Point bas de trésorerie</td>${cols.map(x => cell(x, `${short(x.low.balance)}<br><small class="muted">${monthName(x.low.month)}</small>`, x.low.balance < 0 ? 'neg' : '')).join('')}</tr></tbody></table></div>
    <p class="muted">${list.filter(x => x.id !== 'central').map(x => `${esc(x.name)} : inscriptions et abonnées ${signedPct(x.volume)}, prix ${signedPct(x.price)}, durée d'abonnement ${signedPct(x.duration)}, charges ${signedPct(x.costs)}`).join('. ')}. <a href="#reglages" data-goto="reglages" data-open="st-scen" data-anchor="st-scen">Modifier les scénarios</a></p>
    <h4>Ce qui pèse le plus sur ton résultat ${periodName()}</h4>
    <div class="sens">${tests.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta)).map(x => `<div class="sens-row"><span>${x.label}</span><span class="sens-bar"><i style="width:${(Math.abs(x.delta) / max * 100).toFixed(1)}%"></i></span><b class="neg">${short(x.delta)}</b></div>`).join('')}</div>
    <p class="muted">Chaque ligne change une seule hypothèse du scénario ${esc(cur.name)}. La plus longue barre est celle à surveiller en priorité.</p></details>`;
}
const signedPct = x => (+x > 0 ? '+' : '') + num(+x || 0) + ' %';

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
  const cur = res.find(x => x.sc.id === curImplant()) || res[0];
  const own = view.app !== 'all' ? r.summary(r.scope[0]).total : null;
  return { im, ca: own ? own.ca : ca, result: own ? own.result : result, months, res, yearCa, over, best, cur, share, appName, totalResult: result };
}
// Bandeau en tête du Résultat : l'implantation choisie et son effet immédiat sur le net.
// Choix de l'implantation là où les impôts et cotisations changent les chiffres (Trésorerie).
function implantPick(id, what) {
  const im = state.implantation, cur = im.scenarios.find(x => x.id === curImplant()) || im.scenarios[0];
  return `<details class="card implant-bar" id="${id}" ${view.open.has(id) ? 'open' : ''}><summary><span>Implantation : ${esc(cur ? cur.name : '—')}<br><span class="sum-sub">${what}</span></span></summary>
    <div class="grid">${select('Implantation de la société', implantPath(), curImplant(), im.scenarios.map(x => [x.id, x.name])).replace('<label>', '<label class="wide">')}</div>
    <p class="muted">Frais de structure, cotisations sociales et impôts de chaque implantation : <a href="#reglages" data-goto="reglages" data-open="st-implant" data-anchor="st-implant">Réglages › Implantation de la société</a>. Comparaison des implantations : <a href="#resultat" data-goto="resultat" data-open="r-implant" data-anchor="r-implant">Résultat › Résultat net selon l'implantation</a>.</p></details>`;
}

function implantBar(r) {
  const { im, ca, result, cur, best, over, appName, share } = implantCalc(r);
  const gap = best.net - cur.net;
  return `<details class="card implant-bar" id="r-imp" ${view.open.has('r-imp') ? 'open' : ''}><summary><span>Implantation : ${esc(cur.sc.name)}<br><span class="sum-sub">Net pour toi ${money(cur.net)} · frais, cotisations et impôts ${money(-(cur.fixed + cur.social + cur.tax + cur.dist) || 0)}</span></span></summary>
    <div class="grid">${select('Implantation de la société', implantPath(), curImplant(), im.scenarios.map(x => [x.id, x.name])).replace('<label>', '<label class="wide">')}</div>
    <div class="net-split"><div><span>Résultat d'exploitation${appName ? ' de ' + esc(appName) : ''}</span><b>${money(result)}</b></div><div><span>Frais, cotisations et impôts</span><b>${money(-(cur.fixed + cur.social + cur.tax + cur.dist) || 0)}</b></div><div class="net"><span>Net pour toi</span><b>${money(cur.net)}</b></div></div>
    <p class="muted">${over(cur) ? '<b class="neg">Plafond de chiffre d\'affaires dépassé pour ce statut.</b> ' : ''}${gap > 0.5 ? `Le scénario « ${esc(best.sc.name)} » donnerait ${money(gap)} de plus.` : 'C\'est le scénario le plus favorable avec les taux saisis.'} ${appName ? `Impôts et cotisations calculés sur toute la société, puis répartis : part de ${esc(appName)} ${Math.round(share * 100)} %. ` : ''}Taux indicatifs à valider. <a href="#resultat" data-goto="resultat" data-open="r-implant" data-anchor="r-implant">Comparer les implantations</a></p>
  </details>`;
}

function implantCard(r) {
  const { im, ca, result, res, yearCa, over, best, cur, appName, share } = implantCalc(r);
  const row = x => [`${x.sc.id === curImplant() ? '<b>' : ''}${esc(x.sc.name)}${x.sc.id === curImplant() ? '</b>' : ''}${x === best ? ' <span class="tag on">Meilleur</span>' : ''}${over(x) ? ' <span class="tag todo">Plafond de CA dépassé</span>' : ''}`,
    signed(-x.fixed || 0), signed(-x.social || 0), signed(-(x.tax + x.dist) || 0), `<b>${signed(x.net)}</b>`, ca ? `${(x.net / ca * 100).toFixed(0)} %` : '—'];
  return `<details class="card" id="r-implant" ${view.open.has('r-implant') || !view.open.size ? 'open' : ''}><summary><span>Résultat net selon l'implantation<br><span class="sum-sub">${esc(cur.sc.name)} : ${money(cur.net)} ${periodName()}</span></span></summary>
    <div class="grid">${select('Implantation retenue', implantPath(), curImplant(), im.scenarios.map(x => [x.id, x.name])).replace('<label>', '<label class="wide">')}</div>
    <div class="net-split"><div><span>Résultat d'exploitation</span><b>${money(result)}</b></div><div><span>Frais de structure</span><b>${money(-cur.fixed || 0)}</b></div><div><span>Cotisations sociales</span><b>${money(-cur.social || 0)}</b></div><div><span>Impôts</span><b>${money(-(cur.tax + cur.dist) || 0)}</b></div><div class="net"><span>Net pour toi</span><b class="${cur.net < 0 ? 'neg' : ''}">${money(cur.net)}</b></div></div>
    ${over(cur) ? `<p class="warn">Le chiffre d'affaires de la société, toutes applications (environ ${money(yearCa)} par an), dépasse le plafond de ${money(+cur.sc.caLimit)} de ce statut.</p>` : ''}
    <h4>Comparaison des implantations</h4>
    <div class="scroll"><table class="pnl">${table(['Implantation', 'Frais', 'Cotisations', 'Impôts', 'Net', '% du CA'], res.map(row))}</table></div>
    <p class="warn">Taux indicatifs, à faire valider par un conseiller fiscal. Le lieu où tu vis décide en général de ton imposition, et la TVA européenne reste due sur les ventes aux clientes européennes quelle que soit l'implantation. Toutes les applications Om Holistic sont comptées ensemble pour calculer les impôts et cotisations${appName ? `, puis seule la part de ${esc(appName)} est affichée ici (${Math.round(share * 100)} % du résultat de la société)` : ''}.</p>
    <p class="muted"><a href="#reglages" data-goto="reglages" data-open="st-implant" data-anchor="st-implant">Modifier les taux et les frais de chaque implantation</a></p></details>`;
}

// Indicateurs clés pour un investisseur : récurrence (MRR, ARR), rétention (churn), économie unitaire
// (ARPU, LTV, CAC, LTV / CAC, retour sur CAC), rentabilité (marge brute, EBITDA) et financement (besoin, burn, autonomie).
// Un programme = un produit : inscriptions, prix moyen, marge et contribution par inscription, retour sur coaching.
function progKpis(r, s) {
  if (view.app === 'all') return '';
  const x = r.scope[0], a = x.a;
  const rows = a.programs.filter(p => p.enabled !== false).map(p => {
    const c = s.cols[p.id] || { ca: 0, coaching: 0, margin: 0, contribution: 0 }, i = a.programs.indexOf(p);
    const ins = x.months.filter(m => inPeriod(m.month)).reduce((t, m) => t + m.products[i].admissions, 0);
    const per = v => ins > 0.5 ? money(v / ins) : '—';
    return [esc(p.name), num(ins), per(c.ca), per(c.coaching), `${per(c.contribution)}`, `${signed(c.contribution)}`, pctOf(c.contribution, c.ca)];
  });
  if (!rows.length) return '';
  return `<h4 class="kpi-h">Programmes de ${esc(a.name)}</h4>
    <div class="scroll"><table>${table(['Programme', 'Inscriptions', 'CA HT / inscription', 'Coaching / inscription', 'Contribution / inscription', 'Contribution', 'Taux'], rows, [])}</table></div>
    <p class="muted">Contribution : ce que le programme laisse après ses coûts variables, son coaching et ses charges fixes propres, avant les charges communes et la structure.</p>`;
}
// Indicateurs investisseurs de la période affichée.
function kpiValues(r, tr = scopeTreasury(r)) {
  const scope = r.scope, ms = r.byMonth;
  if (!ms.length) return null;
  const ht = x => state.vat?.ttc ? x / (1 + (+state.vat.rate || 0) / 100) : x;
  const s = sumPnl(scope.flatMap(x => x.pnl.filter(e => inPeriod(e.month)))), t = s.total;
  const last = ms.at(-1), first = ms[0];
  const subCA = m => ht(m.directCA + m.postCA);
  const mrr = subCA(last), mrr0 = subCA(first), n = ms.length;
  const cmgr = n > 1 && mrr0 > 0 ? (Math.pow(mrr / mrr0, 1 / (n - 1)) - 1) * 100 : null;
  // Churn mensuel : abonnées perdues / abonnées en début de mois, sur la période.
  let lost = 0, base = 0;
  for (const x of scope) {
    const dur = +x.a.sub.duration > 0 ? 1 / +x.a.sub.duration : 0, pdur = +x.a.sub.postDuration > 0 ? 1 / +x.a.sub.postDuration : 0;
    x.months.forEach((m, k) => { if (!k || !inPeriod(m.month)) return; const p = x.months[k - 1]; lost += p.direct * dur + p.post * pdur; base += p.direct + p.post; });
  }
  const churn = base ? lost / base : 0;
  const subsMonths = ms.reduce((a, m) => a + m.direct + m.post, 0), subRev = ms.reduce((a, m) => a + subCA(m), 0);
  const arpu = subsMonths ? subRev / subsMonths : 0;
  const gm = t.ca ? (t.ca - t.fees - t.variable - t.coaching) / t.ca : 0;
  const ltv = churn > 0 ? arpu * gm / churn : null;
  // CAC : dépenses de publicité et d'acquisition / nouvelles clientes (inscriptions et nouvelles abonnées).
  const fresh = scope.reduce((a, x) => a + x.months.filter(m => inPeriod(m.month)).reduce((b, m) => b + (m.newDirect || []).reduce((c, v) => c + v, 0) + m.products.reduce((c, q) => c + q.admissions - (q.fromSolo || 0), 0), 0), 0);
  const mkt = s.cats.marketing || 0, cac = fresh > 0.5 ? mkt / fresh : null;
  const ratio = ltv !== null && cac ? ltv / cac : null, payback = cac && arpu * gm > 0 ? cac / (arpu * gm) : null;
  const ebitda = t.result;
  const need = tr.low.balance < 0 ? -tr.low.balance : 0;
  const tm = tr.months.filter(m => inPeriod(m.month)), endCash = tm.at(-1)?.balance ?? 0;
  const flows = tm.map((m, k) => m.balance - (k ? tm[k - 1].balance : m.balance - (m.inflow - m.charges - m.taxes - m.pay)) - (m.raised || 0));
  const burn = flows.length ? -flows.reduce((a, v) => a + v, 0) / flows.length : 0;
  const runway = burn > 0 ? endCash / burn : null;
  const yearGrowth = cmgr === null ? null : (Math.pow(1 + cmgr / 100, 12) - 1) * 100, ebitdaPct = t.ca ? ebitda / t.ca * 100 : null;
  const rule40 = yearGrowth === null || ebitdaPct === null ? null : yearGrowth + ebitdaPct;
  return { s, t, last, mrr, cmgr, churn, base, arpu, gm, ltv, cac, ratio, payback, ebitda, ebitdaPct, yearGrowth, rule40, tr, need, tm, endCash, burn, runway };
}
const fmtN = (v, d = 0) => v === null || !isFinite(v) ? '—' : v.toLocaleString('fr-FR', { maximumFractionDigits: d });
// Niveau d'un indicateur face au repère investisseur : good, ok, low (up : plus c'est haut, mieux c'est).
function benchLevel(k, v, up = true) {
  const B = state.bench || defaultBench();
  if (v === null || v === undefined || Number.isNaN(v) || (!isFinite(v) && v !== Infinity) || !B[k]) return '';
  const { good, ok } = B[k];
  return up ? (v >= good ? 'good' : v >= ok ? 'ok' : 'low') : (v <= good ? 'good' : v <= ok ? 'ok' : 'low');
}

// ARR : pas de bon ou mauvais dans l'absolu, un stade (pré-amorçage, amorçage, série A) et la progression vers le palier suivant.
function arrStage(v) {
  const B = (state.bench || defaultBench()).arr;
  return v >= B.good ? { name: 'série A', next: null } : v >= B.ok ? { name: 'amorçage', next: ['série A', B.good] } : { name: 'pré-amorçage', next: ['amorçage', B.ok] };
}
function arrMark(v) {
  if (v === null || !isFinite(v)) return '';
  const st = arrStage(v), pct = st.next ? Math.max(0, Math.min(100, v / st.next[1] * 100)) : 100;
  return `<div class="gauge stage"><div class="g-track"><i class="z fill" style="width:${pct.toFixed(1)}%"></i><i class="z rest" style="width:${(100 - pct).toFixed(1)}%"></i></div>
    <div class="g-t"><span class="tgt">stade : ${st.name}</span><span class="gap">${st.next ? `${fmtN(pct)} % du palier ${st.next[0]} (${short(st.next[1])})` : 'palier série A atteint'}</span></div></div>`;
}

// Repère investisseur : vert (bon), orange (correct), rouge (en dessous). up : plus c'est haut, mieux c'est.
function mark(k, v, unit, up = true, fmt = num) {
  const B = state.bench || defaultBench();
  const inf = v === Infinity;
  if (v === null || v === undefined || (!isFinite(v) && !inf) || !B[k]) return '';
  const { good, ok } = B[k], lvl = benchLevel(k, v, up);
  // Jauge : zones faible / correct / bon, repère en trait, position de la valeur en point.
  const max = Math.max(up ? good * 1.6 : ok * 1.5, inf ? 0 : v * 1.05, 1e-9), pos = x => x === Infinity ? '100.0' : Math.max(0, Math.min(100, x / max * 100)).toFixed(1);
  const zones = up ? `<i class="z low" style="width:${pos(ok)}%"></i><i class="z ok" style="width:${pos(good) - pos(ok)}%"></i><i class="z good" style="width:${100 - pos(good)}%"></i>`
    : `<i class="z good" style="width:${pos(good)}%"></i><i class="z ok" style="width:${pos(ok) - pos(good)}%"></i><i class="z low" style="width:${100 - pos(ok)}%"></i>`;
  const gap = v - good, gapTxt = inf ? 'sans limite' : (gap >= 0 ? '+' : '−') + fmt(Math.abs(Math.round(gap * 10) / 10)) + unit;
  return `<div class="gauge ${lvl}"><div class="g-track">${zones}<b class="g-dot" style="left:${pos(v)}%"></b></div>
    <div class="g-t"><span class="tgt">repère ${up ? '≥' : '≤'} ${fmt(good)}${unit}</span><span class="gap">${gapTxt}${{ good: ' · bon', ok: ' · correct', low: ' · faible' }[lvl]}</span></div></div>`;
}

function kpiCard(r) {
  const K = kpiValues(r);
  if (!K) return '';
  const { s, t, last, mrr, cmgr, churn, base, arpu, gm, ltv, cac, ratio, payback, ebitda, ebitdaPct, rule40, tr, need, tm, endCash, burn, runway } = K, f = fmtN;
  const kpi = (label, value, hint, cls = '', bench = '') => `<div class="kpi"><small>${label}</small><b class="${cls}">${value}</b><small>${hint}</small>${bench}</div>`;
  const group = (title, items) => `<h4 class="kpi-h">${title}</h4><div class="kpis">${items.join('')}</div>`;
  return `<details class="card" id="r-kpi" ${view.open.has('r-kpi') || !view.open.size ? 'open' : ''}><summary><span>Indicateurs clés (investisseurs)<br><span class="sum-sub">ARR ${short(mrr * 12)} · marge brute ${f(gm * 100)} % · LTV / CAC ${ratio === null ? '—' : f(ratio, 1)} · besoin de financement ${short(need)}</span></span></summary>
    ${group('Revenus récurrents', [
      kpi('MRR', short(mrr), `revenu mensuel récurrent HT, ${monthName(last.month)}`),
      kpi('ARR', short(mrr * 12), 'revenu annuel récurrent : tes abonnements du mois × 12', '', arrMark(mrr * 12)),
      kpi('Croissance du MRR', cmgr === null ? '—' : (cmgr >= 0 ? '+' : '') + f(cmgr, 1) + ' %', 'par mois en moyenne sur la période', '', mark('growth', cmgr, ' %')),
      kpi('Abonnées', num(last.direct + last.post), `fin de période · ${num(r.sum('admissions'))} inscriptions aux programmes`)])}
    ${group('Économie unitaire', [
      kpi('ARPU', price(Math.round(arpu * 100) / 100), 'revenu moyen par abonnée et par mois, HT'),
      kpi('Churn mensuel', f(churn * 100, 1) + ' %', 'abonnées perdues chaque mois', '', base ? mark('churn', churn * 100, ' %', false) : ''),
      kpi('LTV', ltv === null ? '—' : short(ltv), 'marge brute laissée par une abonnée sur sa durée de vie'),
      kpi('CAC', cac === null ? '—' : price(Math.round(cac * 100) / 100), cac === null ? 'aucune dépense d\'acquisition saisie' : 'publicité et acquisition / nouvelle cliente'),
      kpi('LTV / CAC', ratio === null ? '—' : f(ratio, 1), 'valeur d\'une cliente / coût pour l\'acquérir', '', mark('ltvcac', ratio, '')),
      kpi('Retour sur CAC', payback === null ? '—' : f(payback, 1) + ' mois', 'mois de marge pour rembourser une acquisition', '', mark('payback', payback, ' mois', false))])}
    ${progKpis(r, s)}
    ${group('Rentabilité', [
      kpi('Chiffre d\'affaires HT', short(t.ca), periodName()),
      kpi('Marge brute', f(gm * 100) + ' %', 'après charges variables (marge sur coûts variables)', '', t.ca ? mark('gm', gm * 100, ' %') : ''),
      kpi('Marge EBITDA', ebitdaPct === null ? '—' : f(ebitdaPct) + ' %', `EBITDA ${short(ebitda)} · résultat d'exploitation, sans amortissements`, '', mark('ebitda', ebitdaPct, ' %')),
      kpi('Règle des 40', rule40 === null ? '—' : f(rule40, 0), mrr * 12 >= 1e6 ? 'croissance annuelle (%) + marge EBITDA (%)' : 'croissance + marge EBITDA ; regardée à partir d\'environ 1 M€ d\'ARR', '', mrr * 12 >= 1e6 ? mark('rule40', rule40, '') : ''),
      kpi('Point mort', tr.breakEven ? monthName(tr.breakEven) : 'non atteint', `résultat mensuel positif ensuite${view.app === 'all' ? ', toute la société' : ''}`)])}
    ${group(view.app === 'all' ? 'Financement (toute la société)' : `Financement de ${esc(r.scope[0].a.name)}, comme une société à part`, [
      kpi('Besoin de financement', short(need), need ? `point bas en ${monthName(tr.low.month)}${view.app === 'all' ? ', apport de départ compris' : ', à lever ou à apporter'}` : 'la trésorerie ne passe pas sous zéro', need ? 'bad' : 'good'),
      kpi('Burn rate', burn > 0 ? short(burn) + ' / mois' : 'aucun', burn > 0 ? 'trésorerie consommée par mois en moyenne' : 'la trésorerie augmente sur la période'),
      kpi('Autonomie (runway)', runway === null ? 'illimitée' : f(runway, 0) + ' mois', runway === null ? 'la trésorerie ne baisse pas sur la période' : 'au rythme de consommation actuel', '', mark('runway', runway === null ? Infinity : runway, ' mois')),
      kpi('Trésorerie', short(endCash), `fin ${tm.at(-1) ? monthName(tm.at(-1).month) : ''}`)])}
    <p class="muted">${view.app === 'all' ? 'Toutes applications' : esc(r.scope[0].a.name)}, ${periodName()}, ${currentScenario() ? 'scénario ' + esc(currentScenario().name) : ''}. Prévisions, pas des résultats observés : un investisseur demandera d'où vient chaque hypothèse (Produits et prix, Charges). Le CAC ne compte que les charges classées « Publicité et communication » et le coût d'acquisition par cliente. Impôts et cotisations du financement selon l'implantation « ${esc((state.implantation.scenarios.find(x => x.id === curImplant()) || {}).name || '—')} » (carte Implantation juste au-dessus).</p>
    <p class="muted">Repères indicatifs pour une application d'abonnement grand public, à ajuster dans <a href="#reglages" data-goto="reglages" data-open="st-bench" data-anchor="st-bench">Réglages › Repères investisseurs</a>. Sources : LTV / CAC de 3 ou plus (a16z, « Why do investors care so much about LTV:CAC ») ; churn et rétention des abonnements santé et forme (RevenueCat, State of Subscription Apps), qui conseille aussi de suivre le retour sur CAC plutôt que le seul LTV / CAC ; marge brute de 70 %, marge EBITDA de 20 % et règle des 40 (références courantes du logiciel par abonnement) ; ARR d'environ 1 M€ pour une série A ; croissance de 15 % par mois et 18 mois d'autonomie après une levée (pratiques courantes des fonds d'amorçage).</p></details>`;
}

// ---------- Trajectoire : les indicateurs année par année ----------
// Les investisseurs regardent la tendance et l'année où chaque repère est franchi.
function yearlyKpis(r) {
  const tr = scopeTreasury(r);
  const months = r.scope.flatMap(x => x.months.filter(m => m.caHT > 0).map(m => m.month)).sort();
  if (!months.length) return [];
  const y0 = +months[0].slice(0, 4), y1 = +r.scope[0].months.at(-1).month.slice(0, 4);
  const keep = [view.year, view.period], out = [];
  try {
    for (let y = y0; y <= y1; y++) { view.year = y; view.period = 0; const K = kpiValues(scoped(r), tr); if (K) out.push({ y, K }); }
  } finally { [view.year, view.period] = keep; }
  return out;
}
const TRAJ_ROWS = [
  ['Chiffre d\'affaires HT', K => short(K.t.ca)],
  ['Croissance du CA', (K, P) => P && P.t.ca > 0 ? (K.t.ca >= P.t.ca ? '+' : '−') + fmtN(Math.abs(K.t.ca / P.t.ca - 1) * 100) + ' %' : '—', null, 'sur un an'],
  ['ARR fin d\'année', K => short(K.mrr * 12), null, K => arrStage(K.mrr * 12).name],
  ['Croissance du MRR', K => K.cmgr === null ? '—' : fmtN(K.cmgr, 1) + ' %', K => ['growth', K.cmgr], 'par mois'],
  ['Abonnées fin d\'année', K => num(K.last.direct + K.last.post)],
  ['Churn mensuel', K => K.base ? fmtN(K.churn * 100, 1) + ' %' : '—', K => K.base ? ['churn', K.churn * 100, false] : null],
  ['Marge brute', K => K.t.ca ? fmtN(K.gm * 100) + ' %' : '—', K => K.t.ca ? ['gm', K.gm * 100] : null],
  ['Marge EBITDA', K => K.ebitdaPct === null ? '—' : fmtN(K.ebitdaPct) + ' %', K => ['ebitda', K.ebitdaPct]],
  ['EBITDA', K => `<span class="${K.ebitda < 0 ? 'neg' : ''}">${short(K.ebitda)}</span>`],
  ['LTV / CAC', K => K.ratio === null ? '—' : fmtN(K.ratio, 1), K => ['ltvcac', K.ratio]],
  ['Retour sur CAC', K => K.payback === null ? '—' : fmtN(K.payback, 1) + ' mois', K => ['payback', K.payback, false]],
  ['Règle des 40', K => K.rule40 === null || K.mrr * 12 < 1e6 ? '—' : fmtN(K.rule40), K => K.mrr * 12 >= 1e6 ? ['rule40', K.rule40] : null, 'dès 1 M€ d\'ARR'],
  ['Trésorerie fin d\'année', K => `<span class="${K.endCash < 0 ? 'neg' : ''}">${short(K.endCash)}</span>`]
];
function trajectoryCard(r) {
  const ys = yearlyKpis(r);
  if (ys.length < 2) return '';
  const B = state.bench || defaultBench();
  const rep = (k, up) => k && B[k] ? `${up === false ? '≤' : '≥'} ${k === 'arr' ? short(B[k].good) : fmtN(B[k].good)}${{ growth: ' %', churn: ' %', gm: ' %', ebitda: ' %', payback: ' mois' }[k] || ''}` : '';
  const rows = TRAJ_ROWS.map(([label, val, lvl, sub]) => {
    const probe = lvl && ys.map(o => lvl(o.K)).find(Boolean);
    const cells = ys.map((o, j) => {
      const L = lvl && lvl(o.K), c = L ? benchLevel(L[0], L[1], L[2] !== false) : '';
      return `<td class="${c ? 'lv ' + c : ''}">${val(o.K, j ? ys[j - 1].K : null)}</td>`;
    }).join('');
    const arrRow = typeof sub === 'function';
    return `<tr><th>${label}${sub && !arrRow ? `<small>${sub}</small>` : ''}</th><td class="rep">${arrRow ? 'stade' : probe ? rep(probe[0], probe[2]) : ''}</td>${arrRow ? ys.map(o => `<td>${short(o.K.mrr * 12)}<small class="stg">${sub(o.K)}</small></td>`).join('') : cells}</tr>`;
  }).join('');
  // Première année où chaque repère clé est atteint.
  const first = (k, f, up = true) => { const o = ys.find(x => benchLevel(k, f(x.K), up) === 'good'); return o ? o.y : null; };
  const miles = [['marge EBITDA', first('ebitda', K => K.ebitdaPct)], ['LTV / CAC', first('ltvcac', K => K.ratio)], [`ARR d'amorçage (${short((state.bench || defaultBench()).arr.ok)})`, (ys.find(o => o.K.mrr * 12 >= (state.bench || defaultBench()).arr.ok) || {}).y]]
    .map(([n, y]) => `${n} ${y ? 'dès ' + y : 'non atteint'}`).join(' · ');
  return `<details class="card" id="r-traj" ${view.open.has('r-traj') ? 'open' : ''}><summary><span>Trajectoire ${ys[0].y} → ${ys.at(-1).y}<br><span class="sum-sub">${miles}</span></span></summary>
    <div class="scroll"><table class="traj"><thead><tr><th></th><th class="rep">Repère</th>${ys.map(o => `<th>${o.y}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
    <div class="legend"><span><i class="lv-good"></i>bon</span><span><i class="lv-ok"></i>correct</span><span><i class="lv-low"></i>faible</span></div></details>`;
}

// ---------- Plan avec levée ----------
// Implantation affichée et modifiée : celle du plan avec levée quand il est choisi, sinon celle de la société.
const planApp = () => view.plan === 'avec' && view.app !== 'all' ? state.apps[+view.app] : null;
const curImplant = () => { const a = planApp(), id = a?.raisePlan?.implant; return id && state.implantation.scenarios.some(x => x.id === id) ? id : state.implantation.current; };
const implantPath = () => planApp() ? `apps.${view.app}.raisePlan.implant` : 'implantation.current';
// Copie de l'état où l'application i lève des fonds : ta rémunération, un budget de communication
// calculé pour atteindre l'objectif d'abonnées (au coût d'acquisition choisi), d'autres dépenses,
// le statut de société choisi, et le montant à lever pour couvrir l'autonomie visée.
const raiseDefaultDate = a => a.raiseDate || appDates([a]).launch || appStart(a);
// Nouvelles abonnées d'un mois : directes et clientes d'un programme qui s'abonnent ensuite.
const newSubs = (a, m) => m.newDirect.reduce((t, v) => t + v, 0) + m.products.reduce((t, q, j) => t + q.finishedNew * Math.min(100, +a.programs[j]?.toSolo || 0) / 100, 0);
function applyRaisePlan(st, i, over = {}) {
  const s = st === state || Object.keys(over).length ? JSON.parse(JSON.stringify(st)) : st, a = s.apps[i];
  if (!a || (!a.raisePlan?.on && !over.force)) return s;
  const P = { ...defaultRaisePlan(), ...a.raisePlan, ...over }, R = { ...defaultRaise(), ...(s.raise || {}) };
  const date = raiseDefaultDate(a), ramp = Math.max(1, Math.round(+P.ramp || 1));
  // Leviers : durée d'abonnement, achats de programmes par les abonnées (passerelle), bouche-à-oreille.
  if (+P.duration > 0) { a.sub.duration = +P.duration; if (+a.sub.postDuration > 0) a.sub.postDuration = +P.duration; }
  if (+P.fromSolo > 0) a.programs.forEach(q => { if (q.enabled !== false) q.fromSolo = Math.min(100, +P.fromSolo); });
  // Nouvelles abonnées sans publicité supplémentaire, en moyenne sur l'année qui suit la levée.
  const base = simulate(a).months, k0 = Math.max(0, base.findIndex(m => m.month >= date));
  const yr = base.slice(k0, k0 + 12), organic = yr.length ? yr.reduce((t, m) => t + newSubs(a, m), 0) / yr.length : 0;
  const perMonth = Math.max(0, (+P.target || 0) / 12 * (1 - Math.min(100, +P.organic || 0) / 100) - organic), budget = perMonth * Math.max(0, +P.cac || 0);
  const word = (+P.target || 0) / 12 * Math.min(100, +P.organic || 0) / 100;
  // Les abonnées du bouche-à-oreille arrivent comme celles de la publicité, sans coût d'acquisition.
  a.paid = { from: date, perMonth: perMonth + word, ramp };
  const extra = { scope: 'app', anchor: 'date', start: date, estimate: false, plan: true };
  a.charges = [...(a.charges || []),
    charge('Ta rémunération (plan avec levée)', 'fixe', Math.round((+P.salary || 0) * (1 + (+P.social || 0) / 100)), 'app', date, '', { ...extra, category: 'personnel' }),
    charge('Communication et publicité (plan avec levée)', 'fixe', Math.round(budget / ramp), 'app', date, '', { ...extra, category: 'marketing',
      steps: Array.from({ length: ramp - 1 }, (_, j) => ({ after: j + 1, amount: Math.round(budget * (j + 2) / ramp) })) }),
    ...(+P.extra > 0 ? [charge('Autres dépenses (plan avec levée)', 'fixe', +P.extra, 'app', date, '', { ...extra, category: 'autre' })] : [])];
  if (P.implant && s.implantation.scenarios.some(x => x.id === P.implant)) s.implantation.current = P.implant;
  // Montant à lever : ce qui manque pour que la trésorerie de l'appli reste positive pendant l'autonomie visée.
  a.funding = null;
  const all = s.apps.map((ap, k) => ({ a: ap, i: k, ...simulate(ap) })), pnl = buildPnl(s, all);
  all.forEach((x, k) => { x.pnl = pnl[k]; });
  const tr0 = treasury(s, [all[i]], true), ms = tr0.months, k = Math.max(0, ms.findIndex(m => m.month >= date));
  // Au moins l'autonomie visée, et jusqu'au bout des prévisions : la trésorerie ne doit plus repasser sous zéro ensuite.
  const low = ms.slice(k).reduce((l, m) => Math.min(l, m.balance), 0);
  const need = Math.ceil(-low / 10000) * 10000;
  a.funding = { month: date, amount: +P.amount > 0 ? +P.amount : need, need, budget, perMonth, organic, word, breakEven: tr0.breakEven };
  return s;
}

// ---------- Levée de fonds : ce qu'il est raisonnable de demander ----------
// Deux approches croisées : le besoin (trésorerie à couvrir pendant l'autonomie visée)
// et ce que la valorisation permet sans céder trop de capital.
function raiseValues(r) {
  const x = r.scope[0], a = x.a, R = { ...defaultRaise(), ...(state.raise || {}) }, B = state.bench || defaultBench();
  const tr = scopeTreasury(r), ms = tr.months;
  const ht = v => state.vat?.ttc ? v / (1 + (+state.vat.rate || 0) / 100) : v;
  const firstNeg = ms.find(m => m.balance < 0);
  const auto = firstNeg ? firstNeg.month : (appDates([a]).launch || appStart(a));
  const date = a.funding ? a.funding.month : a.raiseDate && ms.some(m => m.month === a.raiseDate) ? a.raiseDate : auto;
  const k = Math.max(0, ms.findIndex(m => m.month >= date));
  const win = ms.slice(k, k + Math.max(1, +R.runway || 18));
  const low = win.reduce((l, m) => Math.min(l, m.balance), Infinity);
  const need = a.funding ? a.funding.amount : Math.max(0, -low);
  const ask = need ? Math.ceil(need / 10000) * 10000 : 0;
  // Revenus au moment de la levée : abonnements (récurrents) et programmes des 12 derniers mois.
  const sm = x.months.findIndex(m => m.month >= date), m0 = x.months[sm] || x.months.at(-1);
  const arr = ht(m0.directCA + m0.postCA) * 12;
  const prog12 = x.months.slice(Math.max(0, sm - 11), sm + 1).reduce((t, m) => t + ht(m.products.reduce((s2, q) => s2 + q.sales, 0)), 0);
  const stage = arr >= B.arr.good ? 'Série A' : arr >= B.arr.ok ? 'Amorçage (seed)' : 'Pré-amorçage (pre-seed)';
  let vLo = arr * R.multMin + prog12, vHi = arr * R.multMax + prog12;
  if (arr < B.arr.ok) { vLo = Math.max(vLo, R.preMin); vHi = Math.max(vHi, R.preMax); }
  const take = (v, d) => v * d / (100 - d);
  const lo = take(vLo, R.dilMin), hi = take(vHi, R.dilMax);
  const dil = ask ? ask / ((vLo + vHi) / 2 + ask) * 100 : 0;
  const verdict = !ask ? 'none' : ask > hi ? 'high' : ask < lo ? 'low' : 'ok';
  return { a, i: x.i, R, date, auto, isAuto: date === auto, win, need, ask, arr, prog12, stage, vLo, vHi, lo, hi, dil, verdict, lowMonth: win.find(m => m.balance === low) };
}
// Dossier de levée : le plan avec levée de l'application, comparé au plan sans levée.
function dossierCard(r) {
  const id = 'r-raise', x = r.scope[0], a = x.a, F = a.funding;
  if (!F) return '';
  const P = { ...defaultRaisePlan(), ...a.raisePlan }, R = { ...defaultRaise(), ...(state.raise || {}) }, v = raiseValues(r), n = Math.max(1, +R.runway || 18);
  const tr = scopeTreasury(r), k = Math.max(0, tr.months.findIndex(m => m.month >= F.month)), win = tr.months.slice(k, k + n);
  const winSet = new Set(win.map(m => m.month)), lines = sumPnl(x.pnl.filter(e => winSet.has(e.month))).lines || {};
  const planCost = cat => a.charges.filter(c => c.plan && c.category === cat).reduce((t, c) => t + (lines[c.id] || 0), 0);
  const sal = planCost('personnel'), com = planCost('marketing'), ext = planCost('autre');
  const tot = f => win.reduce((t, m) => t + (m[f] || 0), 0), charges = tot('charges'), taxes = tot('taxes'), sales = tot('inflow') - tot('raised');
  const run = Math.max(0, charges - sal - com - ext), endCash = win.at(-1)?.balance ?? 0;
  const uses = [['Ta rémunération', sal, `${money(+P.salary)} net par mois, charges comprises`], ['Communication et publicité', com, `${num(Math.round(F.perMonth))} abonnées payantes par mois à ${money(+P.cac)} l'une`],
    ...(ext ? [['Autres dépenses', ext, `${money(+P.extra)} par mois`]] : []), ['Fonctionnement de l\'appli', run, 'charges du plan sans levée'], ['Impôts et cotisations', taxes, '']].filter(u => u[1] > 0.5);
  const useMax = Math.max(1, ...uses.map(u => u[1]));
  // Jalons : objectif d'abonnées (sur 12 mois glissants), ARR et abonnées à la fin de l'autonomie, point mort.
  const ms = x.months, roll = ms.map((m, j) => ms.slice(Math.max(0, j - 11), j + 1).reduce((t, mm) => t + newSubs(a, mm), 0));
  const hit = ms.find((m, j) => j >= 11 && m.month >= F.month && roll[j] >= (+P.target || 0) * 0.995);
  const endM = ms.find(m => m.month === win.at(-1)?.month) || ms.at(-1);
  const ht = v2 => state.vat?.ttc ? v2 / (1 + (+state.vat.rate || 0) / 100) : v2, arrEnd = ht(endM.directCA + endM.postCA) * 12;
  const kpi = (label, value, hint, cls = '') => `<div class="kpi"><small>${label}</small><b class="${cls}">${value}</b><small>${hint}</small></div>`;
  // Comparaison des deux plans, année par année.
  const keep = view.plan; view.plan = 'sans';
  let ysS; try { ysS = yearlyKpis(results()); } finally { view.plan = keep; }
  const y0 = +F.month.slice(0, 4), ysA = yearlyKpis(r).filter(o => o.y >= y0), byS = new Map(ysS.map(o => [o.y, o.K]));
  const cmp = [['Chiffre d\'affaires HT', K => short(K.t.ca)], ['EBITDA', K => `<span class="${K.ebitda < 0 ? 'neg' : ''}">${short(K.ebitda)}</span>`],
    ['Abonnées fin d\'année', K => num(K.last.direct + K.last.post)], ['ARR fin d\'année', K => short(K.mrr * 12)], ['Trésorerie fin d\'année', K => `<span class="${K.endCash < 0 ? 'neg' : ''}">${short(K.endCash)}</span>`]];
  const cmpRows = cmp.map(([label, f]) => `<tr class="c-s"><th rowspan="2">${label}</th><td class="pl-n">sans</td>${ysA.map(o => `<td>${byS.has(o.y) ? f(byS.get(o.y)) : '—'}</td>`).join('')}</tr>
    <tr class="c-a"><td class="pl-n">avec</td>${ysA.map(o => `<td>${f(o.K)}</td>`).join('')}</tr>`).join('');
  const lvl = { none: 'good', ok: 'good', low: 'good', high: 'bad' }[v.verdict];
  const msg = v.verdict === 'high' ? `${short(F.amount)}, c'est plus que ce que ta valorisation permet en ${monthName(F.month)} (environ ${fmtN(v.dil)} % du capital). Pistes : lever en deux tours, réduire le budget de communication ou la rémunération au début, ou décaler la levée pour arriver avec plus d'abonnées.`
    : `${short(F.amount)} reste dans ce que ta valorisation permet : environ ${fmtN(v.dil)} % du capital, pour ${short(v.vLo)} à ${short(v.vHi)} de valorisation avant levée.`;
  const round = F.amount > +R.roundMax ? ` C'est au-dessus d'une levée de pré-amorçage habituelle en France (${short(+R.roundMin)} à ${short(+R.roundMax)}) : réduis le budget ou découpe en deux tours.`
    : F.amount < +R.roundMin ? ` C'est sous une levée de pré-amorçage habituelle (${short(+R.roundMin)} à ${short(+R.roundMax)}) : des proches, un prêt d'honneur ou la BPI peuvent suffire.`
    : ` C'est le montant habituel d'une levée de pré-amorçage en France (${short(+R.roundMin)} à ${short(+R.roundMax)}), auprès de business angels, de proches et de la BPI.`;
  const implants = state.implantation.scenarios.map(sc => [sc.id, sc.name]);
  return `<details class="card" id="${id}" ${view.open.has(id) || !view.open.size ? 'open' : ''}><summary><span>Dossier de levée de ${esc(a.name)}<br><span class="sum-sub">${short(F.amount)} en ${monthName(F.month)} (le plan demande ${short(F.need)}) · ${num(n)} mois d'autonomie · ${num(+P.target)} nouvelles abonnées par an ${hit ? 'dès ' + monthName(hit.month) : 'non atteint'}</span></span></summary>
    <div class="kpis">
      ${kpi('Montant levé', short(F.amount), F.amount === F.need ? `en ${monthName(F.month)}, juste ce que le plan demande` : `en ${monthName(F.month)} · le plan demande ${short(F.need)} : ${F.amount >= F.need ? `${short(F.amount - F.need)} de marge` : `il manque ${short(F.need - F.amount)}`}`, F.amount >= F.need ? 'good' : 'bad')}
      ${kpi('Ta rémunération', money(+P.salary) + ' net', `${money(Math.round(+P.salary * (1 + (+P.social || 0) / 100)))} par mois pour la société`)}
      ${kpi('Communication', short(F.budget) + ' / mois', `à plein régime après ${num(+P.ramp)} mois · ${num(Math.round(F.organic))} abonnées par mois viennent déjà sans publicité`)}
      ${kpi('Objectif', num(+P.target) + ' / an', hit ? `nouvelles abonnées, atteint dès ${monthName(hit.month)}` : 'nouvelles abonnées, non atteint : augmente le budget ou baisse le CAC', hit ? 'good' : 'bad')}
    </div>
    <p class="raise-v ${F.amount > +R.roundMax || F.amount < F.need ? 'bad' : lvl}">${F.amount < F.need ? `Avec ${short(F.amount)}, il manque ${short(F.need - F.amount)} pour tenir ce plan : la trésorerie passe sous zéro. Lève davantage, ou baisse le budget de communication ou ta rémunération au début. ` : ''}${msg}${round}</p>
    <h4 class="kpi-h">Utilisation des fonds sur ${num(n)} mois</h4>
    <div class="uses">${uses.map(([l, val, h]) => `<div class="use"><span>${l}${h ? `<small>${h}</small>` : ''}</span><b>${short(val)}</b><span class="meter"><i style="width:${(val / useMax * 100).toFixed(1)}%;background:var(--clay)"></i></span></div>`).join('')}</div>
    <dl class="pl-lines uses-t"><dt>Financé par les ventes</dt><dd>${short(sales)}</dd><dt>Financé par la levée</dt><dd>${short(F.amount)}</dd><dt>Reste en caisse au bout de ${num(n)} mois</dt><dd class="${endCash < 0 ? 'neg' : ''}">${short(endCash)}</dd></dl>
    <h4 class="kpi-h">Jalons pour les investisseurs</h4>
    <div class="kpis">
      ${kpi('Stade à la levée', esc(v.stage), `ARR de ${short(v.arr)} en ${monthName(F.month)}`, 'txt')}
      ${kpi('ARR au bout de ' + num(n) + ' mois', short(arrEnd), `${num(endM.direct + endM.post)} abonnées en ${monthName(endM.month)}`, '', )}
      ${kpi('Point mort', tr.breakEven ? monthName(tr.breakEven) : 'non atteint', 'résultat mensuel positif ensuite, rémunération comprise')}
      ${kpi('Valorisation indicative', `${short(v.vLo)} – ${short(v.vHi)}`, 'avant levée')}
    </div>
    <h4 class="kpi-h">Sans levée ou avec levée</h4>
    <div class="scroll"><table class="traj cmp"><thead><tr><th></th><th></th>${ysA.map(o => `<th>${o.y}</th>`).join('')}</tr></thead><tbody>${cmpRows}</tbody></table></div>
    ${section('r-raise-h', 'promo', 'Hypothèses du plan avec levée', `${monthName(F.month)} · ${money(+P.salary)} net · CAC ${money(+P.cac)} · ${num(+P.target)} abonnées / an`, `
      <div class="grid">${monthField('Date de la levée', `apps.${x.i}.raiseDate`, a.raiseDate || '', 'Au lancement')}
      ${field('Montant que tu veux lever (€, 0 = ce que le plan demande)', `apps.${x.i}.raisePlan.amount`, P.amount)}${field('Autonomie à financer (mois)', 'raise.runway', R.runway)}
      ${field('Ta rémunération nette (€ / mois)', `apps.${x.i}.raisePlan.salary`, P.salary)}${field('Charges sur ce salaire (% du net)', `apps.${x.i}.raisePlan.social`, P.social)}
      ${field('Nouvelles abonnées visées par an', `apps.${x.i}.raisePlan.target`, P.target)}${field('Coût d\'acquisition d\'une abonnée payante (€)', `apps.${x.i}.raisePlan.cac`, P.cac)}
      ${field('Montée en charge de la communication (mois)', `apps.${x.i}.raisePlan.ramp`, P.ramp)}${field('Autres dépenses (€ / mois)', `apps.${x.i}.raisePlan.extra`, P.extra)}
      ${select('Statut de la société', `apps.${x.i}.raisePlan.implant`, P.implant, implants)}</div>`)}
    <p class="muted">Coût d'acquisition : une application bien-être paie en général 3 à 6 $ par installation et 20 à 40 $ par essai, et 3 à 4 % des installations deviennent payantes ; compter de 40 à 120 € par abonnée payante selon les canaux (Adapty, Customer acquisition cost 2026 ; Airbridge, Cost per trial and cost per subscription ; RevenueCat, State of Subscription Apps 2025). Commence prudemment et ajuste avec tes vrais chiffres dès les premières campagnes. Ordres de grandeur, à valider avec ton expert-comptable.</p></details>`;
}

// ---------- Page Levée de fonds : le dossier de l'application, toujours avec le plan avec levée ----------
function leveePage() {
  const i = +view.app || 0, a0 = state.apps[i];
  if (!a0.raisePlan?.on) return `${banner({ label: 'Levée de fonds', chip: esc(a0.name), big: 'Pas de plan', note: 'Aucun plan avec levée pour cette application', tiles: [] })}
    <div class="card"><p>Prépare un plan avec levée pour ${esc(a0.name)} : ta rémunération, un budget de communication pour ton objectif d'abonnées, et le montant à lever.</p>
    <div class="row"><button id="raiseOn" data-app="${i}">Préparer le plan avec levée de ${esc(a0.name)}</button></div></div>`;
  const keep = view.plan; view.plan = 'avec';
  try {
    const r = results(), x = r.scope[0], a = x.a, F = a.funding, P = { ...defaultRaisePlan(), ...a.raisePlan }, R = { ...defaultRaise(), ...(state.raise || {}) }, v = raiseValues(r);
    // Valeur d'une abonnée, sur la première année pleine après la levée.
    const ys = yearlyKpis(r), y1 = +F.month.slice(0, 4) + 1, Y = (ys.find(o => o.y === y1) || ys.at(-1) || {}).K;
    const ht = v2 => state.vat?.ttc ? v2 / (1 + (+state.vat.rate || 0) / 100) : v2;
    const yms = x.months.filter(m => +m.month.slice(0, 4) === y1), subsM = yms.reduce((t, m) => t + m.direct + m.post, 0);
    const progSolo = yms.reduce((t, m) => t + m.products.reduce((u, q) => u + (q.admissions > 0 ? ht(q.sales) * q.fromSolo / q.admissions : 0), 0), 0);
    const ltv = Y?.ltv ?? null, ltvAll = Y && Y.churn > 0 && subsM ? (Y.arpu + progSolo / subsM) * Y.gm / Y.churn : ltv, cac = +P.cac || 0;
    const ratio = ltvAll !== null && cac ? ltvAll / cac : null, payback = Y && cac && Y.arpu * Y.gm > 0 ? cac / ((Y.arpu + (subsM ? progSolo / subsM : 0)) * Y.gm) : null;
    const kpi = (label, value, hint, cls = '', g = '') => `<div class="kpi"><small>${label}</small><b class="${cls}">${value}</b><small>${hint}</small>${g}</div>`;
    const valueCard = `<details class="card" id="lv-value" ${view.open.has('lv-value') ? 'open' : ''}><summary><span>Valeur d'une abonnée<br><span class="sum-sub">LTV ${ltvAll === null ? '—' : short(ltvAll)} · CAC ${money(cac)} · LTV / CAC ${ratio === null ? '—' : fmtN(ratio, 1)}</span></span></summary>
      <div class="kpis">
        ${kpi('LTV de l\'abonnement', ltv === null ? '—' : short(ltv), `marge laissée par une abonnée sur sa durée de vie, en ${y1}`)}
        ${kpi('LTV avec les programmes', ltvAll === null ? '—' : short(ltvAll), progSolo > 0.5 ? 'abonnement + programmes achetés par les abonnées' : 'aucune abonnée n\'achète de programme : levier « passerelle » ci-dessous', progSolo > 0.5 ? '' : 'warn-v')}
        ${kpi('LTV / CAC', ratio === null ? '—' : fmtN(ratio, 1), `au coût d'acquisition de ${money(cac)}`, '', mark('ltvcac', ratio, ''))}
        ${kpi('Retour sur CAC', payback === null ? '—' : fmtN(payback, 1) + ' mois', 'mois de marge pour rembourser une acquisition', '', mark('payback', payback, ' mois', false))}
      </div></details>`;
    // Sensibilité au coût d'acquisition.
    const sc = currentScenario(), base = sc && sc.id !== 'central' ? withScenario(state, sc) : state;
    const cacs = [...new Set([40, 60, 80, 100, 120, cac].map(Number))].sort((p1, p2) => p1 - p2);
    const sens = cacs.map(c => ({ c, F: c === cac ? F : applyRaisePlan(base, i, { cac: c }).apps[i].funding }));
    const cell = (o, h) => `<td class="${o.c === cac ? 'cur' : ''}">${h}</td>`;
    const sensRows = [
      ['Communication / mois', o => short(o.F.budget)],
      ['Le plan demande', o => short(o.F.need)],
      [`Avec ${short(F.amount)} levés`, o => F.amount >= o.F.need ? `<span class="pos">+${short(F.amount - o.F.need)}</span>` : `<span class="neg">−${short(o.F.need - F.amount)}</span>`],
      ['Point mort', o => o.F.breakEven ? shortMonth(o.F.breakEven) : 'non atteint'],
      ['LTV / CAC', o => ltvAll === null ? '—' : `<span class="lvt ${benchLevel('ltvcac', ltvAll / o.c)}">${fmtN(ltvAll / o.c, 1)}</span>`]
    ].map(([l, f]) => `<tr><th>${l}</th>${sens.map(o => cell(o, f(o))).join('')}</tr>`).join('');
    const worst = sens.filter(o => o.F.need > F.amount);
    const sensCard = `<details class="card" id="lv-sens" ${view.open.has('lv-sens') || !view.open.size ? 'open' : ''}><summary><span>Si la publicité coûte plus ou moins cher<br><span class="sum-sub">${worst.length ? `ta levée ne suffit plus dès ${money(worst[0].c)} par abonnée` : `ta levée suffit jusqu'à ${money(cacs.at(-1))} par abonnée`}</span></span></summary>
      <div class="scroll"><table class="traj sens"><thead><tr><th>Coût d'une abonnée</th>${sens.map(o => `<th class="${o.c === cac ? 'cur' : ''}">${money(o.c)}</th>`).join('')}</tr></thead><tbody>${sensRows}</tbody></table></div></details>`;
    const p = `apps.${i}.raisePlan`;
    const leversCard = section('lv-levers', 'promo', 'Leviers', `abonnement ${+P.duration > 0 ? num(+P.duration) + ' mois' : 'comme dans Produits'} · bouche-à-oreille ${num(+P.organic || 0)} % · passerelle ${+P.fromSolo > 0 ? num(+P.fromSolo) + ' % par an' : 'comme dans Produits'}`, `
      <div class="grid">${field('Durée moyenne d\'abonnement (mois, 0 = celle de Produits)', `${p}.duration`, P.duration)}
      ${field('Part de l\'objectif venue du bouche-à-oreille et du parrainage (%)', `${p}.organic`, P.organic)}
      ${field('Abonnées qui achètent un programme chaque année (%, 0 = comme dans Produits)', `${p}.fromSolo`, P.fromSolo)}</div>`);
    const marketCard = section('lv-market', 'cal', 'Repères du pré-amorçage', `${fmtN(R.dilMin)} à ${fmtN(R.dilMax)} % du capital · valorisation ${short(R.preMin)} à ${short(R.preMax)} · levée ${short(R.roundMin)} à ${short(R.roundMax)}`, `
      <div class="grid">${field('Capital cédé, au moins (%)', 'raise.dilMin', R.dilMin)}${field('Capital cédé, au plus (%)', 'raise.dilMax', R.dilMax)}
      ${field('Valorisation avant levée, basse (€)', 'raise.preMin', R.preMin)}${field('Valorisation avant levée, haute (€)', 'raise.preMax', R.preMax)}
      ${field('Levée habituelle, basse (€)', 'raise.roundMin', R.roundMin)}${field('Levée habituelle, haute (€)', 'raise.roundMax', R.roundMax)}
      ${field('Multiple de l\'ARR, bas', 'raise.multMin', R.multMin)}${field('Multiple de l\'ARR, haut', 'raise.multMax', R.multMax)}</div>
      <div class="row"><button id="raiseReset">Revenir aux valeurs par défaut</button></div>`);
    return `${banner({ label: 'Levée de fonds', chip: esc(a.name), big: short(F.amount), bigCls: F.amount < F.need ? 'neg-hero' : '',
        note: `en ${monthName(F.month)} · le plan demande ${short(F.need)}${F.amount >= F.need ? ` · ${short(F.amount - F.need)} de marge` : ` · il manque ${short(F.need - F.amount)}`}`,
        tiles: [
          { label: 'Capital cédé', mini: 'Capital', value: `${fmtN(v.dil)} %`, hint: `valorisation ${short(v.vLo)} – ${short(v.vHi)}` },
          { label: 'Communication', mini: 'Pub', value: `${short(F.budget)} / mois`, hint: `${num(Math.round(F.perMonth))} abonnées / mois à ${money(cac)}` },
          { label: 'Point mort', value: F.breakEven ? shortMonth(F.breakEven) : 'non atteint', hint: 'rémunération comprise' },
          { label: 'LTV / CAC', value: ratio === null ? '—' : fmtN(ratio, 1), cls: ratio !== null && ratio < 1 ? 'neg-hero' : '', hint: 'repère ≥ 3' }
        ] })}
      ${dossierCard(r)}
      ${sensCard}
      ${valueCard}
      ${leversCard}
      ${marketCard}
      <p class="muted">Toutes les autres pages montrent ce plan quand tu choisis « ${esc(a.name)} · avec levée » dans la liste en haut.</p>`;
  } finally { view.plan = keep; }
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
    ${kpiCard(r)}
    ${trajectoryCard(r)}
    ${scenarioCard()}
    <details class="card" id="r-bars" open><summary>${view.app === 'all' ? 'Résultat par application' : 'Contribution par produit'}</summary>
        <div class="legend"><span><i style="background:var(--sage-soft)"></i>Chiffre d'affaires</span><span><i style="background:var(--good)"></i>${view.app === 'all' ? 'Résultat' : 'Contribution'}</span></div>
        <div>${barsHtml}</div></details>
    <details class="card" id="r-table" open><summary>Compte d'exploitation ${view.app === 'all' ? 'par application' : 'par produit'}</summary><p class="muted">Touche le nom d'${view.app === 'all' ? 'une application' : 'un produit'} pour ouvrir ses réglages.</p>${tableHtml}</details>
    ${natureCard(r)}
    ${implantCard(r)}
    <details class="card" id="r-read"><summary>Comment lire ce compte</summary>
        <p class="muted">La <b>contribution</b> d'un produit, c'est ce qu'il rapporte une fois payés ses propres coûts : frais de paiement, coûts par cliente, coaching et charges fixes qui lui sont rattachées.
        Les charges communes de l'application et la quote-part de structure Om Holistic sont ensuite déduites pour obtenir le <b>résultat d'exploitation</b>, avant impôts et cotisations personnelles.</p></details>
    ${printButton()}`;
}

// ---------- Rendu ----------

function renderToolbar() {
  const settings = SETTINGS_PAGES.includes(view.page), levee = view.page === 'levee';
  if ((settings || levee) && view.app === 'all') view.app = String(Math.max(0, state.apps.findIndex(a => a.raisePlan?.on)));
  if (levee) {
    $('app').innerHTML = state.apps.map((a, i) => `<option value="${i}">${esc(a.name)}</option>`).join('');
    $('app').value = view.app;
    document.querySelectorAll('.period-only').forEach(el => { el.hidden = true; });
    $('step').parentElement.hidden = true;
    document.querySelector('.toolbar').classList.remove('four');
    document.querySelectorAll('#tabs a').forEach(a => a.classList.toggle('current', a.hash === '#' + view.page));
    return;
  }
  $('app').innerHTML = (settings ? '' : '<option value="all">Om Holistic · consolidé</option>')
    + state.apps.map((a, i) => `<option value="${i}">${esc(a.name)}</option>`
      + (!settings || view.page === 'charges' ? (a.raisePlan?.on ? `<option value="${i}+">${esc(a.name)} · avec levée</option>` : '') : '')).join('');
  if (view.plan === 'avec' && (view.app === 'all' || !state.apps[+view.app]?.raisePlan?.on || (settings && view.page !== 'charges'))) view.plan = 'sans';
  $('app').value = view.app + (view.plan === 'avec' ? '+' : '');
  document.querySelectorAll('.period-only').forEach(el => { el.hidden = settings && view.page !== 'charges'; });
  $('step').parentElement.hidden = view.page !== 'tresorerie';
  document.querySelector('.toolbar').classList.toggle('four', view.page === 'tresorerie');
  $('step').value = view.cashStep;
  const y0 = Math.min(...state.apps.map(a => +appStart(a).slice(0, 4))), y1 = Math.max(HORIZON_END, ...state.apps.map(a => +appStart(a).slice(0, 4) + 5));
  const years = []; for (let y = y0; y <= y1; y++) years.push(y);
  if (!years.includes(view.year)) view.year = years[0];
  $('year').innerHTML = years.map(y => `<option>${y}</option>`).join('');
  $('year').value = view.year;
  $('period').value = view.period;
  $('year').disabled = String(view.period) === '7';
  document.querySelectorAll('#tabs a').forEach(a => a.classList.toggle('current', a.hash === '#' + view.page));
}

function render(fresh = false) {
  // Garde ouvertes les zones dépliées, sauf en arrivant sur une nouvelle page.
  view.open = view.goto ? new Set([view.goto.open, view.goto.anchor]) : fresh ? new Set() : new Set([...document.querySelectorAll('#page details[open]')].map(d => d.id));
  renderToolbar();
  const i = +view.app || 0, a = state.apps[i];
  const pages = { synthese: synthesePage, resultat: resultatPage, previsionnel: previsionnelPage, tresorerie: tresoreriePage, levee: leveePage, charges: () => chargesPage(a, i), produits: () => productsPage(a, i), reglages: () => settingsPage(a, i) };
  const due = backupDue();
  $('page').innerHTML = (newVersion ? '<button class="update-strip" id="updateApp">Nouvelle version de l\'appli disponible · touche ici pour la charger</button>' : '') + syncStrip() + (due && view.page !== 'reglages' ? `<a class="backup-strip" href="#reglages" data-goto="reglages" data-open="st-save" data-anchor="st-save">${due} · exporte tes paramètres ›</a>` : '') + pages[view.page]();
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
  } else if (t.dataset.actual) {
    const [ai, month, f] = t.dataset.actual.split('|'), a = state.apps[+ai];
    a.actuals = a.actuals || {};
    const cur = a.actuals[month] = a.actuals[month] || {};
    if (t.value === '') delete cur[f]; else cur[f] = Math.max(0, +t.value || 0);
    if (!Object.keys(cur).length) delete a.actuals[month];
    save(); render();
  } else if (t.dataset.path) {
    const [o, k] = resolve(t.dataset.path);
    if (k === 'estimate_ok') o.estimate = !t.checked;
    else o[k] = t.type === 'checkbox' ? t.checked : t.type === 'number' ? (t.dataset.path.startsWith('scenarios.') ? Math.max(-100, +t.value || 0) : Math.max(0, +t.value || 0)) : t.value;
    save();
    // On redessine après que le focus est passé au champ suivant, puis on lui rend le focus,
    // pour que les résumés se mettent à jour sans fermer le clavier.
    setTimeout(() => {
      const next = document.activeElement?.dataset?.path;
      render();
      if (next) document.querySelector(`[data-path="${CSS.escape(next)}"]`)?.focus({ preventScroll: true });
    }, 0);
  } else if (t.id === 'app') { if (view.page !== 'levee') view.plan = t.value.endsWith('+') ? 'avec' : 'sans'; view.app = t.value.replace('+', ''); render(true); }
  else if (t.id === 'year') { view.year = +t.value; view.cashFrom = view.cashTo = ''; render(); }
  else if (t.id === 'period') { view.period = +t.value; view.cashFrom = view.cashTo = ''; render(); }
  else if (t.id === 'step') {
    view.cashStep = t.value;
    try { localStorage.setItem('om-cash-step', view.cashStep); } catch { /* stockage indisponible */ }
    render();
  }
  else if (t.id === 'cashFrom' || t.id === 'cashTo') {
    view.cashFrom = $('cashFrom').value; view.cashTo = $('cashTo').value;
    if (view.cashFrom > view.cashTo) [view.cashFrom, view.cashTo] = [view.cashTo, view.cashFrom];
    render();
  }
  else if (t.id === 'import') {
    try {
      const x = JSON.parse(await t.files[0].text());
      if (!isValidState(x)) throw Error('Ce fichier ne ressemble pas à un export de ce tableau de bord.');
      snapshot('avant import', state, true); state = migrate(x); view.app = '0'; save(); render();
    } catch (err) { $('importMsg').textContent = err.message; }
  }
});

document.addEventListener('click', e => {
  if (e.target.closest && e.target.closest('#saveBtn')) { saveNow(); return; }
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
  } else if (t.id === 'updateApp') {
    location.replace(location.pathname + '?v=' + encodeURIComponent(newVersion) + location.hash);
  } else if (t.id === 'benchReset') { state.bench = defaultBench(); save(); render();
  } else if (t.id === 'raiseOn') { const a = state.apps[+t.dataset.app]; a.raisePlan = { ...defaultRaisePlan(), ...(a.raisePlan || {}), on: true }; save(); render();
  } else if (t.id === 'raiseReset') { state.raise = defaultRaise(); save(); render();
  } else if (t.id === 'cashReset') { view.cashFrom = view.cashTo = ''; render();
  } else if (t.dataset.restore !== undefined) {
    const h = history()[+t.dataset.restore];
    if (h) { const x = JSON.parse(h.data); if (isValidState(x)) { snapshot('avant retour', state, true); state = migrate(x); view.app = '0'; save(); render(); } }
  } else if (t.dataset.sync) { snapshot('avant de départager', state, true); Sync.keep(t.dataset.sync);
  } else if (t.id === 'syncNow') { Sync.now();
  } else if (t.id === 'syncOff') { Sync.disable(); render();
  } else if (t.id === 'syncOn') {
    const phrase = $('syncPhrase').value;
    t.disabled = true; t.textContent = 'Connexion…'; view.syncMsg = '';
    Sync.enable(phrase, !!stored('om-last-edit')).then(() => render(), err => { view.syncMsg = err.message; render(); });
  } else if (t.id === 'resetYes') { view.confirmReset = false; snapshot('avant remise à zéro', state, true); state = defaultState(); view.app = '0'; save(); render(true);
  } else if (t.id === 'addApp') {
    state.apps.push(application('Nouvelle application')); view.app = String(state.apps.length - 1); save(); render();
  } else if (t.id === 'printPdf') {
    document.querySelectorAll('#page details').forEach(d => { d.open = true; });
    setTimeout(() => window.print(), 50);
  } else if (t.id === 'export') {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
    link.download = 'om-holistic-finances.json';
    link.click();
    try { localStorage.setItem('om-last-export', new Date().toISOString()); } catch { /* stockage indisponible */ }
    render();
  }
});

// Nouvelle version de l'appli : l'écran d'accueil de l'iPhone et de l'iPad garde parfois l'ancienne en mémoire.
// À l'ouverture et au retour sur l'appli, on regarde la version en ligne ; si elle a changé, un bandeau propose de recharger.
const appVersion = () => document.querySelector('meta[name="om-version"]')?.content || '';
let newVersion = null;
async function checkUpdate() {
  if (!/^https?:/.test(location.protocol) || !appVersion()) return;
  try {
    const html = await (await fetch(location.pathname + '?check=' + Date.now(), { cache: 'no-store' })).text();
    const v = (html.match(/name="om-version" content="([^"]+)"/) || [])[1];
    if (v && v !== appVersion() && v !== newVersion) { newVersion = v; render(); }
  } catch { /* hors ligne */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkUpdate(); });
setTimeout(checkUpdate, 1500);

// Une version plus récente arrive d'un autre appareil : on la prend, sans la renvoyer.
Sync.init({
  state: () => state,
  apply(x) {
    if (!isValidState(x)) return false;
    snapshot('avant synchro', state, true);
    state = migrate(x);
    if (!state.apps[+view.app]) view.app = '0';
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* stockage indisponible */ }
    render();
    return true;
  },
  // Le statut change : on met à jour la ligne d'état, et on redessine seulement pour un conflit, une erreur ou leur fin.
  onStatus(changed) {
    const el = $('syncStatus');
    if (el) { el.textContent = syncText(); el.className = 'sync-state ' + Sync.status.state; }
    saveLabel();
    if (changed && (['conflict', 'error'].includes(Sync.status.state) || document.querySelector('.sync-strip'))) render();
  }
});
route();

saveLabel();
