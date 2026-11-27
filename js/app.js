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
const PAGES = ['synthese', 'previsionnel', 'calendrier', 'utilisatrices', 'notoriete', 'acquisition', 'coaching', 'resultat', 'tresorerie', 'levee', 'charges', 'produits', 'reglages'];
const SETTINGS_PAGES = ['calendrier', 'notoriete', 'acquisition', 'charges', 'produits', 'reglages'];

// ---------- Champs de formulaire liés à l'état par un chemin "apps.0.programs.1.name" ----------

function field(label, path, value, type = 'number') {
  // Les écarts de scénario peuvent être négatifs ; tous les autres nombres sont positifs.
  const extra = type === 'number' ? (String(path).startsWith('scenarios.') ? ' step="any"' : ' min="0" step="any"') : '';
  // Un libellé « titre\nexplication » s'affiche sur deux lignes.
  const [head, more] = String(label).split('\n');
  const text = more ? `<span class="lh">${esc(head)}</span><span class="lx">${esc(more)}</span>` : esc(label);
  // Grands nombres : la valeur mise en forme sous le champ (1000000 → 1 000 000).
  const echo = type === 'number' && Math.abs(+value) >= 10000 ? `<span class="echo">${num(+value)}</span>` : '';
  return `<label${more ? ' class="two"' : ''}>${text}${echo}<input data-path="${esc(path)}" type="${type}"${extra} value="${esc(value)}"></label>`;
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
    field(q.gift ? `Deviennent abonnées payantes après l'offre (%)\nPart des clientes ${progName(a, q)} qui gardent ${soloName(a)} en payant après l'année offerte` : `Abonnement gardé après le programme (%)\nPart des clientes ${progName(a, q)} qui gardent ${soloName(a)} à la fin`, path + '.toSolo', q.toSolo) +
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
// Les chemins « draft. » visent le brouillon de la fenêtre de charge, pas l'état enregistré.
const isDraft = path => String(path).startsWith('draft.');
function resolve(path) {
  const keys = path.split('.'), last = keys.pop();
  const root = keys[0] === 'draft' ? (keys.shift(), view.chEdit.c) : state;
  return [keys.reduce((o, k) => o[k], root), last];
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

// CHRYSALISS offert pendant 1 an depuis le début du programme (oui / non), puis une part passe au payant.
function giftSection(a, q, j, t) {
  const g = Math.round(giftWeeks(q) * 12 / 52), solo = esc(soloName(a));
  const ms = prodSim ? prodSim.months : [], peak = Math.max(0, ...ms.map(m => m.products[j]?.gifted || 0));
  return section('gift-p' + j, 'sub', `${solo} offert après le programme`, q.gift ? `offert 1 an · ${num(+q.toSolo || 0)} % payantes ensuite` : `pas d'offre · ${num(+q.toSolo || 0)} % s'abonnent à la fin`, `
    ${check(`${soloName(a)} offert pendant 1 an (programme inclus)`, t + '.gift', q.gift)}
    <div class="grid one">${field(q.gift ? `Deviennent payantes\naprès l'année offerte (%)` : `Deviennent payantes\nà la fin du programme (%)`, t + '.toSolo', q.toSolo)}</div>
    <p class="muted">${q.gift
      ? `Soit <b>${num(g)} mois offerts après le programme</b> (1 an moins ${num(+q.duration || 0)} semaines de programme), recalculé si tu changes la durée. Les clientes de ${esc(q.name)} gardent ${solo} gratuitement pendant ce temps. Pendant l'offre, elles comptent dans Utilisatrices et dans les charges par cliente, sans chiffre d'affaires${peak >= 1 ? ` (jusqu'à ${num(Math.round(peak))} en même temps)` : ''}. À la fin de l'offre, ${num(+q.toSolo || 0)} % s'abonnent en payant et les autres partent.`
      : `Sans offre, ${num(+q.toSolo || 0)} % des clientes s'abonnent en payant dès la fin du programme.`} Les clientes déjà abonnées à ${solo} continuent de payer.</p>`);
}
function programCard(a, q, j, p) {
  const t = p + '.programs.' + j;
  const open = view.open.has('p' + j) ? 'open' : '';
  const launch = q.start ? 'lancement ' + monthName(q.start) : 'sans lancement prévu';
  const calSummary = [q.cohorts.length ? `${q.cohorts.length} cohorte${q.cohorts.length > 1 ? 's' : ''} de test` : 'pas de cohorte de test', launch].join(' · ');
  return `<details class="card product" id="p${j}" ${open}><summary><span>${esc(progName(a, q))} <span class="tag ${q.enabled ? 'on' : ''}">${q.enabled ? 'Actif' : 'Inactif'}</span><br><span class="sum-sub">${calSummary}</span>
      ${pstats([['Prix', priceRange(q.pricing)], ['Durée', `${num(q.duration)} sem.`], ['Coaching', `${num(+q.coach || 0)}${(q.coachSteps || []).length ? ' → ' + num(coachAt(q, '9999-12')) : ''} min`],
        q.enabled && q.start ? ['1re année', `${num(firstYear(q.start, m => m.products[j].admissions) || 0)} inscr.`, 'hi'] : null,
        q.enabled && q.start ? ['CA 1re année', money(firstYear(q.start, m => m.products[j].sales) || 0), 'hi'] : null])}</span></summary>
      <div class="grid head4">
        <label>Programme<span class="tbox"><input data-path="${t}.enabled" type="checkbox" ${q.enabled ? 'checked' : ''}>Actif</span></label>
        ${field('Nom du programme', t + '.name', q.name, 'text')}${field('Durée (semaines)', t + '.duration', q.duration)}${field('Coaching / cliente (min / sem.)', t + '.coach', q.coach)}
      </div>
      <p class="muted">${+q.coach > 0 ? `Soit ${num(Math.round(+q.coach * 10 / 60 * 10) / 10)} h par semaine pour 10 clientes en même temps. ` : ''}${(q.coachSteps || []).length ? `Baisses prévues : ${q.coachSteps.filter(c => c.date).map(c => `${num(+c.minutes || 0)} min dès ${monthName(c.date)}`).join(', ')}. ` : ''}Pour le changer à une date : onglet <a href="#coaching" data-goto="coaching">Coaching</a>.</p>
      <p class="muted"><a href="#calendrier" data-goto="calendrier" data-open="calp-${j}" data-anchor="calp-${j}">Cohortes de test et lancement : Calendrier ›</a></p>
      ${pricingEditor(q.pricing, t + '.pricing', 'Prix (total payé à l\'inscription)', 'price-p' + j, `<div class="grid">${field('Paiement en\nnombre de mensualités (1 = comptant)', t + '.installments', q.installments || 1)}</div>
        <p class="muted">Le chiffre d'affaires compte toujours au mois de l'inscription ; seule la trésorerie reçoit l'argent mensualité par mensualité.</p>`)}
      ${giftSection(a, q, j, t)}
      <p class="muted"><a href="#acquisition" data-goto="acquisition" data-open="acq-p${j}" data-anchor="acq-p${j}">Rythme d'inscriptions, pub et passerelles avec ${esc(soloName(a))} : Acquisition ›</a></p>
      ${section('promo-p' + j, 'promo', 'Promotions ponctuelles', q.promos.length ? `${q.promos.length} promotion${q.promos.length > 1 ? 's' : ''}` : 'aucune', `
        ${q.promos.map((r, k) => lineEditor(r, t + '.promos.' + k, [['start', 'Début', 'month'], ['end', 'Fin', 'month'], ['price', 'Prix (€)']], 'Supprimer la promotion')).join('')}
        <div class="row"><button data-add="${t}.promos">Ajouter une promotion</button></div>
        <p class="muted">Une promotion remplace le prix de la phase pendant ses mois.</p>`)}
      <div class="row"><button class="danger" data-remove="${t}">Supprimer le programme</button></div>
    </details>`;
}

function productsPage(a, i) {
  prodSim = simulate(a);
  const p = 'apps.' + i;
  const g = a.sub.directPricing;
  // Le produit « seul » : l'abonnement, avec en option ce qui se passe après un programme.
  const solo = `<details class="card product solo" id="sd" ${view.open.has('sd') ? 'open' : ''}><summary><span>${esc(soloName(a))}<br><span class="sum-sub">Abonnement mensuel · ${a.sub.start ? 'ouverture ' + monthName(a.sub.start) : 'pas encore ouvert'}</span>
      ${pstats([['Prix', priceRange(g) + ' / mois'], ['Durée', +a.sub.duration > 0 ? `${num(a.sub.duration)} mois` : 'illimitée'], +a.sub.trialDays > 0 ? ['Essai', `${num(a.sub.trialDays)} j`] : null,
        a.sub.start ? ['Abonnées à 1 an', num(((m => m ? m.direct + m.post : 0)(prodSim && prodSim.months.find(m => m.month === addMonths(a.sub.start, 11))))), 'hi'] : null,
        a.sub.start ? ['CA 1re année', money(firstYear(a.sub.start, m => m.directCA + m.postCA) || 0), 'hi'] : null])}</span></summary>
      <div class="grid">${field('Durée moyenne d\'abonnement\nmois, aussi après un programme', p + '.sub.duration', a.sub.duration)}</div>
      ${check('Les abonnées gardent le prix de la phase où elles se sont abonnées', p + '.sub.lockPrice', a.sub.lockPrice)}
      <p class="muted"><a href="#calendrier" data-goto="calendrier" data-open="cal-sd" data-anchor="cal-sd">Ouverture des abonnements : Calendrier ›</a></p>
      <p class="muted"><a href="#acquisition" data-goto="acquisition" data-open="acq-sd" data-anchor="acq-sd">Rythme d'abonnements et pub : Acquisition ›</a></p>
      ${pricingEditor(g, p + '.sub.directPricing', 'Prix mensuel', 'price-sd')}
      ${section('trial-sd', 'promo', 'Période d\'essai', +a.sub.trialDays > 0 ? `${num(a.sub.trialDays)} jours gratuits · ${num(a.sub.trialConversion)} % passent payantes` : 'aucune', `
        ${fields(a.sub, p + '.sub', [['trialDays', 'Durée de l\'essai gratuit (jours)'], ['trialConversion', 'Essais qui deviennent payants (%)']])}
        <p class="muted">Le rythme d'abonnements sans pub (page Acquisition) compte alors les essais. Seule la part indiquée devient payante, à la fin de l'essai. 0 jour = pas d'essai.</p>`)}
      ${a.programs.length ? section('conv-sp', 'sub', 'Prix après un programme', a.sub.postPricing.map(ph => price(ph.price)).join(' → ') + ' / mois', `
        <p class="muted">Prix de l'abonnement pour les clientes qui le gardent après un programme. La part qui le garde se règle dans Acquisition, avec chaque programme.</p>
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
        { label: 'Abonnement', mini: 'Par mois', value: price(phaseAt(g, thisMonth).price), hint: 'par mois aujourd\'hui', go: { page: 'produits', open: 'sd', anchor: 'sd' } },
        ...(progs.length ? [
          { label: 'Prix des programmes', mini: 'Programmes', value: range(prices, x => price(x)), hint: `${progs.length} programme${progs.length > 1 ? 's' : ''} actif${progs.length > 1 ? 's' : ''}`, go: { page: 'produits', open: 'p0', anchor: 'p0' } },
          { label: 'Mes heures de coaching', value: cap ? `${num(+cap.hours || 0)} h` : '—', hint: 'par semaine aujourd\'hui', go: { page: 'coaching' } },
          { label: 'Temps par cliente', value: range(mins, x => num(x) + ' min'), hint: 'par semaine aujourd\'hui', go: { page: 'coaching' } }
        ] : [{ label: 'Calendrier', value: num(timelineCount(a)), hint: 'dates', go: { page: 'calendrier' } }])
      ] })}
    ${solo}${programs}
    <div class="row"><button data-add="${p}.programs">Ajouter un programme</button></div>
    ${a.programs.length ? capacityCard(a, p) : ''}`;
}

// Tous les jalons d'une application, dans l'ordre chronologique.
// Chaque jalon indique où il se règle et y mène d'un geste.
function timelineItems(a) {
  const items = [];
  a.programs.forEach((q, j) => {
    if (!q.enabled) return;
    const cal = { page: 'calendrier', open: 'calp-' + j, anchor: 'calp-' + j, from: 'Calendrier' }, key = q.id;
    q.cohorts.forEach(c => c.date && items.push({ key, date: c.date, kind: 'test', text: `${esc(c.name)} · ${esc(progName(a, q))}`, sub: `${num(c.size)} clientes`, go: cal }));
    if (q.start) items.push({ key, date: q.start, kind: 'launch', text: `Lancement commercial · ${esc(progName(a, q))}`, sub: '', go: cal });
    const pr = { page: 'produits', open: 'p' + j, anchor: 'price-p' + j, from: `Produits › ${esc(progName(a, q))} › Prix` };
    phasesOf(q.pricing).forEach(ph => items.push({ key, date: ph.start, kind: 'price', text: `${esc(ph.label)} de prix · ${esc(progName(a, q))}`, sub: price(ph.price), go: pr }));
    (q.promos || []).forEach(pm => pm.start && items.push({ key, date: pm.start, kind: 'price', text: `Promotion · ${esc(progName(a, q))}`, sub: price(pm.price), go: { page: 'produits', open: 'p' + j, anchor: 'promo-p' + j, from: `Produits › ${esc(progName(a, q))} › Promotions` } }));
  });
  if (a.sub.start) items.push({ key: 'sub', date: a.sub.start, kind: 'launch', text: `Ouverture des abonnements · ${esc(soloName(a))}`, sub: '', go: { page: 'calendrier', open: 'cal-sd', anchor: 'cal-sd', from: 'Calendrier' } });
  phasesOf(a.sub.directPricing).forEach(ph => ph.start && items.push({ key: 'sub', date: ph.start, kind: 'price', text: `${esc(ph.label)} de prix · ${esc(soloName(a))}`, sub: price(ph.price) + ' / mois', go: { page: 'produits', open: 'sd', anchor: 'price-sd', from: `Produits › ${esc(soloName(a))} › Prix` } }));
  (a.capacitySteps || []).forEach(c => c.date && items.push({ key: ':coach', date: c.date, kind: 'cap', text: 'Palier de coaching', sub: `${num(c.hours)} h pour toi / semaine`, go: { page: 'coaching', from: 'Coaching' } }));
  a.programs.forEach(q => q.enabled && (q.coachSteps || []).forEach(c => c.date && items.push({ key: ':coach', date: c.date, kind: 'cap', text: `Coaching · ${esc(progName(a, q))}`, sub: `${num(+c.minutes || 0)} min par cliente / sem.`, go: { page: 'coaching', from: 'Coaching' } })));
  items.sort((x, y) => x.date.localeCompare(y.date));
  return items;
}
function timeline(a, keep = () => true) {
  const items = timelineItems(a).filter(it => keep(it.key));
  if (!items.length) return '<p class="muted">Aucune date pour l\'instant : ajoute une cohorte de test ou une date de lancement dans Produits et prix.</p>';
  return `<ol class="timeline">${items.map(it => `<li class="${it.kind}"><a href="#${it.go.page}" data-goto="${it.go.page}" data-open="${it.go.open}" data-anchor="${it.go.anchor}">
      <span class="when">${monthName(it.date)}</span><span class="what">${it.text}${it.sub ? ` · <span class="muted">${it.sub}</span>` : ''}<span class="from">${it.go.from} ›</span></span></a></li>`).join('')}</ol>`;
}

// Calendrier de l'application : rassemble les dates saisies dans chaque produit (lecture seule).
const timelineCount = a => (timeline(a).match(/<li /g) || []).length;
// Choix de ce qui s'affiche : des cases sur ordinateur ; sur téléphone, un bouton qui ouvre une fenêtre de choix.
let pickOpen = null;
function pickPop(id, title, list, names, total) {
  const sum = names.length === total ? 'Tout' : names.length ? names.join(' · ') : 'Rien';
  return `<div class="picker${pickOpen === id ? ' open' : ''}" id="${id}"><button class="pick-btn" type="button" data-pickopen="${id}"><small>${esc(title)}</small><span>${esc(sum)}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>
    <div class="pick-sheet" data-pickclose><div class="pick-box" role="dialog" aria-label="${esc(title)}"><b class="pick-t">${esc(title)}</b>${list}<button class="pick-ok" type="button" data-pickclose>OK</button></div></div></div>`;
}

// ---------- Calendrier : toutes les dates d'une application, et les dates qui se saisissent ici ----------
const calHidden = (() => { try { return new Set(JSON.parse(localStorage.getItem('om-cal-hidden') || '[]')); } catch { return new Set(); } })();
const saveCalHidden = () => { try { localStorage.setItem('om-cal-hidden', JSON.stringify([...calHidden])); } catch { /* stockage indisponible */ } };
function calendarPage(a, i) {
  const p = 'apps.' + i;
  const prods = [{ key: 'sub', name: soloName(a) }, ...a.programs.map((q, j) => ({ key: q.id, name: progName(a, q), q, j })).filter(x => x.q.enabled), ...(a.programs.length ? [{ key: ':coach', name: 'Coaching' }] : [])];
  const shown = k => !calHidden.has(k), all = prods.every(x => shown(x.key));
  const items = timelineItems(a), nx = items.find(it => it.date >= thisMonth && shown(it.key)), launches = items.filter(it => it.kind === 'launch');
  const picker = `<div class="ucheck"><label class="uc"><input type="checkbox" data-calall ${all ? 'checked' : ''}><span>Tout</span></label>${prods.map(x => `<label class="uc"><input type="checkbox" data-calshow="${esc(x.key)}" ${shown(x.key) ? 'checked' : ''}><span>${esc(x.key === 'sub' ? soloName(a) : x.key === ':coach' ? 'Coaching' : x.q.name)}</span></label>`).join('')}</div>`;
  const pickerPop = pickPop('pk-cal', 'Produits affichés', picker, prods.filter(x => shown(x.key)).map(x => x.key === 'sub' ? 'Abonnement' : x.key === ':coach' ? 'Coaching' : x.q.name), prods.length);
  const n = items.filter(it => shown(it.key)).length;
  const solo = shown('sub') ? `<details class="card product solo" id="cal-sd" ${view.open.has('cal-sd') ? 'open' : ''}><summary><span>${esc(soloName(a))}<br><span class="sum-sub">${a.sub.start ? 'ouverture ' + monthName(a.sub.start) : 'pas encore ouvert'}</span></span></summary>
      <div class="grid">${field('Ouverture des abonnements', p + '.sub.start', a.sub.start, 'month')}</div></details>` : '';
  const progs = prods.filter(x => x.q && shown(x.key)).map(({ q, j }) => {
    const t = `${p}.programs.${j}`, id = 'calp-' + j;
    const cohorts = q.cohorts.map((c, k) => lineEditor(c, `${t}.cohorts.${k}`, [['name', 'Nom', 'text'], ['size', 'Clientes'], ['date', 'Démarrage', 'month']], 'Retirer cette cohorte')).join('');
    return `<details class="card product" id="${id}" ${view.open.has(id) ? 'open' : ''}><summary><span>${esc(progName(a, q))}<br><span class="sum-sub">${q.cohorts.length ? `${q.cohorts.length} cohorte${q.cohorts.length > 1 ? 's' : ''} de test · ` : ''}${q.start ? 'lancement ' + monthName(q.start) : 'sans lancement prévu'}</span></span></summary>
      <h4>Cohortes de test</h4>
      ${cohorts || '<p class="muted">Aucune cohorte de test.</p>'}
      <div class="row"><button data-add="${t}.cohorts">Ajouter une cohorte de test</button></div>
      <h4>Lancement commercial</h4>
      <div class="grid">${field('Lancement commercial', t + '.start', q.start, 'month')}</div></details>`;
  }).join('');
  return `${banner({ label: `Calendrier de ${esc(a.name)}`, big: nx ? shortMonth(nx.date) : '—',
      note: nx ? `Prochaine date : ${nx.text.replace(/<[^>]+>/g, '')}` : 'Aucune date à venir',
      tiles: [
        { label: 'Début', value: shortMonth(appStart(a)), hint: 'première date du plan' },
        { label: 'Lancements', mini: false, value: launches.length ? [...new Set(launches.map(it => shortMonth(it.date)))].slice(0, 3).join(' · ') : '—', cls: 'txt', hint: `${launches.length} au total` },
        { label: 'Prochaine date', mini: 'Prochaine', value: nx ? shortMonth(nx.date) : '—', hint: nx ? nx.text.replace(/<[^>]+>/g, '').split(' · ')[0] : '' },
        { label: 'Dates affichées', mini: 'Dates', value: num(n), hint: all ? 'tous les produits' : 'produits choisis' }
      ] })}
    ${pickerPop}
    <details class="card tool-cal" id="cal-line" ${view.open.has('cal-line') ? 'open' : ''}><summary><span>Toutes les dates<br><span class="sum-sub">${num(n)} dates · à partir de ${monthName(appStart(a))}</span></span></summary>
      ${timeline(a, shown)}</details>
    ${solo}${progs}`;
}
// ---------- Coaching : palier par palier, ce que les programmes demandent face à tes heures ----------
// Un palier = une date où tes heures ou les minutes par cliente changent. Le premier vaut dès le début.
// Tu règles les minutes par cliente et tes heures ; les heures à payer à des coachs en découlent.
function coachPaliers(a) {
  const caps = (a.capacitySteps || []).filter(c => c.date).sort((x, y) => x.date.localeCompare(y.date));
  const start = appStart(a), dates = new Set();
  caps.slice(1).forEach(c => dates.add(c.date));
  a.programs.forEach(q => (q.coachSteps || []).forEach(c => c.date && dates.add(c.date)));
  const list = [{ date: '', from: start }, ...[...dates].filter(d => d > start).sort().map(d => ({ date: d, from: d }))];
  return list.map((p, k) => ({ ...p, k, to: list[k + 1] ? list[k + 1].from : null }));
}
// Chiffres d'un palier : semaine la plus chargée, heures par programme cette semaine-là, premier blocage.
function palierStats(a, weekly, p) {
  const ws = weekly.filter(w => { const m = w.date.slice(0, 7); return m >= p.from && (!p.to || m < p.to); });
  if (!ws.length) return null;
  const peak = ws.reduce((b, w) => w.hours > b.hours ? w : b, ws[0]);
  const own = Number.isFinite(peak.own) ? peak.own : null;
  const block = own === null ? null : ws.find(w => w.hours > w.own + 0.01 || (a.restrict && w.demand > w.admitted + 1e-6));
  return { peak, own, block, missing: own === null ? 0 : Math.max(0, peak.hours - own) };
}
const hrs = v => `${(Math.round(v * 10) / 10).toLocaleString('fr-FR')} h`;
const deMonth = k => (/^[aeiouy]/.test(monthName(k)) ? "d'" : 'de ') + monthName(k);
function palierCard(a, ai, p, st, last) {
  const progs = a.programs.map((q, j) => ({ q, j })).filter(x => x.q.enabled !== false);
  const cap = capacityAt(a, p.from), rate = +a.coachRate || 0, wk = 52 / 12;
  const minInput = (q, j) => `<input class="pal-in" type="number" min="0" step="1" inputmode="numeric" data-pal="${ai}|${p.date}|min|${j}" value="${coachAt(q, p.from)}" aria-label="Minutes par cliente, ${esc(q.name)}">`;
  const rows = progs.map(({ q, j }) => {
    const g = st ? st.peak.progs[j] : { people: 0, hours: 0 };
    return `<tr><td>${esc(q.name)}</td><td>${minInput(q, j)}</td><td>${num(g.people)}</td><td>${hrs(g.hours)}</td></tr>`;
  }).join('');
  const total = st ? st.peak.hours : 0, people = st ? st.peak.people : 0;
  const ownIn = `<input class="pal-in" type="number" min="0" step="0.5" inputmode="decimal" data-pal="${ai}|${p.date}|own" value="${cap ? +cap.hours || 0 : ''}" placeholder="—" aria-label="Mes heures par semaine">`;
  const pay = st ? st.missing : 0;
  const head = p.k === 0
    ? `<b>Palier 1</b><span class="muted"> · ${monthName(p.from)} – ${p.to ? monthName(addMonths(p.to, -1)) : 'sans fin'}</span>`
    : `<b>Palier ${p.k + 1}</b><span class="muted"> · ${monthName(p.from)} – ${p.to ? monthName(addMonths(p.to, -1)) : 'sans fin'}</span>`;
  const datePick = p.k === 0 ? '' : (() => {
    const [y, m] = p.date.split('-'), years = []; for (let k = 2025; k <= 2034; k++) years.push(String(k));
    return `<div class="pal-date"><span>Début</span><span class="monthpick palpick" data-palmove="${ai}|${p.date}">
      <select aria-label="Mois du palier">${MONTHS.map((n, i) => { const v = String(i + 1).padStart(2, '0'); return `<option value="${v}" ${v === m ? 'selected' : ''}>${n}</option>`; }).join('')}</select>
      <select aria-label="Année du palier">${years.map(v => `<option ${v === y ? 'selected' : ''}>${v}</option>`).join('')}</select></span>
      <button class="icon danger" data-paldel="${ai}|${p.date}" aria-label="Retirer ce palier" title="Retirer ce palier">${TRASH}</button></div>`;
  })();
  let verdict = '';
  if (st && st.block) {
    const bm = st.block.date.slice(0, 7), bw = st.block;
    verdict = `<p class="pal-block"><b>Ça bloque à partir ${deMonth(bm)}</b> : il faut ${hrs(bw.hours)} de coaching par semaine pour ${num(bw.people)} clientes, tu en as ${hrs(bw.own)}.${pay > 0.05 ? ` Au plus fort de ce palier, ${hrs(pay)} par semaine sont à payer à des coachs, soit ${money(Math.round(pay * rate * wk))} par mois.` : ''}</p>`
      + (bm > p.from && (!p.to || bm < p.to)
        ? `<div class="levers"><button data-paladd="${ai}|${bm}">Ajouter un palier en ${monthName(bm)}</button></div>`
        : `<p class="muted">Ça bloque dès le début de ce palier : baisse les minutes ou augmente tes heures ci-dessus.</p>`
          + (last ? `<div class="levers"><button data-paladd="${ai}|${addMonths(p.from > thisMonth ? p.from : thisMonth, 6)}">Ajouter un palier plus tard</button></div>` : ''));
    if (pay > 0.05 && !rate) verdict += `<p class="pal-block">Ton coût horaire de coach est à 0 € : ces heures ne coûtent rien dans les charges. Règle-le dans « Coût des coachs » plus bas.</p>`;
  } else if (st && st.own !== null) verdict = `<p class="pal-ok"><b>Tes heures suffisent sur tout ce palier.</b></p>`;
  else if (st) verdict = `<p class="muted">Indique tes heures par semaine pour voir à partir de quand ça bloque.</p>`;
  const id = `pal-${ai}-${p.date || 'debut'}`, bm = st && st.block ? st.block.date.slice(0, 7) : '';
  const folded = pstats([['Besoin', `${hrs(total)} / sem.`], ['Mes heures', cap ? `${hrs(+cap.hours || 0)} / sem.` : '—'],
    ['À payer', pay > 0.05 ? `${hrs(pay)} / sem. · ${rate ? money(Math.round(pay * rate * wk)) + ' / mois' : 'coût horaire à 0 €'}` : 'rien', pay > 0.05 ? 'bad' : '']]);
  return `<details class="card palier ${st && st.block ? 'blocked' : ''}" id="${id}" ${view.open.has(id) ? 'open' : ''}>
      <summary><span>${head}${bm ? ` <span class="tag bad">Bloque en ${MSHORT[+bm.slice(5) - 1]} ${bm.slice(0, 4)}</span>` : st && st.own !== null ? ' <span class="tag ok">Ça tient</span>' : ''}${folded}</span></summary>
      <div class="pal-body">${datePick}
      <div class="scroll"><table class="pal-t"><thead><tr><th>Programme</th><th>Min. / cliente / sem.</th><th>Clientes</th><th>Heures / sem.</th></tr></thead>
        <tbody>${rows}<tr class="total"><td>Total</td><td></td><td>${num(people)}</td><td>${hrs(total)}</td></tr></tbody></table></div>
      <dl class="pal-sum">
        <div><dt>Mes heures / sem.</dt><dd>${ownIn}</dd></div>
        <div><dt>À payer à des coachs</dt><dd class="${pay > 0.05 ? 'neg' : ''}">${hrs(pay)} / sem.<small>${hrs(pay * wk)} / mois${pay > 0.05 && rate ? ' · ' + money(Math.round(pay * rate * wk)) + ' / mois' : ''}</small></dd></div>
      </dl>
      <p class="muted">Chiffres de la semaine la plus chargée du palier${st ? `, en ${monthName(st.peak.date.slice(0, 7))}` : ''}.</p>
      ${verdict}
      ${last && !(st && st.block) ? `<div class="row"><button data-paladd="${ai}|${addMonths(p.from > thisMonth ? p.from : thisMonth, 6)}">Ajouter un palier</button></div>` : ''}
    </div></details>`;
}
function coachingPage() {
  const r = results();
  const apps = r.scope.filter(x => x.a.programs.some(q => q.enabled !== false));
  if (!apps.length) return `<div class="card"><p class="muted">Aucun programme avec du coaching pour ${view.app === 'all' ? 'ces applications' : esc(r.scope[0]?.a.name || '')}.</p></div>`;
  // Bandeau : sur la période affichée, heures nécessaires au plus fort, tes heures, heures et coût des coachs.
  const wr = apps.flatMap(x => x.weekly.filter(w => inPeriod(w.date.slice(0, 7))));
  const peak = wr.reduce((b, w) => w.hours > (b?.hours ?? -1) ? w : b, null);
  const extra = apps.reduce((t, x) => t + x.months.filter(m => inPeriod(m.month)).reduce((s, m) => s + (m.extraHours || 0), 0), 0);
  const cost = apps.reduce((t, x) => t + x.months.filter(m => inPeriod(m.month)).reduce((s, m) => s + (m.extraHours || 0), 0) * (+x.a.coachRate || 0), 0);
  const firstBlock = apps.map(x => x.weekly.find(w => Number.isFinite(w.own) && w.hours > w.own + 0.01)).filter(Boolean).sort((p, q) => p.date.localeCompare(q.date))[0];
  const body = apps.map(x => {
    const a = state.apps[x.i], ai = x.i, ps = coachPaliers(a);
    const cards = ps.map((p, k) => palierCard(a, ai, p, palierStats(a, x.weekly, p), k === ps.length - 1)).join('');
    return `${view.app === 'all' ? `<h2>${esc(a.name)}</h2>` : ''}${cards}
      <details class="card" id="co-chart-${ai}" ${view.open.has(`co-chart-${ai}`) ? 'open' : ''}><summary><span>Heures nécessaires et tes heures<br><span class="sum-sub">${periodName()} · ${(() => { const ex = x.months.filter(m => inPeriod(m.month)).reduce((t, m) => t + (m.extraHours || 0), 0);
          return ex > 0.05 ? `${hrs(ex)} payées à des coachs · ${+a.coachRate ? money(Math.round(ex * a.coachRate)) + ' dans les charges' : '<b class="neg">coût horaire à 0 €</b>'}` : 'tes heures suffisent'; })()}</span></span></summary>
        <div class="legend"><span><i style="background:var(--k-ins)"></i>Couvert par tes heures</span><span><i style="background:var(--bad)"></i>Payé à des coachs</span><span><i class="dash"></i>Tes heures</span></div>
        <p class="muted">Par semaine, au plus fort de chaque mois.</p>
        <div class="chart cap-chart">${capacityChart(x)}</div></details>
      <details class="card" id="co-set-${ai}"><summary><span>Coût des coachs<br><span class="sum-sub">${money(+a.coachRate || 0)} de l'heure</span></span></summary>
        ${fields(a, `apps.${ai}`, [['coachRate', 'Coût horaire d\'une coach (€)']])}
        <p class="muted">Les heures à payer sont ajoutées aux charges, dans « Heures de coachs », et réparties entre les programmes selon leurs heures.</p>
        ${a.restrict ? check('Limiter les inscriptions à mes heures (aucune heure payée)', `apps.${ai}.restrict`, a.restrict) : ''}</details>`;
  }).join('');
  return `${banner({ label: firstBlock ? 'Ça bloque en' : 'Coaching', chip: periodChip(), big: firstBlock ? `${MSHORT[+firstBlock.date.slice(5, 7) - 1]} ${firstBlock.date.slice(0, 4)}` : 'Ça tient', bigCls: firstBlock ? 'neg-hero' : '',
      note: firstBlock ? `Tes heures ne suffisent plus à partir ${deMonth(firstBlock.date.slice(0, 7))}.` : 'Tes heures suffisent sur tout le plan.',
      tiles: [
        { label: 'Au plus fort', value: peak ? hrs(peak.hours) : '—', hint: peak ? `par semaine, ${monthName(peak.date.slice(0, 7))}` : '' },
        { label: 'Mes heures', value: peak && Number.isFinite(peak.own) ? hrs(peak.own) : '—', hint: 'par semaine à ce moment' },
        { label: 'Heures de coachs', value: hrs(extra), hint: `sur la période · ${money(Math.round(cost))}`, cls: extra > 0.05 ? 'neg' : '' }] })}
    ${body}`;
}

// Réglages d'un palier : les minutes de chaque programme et tes heures, enregistrées à la date du palier ('' = le premier).
function setPalier(a, date, kind, j, v) {
  const start = appStart(a);
  if (kind === 'min') {
    const q = a.programs[j];
    q.coachSteps = q.coachSteps || [];
    if (!date) { q.coach = v; q.coachSteps = q.coachSteps.filter(c => c.date && c.date > start); return; }
    let st = q.coachSteps.find(c => c.date === date);
    if (!st) { st = { date, minutes: v }; q.coachSteps.push(st); q.coachSteps.sort((x, y) => x.date.localeCompare(y.date)); }
    st.minutes = v;
  } else if (kind === 'own') {
    a.capacitySteps = a.capacitySteps || [];
    let c = date ? a.capacitySteps.find(x => x.date === date) : capacityAt(a, start);
    if (!c) {
      c = { date: date || start, hours: v, hired: 0 };
      a.capacitySteps.push(c); a.capacitySteps.sort((x, y) => x.date.localeCompare(y.date));
    }
    c.hours = v;
  }
}
// Nouveau palier : il reprend les réglages en vigueur ce mois-là.
function addPalier(a, month) {
  a.capacitySteps = a.capacitySteps || [];
  const cap = capacityAt(a, month);
  if (cap && !a.capacitySteps.some(c => c.date === month)) {
    a.capacitySteps.push({ date: month, hours: +cap.hours || 0, hired: 0 });
    a.capacitySteps.sort((x, y) => x.date.localeCompare(y.date));
  }
  for (const q of a.programs) {
    if (q.enabled === false) continue;
    q.coachSteps = q.coachSteps || [];
    if (!q.coachSteps.some(c => c.date === month)) { q.coachSteps.push({ date: month, minutes: coachAt(q, month) }); q.coachSteps.sort((x, y) => x.date.localeCompare(y.date)); }
  }
}
function movePalier(a, from, to) {
  if (!/^\d{4}-\d\d$/.test(to) || from === to) return;
  const first = (a.capacitySteps || []).filter(c => c.date).sort((x, y) => x.date.localeCompare(y.date))[0];
  for (const c of a.capacitySteps || []) if (c.date === from && c !== first) c.date = to;
  (a.capacitySteps || []).sort((x, y) => x.date.localeCompare(y.date));
  for (const q of a.programs) { for (const c of q.coachSteps || []) if (c.date === from) c.date = to; (q.coachSteps || []).sort((x, y) => x.date.localeCompare(y.date)); }
}
function removePalier(a, date) {
  const first = (a.capacitySteps || []).filter(c => c.date).sort((x, y) => x.date.localeCompare(y.date))[0];
  a.capacitySteps = (a.capacitySteps || []).filter(c => c.date !== date || c === first);
  for (const q of a.programs) q.coachSteps = (q.coachSteps || []).filter(c => c.date !== date);
}

// Produits et prix : le coaching se règle dans son propre onglet.
function capacityCard(a, p) {
  return `<div class="card"><p><b>Coaching</b> : minutes par cliente, tes heures et heures à payer se règlent dans l'onglet <a href="#coaching" data-goto="coaching" data-app="${p.split('.')[1]}">Coaching</a>.</p></div>`;
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

// ---------- TVA ----------
const VAT_MODE_NAME = { franchise: 'franchise de TVA sous le seuil', fr: 'TVA collectée et récupérée', foreign: 'TVA due dès le 1er euro, rien à récupérer' };
const VAT_MODE_SHORT = { franchise: 'Franchise', fr: 'Collectée', foreign: 'Dès 1 €' };
function vatSection() {
  const v = state.vat, mode = vatMode(state.implantation.scenarios.find(x => x.id === curImplant()));
  const rows = v.zones.map((z, k) => `<tr><td>${esc(z.name)}</td><td><input data-path="vat.zones.${k}.rate" type="number" min="0" step="any" value="${esc(z.rate)}"></td>
    <td><input data-path="vat.zones.${k}.web" type="checkbox" ${z.web ? 'checked' : ''} aria-label="Taxe due sur le site"></td></tr>`).join('');
  return `${check('Mes prix sont saisis TTC, tels que la cliente les paie', 'vat.ttc', v.ttc)}
    <h4>Taxe par zone</h4>
    <div class="scroll"><table class="vat-z"><thead><tr><th>Zone</th><th>Taux %</th><th>Site</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="muted">Les stores collectent et reversent la taxe de chaque zone eux-mêmes. Sur ton site, tu la collectes là où la case est cochée. Taux indicatifs, à faire valider.</p>
    <h4>Seuils et reversement</h4>
    <div class="grid">${field('Franchise micro-entreprise\nCA par an (€)', 'vat.franchise', v.franchise)}${field('Ventes vers l\'UE\nseuil par an (€)', 'vat.euLimit', v.euLimit)}
      ${field('Charges avec TVA\nrécupérable (%)', 'vat.recover', v.recover)}${field('TVA française\nsur tes charges (%)', 'vat.rate', v.rate)}
      ${select('Reversement', 'vat.period', v.period, [['mois', 'Chaque mois'], ['trimestre', 'Chaque trimestre']])}</div>
    <p class="muted">Implantation actuelle : ${VAT_MODE_NAME[mode]}. Récupérable : logiciels, technique, contenus, honoraires, locaux et autres, pas la publicité, les frais de paiement, le coaching ni le personnel.</p>`;
}

function settingsPage(a, i) {
  const p = 'apps.' + i;
  const vat = `${state.vat.ttc ? 'prix saisis TTC' : 'prix saisis HT'} · ${VAT_MODE_NAME[vatMode(state.implantation.scenarios.find(x => x.id === curImplant()))]}`;
  let lastExport = null; try { lastExport = localStorage.getItem('om-last-export'); } catch { /* stockage indisponible */ }
  const days = lastExport ? Math.floor((Date.now() - new Date(lastExport)) / 86400000) : null;
  const im = state.implantation, cur = im.scenarios.find(x => x.id === curImplant()) || im.scenarios[0];
  return `${banner({ label: 'Réglages', big: `${state.apps.length} appli${state.apps.length > 1 ? 's' : ''}`,
      note: state.apps.map(x => esc(x.name)).join(' · '),
      tiles: [
        { label: 'TVA', mini: false, value: VAT_MODE_SHORT[vatMode(state.implantation.scenarios.find(x => x.id === curImplant()))], cls: 'txt', hint: state.vat.ttc ? 'prix saisis TTC' : 'prix saisis hors taxe', go: { page: 'reglages', open: 'st-vat' } },
        { label: 'Implantation', mini: false, value: cur ? esc(cur.name) : '—', cls: 'txt', hint: 'taux à valider', go: { page: 'reglages', open: 'st-implant' } },
        { label: 'Dernière sauvegarde', mini: 'Sauvegarde', value: days === null ? 'Jamais' : days === 0 ? 'Aujourd\'hui' : `Il y a ${days} j`, cls: days === null || days > 14 ? 'warn-v' : '', hint: 'export du fichier', go: { page: 'reglages', open: 'st-save' } },
        { label: 'Données', mini: 'Synchro', value: Sync.on ? 'Synchronisées' : 'Cet appareil', cls: 'txt', hint: Sync.on ? 'iPhone, iPad et ordinateur' : 'active la synchro', go: { page: 'reglages', open: 'st-sync' } }
      ] })}
    <details class="card product solo" id="st-app" ${view.open.has('st-app') ? 'open' : ''}><summary><span>${esc(a.name)}<br><span class="sum-sub">${a.programs.length ? a.programs.length + ' programme' + (a.programs.length > 1 ? 's' : '') + ' et ' : ''}l'abonnement ${esc(soloName(a))}</span></span></summary>
      ${fields(a, p, [['name', 'Nom de l\'application', 'text']])}
      <ul class="where">
        <li><a href="#produits">Produits et prix</a> : calendrier, cohortes de test, lancement, durée, prix en 3 phases, rythme d'inscriptions, objectifs d'abonnées, promotions, passerelles, période d'essai${a.programs.length ? ', capacité de coaching' : ''}.</li>
        <li><a href="#charges">Charges</a> : charges de l'application, coût du coaching, charges de structure Om Holistic.</li>
      </ul>
      ${state.apps.length > 1 ? `<div class="row"><button class="danger" data-remove-app="${i}">Supprimer l'application ${esc(a.name)}</button></div>` : ''}
    </details>
    <details class="card product tool-all" id="st-all" ${view.open.has('st-all') ? 'open' : ''}><summary><span>Toutes les applications<br><span class="sum-sub">${state.apps.map(x => esc(x.name)).join(' · ')}</span></span></summary>
      ${section('st-scen', 'ins', 'Scénarios', state.scenarios.list.map(x => esc(x.name)).join(' · ') + ' · affiché : ' + esc((currentScenario() || {}).name || ''), `
        <div class="grid">${select('Scénario affiché', 'scenarios.current', state.scenarios.current, state.scenarios.list.map(x => [x.id, x.name])).replace('<label>', '<label class="wide">')}</div>
        ${state.scenarios.list.map((x, k) => x.id === 'central' ? '' : `<h4>${esc(x.name)}</h4><div class="grid">${field('Inscriptions et\nabonnées (%)', `scenarios.list.${k}.volume`, x.volume)}${field('Prix\n(%)', `scenarios.list.${k}.price`, x.price)}${field('Durée\nd\'abonnement (%)', `scenarios.list.${k}.duration`, x.duration)}${field('Charges\n(%)', `scenarios.list.${k}.costs`, x.costs)}</div>`).join('')}
        <p class="muted">Écarts par rapport au plan saisi dans Produits et Charges, qui reste le scénario central. Une baisse s'écrit avec un moins (−30). Les pages de réglages montrent toujours le plan central.</p>`)}
      ${section('st-cash', 'cal', 'Trésorerie et revenu', `apport ${money(+state.cash.start || 0)} · revenu visé ${money(+state.cash.payGoal || 0)} / mois${state.cash.payFrom ? ' dès ' + monthName(state.cash.payFrom) : ''}`, `
        <div class="grid">${field('Apport de départ\nargent mis dans la société (€)', 'cash.start', state.cash.start)}${field('Revenu mensuel visé\nnet pour toi (€)', 'cash.payGoal', state.cash.payGoal)}</div>
        ${fields(state.cash, 'cash', [['payFrom', 'Je commence à me le verser à partir de', 'month']])}
        <p class="muted">Sans date, la trésorerie est montrée avant ta rémunération : tu vois ce que la société accumule. Avec une date, ton revenu est retiré chaque mois de la trésorerie. Ne remplis pas en plus la charge « Rémunération du dirigeant », pour ne pas la compter deux fois. Valeurs par défaut à ajuster : apport 0 €, revenu visé 2 000 € par mois.</p>`)}
      ${section('st-vat', 'price', 'TVA', vat, vatSection())}
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
// Part hors taxe d'un montant saisi, au taux réel du mois (zones, stores, franchise).
const htOf = (m, v) => m && m.total ? v * m.caHT / m.total : v;
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

// Graduations rondes (1, 2, 2,5 ou 5 × 10^n) qui couvrent [lo, hi], environ n intervalles.
function niceScale(lo, hi, n = 4, minStep = 0) {
  const raw = Math.max(1e-9, hi - lo) / n, mag = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(minStep, [1, 2, 2.5, 5, 10].map(f => f * mag).find(v => v >= raw - 1e-12));
  const a = Math.floor(lo / step + 1e-9) * step, b = Math.max(a + step, Math.ceil(hi / step - 1e-9) * step);
  const ticks = []; for (let k = 0; a + k * step <= b + step / 2; k++) ticks.push(a + k * step);
  return { lo: a, hi: b, ticks };
}
// Axes : ordonnée graduée avec son unité en haut, abscisse au niveau du zéro.
function axes(left, W, top, y0, unit) {
  return `<line class="axis" x1="${left}" x2="${left}" y1="${top}" y2="${y0}"/><line class="axis" x1="${left}" x2="${W}" y1="${y0}" y2="${y0}"/>`
    + (unit ? `<text class="unit" x="4" y="11">${unit}</text>` : '');
}

// Barres empilées : programmes (sauge) et abonnements (argile), sur une échelle arrondie.
function chart(byMonth) {
  const W = Math.max(320, byMonth.length * 26), H = 206, left = 44, bottom = 22, top = 26;
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
      return `<g data-tip="${esc(money(m.total))}">
        <rect x="${x}" y="${y(m.sales)}" width="${w}" height="${y(0) - y(m.sales)}" rx="2" fill="var(--sage)"/>
        <rect x="${x}" y="${y(m.total)}" width="${w}" height="${Math.max(0, y(m.sales) - y(m.total))}" rx="2" fill="var(--clay)"/></g>${label}`;
    }).join('') + axes(left, W, top, y(0), '€') + '</svg>';
}

// ---------- Tableau de bord : ce qui demande ton attention ----------
function alertsCard(r) {
  const items = [];
  const t = cashData();
  if (t.low.balance < 0) items.push(['bad', `Trésorerie négative en ${monthName(t.low.month)} : il faut ${money(-t.low.balance)} d'apport ou de prêt.`, { page: 'tresorerie' }]);
  for (const x of r.all) {
    const sf = capacityShortfall(x.a, x.weekly);
    if (sf) {
      // Les heures qui manquent sont payées à des coachs (coût horaire de l'appli) et déjà comptées dans les charges.
      const ms = x.months.find(m => m.month === sf.month), rate = +x.a.coachRate || 0, cost = ms ? (ms.extraHours || 0) * rate : 0;
      const paid = rate > 0 ? ` Soit environ ${money(Math.round(cost))} / mois de coachs, déjà compté dans tes charges.` : ` Pas encore de coût : règle le coût horaire d'une coach dans l'onglet Coaching.`;
      items.push(['bad', `${esc(x.a.name)} : il manque ${num(Math.ceil(sf.missingHours))} h de coaching par semaine dès ${monthName(sf.month)}.${paid}`, { page: 'coaching', app: x.i }]);
    }
    const a = state.apps[x.i];
    const missed = [null, ...a.programs.map((q, j) => q.enabled ? j : -1).filter(j => j >= 0)].filter(j => { const pl = pubGapCached(a, j); return pl && pl.segs.some(sg => sg.current + 0.5 < sg.count); }).length;
    if (missed) items.push(['mid', `${esc(a.name)} : ${missed} objectif${missed > 1 ? 's' : ''} pas atteint${missed > 1 ? 's' : ''} avec les campagnes actuelles.`, { page: 'acquisition', app: x.i }]);
    const todo = (a.charges || []).filter(c => badge(c).includes('todo')).length;
    if (todo) items.push(['mid', `${esc(a.name)} : ${todo} charge${todo > 1 ? 's' : ''} à compléter.`, { page: 'charges', app: x.i }]);
  }
  const shTodo = state.shared.charges.filter(c => badge(c).includes('todo')).length;
  if (shTodo) items.push(['mid', `Structure Om Holistic : ${shTodo} charge${shTodo > 1 ? 's' : ''} à compléter (loyer, salaires…).`, { page: 'charges' }]);
  const b = backupDue();
  if (b) items.push(['mid', `${b} : exporte-les pour ne pas les perdre.`, { page: 'reglages', open: 'st-save' }]);
  if (t.breakEven) items.push(['ok', `Point mort en ${monthName(t.breakEven)} ; ton revenu de ${money(t.goal)} par mois ${t.payReached ? 'est atteint en ' + monthName(t.payReached) : 'n\'est pas encore atteint'}.`, { page: 'tresorerie' }]);
  const go = g => `href="#${g.page}" data-goto="${g.page}" data-open="${g.open || ''}" data-anchor="${g.open || ''}"${g.app !== undefined ? ` data-app="${g.app}"` : ''}`;
  return `<details class="card" id="s-alerts" ${view.open.has('s-alerts') ? 'open' : ''}><summary><span>À surveiller<br><span class="sum-sub">${items.filter(x => x[0] !== 'ok').length} point${items.filter(x => x[0] !== 'ok').length > 1 ? 's' : ''} d'attention · toutes applications</span></span></summary>
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
// Découpage du graphique et du tableau (mois, trimestre…), choisi dans la carte elle-même et non plus en haut de page.
// Le choix est mémorisé sur l'appareil et vaut pour Trésorerie et Utilisatrices.
const stepPick = () => `<label class="step-in"><span>Détail par</span><select class="step-pick">${STEPS.map(([k, n]) => `<option value="${k}"${k === view.cashStep ? ' selected' : ''}>${n.toLowerCase()}</option>`).join('')}</select></label>`;
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
    if (!b || b.key !== k) out.push(b = { key: k, from: m.month, to: m.month, open: m.balance - (m.inflow - m.charges - m.taxes - (m.vatPaid || 0) - m.pay), inflow: 0, raised: 0, charges: 0, taxes: 0, vat: 0, vatPaid: 0, pay: 0, low: m.balance });
    b.to = m.month; b.inflow += m.inflow; b.raised += m.raised || 0; b.charges += m.charges; b.taxes += m.taxes; b.vat += (m.vat || 0) - (m.vatIn || 0); b.vatPaid += m.vatPaid || 0; b.pay += m.pay;
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
  const W = Math.max(avail, bs.length * 34), H = 220, left = 52, bottom = 24, top = 14, right = 8;
  const sc = niceScale(Math.min(0, ...bs.map(b => Math.min(-(b.charges + b.taxes + b.vatPaid + b.pay), b.balance))), Math.max(1, ...bs.map(b => Math.max(b.inflow, b.balance))), 5), hi = sc.hi, lo = sc.lo;
  const y = v => top + (H - top - bottom) * (1 - (v - lo) / (hi - lo || 1));
  const slot = (W - left - right) / Math.max(1, bs.length), bw = Math.max(3, Math.min(28, slot * 0.5)), cx = i => left + slot * (i + 0.5);
  const ticks = sc.ticks;
  const every = Math.ceil(bs.length / 12);
  const step = view.cashStep;
  const lab = b => step === 'm' ? (b.key.endsWith('-01') || bs.length <= 12 ? MSHORT[+b.key.slice(5) - 1].replace('.', '') + (b.key.endsWith('-01') ? ' ' + b.key.slice(2, 4) : '') : '') : bucketName(b.key, step).replace(/ (\d\d)(\d\d)$/, ' $2');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Trésorerie par période">`
    + ticks.map(v => `<line class="grid-line" x1="${left}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text x="${left - 6}" y="${y(v) + 3}" text-anchor="end">${short(v).replace(/ €$/, '')}</text>`).join('')
    + bs.map((b, i) => { const out = b.charges + b.taxes + b.vatPaid + b.pay;
      return `<g data-tip="${esc(`+${money(b.inflow)} / −${money(out)}`)}">`
        + `<rect x="${cx(i) - bw / 2}" y="${y(b.inflow)}" width="${bw}" height="${Math.max(0, y(0) - y(b.inflow))}" rx="2" fill="var(--good)" opacity=".75"/>`
        + `<rect x="${cx(i) - bw / 2}" y="${y(0)}" width="${bw}" height="${Math.max(0, y(-out) - y(0))}" rx="2" fill="var(--sage)" opacity=".6"/></g>`; }).join('')
    + axes(left, W, top, y(0), '')
    + `<polyline points="${bs.map((b, i) => `${cx(i).toFixed(1)},${y(b.balance).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--clay)" stroke-width="2.5" stroke-linejoin="round"/>`
    + bs.map((b, i) => `<g class="pt" data-tip="${esc(money(b.balance))}"><circle class="hit" cx="${cx(i)}" cy="${y(b.balance)}" r="12"/><circle cx="${cx(i)}" cy="${y(b.balance)}" r="${bs.length > 48 ? 2 : 3}" fill="${b.balance < 0 ? 'var(--bad)' : 'var(--clay)'}"/></g>`).join('')
    + bs.map((b, i) => i % every === 0 || step === 'm' ? `<text x="${cx(i)}" y="${H - 6}" text-anchor="middle">${lab(b)}</text>` : '').join('')
    + '</svg>';
}
// ---------- Utilisatrices : combien de femmes dans chaque produit, mois par mois ----------
// Abonnement : abonnées en cours (directes et après un programme). Programme : clientes en cours de programme.
const USER_COLORS = ['var(--clay)', 'var(--sage)', '#e8a33d', '#2fa89a', '#d2649a', '#4a90d9', '#8a6d3b', '#7fb03a'];
function userSeries(r) {
  const out = [];
  for (const x of r.scope) {
    const a = x.a, ms = x.months;
    out.push({ name: soloName(a), short: r.scope.length > 1 ? a.name : 'Abonnement', kind: 'abonnées', at: k => (ms[k]?.direct || 0) + (ms[k]?.post || 0) });
    a.programs.forEach((p, j) => { if (p.enabled !== false) out.push({ name: progName(a, p), short: p.name, kind: 'en programme', at: k => ms[k]?.products[j]?.active || 0 }); });
    if (ms.some(m => m.gifted >= 0.5)) out.push({ name: soloName(a) + ' offert', short: r.scope.length > 1 ? a.name + ' offert' : 'Offert', kind: 'offertes', at: k => ms[k]?.gifted || 0 });
  }
  const colored = out.map((s, i) => ({ ...s, key: s.name, color: USER_COLORS[i % USER_COLORS.length] }));
  const progs = colored.filter(s => s.kind === 'en programme');
  if (progs.length > 1) colored.push({ name: 'Total en programme', short: 'Total en programme', kind: 'en programme', key: ':total', color: 'var(--ink)', dash: true, at: k => progs.reduce((t, s) => t + s.at(k), 0) });
  return colored;
}
// Courbes masquées sur l'écran Utilisatrices (mémorisé sur cet appareil).
const usersHidden = (() => { try { return new Set(JSON.parse(localStorage.getItem('om-users-hidden') || '[]')); } catch { return new Set(); } })();
const saveUsersHidden = () => { try { localStorage.setItem('om-users-hidden', JSON.stringify([...usersHidden])); } catch { /* stockage indisponible */ } };
function usersChart(bs, series) {
  const avail = Math.max(300, ($('page')?.clientWidth || 360) - 34);
  const W = Math.max(avail, bs.length * 34), H = 236, left = 46, bottom = 24, top = 26, right = 10;
  const sc = niceScale(0, Math.max(1, ...series.flatMap(s => bs.map(b => s.v[b.i]))), 5, 1), hi = sc.hi;
  const y = v => top + (H - top - bottom) * (1 - v / hi);
  const slot = (W - left - right) / Math.max(1, bs.length), cx = i => left + slot * (i + 0.5);
  const every = Math.max(1, Math.ceil(bs.length / Math.max(4, Math.floor((W - left) / 46)))), step = view.cashStep;
  const lab = b => step === 'm' ? (b.key.endsWith('-01') || bs.length <= 12 ? MSHORT[+b.key.slice(5) - 1].replace('.', '') + (b.key.endsWith('-01') ? ' ' + b.key.slice(2, 4) : '') : '') : bucketName(b.key, step).replace(/ (\d\d)(\d\d)$/, ' $2');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Utilisatrices par produit">`
    + sc.ticks.map(v => `<line class="grid-line" x1="${left}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text x="${left - 6}" y="${y(v) + 3}" text-anchor="end">${num(Math.round(v))}</text>`).join('')
    + axes(left, W, top, y(0), 'nombre')
    + series.map(s => `<polyline points="${bs.map((b, i) => `${cx(i).toFixed(1)},${y(s.v[b.i]).toFixed(1)}`).join(' ')}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round"${s.dash ? ' stroke-dasharray="6 4"' : ''}/>`).join('')
    + series.map(s => bs.map((b, i) => `<g class="pt" data-tip="${num(Math.round(s.v[b.i]))}"><circle class="hit" cx="${cx(i)}" cy="${y(s.v[b.i])}" r="11"/><circle cx="${cx(i)}" cy="${y(s.v[b.i])}" r="${bs.length > 48 ? 2 : 3}" fill="${s.color}"/></g>`).join('')).join('')
    + bs.map((b, i) => i % every === 0 ? `<text x="${cx(i)}" y="${H - 6}" text-anchor="middle">${lab(b) || MSHORT[+b.key.slice(5) - 1]?.replace('.', '') || ''}</text>` : '').join('')
    + '</svg>';
}
function usersPage() {
  const r = results(), x0 = r.scope[0], months = x0 ? x0.months.map(m => m.month) : [];
  const series = userSeries(r);
  // Valeur de fin de période de chaque produit (les utilisatrices se comptent à un moment donné, elles ne s'additionnent pas sur les mois).
  const bs = [];
  months.forEach((m, k) => { if (!inPeriod(m)) return; const key = bucketOf(m, view.cashStep); const b = bs.at(-1); if (b && b.key === key) b.i = k; else bs.push({ key, i: k }); });
  series.forEach(s => { s.v = {}; bs.forEach(b => { s.v[b.i] = s.at(b.i); }); });
  const last = bs.at(-1), first = bs[0];
  const end = s => last ? Math.round(s.v[last.i]) : 0;
  const base = series.filter(s => s.key !== ':total'), shown = series.filter(s => !usersHidden.has(s.key));
  const total = base.reduce((t, s) => t + end(s), 0);
  const peak = s => Math.max(0, ...bs.map(b => s.v[b.i]));
  // Cases à cocher : chaque courbe, et « Tout » pour tout afficher ou tout masquer.
  const all = shown.length === series.length;
  const legend = `<div class="ucheck"><label class="uc"><input type="checkbox" data-userall ${all ? 'checked' : ''}><span>Tout</span></label>${series.map(s => `<label class="uc"><input type="checkbox" data-usershow="${esc(s.key)}" ${usersHidden.has(s.key) ? '' : 'checked'}><i style="background:${s.color}"></i><span>${esc(s.short)}</span></label>`).join('')}</div>`;
  const legendPop = pickPop('pk-users', 'Courbes affichées', legend, shown.map(s => s.short), series.length);
  const heads = ['Période', ...shown.map(s => `<span class="dotk" style="background:${s.color}"></span>${esc(s.short)}`)];
  const rows = bs.map(b => [bucketName(b.key, view.cashStep), ...shown.map(s => num(Math.round(s.v[b.i])))]);
  const tile = s => ({ label: esc(s.short), value: num(end(s)), hint: `${s.kind} fin ${last ? monthName(months[last.i]) : ''} · au plus haut ${num(Math.round(peak(s)))}` });
  return `${banner({ label: 'Utilisatrices', chip: periodChip(), big: num(total),
      note: last ? `Fin ${monthName(months[last.i])} : ${base.map(s => `${num(end(s))} ${s.kind === 'abonnées' ? 'abonnées ' + esc(s.name) : s.kind === 'offertes' ? 'avec ' + esc(s.name) : 'dans ' + esc(s.name)}`).join(' · ')}` : 'Aucun mois sur cette période',
      tiles: base.slice(0, 4).map(tile) })}
    ${bs.length ? `<details class="card" id="us-chart" ${view.open.has('us-chart') ? 'open' : ''}><summary><span>Utilisatrices par produit<br><span class="sum-sub">${first ? bucketName(first.key, view.cashStep) : ''} – ${last ? bucketName(last.key, view.cashStep) : ''} · nombre en fin de ${{ m: 'mois', q: 'trimestre', s: 'semestre', y: 'année' }[view.cashStep]}</span></span></summary>
      ${stepPick()}${legendPop}${shown.length ? `<div class="chart">${usersChart(bs, shown)}</div>` : '<p class="muted">Coche au moins une courbe.</p>'}</details>
    <details class="card" id="us-table" ${view.open.has('us-table') ? 'open' : ''}><summary><span>${{ m: 'Mois', q: 'Trimestre', s: 'Semestre', y: 'Année' }[view.cashStep]} par ${{ m: 'mois', q: 'trimestre', s: 'semestre', y: 'année' }[view.cashStep]}<br><span class="sum-sub">abonnées en cours, offertes et clientes en cours de programme</span></span></summary>
      ${stepPick()}<div class="scroll"><table class="users">${table(heads, rows)}</table></div></details>
    ${inscriptionsCard(r)}` : ''}`;
}
// Inscriptions aux programmes sur la période : les courbes montrent les clientes en cours, ici le nombre qui s'inscrit,
// dont les abonnées de l'application qui achètent le programme.
function inscriptionsCard(r) {
  const rows = [];
  let total = 0, solo = 0;
  for (const x of r.scope) {
    const ms = x.months.filter(m => inPeriod(m.month));
    x.a.programs.forEach((q, j) => {
      if (q.enabled === false) return;
      const ins = ms.reduce((t, m) => t + m.products[j].admissions, 0), fs = ms.reduce((t, m) => t + (m.products[j].fromSolo || 0), 0);
      total += ins; solo += fs;
      rows.push([esc(r.scope.length > 1 ? progName(x.a, q) : q.name), num(Math.round(ins)), num(Math.round(fs)), num(Math.round(ms.at(-1)?.products[j].active || 0))]);
    });
  }
  if (!rows.length) return '';
  return `<details class="card" id="us-ins" ${view.open.has('us-ins') ? 'open' : ''}><summary><span>Inscriptions aux programmes<br><span class="sum-sub">${periodName()} · ${num(Math.round(total))} inscriptions, dont ${num(Math.round(solo))} abonnées</span></span></summary>
    <div class="scroll"><table class="users">${table(['', 'Inscrites', 'Dont abonnées', 'En cours'], rows)}</table></div>
    <p class="muted">Les courbes comptent les clientes en cours de programme à un moment donné. Un programme de 12 semaines garde ses clientes environ un quart de l'année : 480 inscriptions par an font à peu près 110 clientes en cours.</p></details>`;
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
  const detail = (o, inflow, charges, taxes, pay, close, vatPaid = 0) => `<dl class="cl-d"><dt>Solde au début</dt><dd>${money(o)}</dd><dt>Encaissements</dt><dd class="pos">${sign(inflow)}</dd><dt>Charges</dt><dd>${money(-charges)}</dd><dt>Impôts et cotisations</dt><dd>${money(-taxes)}</dd>${vatPaid ? `<dt>TVA reversée</dt><dd>${money(-vatPaid)}</dd>` : ''}${pay ? `<dt>Ta rémunération</dt><dd>${money(-pay)}</dd>` : ''}<dt class="cl-end">Solde à la fin</dt><dd class="cl-end ${close < 0 ? 'neg' : ''}">${money(close)}</dd></dl>`;
  const line = (id, label, flow, close, body, cls = '') => `<details class="cl-row ${cls}" id="${id}" ${view.open.has(id) ? 'open' : ''}><summary><span class="cl-p">${label}</span>
      <span class="cl-bar"><i class="${flow < 0 ? 'dn' : 'up'}" style="width:${(Math.abs(flow) / maxFlow * 100).toFixed(1)}%"></i></span>
      <span class="cl-v ${flow < 0 ? 'neg' : 'pos'}">${short(flow).replace(/^(?!-)/, flow > 0.5 ? '+' : '')}</span><span class="cl-b ${close < 0 ? 'neg' : ''}">${short(close)}</span></summary>${body}</details>`;
  const ledger = bs.length ? `<div class="cl"><div class="cl-h"><span>Période</span><span></span><span>Variation</span><span>Solde</span></div>`
    + bs.map(b => line('cl-' + b.key, bucketName(b.key, view.cashStep), b.flow, b.balance, detail(b.open, b.inflow, b.charges, b.taxes, b.pay, b.balance, b.vatPaid))).join('')
    + (bs.length > 1 ? line('cl-total', 'Total', tot('flow'), end.balance, detail(bs[0].open, tot('inflow'), tot('charges'), tot('taxes'), tot('pay'), end.balance, tot('vatPaid')), 'cl-tot') : '') + '</div>' : '';
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
    ${need ? `<details class="card" id="tr-alert" ${view.open.has('tr-alert') ? 'open' : ''}><summary><span>À surveiller<br><span class="sum-sub">point bas du plan : ${short(t.low.balance)} en ${monthName(t.low.month)}${lowIn && !months.some(m => m.month === t.low.month) ? ', hors de la période affichée' : ''}</span></span></summary>
      <ul class="alerts"><li class="bad"><a href="#reglages" data-goto="reglages" data-open="st-cash" data-anchor="st-cash">Il manque ${money(need)} en ${monthName(t.low.month)} : prévois un apport ou un prêt, ou décale des charges.<span class="from">›</span></a></li></ul></details>` : ''}
    ${bs.length ? `<details class="card" id="tr-chart" ${view.open.has('tr-chart') ? 'open' : ''}><summary><span>Entrées, sorties et solde<br><span class="sum-sub">${lowIn ? `point bas de la période ${short(lowIn.balance)} en ${monthName(lowIn.month)}` : ''}</span></span></summary>
      ${stepPick()}<div class="legend"><span><i style="background:var(--good)"></i>Encaissements</span><span><i style="background:var(--sage)"></i>Sorties</span><span><i style="background:var(--clay)"></i>Solde</span></div>
      <div class="chart">${cashChart(bs)}</div></details>
    <details class="card" id="tr-table" ${view.open.has('tr-table') ? 'open' : ''}><summary><span>Par ${STEPS.find(x => x[0] === view.cashStep)[1].toLowerCase()}<br><span class="sum-sub">${rangeName} · touche une ligne pour le détail</span></span></summary>
      ${stepPick()}${ledger}
      <p class="muted">Encaissements : l'argent reçu (les ventes payées en plusieurs fois arrivent sur plusieurs mois), hors TVA. Impôts et cotisations selon l'implantation choisie, comptés chaque mois (en réalité, une partie se paie l'année suivante).</p></details>
    <details class="card" id="tr-range" ${view.open.has('tr-range') ? 'open' : ''}><summary><span>Plage de mois<br><span class="sum-sub">${view.cashFrom || view.cashTo ? 'personnalisée : ' : 'celle choisie en haut : '}${rangeName}</span></span></summary>
      <div class="grid"><label>Du<select id="cashFrom">${opts(from)}</select></label><label>Au<select id="cashTo">${opts(to)}</select></label></div>
      ${view.cashFrom || view.cashTo ? '<div class="row"><button id="cashReset">Revenir à la période du haut</button></div>' : '<p class="muted">Pour voir par exemple de juin 2027 à mai 2028. Le découpage (mois, trimestre…) se choisit dans le graphique et le tableau.</p>'}</details>
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
const bannerOpen = () => view.open.has('banner');
function banner({ label, chip, big, bigCls = '', note = '', bar = '', tiles }) {
  const tile = t => {
    const inner = `<span class="t-l">${t.label}</span><b class="${t.cls || ''}">${compact(t.value)}</b>${t.hint ? `<span class="t-h">${compact(t.hint)}</span>` : ''}`;
    return t.go ? `<a class="b-tile" href="#${t.go.page}" data-goto="${t.go.page}" data-open="${t.go.open || ''}" data-anchor="${t.go.anchor || t.go.open || ''}">${inner}</a>` : `<div class="b-tile">${inner}</div>`;
  };
  const minis = tiles.filter(t => t.mini !== false).slice(0, 3).map((t, k) => `<span class="b-mini${k === 2 ? ' m3' : ''}"><small>${t.mini || t.label}</small><b class="${t.cls || ''}">${compact(t.value)}</b></span>`).join('');
  return `<details class="hero banner" id="banner" ${bannerOpen() ? 'open' : ''}>
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
      <details class="card" id="s-chart" ${view.open.has('s-chart') ? 'open' : ''}><summary>Évolution mensuelle</summary>
        <div class="legend"><span><i style="background:var(--sage)"></i>Programmes</span><span><i style="background:var(--clay)"></i>Abonnements</span></div>
        <div class="chart">${chart(r.byMonth)}</div></details>
      <details class="card" id="s-prod" ${view.open.has('s-prod') ? 'open' : ''}><summary>Revenus par produit</summary><div>${productLines(r)}</div></details>
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
    const open = view.open.has(id) ? 'open' : '';
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
    <details class="card" id="pv-prod" ${view.open.has('pv-prod') ? 'open' : ''}><summary>Par produit</summary><p class="muted">Touche un produit pour ouvrir ses réglages.</p><div>${productLines(r)}</div></details>
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
        <a class="lever" href="#coaching" data-goto="coaching" data-app="${ai}">Voir l'onglet Coaching</a>
      </div>
      ${pct > 0 && pct < 100 ? `<div class="levers"><button data-coachfix="${ai}" data-month="${sf.month}" data-ratio="${ratio}">Je réduis le temps par cliente de ${num(pct)} %</button></div>
      <p class="muted">${progs.map(({ q }) => `${esc(progName(a, q))} : ${num(coachAt(q, sf.month))} → ${num(Math.floor(coachAt(q, sf.month) * ratio))} min`).join(' · ')}, à partir de ${monthName(sf.month)}.</p>` : ''}
      <p class="muted">Chaque bouton ajoute un palier en ${monthName(sf.month)} (ou complète celui de ce mois), puis t'emmène dans l'onglet Coaching, où tu peux ajuster.</p>
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
  const W = Math.max(320, list.length * 26), H = 186, left = 34, bottom = 22, top = 26;
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
      // Partie couverte par tes heures, puis partie payée à des coachs au-dessus.
      const own = over ? m.limit : m.hours, paid = over ? m.hours - m.limit : 0, h1 = n => (Math.round(n * 10) / 10).toLocaleString('fr-FR');
      return `<g data-tip="${over ? `${h1(m.hours)} h, dont ${h1(paid)} h payées` : h1(m.hours) + ' h'}">
        <rect x="${bx}" y="${y(own)}" width="${w}" height="${y(0) - y(own)}" rx="2" fill="var(--k-ins)"/>${paid ? `<rect x="${bx}" y="${y(m.hours)}" width="${w}" height="${y(own) - y(m.hours)}" rx="2" fill="var(--bad)"/>` : ''}</g>${label}`;
    }).join('')
    + (capPath ? `<path d="${capPath}" fill="none" stroke="var(--ink)" stroke-width="2" stroke-dasharray="5 4"/>` : '') + axes(left, W, top, y(0), 'h / sem.') + '</svg>';
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
      <p class="muted"><a href="#coaching" data-goto="coaching" data-app="${x.i}">Régler le coaching palier par palier</a></p></div>`).join('')}
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
// Montants de la période affichée, par charge (rempli par la page Charges le temps de l'afficher).
let chAmt = null;
const chargeAmount = (c, a) => chAmt ? (a ? chAmt.lines[c.id] : chAmt.structureLines[c.id]) || 0 : null;
const periodAmount = v => `<b>${money(v)}</b> ${periodName()}`;
function chargeSummary(c, a, dates) {
  const prog = a && a.programs.find(p => p.id === c.scope);
  const scope = !a ? '' : c.scope === 'sub' ? ' · ' + esc(soloName(a)) : prog ? ' · ' + esc(progName(a, prog)) : '';
  const steps = (c.steps || []).length ? ' → ' + [...c.steps].sort((x, y) => x.after - y.after).map(st => `${amountText(c, st.amount)} à +${num(st.after)} mois`).join(' → ') : '';
  const v = chargeAmount(c, a);
  return `${v === null ? '' : periodAmount(v) + ' · '}${amountText(c, c.amount)}${steps} · ${whenText(c, dates)}${scope}`;
}
const badge = c => !(+c.amount) && !(c.steps || []).some(st => +st.amount) ? '<span class="tag todo">À compléter</span>' : c.estimate ? '<span class="tag est">Estimation</span>' : '<span class="tag on">Confirmé</span>';

// Carte d'une charge : repliée, elle donne le montant de la période ; dépliée, un récapitulatif
// et deux boutons. La modification se fait dans une fenêtre, pour que la charge ne change pas de bloc pendant la saisie.
function chargeCard(c, t, a, dates, scopes) {
  const id = 'ch' + c.id;
  const scope = scopes && (scopes.find(([k]) => k === (c.scope || 'app')) || [])[1];
  const steps = (c.steps || []).length ? [...c.steps].sort((x, y) => x.after - y.after).map(st => `${amountText(c, st.amount)} au bout de ${num(st.after)} mois`).join(', puis ') : '';
  const line = (k, v) => v ? `<div><dt>${k}</dt><dd>${v}</dd></div>` : '';
  return `<details class="card charge" id="${id}" ${view.open.has(id) ? 'open' : ''}><summary><span>${esc(c.name)} ${badge(c)}<br><span class="sum-sub">${chargeSummary(c, a, dates)}</span></span></summary>
    <dl class="ch-recap">${line('Type', esc((CHARGE_TYPES.find(([k]) => k === c.type) || [])[1] || ''))}${line('Montée en charge', steps)}${line('Rattachée à', scope && esc(scope))}${line('Remarque', esc(c.note || ''))}</dl>
    <div class="ch-acts"><button data-chedit="${esc(t)}">Modifier</button><button class="danger" data-remove="${esc(t)}">Supprimer</button></div></details>`;
}

// Contexte d'une liste de charges : application, dates repères et rattachements possibles.
function chargeCtx(path) {
  if (path.startsWith('shared.')) return { a: null, dates: appDates(state.apps), scopes: null };
  const a = state.apps[+path.split('.')[1]];
  return { a, dates: appDates([a]), scopes: [['app', 'Commune à tous les produits ' + a.name], ['sub', soloName(a)], ...a.programs.map(q => [q.id, progName(a, q)])] };
}
const CH_KIND = { var: 'Charges variables', fix: 'Charges fixes', str: 'Charges de structure Om Holistic' };
// Fenêtre centrée d'ajout ou de modification d'une charge. Les champs agissent sur un brouillon (chemins « draft. »),
// la liste n'est modifiée qu'au bouton Ajouter / Enregistrer.
function chargeModal() {
  const e = view.chEdit;
  if (!e) return '';
  const c = e.c, t = 'draft', { a, dates, scopes } = chargeCtx(e.list);
  const anchors = CHARGE_ANCHORS.filter(([k]) => k !== 'product' || (a && c.scope && c.scope !== 'app'));
  const types = a ? CHARGE_TYPES : CHARGE_TYPES.filter(([k]) => k === 'fixe' || k === 'unique');
  const where = e.j === null ? `${CH_KIND[e.kind]}${a && e.kind !== 'str' ? ' de ' + esc(a.name) : ''}` : esc(c.name);
  return `<div class="modal" data-chclose role="dialog" aria-modal="true" aria-labelledby="chm-t"><div class="modal-box ch-box">
    <h3 class="modal-t" id="chm-t">${e.j === null ? 'Nouvelle charge' : 'Modifier la charge'}<small>${where}</small></h3>
    <div class="grid one">${field('Nom', t + '.name', c.name, 'text').replace('<input', '<input placeholder="ex. Hébergement du site" autocomplete="off"')}
      ${select('Catégorie', t + '.category', c.category || '', [['', 'Choisis une catégorie'], ...CHARGE_CATEGORIES])}
      ${select('Type', t + '.type', c.type, types)}</div>
    <div class="grid two">${field(AMOUNT_LABEL[c.type] || 'Montant', t + '.amount', c.amount)}${select('Ce montant est', t + '.estimate_ok', c.estimate ? 'est' : 'ok', [['est', 'une estimation'], ['ok', 'confirmé']])}</div>
    ${scopes ? `<div class="grid one">${select('Rattachée à', t + '.scope', c.scope || 'app', scopes)}</div>` : ''}
    <h4>${c.type === 'unique' ? 'Quand' : 'Dates'}</h4>
    <div class="grid one">${select(c.type === 'unique' ? 'Payée au' : 'Commence au', t + '.anchor', c.anchor || 'date', anchors)}
      ${c.anchor === 'date' ? monthField('Mois', t + '.start', c.start, 'dès le début') : field('Décalage (mois après ce repère)', t + '.offset', c.offset || 0)}
      ${c.type === 'unique' ? '' : monthField('Fin', t + '.end', c.end, 'sans fin')}</div>
    <p class="muted">Soit ${esc(whenText(c, dates))}. Si la date repère change dans ton calendrier, la charge suit.</p>
    ${c.type === 'unique' ? '' : `<h4>Montée en charge</h4>
    ${(c.steps || []).map((st, k) => lineEditor(st, `${t}.steps.${k}`, [['after', 'Au bout de (mois)'], ['amount', c.type === 'ca' ? 'Nouveau %' : 'Nouveau montant (€)']], 'Supprimer ce palier')).join('') || '<p class="muted">Aucune : le montant reste le même.</p>'}
    <div class="row"><button class="ghost" data-add="${t}.steps">Ajouter un palier</button></div>`}
    <div class="grid one">${field('Remarque (hypothèse, source, devis…)', t + '.note', c.note || '', 'text')}</div>
    ${e.err ? `<p class="warn">${esc(e.err)}</p>` : ''}
    <div class="modal-acts"><button class="ghost" data-chclose>Annuler</button><button class="primary" data-chsave>${e.j === null ? 'Ajouter la charge' : 'Enregistrer'}</button></div>
  </div></div>`;
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
    const v = chAmt ? items.reduce((t, x) => t + chargeAmount(x.c, a), 0) : null;
    return section(id, CAT_KIND[k], n, `${v === null ? '' : periodAmount(v) + ' · '}${items.length} charge${items.length > 1 ? 's' : ''}${todo ? ` · ${todo} à compléter` : ''}`,
      items.map(({ c, j }) => chargeCard(c, `${path}.${j}`, a, dates, scopes)).join(''));
  }).join('');
}

// Valeur d'une nouvelle cliente sur sa durée de vie (chiffre d'affaires, avant charges), au prix de la dernière phase.
function clientValue(a, k) {
  const lastPrice = grid => { const ph = phasesOf(grid); return ph.length ? +ph[ph.length - 1].price || 0 : 0; };
  const sub = d => (+d > 0 ? +d : 24);
  if (k === 'sub') return lastPrice(a.sub.directPricing) * sub(a.sub.duration);
  const q = a.programs[k];
  return lastPrice(q.pricing) + Math.min(100, +q.toSolo || 0) / 100 * lastPrice(a.sub.postPricing) * sub(a.sub.duration);
}
// ---------- Acquisition : canaux de vente, budget pub et coût d'une nouvelle cliente, produit par produit ----------
const acqHidden = (() => { try { return new Set(JSON.parse(localStorage.getItem('om-acq-hidden') || '[]')); } catch { return new Set(); } })();
const saveAcqHidden = () => { try { localStorage.setItem('om-acq-hidden', JSON.stringify([...acqHidden])); } catch { /* stockage indisponible */ } };
// Rythme sans pub, saisi sur la page Acquisition : abonnement puis programme.
// Croissance sans pub : courbe en S (notoriété), paliers réguliers, ou paliers saisis à la main.
const growthKind = q => q.palierMode ? 'manual' : q.shape === 'lin' ? 'lin' : q.shape === 'brand' ? 'brand' : 's';
const GROWTH_KINDS = [['brand', 'Part de mon vivier'], ['s', 'Courbe en S propre'], ['lin', 'Régulière'], ['manual', 'Paliers à la main']];
const growthPick = (q, t) => `<div class="grid one"><label>Forme de la croissance<select data-growth="${esc(t)}">${GROWTH_KINDS.map(([v, l]) => `<option value="${v}" ${v === growthKind(q) ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>`;
// Champs du sans pub, selon sa forme : les deux taux du vivier, ou la courbe propre au produit.
// Ce que donnent les deux taux du vivier, pour l'explication de l'étape.
function brandNote(q, a, unit) {
  const from = q.start || appStart(a), y1 = addMonths(from, 12), y3 = addMonths(from, 36), b = m => num(Math.round(audienceBuyers(a, q, m)));
  return `Une personne qui vient de te découvrir achète plus facilement que celle qui te suit depuis longtemps. Avec ton <a href="#notoriete" data-goto="notoriete">vivier</a> (${num(Math.round(audienceAt(a, from)))} personnes au lancement, ${num(Math.round(audienceAt(a, y3)))} trois ans plus tard), ça donne ${b(addMonths(from, 1))} ${unit.toLowerCase()} par mois au début, ${b(y1)} après 1 an, ${b(y3)} après 3 ans.`;
}
function growthFields(q, t, unit, a) {
  const kind = growthKind(q);
  if (kind === 'brand') {
    // Le sans pub suit le vivier : nouvelles venues et vivier déjà là, chacune à son taux.
    const from = q.start || appStart(a), y1 = addMonths(from, 12), y3 = addMonths(from, 36), b = m => num(Math.round(audienceBuyers(a, q, m)));
    return `<div class="grid">${field('Nouvelles venues\n% qui achètent le mois de leur arrivée', t + '.audienceNew', q.audienceNew)}${field('Vivier déjà là\n% qui achètent chaque mois', t + '.audienceRate', q.audienceRate)}</div>`;
  }
  const body = kind === 'manual'
    ? q.paliers.map((r, k) => lineEditor(r, t + '.paliers.' + k, [['rate', unit + ' / semaine'], ['weeks', 'Pendant (semaines)']], 'Supprimer le palier')).join('') + `<div class="row"><button data-add="${t}.paliers">Ajouter un palier</button></div><p class="muted">Après le dernier palier : ${num(q.target)} / semaine.</p>`
    : fields(q, t, kind === 's' ? [['initial', 'Au départ : ton audience\n' + unit.toLowerCase() + ' / semaine'], ['target', 'À maturité\n' + unit.toLowerCase() + ' / semaine'], ['months', 'Temps pour y arriver\nmois']] : growth);
  const est = kind === 's' ? `<p class="muted"><b>Au départ</b> : ce que ta communauté apporte seule. <b>À maturité</b> : ce que l'appli attire seule une fois connue (avis, recherche, articles). La courbe passe de l'un à l'autre lentement au début, plus vite ensuite.${+q.initial > 0 ? ` Ici : ${num(Math.round(+q.initial * 52 / 12))} → ${num(Math.round(+q.target * 52 / 12))} par mois.` : ''}</p>` : '';
  return body + est;
}
// Étape de la carte d'un produit : un titre, son chiffre, une phrase d'aide, puis les champs à régler.
// L'explication reste repliée derrière ⓘ : on ne voit que le titre, le chiffre et les champs.
const step = (id, kind, title, value, help, body) => `<section class="step sec-${kind}">${help ? `<details class="step-i" id="${esc(id)}" ${view.open.has(id) ? 'open' : ''}><summary class="step-h"><span class="step-t">${title}<i class="info" aria-label="Explication">i</i></span><b class="step-v">${value}</b></summary><div class="step-help">${help}</div></details>` : `<div class="step-h"><span class="step-t">${title}</span><b class="step-v">${value}</b></div>`}${body}</section>`;
// Réglages secondaires d'une étape, repliés.
const more = (id, title, body) => `<details class="more" id="${esc(id)}" ${view.open.has(id) ? 'open' : ''}><summary>${title}</summary><div class="more-b">${body}</div></details>`;
const rhythmSummary = q => `${q.launch ? `${num(q.launchRate)} / sem. pendant ${num(q.launchWeeks)} sem., puis ` : ''}${q.shape === 'brand' && !q.palierMode ? `part de ton vivier (${fmtN(+q.audienceNew || 0, 2)} % des nouvelles, ${fmtN(+q.audienceRate || 0, 2)} % des autres)` : q.palierMode && q.paliers.length ? q.paliers.map(r => num(r.rate)).join(' → ') + ' / sem. (paliers)' : `${num(q.initial)} → ${num(q.target)} / sem. en ${num(q.months)} mois${q.shape === 'lin' ? '' : ', en S'}`}`;
// Nouvelles clientes par mois jusqu'à fin 2032, empilées : sans pub, pub, venues de l'abonnement.
// Pic du lancement d'un programme, mois par mois : le rythme spécifique des premières semaines, à part du flux régulier.
function launchByMonth(a, q) {
  const out = {};
  if (!q.launch || !q.start || q.organic === false) return out;
  const d0 = firstMonday(monthDate(q.start)), vol = Number.isFinite(+a.volume) && +a.volume > 0 ? +a.volume : 1;
  for (let w = 0; w < Math.max(0, +q.launchWeeks || 0); w++) for (const [m, sh] of weekShares(addWeeks(d0, w))) out[m] = (out[m] || 0) + Math.floor(Math.max(0, +q.launchRate || 0)) * sh * vol;
  return out;
}
function acqChart(rows) {
  const W = 320, H = 120, T = 14, n = rows.length, bw = W / n, max = Math.max(1, ...rows.map(r => r.org + (r.launch || 0) + r.pub + r.solo));
  const bars = rows.map((r, k) => { let y = H; return [['org', 'var(--k-ins)'], ['launch', 'var(--k-cal)'], ['pub', 'var(--k-promo)'], ['solo', 'var(--k-sub)']].map(([key, col]) => { const h = (r[key] || 0) / max * (H - T); y -= h; return h > 0 ? `<rect x="${(k * bw + 0.5).toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, bw - 1).toFixed(1)}" height="${h.toFixed(1)}" fill="${col}"/>` : ''; }).join(''); }).join('');
  const ticks = rows.map((r, k) => r.month.endsWith('-01') ? `<text x="${(k * bw + 1).toFixed(1)}" y="${H + 12}" font-size="9" fill="var(--ink-soft)">${r.month.slice(0, 4)}</text>` : '').join('');
  return `<figure class="acq-chart"><svg viewBox="0 0 ${W} ${H + 16}" role="img" aria-label="Nouvelles clientes par mois">${bars}${ticks}<text x="${W}" y="10" font-size="9" text-anchor="end" fill="var(--ink-soft)">max ${num(Math.round(max))} / mois</text></svg>
    <figcaption><span><i style="background:var(--k-ins)"></i>Sans pub</span>${rows.some(r => r.launch) ? '<span><i style="background:var(--k-cal)"></i>Lancement</span>' : ''}<span><i style="background:var(--k-promo)"></i>Pub</span>${rows.some(r => r.solo) ? '<span><i style="background:var(--k-sub)"></i>Abonnées</span>' : ''}</figcaption></figure>`;
}

// Objectif total d'un produit, toutes sources confondues : le sans pub et les passerelles d'abord, la pub comble l'écart.
// Le calcul relance plusieurs simulations : on le garde tant que l'application ne change pas.
const gapCache = new Map();
function pubGapCached(a, j) {
  const key = JSON.stringify(a) + '|' + j;
  if (!gapCache.has(key)) { if (gapCache.size > 40) gapCache.clear(); gapCache.set(key, pubGap(a, j)); }
  return gapCache.get(key);
}
// Carte d'un produit, lue comme une histoire : objectif → sans pub → venues de l'abonnement → reste pour la pub → budget.
// Le palier mis en avant : le premier qui n'est pas encore passé.
const focusSeg = segs => segs.find(sg => sg.at >= thisMonth) || segs.at(-1);
function productPlan(a, st) {
  const o = st.o, prog = st.key !== 'sub', g = o.goal || { steps: [] }, steps = g.steps || [];
  const kind = prog ? 'year' : g.kind === 'new' ? 'new' : 'active';
  const plan = steps.length ? pubGapCached(a, prog ? st.j : null) : null, segs = plan ? plan.segs : [];
  return { o, prog, g, steps, kind, plan, segs, auto: !!g.auto && !!plan, u: n => kind === 'active' ? `${num(Math.round(n))} abonnées` : `${num(Math.round(n))} / an`,
    free: sg => Math.max(0, sg.free - (sg.solo || 0)), left: sg => Math.max(0, Math.round(sg.count - sg.free)) };
}
// Synthèse en haut de la carte : objectif − sans pub − passerelle = à combler × coût d'une cliente = budget pub.
function productSynth(a, st) {
  const P = productPlan(a, st), { o, prog, g, plan, u } = P, who = prog ? 'cliente' : 'abonnée', t = st.t;
  const cacField = `<label class="sy-row sy-in"><span>× Coût d'une ${who} venue de la pub</span><span class="sy-eur"><input data-path="${esc(t)}.goal.cac" type="number" min="0" step="any" value="${esc(g.cac || plan?.cac || 50)}"> €</span></label>`;
  const value = `<div class="sy-row"><span>Une ${who} rapporte</span><b>${money(st.v)}</b></div>${st.ratio !== null ? `<p class="sy-n ${st.ratio >= 3 ? 'pos' : st.ratio >= 1 ? '' : 'neg'}">soit ${fmtN(st.ratio, 1)} fois ce qu'elle coûte en pub</p>` : ''}`;
  if (!plan) return `<div class="synth"><div class="sy-row"><span>Objectif</span><b>aucun</b></div>
    <div class="sy-row big"><span>Budget pub</span><b>${money(Math.round(st.pubB / 12))} / mois</b></div><p class="sy-n">${money(Math.round(st.pubB))} sur 12 mois, avec tes campagnes</p>${value}</div>`;
  const sg = focusSeg(P.segs);
  const budget = P.auto ? sg.budget : null;
  return `<div class="synth">
    <div class="sy-row"><span>Objectif · ${monthName(sg.at)}</span><b>${u(sg.count)}</b></div>
    <div class="sy-row"><span>− Sans pub, depuis ton vivier</span><b>${num(Math.round(P.free(sg)))}</b></div>
    ${prog ? `<div class="sy-row"><span>− Venues de ${esc(soloName(a))}</span><b>${num(Math.round(sg.solo || 0))}</b></div>` : ''}
    <div class="sy-row tot"><span>= À combler par la pub</span><b>${P.left(sg) ? num(P.left(sg)) : 'rien ✓'}</b></div>
    ${cacField}
    <div class="sy-row big"><span>= Budget pub</span><b>${P.auto ? `${money(budget)} / mois` : `${money(Math.round(st.pubB / 12))} / mois`}</b></div>
    <p class="sy-n">${P.auto ? `${sg.end ? `de ${monthName(sg.start)} à ${monthName(sg.end)}` : `dès ${monthName(sg.start)}`} · ${money(Math.round(st.pubB))} sur les 12 prochains mois` : `tes campagnes à toi · l'objectif demanderait ${money(sg.budget)} / mois`}</p>
    ${value}</div>`;
}
function productStory(a, st, p, campaign) {
  const P = productPlan(a, st), { o, prog, g, steps, kind, plan, segs, u, free, left } = P, t = st.t;
  const who = prog ? 'cliente' : 'abonnée', camps = o.campaigns || [], orgOn = o.organic !== false, brand = o.shape === 'brand' && !o.palierMode;
  const solo = soloName(a), at = sg => monthName(sg.at);
  const list = f => segs.length ? `Soit ${segs.map(sg => `${u(f(sg))} en ${at(sg)}`).join(', ')}.` : '';
  const s0 = segs.length ? focusSeg(segs) : null;
  // Le chiffre d'en-tête vaut pour une date : on la dit. Les étapes qui listent chaque date n'en ont pas.
  const on = v => s0 ? `${v}<small>en ${monthName(s0.at)}</small>` : v;

  // 1. Objectif
  const goal = step(st.id + '-i1', 'cal', prog ? 'Ton objectif' : 'Ton objectif d\'abonnées', s0 ? on(u(s0.count)) : 'aucun',
    steps.length ? `${prog ? 'Combien d\'inscriptions par an tu vises' : kind === 'active' ? 'Combien d\'abonnées en même temps tu vises' : 'Combien de nouvelles abonnées par an tu vises'}, et quand. Compté depuis ${prog ? 'le lancement' : 'l\'ouverture'} (${o.start ? monthName(o.start) : 'date à fixer'}). ${segs.length ? `Soit ${segs.map(sg => `${u(sg.count)} en ${at(sg)}`).join(', ')}.` : ''}`
      : 'Fixe un objectif : l\'outil calcule ce qui manque et la pub qu\'il faut. Sans objectif, tu règles toi-même ta pub plus bas.',
    `${prog ? '' : `<div class="grid">${select('Je vise', t + '.goal.kind', g.kind || 'active', [['active', 'des abonnées en même temps'], ['new', 'des nouvelles abonnées par an']]).replace('<label>', '<label class="wide">')}</div>`}
    ${steps.map((x, k) => lineEditor(x, `${t}.goal.steps.${k}`, [['months', `Au bout de\nmois après ${prog ? 'le lancement' : 'l\'ouverture'}`], ['count', kind === 'active' ? 'Visées\nabonnées en même temps' : kind === 'new' ? 'Visées\nnouvelles abonnées par an' : 'Visées\ninscriptions par an']], 'Supprimer ce palier')).join('')}
    <div class="row"><button data-add="${t}.goal.steps">${steps.length ? 'Ajouter une date d\'objectif' : 'Fixer un objectif'}</button></div>`);

  // 2. Sans pub
  const growth = `${check('Compter des clientes sans pub (vivier, bouche-à-oreille, site)', t + '.organic', orgOn)}
    ${orgOn ? growthPick(o, t) : ''}
    ${prog && orgOn ? `${check('Rythme à part pour les premières semaines', t + '.launch', o.launch)}${o.launch ? fields(o, t, [['launchWeeks', 'Pendant\nsemaines'], ['launchRate', 'Clientes\npar semaine']]) : ''}` : ''}
    <div class="grid">${field('Effet boule de neige de la pub\n% de clientes en plus pour 100 venues de la pub', t + '.viral', o.viral ?? 20)}</div>
    <p class="muted">Bouche-à-oreille et avis : 15 à 20 % est prudent, on voit de 10 à 50 %. Ces clientes arrivent sans coût et comptent dans le sans pub.</p>
    ${prog && (o.cohorts || []).length ? `<p class="muted">Les cohortes de test se règlent dans <a href="#calendrier" data-goto="calendrier" data-open="calp-${st.j}" data-anchor="calp-${st.j}">Calendrier</a> et comptent ici.</p>` : ''}`;
  const org = step(st.id + '-i2', 'ins', brand && orgOn ? 'Sans pub, depuis ton vivier' : 'Sans pub', !orgOn ? 'non compté' : s0 ? on(u(free(s0))) : `${num(Math.round(st.orgN))} sur 12 mois`,
    !orgOn ? `Aucune ${who} sans pub n'est comptée : la case est décochée dans les autres réglages.`
      : `Ce qui arrive seul, sans payer. ${list(free)}${brand ? ` ${brandNote(o, a, prog ? 'clientes' : 'abonnées')}` : ''}`,
    (orgOn && !brand ? `<div class="notice"><p><b>${o.palierMode ? 'Tu as saisi des paliers à la main' : 'Ce produit suit sa propre courbe'}</b> : ton vivier n'est pas utilisé, les chiffres ci-dessous sont ceux que tu as tapés.</p>
      <div class="row"><button class="primary" data-linkviv="${esc(t)}">Utiliser mon vivier à la place</button></div>
      <p class="muted">${o.palierMode ? 'Tes paliers restent enregistrés' : 'Ta courbe reste enregistrée'} : tu peux y revenir dans « Autres réglages du sans pub ».</p></div>` : '')
    + (orgOn ? growthFields(o, t, prog ? 'Clientes' : 'Abonnées', a) : '') + more(st.id + '-org', 'Autres réglages du sans pub', growth));

  // 3. Venues de l'abonnement
  const link = !prog ? '' : step(st.id + '-i3', 'sub', `Venues de ${esc(solo)}`, s0 ? on(u(s0.solo || 0)) : `${num(Math.round(st.soloN))} sur 12 mois`,
    `Des abonnées de ${esc(solo)} qui achètent aussi ${esc(o.name)}. Elles ne coûtent rien à trouver. ${list(sg => sg.solo || 0)}${linkCount(a, o).replace(/<\/?p[^>]*>/g, ' ')}`,
    `<div class="grid one">${field(`Achat du programme depuis l'abonnement (% par an)\nPart des abonnées ${solo} qui achètent ${o.name} dans l'année`, t + '.fromSolo', o.fromSolo)}${field(o.gift ? `Deviennent abonnées payantes après l'offre (%)\nPart des clientes ${progName(a, o)} qui gardent ${solo} en payant après l'année offerte` : `Abonnement gardé après le programme (%)\nPart des clientes ${progName(a, o)} qui gardent ${solo} à la fin`, t + '.toSolo', o.toSolo)}</div>`);

  // 4. Reste à trouver par la pub
  const gap = !segs.length ? '' : step(st.id + '-i4', 'promo', 'Reste à trouver par la pub', '',
    'Ton objectif, moins ce qui arrive seul.',
    segs.map(sg => `<p class="eq"><b>${at(sg)}</b> : ${u(sg.count)} − ${num(Math.round(free(sg)))} sans pub${prog ? ` − ${num(Math.round(sg.solo || 0))} de ${esc(solo)}` : ''} = ${left(sg) ? `<b>${num(left(sg))}</b>` : '<b class="pos">rien ✓</b>'}</p>`).join(''));

  // 5. Budget pub : automatique (suit l'objectif) ou campagnes saisies à la main.
  const campBody = `${camps.map((c, k) => campaign(c, `${t}.campaigns.${k}`, who)).join('') || '<p class="muted">Aucune campagne.</p>'}<div class="row"><button data-add="${t}.campaigns">Ajouter une campagne</button></div>
    ${camps.length > 1 ? '<p class="muted">Des campagnes sur les mêmes mois s\'additionnent.</p>' : ''}`;
  const lines = segs.filter(sg => sg.budget).map(sg => `<p class="eq">${sg.end ? `De ${monthName(sg.start)} à ${monthName(sg.end)}` : `Dès ${monthName(sg.start)}`} : ${num(Math.round(sg.perMonth))} × ${money(plan.cac)} = <b>${money(sg.budget)} / mois</b></p>`).join('');
  const reached = segs.every(sg => sg.current + 0.5 >= sg.count);
  const budget = !segs.length
    ? step(st.id + '-i5', 'promo', 'Ta pub', camps.length ? `${money(Math.round(st.pubB / 12))} / mois` : 'aucune', `Sans objectif, tu choisis toi-même tes campagnes : budget par mois et coût d'une ${who}. Le budget de chaque mois est compté dans Charges, ligne « Campagnes pub ».`, campBody)
    : step(st.id + '-i5', 'promo', 'Budget pub', '',
      `${P.auto ? 'Calculé tout seul : ce qui reste à trouver, multiplié par le coût d\'une ' + who + ' venue de la pub. Il change dès que tu modifies l\'objectif, le vivier ou le coût.' : 'Tu saisis tes propres campagnes. Coche la case pour revenir au calcul automatique.'} Le budget de chaque mois est compté dans Charges, ligne « Campagnes pub ».`,
      check('La pub suit mon objectif (calcul automatique)', t + '.goal.auto', P.auto)
      + (P.auto ? (lines || '<p class="eq pos">Pas de pub nécessaire : ce qui arrive seul suffit.</p>')
        : `${lines ? `<p class="muted">Pour atteindre l'objectif, il faudrait :</p>${lines}` : ''}<p class="eq ${reached ? 'pos' : 'neg'}">Avec tes campagnes : ${reached ? 'objectif atteint ✓' : 'objectif pas atteint ✗'}</p>${campBody}`));
  return goal + org + link + gap + budget;
}
// État de l'objectif, pour la carte repliée.
function goalStatus(a, st) {
  const P = productPlan(a, st);
  if (!P.plan || !P.segs.length) return '';
  const ok = P.segs.every(sg => sg.current + 0.5 >= sg.count), s0 = focusSeg(P.segs);
  return `<br>objectif ${P.u(s0.count)} en ${monthName(s0.at)} : <b class="${ok ? 'pos' : 'neg'}">${ok ? 'atteint' : 'pas atteint'}</b>`;
}

// Raccourci depuis Acquisition : le vivier alimente le sans pub, et le bouton pré-remplit tous les produits.
function audienceLink(a, p) {
  const from = appStart(a), used = [a.sub, ...a.programs.filter(q => q.enabled)].filter(q => q.shape === 'brand' && !q.palierMode && q.organic !== false);
  return `<details class="card" id="acq-brand" ${view.open.has('acq-brand') ? 'open' : ''}><summary><span>Sans pub depuis ton vivier<br><span class="sum-sub">${num(Math.round(audienceAt(a, from)))} → ${num(Math.round(audienceAt(a, PLAN_END)))} personnes d'ici fin ${PLAN_END.slice(0, 4)} · ${used.length ? `utilisé par ${used.map(q => esc(q === a.sub ? soloName(a) : q.name)).join(', ')}` : 'aucun produit ne l\'utilise encore'}</span></span></summary>
    <p class="muted">Le sans pub de chaque produit vient de ton vivier (abonnées Instagram et newsletter), réglé sur la page <a href="#notoriete" data-goto="notoriete">Notoriété</a>. Un produit lancé plus tard profite du vivier déjà construit.</p>
    ${(() => {
      // Produits qui n'utilisent pas le vivier : on dit pourquoi, et un bouton les y branche.
      const off = [{ q: a.sub, t: p + '.sub', n: soloName(a) }, ...a.programs.map((q, j) => ({ q, t: `${p}.programs.${j}`, n: q.name })).filter(x => x.q.enabled)].filter(x => !used.includes(x.q));
      return off.length ? `<div class="gap">${off.map(x => `<p class="warn">${esc(x.n)} n'utilise pas le vivier : ${x.q.organic === false ? 'son sans pub est décoché' : x.q.palierMode ? 'ses paliers sont saisis à la main' : 'il garde sa propre courbe'}.</p><div class="row"><button data-linkviv="${esc(x.t)}">Brancher ${esc(x.n)} sur le vivier</button></div>`).join('')}</div>` : '';
    })()}
    <div class="row"><button data-prefill="${esc(p)}">Remettre les taux conseillés pour tous les produits</button></div>
    <p class="muted">Nouvelles venues / vivier déjà là, en % qui achètent chaque mois : ${esc(soloName(a))} 2 % / 0,3 %, Refit 1 % / 0,15 % (lancement : 10 par semaine pendant 4 semaines), Better Sleep 0,4 % / 0,06 % (4 par semaine), Calm Inside 0,3 % / 0,04 % (3 par semaine), autres programmes 0,4 % / 0,06 %. Boule de neige 15 %. Chaque produit garde ses taux dans sa carte, à l'étape « Sans pub, depuis ton vivier ».</p>
  </details>`;
}
// ---------- Notoriété : ton vivier, et ce qui le fait grandir (relais → Instagram → newsletter, puis stores) ----------
const pos0 = x => Math.max(0, +x || 0);
// Horizon des projections : fin 2032 (plan sur 6 ans).
const PLAN_END = '2032-12';
const lastActual = o => { const k = Object.keys(o?.actuals || {}).filter(m => (o.actuals[m] ?? '') !== '').sort().at(-1); return k ? [k, +o.actuals[k]] : null; };
// Barres empilées sur 3 ans : séries [{ key, label, color }], points facultatifs (vrais chiffres).
function stackChart(rows, series, aria, unit, dots = []) {
  const W = 320, H = 120, T = 14, bw = W / rows.length, max = Math.max(1, ...rows.map(r => series.reduce((t, x) => t + (r[x.key] || 0), 0)), ...dots.filter(Boolean));
  const bars = rows.map((r, k) => { let y = H; return series.map(x => { const h = (r[x.key] || 0) / max * (H - T); y -= h; return h > 0 ? `<rect x="${(k * bw + 0.5).toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, bw - 1).toFixed(1)}" height="${h.toFixed(1)}" fill="${x.color}"/>` : ''; }).join(''); }).join('');
  const pts = dots.map((v, k) => v ? `<circle cx="${(k * bw + bw / 2).toFixed(1)}" cy="${(H - v / max * (H - T)).toFixed(1)}" r="3.2" fill="var(--ink)"/>` : '').join('');
  const ticks = rows.map((r, k) => r.month.endsWith('-01') ? `<text x="${(k * bw + 1).toFixed(1)}" y="${H + 12}" font-size="9" fill="var(--ink-soft)">${r.month.slice(0, 4)}</text>` : '').join('');
  return `<figure class="acq-chart"><svg viewBox="0 0 ${W} ${H + 16}" role="img" aria-label="${esc(aria)}">${bars}${pts}${ticks}<text x="${W}" y="10" font-size="9" text-anchor="end" fill="var(--ink-soft)">max ${num(Math.round(max))}${unit}</text></svg>
    <figcaption>${series.filter(x => rows.some(r => r[x.key])).map(x => `<span><i style="background:${x.color}"></i>${x.label}</span>`).join('')}${pts ? '<span><i style="background:var(--ink);border-radius:50%"></i>Tes vrais chiffres</span>' : ''}</figcaption></figure>`;
}
function notorietePage(a, i) {
  migrateAudience(a);
  const au = a.audience, p = `apps.${i}.audience`, ser = audienceSeries(a), from = au.from || thisMonth;
  const now = [thisMonth, from].sort().at(-1), end = PLAN_END, at = m => ser.get(m) || ser.get(from);
  const months = []; for (let m = from; m <= end; m = addMonths(m, 1)) months.push(m);
  // Paliers datés : nouvelles personnes par mois, en S d'un palier au suivant.
  const steps = (o, t, unit) => `${(o.points || []).map((q, k) => lineEditor(q, `${t}.points.${k}`, [['month', 'Mois', 'month'], ['n', unit]], (o.points || []).length > 1 ? 'Retirer ce palier' : '')).join('')}<div class="row"><button data-add="${t}.points">Ajouter un palier</button></div>`;
  // Vrais chiffres : abonnées Instagram et inscrites newsletter relevées à la main (plus tard, lues automatiquement).
  const li = lastActual(au.insta), ln = lastActual(au.newsletter);
  const realInsta = li ? li[1] : at(now).insta, realNews = ln ? ln[1] : at(now).news;
  const hasReal = !!(li || ln), planNow = at(now).insta + at(now).news, real = realInsta + realNews;
  const pool = at(now).pool, poolEnd = at(end).pool, vsPlan = planNow ? real / planNow * 100 : 100;
  const rows = months.map(m => { const r = at(m); return { month: m, insta: r.insta, news: r.news, stores: r.stores, own: r.own, relays: r.relays, st: r.st }; });
  const dots = months.map(m => { const vi = au.insta.actuals?.[m], vn = au.newsletter?.actuals?.[m]; return (vi ?? '') === '' && (vn ?? '') === '' ? 0 : ((vi ?? '') === '' ? at(m).insta : +vi) + ((vn ?? '') === '' ? at(m).news : +vn); });
  const realField = (o, t) => `<div class="grid one">${field(`Vrai chiffre en ${monthName(thisMonth)}\nrelevé à la main`, `${t}.actuals.${thisMonth}`, o.actuals?.[thisMonth] ?? '')}</div>`;
  const realNote = (o, plan) => { const la = lastActual(o); return `<p class="muted">${la ? `Dernier relevé : ${num(la[1])} en ${monthName(la[0])}, pour ${num(Math.round(plan(la[0])))} prévues${la[1] >= plan(la[0]) ? ' : en avance, bravo.' : '.'}` : 'Pas encore de relevé.'} Lecture automatique : à venir.</p>`; };
  const relayN = at(addMonths(from, 3)).relays;
  const card = (id, title, sub, body) => `<details class="card" id="${id}" ${view.open.has(id) ? 'open' : ''}><summary><span>${title}<br><span class="sum-sub">${sub}</span></span></summary>${body}</details>`;
  return `${banner({ label: `Ton vivier · ${esc(a.name)}`, big: num(Math.round(hasReal ? real + at(now).stores : pool)),
      note: `Les personnes qui te connaissent et peuvent acheter sans pub : abonnées Instagram, inscrites à ta newsletter${au.stores?.on ? ' et, dès tes applis natives, personnes venues des stores' : ''}. Prévu : ${num(Math.round(poolEnd))} en ${monthName(end)}.`,
      tiles: [
        { label: 'Instagram', mini: 'Insta', value: num(Math.round(realInsta)), hint: li ? 'relevé' : 'prévu' },
        { label: 'Newsletter', mini: 'Lettre', value: num(Math.round(realNews)), hint: ln ? 'relevé' : 'prévu' },
        { label: 'Face au plan', mini: false, value: hasReal ? `${num(Math.round(vsPlan))} %` : '—', cls: hasReal ? (vsPlan >= 100 ? 'ok' : 'bad') : '', hint: hasReal ? `plan de ${monthName(now)} : ${num(Math.round(planNow))}` : 'saisis tes vrais chiffres' }
      ] })}
    ${card('au-pool', `Ton vivier jusqu'en ${end.slice(0, 4)}`, `${num(Math.round(at(from).pool))} → ${num(Math.round(poolEnd))} personnes`, `
      <p class="muted">Le chemin de tes clientes sans pub : les relais (ta sœur…) font grandir ton <b>Instagram</b>, une part de tes abonnées s'inscrit à ta <b>newsletter</b>, puis elles achètent sur ton <b>site</b>. Chaque mois, une petite part de ce vivier achète chaque produit (page <a href="#acquisition" data-goto="acquisition" data-open="acq-brand" data-anchor="acq-brand">Acquisition</a>).</p>
      <h4>Taille du vivier, fin de chaque mois</h4>
      ${stackChart(rows, [{ key: 'insta', label: 'Abonnées Instagram', color: 'var(--k-ins)' }, { key: 'news', label: 'Newsletter', color: 'var(--k-promo)' }, { key: 'stores', label: 'Venues des stores', color: 'var(--k-cal)' }], 'Taille du vivier par mois', '', dots)}
      <h4>Nouvelles personnes chaque mois</h4>
      ${stackChart(rows, [{ key: 'own', label: 'Instagram, par toi', color: 'var(--k-ins)' }, { key: 'relays', label: 'Par les relais', color: 'var(--k-sub)' }, { key: 'st', label: 'Stores', color: 'var(--k-cal)' }], 'Nouvelles personnes par mois', ' / mois')}`)}
    ${card('au-insta', 'Instagram', `${num(pos0(au.insta.count))} abonnées au départ · ${num(Math.round(at(end).insta))} prévues en ${monthName(end)}`, `
      <div class="lrow">${field('Abonnées au départ\nnombre', p + '.insta.count', au.insta.count)}${monthField('Au mois de', p + '.from', au.from)}</div>
      <h4>Nouvelles abonnées gagnées par toi, par paliers</h4>
      ${steps(au.insta, p + '.insta', 'Nouvelles / mois')}
      <p class="muted">Tes publications, reels et partages. Entre deux paliers, la croissance suit une courbe douce. Les relais s'ajoutent en plus, dans leur carte. Ajoute des paliers pour projeter ta croissance jusqu'en ${end.slice(0, 4)}.</p>
      ${realField(au.insta, p + '.insta')}${realNote(au.insta, m => at(m).insta)}`)}
    ${card('au-relays', 'Relais', `${(au.relays || []).length ? `${(au.relays || []).map(r => esc(r.name)).join(', ')} · ≈ ${num(Math.round(relayN))} nouvelles abonnées / mois` : 'aucun'}`, `
      <p class="muted">Des comptes qui montrent ton travail. Leurs abonnées passent par ton Instagram : chaque mois, une part d'entre elles te suit.</p>
      ${(au.relays || []).map((r, k) => { const t = `${p}.relays.${k}`; return `<div class="camp"><div class="grid one">${field('Nom du relais', t + '.name', r.name, 'text')}</div>${lineEditor(r, t, [['audience', 'Ses abonnées\nnombre'], ['rate', 'Te suivent chaque mois\n%']], 'Retirer ce relais')}<div class="lrow">${monthField('Début', t + '.start', r.start)}${monthField('Fin', t + '.end', r.end, 'sans fin')}</div><p class="pal-ok acq-res">${num(pos0(r.audience))} × ${fmtN(pos0(r.rate), 2)} % = <b>${num(Math.round(pos0(r.audience) * pos0(r.rate) / 100))} nouvelles abonnées par mois</b></p></div>`; }).join('')}
      <div class="row"><button data-add="${p}.relays">Ajouter un relais</button></div>`)}
    ${card('au-news', 'Newsletter', `${num(pos0(au.newsletter.count))} inscrites au départ · ${num(Math.round(at(end).news))} prévues en ${monthName(end)}`, `
      <div class="grid">${field('Inscrites au départ\nnombre', p + '.newsletter.count', au.newsletter.count)}${field('Nouvelles abonnées Insta\nqui s\'inscrivent (%)', p + '.newsletter.fromInsta', au.newsletter.fromInsta)}</div>
      ${realField(au.newsletter, p + '.newsletter')}${realNote(au.newsletter, m => at(m).news)}`)}
    ${card('au-stores', 'Stores (applis natives)', au.stores?.on && au.stores.points?.length ? `dès ${monthName([...au.stores.points].sort((x, y) => x.month.localeCompare(y.month))[0].month)} · ${num(Math.round(pointsAt(au.stores.points, end, 0)))} découvertes / mois en ${end.slice(0, 4)}` : 'pas encore', `
      ${check('Compter les découvertes dans l\'App Store et Google Play', p + '.stores.on', au.stores?.on)}
      ${au.stores?.on ? `${steps(au.stores, p + '.stores', 'Personnes / mois')}
      <p class="muted">Le premier palier est la sortie de tes applis natives. Aujourd'hui ton site est une appli web : on ne t'y trouve que par Instagram. Sur les stores, des personnes te découvrent en cherchant.</p>` : ''}`)}`;
}
function acquisitionPage(a, i) {
  prodSim = simulate(a);
  const p = 'apps.' + i, ch = a.channels || { store: 0, storeRate: 15 }, dates = appDates([a]);
  const r = results(), x = r.all[i], ms = x.months;
  // Fenêtre de lecture : les 12 mois à partir d'aujourd'hui, ou du lancement s'il est plus tard.
  const from = [thisMonth, dates.launch || appStart(a)].sort().at(-1), k0 = Math.max(0, ms.findIndex(m => m.month >= from)), win = ms.slice(k0, k0 + 12), pnl = x.pnl.slice(k0, k0 + 12);
  const htK = htShare(state, a);
  const prods = [{ key: 'sub', name: soloName(a), o: a.sub, t: p + '.sub', id: 'acq-sd', fresh: m => m.newDirect.reduce((u, v) => u + v, 0) },
    ...a.programs.map((q, j) => q.enabled ? { key: q.id, name: progName(a, q), o: q, j, t: `${p}.programs.${j}`, id: 'acq-p' + j, fresh: m => m.products[j].admissions - (m.products[j].fromSolo || 0), solo: m => m.products[j].fromSolo || 0 } : null).filter(Boolean)];
  const shown = x2 => !acqHidden.has(x2.key);
  const pubFixed = (a.charges || []).filter(c => c.category === 'marketing' && c.type === 'fixe');
  const fixedYear = pubFixed.reduce((t, c) => t + win.reduce((u, m) => u + (chargeAt(c, m.month, dates) || 0), 0), 0);
  const acqYear = pnl.reduce((t, e) => t + (e.lines[':acq'] || 0), 0);
  const stats = prods.map(x2 => {
    const o = x2.o, v = clientValue(a, x2.j ?? 'sub') * htK, n = win.reduce((u, m) => u + x2.fresh(m), 0);
    const pubB = win.reduce((u, m) => u + campaignBudget(o, m.month), 0), pubN = win.reduce((u, m) => u + campaignClients(o, m.month), 0);
    const now = campaignsAt(o, from), cac = pubN ? pubB / pubN : (now[0] ? +now[0].cac || 0 : 0);
    const price = (+phaseAt(x2.key === 'sub' ? a.sub.directPricing : o.pricing, from).price || 0) * htK;
    // Délai pour rentrer dans ses frais : une abonnée rembourse son coût mois après mois ; un programme se paie d'un coup.
    const payback = !cac || !price ? null : x2.key === 'sub' ? cac / price : cac <= price ? 0 : null;
    const soloN = x2.solo ? win.reduce((u, m) => u + x2.solo(m), 0) : 0, orgN = Math.max(0, n - pubN), all = orgN + pubN + soloN;
    return { ...x2, cac, v, n, pubB, pubN, soloN, orgN, all, budgetNow: campaignBudget(o, from), ratio: cac ? v / cac : null, payback };
  });
  const pubAll = stats.reduce((t, x2) => t + x2.pubN, 0), allN = stats.reduce((t, x2) => t + x2.all, 0);
  const pct = (u, w) => w ? `${num(Math.round(u / w * 100))} %` : '—';
  const list = `<div class="ucheck"><label class="uc"><input type="checkbox" data-acqall ${prods.every(shown) ? 'checked' : ''}><span>Tout</span></label>${prods.map(x2 => `<label class="uc"><input type="checkbox" data-acqshow="${esc(x2.key)}" ${shown(x2) ? 'checked' : ''}><span>${esc(x2.key === 'sub' ? soloName(a) : x2.o.name)}</span></label>`).join('')}</div>`;
  const picker = pickPop('pk-acq', 'Produits affichés', list, prods.filter(shown).map(x2 => x2.key === 'sub' ? 'Abonnement' : x2.o.name), prods.length);
  const ratioCls = st => st.ratio === null ? '' : st.ratio >= 3 ? 'ok' : st.ratio >= 1 ? 'mid' : 'bad';
  const span = (u, w) => (+w.slice(0, 4) - +u.slice(0, 4)) * 12 + +w.slice(5) - +u.slice(5) + 1;
  const campaign = (c, path, who) => {
    const per = +c.cac > 0 ? (+c.budget || 0) / +c.cac : null, len = c.start && c.end && c.end >= c.start ? span(c.start, c.end) : null;
    return `<div class="camp"><div class="lrow">${monthField('Début', path + '.start', c.start)}${monthField('Fin', path + '.end', c.end, 'sans fin')}</div>
      <div class="lrow">${field('Budget\n€ / mois', path + '.budget', c.budget)}${field('Coût par ' + who + '\n€', path + '.cac', c.cac)}<button class="icon danger" data-remove="${esc(path)}" aria-label="Retirer cette campagne" title="Retirer cette campagne">${TRASH}</button></div>
      ${!c.start ? '<p class="muted">Choisis le mois de début.</p>' : c.end && c.end < c.start ? '<p class="warn">La fin est avant le début.</p>' : per === null ? '<p class="muted">Indique le coût par ' + who + '.</p>'
        : `<p class="pal-ok acq-res">${money(+c.budget || 0)} ÷ ${money(+c.cac)} = <b>${num(Math.round(per))} ${who}s par mois</b>${len ? `<br>${monthName(c.start)} → ${monthName(c.end)} : ${len} mois, ${money((+c.budget || 0) * len)} pour ${num(Math.round(per * len))} ${who}s` : `<br>dès ${monthName(c.start)}, sans fin`}</p>`}</div>`;
  };
  const cards = stats.filter(shown).map(st => {
    const o = st.o, who = st.key === 'sub' ? 'abonnée' : 'cliente', camps = o.campaigns || [], prog = st.key !== 'sub';
    const rows = win.map(m => { const c = campaignClients(o, m.month), f = st.fresh(m);
      return `<tr><td>${monthShort(m.month)}</td><td>${num(Math.round(Math.max(0, f - c)))}</td><td>${c ? num(Math.round(c)) : '—'}</td>${prog ? `<td>${num(Math.round(st.solo(m)))}</td>` : ''}<td><b>${num(Math.round(f + (prog ? st.solo(m) : 0)))}</b></td><td>${campaignBudget(o, m.month) ? short(campaignBudget(o, m.month)) : '—'}</td></tr>`; }).join('');
    const orgOn = o.organic !== false;
    return `<details class="card product${prog ? '' : ' solo'}" id="${st.id}" ${view.open.has(st.id) ? 'open' : ''}><summary><span>${esc(st.name)}<br><span class="sum-sub">${num(Math.round(st.all))} nouvelles ${who}s sur 12 mois${orgOn && o.shape === 'brand' && !o.palierMode ? `<br>dont ${num(Math.round(st.orgN / 12))} / mois sans pub, depuis ton vivier` : ''}${goalStatus(a, st)}</span>
        ${pstats([['Sans pub', pct(st.orgN, st.all)], ['Pub', pct(st.pubN, st.all), 'hi'], prog ? [`Via ${soloName(a).replace(/ seul$/, '')}`, pct(st.soloN, st.all)] : null, ['Pub moy. / mois', money(Math.round(st.pubB / 12))]])}</span></summary>
      ${productSynth(a, st)}
      ${(() => { const k1 = Math.max(0, ms.findIndex(m => m.month >= (prog ? o.start || from : a.sub.start || from))), launch = prog ? launchByMonth(a, o) : {}; return acqChart(ms.slice(k1).filter(m => m.month <= PLAN_END).map(m => { const c = campaignClients(o, m.month), f = st.fresh(m); const l = Math.min(Math.max(0, f - c), launch[m.month] || 0); return { month: m.month, pub: Math.min(c, f), launch: l, org: Math.max(0, f - c - l), solo: prog ? st.solo(m) : 0 }; })); })()}
      ${productStory(a, st, p, campaign)}
      ${section(st.id + '-mois', 'cal', 'Mois par mois', `${num(Math.round(st.all))} ${who}s · ${short(st.pubB)} de pub sur 12 mois`, `<table class="acq-tab"><thead><tr><th>Mois</th><th>Sans pub</th><th>Pub</th>${prog ? '<th>Abonnées</th>' : ''}<th>Total</th><th>Budget</th></tr></thead><tbody>${rows}</tbody></table>`)}
      </details>`;
  }).join('');
  return `${banner({ label: `Nouvelles clientes · ${esc(a.name)}`, big: `${num(Math.round(allN / 12))} / mois`,
      note: `Sur les 12 mois à partir de ${monthName(from)} : ${num(Math.round(allN))} nouvelles clientes, dont ${pct(pubAll, allN)} par la pub, pour ${money(Math.round(acqYear + fixedYear))} de publicité.`,
      tiles: [
        { label: 'Pub sur 12 mois', mini: 'Pub / an', value: short(acqYear + fixedYear), hint: `dont ${short(fixedYear)} de pub fixe` },
        { label: 'Coût d\'une cliente', mini: 'Coût / cliente', value: pubAll ? money(acqYear / pubAll) : '—', hint: 'venue de la pub, en moyenne' },
        { label: 'Ce qu\'une cliente rapporte', mini: 'Rapporte', value: allN ? money(stats.reduce((t, x2) => t + x2.v * x2.all, 0) / allN) : '—', hint: 'sur sa durée de vie, HT, en moyenne' },
        { label: 'Part de la pub', mini: false, value: pct(pubAll, allN), hint: `${num(Math.round(pubAll))} clientes sur 12 mois` }
      ] })}
    ${picker}
    ${audienceLink(a, p)}
    ${cards}
    <details class="card" id="acq-fixed" ${view.open.has('acq-fixed') ? 'open' : ''}><summary><span>Publicité fixe<br><span class="sum-sub">${pubFixed.length ? `${pubFixed.length} charge${pubFixed.length > 1 ? 's' : ''} · ${money(Math.round(fixedYear))} sur 12 mois` : 'aucune'}</span></span></summary>
      ${pubFixed.length ? `<ul class="where">${pubFixed.map(c => `<li>${esc(c.name)} : ${money(Math.round(win.reduce((u, m) => u + (chargeAt(c, m.month, dates) || 0), 0)))} sur 12 mois</li>`).join('')}</ul>` : ''}
      <p class="muted">Budget qui ne dépend pas du nombre de clientes (agence, contenus, image). Il se règle dans <a href="#charges" data-goto="charges">Charges</a>, catégorie Publicité. Ne la compte pas aussi dans une campagne.</p></details>
    <details class="card" id="acq-ch" ${view.open.has('acq-ch') ? 'open' : ''}><summary><span>Canaux de vente<br><span class="sum-sub">${+ch.store ? `${num(ch.store)} % par les stores à ${num(ch.storeRate)} %` : 'tout par le site'} · ${state.vat.zones.filter(z => +(a.zones || {})[z.id] > 0).map(z => `${esc(z.name.split(' ')[0])} ${num(+a.zones[z.id])} %`).slice(0, 3).join(' · ')}</span></span></summary>
      <h4>Où paient tes clientes</h4>
      <div class="grid">${field('Ventes passées par l\'App Store\net Google Play (%)', p + '.channels.store', ch.store)}${field('Commission des stores\n(%)', p + '.channels.storeRate', ch.storeRate)}</div>
      <p class="muted">15 % pour les petits éditeurs (moins d'un million de dollars par an), 30 % au-delà. Les frais Stripe ne portent que sur la part vendue sur ton site.</p>
      <h4>Où vivent tes clientes</h4>
      <div class="grid">${state.vat.zones.map(z => field(z.name + '\n% des ventes', `${p}.zones.${z.id}`, (a.zones || {})[z.id] || 0)).join('')}</div>
      ${(() => { const t = state.vat.zones.reduce((s2, z) => s2 + (+(a.zones || {})[z.id] || 0), 0); return Math.abs(t - 100) > 0.5 ? `<p class="warn">Total : ${num(t)} %. Les parts sont ramenées à 100 %.</p>` : ''; })()}
      <p class="muted">La TVA de chaque zone se règle dans <a href="#reglages" data-goto="reglages" data-open="st-vat" data-anchor="st-vat">Réglages › TVA</a>.</p></details>`;
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
    ln(':acq', 'marketing', 'Campagnes pub', 'budgets des campagnes (Acquisition)', s.lines[':acq'] || 0),
    ln(':coaching', 'coaching', 'Heures de coachs', `${money(+a.coachRate || 0)} / h`, s.lines[':coaching'] || 0),
    ...appCharges.filter(c => !isFixed(c)).map(c => ln(c.id, c.category || 'autre', c.name, amountText(c, +c.amount || 0), s.lines[c.id] || 0))];
  const fixed = appCharges.filter(isFixed).map(c => ln(c.id, c.category || 'autre', c.name, `${c.type === 'unique' ? 'une fois' : money(+c.amount || 0) + ' / mois'} · démarre ${startOf(c, dates)}`, s.lines[c.id] || 0));
  const struct = shared.map(c => ln(c.id, c.category || 'autre', c.name, `démarre ${startOf(c, all)} · ${r.st.shared.key === 'ca' ? 'au prorata du CA' : 'à parts égales'}`, s.structureLines[c.id] || 0));
  const quiet = [...variable, ...fixed, ...struct].filter(l => l.v <= 0.5 && !l.id.startsWith(':')).map(l => esc(l.name));
  const sum = ls => ls.reduce((t, l) => t + l.v, 0);
  // Une sous-rubrique par nature de charge (comme les comptes 60 à 64 d'un compte de résultat), dépliable.
  const byCat = (ls, pre) => CHARGE_CATEGORIES.map(([k, n]) => {
    // Le coaching reste affiché même à 0 € : on voit qu'il est compté.
    const on = ls.filter(l => l.cat === k && (l.v > 0.5 || (l.id === ':coaching' && a.programs.length))).sort((p, q) => q.v - p.v);
    if (!on.length) return '';
    const v = sum(on);
    return section(`${pre}-${k}`, CAT_KIND[k], n, `<b>${money(v)}</b> · ${pctOf(v, ca)} du CA`,
      `<dl class="pl-lines">${on.map(l => `<dt>${esc(l.name)}<small>${l.sub}</small></dt><dd>${money(l.v)}</dd>`).join('')}</dl>`);
  }).join('');
  const vTot = sum(variable), fTot = sum(fixed), sTot = sum(struct), margin = ca - vTot, result = ca - total;
  const level = (id, title, v, body, open) => `<details class="pl-lvl" id="${id}" ${view.open.has(id) ? 'open' : ''}><summary><span>${title}</span><b>${money(-v)}</b><small>${pctOf(v, ca)}</small></summary><div class="pl-body">${body || '<p class="muted">Aucune sur la période.</p>'}</div></details>`;
  const sub = (title, v, cls = '') => `<div class="pl-sub ${cls}"><span>${title}</span><b class="${v < 0 ? 'neg' : ''}">${money(v)}</b><small>${pctOf(v, ca)}</small></div>`;
  const sc = currentScenario();
  return `<details class="card" id="ch-period" ${view.open.has('ch-period') ? 'open' : ''}><summary><span>Compte d'exploitation ${periodName()}<br><span class="sum-sub">charges ${money(total)} · résultat <b class="${result < 0 ? 'neg' : 'pos'}">${money(result)}</b></span></span></summary>
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
  chAmt = ps || { lines: {}, structureLines: {} };
  try { return chargesBody(); } finally { chAmt = null; }
  function chargesBody() {
  const L = k => chAmt.lines[k] || 0;
  // Coûts calculés ailleurs, montrés ici pour que les cartes s'additionnent : coaching (toujours), pub et stores.
  const calc = (id, kind, title, v, text) => section(id, kind, title, `${periodAmount(v)} · calculé`, `<p class="muted">${text}</p>`);
  const computed = (a.programs.length ? calc('cg-coach', CAT_KIND.coaching, 'Coaching', L(':coaching'),
      `Heures à payer à des coachs × ${money(+a.coachRate || 0)} / h. Les heures qui manquent au-delà des tiennes sont calculées dans l'onglet <a href="#coaching" data-goto="coaching">Coaching</a>.${L(':coaching') < 0.5 ? ` ${periodName()[0].toUpperCase() + periodName().slice(1)}, tes heures suffisent : rien à payer.` : ''}`) : '')
    + (L(':acq') >= 0.5 ? calc('cg-acq', CAT_KIND.marketing, 'Campagnes pub', L(':acq'), 'Budgets des campagnes, réglés dans <a href="#acquisition" data-goto="acquisition">Acquisition</a>.') : '')
    + (L(':store') >= 0.5 ? calc('cg-store', CAT_KIND.paiement, 'Commissions App Store / Google Play', L(':store'), `${num(+a.channels?.store || 0)} % des ventes passent par les stores.`) : '');
  return `${banner({ label: 'Charges', chip: periodChip(), big: money(cost),
      note: `${pctOf(cost, r.sum('caHT'))} du CA HT ${periodName()}, structure comprise : le même total que dans Résultat. Détail juste en dessous.`,
      tiles: [
        { label: 'Charges fixes par mois', mini: 'Fixes / mois', value: money(fixedAt(list, dates)), hint: `en ${monthName(ref)}, un an après le lancement, hors structure` },
        { label: 'Structure Om Holistic', mini: 'Structure', value: money(fixedAt(sh.charges, all)), hint: 'par mois, toutes applis' },
        { label: 'À compléter', value: num(todo), cls: todo ? 'warn-v' : '', hint: `sur ${list.length} charges` },
        { label: 'Estimations', value: num(est), hint: `${list.length - est - todo} confirmée${list.length - est - todo > 1 ? 's' : ''}` }
      ] })}
    ${chargesPeriodCard(a, i, r)}
    <p class="muted"><a href="#acquisition" data-goto="acquisition">Canaux de vente, budget pub et coût par cliente : Acquisition ›</a></p>
    <details class="card" id="ch-ramp" ${view.open.has('ch-ramp') ? 'open' : ''}><summary>Montée en charge de ${esc(a.name)}</summary>${chargeRamp(a.charges || [], dates, a.programs.length ? ['le coaching'] : [])}</details>
    ${chargeFold('ch-var', `Charges variables de ${esc(a.name)}`, `${tot ? periodAmount(tot.v) + ' · ' : ''}${nV} charge${nV > 1 ? 's' : ''}${a.programs.length ? ' + coaching' : ''}`,
      `${computed}${chargeGroups(a.charges || [], p + '.charges', a, dates, scopes, c => !isFixed(c)) || (computed ? '' : '<p class="muted">Aucune pour l\'instant.</p>')}
      <div class="add-row"><button class="add" data-chadd="${p}.charges|var">Ajouter une charge variable</button></div>`)}
    ${chargeFold('ch-fix', `Charges fixes de ${esc(a.name)}`, `${tot ? periodAmount(tot.f) + ' · ' : ''}${nF} charge${nF > 1 ? 's' : ''}`,
      `${chargeGroups(a.charges || [], p + '.charges', a, dates, scopes, isFixed) || '<p class="muted">Aucune pour l\'instant.</p>'}
      <div class="add-row"><button class="add" data-chadd="${p}.charges|fix">Ajouter une charge fixe</button></div>`)}
    ${chargeFold('ch-str', 'Charges de structure Om Holistic', `${tot ? 'quote-part ' + periodAmount(tot.s) + ' · ' : ''}${sh.charges.length} charge${sh.charges.length > 1 ? 's' : ''}`,
      `<div class="grid">${select('Répartition entre les applications', 'shared.key', sh.key, [['ca', 'Au prorata du chiffre d\'affaires'], ['egal', 'À parts égales']]).replace('<label>', '<label class="wide">')}</div>
      <details class="fold" id="sh-ramp" ${view.open.has('sh-ramp') ? 'open' : ''}><summary>Montée en charge de la structure</summary>${chargeRamp(sh.charges, all)}</details>
      ${chargeGroups(sh.charges, 'shared.charges', null, all, null)}
      <div class="add-row"><button class="add" data-chadd="shared.charges|str">Ajouter une charge de structure</button></div>`)}
    ${chargeModal()}`;
  }
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
  return `<details class="card" id="r-scen" ${view.open.has('r-scen') ? 'open' : ''}><summary><span>Scénarios et sensibilité<br><span class="sum-sub">affiché partout : ${esc(cur.name)} · ${list.map(x => `${esc(x.name)} ${short(cols.find(c => c.sc.id === x.id).result)}`).join(' · ')}</span></span></summary>
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
  const scale = x => ({ sc: x.sc, vatCa: x.vatCa, fixed: x.fixed * share, social: x.social * share, tax: x.tax * share, dist: x.dist * share, net: x.net * share });
  // La TVA dépend de l'implantation (franchise, société française, LLC) : CA et résultat recalculés pour chaque régime.
  const byMode = new Map([[vatMode(im.scenarios.find(x => x.id === (r.st.implantation || im).current)), { ca, result }]]);
  const base = mode => {
    if (!byMode.has(mode)) {
      const sc = im.scenarios.find(x => vatMode(x) === mode), st = { ...r.st, implantation: { ...(r.st.implantation || im), current: sc.id } };
      const t = sumPnl(buildPnl(st, r.all).flat().filter(e => inPeriod(e.month))).total;
      byMode.set(mode, { ca: t.ca, result: t.result });
    }
    return byMode.get(mode);
  };
  const res = im.scenarios.map(sc => { const b = base(vatMode(sc)); return scale({ sc, vatCa: b.ca, ...afterTax(sc, b.ca, b.result, months) }); });
  const yearCa = ca * 12 / months;
  const over = x => +x.sc.caLimit > 0 && x.vatCa * 12 / months > +x.sc.caLimit;
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
  return `<details class="card" id="r-implant" ${view.open.has('r-implant') ? 'open' : ''}><summary><span>Résultat net selon l'implantation<br><span class="sum-sub">${esc(cur.sc.name)} : ${money(cur.net)} ${periodName()}</span></span></summary>
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
  const s = sumPnl(scope.flatMap(x => x.pnl.filter(e => inPeriod(e.month)))), t = s.total;
  const last = ms.at(-1), first = ms[0];
  const subCA = m => htOf(m, m.directCA + m.postCA);
  const mrr = subCA(last), mrr0 = subCA(first), n = ms.length;
  const cmgr = n > 1 && mrr0 > 0 ? (Math.pow(mrr / mrr0, 1 / (n - 1)) - 1) * 100 : null;
  // Churn mensuel : abonnées perdues / abonnées en début de mois, sur la période.
  let lost = 0, base = 0;
  for (const x of scope) {
    const dur = +x.a.sub.duration > 0 ? 1 / +x.a.sub.duration : 0, pdur = dur;
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
  const flows = tm.map((m, k) => m.balance - (k ? tm[k - 1].balance : m.balance - (m.inflow - m.charges - m.taxes - (m.vatPaid || 0) - m.pay)) - (m.raised || 0));
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
  return `<details class="card" id="r-kpi" ${view.open.has('r-kpi') ? 'open' : ''}><summary><span>Indicateurs clés (investisseurs)<br><span class="sum-sub">ARR ${short(mrr * 12)} · marge brute ${f(gm * 100)} % · LTV / CAC ${ratio === null ? '—' : f(ratio, 1)} · besoin de financement ${short(need)}</span></span></summary>
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
const newSubs = (a, m) => m.newDirect.reduce((t, v) => t + v, 0) + m.products.reduce((t, q, j) => t + q.convertNew * Math.min(100, +a.programs[j]?.toSolo || 0) / 100, 0);
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
  const arr = htOf(m0, m0.directCA + m0.postCA) * 12;
  const prog12 = x.months.slice(Math.max(0, sm - 11), sm + 1).reduce((t, m) => t + htOf(m, m.products.reduce((s2, q) => s2 + q.sales, 0)), 0);
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
  const arrEnd = htOf(endM, endM.directCA + endM.postCA) * 12;
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
  return `<details class="card" id="${id}" ${view.open.has(id) ? 'open' : ''}><summary><span>Dossier de levée de ${esc(a.name)}<br><span class="sum-sub">${short(F.amount)} en ${monthName(F.month)} (le plan demande ${short(F.need)}) · ${num(n)} mois d'autonomie · ${num(+P.target)} nouvelles abonnées par an ${hit ? 'dès ' + monthName(hit.month) : 'non atteint'}</span></span></summary>
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
    const yms = x.months.filter(m => +m.month.slice(0, 4) === y1), subsM = yms.reduce((t, m) => t + m.direct + m.post, 0);
    const progSolo = yms.reduce((t, m) => t + m.products.reduce((u, q) => u + (q.admissions > 0 ? htOf(m, q.sales) * q.fromSolo / q.admissions : 0), 0), 0);
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
    const sensCard = `<details class="card" id="lv-sens" ${view.open.has('lv-sens') ? 'open' : ''}><summary><span>Si la publicité coûte plus ou moins cher<br><span class="sum-sub">${worst.length ? `ta levée ne suffit plus dès ${money(worst[0].c)} par abonnée` : `ta levée suffit jusqu'à ${money(cacs.at(-1))} par abonnée`}</span></span></summary>
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
  // Barres : pour chaque colonne, le CA (longueur de la barre) partagé entre coûts directs et contribution (ou résultat).
  const bars = cols.filter(c => !c.common);
  const key = view.app === 'all' ? 'result' : 'contribution', what = view.app === 'all' ? 'Résultat' : 'Contribution';
  const max = Math.max(1, ...bars.map(c => Math.max(c.v.ca || 0, Math.abs(c.v[key] || 0))));
  const barsHtml = bars.map(c => {
    const ca = c.v.ca || 0, v = c.v[key] || 0, cost = ca - v, w = x => (Math.max(0, x) / max * 100).toFixed(1);
    const coach = view.app !== 'all' && c.go.open !== 'sd' ? ` <small>(dont coaching ${money(c.v.coaching || 0)})</small>` : '';
    return `<div class="prod"><span>${link(c, esc(c.name))}${c.off ? ' <span class="tag">Inactif</span>' : ''}</span><span class="p-v"><small>${what}</small><b class="${v < 0 ? 'neg' : ''}">${money(v)}</b></span>
      <span class="meter split"><i style="width:${w(Math.min(cost, ca))}%;background:var(--sage-soft)"></i><i style="width:${w(v)}%;background:var(--good)"></i>${v < 0 ? `<i style="width:${w(-v)}%;background:var(--bad)"></i>` : ''}</span>
      <span class="p-d"><span><small>CA</small>${money(ca)}</span><span><small>Coûts directs</small>${money(cost)}${coach}</span><span><small>Marge</small><b class="${v < 0 ? 'neg' : ''}">${ca ? Math.round(v / ca * 100) : 0} %</b></span></span></div>`;
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
    <details class="card" id="r-bars" ${view.open.has('r-bars') ? 'open' : ''}><summary>${view.app === 'all' ? 'Résultat par application' : 'Contribution par produit'}</summary>
        <div class="legend"><span><i style="background:var(--sage-soft)"></i>Coûts directs</span><span><i style="background:var(--good)"></i>${view.app === 'all' ? 'Résultat' : 'Contribution (marge)'}</span><span>Barre entière = CA</span></div>
        <div>${barsHtml}</div>
        <p class="muted">${view.app === 'all' ? 'Résultat = CA − toutes les charges de l\'application, structure comprise.' : 'Contribution = CA − coûts directs du produit (paiement, coûts par cliente, coaching payé, charges rattachées). Les charges communes et la structure se déduisent ensuite.'}</p></details>
    <details class="card" id="r-table" ${view.open.has('r-table') ? 'open' : ''}><summary>Compte d'exploitation ${view.app === 'all' ? 'par application' : 'par produit'}</summary><p class="muted">Touche le nom d'${view.app === 'all' ? 'une application' : 'un produit'} pour ouvrir ses réglages.</p>${tableHtml}</details>
    ${natureCard(r)}
    ${implantCard(r)}
    <details class="card" id="r-read"><summary>Comment lire ce compte</summary>
        <p class="muted">La <b>contribution</b> d'un produit, c'est ce qu'il rapporte une fois payés ses propres coûts : frais de paiement, coûts par cliente, coaching et charges fixes qui lui sont rattachées.
        Les charges communes de l'application et la quote-part de structure Om Holistic sont ensuite déduites pour obtenir le <b>résultat d'exploitation</b>, avant impôts et cotisations personnelles.</p></details>
    ${printButton()}`;
}

// ---------- Rendu ----------

// Titre du bandeau : « Om Holistic – nom de la page », pour savoir où l'on est.
function renderTitle() {
  const h = document.querySelector('.head h1'), link = document.querySelector(`#tabs a[href="#${view.page}"] .l`);
  if (h) h.innerHTML = `Om Holistic${link ? `<span class="pg"> – ${esc(link.textContent)}</span>` : ''}`;
  document.title = `Om Holistic${link ? ' – ' + link.textContent : ''}`;
}
function renderToolbar() {
  renderTitle();
  const settings = SETTINGS_PAGES.includes(view.page), levee = view.page === 'levee';
  if ((settings || levee) && view.app === 'all') view.app = String(Math.max(0, state.apps.findIndex(a => a.raisePlan?.on)));
  if (levee) {
    $('app').innerHTML = state.apps.map((a, i) => `<option value="${i}">${esc(a.name)}</option>`).join('');
    $('app').value = view.app;
    document.querySelectorAll('.period-only').forEach(el => { el.hidden = true; });
    document.querySelectorAll('#tabs a').forEach(a => a.classList.toggle('current', a.hash === '#' + view.page));
    return;
  }
  $('app').innerHTML = (settings ? '' : '<option value="all">Om Holistic · consolidé</option>')
    + state.apps.map((a, i) => `<option value="${i}">${esc(a.name)}</option>`
      + (!settings || view.page === 'charges' ? (a.raisePlan?.on ? `<option value="${i}+">${esc(a.name)} · avec levée</option>` : '') : '')).join('');
  if (view.plan === 'avec' && (view.app === 'all' || !state.apps[+view.app]?.raisePlan?.on || (settings && view.page !== 'charges'))) view.plan = 'sans';
  $('app').value = view.app + (view.plan === 'avec' ? '+' : '');
  document.querySelectorAll('.period-only').forEach(el => { el.hidden = settings && view.page !== 'charges'; });
  const y0 = Math.min(...state.apps.map(a => +appStart(a).slice(0, 4))), y1 = Math.max(HORIZON_END, ...state.apps.map(a => +appStart(a).slice(0, 4) + 5));
  const years = []; for (let y = y0; y <= y1; y++) years.push(y);
  if (!years.includes(view.year)) view.year = years[0];
  $('year').innerHTML = years.map(y => `<option>${y}</option>`).join('');
  $('year').value = view.year;
  $('period').value = view.period;
  $('year').disabled = String(view.period) === '7';
  document.querySelectorAll('#tabs a').forEach(a => a.classList.toggle('current', a.hash === '#' + view.page));
}

// Pub automatique : pour chaque produit qui le demande, les campagnes sont recalculées depuis l'objectif
// (objectif − sans pub − passerelles = à combler, × coût d'une cliente). Le calcul n'est refait que si
// un réglage qui compte a changé : abonnement d'abord, puis programmes (leurs passerelles en dépendent).
const autoKeys = new Map();
const isAuto = q => !!q.goal && (q.goal.auto ?? !(q.campaigns || []).length);
function syncAutoCampaigns() {
  let changed = false;
  state.apps.forEach(a => {
    const prods = [[a.sub, null], ...a.programs.map((q, j) => [q, j])];
    for (const [q] of prods) if (q.goal && q.goal.auto === undefined) q.goal.auto = isAuto(q);
    const key = JSON.stringify({ ...a, charges: null, sub: { ...a.sub, campaigns: a.sub.goal?.auto ? null : a.sub.campaigns }, programs: a.programs.map(q => ({ ...q, campaigns: q.goal?.auto ? null : q.campaigns })) });
    if (autoKeys.get(a) === key) return;
    for (const [q, j] of prods) {
      if (!q.goal?.auto || (j !== null && !q.enabled)) continue;
      const plan = pubGap(a, j), next = plan ? plan.campaigns.map(c => ({ ...c })) : [];
      if (JSON.stringify(next) !== JSON.stringify(q.campaigns || [])) { q.campaigns = next; changed = true; }
    }
    autoKeys.set(a, key);
  });
  if (changed) { gapCache.clear(); save(); }
}
function render(fresh = false) {
  syncAutoCampaigns();
  if (fresh) { pickOpen = null; view.chEdit = null; }
  const boxTop = document.querySelector('.modal-box')?.scrollTop || 0;
  // Garde ouvertes les zones dépliées, sauf en arrivant sur une nouvelle page.
  view.open = view.goto ? new Set([view.goto.open, view.goto.anchor]) : fresh ? new Set() : new Set([...document.querySelectorAll('#page details[open]')].map(d => d.id));
  renderToolbar();
  const i = +view.app || 0, a = state.apps[i];
  const pages = { notoriete: () => notorietePage(a, i), acquisition: () => acquisitionPage(a, i), calendrier: () => calendarPage(a, i), synthese: synthesePage, utilisatrices: usersPage, coaching: coachingPage, resultat: resultatPage, previsionnel: previsionnelPage, tresorerie: tresoreriePage, levee: leveePage, charges: () => chargesPage(a, i), produits: () => productsPage(a, i), reglages: () => settingsPage(a, i) };
  const due = backupDue();
  $('page').innerHTML = (newVersion ? '<button class="update-strip" id="updateApp">Nouvelle version de l\'appli disponible · touche ici pour la charger</button>' : '') + syncStrip() + (due && view.page !== 'reglages' ? `<a class="backup-strip" href="#reglages" data-goto="reglages" data-open="st-save" data-anchor="st-save">${due} · exporte tes paramètres ›</a>` : '') + pages[view.page]();
  // Fenêtre ouverte : la page derrière ne défile pas, et la fenêtre garde sa position après chaque saisie.
  const box = document.querySelector('.modal-box');
  document.body.classList.toggle('modal-open', !!box);
  if (box) box.scrollTop = boxTop;
}

// Après un ajout ou une modification : on ouvre les blocs qui contiennent la charge (elle reste repliée) et on la montre.
function revealCharge(id) {
  const el = document.getElementById('ch' + id);
  if (!el) return;
  for (let d = el.parentElement && el.parentElement.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) d.open = true;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600);
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
// Échap ferme la fenêtre de charge sans rien changer.
document.addEventListener('keydown', e => { if (e.key === 'Escape' && view.chEdit) { view.chEdit = null; render(); } });
// Bandeau replié / déplié : mémorisé pour toutes les pages.

document.addEventListener('change', async e => {
  const t = e.target;
  const pick = t.closest?.('.monthpick'), palpick = t.closest?.('.palpick');
  if (t.dataset.growth) {
    const [o, k] = resolve(t.dataset.growth), q = o[k];
    q.palierMode = t.value === 'manual'; if (t.value !== 'manual') q.shape = t.value;
    if (q.palierMode && !q.paliers.length) q.paliers = [{ rate: Math.floor(+q.initial || 1), weeks: 26 }, { rate: Math.floor(+q.target || 1), weeks: 26 }];
    save(); render();
  } else if (palpick) {
    const [m, y] = [...palpick.querySelectorAll('select')].map(x => x.value);
    const [ai, old] = palpick.dataset.palmove.split('|');
    movePalier(state.apps[+ai], old, `${y}-${m}`);
    save(); render();
  } else if (t.dataset.pal) {
    const [ai, date, kind, j] = t.dataset.pal.split('|');
    setPalier(state.apps[+ai], date, kind, +j, Math.max(0, +t.value || 0));
    save();
    setTimeout(() => {
      const next = document.activeElement?.dataset?.pal;
      render();
      if (next) document.querySelector(`[data-pal="${CSS.escape(next)}"]`)?.focus({ preventScroll: true });
    }, 0);
  } else if (pick) {
    const [m, y] = [...pick.querySelectorAll('select')].map(x => x.value);
    if ((m && y) || (!m && !y)) {
      const [o, k] = resolve(pick.dataset.mpath);
      o[k] = m && y ? `${y}-${m}` : '';
      if (!isDraft(pick.dataset.mpath)) save();
      render();
    }
  } else if (t.dataset.actual) {
    const [ai, month, f] = t.dataset.actual.split('|'), a = state.apps[+ai];
    a.actuals = a.actuals || {};
    const cur = a.actuals[month] = a.actuals[month] || {};
    if (t.value === '') delete cur[f]; else cur[f] = Math.max(0, +t.value || 0);
    if (!Object.keys(cur).length) delete a.actuals[month];
    save(); render();
  } else if (t.dataset.usershow !== undefined) {
    if (t.checked) usersHidden.delete(t.dataset.usershow); else usersHidden.add(t.dataset.usershow);
    saveUsersHidden(); render();
  } else if (t.dataset.userall !== undefined) {
    if (t.checked) usersHidden.clear(); else userSeries(results()).forEach(x => usersHidden.add(x.key));
    saveUsersHidden(); render();
  } else if (t.dataset.acqshow !== undefined) {
    if (t.checked) acqHidden.delete(t.dataset.acqshow); else acqHidden.add(t.dataset.acqshow);
    saveAcqHidden(); render();
  } else if (t.dataset.acqall !== undefined) {
    const a0 = state.apps[+view.app || 0];
    if (t.checked) acqHidden.clear(); else ['sub', ...a0.programs.map(q => q.id)].forEach(k => acqHidden.add(k));
    saveAcqHidden(); render();
  } else if (t.dataset.calshow !== undefined) {
    if (t.checked) calHidden.delete(t.dataset.calshow); else calHidden.add(t.dataset.calshow);
    saveCalHidden(); render();
  } else if (t.dataset.calall !== undefined) {
    const a0 = state.apps[+view.app || 0];
    if (t.checked) calHidden.clear(); else ['sub', ':coach', ...a0.programs.map(q => q.id)].forEach(k => calHidden.add(k));
    saveCalHidden(); render();
  } else if (t.dataset.path) {
    const [o, k] = resolve(t.dataset.path);
    if (k === 'estimate_ok') o.estimate = t.type === 'checkbox' ? !t.checked : t.value !== 'ok';
    else if (t.dataset.path.includes('.actuals.') && t.value === '') delete o[k];
    else o[k] = t.type === 'checkbox' ? t.checked : t.type === 'number' ? (t.dataset.path.startsWith('scenarios.') ? Math.max(-100, +t.value || 0) : Math.max(0, +t.value || 0)) : t.value;
    if (isDraft(t.dataset.path)) { if (view.chEdit) view.chEdit.err = ''; } else save();
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
  else if (t.classList.contains('step-pick')) {
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
  // Fenêtre de choix (téléphone) : ouverture, fermeture par OK ou en touchant le fond.
  const po = e.target.closest?.('[data-pickopen]');
  if (po) { pickOpen = po.dataset.pickopen; po.closest('.picker').classList.add('open'); return; }
  const pc = e.target.closest?.('[data-pickclose]');
  if (pc && (e.target === pc || pc.classList.contains('pick-ok'))) { pickOpen = null; pc.closest('.picker')?.classList.remove('open'); return; }
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
      relays: () => relay('Nouveau relais', 5000, 0.2, thisMonth),
      points: () => { const l = [...o[k]].sort((x, y) => x.month.localeCompare(y.month)).at(-1); return l ? { month: addMonths(l.month, 12), n: Math.round((+l.n || 0) * 1.5) } : { month: thisMonth, n: 10 }; },
      promos: () => ({ start: thisMonth, end: thisMonth, price: 100 }),
      // Nouvelle campagne : elle prend la suite de la dernière, qui s'arrête alors le mois d'avant.
      campaigns: () => { const l = o[k][o[k].length - 1]; if (!l) return { start: [o.start || thisMonth, thisMonth].sort().at(-1), end: '', budget: 500, cac: 50 };
        const start = l.end ? addMonths(l.end, 1) : addMonths(l.start || thisMonth, 6); if (!l.end) l.end = addMonths(start, -1);
        return { start, end: '', budget: Math.round((+l.budget || 0) * 1.5), cac: +l.cac || 0 }; },
      capacitySteps: () => { const l = o[k][o[k].length - 1]; return { date: l ? addMonths(l.date || thisMonth, 6) : thisMonth, hours: l ? +l.hours || 0 : 10, hired: l ? +l.hired || 0 : 0 }; },
      coachSteps: () => { const l = o[k][o[k].length - 1]; return { date: l ? addMonths(l.date || thisMonth, 6) : addMonths(thisMonth, 6), minutes: Math.max(0, Math.round((l ? +l.minutes : +o.coach || 0) * 0.75)) }; },
      cohorts: () => ({ name: ['Cohorte alpha', 'Deuxième cohorte', 'Troisième cohorte'][o[k].length] || `Cohorte ${o[k].length + 1}`, date: thisMonth, size: 10 }),
      scenarios: () => ({ id: newId(), name: 'Nouveau scénario', fixedYear: 0, socialRate: 0, socialBase: 'result', taxRate: 0, taxBase: 'result', distRate: 0, note: '' }),
      charges: () => charge('Nouvelle charge', 'fixe', 0, 'app', '', '', { anchor: 'first' })
    }[k];
    o[k].push(fresh()); if (!isDraft(t.dataset.add)) save(); render();
  } else if (t.dataset.remove) {
    const [o, k] = resolve(t.dataset.remove);
    o.splice(+k, 1); if (!isDraft(t.dataset.remove)) save(); render();
  } else if (t.dataset.chadd) {
    // Nouvelle charge : un brouillon dans une fenêtre, type proposé selon le bloc (variable, fixe, structure).
    const [list, kind] = t.dataset.chadd.split('|');
    view.chEdit = { list, j: null, kind, err: '', c: charge('', kind === 'var' ? 'cliente' : 'fixe', '', 'app', '', '', { anchor: 'first', category: '' }) };
    render();
  } else if (t.dataset.chedit) {
    const keys = t.dataset.chedit.split('.'), j = +keys.pop(), list = keys.join('.');
    view.chEdit = { list, j, kind: list.startsWith('shared.') ? 'str' : '', err: '', c: JSON.parse(JSON.stringify(resolve(t.dataset.chedit)[0][j])) };
    render();
  } else if (t.dataset.chclose !== undefined && (e.target === t || t.tagName === 'BUTTON')) {
    view.chEdit = null; render();
  } else if (t.dataset.chsave !== undefined) {
    const ed = view.chEdit, c = ed.c;
    c.name = String(c.name || '').trim();
    ed.err = !c.name ? 'Donne un nom à la charge.' : !c.category ? 'Choisis une catégorie.' : '';
    if (ed.err) { render(); return; }
    if (c.type === 'unique') { c.end = ''; c.steps = []; }
    c.amount = +c.amount || 0;
    const [o, k] = resolve(ed.list + '.x'), list = o;
    if (ed.j === null) list.push(c); else list[ed.j] = c;
    view.chEdit = null; save(); render();
    revealCharge(c.id);
  } else if (t.dataset.removeApp) {
    state.apps.splice(+t.dataset.removeApp, 1); view.app = '0'; save(); render();
  } else if (t.id === 'reset') { view.confirmReset = true; render();
  } else if (t.id === 'resetNo') { view.confirmReset = false; render();
  } else if (t.dataset.paladd) {
    const [ai, month] = t.dataset.paladd.split('|');
    addPalier(state.apps[+ai], month);
    // Le nouveau palier s'ouvre, les autres gardent leur état.
    const keep = [...document.querySelectorAll('#page details[open]')].map(d => d.id);
    save(); render();
    const nd = document.getElementById(`pal-${ai}-${month}`);
    if (nd) { keep.forEach(k => document.getElementById(k)?.setAttribute('open', '')); nd.open = true; nd.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
  } else if (t.dataset.paldel) {
    const [ai, date] = t.dataset.paldel.split('|');
    removePalier(state.apps[+ai], date);
    save(); render();
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
    if (location.hash === '#coaching') route(); else location.hash = 'coaching';
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
    if (location.hash === '#coaching') route(); else location.hash = 'coaching';
  } else if (t.dataset.linkviv) {
    const [o, k] = resolve(t.dataset.linkviv), q = o[k], a = state.apps[+t.dataset.linkviv.split('.')[1]];
    const plan = audiencePlan(q.name || '', q === a.sub);
    Object.assign(q, { organic: true, palierMode: false, shape: 'brand' });
    if (!(+q.audienceRate > 0)) q.audienceRate = plan.rate;
    if (!(+q.audienceNew > 0)) q.audienceNew = plan.fresh;
    if (!t.closest('.step')) view.open.add('acq-brand');
    save(); render();
  } else if (t.dataset.prefill) {
    const a = state.apps[+t.dataset.prefill.split('.')[1]];
    prefillAudience(a); view.open.add('acq-brand');
    save(); render();
  } else if (t.dataset.pubgap) {
    const [o, k] = resolve(t.dataset.pubgap), q = o[k], a = state.apps[+t.dataset.pubgap.split('.')[1]];
    const plan = pubGap(a, q === a.sub ? null : a.programs.indexOf(q));
    if (plan) { q.campaigns = plan.campaigns.map(c => ({ ...c })); view.open.add(t.dataset.pubgap === `apps.${state.apps.indexOf(a)}.sub` ? 'acq-sd-pub' : 'acq-p' + a.programs.indexOf(q) + '-pub'); }
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

// Valeur d'un point ou d'une barre : on touche (iPhone, iPad) ou on survole (ordinateur), une bulle l'affiche. Même comportement sur tous les graphiques.
(() => {
  const tip = document.createElement('div'); tip.id = 'tip'; tip.hidden = true; document.body.appendChild(tip);
  let cur = null, y0 = 0;
  const hide = () => { tip.hidden = true; if (cur) cur.classList.remove('on'); cur = null; };
  const show = (el, x, y) => {
    if (cur !== el) { if (cur) cur.classList.remove('on'); cur = el; el.classList.add('on'); }
    tip.textContent = el.dataset.tip; tip.hidden = false; y0 = window.scrollY;
    const w = tip.offsetWidth, h = tip.offsetHeight, vw = document.documentElement.clientWidth;
    tip.style.left = Math.max(8, Math.min(vw - w - 8, x - w / 2)) + 'px';
    tip.style.top = Math.max(8, y - h - 14) + 'px';
  };
  const at = e => { const el = e.target.closest && e.target.closest('svg [data-tip]'); if (!el) return null; const b = el.getBoundingClientRect(); return { el, x: b.left + b.width / 2, y: b.top }; };
  document.addEventListener('click', e => { const t = at(e); if (t) show(t.el, t.x, t.y); else hide(); }, true);
  window.addEventListener('scroll', () => { if (cur && Math.abs(window.scrollY - y0) > 30) hide(); }, { passive: true });
  let touch = false;
  document.addEventListener('pointerdown', e => { touch = e.pointerType !== 'mouse'; }, true);
  document.addEventListener('mouseover', e => { if (touch) return; const t = at(e); if (t) show(t.el, t.x, t.y); else if (cur) hide(); });
})();

// Menu vertical du téléphone : le bouton en haut à gauche ouvre le volet, un choix ou un appui à côté le referme.
(() => {
  const btn = document.getElementById('menuBtn'), shade = document.getElementById('menuShade');
  if (!btn) return;
  const set = open => {
    document.body.classList.toggle('menu-open', open);
    shade.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.setAttribute('aria-label', open ? 'Fermer le menu' : 'Ouvrir le menu');
  };
  btn.addEventListener('click', () => set(!document.body.classList.contains('menu-open')));
  shade.addEventListener('click', () => set(false));
  document.getElementById('tabs').addEventListener('click', e => { if (e.target.closest('a')) set(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') set(false); });
  window.addEventListener('hashchange', () => set(false));
})();

// Téléphone : en-tête, sélecteurs et bandeau de la page restent en haut. On mesure leur hauteur réelle.
(() => {
  const set = () => {
    const h = document.querySelector('header'), t = document.querySelector('.toolbar');
    if (h) document.documentElement.style.setProperty('--hdr-h', h.offsetHeight + 'px');
    if (t) document.documentElement.style.setProperty('--tb-h', t.offsetHeight + 'px');
  };
  window.addEventListener('resize', set);
  new MutationObserver(set).observe(document.getElementById('page') || document.body, { childList: true });
  set();
})();

// Page précédente / page suivante, comme dans un navigateur. Chaque page visitée reçoit un numéro dans l'historique :
// « Précédent » est actif s'il y a une page avant, « Suivant » seulement après un retour en arrière.
(() => {
  const back = document.getElementById('navBack'), fwd = document.getElementById('navFwd');
  if (!back || !fwd) return;
  const load = k => { try { const v = sessionStorage.getItem(k); return v === null ? null : +v; } catch { return null; } };
  const save = (k, v) => { try { sessionStorage.setItem(k, String(v)); } catch { /* stockage indisponible */ } };
  let idx = null, top = load('om-nav-top');
  const sync = () => {
    const st = window.history.state;
    if (st && Number.isInteger(st.navI)) idx = st.navI;
    else {
      // Nouvelle page ouverte (lien, menu) : elle se place après la page en cours et efface les pages « suivantes ».
      // Au premier chargement, on reprend la position mémorisée (rechargement pour une nouvelle version).
      idx = idx === null ? (load('om-nav-i') ?? 0) : idx + 1;
      top = idx;
      window.history.replaceState({ ...(st || {}), navI: idx }, '');
    }
    if (top === null || top < idx) top = idx;
    save('om-nav-i', idx); save('om-nav-top', top);
    back.disabled = idx <= 0;
    fwd.disabled = idx >= top;
  };
  back.addEventListener('click', () => { if (!back.disabled) window.history.back(); });
  fwd.addEventListener('click', () => { if (!fwd.disabled) window.history.forward(); });
  window.addEventListener('hashchange', sync);
  window.addEventListener('popstate', sync);
  sync();

  // Appli installée sur l'écran d'accueil (iPhone, iPad) : le glissement depuis le bord gauche revient en arrière,
  // depuis le bord droit va à la page suivante. Dans Safari, le navigateur le fait déjà lui-même.
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  if (!standalone) return;
  let sx = 0, sy = 0, edge = 0;
  document.addEventListener('touchstart', e => {
    const t = e.touches[0];
    edge = e.touches.length === 1 && !document.body.classList.contains('menu-open') && !document.body.classList.contains('modal-open')
      ? (t.clientX < 24 ? -1 : t.clientX > innerWidth - 24 ? 1 : 0) : 0;
    sx = t.clientX; sy = t.clientY;
  }, { passive: true });
  document.addEventListener('touchend', e => {
    if (!edge) return;
    const t = e.changedTouches[0], dx = t.clientX - sx, dy = Math.abs(t.clientY - sy);
    if (dy < 50 && edge < 0 && dx > 70 && !back.disabled) window.history.back();
    if (dy < 50 && edge > 0 && dx < -70 && !fwd.disabled) window.history.forward();
    edge = 0;
  }, { passive: true });
})();

