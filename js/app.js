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
  const insSummary = `${q.launch ? `${num(q.launchRate)} / sem. pendant ${num(q.launchWeeks)} sem., puis ` : ''}${num(q.initial)} → ${num(q.target)} / sem.`;
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

function productsPage(a, i) {
  const p = 'apps.' + i;
  const g = a.sub.directPricing;
  // Le produit « seul » : l'abonnement, avec en option ce qui se passe après un programme.
  const solo = `<details class="card product solo" id="sd" ${view.open.has('sd') ? 'open' : ''}><summary><span>${esc(soloName(a))}<br><span class="sum-sub">Abonnement mensuel · ${price(phaseAt(g, thisMonth).price)} · ${a.sub.start ? 'ouverture ' + monthName(a.sub.start) : 'pas encore ouvert'}</span></span></summary>
      ${check('Les abonnées gardent le prix de la phase où elles se sont abonnées', p + '.sub.lockPrice', a.sub.lockPrice)}
      ${section('open-sd', 'cal', 'Ouverture et rythme d\'abonnements', `${a.sub.start ? monthName(a.sub.start) : '—'} · ${num(a.sub.initial)} → ${num(a.sub.target)} / sem.`, `${fields(a.sub, p + '.sub', [['start', 'Ouverture des abonnements', 'month'], ...growth, ['duration', 'Durée moyenne d\'abonnement (mois)']])}
        <p class="muted">0 mois = aucune résiliation. Sinon résiliation mensuelle = 1 / durée.</p>`)}
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
    ${solo}${programs}
    <div class="row"><button data-add="${p}.programs">Ajouter un programme</button></div>`;
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
  (a.capacitySteps || []).forEach(c => c.date && items.push({ date: c.date, kind: 'cap', text: 'Capacité de coaching', sub: `${num(c.capacity)} clientes · ${num(c.hours)} h / semaine`, go: { page: 'reglages', open: 'st-cap', anchor: 'st-cap', from: 'Réglages › Capacité de coaching' } }));
  items.sort((x, y) => x.date.localeCompare(y.date));
  if (!items.length) return '<p class="muted">Aucune date pour l\'instant : ajoute une cohorte de test ou une date de lancement dans Produits et prix.</p>';
  return `<ol class="timeline">${items.map(it => `<li class="${it.kind}"><a href="#${it.go.page}" data-goto="${it.go.page}" data-open="${it.go.open}" data-anchor="${it.go.anchor}">
      <span class="when">${monthName(it.date)}</span><span class="what">${it.text}${it.sub ? ` · <span class="muted">${it.sub}</span>` : ''}<span class="from">${it.go.from} ›</span></span></a></li>`).join('')}</ol>`;
}

function settingsPage(a, i) {
  const p = 'apps.' + i;
  const steps = (a.capacitySteps || []).map((c, j) => lineEditor(c, `${p}.capacitySteps.${j}`, [['date', 'À partir de', 'month'], ['capacity', 'Clientes en même temps'], ['hours', 'Heures / semaine']], 'Retirer ce palier')).join('');
  return `<h2>${esc(a.name)}</h2>
    <div class="card">${fields(a, p, [['name', 'Nom de l\'application', 'text']])}</div>
    <details class="card" id="st-cal" ${view.open.has('st-cal') || !view.open.size ? 'open' : ''}><summary>Calendrier de ${esc(a.name)}</summary>
      <p class="muted">Ce calendrier ne se saisit pas ici : il rassemble les dates que tu as saisies dans chaque programme, chaque abonnement et la capacité. Touche une date pour aller la modifier. Les prévisions commencent à la première date.</p>
      ${timeline(a)}</details>
    ${a.programs.length ? `<details class="card" id="st-cap" ${view.open.has('st-cap') ? 'open' : ''}><summary>Capacité de coaching</summary>
      <p class="muted">Ajoute un palier à chaque fois que tu peux accompagner plus de clientes : par exemple 10 pendant la cohorte alpha, 25 au lancement, 40 un an plus tard.</p>
      ${steps || '<p class="muted">Aucun palier : capacité illimitée.</p>'}
      <div class="row"><button data-add="${p}.capacitySteps">Ajouter un palier de capacité</button></div>
      ${check('Refuser les inscriptions au-delà de la capacité', p + '.restrict', a.restrict)}
      ${a.restrict ? check('Mettre les inscriptions refusées en liste d\'attente', p + '.waitlist', a.waitlist) : ''}</details>` : ''}
    <details class="card" id="st-where"><summary>Où régler le reste</summary>
      <ul class="where">
        <li><a href="#produits">Produits et prix</a> : cohortes de test, date de lancement, durée, prix en 3 phases, rythme d'inscriptions, promotions, passerelles entre programmes et abonnement, période d'essai.</li>
        <li><a href="#charges">Charges</a> : charges de l'application, coût du coaching, charges de structure Om Holistic.</li>
        <li>Ci-dessous : TVA, ajout d'une application, export et import.</li>
      </ul></details>
    ${state.apps.length > 1 ? `<div class="row"><button class="danger" data-remove-app="${i}">Supprimer l'application ${esc(a.name)}</button></div>` : ''}
    <h2>Toutes les applications</h2>
    <div class="card">
    ${check('Mes prix sont saisis TTC (le compte d\'exploitation les convertit en HT)', 'vat.ttc', state.vat.ttc)}
    ${state.vat.ttc ? fields(state.vat, 'vat', [['rate', 'Taux de TVA (%)']]) : ''}
    <div class="row"><button id="addApp">Ajouter une application</button><button id="export">Exporter les paramètres</button>
    <label class="file">Importer des paramètres<input id="import" type="file" accept=".json"></label></div>
    <p id="importMsg" class="warn"></p>
    <div class="row">${view.confirmReset ? '<button class="danger" id="resetYes">Oui, tout remplacer par les exemples</button><button id="resetNo">Annuler</button>' : '<button class="danger" id="reset">Revenir aux valeurs d\'exemple</button>'}</div></div>`;
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
    lines.push({ name: esc(soloName(a)), color: 'var(--clay)', ca: ms.reduce((s, m) => s + m.directCA + m.postCA, 0),
      detail: a.programs.length ? `${num(direct + post)} abonnées en fin de période, dont ${num(post)} après un programme` : `${num(direct)} abonnées en fin de période` });
    a.programs.forEach((p, i) => lines.push({ name: esc(progName(a, p)), off: !p.enabled, color: 'var(--sage)', ca: ms.reduce((s, m) => s + m.products[i].sales, 0),
      detail: `${num(ms.reduce((s, m) => s + m.products[i].admissions, 0))} inscriptions · ${num(last?.products[i].active || 0)} en cours en fin de période` }));
  }
  const max = Math.max(1, ...lines.map(l => l.ca));
  return lines.map(l => `<div class="prod"><span>${l.name}${l.off ? ' <span class="tag">Inactif</span>' : ''}</span><b>${money(l.ca)}</b>
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
  const heads = ['Mois', 'Programmes', 'Abo. direct', 'Abo. après prog.', 'CA', 'Charges', 'Résultat', 'En programme', 'Abonnées'];
  const line = m => [m.month, money(m.sales), money(m.directCA), money(m.postCA), `<b>${money(m.total)}</b>`, money(m.cost), signed(m.net), num(m.active), num(m.direct + m.post)];
  // Un bloc dépliable par trimestre, avec son total en en-tête.
  const quarters = new Map();
  for (const m of r.byMonth) { const q = m.month.slice(0, 4) + ' · T' + Math.ceil(+m.month.slice(5) / 3); (quarters.get(q) || quarters.set(q, []).get(q)).push(m); }
  const blocks = [...quarters].map(([q, ms], i) => {
    const s = f => ms.reduce((t, m) => t + m[f], 0);
    const tot = { month: 'Total', sales: s('sales'), directCA: s('directCA'), postCA: s('postCA'), total: s('total'), cost: s('cost'), net: s('net'), active: ms.at(-1).active, direct: ms.at(-1).direct, post: ms.at(-1).post };
    const id = 'q' + q.replace(/\W/g, '');
    const open = view.open.has(id) || (!view.open.size && i === 0) ? 'open' : '';
    return `<details class="card" id="${id}" ${open}><summary>${q}<span class="sum-sub">${money(tot.total)} · résultat ${money(tot.net)}</span></summary>
      <div class="scroll"><table>${table(heads, [...ms.map(line), line(tot)], [...ms.map(() => ''), 'total'])}</table></div></details>`;
  }).join('');
  return `<h2>Prévisions mois par mois</h2>${blocks}
    <details class="card" id="pv-prod"><summary>Par produit</summary><div>${productLines(r)}</div></details>
    ${r.scope.some(x => x.a.programs.length) ? capacityBlock(r) : ''}`;
}

function capacityBlock(r) {
  const wr = r.scope.flatMap(x => x.weekly.filter(w => inPeriod(w.date.slice(0, 7))).map(w => ({ ...w, name: x.a.name })));
  const over = wr.filter(w => w.people > w.cap || w.hours > w.limit).length;
  return `<h2>Capacité de coaching</h2><div class="kpis">
      <div class="kpi"><small>Pic de clientes en même temps</small><b>${num(Math.max(0, ...wr.map(w => w.people)))}</b></div>
      <div class="kpi"><small>Pic d'heures de coaching / semaine</small><b>${Math.max(0, ...wr.map(w => w.hours)).toFixed(1)} h</b></div>
      <div class="kpi"><small>Semaines au-dessus de la capacité</small><b class="${over ? 'bad' : 'good'}">${over}</b></div>
      <div class="kpi"><small>En attente en fin de période</small><b>${num(wr.at(-1)?.waiting || 0)}</b></div>
    </div>
    <details class="card" id="c-weeks"><summary>Capacité semaine par semaine</summary>
      <div class="scroll"><table>${table(['Semaine', 'Application', 'Demande', 'Inscriptions', 'En cours', 'Capacité', 'Heures', 'En attente'],
        wr.map(w => [w.date, esc(w.name), w.demand, w.admitted, w.people, w.cap === Infinity ? '—' : w.cap, w.hours.toFixed(1) + (w.limit === Infinity ? '' : ' / ' + w.limit), w.waiting]))}</table></div></details>`;
}

// ---------- Charges ----------

const CHARGE_TYPES = [['fixe', 'Fixe, par mois'], ['cliente', 'Par cliente active, par mois'], ['inscription', 'Par inscription à un programme'], ['ca', 'Pourcentage du chiffre d\'affaires']];
const AMOUNT_LABEL = { fixe: 'Montant (€ / mois)', cliente: 'Montant (€ / cliente / mois)', inscription: 'Montant (€ / inscription)', ca: 'Pourcentage (%)' };
function chargeSummary(c, a) {
  const prog = a.programs.find(p => p.id === c.scope);
  const scope = c.scope === 'sub' ? soloName(a) : prog ? progName(a, prog) : 'Commune à ' + a.name;
  const amount = c.type === 'ca' ? `${price(c.amount).replace('\u00a0€', '')} % du CA` : `${price(c.amount)}${{ fixe: ' / mois', cliente: ' / cliente / mois', inscription: ' / inscription' }[c.type]}`;
  const when = c.start || c.end ? ` · ${c.start ? monthName(c.start) : '…'} → ${c.end ? monthName(c.end) : '…'}` : '';
  return `${amount} · ${esc(scope)}${when}`;
}

function chargesPage(a, i) {
  const p = 'apps.' + i;
  const scopes = [['app', 'Commune à tous les produits ' + a.name], ['sub', soloName(a)], ...a.programs.map(q => [q.id, progName(a, q)])];
  const list = (a.charges || []).map((c, j) => {
    const t = `${p}.charges.${j}`, id = 'ch' + c.id;
    return `<details class="card" id="${id}" ${view.open.has(id) ? 'open' : ''}><summary><span>${esc(c.name)}<br><span class="sum-sub">${chargeSummary(c, a)}</span></span></summary>
      ${fields(c, t, [['name', 'Nom', 'text']])}
      <div class="grid">${select('Type', t + '.type', c.type, CHARGE_TYPES)}${field(AMOUNT_LABEL[c.type] || 'Montant', t + '.amount', c.amount)}</div>
      ${select('Rattachée à', t + '.scope', c.scope || 'app', scopes)}
      ${periodEditor(c, t)}
      <div class="row"><button class="danger" data-remove="${t}">Supprimer la charge</button></div></details>`;
  }).join('');
  const sh = state.shared;
  const shared = sh.charges.map((c, j) => {
    const t = `shared.charges.${j}`, id = 'sh' + c.id;
    return `<details class="card" id="${id}" ${view.open.has(id) ? 'open' : ''}><summary><span>${esc(c.name)}<br><span class="sum-sub">${price(c.amount)} / mois</span></span></summary>
      ${fields(c, t, [['name', 'Nom', 'text'], ['amount', 'Montant (€ / mois)']])}
      ${periodEditor(c, t)}
      <div class="row"><button class="danger" data-remove="${t}">Supprimer la charge</button></div></details>`;
  }).join('');
  return `<h2>Charges de ${esc(a.name)}</h2>
    <p class="muted">Rattache chaque charge au produit qui la provoque pour voir sa vraie rentabilité. Une charge commune reste dans la colonne « Commun ».
    Un pourcentage, un coût par cliente ou par inscription commun est réparti exactement entre les produits.</p>
    ${list || '<p class="muted">Aucune charge.</p>'}
    <div class="row"><button data-add="${p}.charges">Ajouter une charge</button></div>
    ${a.programs.length ? `<div class="card">${fields(a, p, [['coachRate', 'Coût du coaching (€ / heure)']])}
      <p class="muted">Multiplié par les heures de coaching de chaque programme (minutes par cliente et par semaine, dans Produits). Laisse 0 si tu coaches toi-même et ne te rémunères pas à l'heure.</p></div>` : ''}
    <h2>Charges de structure Om Holistic</h2>
    <p class="muted">Charges communes à toutes les applications (comptable, banque, assurance…), réparties entre elles.</p>
    <div class="card">${select('Répartition entre les applications', 'shared.key', sh.key, [['ca', 'Au prorata du chiffre d\'affaires'], ['egal', 'À parts égales']])}</div>
    ${shared}
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
    const cols = r.all.map(x => { const s = r.summary(x); return { name: x.a.name, v: { ...s.total, structure: s.structure } }; });
    const tot = {};
    for (const [k] of PNL_ROWS) tot[k] = cols.reduce((t, c) => t + c.v[k], 0);
    return { cols, total: tot };
  }
  const x = r.scope[0], s = r.summary(x);
  const cols = productKeys(x.a).map(k => ({ name: k.name, off: k.off, v: { ...(s.cols[k.key] || {}), structure: null, result: null } }));
  cols.push({ name: 'Commun', common: true, v: { ca: null, fees: null, variable: null, coaching: null, margin: null, fixed: s.commonFixed, contribution: -s.commonFixed, structure: s.structure, result: null } });
  return { cols, total: { ...s.total, structure: s.structure } };
}

function resultatPage() {
  const r = results();
  const { cols, total } = pnlColumns(r);
  const rate = total.ca ? total.result / total.ca * 100 : 0;
  const cell = (row, v) => v === null || v === undefined ? '<span class="muted">—</span>' : row[2] === 'cost' ? (v ? signed(-v) : money(0)) : row[2] === 'head' ? money(v) : `<b>${signed(v)}</b>`;
  const rows = PNL_ROWS.map(row => [row[1], ...cols.map(c => cell(row, c.v[row[0]])), cell(row, total[row[0]])]);
  const cls = PNL_ROWS.map(row => row[2] === 'total' ? 'total' : row[2] === 'sub' ? 'sub' : '');
  const tableHtml = `<div class="scroll"><table class="pnl">${table(['', ...cols.map(c => esc(c.name)), 'Total'], rows, cls)}</table></div>`;
  // Barres : chiffre d'affaires et contribution de chaque colonne.
  const bars = cols.filter(c => !c.common);
  const key = view.app === 'all' ? 'result' : 'contribution';
  const max = Math.max(1, ...bars.map(c => Math.max(c.v.ca || 0, Math.abs(c.v[key] || 0))));
  const barsHtml = bars.map(c => {
    const v = c.v[key] || 0;
    return `<div class="prod"><span>${esc(c.name)}${c.off ? ' <span class="tag">Inactif</span>' : ''}</span><b class="${v < 0 ? 'neg' : ''}">${money(v)}</b>
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
    <details class="card" id="r-table" open><summary>Compte d'exploitation ${view.app === 'all' ? 'par application' : 'par produit'}</summary>${tableHtml}</details>
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
    o[k] = t.type === 'checkbox' ? t.checked : t.type === 'number' ? Math.max(0, +t.value || 0) : t.value;
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
    if (location.hash === '#' + go.dataset.goto) route(); else location.hash = go.dataset.goto;
    return;
  }
  const t = e.target.closest?.('button') || e.target;
  if (t.dataset.add) {
    const [o, k] = resolve(t.dataset.add);
    const fresh = {
      programs: () => program('Nouveau programme', thisMonth, [100, 150, 200], 8),
      paliers: () => ({ rate: 2, weeks: 8 }),
      promos: () => ({ start: thisMonth, end: thisMonth, price: 100 }),
      capacitySteps: () => ({ date: thisMonth, capacity: 20, hours: 15 }),
      cohorts: () => ({ name: ['Cohorte alpha', 'Deuxième cohorte', 'Troisième cohorte'][o[k].length] || `Cohorte ${o[k].length + 1}`, date: thisMonth, size: 10 }),
      charges: () => charge('Nouvelle charge', 'fixe', 0)
    }[k];
    o[k].push(fresh()); save(); render();
  } else if (t.dataset.remove) {
    const [o, k] = resolve(t.dataset.remove);
    o.splice(+k, 1); save(); render();
  } else if (t.dataset.removeApp) {
    state.apps.splice(+t.dataset.removeApp, 1); view.app = '0'; save(); render();
  } else if (t.id === 'reset') { view.confirmReset = true; render();
  } else if (t.id === 'resetNo') { view.confirmReset = false; render();
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
