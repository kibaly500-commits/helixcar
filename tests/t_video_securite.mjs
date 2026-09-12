// SÉCURITÉ DE L'ENVOI VIDÉO — exécute le VRAI code de la fonction
// serveur (supabase/functions/candidature-video/index.ts) contre un
// double Supabase en mémoire. Aucun réseau, aucune donnée réelle.
//
//   node tests/t_video_securite.mjs
//
// LOT V01. Le double applique désormais les CONTRAINTES CHECK de la
// base telles qu'elles sont réellement déployées (migration 03 :
// convoyeurs_video_coherente ; migration 105 : cohérence de l'envoi en
// cours). Un double qui acceptait tout ne pouvait pas voir le défaut
// de production — code 23514, « new row for relation "convoyeurs"
// violates check constraint "convoyeurs_video_coherente" ». Il le voit
// maintenant, et la section 10 le REPRODUIT contre l'ancien schéma
// d'écriture avant de prouver que le nouveau flux ne le déclenche
// jamais.
import {
  traiterRequete, hasherJeton, dureeMaxPourActivites, enTetesCors,
  ENTETES_AUTORISES, preflightAcceptable, enTeteCoherent, originesSupplementaires,
  TAILLE_MAX_OCTETS,
} from '../supabase/functions/candidature-video/index.ts';

let pass = 0, fail = 0; const echecs = [];
function check(l, c, e) {
  if (c) { console.log('PASS - ' + l); pass++; }
  else { console.log('FAIL - ' + l + (e ? '  [' + e + ']' : '')); fail++; echecs.push(l); }
}

const ORIGINE = 'https://helixcar-i89b.vercel.app';
const BUCKET = 'candidatures-videos';
const finalDe = p => p.slice(0,p.lastIndexOf('/')+1)+'verifie/'+p.slice(p.lastIndexOf('/')+1);
const HOTE_SIGNE = 'https://stockage.invalid/signe/';

// Lecture des fichiers du dépôt. Chemins résolus depuis CE fichier :
// le test fonctionne quel que soit le répertoire courant.
const fs = await import('node:fs');
const racine = new URL('../', import.meta.url);
const lire = (rel) => fs.readFileSync(new URL(rel, racine), 'utf8');

// ── Fixtures binaires : les VRAIS en-têtes des formats acceptés ──
function octets(...parts) {
  const out = [];
  for (const p of parts) {
    if (typeof p === 'string') for (const ch of p) out.push(ch.charCodeAt(0));
    else out.push(...p);
  }
  return Uint8Array.from(out);
}
// Rempli jusqu'à la taille voulue avec des octets quelconques.
function fichierDe(entete, taille) {
  const u = new Uint8Array(taille);
  u.set(entete.subarray(0, Math.min(entete.length, taille)));
  for (let i = entete.length; i < taille; i++) u[i] = (i * 31) & 0xff;
  return u;
}
const ENTETE_WEBM = octets([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00], 'webm', [0x42, 0x86, 0x81, 0x01]);
const ENTETE_MP4  = octets([0x00, 0x00, 0x00, 0x18], 'ftyp', 'isom', [0x00, 0x00, 0x02, 0x00], 'isomiso2mp41');
const ENTETE_MOV  = octets([0x00, 0x00, 0x00, 0x14], 'ftyp', 'qt  ', [0x00, 0x00, 0x00, 0x00], 'qt  ');
const ENTETE_AVI  = octets('RIFF', [0x00, 0x10, 0x00, 0x00], 'AVI LIST');
const ENTETE_TXT  = octets('Ceci n\'est pas une video, juste du texte renomme.');

// ── Les contraintes CHECK réellement déployées, reproduites ──
const MIMES = ['video/mp4', 'video/quicktime', 'video/webm'];
function contrainteViolee(l) {
  if (l.video_chemin != null && (l.video_mime == null || l.video_taille_octets == null || l.video_envoyee_le == null)) {
    return 'convoyeurs_video_coherente';
  }
  if (l.video_mime != null && !MIMES.includes(l.video_mime)) return 'convoyeurs_video_mime_valide';
  if (l.video_duree_secondes != null && l.video_duree_secondes > 120) return 'convoyeurs_video_duree_plafond';
  if (l.video_envoi_chemin != null && (l.video_envoi_mime == null || l.video_envoi_taille_octets == null || l.video_envoi_commence_le == null)) {
    return 'convoyeurs_video_envoi_coherent';
  }
  if (l.video_envoi_mime != null && !MIMES.includes(l.video_envoi_mime)) return 'convoyeurs_video_envoi_mime_valide';
  if (l.video_envoi_duree_secondes != null && l.video_envoi_duree_secondes > 120) return 'convoyeurs_video_envoi_duree_plafond';
  return null;
}
function erreurContrainte(nom) {
  return { code: '23514', message: 'new row for relation "convoyeurs" violates check constraint "' + nom + '"' };
}

// ── Double Supabase en mémoire ──────────────────────────────
// etat.objets : { chemin: Uint8Array } — les objets réellement déposés
// dans le bucket, avec leurs octets.
function creerDouble(etat) {
  const journal = { signatures: [], suppressions: [], majs: [], refus: [], rpc: [], lecturesEnTete: [] };
  etat.objets = etat.objets || {};
  etat.verifications = etat.verifications || [];
  const sb = {
    auth: {
      async getUser(jwt) {
        const u = etat.sessions[jwt];
        return u ? { data: { user: { id: u } }, error: null }
                 : { data: null, error: { message: 'invalid jwt' } };
      },
    },
    from(table) {
      const lignes=table==='video_verifications'?etat.verifications:etat.convoyeurs;
      const req = { table, filtres: {}, _maj: null };
      const api = {
        select() { return api; },
        eq(col, val) { req.filtres[col] = val; return api; },
        async maybeSingle() {
          const ligne = lignes.find(c =>
            Object.entries(req.filtres).every(([k, v]) => c[k] === v));
          return { data: ligne ? { ...ligne } : null, error: null };
        },
        insert(valeurs) { lignes.push({...valeurs,created_at:new Date().toISOString()});return Promise.resolve({error:null}); },
        update(valeurs) { req._maj = valeurs; return api; },
        then(resolve) {   // `await sb.from().update().eq()` termine ici
          const cible = lignes.find(c =>
            Object.entries(req.filtres).every(([k, v]) => c[k] === v));
          if (cible && req._maj) {
            // COMME POSTGRESQL : la ligne candidate est évaluée AVANT
            // d'être écrite ; une contrainte violée annule l'écriture.
            const candidate = Object.assign({}, cible, req._maj);
            const viol = contrainteViolee(candidate);
            if (viol) {
              journal.refus.push({ id: cible.id, contrainte: viol, maj: { ...req._maj } });
              return Promise.resolve({ error: erreurContrainte(viol) }).then(resolve);
            }
            Object.assign(cible, req._maj);
            journal.majs.push({ id: cible.id, ...req._maj });
          }
          return Promise.resolve({ error: null }).then(resolve);
        },
      };
      return api;
    },
    // La fonction SQL finaliser_video_candidature (migration 105),
    // reproduite fidèlement : mêmes codes, mêmes écritures, même
    // idempotence. La preuve côté base réelle est apportée à part par
    // tests/t_rls.sh (section VID) sur PostgreSQL 16.
    async rpc(nom, args) {
      journal.rpc.push({ nom, args: { ...args } });
      if(nom==='preparer_video_candidature'){
        const c=etat.convoyeurs.find(x=>x.id===args.p_id);if(!c)return{data:{ok:false},error:null};
        if(c.video_envoyee_le)return{data:{ok:true,deja_confirmee:true,chemin:c.video_chemin},error:null};
        const reprise=!!(c.video_envoi_chemin&&c.video_envoi_mime===args.p_mime&&c.video_envoi_taille_octets===args.p_taille&&c.video_envoi_duree_secondes===args.p_duree&&!etat.verifications.some(v=>v.chemin_source===c.video_envoi_chemin&&v.etat==='refuse'));
        const ext={'video/webm':'.webm','video/quicktime':'.mov','video/mp4':'.mp4'}[args.p_mime];
        const chemin=reprise?c.video_envoi_chemin:'candidatures/'+c.id+'/'+crypto.randomUUID()+ext;
        Object.assign(c,{video_envoi_chemin:chemin,video_envoi_mime:args.p_mime,video_envoi_taille_octets:args.p_taille,video_envoi_duree_secondes:args.p_duree,video_envoi_commence_le:reprise?c.video_envoi_commence_le:new Date().toISOString()});
        journal.majs.push({id:c.id,...c});return{data:{ok:true,chemin,reprise},error:null};
      }
      if(nom==='finaliser_video_verifiee'){
        const c=etat.convoyeurs.find(x=>x.id===args.p_id);
        if(!c)return{data:{ok:false},error:null};
        if(c.video_envoyee_le)return{data:{ok:true,code:'DEJA_FINALISEE',chemin:c.video_chemin,statut:c.statut},error:null};
        const v=etat.verifications.find(x=>x.chemin_source===args.p_chemin_source&&x.etat==='verifie');
        if(c.video_envoi_chemin!==args.p_chemin_source||!v)return{data:{ok:false,code:'ENVOI_REMPLACE'},error:null};
        args={...args,p_convoyeur_id:args.p_id,p_taille_reelle:v.taille_octets,verification:v};
      }
      if (nom !== 'finaliser_video_verifiee') return { data: null, error: { message: 'function ' + nom + ' does not exist' } };
      if (etat.rpcKo) return { data: null, error: { message: 'connection reset' } };
      const c = etat.convoyeurs.find(x => x.id === args.p_convoyeur_id);
      if (!c) return { data: { ok: false, code: 'INTROUVABLE' }, error: null };
      if (c.video_envoi_chemin == null) {
        if (c.video_chemin != null && c.video_envoyee_le != null) {
          return { data: { ok: true, code: 'DEJA_FINALISEE', chemin: c.video_chemin, statut: c.statut }, error: null };
        }
        return { data: { ok: false, code: 'AUCUN_ENVOI' }, error: null };
      }
      if (args.p_taille_reelle != null && args.p_taille_reelle !== c.video_envoi_taille_octets) {
        return { data: { ok: false, code: 'TAILLE_INCOHERENTE', declaree: c.video_envoi_taille_octets, reelle: args.p_taille_reelle }, error: null };
      }
      const ancien = (c.video_chemin != null && c.video_chemin !== c.video_envoi_chemin) ? c.video_chemin : null;
      const statut = c.statut === 'video_attendue' ? 'en_attente' : c.statut;
      const maintenant = new Date().toISOString();
      const candidate = Object.assign({}, c, {
        video_chemin: args.verification.chemin_final, video_mime: c.video_envoi_mime,
        video_taille_octets: args.p_taille_reelle != null ? args.p_taille_reelle : c.video_envoi_taille_octets,
        video_duree_secondes: args.verification.duree_secondes, video_envoyee_le: maintenant,
        video_envoi_chemin: null, video_envoi_mime: null, video_envoi_taille_octets: null,
        video_envoi_duree_secondes: null, video_envoi_commence_le: null,
        video_upload_jeton_consomme_le: c.video_upload_jeton_consomme_le || maintenant,
        statut,
      });
      const viol = contrainteViolee(candidate);
      if (viol) { journal.refus.push({ id: c.id, contrainte: viol, maj: 'rpc' }); return { data: null, error: erreurContrainte(viol) }; }
      const chemin = candidate.video_chemin;
      Object.assign(c, candidate);
      journal.majs.push({ id: c.id, rpc: 'finaliser', chemin });
      return { data: { ok: true, code: 'FINALISEE', chemin, ancien_chemin: ancien, statut }, error: null };
    },
    storage: {
      from(bucket) {
        return {
          async copy(source,cible){if(etat.objets[cible])return{error:{code:'exists'}};if(!etat.objets[source])return{error:{code:'missing'}};etat.objets[cible]=etat.objets[source].slice();return{error:null};},
          async createSignedUploadUrl(chemin, options) {
            journal.signatures.push({ bucket, chemin, upsert: !!(options && options.upsert) });
            if (etat.stockageKo) return { data: null, error: { message: 'storage down' } };
            return { data: { token: 'jeton-upload-' + chemin, path: chemin, signedUrl: 'https://x.invalid/' + chemin }, error: null };
          },
          async createSignedUrl(chemin, duree) {
            journal.lecturesEnTete.push({ bucket, chemin, duree });
            if (etat.stockageKo || etat.lectureKo) return { data: null, error: { message: 'storage down' } };
            if (!(chemin in etat.objets)) return { data: null, error: { message: 'Object not found' } };
            return { data: { signedUrl: HOTE_SIGNE + chemin + '?token=lecture-' + duree }, error: null };
          },
          async list(prefixe) {
            if (etat.stockageKo) return { data: null, error: { message: 'storage down' } };
            const noms = Object.keys(etat.objets)
              .filter(o => o.startsWith(prefixe + '/'))
              .map(o => ({ name: o.slice(prefixe.length + 1),
                           metadata: etat.sansMetadonnees ? undefined : { size: etat.objets[o].length, mimetype: 'application/octet-stream' } }));
            return { data: noms, error: null };
          },
          async remove(chemins) {
            journal.suppressions.push(...chemins);
            for (const ch of chemins) delete etat.objets[ch];
            return { error: null };
          },
        };
      },
    },
  };
  return { sb, journal };
}

// Le fetch global : la fonction relit les 64 premiers octets de
// l'objet via son URL signée. Le double sert ces octets, et honore
// l'en-tête Range comme le stockage réel (206).
const ETATS_PAR_HOTE = { courant: null };
globalThis.fetch = async function (url, options) {
  const u = String(url);
  if(u==='https://validation.invalid/verifier'){
    const etat=ETATS_PAR_HOTE.courant,corps=JSON.parse(options.body);
    const c=etat.convoyeurs.find(c=>c.id===corps.candidature_id);
    if(etat.workerCode)return Response.json({ok:false,code:etat.workerCode},{status:422});
    return Response.json({ok:true,taille_octets:c.video_envoi_taille_octets,duree_secondes:etat.workerDuree??c.video_envoi_duree_secondes,mime:c.video_envoi_mime,codec:'TEST-QA-double',sha256:'a'.repeat(64)});
  }
  if (!u.startsWith(HOTE_SIGNE)) throw new Error('réseau coupé : ' + u);
  const chemin = u.slice(HOTE_SIGNE.length).split('?')[0];
  const etat = ETATS_PAR_HOTE.courant;
  const corps = etat && etat.objets[chemin];
  if (!corps) return new Response('not found', { status: 404 });
  const range = options && options.headers && (options.headers.Range || options.headers.range);
  let tranche = corps;
  let statut = 200;
  const m = /^bytes=(\d+)-(\d+)$/.exec(range || '');
  if (m) { tranche = corps.subarray(Number(m[1]), Number(m[2]) + 1); statut = 206; }
  etat.requetesLecture = (etat.requetesLecture || 0) + 1;
  etat.derniereLecture = { range: range || null, octetsServis: tranche.length };
  return new Response(tranche, { status: statut, headers: { 'Content-Type': 'application/octet-stream' } });
};

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
  const rep = await traiterRequete(sb, requete(corps, options),{HELIXCAR_VIDEO_VALIDATION_URL:'https://validation.invalid/verifier',HELIXCAR_VIDEO_VALIDATION_SECRET:'TEST-QA-CLAUDE-HELIXCAR-secret-double'});
  let json = null;
  try { json = await rep.clone().json(); } catch { /* corps vide */ }
  return { statut: rep.status, json, entetes: rep.headers };
}

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';

function ligneDeBase(id, activites) {
  return {
    id, activites, auth_user_id: null, created_at: new Date().toISOString(),
    statut: 'video_attendue',
    video_chemin: null, video_mime: null, video_taille_octets: null, video_duree_secondes: null,
    video_envoyee_le: null,
    video_upload_jeton_hash: null, video_upload_jeton_consomme_le: null,
    video_envoi_chemin: null, video_envoi_mime: null, video_envoi_taille_octets: null,
    video_envoi_duree_secondes: null, video_envoi_commence_le: null,
  };
}
function etatDeBase() {
  const etat = {
    sessions: {},
    objets: {},
    convoyeurs: [ligneDeBase(ID_A, ['convoyage']), ligneDeBase(ID_B, ['convoyage', 'renfort'])],
  };
  ETATS_PAR_HOTE.courant = etat;
  return etat;
}
// Aucune ligne ne doit JAMAIS être dans un état que la base refuse.
function toutesLignesCoherentes(etat) {
  return etat.convoyeurs.every(l => contrainteViolee(l) === null);
}

const JETON_A = 'a'.repeat(64);
const JETON_B = 'b'.repeat(64);

async function executerSuite() {
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
    check('2.7 Le chemin attendu est noté comme ENVOI EN COURS sur LA bonne candidature',
      etat.convoyeurs[0].video_envoi_chemin === r.json.chemin && etat.convoyeurs[1].video_envoi_chemin === null);
    check('2.8 La vidéo n\'est pas déclarée reçue avant confirmation (video_chemin ET video_envoyee_le nuls)',
      etat.convoyeurs[0].video_chemin === null && etat.convoyeurs[0].video_envoyee_le === null);
    check('2.9 LOT V01 : aucune contrainte de la base violée par l\'autorisation',
      journal.refus.length === 0 && toutesLignesCoherentes(etat), JSON.stringify(journal.refus));
    check('2.10 L\'instant de début d\'envoi est enregistré, la taille et la durée annoncées aussi',
      !!etat.convoyeurs[0].video_envoi_commence_le && etat.convoyeurs[0].video_envoi_taille_octets === 1000
      && etat.convoyeurs[0].video_envoi_duree_secondes === 30);
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
      !rA.json.chemin.includes(ID_B) && etat.convoyeurs[1].video_envoi_chemin === null);
  }

  // ── 4. Contrôles serveur du format, de la taille et de la durée ──
  {
    const etat = etatDeBase();
    etat.convoyeurs[0].video_upload_jeton_hash = hashA;   // convoyage seul -> 120 s
    etat.convoyeurs[1].video_upload_jeton_hash = hashB;   // renfort -> 120 s
    const { sb, journal } = creerDouble(etat);

    let r = await appeler(sb, { action: 'autoriser', jeton: JETON_A, mime: 'video/x-msvideo', taille_octets: 1000, duree_secondes: 30 });
    check('4.1 Format refusé côté SERVEUR', r.statut === 400 && r.json.code === 'FORMAT_REFUSE', JSON.stringify(r.json));

    // La limite est passée à 300 Mo : le refus se teste au-dessus.
    r = await appeler(sb, { action: 'autoriser', jeton: JETON_A, mime: 'video/mp4', taille_octets: 301 * 1024 * 1024, duree_secondes: 30 });
    check('4.2 Taille refusée côté SERVEUR au-delà de 300 Mo', r.statut === 400 && r.json.code === 'TAILLE_REFUSEE', JSON.stringify(r.json));

    r = await appeler(sb, { action: 'autoriser', jeton: JETON_A, mime: 'video/mp4', taille_octets: 1000, duree_secondes: 90 });
    check('4.3 90 s acceptées pour un candidat convoyage (max 120 s)',
      r.statut === 200 && r.json.ok === true, JSON.stringify(r.json));

    r = await appeler(sb, { action: 'autoriser', jeton: JETON_B, mime: 'video/mp4', taille_octets: 1000, duree_secondes: 90 });
    check('4.4 90 s acceptées pour un candidat avec renfort (max 120 s)',
      r.statut === 200 && r.json.ok === true, JSON.stringify(r.json));

    r = await appeler(sb, { action: 'autoriser', jeton: JETON_B, mime: 'video/mp4', taille_octets: 1000, duree_secondes: 150 });
    check('4.5 150 s refusées même avec renfort', r.statut === 400 && r.json.code === 'DUREE_REFUSEE');

    r = await appeler(sb, { action: 'autoriser', jeton: JETON_A, mime: 'video/mp4', taille_octets: 1000, duree_secondes: 0 });
    check('4.6 Durée non vérifiable refusée', r.statut === 400 && r.json.code === 'DUREE_REFUSEE');

    check('4.7 Aucune signature émise pour les demandes refusées',
      journal.signatures.length === 2, 'signatures=' + journal.signatures.length);

    // Contrôle inverse, APRÈS le comptage des refus : une taille
    // désormais légitime doit bien être acceptée.
    r = await appeler(sb, { action: 'autoriser', jeton: JETON_A, mime: 'video/mp4', taille_octets: 214 * 1024 * 1024, duree_secondes: 30 });
    check('4.9 Une vidéo réaliste de 214 Mo est acceptée', r.statut === 200 && !!r.json.chemin, JSON.stringify(r.json));

    // BORNES EXACTES DE LA LIMITE, en octets : 300 Mo = 314 572 800.
    // limite-1, limite, limite+1 — la conversion est celle de la
    // migration 93 et du navigateur, ni arrondie ni « à peu près ».
    check('4.10 La limite serveur vaut exactement 314 572 800 octets (300 × 1024 × 1024)',
      TAILLE_MAX_OCTETS === 314572800, String(TAILLE_MAX_OCTETS));
    r = await appeler(sb, { action: 'autoriser', jeton: JETON_A, mime: 'video/mp4', taille_octets: 314572799, duree_secondes: 30 });
    check('4.11 limite − 1 octet : acceptée', r.statut === 200, JSON.stringify(r.json));
    r = await appeler(sb, { action: 'autoriser', jeton: JETON_A, mime: 'video/mp4', taille_octets: 314572800, duree_secondes: 30 });
    check('4.12 limite exacte : acceptée', r.statut === 200, JSON.stringify(r.json));
    r = await appeler(sb, { action: 'autoriser', jeton: JETON_A, mime: 'video/mp4', taille_octets: 314572801, duree_secondes: 30 });
    check('4.13 limite + 1 octet : refusée', r.statut === 400 && r.json.code === 'TAILLE_REFUSEE', JSON.stringify(r.json));
    // Autour de 120 s, pour un candidat renfort : 119,5 / 120 / 120,6.
    r = await appeler(sb, { action: 'autoriser', jeton: JETON_B, mime: 'video/mp4', taille_octets: 1000, duree_secondes: 119 });
    check('4.14 119 s (le cas réel de 1 min 59 s) : acceptée avec renfort', r.statut === 200, JSON.stringify(r.json));
    r = await appeler(sb, { action: 'autoriser', jeton: JETON_B, mime: 'video/mp4', taille_octets: 1000, duree_secondes: 120 });
    check('4.15 120 s exactement : acceptée', r.statut === 200, JSON.stringify(r.json));
    r = await appeler(sb, { action: 'autoriser', jeton: JETON_B, mime: 'video/mp4', taille_octets: 1000, duree_secondes: 121 });
    check('4.16 121 s : refusée', r.statut === 400 && r.json.code === 'DUREE_REFUSEE', JSON.stringify(r.json));
    r = await appeler(sb, { action: 'autoriser', jeton: JETON_A, mime: 'video/mp4', taille_octets: 0, duree_secondes: 30 });
    check('4.17 Un fichier vide (0 octet) est refusé dès l\'autorisation', r.statut === 400 && r.json.code === 'TAILLE_REFUSEE');
    r = await appeler(sb, { action: 'autoriser', jeton: JETON_A, mime: 'video/mp4', taille_octets: 12.5, duree_secondes: 30 });
    check('4.18 Une taille non entière est refusée', r.statut === 400 && r.json.code === 'TAILLE_REFUSEE');
    check('4.19 Le cas réel de production (214,6 Mo, 119 s, renfort) est accepté',
      (await appeler(sb, { action: 'autoriser', jeton: JETON_B, mime: 'video/quicktime', taille_octets: 225024410, duree_secondes: 119 })).statut === 200);
  }
  {
    // Le serveur relit les ACTIVITÉS EN BASE, pas ce que dit le client.
    const etat = etatDeBase();
    etat.convoyeurs[0].activites = ['nettoyage'];
    etat.convoyeurs[0].video_upload_jeton_hash = hashA;
    const { sb } = creerDouble(etat);
    const r = await appeler(sb, { action: 'autoriser', jeton: JETON_A, mime: 'video/mp4', taille_octets: 1000, duree_secondes: 30, activites: ['renfort'] });
    check('4.8 Nettoyage seul -> vidéo acceptée avec la règle lue en base',
      r.statut === 200 && r.json.ok === true, JSON.stringify(r.json));
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

  // ── 6. Confirmation, vérifications réelles, remplacement, usage unique ──
  {
    const etat = etatDeBase();
    etat.convoyeurs[0].video_upload_jeton_hash = hashA;
    const { sb, journal } = creerDouble(etat);

    const TAILLE = 2676;
    const auto = await appeler(sb, { action: 'autoriser', jeton: JETON_A, mime: 'video/webm', taille_octets: TAILLE, duree_secondes: 30 });
    const chemin = auto.json.chemin;

    // Confirmation sans fichier réellement déposé
    let r = await appeler(sb, { action: 'confirmer', jeton: JETON_A });
    check('6.1 Confirmation refusée si le fichier n\'est pas arrivé',
      r.statut === 409 && r.json.code === 'ENVOI_INCOMPLET', JSON.stringify(r.json));
    check('6.2 Candidature toujours pas déclarée reçue', etat.convoyeurs[0].video_envoyee_le === null && etat.convoyeurs[0].video_chemin === null);

    // Fichier TRONQUÉ : l'objet existe mais n'a pas la taille annoncée.
    etat.objets[chemin] = fichierDe(ENTETE_WEBM, 1500);
    r = await appeler(sb, { action: 'confirmer', jeton: JETON_A });
    check('6.3a Un envoi tronqué (taille réelle ≠ annoncée) n\'est jamais finalisé',
      r.statut === 409 && r.json.code === 'TAILLE_INCOHERENTE', JSON.stringify(r.json));
    check('6.3b ... et la ligne reste un envoi en cours, cohérent',
      etat.convoyeurs[0].video_chemin === null && etat.convoyeurs[0].video_envoi_chemin === chemin && toutesLignesCoherentes(etat));

    // Fichier de la bonne taille mais qui N'EST PAS une vidéo WebM.
    etat.objets[chemin] = fichierDe(ENTETE_TXT, TAILLE);
    r = await appeler(sb, { action: 'confirmer', jeton: JETON_A });
    check('6.3c Un fichier renommé (texte) de la bonne taille est refusé : FORMAT_INCOHERENT',
      r.statut === 409 && r.json.code === 'FORMAT_INCOHERENT', JSON.stringify(r.json));
    check('6.3d ... le fichier invalide est retiré du bucket', !(chemin in etat.objets), JSON.stringify(Object.keys(etat.objets)));
    check('6.3e ... l\'envoi en cours reste ouvert pour un nouveau fichier',
      etat.convoyeurs[0].video_envoi_chemin === chemin && etat.convoyeurs[0].video_chemin === null);
    // AVI annoncé comme MP4 : refusé aussi.
    etat.objets[chemin] = fichierDe(ENTETE_AVI, TAILLE);
    r = await appeler(sb, { action: 'confirmer', jeton: JETON_A });
    check('6.3f Un AVI déguisé est refusé', r.statut === 409 && r.json.code === 'FORMAT_INCOHERENT');

    // Un ancien fichier traîne dans le dossier (vidéo remplacée), puis
    // le bon fichier arrive, complet et lisible.
    etat.objets[`candidatures/${ID_A}/ancienne.webm`] = fichierDe(ENTETE_WEBM, 999);
    etat.objets[chemin] = fichierDe(ENTETE_WEBM, TAILLE);
    r = await appeler(sb, { action: 'confirmer', jeton: JETON_A });
    check('6.3 Confirmation acceptée une fois le fichier présent, complet et lisible', r.statut === 200 && r.json.ok === true, JSON.stringify(r.json));
    check('6.4 Un dépôt potentiellement actif n’est pas supprimé pendant la finalisation',
      !journal.suppressions.includes(`candidatures/${ID_A}/ancienne.webm`), JSON.stringify(journal.suppressions));
    check('6.5 Remplacement : la vidéo confirmée est CONSERVÉE', chemin in etat.objets);
    check('6.6 Copie validée distincte et trace de réconciliation conservée',
      finalDe(chemin) in etat.objets && etat.verifications.some(v=>v.chemin_source===chemin&&v.etat==='verifie'), JSON.stringify(Object.keys(etat.objets)));
    check('6.7 Vidéo déclarée reçue', !!etat.convoyeurs[0].video_envoyee_le);
    check('6.8 Statut passé de video_attendue à en_attente', etat.convoyeurs[0].statut === 'en_attente');
    check('6.9 Jeton consommé (usage unique) : instant de consommation posé', !!etat.convoyeurs[0].video_upload_jeton_consomme_le);
    check('6.9b LOT V01 : les QUATRE colonnes finales écrites ENSEMBLE, valeurs cohérentes',
      etat.convoyeurs[0].video_chemin === finalDe(chemin) && etat.convoyeurs[0].video_mime === 'video/webm'
      && etat.convoyeurs[0].video_taille_octets === TAILLE && etat.convoyeurs[0].video_duree_secondes === 30
      && !!etat.convoyeurs[0].video_envoyee_le, JSON.stringify(etat.convoyeurs[0]));
    check('6.9c LOT V01 : les colonnes d\'envoi en cours sont vidées',
      etat.convoyeurs[0].video_envoi_chemin === null && etat.convoyeurs[0].video_envoi_mime === null
      && etat.convoyeurs[0].video_envoi_taille_octets === null && etat.convoyeurs[0].video_envoi_commence_le === null);
    check('6.9d LOT V01 : la finalisation est passée par la fonction SQL, avec la taille RÉELLE de l\'objet',
      journal.rpc.filter(x=>x.nom==='finaliser_video_verifiee').length === 1
      && etat.verifications[0].taille_octets === TAILLE, JSON.stringify(journal.rpc));
    check('6.9e LOT V01 : aucune contrainte violée sur tout le parcours',
      journal.refus.length === 0 && toutesLignesCoherentes(etat), JSON.stringify(journal.refus));
    check('6.9f La lecture d\'en-tête n\'a demandé que les 64 premiers octets (Range), jamais le fichier entier',
      etat.derniereLecture && etat.derniereLecture.range === 'bytes=0-63' && etat.derniereLecture.octetsServis <= 64,
      JSON.stringify(etat.derniereLecture));

    // REJOUER la confirmation : réponse perdue, second clic.
    const majsAvant = journal.majs.length;
    r = await appeler(sb, { action: 'confirmer', jeton: JETON_A });
    check('6.10 Rejouer la confirmation après succès -> ok, IDEMPOTENT (deja_confirmee)',
      r.statut === 200 && r.json.ok === true && r.json.deja_confirmee === true, JSON.stringify(r.json));
    check('6.10b ... sans aucune écriture supplémentaire', journal.majs.length === majsAvant);
    // REJOUER l'autorisation avec le jeton consommé : aucune nouvelle
    // signature, aucun nouvel envoi — mais pas une erreur trompeuse.
    const sigAvant = journal.signatures.length;
    r = await appeler(sb, { action: 'autoriser', jeton: JETON_A, mime: 'video/webm', taille_octets: TAILLE, duree_secondes: 30 });
    check('6.11 Rejouer « autoriser » avec un jeton consommé -> deja_confirmee, AUCUNE signature',
      r.statut === 200 && r.json.deja_confirmee === true && journal.signatures.length === sigAvant, JSON.stringify(r.json));
    check('6.11b ... et aucune colonne d\'envoi en cours rouverte', etat.convoyeurs[0].video_envoi_chemin === null);
    r = await appeler(sb, { action: 'prolonger', jeton: JETON_A });
    check('6.12 « prolonger » avec un jeton consommé -> refusé (409 DEJA_CONFIRMEE)',
      r.statut === 409 && r.json.code === 'DEJA_CONFIRMEE', JSON.stringify(r.json));
    // Un jeton consommé sur une candidature SANS vidéo finalisée (état
    // impossible par construction, mais on ne fait pas confiance) : refus.
    etat.convoyeurs[0].video_chemin = null; etat.convoyeurs[0].video_envoyee_le = null;
    etat.convoyeurs[0].video_mime = null; etat.convoyeurs[0].video_taille_octets = null;
    r = await appeler(sb, { action: 'confirmer', jeton: JETON_A });
    check('6.13 Jeton consommé sans vidéo finalisée -> refusé (403)', r.statut === 403 && r.json.code === 'FORBIDDEN');
  }

  // ── 6 bis. Reprise d'un envoi en cours, et remplacement par le propriétaire ──
  {
    const etat = etatDeBase();
    etat.convoyeurs[0].video_upload_jeton_hash = hashA;
    const { sb, journal } = creerDouble(etat);
    const r1 = await appeler(sb, { action: 'autoriser', jeton: JETON_A, mime: 'video/mp4', taille_octets: 5000, duree_secondes: 20 });
    const r2 = await appeler(sb, { action: 'autoriser', jeton: JETON_A, mime: 'video/mp4', taille_octets: 5000, duree_secondes: 20 });
    check('6b.1 Une seconde autorisation (page relancée) REPREND le même chemin',
      r1.json.chemin === r2.json.chemin && r2.json.reprise === true && r1.json.reprise === false, JSON.stringify([r1.json, r2.json]));
    check('6b.2 ... l\'instant de début d\'envoi n\'est pas remis à zéro',
      journal.majs.length === 2 && journal.majs[0].video_envoi_commence_le === journal.majs[1].video_envoi_commence_le);
    check('6b.3 ... la signature de reprise autorise l\'écrasement du même objet (upsert)',
      journal.signatures[1].upsert === true && journal.signatures[0].upsert === true, JSON.stringify(journal.signatures));
    const r3 = await appeler(sb, { action: 'autoriser', jeton: JETON_A, mime: 'video/webm', taille_octets: 5000, duree_secondes: 20 });
    chec