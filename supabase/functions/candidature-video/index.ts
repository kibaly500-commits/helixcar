// deno-lint-ignore-file no-explicit-any
// ============================================================
// HelixCar — Edge Function « candidature-video »
// ============================================================
// AUTORISATION D'ENVOI DE LA VIDÉO DE CANDIDATURE.
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
// Garanties :
//   * le chemin est calculé ici : 'candidatures/<id>/<uuid>.<ext>' ;
//     le navigateur ne le propose ni ne l'influence jamais ;
//   * l'appelant doit prouver son droit, soit par sa session
//     authentifiée (propriétaire réel), soit par un jeton à usage
//     unique lié à une candidature DÉJÀ créée ;
//   * le jeton n'est jamais stocké en clair : la base ne contient que
//     son SHA-256 (même convention que le token de devis) ;
//   * format, taille et durée sont revérifiés ICI, jamais seulement
//     dans le navigateur ;
//   * aucune URL signée de LECTURE n'est délivrée par cette fonction :
//     la lecture reste réservée aux administrateurs, via leur propre
//     session (politique de select du bucket).
//
// Déploiement (à faire par HelixCar, non exécuté ici) :
//   supabase functions deploy candidature-video
// Variables déjà présentes dans l'environnement des Edge Functions :
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

// L'import du client Supabase est fait DYNAMIQUEMENT, au démarrage
// Deno seulement : la logique d'autorisation ci-dessous reste ainsi
// importable et testable hors Deno, sans dépendance réseau.

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
const TAILLE_MAX_OCTETS = 300 * 1024 * 1024;

// Fenêtre pendant laquelle une candidature tout juste créée peut
// encore envoyer sa vidéo. Volontairement dérivée de created_at :
// aucune colonne modifiable par le navigateur ne peut l'allonger.
const FENETRE_ENVOI_MINUTES = 120;

// Durée de validité de la signature d'envoi.
//
// 120 secondes suffisaient pour un envoi en UNE requête, mais rendaient
// tout envoi reprenable impossible : 300 Mo sur une connexion mobile
// dépassent largement deux minutes, et la signature expirait au milieu.
// Portée à 30 minutes, et surtout RENOUVELABLE (action « prolonger »
// ci-dessous) : le navigateur peut demander une signature fraîche sans
// jamais recommencer l'envoi ni changer de chemin.
//
// Ce n'est pas un affaiblissement : une signature n'autorise l'écriture
// que d'UN SEUL chemin, généré par le serveur, dans un bucket privé.
// Elle ne donne aucun droit de lecture, aucun droit sur un autre objet,
// et ne peut pas être transformée en droit d'écriture général.
const VALIDITE_URL_ENVOI_SECONDES = 30 * 60;

// Origines autorisées — LISTE EXPLICITE, jamais un joker.
//
// DÉFAUT CORRIGÉ (lot A1). Seul le domaine d'aperçu figurait ici. Le
// site RÉELLEMENT utilisé par les candidats, https://helixcar.vercel.app,
// n'y était pas : enTetesCors() n'accordait donc aucun
// Access-Control-Allow-Origin, le preflight OPTIONS était refusé (403),
// et le navigateur bloquait le POST avant même de l'émettre. Côté
// candidat : « L'envoi de votre vidéo a échoué ». Côté console :
//   « Response to preflight request doesn't pass access control check:
//     No 'Access-Control-Allow-Origin' header is present. » puis
//   net::ERR_FAILED.
//
// Rien d'autre n'est élargi : la comparaison reste une égalité stricte
// de chaîne, donc le schéma, le port et le sous-domaine comptent. Ni
// « * », ni renvoi en miroir de l'origine demandée, ni correspondance
// par préfixe ou par suffixe — un https://helixcar.vercel.app.pirate.tld
// reste refusé.
const ORIGINES_AUTORISEES = [
  "https://helixcar.vercel.app",       // site de production
  "https://helixcar-i89b.vercel.app",  // déploiement d'aperçu
];
if (typeof Deno !== "undefined" && Deno.env?.get("ALLOW_LOCALHOST_CORS") === "true") {
  ORIGINES_AUTORISEES.push("http://localhost:3000", "http://127.0.0.1:3000");
}

// En-têtes que le navigateur est autorisé à envoyer.
//
// DÉFAUT CORRIGÉ : la liste ne contenait que `content-type` et
// `authorization`. Or le navigateur envoie `apikey` — Supabase l'exige
// sur toute requête vers le gateway. Le preflight OPTIONS échouait donc
// AVANT le POST, et la requête réelle n'était jamais émise : côté
// candidat, « Connexion interrompue », sans la moindre trace serveur.
//
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
// bloquer la requête réelle sans que le serveur n'en sache rien : on
// préfère un refus explicite, visible dans les journaux.
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
function erreur(code: string, message: string, statutHttp: number, entetesCors: Record<string, string>) {
  return reponseJson({ ok: false, code, message }, statutHttp, entetesCors);
}

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
  if (liste.includes("renfort") || liste.includes("technicien")) return 120;
  if (liste.includes("convoyage")) return 60;
  return 0; // nettoyage seul : aucune vidéo attendue
}

const CHAMPS_CANDIDATURE =
  "id, activites, auth_user_id, created_at, statut, video_chemin, video_envoyee_le, video_upload_jeton_hash";

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
    return { candidature: ligne, viaCompte: true };
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
  const ageMinutes = (Date.now() - new Date(ligne.created_at).getTime()) / 60000;
  if (!isFinite(ageMinutes) || ageMinutes > FENETRE_ENVOI_MINUTES) {
    return { erreur: ["EXPIRED", "Autorisation d'envoi expirée.", 403] as const };
  }
  return { candidature: ligne, viaCompte: false };
}

// ============================================================
// ACTION 1 — AUTORISER : délivre une URL d'envoi signée
// ============================================================
export async function actionAutoriser(sb: any, req: Request, corps: any, cors: Record<string, string>) {
  const r = await resoudreCandidature(sb, req, corps);
  if ("erreur" in r) return erreur(r.erreur[0], r.erreur[1], r.erreur[2], cors);
  const c = r.candidature;

  const mime = String(corps?.mime || "");
  const extension = EXTENSION_PAR_MIME[mime];
  if (!extension) {
    return erreur("FORMAT_REFUSE", "Format non pris en charge (MP4, MOV ou WebM).", 400, cors);
  }

  const taille = Number(corps?.taille_octets);
  if (!Number.isFinite(taille) || taille <= 0 || taille > TAILLE_MAX_OCTETS) {
    return erreur("TAILLE_REFUSEE", "Fichier trop volumineux.", 400, cors);
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
  if (duree > dureeMax + 0.5) {
    return erreur("DUREE_REFUSEE", `Vidéo trop longue (maximum ${dureeMax} secondes).`, 400, cors);
  }

  // CHEMIN GÉNÉRÉ ICI. Le navigateur n'en propose aucun et ne peut donc
  // pas viser le dossier d'une autre candidature.
  //
  // ENVOI REPRENABLE : si un envoi est déjà en cours pour cette
  // candidature, dans le même format, on REPREND le même chemin au lieu
  // d'en créer un second. Sans cela, un rechargement de page pendant
  // l'envoi laisserait un objet partiel orphelin et recommencerait tout
  // depuis zéro. Le chemin reste décidé par le serveur dans les deux cas.
  const cheminEnCours = (!c.video_envoyee_le && typeof c.video_chemin === "string"
    && c.video_chemin.startsWith(`candidatures/${c.id}/`)
    && c.video_chemin.endsWith(extension))
    ? c.video_chemin : null;
  const chemin = cheminEnCours || `candidatures/${c.id}/${crypto.randomUUID()}${extension}`;

  const { data: signature, error: erreurSignature } = await sb
    .storage.from(BUCKET).createSignedUploadUrl(chemin);
  if (erreurSignature || !signature?.token) {
    console.error("createSignedUploadUrl:", erreurSignature);
    return erreur("STOCKAGE_INDISPONIBLE", "Envoi momentanément indisponible.", 503, cors);
  }

  // Le chemin attendu est enregistré AVANT l'envoi : la vidéo n'est
  // considérée reçue qu'après confirmation (video_envoyee_le).
  const { error: erreurMaj } = await sb.from("convoyeurs").update({
    video_chemin: chemin,
    video_mime: mime,
    video_taille_octets: Math.round(taille),
    video_duree_secondes: Math.round(duree * 100) / 100,
    video_envoyee_le: null,
  }).eq("id", c.id);
  if (erreurMaj) {
    console.error("maj candidature:", erreurMaj);
    return erreur("INTERNAL_ERROR", "Erreur serveur.", 500, cors);
  }

  return reponseJson({
    ok: true,
    chemin,
    bucket: BUCKET,
    token: signature.token,
    validite_secondes: VALIDITE_URL_ENVOI_SECONDES,
    // Le navigateur sait ainsi s'il reprend un envoi interrompu ou s'il
    // en commence un nouveau — sans jamais avoir à le deviner.
    reprise: !!cheminEnCours,
  }, 200, cors);
}

// ============================================================
// ACTION 1 bis — PROLONGER : une signature fraîche, MÊME chemin
// ============================================================
// Un envoi reprenable dure parfois plus longtemps que la signature qui
// l'autorise. Cette action en délivre une nouvelle, pour le chemin DÉJÀ
// enregistré et pour lui seul.
//
// Ce qu'elle ne fait pas, volontairement :
//   * elle n'accepte aucun chemin venant du navigateur — elle relit
//     celui que le serveur avait lui-même généré ;
//   * elle ne consomme pas le jeton à usage unique : c'est « confirmer »
//     qui le fait, une fois la vidéo réellement arrivée ;
//   * elle ne rouvre rien sur une candidature dont la vidéo est déjà
//     confirmée.
export async function actionProlonger(sb: any, req: Request, corps: any, cors: Record<string, string>) {
  const r = await resoudreCandidature(sb, req, corps);
  if ("erreur" in r) return erreur(r.erreur[0], r.erreur[1], r.erreur[2], cors);
  const c = r.candidature;

  if (!c.video_chemin) {
    return erreur("AUCUN_ENVOI", "Aucun envoi en cours pour cette candidature.", 400, cors);
  }
  if (c.video_envoyee_le) {
    return erreur("DEJA_CONFIRMEE", "Cette vidéo a déjà été reçue.", 409, cors);
  }
  // Garde-fou : le chemin enregistré appartient forcément au dossier de
  // CETTE candidature. Une valeur inattendue n'est jamais resignée.
  if (!String(c.video_chemin).startsWith(`candidatures/${c.id}/`)) {
    return erreur("CHEMIN_INVALIDE", "Envoi non reconnu.", 409, cors);
  }

  const { data: signature, error: erreurSignature } = await sb
    .storage.from(BUCKET).createSignedUploadUrl(c.video_chemin, { upsert: true });
  if (erreurSignature || !signature?.token) {
    console.error("createSignedUploadUrl (prolonger):", erreurSignature);
    return erreur("STOCKAGE_INDISPONIBLE", "Envoi momentanément indisponible.", 503, cors);
  }

  return reponseJson({
    ok: true,
    chemin: c.video_chemin,
    bucket: BUCKET,
    token: signature.token,
    validite_secondes: VALIDITE_URL_ENVOI_SECONDES,
  }, 200, cors);
}

// ============================================================
// ACTION 2 — CONFIRMER : vérifie le dépôt et nettoie les orphelins
// ============================================================
export async function actionConfirmer(sb: any, req: Request, corps: any, cors: Record<string, string>) {
  const r = await resoudreCandidature(sb, req, corps);
  if ("erreur" in r) return erreur(r.erreur[0], r.erreur[1], r.erreur[2], cors);
  const c = r.candidature;

  if (!c.video_chemin) {
    return erreur("AUCUN_ENVOI", "Aucun envoi en cours pour cette candidature.", 400, cors);
  }

  const dossier = `candidatures/${c.id}`;
  const attendu = String(c.video_chemin).slice(dossier.length + 1);

  // La présence réelle de l'objet est vérifiée côté serveur : une
  // candidature ne peut pas se déclarer complète sans fichier.
  const { data: objets, error: erreurListe } = await sb.storage.from(BUCKET).list(dossier);
  if (erreurListe) {
    console.error("list:", erreurListe);
    return erreur("STOCKAGE_INDISPONIBLE", "Vérification impossible.", 503, cors);
  }
  const present = (objets || []).some((o: any) => o?.name === attendu);
  if (!present) {
    return erreur("ENVOI_INCOMPLET", "La vidéo n'a pas été reçue entièrement.", 409, cors);
  }

  // REMPLACEMENT PROPRE : tout ce qui traîne dans le dossier de cette
  // candidature et qui n'est pas la vidéo confirmée est supprimé —
  // ancienne vidéo remplacée comme dépôt abandonné. Aucun orphelin.
  const aSupprimer = (objets || [])
    .filter((o: any) => o?.name && o.name !== attendu)
    .map((o: any) => `${dossier}/${o.name}`);
  if (aSupprimer.length) {
    const { error: erreurSuppression } = await sb.storage.from(BUCKET).remove(aSupprimer);
    if (erreurSuppression) console.error("remove orphelins:", erreurSuppression);
  }

  // Le jeton est à USAGE UNIQUE : il est effacé ici.
  const maj: Record<string, unknown> = {
    video_envoyee_le: new Date().toISOString(),
    video_upload_jeton_hash: null,
  };
  if (c.statut === "video_attendue") maj.statut = "en_attente";

  const { error: erreurMaj } = await sb.from("convoyeurs").update(maj).eq("id", c.id);
  if (erreurMaj) {
    console.error("maj confirmation:", erreurMaj);
    return erreur("INTERNAL_ERROR", "Erreur serveur.", 500, cors);
  }

  return reponseJson({ ok: true, orphelins_supprimes: aSupprimer.length }, 200, cors);
}

// ============================================================
// Routage — exporté pour être testable hors Deno
// ============================================================
export async function traiterRequete(sb: any, req: Request): Promise<Response> {
  const origine = req.headers.get("origin");
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
    confirmer: actionConfirmer,
  };
  if (typeof action !== "string" || !Object.prototype.hasOwnProperty.call(ACTIONS, action)) {
    return erreur("BAD_REQUEST", "Action inconnue.", 400, cors);
  }

  try {
    return await ACTIONS[action](sb, req, corps, cors);
  } catch (e) {
    console.error(`Erreur action=${action}:`, e instanceof Error ? e.message : String(e));
    return erreur("INTERNAL_ERROR", "Erreur serveur.", 500, cors);
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
      return erreur("SERVER_MISCONFIGURED", "Erreur serveur.", 500, entetes);
    }
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    return await traiterRequete(sb, req);
  });
}
