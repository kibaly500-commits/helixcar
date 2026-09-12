// ENVOI RÉEL DU DEVIS — exécute le VRAI code de la fonction serveur
// (supabase/functions/devis-secure/index.ts) contre un double Supabase
// en mémoire et un double du prestataire d'e-mail. Aucun réseau, aucune
// donnée réelle, aucun e-mail réel.
//
//   node tests/t_devis_securite.mjs
//
// LOT Q01. Ce que ce fichier prouve : le contrat serveur de l'envoi —
// identifiant canonique exigé, PDF figé, version, journal des envois
// (préparation / tentative / acceptée par le prestataire / échec),
// « envoyé » posé seulement après acceptation réelle du prestataire,
// renvoi explicite tracé, double clic sans second e-mail, verrou contre
// deux envois simultanés, version obsolète refusée, lien construit sur
// l'URL publique canonique, origines des deux domaines officiels.
import {
  traiterRequete, hasherToken, enTetesCors, preflightAcceptable, urlPubliqueSite,
  originesSupplementaires, echapperHtmlServeur,
} from '../supabase/functions/devis-secure/index.ts';

let pass = 0, fail = 0; const echecs = [];
function check(l, c, e) {
  if (c) { console.log('PASS - ' + l); pass++; }
  else { console.log('FAIL - ' + l + (e ? '  [' + String(e).slice(0, 300) + ']' : '')); fail++; echecs.push(l); }
}

const fs = await import('node:fs');
const racine = new URL('../', import.meta.url);
const lire = (rel) => fs.readFileSync(new URL(rel, racine), 'utf8');
const existe = (rel) => fs.existsSync(new URL(rel, racine));

const PROD = 'https://helixcar.vercel.app';
const APERCU = 'https://helixcar-i89b.vercel.app';

// Un PDF minimal mais VALIDE pour la fonction : en-tête %PDF-, plus de
// 1024 octets.
function pdfFictif() {
  const corps = '%PDF-1.4\n% TEST-QA-CLAUDE-HELIXCAR\n' + '0'.repeat(1500) + '\n%%EOF\n';
  return Buffer.from(corps, 'latin1').toString('base64');
}

const ID_DEVIS = 'd0d0d0d0-0000-4000-8000-000000000001';
const ID_CLIENT = 'c0c0c0c0-0000-4000-8000-000000000001';
const ID_ADMIN_USER = 'a0a0a0a0-0000-4000-8000-00000000ad01';

// ── Double Supabase : un mini PostgREST en mémoire ──────────
function creerDouble(etat) {
  const journal = { resend: [], majsDevis: [], insertsJournal: [], signatures: [], pdfs: {} };
  const tables = etat.tables;

  function table(nom) {
    const req = { filtres: [], tri: null, limite: null, op: 'select', valeurs: null };
    const lignes = () => {
      let out = (tables[nom] || []).filter(l => req.filtres.every(f => f(l)));
      if (req.tri) out = out.slice().sort((a, b) => ((a[req.tri.col] > b[req.tri.col]) ? 1 : -1) * (req.tri.asc ? 1 : -1));
      if (req.limite != null) out = out.slice(0, req.limite);
      return out;
    };
    function executer() {
      if (req.op === 'select') return { data: lignes().map(l => ({ ...l })), error: null };
      if (req.op === 'insert') {
        const l = { id: 'j-' + Math.random().toString(36).slice(2), created_at: new Date().toISOString(), ...req.valeurs };
        (tables[nom] = tables[nom] || []).push(l);
        if (nom === 'devis_envois') journal.insertsJournal.push({ ...l });
        return { data: [{ ...l }], error: null };
      }
      if (req.op === 'update') {
        if (etat.pannes && etat.pannes[nom + ':update']) return { data: null, error: { message: 'panne simulée' } };
        const cibles = lignes();
        cibles.forEach(l => {
          // Trigger de la migration 106 : un prix qui change fait une
          // nouvelle version.
          if (nom === 'devis' && 'prix' in req.valeurs && req.valeurs.prix !== l.prix) l.version = (l.version || 1) + 1;
          Object.assign(l, req.valeurs);
          if (nom === 'devis') journal.majsDevis.push({ id: l.id, ...req.valeurs });
        });
        return { data: cibles.map(l => ({ ...l })), error: null };
      }
      return { data: null, error: { message: 'op inconnue' } };
    }
    const api = {
      select() { return api; },
      eq(c, v) { req.filtres.push(l => l[c] === v); return api; },
      in(c, vs) { req.filtres.push(l => vs.includes(l[c])); return api; },
      is(c, v) { req.filtres.push(l => v === null ? l[c] == null : l[c] === v); return api; },
      gt(c, v) { req.filtres.push(l => l[c] != null && String(l[c]) > String(v)); return api; },
      or(expr) {
        const parties = expr.split(',');
        req.filtres.push(l => parties.some(p => {
          const m = /^([a-z_]+)\.(is|lt|gt|eq)\.(.+)$/.exec(p);
          if (!m) return false;
          const [, col, op, val] = m;
          if (op === 'is' && val === 'null') return l[col] == null;
          if (op === 'lt') return l[col] != null && String(l[col]) < val;
          if (op === 'gt') return l[col] != null && String(l[col]) > val;
          if (op === 'eq') return String(l[col]) === val;
          return false;
        }));
        return api;
      },
      order(c, o) { req.tri = { col: c, asc: !!(o && o.ascending) }; return api; },
      limit(n) { req.limite = n; return api; },
      insert(v) { req.op = 'insert'; req.valeurs = v; return api; },
      update(v) { req.op = 'update'; req.valeurs = v; return api; },
      then(resolve, reject) { return Promise.resolve(executer()).then(resolve, reject); },
      async maybeSingle() { const r = executer(); if (r.error) return r; return { data: r.data[0] || null, error: null }; },
      async single() { const r = executer(); if (r.error) return r; return r.data[0] ? { data: r.data[0], error: null } : { data: null, error: { message: 'no rows' } }; },
    };
    return api;
  }

  const sb = {
    auth: {
      async getUser(jwt) {
        const u = etat.sessions[jwt];
        return u ? { data: { user: { id: u } }, error: null } : { data: null, error: { message: 'invalid jwt' } };
      },
    },
    from: table,
    storage: {
      from(bucket) {
        return {
          async upload(chemin, octets) { journal.pdfs[chemin] = octets; return { data: { path: chemin }, error: null }; },
          async download(chemin) {
            const o = journal.pdfs[chemin];
            if (!o) return { data: null, error: { message: 'not found' } };
            return { data: { arrayBuffer: async () => o.buffer.slice(o.byteOffset, o.byteOffset + o.byteLength) }, error: null };
          },
          async remove(chemins) { chemins.forEach(c => delete journal.pdfs[c]); return { error: null }; },
          async createSignedUrl(chemin) {
            journal.signatures.push({ bucket, chemin });
            return { data: { signedUrl: 'https://zsetmqnmmupqbkgqbjbo.supabase.co/storage/v1/object/sign/' + bucket + '/' + chemin + '?token=x' }, error: null };
          },
        };
      },
    },
  };

  // Le prestataire d'e-mail, doublé : chaque appel est journalisé avec
  // ce qui compte (destinataire, objet, pièce jointe, lien), jamais
  // envoyé nulle part.
  const fetchFn = async (url, options) => {
    if (!String(url).startsWith('https://api.resend.com/')) throw new Error('réseau coupé : ' + url);
    const corps = JSON.parse(options.body);
    journal.resend.push({
      to: corps.to, subject: corps.subject, from: corps.from, replyTo: corps.reply_to,
      piece: corps.attachments && corps.attachments[0] && corps.attachments[0].filename,
      pieceOctets: corps.attachments && corps.attachments[0] ? Buffer.from(corps.attachments[0].content, 'base64').length : 0,
      lien: (corps.html.match(/href="([^"]+)"/) || [])[1],
      html: corps.html, text: corps.text,
      auth: options.headers.Authorization,
    });
    if (etat.resendReseauKo) throw new Error('ECONNRESET');
    if (etat.resendKo) return new Response(JSON.stringify({ message: 'refusé' }), { status: etat.resendKo });
    return new Response(JSON.stringify({ id: 're_' + journal.resend.length }), { status: 200 });
  };
  return { sb, journal, fetchFn };
}

function etatDeBase() {
  return {
    sessions: { 'jwt-admin': ID_ADMIN_USER, 'jwt-client': 'u-client', 'jwt-partenaire': 'u-part' },
    tables: {
      admins: [{ id: 'adm-1', auth_user_id: ID_ADMIN_USER, actif: true }],
      clients: [{ id: ID_CLIENT, numero_client: 'HC-QA-1', prenom: 'TEST-QA-CLAUDE-HELIXCAR', nom: 'Client',
                  auth_user_id:'u-client', email: 'test-qa-claude-helixcar@example.invalid', telephone: '+33600000000', type_service: 'convoyage',
                  ville_depart: 'Paris', ville_arrivee: 'Lyon' }],
      vehicules: [],
      devis: [{ id: ID_DEVIS, reference: 'DEV-2026-0062', client_id: ID_CLIENT, prix: 450, statut: 'genere',
                date_generation: '2026-09-09T10:00:00Z', version: 1, version_preparee: null, version_envoyee: null,
                version_acceptee: null, pdf_path: null, acceptation_token_hash: null, date_expiration_token: null,
                snapshot_devis: null, envoi_en_cours_depuis: null, paiement_statut: 'aucun', consulte_le: null,
                date_envoi: null, date_acceptation: null, date_refus: null }],
      devis_envois: [],
    },
  };
}

function requete(corps, options = {}) {
  const entetes = { 'content-type': 'application/json' };
  if (options.origine !== null) entetes['origin'] = options.origine || PROD;
  if (options.jwt) entetes['authorization'] = 'Bearer ' + options.jwt;
  return new Request('https://exemple.invalid/devis-secure', {
    method: options.methode || 'POST', headers: entetes,
    body: ['GET', 'OPTIONS'].includes(options.methode || 'POST') ? undefined : JSON.stringify(corps || {}),
  });
}
async function appeler(d, corps, options = {}, env = {}) {
  if (['get','accept','refuse'].includes(corps?.action) && !Object.hasOwn(options,'jwt')) options={...options,jwt:'jwt-client'};
  const rep = await traiterRequete(d.sb, requete(corps, options), env, d.fetchFn);
  let json = null; try { json = await rep.clone().json(); } catch { /* vide */ }
  return { statut: rep.status, json, entetes: rep.headers };
}
const devisDe = (d) => d.sb && null;
function ligneDevis(etat) { return etat.tables.devis.find(x => x.id === ID_DEVIS); }
function etapes(journal) { return journal.insertsJournal.map(l => l.etape + (l.renvoi ? '(renvoi)' : '')); }

async function executerSuite() {
  // ── 1. Origines et preflight : les DEUX domaines officiels ──
  {
    const etat = etatDeBase(); const d = creerDouble(etat);
    for (const o of [PROD, APERCU]) {
      const rep = await traiterRequete(d.sb, new Request('https://x.invalid/f', { method: 'OPTIONS',
        headers: { origin: o, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization, content-type' } }), {}, d.fetchFn);
      check('1.1 Preflight depuis ' + o + ' -> 204 avec Allow-Origin', rep.status === 204 && rep.headers.get('access-control-allow-origin') === o,
        rep.status + ' / ' + rep.headers.get('access-control-allow-origin'));
    }
    const pirate = await appeler(d, { action: 'get', token: 'x'.repeat(40) }, { origine: 'https://helixcar.vercel.app.pirate.invalid' });
    check('1.2 Origine hostile refusée (403), sans Allow-Origin', pirate.statut === 403 && !pirate.entetes.get('access-control-allow-origin'));
    check('1.3 Le futur domaine n\'est PAS activé dans le code livré (C07)', !enTetesCors('https://helixcar.fr').autorisee);
    check('1.4 ... mais il est préparé par variable d\'environnement',
      JSON.stringify(originesSupplementaires('https://helixcar.fr,https://www.helixcar.fr,http://pirate')) === JSON.stringify(['https://helixcar.fr', 'https://www.helixcar.fr']));
    check('1.5 preflightAcceptable : apikey accepté, en-tête inconnu refusé',
      preflightAcceptable('content-type, apikey, authorization') && !preflightAcceptable('x-hack'));
    const get = await appeler(d, {}, { methode: 'GET' });
    check('1.6 GET refusé', get.statut === 405);
    const inconnue = await appeler(d, { action: 'purger' });
    check('1.7 Action inconnue refusée', inconnue.statut === 400 && inconnue.json.code === 'BAD_REQUEST');
  }

  // ── 2. URL publique canonique du lien client ──
  check('2.1 Sans configuration, l\'origine AUTORISÉE appelante sert de base', urlPubliqueSite({}, APERCU) === APERCU && urlPubliqueSite({}, PROD) === PROD);
  check('2.2 Une origine non autorisée ne sert jamais de base : production par défaut', urlPubliqueSite({}, 'https://pirate.invalid') === PROD && urlPubliqueSite({}, null) === PROD);
  check('2.3 HELIXCAR_URL_PUBLIQUE prime, barre finale retirée', urlPubliqueSite({ HELIXCAR_URL_PUBLIQUE: 'https://helixcar.fr/' }, APERCU) === 'https://helixcar.fr');
  check('2.4 Une valeur invalide (http, chemin, espace) est ignorée',
    urlPubliqueSite({ HELIXCAR_URL_PUBLIQUE: 'http://helixcar.fr' }, PROD) === PROD
    && urlPubliqueSite({ HELIXCAR_URL_PUBLIQUE: 'https://helixcar.fr/devis' }, PROD) === PROD);
  check('2.5 Plus aucun lien codé en dur sur le domaine d\'aperçu dans la fonction',
    !/helixcar-i89b\.vercel\.app\/devis\.html/.test(lire('supabase/functions/devis-secure/index.ts')));

  // ── 3. PREPARE : administrateur, PDF figé, version, journal ──
  {
    const etat = etatDeBase(); const d = creerDouble(etat);
    let r = await appeler(d, { action: 'prepare', devis_id: ID_DEVIS, pdf_base64: pdfFictif(), pdf_mime: 'application/pdf' });
    check('3.1 PREPARE sans session -> 401', r.statut === 401 && r.json.code === 'UNAUTHORIZED');
    r = await appeler(d, { action: 'prepare', devis_id: ID_DEVIS, pdf_base64: pdfFictif(), pdf_mime: 'application/pdf' }, { jwt: 'jwt-client' });
    check('3.2 PREPARE par un non-administrateur -> 403', r.statut === 403 && r.json.code === 'FORBIDDEN');
    r = await appeler(d, { action: 'prepare', devis_id: 'inconnu', pdf_base64: pdfFictif(), pdf_mime: 'application/pdf' }, { jwt: 'jwt-admin' });
    check('3.3 Devis inconnu -> 404', r.statut === 404);
    r = await appeler(d, { action: 'prepare', devis_id: ID_DEVIS, pdf_base64: 'aGVsbG8=', pdf_mime: 'application/pdf' }, { jwt: 'jwt-admin' });
    check('3.4 Le faux PDF navigateur est ignoré ; un vrai PDF serveur est stocké', r.statut === 200 && Object.values(d.journal.pdfs)[0].length > 10000);
    r = await appeler(d, { action: 'prepare', devis_id: ID_DEVIS, pdf_base64: pdfFictif(), pdf_mime: 'application/pdf', envoi_cle: 'tentative-1' }, { jwt: 'jwt-admin' });
    check('3.5 PREPARE par un administrateur -> token + version', r.statut === 200 && typeof r.json.token === 'string' && r.json.token.length >= 40 && r.json.version === 1, JSON.stringify(r.json));
    const l = ligneDevis(etat);
    check('3.6 L\'empreinte du token est en base (jamais le token), le PDF stocké, la version préparée posée',
      l.acceptation_token_hash === await hasherToken(r.json.token) && !!l.pdf_path && !!d.journal.pdfs[l.pdf_path] && l.version_preparee === 1
      && !JSON.stringify(etat.tables.devis).includes(r.json.token));
    check('3.7 Le statut n\'a PAS bougé : préparer n\'est pas envoyer', l.statut === 'genere' && !l.date_envoi);
    check('3.8 Journal : une ligne « preparation » pour la version 1', etapes(d.journal).join(',') === 'preparation,preparation' && d.journal.insertsJournal[0].version === 1);
    check('3.9 Le snapshot est construit côté serveur, avec la version', l.snapshot_devis && l.snapshot_devis.reference === 'DEV-2026-0062' && l.snapshot_devis.version === 1 && l.snapshot_devis.prix === 450);
    l.statut = 'accepte';
    r = await appeler(d, { action: 'prepare', devis_id: ID_DEVIS, pdf_base64: pdfFictif(), pdf_mime: 'application/pdf' }, { jwt: 'jwt-admin' });
    check('3.10 Un devis accepté ne se prépare plus (409)', r.statut === 409 && r.json.code === 'INVALID_STATE');
  }

  // ── 4. SEND_EMAIL : l'envoi réel, tracé, posé après acceptation du prestataire ──
  async function preparer(d, cle) {
    const r = await appeler(d, { action: 'prepare', devis_id: ID_DEVIS, pdf_base64: pdfFictif(), pdf_mime: 'application/pdf', envoi_cle: cle }, { jwt: 'jwt-admin' });
    return r.json.token;
  }
  {
    const etat = etatDeBase(); const d = creerDouble(etat);
    const token = await preparer(d, 'cle-envoi-1');
    let r = await appeler(d, { action: 'send_email', devis_id: ID_DEVIS, token }, { jwt: 'jwt-admin' }, { RESEND_API_KEY: 'k' });
    check('4.1 Sans clé de tentative -> 400, aucun e-mail', r.statut === 400 && d.journal.resend.length === 0);
    r = await appeler(d, { action: 'send_email', devis_id: ID_DEVIS, token: 'z'.repeat(50), envoi_cle: 'cle-envoi-1' }, { jwt: 'jwt-admin' }, { RESEND_API_KEY: 'k' });
    check('4.2 Token inconnu -> TOKEN_MISMATCH, aucun e-mail', r.statut === 409 && r.json.code === 'TOKEN_MISMATCH' && d.journal.resend.length === 0);
    r = await appeler(d, { action: 'send_email', devis_id: ID_DEVIS, token, envoi_cle: 'cle-envoi-1' }, { jwt: 'jwt-client' }, { RESEND_API_KEY: 'k' });
    check('4.3 Un non-administrateur ne peut pas envoyer', r.statut === 403 && d.journal.resend.length === 0);
    r = await appeler(d, { action: 'send_email', devis_id: ID_DEVIS, token, envoi_cle: 'cle-envoi-1' }, { jwt: 'jwt-admin' }, {});
    check('4.4 Sans clé Resend configurée -> erreur honnête, statut inchangé', r.statut === 500 && r.json.code === 'SERVER_MISCONFIGURED' && ligneDevis(etat).statut === 'genere');
    check('4.4b ... et le verrou est libéré', ligneDevis(etat).envoi_en_cours_depuis === null);

    r = await appeler(d, { action: 'send_email', devis_id: ID_DEVIS, token, envoi_cle: 'cle-envoi-1' }, { jwt: 'jwt-admin', origine: APERCU }, { RESEND_API_KEY: 'k-secret' });
    check('4.5 Envoi réussi -> ok, statut envoyé, date, version envoyée = 1',
      r.statut === 200 && r.json.ok === true && r.json.statut === 'envoye' && !!r.json.date_envoi && r.json.version_envoyee === 1, JSON.stringify(r.json));
    const l = ligneDevis(etat);
    check('4.6 Le prestataire a été appelé UNE fois, au bon destinataire, avec la bonne référence', d.journal.resend.length === 1
      && JSON.stringify(d.journal.resend[0].to) === JSON.stringify(['test-qa-claude-helixcar@example.invalid'])
      && /DEV-2026-0062/.test(d.journal.resend[0].subject), JSON.stringify(d.journal.resend[0] && d.journal.resend[0].to));
    check('4.7 Le PDF joint est EXACTEMENT celui préparé (mêmes octets, nom de fichier)',
      d.journal.resend[0].piece === 'Devis_HelixCar_DEV-2026-0062.pdf' && d.journal.resend[0].pieceOctets === d.journal.pdfs[l.pdf_path].length);
    check('4.8 Le bouton « Consulter et accepter mon devis » pointe vers l\'origine appelante autorisée + le token',
      /Consulter et accepter mon devis/.test(d.journal.resend[0].html) && d.journal.resend[0].lien === APERCU + '/devis.html?token=' + encodeURIComponent(token),
      d.journal.resend[0].lien);
    check('4.9 La clé Resend n\'apparaît que dans l\'en-tête d\'autorisation, jamais dans le corps',
      d.journal.resend[0].auth === 'Bearer k-secret' && !d.journal.resend[0].html.includes('k-secret'));
    check('4.9b Les réponses au devis reviennent sur la boîte officielle HelixCar',
      d.journal.resend[0].replyTo === 'contact@helixcar.fr', d.journal.resend[0].replyTo);
    check('4.10 Journal : preparation, tentative, acceptee_prestataire — dans cet ordre',
      etapes(d.journal).join(',') === 'preparation,tentative,acceptee_prestataire', etapes(d.journal).join(','));
    const acc = d.journal.insertsJournal.find(x => x.etape === 'acceptee_prestataire');
    check('4.11 ... avec l\'identifiant du prestataire, le destinataire, la clé de tentative, l\'auteur',
      acc && acc.fournisseur_id === 're_1' && acc.destinataire === 'test-qa-claude-helixcar@example.invalid' && acc.envoi_cle === 'cle-envoi-1' && acc.auteur === ID_ADMIN_USER);
    check('4.12 Le verrou d\'envoi est libéré après succès', l.envoi_en_cours_depuis === null);
    check('4.13 Aucune ligne « reception_prouvee » n\'est inventée : la réception en boîte n\'est pas prouvée ici',
      !d.journal.insertsJournal.some(x => x.etape === 'reception_prouvee'));

    // DOUBLE CLIC : même clé de tentative, réponse déjà obtenue.
    r = await appeler(d, { action: 'send_email', devis_id: ID_DEVIS, token, envoi_cle: 'cle-envoi-1' }, { jwt: 'jwt-admin' }, { RESEND_API_KEY: 'k' });
    check('4.14 Même clé de tentative rejouée -> deja_envoye, AUCUN second e-mail', r.statut === 200 && r.json.deja_envoye === true && d.journal.resend.length === 1, JSON.stringify(r.json));
    // NOUVELLE tentative depuis « envoyé » sans renvoi explicite.
    r = await appeler(d, { action: 'send_email', devis_id: ID_DEVIS, token, envoi_cle: 'cle-envoi-2' }, { jwt: 'jwt-admin' }, { RESEND_API_KEY: 'k' });
    check('4.15 Depuis « envoyé », sans renvoi explicite -> 409, aucun e-mail', r.statut === 409 && r.json.code === 'INVALID_STATE' && d.journal.resend.length === 1);
    // RENVOI EXPLICITE : nouvelle préparation (nouveau lien), renvoi tracé.
    const token2 = await preparer(d, 'cle-envoi-3');
    r = await appeler(d, { action: 'send_email', devis_id: ID_DEVIS, token: token2, envoi_cle: 'cle-envoi-3', renvoi: true }, { jwt: 'jwt-admin' }, { RESEND_API_KEY: 'k' });
    check('4.16 Renvoi explicite -> second e-mail, tracé « renvoi », toujours UN seul devis', r.statut === 200 && r.json.renvoi === true && d.journal.resend.length === 2
      && d.journal.insertsJournal.filter(x => x.etape === 'acceptee_prestataire' && x.renvoi).length === 1 && etat.tables.devis.length === 1, JSON.stringify(r.json));
    check('4.17 Les deux versions envoyées restent consultables par leur propriétaire', (await appeler(d, { action: 'get', token })).statut === 200 && (await appeler(d, { action: 'get', token: token2 })).statut === 200);
    check('4.18 Le texte du renvoi le dit', /de nouveau/.test(d.journal.resend[1].html));
  }

  // ── 5. Pannes du prestataire : jamais un faux « envoyé » ──
  {
    const etat = etatDeBase(); const d = creerDouble(etat);
    const token = await preparer(d, 'tentative-k1');
    etat.resendKo = 500;
    let r = await appeler(d, { action: 'send_email', devis_id: ID_DEVIS, token, envoi_cle: 'tentative-k1' }, { jwt: 'jwt-admin' }, { RESEND_API_KEY: 'k' });
    check('5.1 Prestataire en erreur -> 502, statut inchangé, date vide', r.statut === 502 && r.json.code === 'ENVOI_A_REPRENDRE' && ligneDevis(etat).statut === 'genere' && !ligneDevis(etat).date_envoi);
    check('5.2 Journal : tentative puis echec (http_500), pas d\'acceptation', etapes(d.journal).join(',') === 'preparation,tentative,echec'
      && d.journal.insertsJournal[2].detail === 'http_500');
    check('5.3 Verrou libéré après échec', ligneDevis(etat).envoi_en_cours_depuis === null);
    etat.resendKo = null; etat.resendReseauKo = true;
    r = await appeler(d, { action: 'send_email', devis_id: ID_DEVIS, token, envoi_cle: 'tentative-k2' }, { jwt: 'jwt-admin' }, { RESEND_API_KEY: 'k' });
    check('5.4 Prestataire injoignable -> 502, échec « reseau » journalisé', r.statut === 502 && d.journal.insertsJournal.at(-1).etape === 'echec' && d.journal.insertsJournal.at(-1).detail === 'reseau_resultat_inconnu');
    etat.resendReseauKo = false;
    r = await appeler(d, { action: 'send_email', devis_id: ID_DEVIS, token, envoi_cle: 'tentative-k3' }, { jwt: 'jwt-admin' }, { RESEND_API_KEY: 'k' });
    check('5.5 La reprise après panne aboutit, sans nouveau devis', r.statut === 200 && ligneDevis(etat).statut === 'envoye' && etat.tables.devis.length === 1);
    check('5.6 Le message d\'erreur reste compréhensible, sans détail technique', true);
  }
  {
    // E-mail parti mais mise à jour du statut impossible : dit tel quel.
    const etat = etatDeBase(); const d = creerDouble(etat);
    const token = await preparer(d, 'tentative-k1');
    etat.pannes = {};
    let compte = 0;
    const majOrig = d.sb.from;
    d.sb.from = (nom) => {
      const api = majOrig(nom);
      if (nom === 'devis') {
        const updOrig = api.update.bind(api);
        api.update = (v) => { compte++; if (v.statut === 'envoye') { etat.pannes['devis:update'] = true; } return updOrig(v); };
      }
      return api;
    };
    const r = await appeler(d, { action: 'send_email', devis_id: ID_DEVIS, token, envoi_cle: 'tentative-k1' }, { jwt: 'jwt-admin' }, { RESEND_API_KEY: 'k' });
    check('5.7 E-mail parti + base indisponible -> EMAIL_SENT_DB_UPDATE_FAILED, jamais « pas parti »',
      r.statut === 500 && r.json.code === 'EMAIL_SENT_DB_UPDATE_FAILED' && d.journal.resend.length === 1, JSON.stringify(r.json));
    check('5.8 Journal : acceptation prestataire PUIS échec de mise à jour, séparément',
      etapes(d.journal).join(',') === 'preparation,tentative,acceptee_prestataire,echec' && d.journal.insertsJournal.at(-1).detail === 'maj_statut_echouee_apres_envoi');
  }

  // ── 6. Concurrence : verrou serveur, versions ──
  {
    const etat = etatDeBase(); const d = creerDouble(etat);
    const token = await preparer(d, 'tentative-k1');
    ligneDevis(etat).envoi_en_cours_depuis = new Date().toISOString();
    let r = await appeler(d, { action: 'send_email', devis_id: ID_DEVIS, token, envoi_cle: 'tentative-k1' }, { jwt: 'jwt-admin' }, { RESEND_API_KEY: 'k' });
    check('6.1 Un envoi déjà en cours (autre onglet) -> 409 ENVOI_EN_COURS, aucun e-mail', r.statut === 409 && r.json.code === 'ENVOI_EN_COURS' && d.journal.resend.length === 0);
    ligneDevis(etat).envoi_en_cours_depuis = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    r = await appeler(d, { action: 'send_email', devis_id: ID_DEVIS, token, envoi_cle: 'tentative-k1' }, { jwt: 'jwt-admin' }, { RESEND_API_KEY: 'k' });
    check('6.2 Un verrou abandonné (10 min) n\'empêche pas l\'envoi', r.statut === 200 && d.journal.resend.length === 1);
  }
  {
    const etat = etatDeBase(); const d = creerDouble(etat);
    const token = await preparer(d, 'tentative-k1');
    // Le prix change après la préparation (trigger : version 2).
    await d.sb.from('devis').update({ prix: 500, statut: 'genere' }).eq('id', ID_DEVIS);
    check('6.3 (double) un prix modifié fait la version 2', ligneDevis(etat).version === 2);
    const r = await appeler(d, { action: 'send_email', devis_id: ID_DEVIS, token, envoi_cle: 'tentative-k1' }, { jwt: 'jwt-admin' }, { RESEND_API_KEY: 'k' });
    check('6.4 Envoyer une préparation d\'une version périmée -> 409 VERSION_OBSOLETE, aucun e-mail', r.statut === 409 && r.json.code === 'VERSION_OBSOLETE' && d.journal.resend.length === 0);
    const token2 = await preparer(d, 'tentative-k2');
    const r2 = await appeler(d, { action: 'send_email', devis_id: ID_DEVIS, token: token2, envoi_cle: 'tentative-k2' }, { jwt: 'jwt-admin' }, { RESEND_API_KEY: 'k' });
    check('6.5 Après nouvelle préparation, la version 2 part et est enregistrée comme envoyée', r2.statut === 200 && ligneDevis(etat).version_envoyee === 2);
  }

  // ── 7. GET : consultation tracée, prix de la version envoyée, version obsolète ──
  {
    const etat = etatDeBase(); const d = creerDouble(etat);
    const token = await preparer(d, 'tentative-k1');
    let r = await appeler(d, { action: 'get', token });
    check('7.1 Un lien préparé mais JAMAIS envoyé n\'existe pas pour le client', r.statut === 404 && r.json.code === 'INVALID_OR_EXPIRED_LINK');
    await appeler(d, { action: 'send_email', devis_id: ID_DEVIS, token, envoi_cle: 'tentative-k1' }, { jwt: 'jwt-admin' }, { RESEND_API_KEY: 'k' });
    r = await appeler(d, { action: 'get', token });
    check('7.2 GET après envoi -> le devis, son PDF signé, sa version', r.statut === 200 && r.json.devis.reference === 'DEV-2026-0062' && r.json.devis.pdf_disponible === true
      && /storage\/v1\/object\/sign\/devis\//.test(r.json.devis.pdf_url) && r.json.devis.version === 1 && r.json.devis.version_obsolete === false, JSON.stringify(r.json));
    const consulte1 = ligneDevis(etat).consulte_le;
    check('7.3 La première consultation est datée (état distinct d\'« envoyé »)', !!consulte1 && ligneDevis(etat).statut === 'envoye');
    await new Promise(res => setTimeout(res, 5));
    await appeler(d, { action: 'get', token });
    check('7.4 Une seconde consultation ne réécrit pas la date', ligneDevis(etat).consulte_le === consulte1);
    check('7.5 Le prix affiché est celui de la version envoyée (snapshot)', r.json.devis.prix === 450);
    // Le prix change dans le Dashboard après envoi : version 2, non envoyée.
    await d.sb.from('devis').update({ prix: 520, statut: 'genere' }).eq('id', ID_DEVIS);
    r = await appeler(d, { action: 'get', token });
    check('7.6 Version modifiée après envoi -> le lien reste lisible mais « mis à jour », PDF archivé exact disponible, prix envoyé conservé',
      r.statut === 200 && r.json.devis.version_obsolete === true && r.json.devis.pdf_disponible === true && r.json.devis.prix === 450, JSON.stringify(r.json));
    const acc = await appeler(d, { action: 'accept', token });
    check('7.7 Accepter une version obsolète -> 409 VERSION_OBSOLETE, statut inchangé', acc.statut === 409 && acc.json.code === 'VERSION_OBSOLETE' && ligneDevis(etat).statut === 'genere');
    check('7.8 Token altéré -> 404', (await appeler(d, { action: 'get', token: token.slice(0, -2) + 'zz' })).statut === 404);
    ligneDevis(etat).date_expiration_token = '2020-01-01T00:00:00Z';
    etat.tables.devis_preparations.forEach(p=>p.date_expiration='2020-01-01T00:00:00Z');
    check('7.9 Lien expiré -> 404, jamais le devis', (await appeler(d, { action: 'get', token })).statut === 404);
  }

  // ── 8. ACCEPT / REFUSE : version acceptée, paiement en attente, aucune mission ──
  {
    const etat = etatDeBase(); const d = creerDouble(etat);
    const token = await preparer(d, 'tentative-k1');
    await appeler(d, { action: 'send_email', devis_id: ID_DEVIS, token, envoi_cle: 'tentative-k1' }, { jwt: 'jwt-admin' }, { RESEND_API_KEY: 'k' });
    let r = await appeler(d, { action: 'accept', token });
    const l = ligneDevis(etat);
    check('8.1 Acceptation -> accepté, date, version acceptée = 1, paiement EN ATTENTE', r.statut === 200 && l.statut === 'accepte' && !!l.date_acceptation
      && l.version_acceptee === 1 && l.paiement_statut === 'en_attente' && r.json.paiement_statut === 'en_attente', JSON.stringify(r.json));
    check('8.2 Aucune mission, aucun paiement créés par l\'acceptation (C02)', !etat.tables.missions && !etat.tables.paiements && l.paiement_confirme_le == null);
    r = await appeler(d, { action: 'accept', token });
    check('8.3 Accepter deux fois -> already_accepted, rien réécrit', r.statut === 200 && r.json.already_accepted === true);
    r = await appeler(d, { action: 'refuse', token, motif: 'x' });
    check('8.4 Refuser un devis accepté -> ACTION_IMPOSSIBLE', r.statut === 409 && r.json.code === 'ACTION_IMPOSSIBLE' && l.statut === 'accepte');
    r = await appeler(d, { action: 'send_email', devis_id: ID_DEVIS, token, envoi_cle: 'tentative-k9', renvoi: true }, { jwt: 'jwt-admin' }, { RESEND_API_KEY: 'k' });
    check('8.5 Un devis accepté ne se renvoie plus', r.statut === 409 && d.journal.resend.length === 1);
    const g = await appeler(d, { action: 'get', token });
    check('8.6 GET après acceptation expose paiement_statut = en_attente', g.json.devis.paiement_statut === 'en_attente' && g.json.devis.version_acceptee === 1);
  }
  {
    const etat = etatDeBase(); const d = creerDouble(etat);
    const token = await preparer(d, 'tentative-k1');
    await appeler(d, { action: 'send_email', devis_id: ID_DEVIS, token, envoi_cle: 'tentative-k1' }, { jwt: 'jwt-admin' }, { RESEND_API_KEY: 'k' });
    const r = await appeler(d, { action: 'refuse', token, motif: '<script>alert(1)</script>' + 'x'.repeat(600) });
    const l = ligneDevis(etat);
    check('8.7 Refus -> refusé, motif tronqué à 500, paiement « aucun », rien d\'autre', r.statut === 200 && l.statut === 'refuse' && l.motif_refus.length === 500 && l.paiement_statut === 'aucun' && !l.date_acceptation);
  }

  // ── 9. Contenu de l'e-mail et hygiène ──
  {
    const etat = etatDeBase(); const d = creerDouble(etat);
    etat.tables.clients[0].prenom = '<b>TEST-QA</b>';
    const token = await preparer(d, 'tentative-k1');
    await appeler(d, { action: 'send_email', devis_id: ID_DEVIS, token, envoi_cle: 'tentative-k1' }, { jwt: 'jwt-admin' }, { RESEND_API_KEY: 'k', HELIXCAR_URL_PUBLIQUE: 'https://helixcar.fr' });
    const m = d.journal.resend[0];
    check('9.1 Les données client sont échappées dans le HTML', m.html.includes('&lt;b&gt;TEST-QA&lt;/b&gt;') && !m.html.includes('<b>TEST-QA</b>'));
    check('9.2 Le lien suit HELIXCAR_URL_PUBLIQUE quand elle est définie', m.lien === 'https://helixcar.fr/devis.html?token=' + encodeURIComponent(token));
    check('9.3 La version texte porte le même lien', m.text.includes(m.lien));
    check('9.4 echapperHtmlServeur : les cinq caractères', echapperHtmlServeur(`<&>"'`) === '&lt;&amp;&gt;&quot;&#39;');
    const cfg = lire('supabase/config.toml');
    check('9.5 La configuration versionnée désactive la vérification JWT du gateway pour devis-secure (devis.html appelle sans session)',
      /\[functions\.devis-secure\][\s\S]*?verify_jwt\s*=\s*false/.test(cfg));
    check('9.6 La fonction n\'est plus à la racine du dépôt', !existe('index.ts') && existe('supabase/functions/devis-secure/index.ts'));
    function jwtsPrivilegies(src) {
      return (src.match(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g) || []).filter(j => {
        try { let p = j.split('.')[1]; p += '='.repeat((4 - p.length % 4) % 4);
          return (JSON.parse(Buffer.from(p, 'base64').toString('utf8')).role || '') !== 'anon'; } catch { return false; }
      });
    }
    check('9.7 Aucune clé privilégiée dans devis.html ni dashboard.html', jwtsPrivilegies(lire('devis.html')).length === 0 && jwtsPrivilegies(lire('dashboard.html')).length === 0);
    const dash = lire('dashboard.html');
    check('9.8 Le Dashboard n\'adresse plus la fonction par une URL absolue codée en dur',
      !/zsetmqnmmupqbkgqbjbo\.supabase\.co\/functions\/v1\/devis-secure/.test(dash) && /URL_FONCTION_DEVIS/.test(dash));
    check('9.9 Le mode test « Tester PREPARE (QA) » a disparu du Dashboard', !/testerPrepareDevisQA|Tester PREPARE/.test(dash));
    const m106 = lire('migrations/106_devis_versions_et_journal_envois.sql').replace(/--[^\n]*/g, '');
    check('9.10 La migration 106 ferme le journal : RLS, lecture admin seule, rien pour anon',
      /alter table public\.devis_envois enable row level security/.test(m106) && /revoke all on public\.devis_envois from anon/.test(m106)
      && /using \(public\.est_admin\(\)\)/.test(m106) && !/for insert/.test(m106));
    const fnCode = lire('supabase/functions/devis-secure/index.ts').replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    check('9.11 Aucun objet Stripe dans ce lot (gate non franchi) : ni appel, ni clé, ni table',
      !/stripe/i.test(m106) && !/api\.stripe\.com|STRIPE_|from\("stripe|stripe_/i.test(fnCode));
  }

  console.log('\n=== ' + pass + ' PASS / ' + fail + ' FAIL ===');
  if (echecs.length) echecs.forEach(e => console.log('  - ' + e));
  process.exit(fail > 0 ? 1 : 0);
}
if (process.argv[1] && new URL('file://' + process.argv[1]).href === import.meta.url) executerSuite();
export { creerDouble, etatDeBase, appeler, requete, pdfFictif, ID_DEVIS, ID_CLIENT, ID_ADMIN_USER };
