import {verifierObjet} from "./verification.ts";
import {reconcilierVideos} from "./reconciliation.ts";
// deno-lint-ignore-file no-explicit-any
// ============================================================
// HelixCar — Edge Function « candidature-video »
// ============================================================
// AUTORISATION D'ENVOI DE LA VIDÉO DE CANDIDATURE, EN DEUX PHASES.
//
// Raison d'être : une candidature partenaire est déposée SANS compte.
// Il n'existe donc aucun auth.uid() au moment de l'envoi. Plutôt que
// d'ouvrir le bucket à `anon` — ce qui laisserait n'importe qui écrire
// et choisir le chemin d'une autre candidature — le dépôt passe
// exclusivement par ici.
//
// Cette fonction est le SEUL détenteur de la clé service_role, côté
// serveur uniquement. Le navigateur ne la reçoit jamais : il n'obtient
// qu'une URL d'envoi signée, temporaire, liée à UN chemin précis que
// le serveur a lui-même généré.
//
// ------------------------------------------------------------
// LE DÉFAUT DE PRODUCTION CORRIGÉ ICI (lot V01, code 23514)
// ------------------------------------------------------------
// La version précédente écrivait, dès l'action « autoriser »,
// video_chemin + video_mime + video_taille_octets en laissant
// video_envoyee_le à NULL pour dire « pas encore reçue ». Or la
// contrainte `convoyeurs_video_coherente` (migration 03) interdit
// exactement cet état : un chemin sans date d'envoi est une écriture
// partielle. La base refusait donc la PREMIÈRE écriture, avant tout
// envoi, et le candidat lisait « Erreur serveur ».
//
// La contrainte est conservée telle quelle. Le flux respecte
// désormais la cohérence À CHAQUE INSTANT :
//
//   PHASE 1 — « autoriser » : contrôles serveur (format, taille,
//     durée selon les activités RÉELLEMENT enregistrées), chemin
//     généré ici, URL signée courte. L'envoi EN COURS est noté dans
//     ses propres colonnes (video_envoi_*, migration 105). Les quatre
//     colonnes finales ne sont PAS touchées.
//
//   PHASE 2 — « confirmer » : présence réelle de l'objet dans le
//     bucket privé, taille réelle comparée à la taille annoncée,
//     en-tête binaire relu (MP4/MOV/WebM), puis copie privée et mesure/décodage par le worker. Finalisation ATOMIQUE
//     par la fonction SQL finaliser_video_verifiee : video_chemin,
//     video_mime, video_taille_octets et video_envoyee_le sont écrits
//     ENSEMBLE, avec la date réelle de finalisation. Réconciliation des
//     orphelins après expiration, sans supprimer les uploads actifs.
//
// Ce qui reste vrai, comme avant :
//   * le chemin est calculé ici : 'candidatures/<id>/<uuid>.<ext>' ;
//   * l'appelant prouve son droit par sa session (propriétaire réel)
//     ou par un jeton à usage unique lié à une candidature déjà créée ;
//   * la base ne contient que le SHA-256 du jeton ;
//   * aucune URL signée de LECTURE n'est délivrée au candidat : la
//     lecture reste réservée aux administrateurs et au propriétaire
//     authentifié, via les politiques du bucket.
//
// Idempotence (lot V01) : une confirmation rejouée après succès —
// réponse perdue, second clic — répond ok/deja_confirmee sans rien
// réécrire ni recréer. Un jeton consommé ne peut plus autoriser AUCUNE
// écriture : « autoriser » et « prolonger » le refusent.
//
// Déploiement (à faire par HelixCar, non exécuté ici) :
//   supabase functions deploy candidature-video
// Variables déjà présentes dans l'environnement des Edge Functions :
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const BUCKET = "candidatures-videos";

// Formats réellement pris en charge — doit rester aligné avec
// allowed_mime_types du bucket et avec CONV_VIDEO_MIMES côté site.
const EXTENSION_PAR_MIME: Record<string, string> = {
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
};
// 300 Mo — aligné sur le navigateur, sur le bucket (migration 93) et
// sur la limite globale Supabase Storage à régler manuellement.
// 300 × 1024 × 1024 = 314 572 800 octets, exactement la valeur de 93.
export const TAILLE_MAX_OCTETS = 300 * 1024 * 1024;

// Fenêtre pendant laquelle une candidature tout juste créée peut
// encore envoyer sa vidéo. Volontairement dérivée de created_at :
// aucune colonne modifiable par le navigateur ne peut l'allonger.
const FENETRE_ENVOI_MINUTES = 120;

// Supabase Storage signe les uploads pour DEUX HEURES (SDK actuel).
// Ne pas afficher une promesse de 30 minutes que le serveur ne tient pas.
// Ces signatures concernent seulement la source temporaire ; jamais la
// copie finale immuable. Le parcours se consomme lors de la finalisation.
const VALIDITE_URL_ENVOI_SECONDES = 2 * 60 * 60;

// Origines autorisées — LISTE EXPLICITE, jamais un joker.
//
// Les deux domaines officiels. La comparaison est une égalité stricte
// de chaîne : schéma, port et sous-domaine comptent. Ni « * », ni renvoi
// en miroir de l'origine demandée, ni correspondance par préfixe ou
// suffixe — https://helixcar.vercel.app.pirate.tld reste refusé.
//
// Futur domaine (décision C07) : il s'ajoute par la variable
// d'environnement HELIXCAR_ORIGINES_SUPPLEMENTAIRES (liste séparée par
// des virgules), SANS retirer les origines Vercel pendant la
// transition et SANS modifier ce fichier. Rien n'est activé tant que
// la variable n'est pas définie par HelixCar.
export const ORIGINES_AUTORISEES: string[] = [
  "https://helixcar.vercel.app",       // site de production
  "https://helixcar-i89b.vercel.app",  // déploiement d'aperçu
  "https://helixcar-git-codex-helixcar-f-0253b9-kibaly500-commits-projects.vercel.app",
  "https://helixcar-i89b-git-codex-helix-b25bf8-kibaly500-commits-projects.vercel.app",
];
export function originesSupplementaires(valeur: string | null | undefined): string[] {
  return String(valeur || "")
    .split(",")
    .map((o) => o.trim())
    .filter((o) => /^https:\/\/[a-z0-9.-]+$/i.test(o));
}
if (typeof Deno !== "undefined" && Deno.env) {
  for (const o of originesSupplementaires(Deno.env.get("HELIXCAR_ORIGINES_SUPPLEMENTAIRES"))) {
    if (!ORIGINES_AUTORISEES.includes(o)) ORIGINES_AUTORISEES.push(o);
  }
  if (Deno.env.get("ALLOW_LOCALHOST_CORS") === "true") {
    ORIGINES_AUTORISEES.push("http://localhost:3000", "http://127.0.0.1:3000");
  }
}

// En-têtes que le navigateur est autorisé à envoyer. Le navigateur
// envoie `apikey` — Supabase l'exige sur toute requête vers le gateway.
// Les valeurs sont comparées en minuscules parce que le navigateur
// envoie Access-Control-Request-Headers en minuscules.
export const ENTETES_AUTORISES = [
  "content-type",
  "authorization",
  "apikey",
  // Envoyés par supabase-js sur les requêtes qu'il émet lui-même.
  "x-client-info",
  "x-supabase-api-version",
];

export function enTetesCors(origine: string | null) {
  const autorisee = !!origine && ORIGINES_AUTORISEES.includes(origine);
  const entetes: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": ENTETES_AUTORISES.join(", "),
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin, Access-Control-Request-Headers",
  };
  if (autorisee) entetes["Access-Control-Allow-Origin"] = origine as string;
  return { entetes, autorisee };
}

// Un preflight ne doit réussir que si TOUS les en-têtes demandés sont
// autorisés. Répondre 204 en en oubliant un laisserait le navigateur
// bloquer la requête réelle sans que le serveur n'en sache rien.
export function preflightAcceptable(demandes: string | null): boolean {
  if (!demandes) return true;
  return demandes.split(",")
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h.length > 0)
    .every((h) => ENTETES_AUTORISES.includes(h));
}

function reponseJson(corps: unknown, statutHttp: number, entetesCors: Record<string, string>) {
  return new Response(JSON.stringify(corps), {
    status: statutHttp,
    headers: { "Content-Type": "application/json", ...entetesCors },
  });
}
// Codes métier STABLES (le navigateur peut s'y fier) et messages en
// français, compréhensibles par le candidat — jamais un code SQL, un
// nom de table ni un objet brut.
function erreur(code: string, message: string, statutHttp: number, entetesCors: Record<string, string>) {
  return reponseJson({ ok: false, code, message }, statutHttp, entetesCors);
}
const MESSAGE_ERREUR_SERVEUR =
  "Votre vidéo n'a pas pu être enregistrée pour le moment. Rien n'est perdu : " +
  "réessayez dans un instant. Si le problème persiste, contactez HelixCar.";

// Même convention de hachage que le token de devis déjà en place.
export async function hasherJeton(jetonBrut: string): Promise<string> {
  const donnees = new TextEncoder().encode(jetonBrut);
  const digest = await crypto.subtle.digest("SHA-256", donnees);
  return Array.from(new Uint8Array(digest)).map((o) => o.toString(16).padStart(2, "0")).join("");
}

// Règle métier, identique à celle du formulaire — mais appliquée ICI,
// donc non contournable depuis le navigateur.
export function dureeMaxPourActivites(activites: unknown): number {
  let liste: string[] = [];
  if (Array.isArray(activites)) liste = activites.map(String);
  else if (typeof activites === "string") {
    liste = activites.replace(/^\{|\}$/g, "").split(",").map((s) => s.replace(/^"|"$/g, "").trim());
  }
  liste = liste.filter(Boolean);
  if (liste.length === 0) return 0;
  // La vidéo est obligatoire et limitée à deux minutes pour tous les
  // métiers, convoyage compris.
  return 120;
}

// ------------------------------------------------------------
// EN-TÊTE BINAIRE : le fichier reçu est-il bien une vidéo du format
// annoncé ? Le MIME déclaré par le navigateur n'est qu'une déclaration ;
// les premiers octets de l'objet, eux, ne mentent pas.
//   * WebM (Matroska) : en-tête EBML 1A 45 DF A3 ;
//   * MP4 / MOV (ISO BMFF, QuickTime) : un atome de tête aux octets
//     4-7 — « ftyp » dans l'immense majorité des cas ; « wide »,
//     « mdat », « moov », « free », « skip », « pnot » pour certains
//     fichiers QuickTime anciens qui n'en sont pas moins valides.
// Un fichier vide, tronqué avant son en-tête, ou d'un autre format
// (AVI, MKV renommé, texte) est refusé.
// ------------------------------------------------------------
const ATOMES_ISO_BMFF = ["ftyp", "moov", "mdat", "wide", "free", "skip", "pnot"];
export function enTeteCoherent(octets: Uint8Array | null | undefined, mime: string): boolean {
  if (!octets || octets.length < 8) return false;
  if (mime === "video/webm") {
    return octets[0] === 0x1a && octets[1] === 0x45 && octets[2] === 0xdf && octets[3] === 0xa3;
  }
  if (mime === "video/mp4" || mime === "video/quicktime") {
    const atome = String.fromCharCode(octets[4], octets[5], octets[6], octets[7]);
    return ATOMES_ISO_BMFF.includes(atome);
  }
  return false;
}

// Lit les 64 premiers octets d'un objet du bucket privé, via une URL
// signée de lecture TRÈS courte, créée et consommée ici même — jamais
// renvoyée au navigateur. Le corps est interrompu après ces octets :
// un fichier de 300 Mo n'est jamais téléchargé par la fonction.
// Renvoie null en cas d'indisponibilité technique (jamais « vrai par
// défaut » : une vérification impossible n'est pas une vérification).
export async function lireEnTeteObjet(sb: any, chemin: string): Promise<Uint8Array | null> {
  try {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(chemin, 60);
    const url = data?.signedUrl || data?.signedURL;
    if (error || !url) return null;
    const rep = await fetch(url, { headers: { Range: "bytes=0-63" } });
    if (!rep.ok && rep.status !== 206) return null;
    if (!rep.body) return null;
    const lecteur = rep.body.getReader();
    const morceaux: Uint8Array[] = [];
    let total = 0;
    while (total < 64) {
      const { value, done } = await lecteur.read();
      if (done) break;
      if (value && value.length) { morceaux.push(value); total += value.length; }
    }
    try { await lecteur.cancel(); } catch { /* corps déjà terminé */ }
    const sortie = new Uint8Array(Math.min(total, 64));
    let pos = 0;
    for (const m of morceaux) {
      for (let i = 0; i < m.length && pos < sortie.length; i++) sortie[pos++] = m[i];
    }
    return sortie;
  } catch (e) {
    console.error("lecture en-tête objet :", e instanceof Error ? e.message : String(e));
    return null;
  }
}

const CHAMPS_CANDIDATURE =
  "id, activites, auth_user_id, created_at, statut, " +
  "video_chemin, video_envoyee_le, video_upload_jeton_hash, video_upload_jeton_consomme_le, " +
  "video_envoi_chemin, video_envoi_mime, video_envoi_taille_octets, " +
  "video_envoi_duree_secondes, video_envoi_commence_le";

function videoFinalisee(c: any): boolean {
  return !!(c && c.video_chemin && c.video_envoyee_le);
}

// Identifie l'appelant et LA candidature sur laquelle il a un droit.
// Deux chemins seulement, jamais un accès libre.
export async function resoudreCandidature(sb: any, req: Request, corps: any) {
  const enteteAuth = req.headers.get("authorization") || "";
  const jwt = enteteAuth.replace(/^Bearer\s+/i, "").trim();

  // 1) Session authentifiée : le propriétaire réel, identifié par son
  //    auth.uid(). C'est le cas d'un partenaire dont le compte existe.
  if (jwt) {
    const { data, error } = await sb.auth.getUser(jwt);
    if (error || !data?.user?.id) {
      return { erreur: ["UNAUTHORIZED", "Session invalide.", 401] as const };
    }
    const { data: ligne } = await sb
      .from("convoyeurs").select(CHAMPS_CANDIDATURE)
      .eq("auth_user_id", data.user.id).maybeSingle();
    if (!ligne) {
      return { erreur: ["FORBIDDEN", "Aucune candidature rattachée à ce compte.", 403] as const };
    }
    return { candidature: ligne, viaCompte: true, jetonConsomme: false };
  }

  // 2) Jeton à usage unique, lié à une candidature DÉJÀ créée par ce
  //    même navigateur. Le jeton n'est jamais deviné : la base ne
  //    contient que son empreinte, et aucune lecture anonyme de la
  //    table n'est possible.
  const jeton = typeof corps?.jeton === "string" ? corps.jeton.trim() : "";
  if (jeton.length < 32) {
    return { erreur: ["UNAUTHORIZED", "Autorisation d'envoi absente.", 401] as const };
  }
  const empreinte = await hasherJeton(jeton);
  const { data: ligne } = await sb
    .from("convoyeurs").select(CHAMPS_CANDIDATURE)
    .eq("video_upload_jeton_hash", empreinte).maybeSingle();
  if (!ligne) {
    return { erreur: ["FORBIDDEN", "Autorisation d'envoi inconnue ou déjà utilisée.", 403] as const };
  }
  // Jeton déjà consommé par une finalisation : il ne peut plus rien
  // autoriser. Il sert seulement à répondre de façon IDEMPOTENTE à une
  // confirmation rejouée — c'est l'appelant qui décide.
  if (ligne.video_upload_jeton_consomme_le) {
    return { candidature: ligne, viaCompte: false, jetonConsomme: true };
  }
  const ageMinutes = (Date.now() - new Date(ligne.created_at).getTime()) / 60000;
  if (!isFinite(ageMinutes) || ageMinutes > FENETRE_ENVOI_MINUTES) {
    return { erreur: ["EXPIRED", "Autorisation d'envoi expirée.", 403] as const };
  }
  return { candidature: ligne, viaCompte: false, jetonConsomme: false };
}

// ============================================================
// ACTION 1 — AUTORISER : délivre une URL d'envoi signée
// ============================================================
export async function actionAutoriser(sb: any, req: Request, corps: any, cors: Record<string, string>) {
  const r = await resoudreCandidature(sb, req, corps);
  if ("erreur" in r) return erreur(r.erreur[0], r.erreur[1], r.erreur[2], cors);
  const c = r.candidature;

  // Jeton consommé : la vidéo de cette candidature est déjà finalisée.
  // Rejouer « autoriser » (réponse de confirmation perdue, second clic)
  // ne doit ni rouvrir un envoi ni renvoyer une erreur trompeuse.
  if (r.jetonConsomme) {
    if (videoFinalisee(c)) {
      return reponseJson({ ok: true, deja_confirmee: true, chemin: c.video_chemin }, 200, cors);
    }
    return erreur("FORBIDDEN", "Autorisation d'envoi déjà utilisée.", 403, cors);
  }

  const mime = String(corps?.mime || "");
  const extension = EXTENSION_PAR_MIME[mime];
  if (!extension) {
    return erreur("FORMAT_REFUSE", "Format non pris en charge (MP4, MOV ou WebM).", 400, cors);
  }

  const taille = Number(corps?.taille_octets);
  if (!Number.isFinite(taille) || taille <= 0 || Math.round(taille) !== taille) {
    return erreur("TAILLE_REFUSEE", "Taille du fichier non vérifiable.", 400, cors);
  }
  if (taille > TAILLE_MAX_OCTETS) {
    return erreur("TAILLE_REFUSEE", "Fichier trop volumineux (300 Mo maximum).", 400, cors);
  }

  // La règle de durée est réappliquée à partir des activités RÉELLEMENT
  // enregistrées en base, pas de ce que déclare le navigateur.
  const dureeMax = dureeMaxPourActivites(c.activites);
  if (dureeMax === 0) {
    return erreur("VIDEO_NON_ATTENDUE", "Aucune vidéo n'est attendue pour ces activités.", 400, cors);
  }
  const duree = Number(corps?.duree_secondes);
  if (!Number.isFinite(duree) || duree <= 0) {
    return erreur("DUREE_REFUSEE", "Durée de la vidéo non vérifiable.", 400, cors);
  }
  if (duree > dureeMax) {
    return erreur("DUREE_REFUSEE", `Vidéo trop longue (maximum ${dureeMax} secondes).`, 400, cors);
  }

  // CHEMIN GÉNÉRÉ ICI. Le navigateur n'en propose aucun et ne peut donc
  // pas viser le dossier d'une autre candidature.
  //
  // ENVOI REPRENABLE : si un envoi est déjà EN COURS pour cette
  // candidature, dans le même format, on REPREND le même chemin au lieu
  // d'en créer un second. Le chemin reste décidé par le serveur dans
  // les deux cas, et relu depuis les colonnes d'envoi en cours — jamais
  // depuis les colonnes finales, qui ne changent qu'à la finalisation.
  const {data:preparation,error:erreurPreparation}=await sb.rpc("preparer_video_candidature",{p_id:c.id,p_mime:mime,p_taille:taille,p_duree:duree});
  if(erreurPreparation||!preparation?.ok)return erreur("INTERNAL_ERROR",MESSAGE_ERREUR_SERVEUR,500,cors);
  if(preparation.deja_confirmee)return reponseJson({ok:true,deja_confirmee:true,chemin:preparation.chemin},200,cors);
  const chemin=preparation.chemin;
  const {data:signature,error:erreurSignature}=await sb.storage.from(BUCKET).createSignedUploadUrl(chemin,{upsert:true});
  if(erreurSignature||!signature?.token)return erreur("STOCKAGE_INDISPONIBLE","Envoi momentanément indisponible. Réessayez dans un instant.",503,cors);

  return reponseJson({
    ok: true,
    chemin,
    bucket: BUCKET,
    token: signature.token,
    validite_secondes: VALIDITE_URL_ENVOI_SECONDES,
    // Le navigateur sait ainsi s'il reprend un envoi interrompu ou s'il
    // en commence un nouveau — sans jamais avoir à le deviner.
    reprise: preparation.reprise === true,
  }, 200, cors);
}

// ============================================================
// ACTION 1 bis — PROLONGER : une signature fraîche, MÊME chemin
// ============================================================
// Un envoi reprenable dure parfois plus longtemps que la signature qui
// l'autorise. Cette action en délivre une nouvelle, pour le chemin DÉJÀ
// enregistré comme envoi en cours, et pour lui seul. Elle n'accepte
// aucun chemin venant du navigateur et ne consomme pas le jeton.
export async function actionProlonger(sb: any, req: Request, corps: any, cors: Record<string, string>) {
  const r = await resoudreCandidature(sb, req, corps);
  if ("erreur" in r) return erreur(r.erreur[0], r.erreur[1], r.erreur[2], cors);
  const c = r.candidature;

  if (r.jetonConsomme) {
    return erreur("DEJA_CONFIRMEE", "Cette vidéo a déjà été reçue.", 409, cors);
  }
  if (!c.video_envoi_chemin) {
    return erreur("AUCUN_ENVOI", "Aucun envoi en cours pour cette candidature.", 400, cors);
  }
  // Garde-fou : le chemin enregistré appartient forcément au dossier de
  // CETTE candidature. Une valeur inattendue n'est jamais resignée.
  if (!String(c.video_envoi_chemin).startsWith(`candidatures/${c.id}/`)) {
    return erreur("CHEMIN_INVALIDE", "Envoi non reconnu.", 409, cors);
  }

  const { data: signature, error: erreurSignature } = await sb
    .storage.from(BUCKET).createSignedUploadUrl(c.video_envoi_chemin, { upsert: true });
  if (erreurSignature || !signature?.token) {
    console.error("createSignedUploadUrl (prolonger):", erreurSignature);
    return erreur("STOCKAGE_INDISPONIBLE", "Envoi momentanément indisponible. Réessayez dans un instant.", 503, cors);
  }

  return reponseJson({
    ok: true,
    chemin: c.video_envoi_chemin,
    bucket: BUCKET,
    token: signature.token,
    validite_secondes: VALIDITE_URL_ENVOI_SECONDES,
  }, 200, cors);
}

// ============================================================
// ACTION 2 — CONFIRMER : vérifie le dépôt, finalise, nettoie
// ============================================================
export async function actionConfirmer(sb: any, req: Request, corps: any, cors: Record<string, string>, env: Record<string,string|undefined> = {}) {
  const r = await resoudreCandidature(sb, req, corps);
  if ("erreur" in r) return erreur(r.erreur[0], r.erreur[1], r.erreur[2], cors);
  const c = r.candidature;

  // IDEMPOTENCE : confirmation rejouée après succès. Rien n'est
  // réécrit, rien n'est recréé, et la réponse est un succès — c'en est
  // un. Un jeton consommé sans vidéo finalisée est, lui, refusé.
  if (r.jetonConsomme) {
    if (videoFinalisee(c)) {
      return reponseJson({ ok: true, deja_confirmee: true, chemin: c.video_chemin, orphelins_supprimes: 0 }, 200, cors);
    }
    return erreur("FORBIDDEN", "Autorisation d'envoi déjà utilisée.", 403, cors);
  }
  if (!c.video_envoi_chemin) {
    if (videoFinalisee(c)) {
      return reponseJson({ ok: true, deja_confirmee: true, chemin: c.video_chemin, orphelins_supprimes: 0 }, 200, cors);
    }
    return erreur("AUCUN_ENVOI", "Aucun envoi en cours pour cette candidature.", 400, cors);
  }

  const dossier = `candidatures/${c.id}`;
  const cheminAttendu = String(c.video_envoi_chemin);
  if (!cheminAttendu.startsWith(dossier + "/")) {
    return erreur("CHEMIN_INVALIDE", "Envoi non reconnu.", 409, cors);
  }
  const attendu = cheminAttendu.slice(dossier.length + 1);

  // 1) PRÉSENCE RÉELLE de l'objet, vérifiée côté serveur : une
  //    candidature ne peut pas se déclarer complète sans fichier.
  const { data: objets, error: erreurListe } = await sb.storage.from(BUCKET).list(dossier);
  if (erreurListe) {
    console.error("list:", erreurListe);
    return erreur("STOCKAGE_INDISPONIBLE", "Vérification impossible pour le moment. Réessayez dans un instant.", 503, cors);
  }
  const objet = (objets || []).find((o: any) => o?.name === attendu);
  if (!objet) {
    return erreur("ENVOI_INCOMPLET", "La vidéo n'a pas été reçue entièrement. Relancez l'envoi.", 409, cors);
  }

  // 2) TAILLE RÉELLE, lue sur l'objet, comparée à la taille annoncée.
  //    Un envoi tronqué (taille plus petite) ou un fichier substitué
  //    (taille différente) ne devient jamais une vidéo reçue.
  const tailleBrute = Number(objet?.metadata?.size);
  const tailleReelle = Number.isFinite(tailleBrute) && tailleBrute >= 0 ? tailleBrute : null;
  if (tailleReelle === null) return erreur("VERIFICATION_INDISPONIBLE", "La taille du fichier ne peut pas être vérifiée. Réessayez dans un instant.",503,cors);
  if (tailleReelle === 0) {
    try { await sb.storage.from(BUCKET).remove([cheminAttendu]); } catch (e) { console.error("remove fichier vide:", e); }
    return erreur("FICHIER_VIDE", "Le fichier reçu est vide. Choisissez une autre vidéo et relancez l'envoi.", 409, cors);
  }
  if (tailleReelle !== null && tailleReelle !== Number(c.video_envoi_taille_octets)) {
    return erreur("TAILLE_INCOHERENTE",
      "La vidéo reçue ne correspond pas au fichier annoncé (envoi incomplet ou fichier différent). Relancez l'envoi.",
      409, cors);
  }

  // 3) EN-TÊTE BINAIRE : le contenu est-il bien une vidéo du format
  //    annoncé ? Vérification impossible = refus temporaire, jamais un
  //    passage en force.
  const entete = await lireEnTeteObjet(sb, cheminAttendu);
  if (entete === null) {
    return erreur("STOCKAGE_INDISPONIBLE", "Vérification impossible pour le moment. Réessayez dans un instant.", 503, cors);
  }
  if (!enTeteCoherent(entete, String(c.video_envoi_mime || ""))) {
    // Le fichier n'est pas une vidéo lisible du format annoncé : il est
    // retiré du bucket, l'envoi en cours reste ouvert pour un nouveau
    // fichier (même chemin, resigné à la prochaine autorisation).
    try { await sb.storage.from(BUCKET).remove([cheminAttendu]); } catch (e) { console.error("remove fichier invalide:", e); }
    return erreur("FORMAT_INCOHERENT",
      "Le fichier reçu n'est pas une vidéo MP4, MOV ou WebM lisible. Choisissez une autre vidéo et relancez l'envoi.",
      409, cors);
  }

  const verification=await verifierObjet(sb,c,env);
  if(verification.ok!==true && verification.etat!=="verifie") {
    const code=verification.code||"VERIFICATION_INDISPONIBLE";
    const message=code==="DUREE_REFUSEE"?"La vidéo reçue dépasse la durée autorisée. Choisissez une vidéo plus courte.":
      ["VIDEO_ILLISIBLE","FORMAT_INCOHERENT"].includes(code)?"La vidéo reçue est illisible ou son format est incorrect. Choisissez un autre fichier.":
      "La vérification de votre vidéo n'a pas pu se terminer. Votre envoi est conservé ; réessayez dans un instant.";
    return erreur(code,message,code.includes("INDISPONIBLE")||code.includes("CONFIGUREE")?503:422,cors);
  }
  // Le SQL relit les mesures du worker et verrouille l'envoi courant.
  const {data:fin,error:erreurFin}=await sb.rpc("finaliser_video_verifiee",{p_id:c.id,p_chemin_source:cheminAttendu});
  if (erreurFin) {
    console.error("finaliser_video_candidature:", erreurFin?.code || "", erreurFin?.message || erreurFin);
    return erreur("INTERNAL_ERROR",
      "Votre vidéo a bien été reçue mais n'a pas pu être enregistrée. Rien n'est perdu : réessayez dans un instant.",
      500, cors);
  }
  if (!fin || fin.ok !== true) {
    const code = String(fin?.code || "INTERNAL_ERROR");
    if (code === "TAILLE_INCOHERENTE") {
      return erreur("TAILLE_INCOHERENTE", "La vidéo reçue ne correspond pas au fichier annoncé. Relancez l'envoi.", 409, cors);
    }
    if (code === "AUCUN_ENVOI") {
      return erreur("AUCUN_ENVOI", "Aucun envoi en cours pour cette candidature.", 400, cors);
    }
    console.error("finaliser_video_candidature a refusé :", code);
    return erreur("INTERNAL_ERROR", MESSAGE_ERREUR_SERVEUR, 500, cors);
  }

  // Aucun effacement large ici : un autre upload peut encore être actif.
  // Les sources et copies abandonnées sont réconciliées après expiration
  // des signatures/TUS, selon le protocole de recette versionné.

  return reponseJson({
    ok: true,
    deja_confirmee: fin.code === "DEJA_FINALISEE",
    chemin: fin.chemin || cheminAttendu,
    statut: fin.statut || null,
    orphelins_supprimes: 0,
  }, 200, cors);
}

// ============================================================
// Routage — exporté pour être testable hors Deno
// ============================================================
export async function actionReconcilier(sb:any,req:Request,corps:any,cors:Record<string,string>){
  const jwt=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
  if(!jwt)return erreur('UNAUTHORIZED','Authentification requise.',401,cors);
  const user=await sb.auth.getUser(jwt);
  if(user.error||!user.data?.user)return erreur('UNAUTHORIZED','Session invalide.',401,cors);
  const admin=await sb.from('admins').select('id').eq('auth_user_id',user.data.user.id).eq('actif',true).maybeSingle();
  if(admin.error||!admin.data)return erreur('FORBIDDEN','Droits administrateur requis.',403,cors);
  if(corps.apres!=null&&!/^[a-f0-9-]{36}$/i.test(corps.apres))return erreur('BAD_REQUEST','Curseur invalide.',400,cors);
  const bilan=await reconcilierVideos(sb,corps.appliquer===true,Date.now(),corps.apres||null);
  return reponseJson({ok:bilan.erreurs===0,simulation:corps.appliquer!==true,...bilan},bilan.erreurs?503:200,cors);
}
// Échange serveur à serveur : le worker présente un jeton opaque, utilisable
// une seule fois et conservé seulement sous forme de SHA-256 en base.
export async function actionWorkerClaim(sb:any,req:Request,corps:any){
  const brut=(req.headers.get('authorization')||'').replace(/^HelixCar-Video\s+/,'');
  if(!/^[A-Za-z0-9_-]{43}$/.test(brut)||!/^[a-f0-9-]{36}$/i.test(String(corps?.candidature_id||'')))
    return erreur('JETON_INVALIDE','Autorisation de vérification invalide.',403,{'Cache-Control':'no-store'});
  const {data,error:e}=await sb.rpc('reclamer_verification_video',{p_id:corps.candidature_id,p_jeton_hash:await hasherJeton(brut)});
  if(e||!data?.ok)return erreur(String(data?.code||'JETON_INVALIDE'),'Autorisation de vérification invalide ou expirée.',403,{'Cache-Control':'no-store'});
  const sig=await sb.storage.from(BUCKET).createSignedUrl(String(data.chemin),180);
  if(sig.error||!sig.data?.signedUrl)return erreur('STOCKAGE_INDISPONIBLE','Lecture privée indisponible.',503,{'Cache-Control':'no-store'});
  return reponseJson({ok:true,url:sig.data.signedUrl,mime:data.mime,duree_max:data.duree_max},200,{'Cache-Control':'no-store'});
}
export async function traiterRequete(sb: any, req: Request, env: Record<string,string|undefined> = {}): Promise<Response> {
  const origine = req.headers.get("origin");
  if(!origine&&req.method==='POST'&&(req.headers.get('authorization')||'').startsWith('HelixCar-Video ')){
    let corps:any;try{corps=await req.json();}catch{return erreur('BAD_REQUEST','Corps JSON invalide.',400,{'Cache-Control':'no-store'});}
    return actionWorkerClaim(sb,req,corps);
  }
  const { entetes: cors, autorisee } = enTetesCors(origine);

  if (req.method === "OPTIONS") {
    if (!autorisee) return new Response(null, { status: 403, headers: cors });
    const demandes = req.headers.get("access-control-request-headers");
    if (!preflightAcceptable(demandes)) {
      console.error("Preflight refusé — en-têtes non autorisés :", demandes);
      return new Response(null, { status: 403, headers: cors });
    }
    return new Response(null, { status: 204, headers: cors });
  }
  if (!autorisee) return erreur("ORIGIN_NOT_ALLOWED", "Origine non autorisée.", 403, cors);
  if (req.method !== "POST") return erreur("METHOD_NOT_ALLOWED", "Seul POST est accepté.", 405, cors);

  let corps: any;
  try { corps = await req.json(); }
  catch { return erreur("BAD_REQUEST", "Corps JSON invalide.", 400, cors); }

  const action = corps?.action;
  const ACTIONS: Record<string, (sb: any, req: Request, corps: any, cors: Record<string, string>) => Promise<Response>> = {
    autoriser: actionAutoriser,
    prolonger: actionProlonger,
    reconcilier: actionReconcilier,
    confirmer: (sb,req,corps,cors)=>actionConfirmer(sb,req,corps,cors,env),
  };
  if (typeof action !== "string" || !Object.prototype.hasOwnProperty.call(ACTIONS, action)) {
    return erreur("BAD_REQUEST", "Action inconnue.", 400, cors);
  }

  try {
    return await ACTIONS[action](sb, req, corps, cors);
  } catch (e) {
    console.error(`Échec de la candidature vidéo, action=${action}.`);
    return erreur("INTERNAL_ERROR", MESSAGE_ERREUR_SERVEUR, 500, cors);
  }
}

// Démarrage réel — uniquement sous Deno. L'import depuis un test Node
// n'ouvre donc aucun serveur.
if (typeof Deno !== "undefined" && typeof (Deno as any).serve === "function") {
  (Deno as any).serve(async (req: Request) => {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Config manquante : SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absente.");
      const { entetes } = enTetesCors(req.headers.get("origin"));
      return erreur("SERVER_MISCONFIGURED", MESSAGE_ERREUR_SERVEUR, 500, entetes);
    }
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    return await traiterRequete(sb, req, {SUPABASE_URL:supabaseUrl,HELIXCAR_ORIGINE:req.headers.get('origin')||undefined,HELIXCAR_VIDEO_VALIDATION_URL:Deno.env.get("HELIXCAR_VIDEO_VALIDATION_URL"),HELIXCAR_VIDEO_VALIDATION_SECRET:Deno.env.get("HELIXCAR_VIDEO_VALIDATION_SECRET")});
  });
}
