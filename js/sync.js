'use strict';
// Synchronisation entre appareils (iPhone, iPad, ordinateur).
// Les paramètres sont chiffrés ici, avant d'être envoyés, avec une clé tirée de la phrase secrète.
// Le serveur ne reçoit qu'une boîte illisible, rangée sous un identifiant tiré de la même phrase :
// sans la phrase, on ne peut ni trouver la boîte ni la lire.

const SyncCrypto = (() => {
  const SALT = 'om-finances-synchro-v1';
  const ROUNDS = 200000;
  const subtle = () => globalThis.crypto.subtle;
  const enc = new TextEncoder(), dec = new TextDecoder();
  const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  const unhex = h => new Uint8Array(h.match(/../g).map(x => parseInt(x, 16)));
  const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  // Même phrase, même résultat sur tous les appareils : espaces de bord et forme Unicode normalisés.
  const norm = p => String(p || '').normalize('NFC').trim();

  // Phrase → clé de chiffrement, identifiant de la boîte et jeton d'écriture (trois morceaux indépendants).
  async function derive(phrase) {
    const base = await subtle().importKey('raw', enc.encode(norm(phrase)), 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(await subtle().deriveBits({ name: 'PBKDF2', salt: enc.encode(SALT), iterations: ROUNDS, hash: 'SHA-256' }, base, 768));
    return { key: hex(bits.slice(0, 32)), id: hex(bits.slice(32, 64)), token: hex(bits.slice(64, 96)) };
  }
  const aes = k => subtle().importKey('raw', unhex(k), 'AES-GCM', false, ['encrypt', 'decrypt']);
  async function seal(key, obj) {
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, await aes(key), enc.encode(JSON.stringify(obj))));
    const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
    return 'v1:' + b64(out);
  }
  async function open(key, box) {
    if (typeof box !== 'string' || !box.startsWith('v1:')) throw Error('format inconnu');
    const raw = unb64(box.slice(3));
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, await aes(key), raw.slice(12));
    return JSON.parse(dec.decode(pt));
  }
  return { derive, seal, open, norm };
})();

const Sync = (() => {
  const KEY = 'om-sync';
  const URL_DEFAULT = 'https://om-holistic-finances-sync.fly.dev';
  let conf = null, hooks = null, timer = null, busy = false, again = false, listening = false;
  // Statut affiché : off, ok, pending (envoi à faire), offline, conflict, error.
  const status = { state: 'off', msg: '', remote: null };

  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
  const store = () => { try { if (conf) localStorage.setItem(KEY, JSON.stringify(conf)); else localStorage.removeItem(KEY); } catch { /* stockage indisponible */ } };
  const device = () => { const u = navigator.userAgent || ''; return /iPad|Macintosh/.test(u) && navigator.maxTouchPoints > 1 ? 'iPad' : /iPhone/.test(u) ? 'iPhone' : /Android/.test(u) ? 'téléphone' : 'ordinateur'; };
  const set = (state, msg = '', remote = status.remote) => {
    const changed = state !== status.state || remote !== status.remote;
    Object.assign(status, { state, msg, remote });
    if (hooks) hooks.onStatus(changed);
  };

  async function call(method, body) {
    const r = await fetch(`${conf.url}/v1/box/${conf.id}`, {
      method, cache: 'no-store', keepalive: method === 'PUT',
      headers: body ? { 'Content-Type': 'application/json', 'X-Sync-Token': conf.token } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await r.json().catch(() => ({}));
    return { code: r.status, data };
  }
  // Une version arrivée du serveur : on la déchiffre et on garde de quoi l'afficher.
  async function unpack(d) {
    const x = await SyncCrypto.open(conf.key, d.data);
    return { v: d.v, at: d.at, device: x.device, state: x.state };
  }
  function apply(remote) {
    if (!hooks.apply(remote.state)) { set('error', 'La version en ligne est illisible par cette version de l\'appli. Recharge la page.'); return; }
    conf.v = remote.v; conf.dirty = false; conf.at = new Date().toISOString(); store();
    set('ok', '', null);
  }

  async function push() {
    if (!conf || !conf.dirty) return;
    if (busy) { again = true; return; }
    busy = true;
    try {
      const data = await SyncCrypto.seal(conf.key, { state: hooks.state(), device: device(), savedAt: new Date().toISOString() });
      const r = await call('PUT', { base: conf.v, data });
      if (r.code === 200) { conf.v = r.data.v; conf.dirty = false; conf.at = r.data.at; store(); set('ok', '', null); }
      else if (r.code === 409) set('conflict', '', await unpack(r.data));
      else if (r.code === 403) set('error', 'Le serveur refuse l\'envoi : la phrase secrète ne correspond pas.');
      else set('offline', 'Serveur indisponible, nouvel essai à la prochaine modification.');
    } catch { set('offline', 'Hors ligne : tes modifications partiront dès le retour du réseau.'); }
    finally { busy = false; if (again) { again = false; push(); } }
  }

  async function pull() {
    if (!conf || busy || status.state === 'conflict') return;
    try {
      const r = await call('GET');
      if (r.code === 404) { conf.v = 0; conf.dirty = true; store(); return push(); }
      if (r.code !== 200) return set('offline', 'Serveur indisponible pour le moment.');
      if (r.data.v === conf.v) return conf.dirty ? push() : set('ok', '', null);
      const remote = await unpack(r.data);
      if (conf.dirty) set('conflict', '', remote); else apply(remote);
    } catch { set('offline', 'Hors ligne : la synchro reprendra au retour du réseau.'); }
  }

  // Retour sur l'appli : on récupère la dernière version. Départ : on envoie ce qui reste.
  function listen() {
    if (listening) return;
    listening = true;
    document.addEventListener('visibilitychange', () => { if (!conf) return; if (document.visibilityState === 'visible') pull(); else push(); });
    window.addEventListener('online', () => { if (conf) pull(); });
  }

  return {
    status,
    get on() { return !!conf; },
    get at() { return conf && conf.at; },
    init(h) {
      hooks = h; conf = load();
      if (!conf) return;
      set(conf.dirty ? 'pending' : 'ok');
      listen(); pull();
    },
    // Appelé à chaque modification : on envoie un peu après, pour regrouper les frappes.
    changed() {
      if (!conf) return;
      conf.dirty = true; store();
      if (status.state !== 'conflict') set('pending');
      clearTimeout(timer); timer = setTimeout(push, 1500);
    },
    now: () => (conf && conf.dirty ? push() : pull()),
    // Première activation sur cet appareil. edited : des paramètres ont déjà été modifiés ici.
    async enable(phrase, edited) {
      if (SyncCrypto.norm(phrase).length < 12) throw Error('Choisis une phrase d\'au moins 12 caractères, par exemple quatre mots que tu retiens.');
      const k = await SyncCrypto.derive(phrase);
      const prev = conf;
      conf = { url: URL_DEFAULT, ...k, v: 0, dirty: false, at: null };
      let r;
      try { r = await call('GET'); } catch { conf = prev; throw Error('Impossible de joindre le serveur de synchro. Vérifie ta connexion et réessaie.'); }
      if (r.code === 404) { conf.dirty = true; store(); await push(); }
      else if (r.code === 200) {
        let remote;
        try { remote = await unpack(r.data); } catch { conf = prev; throw Error('La version en ligne n\'a pas pu être ouverte.'); }
        store();
        if (edited) { conf.dirty = true; store(); set('conflict', '', remote); } else apply(remote);
      } else { conf = prev; throw Error('Le serveur de synchro ne répond pas correctement pour le moment.'); }
      listen();
    },
    // Conflit : garder la version de cet appareil (elle remplace celle en ligne) ou prendre celle en ligne.
    keep(which) {
      const remote = status.remote;
      if (!remote) return;
      if (which === 'theirs') apply(remote);
      else { conf.v = remote.v; conf.dirty = true; store(); set('pending', '', null); push(); }
    },
    disable() { conf = null; store(); set('off', '', null); }
  };
})();

if (typeof module !== 'undefined') module.exports = { SyncCrypto };
