// SÉCURITÉ DE L'ENVOI VIDÉO — exécute le VRAI code de la fonction
// serveur (supabase/functions/candidature-video/index.ts) contre un
// double Supabase en mémoire. Aucun réseau, aucune donnée réelle.
//
//   node --experimental-strip-types tests/t_video_securite.mjs
import {
  traiterRequete, hasherJeton, dureeMaxPourActivites, enTetesCors,
} from '../supabase/functions/candidature-video/index.ts';

let pass = 0, fail = 0; const echecs = [];
function check(l, c, e) {
  if (c) { console.log('PASS - ' + l); pass++; }
  else { console.log('FAIL - ' + l + (e ? '  [' + e + ']' : '')); fail++; echecs.push(l); }
}

const ORIGINE = 'https://helixcar-i89b.vercel.app';
const BUCKET = 'candidatures-videos';

// ── Double Supabase en mémoire ──────────────────────────────
function creerDouble(etat) {
  const journal = { signatures: [], suppressions: [], majs: [] };
  const sb = {
    auth: {
      async getUser(jwt) {
        const u = etat.sessions[jwt];
        return u ? { data: { user: { id: u } }, error: null }
                 : { data: null, error: { message: 'invalid jwt' } };
      },
    },
    from(table) {
      const req = { table, filtres: {}, _maj: null };
      const api = {
        select() { return api; },
        eq(col, val) { req.filtres[col] = val; return api; },
        async maybeSingle() {
          const ligne = etat.convoyeurs.find(c =>
            Object.entries(req.filtres).every(([k, v]) => c[k] === v));
          return { data: ligne ? { ...ligne } : null, error: null };
        },
        update(valeurs) { req._maj = valeurs; return api; },
        then(resolve) {   // `await sb.from().update().eq()` termine ici
          const cible = etat.convoyeurs.find(c =>
            Object.entries(req.filtres).every(([k, v]) => c[k] === v));
          if (cible && req._maj) { Object.assign(cible, req._maj); journal.majs.push({ id: cible.id, ...req._maj }); }
          return Promise.resolve({ error: null }).then(resolve);
        },
      };
      return api;
    },
    storage: {
      from(bucket) {
        return {
          async createSignedUploadUrl(chemin) {
            journal.signatures.push({ bucket, chemin });
            if (etat.stockageKo) return { data: null, error: { message: 'storage down' } };
            return { data: { token: 'jeton-upload-' + chemin, path: chemin, signedUrl: 'https://x.invalid/' + chemin }, error: null };
          },
          async list(prefixe) {
            if (etat.stockageKo) return { data: null, error: { message: 'storage down' } };
            const noms = (etat.objets || [])
              .filter(o => o.startsWith(prefixe + '/'))
              .map(o => ({ name: o.slice(prefixe.length + 1) }));
            return { data: noms, error: null };
          },
          async remove(chemins) {
            journal.suppressions.push(...chemins);
            etat.objets = (etat.objets || []).filter(o => !chemins.includes(o));
            return { error: null };
          },
        };
      },
    },
  };
  return { sb, journal };
}

function requete(corps, options = {}) {
  const entetes = { 'content-type': 'application/json' };
  if (options.origine !== null) entetes['origin'] = options.origine || ORIGINE;
  if (options.jwt) entetes['authorization'] = 'Bearer ' + options.jwt;
  return new Request('https://exemple.invalid/candidature-video', {
    method: options.methode || 'POST',
    headers: entetes,
    body: ['GET', 'HEAD', 'OPTIONS'].includes(options.methode || 'POST')
      ? undefined : JSON.stringify(corps || {}),
  });
}
async function appeler(sb, corps, options) {
  const rep = await traiterRequete(sb, requete(corps, options));
  let json = null;
  try { json = await rep.clone().json(); } catch { /* corps vide */ }
  return { statut: rep.status, json, entetes: rep.headers };
}

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';

function etatDeBase() {
  return {
    sessions: {},
    objets: [],
    convoyeurs: [
      { id: ID_A, activites: ['convoyage'], auth_user_id: null, created_at: new Date().toISOString(),
        statut: 'video_attendue', video_chemin: null, video_envoyee_le: null,
        video_upload_jeton_hash: null },
      { id: ID_B, activites: ['convoyage', 'renfort'], auth_user_id: null, created_at: new Date().toISOString(),
        statut: 'video_attendue', video_chemin: null, video_envoyee_le: null,
        video_upload_jeton_hash: null },
    ],
  };
}

const JETON_A = 'a'.repeat(64);
const JETON_B = 'b'.repeat(64);

(async () => {
  const hashA = await hasherJeton(JETON_A);
  const hashB = await hasherJeton(JETON_B);

  // ── 1. Aucune autorisation ──
  {
    const etat = etatDeBase();
    const { sb } = creerDouble(etat);
    const r = await appeler(sb, { action: 'autoriser', mime: 'video/webm', taille_octets: 1000, duree_secondes: 30 });
    check('1.1 Envoi anonyme direct sans jeton -> refusé (401)',
      r.statut === 401 && r.json.code === 'UNAUTHORIZED', JSON.stringify(r.json));
  }
  {
    const etat = etatDeBase();
    const { sb, journal } = creerDouble(etat);
    const r = await appeler(sb, { action: 'autoriser', jeton: 'z'.repeat(64), mime: 'video/webm', taille_octets: 1000, duree_secondes: 30 });
    check('1.2 Jeton inconnu -> refusé (403)',
      r.statut === 403 && r.json.code === 'FORBIDDEN', JSON.stringify(r.json));
    check('1.3 Jeton inconnu -> aucune URL d\'envoi signée émise', journal.signatures.length === 0);
  }
  {
    const etat = etatDeBase();
    etat.convoyeurs[0].video_upload_jeton_hash = hashA;
    etat.convoyeurs[0].created_at = new Date(Date.now() - 5 * 3600 * 1000).toISOString();
    const { sb, journal } = creerDouble(etat);
    const r = await appeler(sb, { action: 'autoriser', jeton: JETON_A, mime: 'video/webm', taille_octets: 1000, duree_secondes: 30 });
    check('1.4 Autorisation expirée (candidature trop ancienne) -> refusée',
      r.statut === 403 && r.json.code === 'EXPIRED', JSON.stringify(r.json));
    check('1.5 Autorisation expirée -> aucune signature', journal.signatures.length === 0);
  }

  // ── 2. Le chemin est imposé par le serveur ──
  {
    const etat = etatDeBase();
    etat.convoyeurs[0].video_upload_jeton_hash = hashA;
    const { sb, journal } = creerDouble(etat);
    const r = await appeler(sb, {
      action: 'autoriser', jeton: JETON_A, mime: 'video/webm', taille_octets: 1000, duree_secondes: 30,
      // Tentative de viser le dossier d'une AUTRE candidature :
      chemin: `candidatures/${ID_B}/pirate.webm`,
      path: `candidatures/${ID_B}/pirate.webm`,
      name: `candidatures/${ID_B}/pirate.webm`,
    });
    check('2.1 Autorisation accordée au porteur du jeton', r.statut === 200 && r.json.ok === true, JSON.stringify(r.json));
    check('2.2 Le chemin imposé par le client est IGNORÉ',
      !r.json.chemin.includes(ID_B) && !r.json.chemin.includes('pirate'), r.json.chemin);
    check('2.3 Le chemin est celui de SA candidature',
      r.json.chemin.startsWith(`candidatures/${ID_A}/`), r.json.chemin);
    check('2.4 Nom de fichier généré côté serveur (uuid + extension)',
      /^candidatures\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.webm$/.test(r.json.chemin), r.json.chemin);
    check('2.5 La signature porte sur le bucket privé et ce chemin',
      journal.signatures.length === 1 && journal.signatures[0].bucket === BUCKET
      && journal.signatures[0].chemin === r.json.chemin, JSON.stringify(journal.signatures));
    check('2.6 Aucune URL de lecture n\'est délivrée par cette fonction',
      !('signedUrl' in r.json) && !('url' in r.json), JSON.stringify(Object.keys(r.json)));
    check('2.7 Le chemin attendu est enregistré sur LA bonne candidature',
      etat.convoyeurs[0].video_chemin === r.json.chemin && etat.convoyeurs[1].video_chemin === null);
    check('2.8 La vidéo n\'est pas déclarée reçue avant confirmation',
      etat.convoyeurs[0].video_envoyee_le === null);
  }

  // ── 3. Le jeton de A ne donne aucun droit sur B ──
  {
    const etat = etatDeBase();
    etat.convoyeurs[0].video_upload_jeton_hash = hashA;
    etat.convoyeurs[1].video_upload_jeton_hash = hashB;
    const { sb } = creerDouble(etat);
    const rA = await appeler(sb, { action: 'autoriser', jeton: JETON_A, mime: 'video/webm', taille_octets: 1000, duree_secondes: 30 });
    check('3.1 Candidat A obtient un chemin dans SON dossier',
      rA.json.chemin.startsWith(`candidatures/${ID_A}/`), rA.json.chemin);
    check('3.2 Candidat A ne peut rien écrire chez B',
      !rA.json.chemin.includes(ID_B) && etat.convoyeurs[1].video_chemin === null);
  }

  // ── 4. Contrôles serveur du format, de la taille et de la durée ──
  {
    const etat = etatDeBase();
    etat.convoyeurs[0].video_upload_jeton_hash = hashA;   // convoyage seul -> 60 s
    etat.convoyeurs[1].video_upload_jeton_hash = hashB;   // renfort -> 120 s
    const { sb, journal } = creerDouble(etat);

    let r = await appeler(sb, { action: 'autoriser', jeton: JETON_A, mime: 'video/x-msvideo', taille_octets: 1000, duree_secondes: 30 });
    check('4.1 Format refusé côté SERVEUR', r.statut === 400 && r.json.code === 'FORMAT_REFUSE', JSON.stringify(r.json));

    r = await appeler(sb, { action: 'autoriser', jeton: JETON_A, mime: 'video/mp4', taille_octets: 60 * 1024 * 1024, duree_secondes: 30 });
    check('4.2 Taille refusée côté SERVEUR', r.statut === 400 && r.json.code === 'TAILLE_REFUSEE', JSON.stringify(r.json));

    r = await appeler(sb, { action: 'autoriser', jeton: JETON_A, mime: 'video/mp4', taille_octets: 1000, duree_secondes: 90 });
    check('4.3 90 s refusées pour un candidat convoyage (max 60 s)',
      r.statut === 400 && r.json.code === 'DUREE_REFUSEE', JSON.stringify(r.json));

    r = await appeler(sb, { action: 'autoriser', jeton: JETON_B, mime: 'video/mp4', taille_octets: 1000, duree_secondes: 90 });
    check('4.4 90 s acceptées pour un candidat avec renfort (max 120 s)',
      r.statut === 200 && r.json.ok === true, JSON.stringify(r.json));

    r = await appeler(sb, { action: 'autoriser', jeton: JETON_B, mime: 'video/mp4', taille_octets: 1000, duree_secondes: 150 });
    check('4.5 150 s refusées même avec renfort', r.statut === 400 && r.json.code === 'DUREE_REFUSEE');

    r = await appeler(sb, { action: 'autoriser', jeton: JETON_A, mime: 'video/mp4', taille_octets: 1000, duree_secondes: 0 });
    check('4.6 Durée non vérifiable refusée', r.statut === 400 && r.json.code === 'DUREE_REFUSEE');

    check('4.7 Aucune signature émise pour les demandes refusées',
      journal.signatures.length === 1, 'signatures=' + journal.signatures.length);
  }
  {
    // Le serveur relit les ACTIVITÉS EN BASE, pas ce que dit le client.
    const etat = etatDeBase();
    etat.convoyeurs[0].activites = ['nettoyage'];
    etat.convoyeurs[0].video_upload_jeton_hash = hashA;
    const { sb } = creerDouble(etat);
    const r = await appeler(sb, { action: 'autoriser', jeton: JETON_A, mime: 'video/mp4', taille_octets: 1000, duree_secondes: 30, activites: ['renfort'] });
    check('4.8 Nettoyage seul -> aucune vidéo attendue, même si le client prétend le contraire',
      r.statut === 400 && r.json.code === 'VIDEO_NON_ATTENDUE', JSON.stringify(r.json));
  }

  // ── 5. Propriétaire authentifié ──
  {
    const etat = etatDeBase();
    etat.convoyeurs[0].auth_user_id = 'user-A';
    etat.sessions['jwt-A'] = 'user-A';
    etat.sessions['jwt-inconnu'] = null;
    const { sb } = creerDouble(etat);

    let r = await appeler(sb, { action: 'autoriser', mime: 'video/webm', taille_octets: 1000, duree_secondes: 30 }, { jwt: 'jwt-A' });
    check('5.1 Propriétaire authentifié autorisé via son auth.uid()',
      r.statut === 200 && r.json.chemin.startsWith(`candidatures/${ID_A}/`), JSON.stringify(r.json));

    r = await appeler(sb, { action: 'autoriser', mime: 'video/webm', taille_octets: 1000, duree_secondes: 30 }, { jwt: 'jwt-bidon' });
    check('5.2 JWT invalide -> refusé (401)', r.statut === 401 && r.json.code === 'UNAUTHORIZED', JSON.stringify(r.json));

    etat.sessions['jwt-C'] = 'user-C';   // authentifié mais sans candidature
    r = await appeler(sb, { action: 'autoriser', mime: 'video/webm', taille_octets: 1000, duree_secondes: 30 }, { jwt: 'jwt-C' });
    check('5.3 Authentifié sans candidature -> refusé (403)',
      r.statut === 403 && r.json.code === 'FORBIDDEN', JSON.stringify(r.json));
  }

  // ── 6. Confirmation, remplacement sans orphelin, usage unique ──
  {
    const etat = etatDeBase();
    etat.convoyeurs[0].video_upload_jeton_hash = hashA;
    const { sb, journal } = creerDouble(etat);

    const auto = await appeler(sb, { action: 'autoriser', jeton: JETON_A, mime: 'video/webm', taille_octets: 1000, duree_secondes: 30 });
    const chemin = auto.json.chemin;

    // Confirmation sans fichier réellement déposé
    let r = await appeler(sb, { action: 'confirmer', jeton: JETON_A });
    check('6.1 Confirmation refusée si le fichier n\'est pas arrivé',
      r.statut === 409 && r.json.code === 'ENVOI_INCOMPLET', JSON.stringify(r.json));
    check('6.2 Candidature toujours pas déclarée reçue', etat.convoyeurs[0].video_envoyee_le === null);

    // Un ancien fichier traîne dans le dossier (vidéo remplacée)
    etat.objets.push(`candidatures/${ID_A}/ancienne.webm`);
    etat.objets.push(chemin);
    r = await appeler(sb, { action: 'confirmer', jeton: JETON_A });
    check('6.3 Confirmation acceptée une fois le fichier présent', r.statut === 200 && r.json.ok === true, JSON.stringify(r.json));
    check('6.4 Remplacement : l\'ancien fichier est SUPPRIMÉ',
      journal.suppressions.includes(`candidatures/${ID_A}/ancienne.webm`), JSON.stringify(journal.suppressions));
    check('6.5 Remplacement : la vidéo confirmée est CONSERVÉE', etat.objets.includes(chemin));
    check('6.6 Aucun orphelin restant dans le dossier',
      etat.objets.filter(o => o.startsWith(`candidatures/${ID_A}/`)).length === 1, JSON.stringify(etat.objets));
    check('6.7 Vidéo déclarée reçue', !!etat.convoyeurs[0].video_envoyee_le);
    check('6.8 Statut passé de video_attendue à en_attente', etat.convoyeurs[0].statut === 'en_attente');
    check('6.9 Jeton consommé (usage unique)', etat.convoyeurs[0].video_upload_jeton_hash === null);

    // Rejouer le même jeton
    r = await appeler(sb, { action: 'confirmer', jeton: JETON_A });
    check('6.10 Rejouer un jeton déjà consommé -> refusé',
      r.statut === 403 && r.json.code === 'FORBIDDEN', JSON.stringify(r.json));
  }

  // ── 7. Surface d'attaque de la fonction ──
  {
    const etat = etatDeBase();
    const { sb } = creerDouble(etat);
    let r = await appeler(sb, { action: 'autoriser' }, { origine: 'https://site-pirate.invalid' });
    check('7.1 Origine non autorisée -> refusée (403)', r.statut === 403 && r.json.code === 'ORIGIN_NOT_ALLOWED');

    r = await appeler(sb, { action: 'supprimer_tout', jeton: JETON_A });
    check('7.2 Action inconnue -> refusée', r.statut === 400 && r.json.code === 'BAD_REQUEST');

    r = await appeler(sb, {}, { methode: 'GET' });
    check('7.3 Méthode non POST -> refusée', r.statut === 405 || r.statut === 400, String(r.statut));

    const cors = enTetesCors('https://site-pirate.invalid');
    check('7.4 Aucun en-tête CORS accordé à une origine inconnue',
      !cors.entetes['Access-Control-Allow-Origin'] && cors.autorisee === false);
    const corsOk = enTetesCors(ORIGINE);
    check('7.5 En-tête CORS accordé au site officiel',
      corsOk.entetes['Access-Control-Allow-Origin'] === ORIGINE && corsOk.autorisee === true);
  }

  // ── 8. Règle métier centralisée ──
  check('8.1 Durée max : nettoyage seul = aucune vidéo', dureeMaxPourActivites(['nettoyage']) === 0);
  check('8.2 Durée max : convoyage = 60 s', dureeMaxPourActivites(['convoyage']) === 60);
  check('8.3 Durée max : dès renfort = 120 s', dureeMaxPourActivites(['convoyage', 'renfort']) === 120);
  check('8.4 Durée max : format tableau texte PostgreSQL accepté',
    dureeMaxPourActivites('{convoyage,renfort}') === 120);

  // ── 9. Aucun secret ni URL persistée ──
  {
    const fs = await import('node:fs');
    // Chemins résolus depuis CE fichier : le test fonctionne quel que
    // soit le répertoire courant.
    const racine = new URL('../', import.meta.url);
    const lire = (rel) => fs.readFileSync(new URL(rel, racine), 'utf8');
    const fonction = lire('supabase/functions/candidature-video/index.ts');
    check('9.1 La clé service_role n\'est lue que depuis l\'environnement serveur',
      /Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)/.test(fonction)
      && !/eyJ[A-Za-z0-9_-]{20,}/.test(fonction), 'clé en dur détectée');
    const idx = lire('index.html');
    // Le mot « service_role » apparaît dans des commentaires qui
    // attestent justement que la clé reste côté serveur. Ce qui doit
    // être vérifié, c'est l'absence de clé RÉELLE : un JWT dont la
    // charge porte un rôle autre que « anon ».
    function jwtsPrivilegies(src) {
      return (src.match(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g) || [])
        .filter(j => {
          try {
            let p = j.split('.')[1]; p += '='.repeat((4 - p.length % 4) % 4);
            return (JSON.parse(Buffer.from(p, 'base64').toString('utf8')).role || '') !== 'anon';
          } catch { return false; }
        });
    }
    check('9.2 Aucune clé privilégiée réelle dans le navigateur',
      jwtsPrivilegies(idx).length === 0 && jwtsPrivilegies(lire('dashboard.html')).length === 0);
    check('9.2b Le navigateur ne lit jamais une variable de clé privilégiée',
      !/SUPABASE_SERVICE_ROLE_KEY/.test(idx));
    check('9.3 Le navigateur n\'écrit jamais directement dans le bucket',
      !/object\/candidatures-videos/.test(idx));
    check('9.4 Le navigateur envoie uniquement via une URL signée',
      /object\/upload\/sign\/candidatures-videos/.test(idx));
    check('9.5 Le navigateur ne propose aucun chemin de stockage',
      !/candidatures\/'\s*\+/.test(idx) && !/'candidatures\/'/.test(idx));
    const migration = lire('migrations/03_videos_candidature.sql');
    check('9.6 Aucune politique de stockage accordée à anon',
      !/for insert to anon|to anon, authenticated/.test(migration));
    check('9.7 Aucune URL signée n\'est stockée en base',
      !/signed_url|url_signee|video_url/i.test(migration));
    const dash = lire('dashboard.html');
    check('9.8 Le Dashboard ne persiste jamais l\'URL signée',
      /_urlVideoSignee = null/.test(dash) && !/localStorage[^\n]*signee/i.test(dash));
  }

  console.log('\n=== ' + pass + ' PASS / ' + fail + ' FAIL ===');
  if (echecs.length) echecs.forEach(e => console.log('  - ' + e));
  process.exit(fail > 0 ? 1 : 0);
})();
