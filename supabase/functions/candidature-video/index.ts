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
const TAILLE_MAX_OCTETS = 50 * 1024 * 1024;

// Fenêtre pendant laquelle une candidature tout juste créée peut
// encore envoyer sa vidéo. Volontairement dérivée de created_at :
// aucune colonne modifiable par le navigateur ne peut l'allonger.
const FENETRE_ENVOI_MINUTES = 120;

// Durée de validité de l'URL d'envoi signée.
const VALIDITE_URL_ENVOI_SECONDES = 120;

const ORIGINES_AUTORISEES = ["https://helixcar-i89b.vercel.app"];
if (typeof Deno !== "undefined" && Deno.env?.get("ALLOW_LOCALHOST_CORS") === "true") {
  ORIGINES_AUTORISEES.push("http://localhost:3000", "http://127.0.0.1:3000");
}

export function enTetesCors(origine: string | null) {
  const autorisee = !!origine && ORIGINES_AUTORISEES.includes(origine);
  const entetes: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Vary": "Origin",
  };
  if (autorisee) entetes["Access-Control-Allow-Origin"] = origine as string;
  return { entetes, autorisee };
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
  if (liste.includes("renfort")) return 120;
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
  const chemin = `candidatures/${c.id}/${crypto.randomUUID()}${extension}`;

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
    return new Response(null, { status: autorisee ? 204 : 403, headers: cors });
  }
  if (!autorisee) return erreur("ORIGIN_NOT_ALLOWED", "Origine non autorisée.", 403, cors);
  if (req.method !== "POST") return erreur("METHOD_NOT_ALLOWED", "Seul POST est accepté.", 405, cors);

  let corps: any;
  try { corps = await req.json(); }
  catch { return erreur("BAD_REQUEST", "Corps JSON invalide.", 400, cors); }

  const action = corps?.action;
  if (action !== "autoriser" && action !== "confirmer") {
    return erreur("BAD_REQUEST", "Action inconnue.", 400, cors);
  }

  try {
    return action === "autoriser"
      ? await actionAutoriser(sb, req, corps, cors)
      : await actionConfirmer(sb, req, corps, cors);
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
