// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ORIGINES_AUTORISEES = ["https://helixcar-i89b.vercel.app"];
if (Deno.env.get("ALLOW_LOCALHOST_CORS") === "true") {
  ORIGINES_AUTORISEES.push("http://localhost:3000", "http://127.0.0.1:3000");
}

function enTetesCors(origine: string | null): { entetes: Record<string, string>; autorisee: boolean } {
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

function genererTokenBrut(): string {
  const octets = new Uint8Array(32);
  crypto.getRandomValues(octets);
  return base64UrlEncode(octets);
}
function base64UrlEncode(octets: Uint8Array): string {
  let binaire = "";
  for (const o of octets) binaire += String.fromCharCode(o);
  return btoa(binaire).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function hasherToken(tokenBrut: string): Promise<string> {
  const donnees = new TextEncoder().encode(tokenBrut);
  const digest = await crypto.subtle.digest("SHA-256", donnees);
  return Array.from(new Uint8Array(digest)).map((o) => o.toString(16).padStart(2, "0")).join("");
}

// Base64 STANDARD (avec padding) — nécessaire pour la pièce jointe
// Resend, qui attend ce format, distinct du base64url SANS padding
// utilisé pour le token (base64UrlEncode ci-dessus).
function base64EncodeStandard(octets: Uint8Array): string {
  let binaire = "";
  for (const o of octets) binaire += String.fromCharCode(o);
  return btoa(binaire);
}

// V50.5D.3A — Objectif 2 : échappement HTML serveur pour toute donnée
// dynamique injectée dans le HTML de l'email (nom client, référence
// devis). Seul le HTML est concerné — la version texte brut de l'email
// garde les valeurs normales (pas de risque d'injection dans du texte
// brut), et le token n'est jamais échappé ici : il ne transite que via
// encodeURIComponent déjà présent dans la construction de l'URL.
function echapperHtmlServeur(valeur: unknown): string {
  if (valeur === null || valeur === undefined) return "";
  return String(valeur)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const MOTIF_REFUS_LONGUEUR_MAX = 500;
function nettoyerMotifRefus(motif: unknown): string | null {
  if (typeof motif !== "string") return null;
  const nettoye = motif.trim();
  return nettoye ? nettoye.slice(0, MOTIF_REFUS_LONGUEUR_MAX) : null;
}

// Horaire/créneau — même logique que _horaireDossier/_horaireVehicule du
// Dashboard (jamais dupliquée différemment, réécrite ici car l'Edge
// Function ne peut pas importer le code du Dashboard).
function resoudreHoraire(source: any, prefixe: string, champHeurePlat: string): string | null {
  if (source[prefixe + "_heure_type"] === "creneau") {
    const d = source[prefixe + "_creneau_debut"], f = source[prefixe + "_creneau_fin"];
    return d && f ? `${d} – ${f}` : d || f || null;
  }
  return source[champHeurePlat] || null;
}

// Adresse complète si rue disponible, sinon ville seule — même principe
// que _adresseCompleteOuVille() du Dashboard.
function resoudreAdresse(rue: any, cp: any, ville: any): string | null {
  const r = (rue || "").toString().trim();
  if (r && ville) return `${r}, ${cp ? cp + " " : ""}${ville}`;
  if (r) return r;
  return ville || null;
}

// Snapshot construit EXCLUSIVEMENT à partir de lignes relues côté
// serveur. Respecte l'asymétrie réelle et confirmée de nommage
// restitution mono (dossier) / multi (véhicule).
function construireSnapshot(devis: any, client: any, vehicules: any[]) {
  const monoPdf = !vehicules || vehicules.length === 0;

  const snapshot: Record<string, unknown> = {
    version_snapshot: 1,
    reference: devis.reference,
    prix: devis.prix,
    date_snapshot: new Date().toISOString(),
    client: {
      numero_client: client.numero_client || null,
      nom_complet: [client.prenom, client.nom].filter(Boolean).join(" ") || null,
      email: client.email || null,
      telephone: client.telephone || null,
    },
    type_service: client.type_service || null,
    nombre_vehicules: monoPdf ? 1 : vehicules.length,
  };

  if (monoPdf) {
    snapshot.trajet = {
      ville_depart: client.ville_depart || null,
      adresse_depart_rue: client.adresse_depart_rue || null,
      code_postal_depart: client.code_postal_depart || null,
      ville_arrivee: client.ville_arrivee || null,
      adresse_arrivee_rue: client.adresse_arrivee_rue || null,
      code_postal_arrivee: client.code_postal_arrivee || null,
      date_prise_en_charge: client.date_prise_en_charge || null,
      horaire_prise_en_charge: resoudreHoraire(client, "pc", "heure_prise_en_charge"),
      date_livraison: client.date_livraison || null,
      horaire_livraison: resoudreHoraire(client, "liv", "heure_livraison"),
      mode_transport: client.mode_transport || null,
    };
  }

  if (client.stockage_date_debut || client.stockage_date_fin) {
    snapshot.stockage = {
      date_debut: client.stockage_date_debut || null,
      date_fin_prevue: client.stockage_date_fin || null,
      nb_jours: client.stockage_nb_jours || null,
      nb_vehicules: client.stockage_nb_vehicules || null,
      acheminement: client.stockage_acheminement || null,
      sortie: client.stockage_sortie || null,
      heure_entree: client.stockage_heure_entree || null,
      heure_sortie: client.stockage_heure_sortie || null,
    };
  }

  if (!monoPdf) {
    snapshot.vehicules = vehicules.map((v: any) => ({
      position: v.position ?? null,
      type_vehicule: v.type_vehicule || null,
      marque_modele: v.marque_modele || null,
      immatriculation: v.immatriculation || null,
      trajet: {
        ville_depart: v.ville_depart || null,
        adresse_depart_rue: v.adresse_depart_rue || null,
        code_postal_depart: v.code_postal_depart || null,
        ville_arrivee: v.ville_arrivee || null,
        adresse_arrivee_rue: v.adresse_arrivee_rue || null,
        code_postal_arrivee: v.code_postal_arrivee || null,
        date_prise_en_charge: v.date_prise_en_charge || null,
        horaire_prise_en_charge: resoudreHoraire(v, "pc", "heure_prise_en_charge"),
        date_livraison: v.date_livraison || null,
        horaire_livraison: resoudreHoraire(v, "liv", "heure_livraison"),
        mode_transport: v.mode_transport || null,
      },
      // V50.5B.4D — Objectif 3 : `restitution_concernee` est un VRAI
      // booléen (confirmé par inspection du formulaire client :
      // `ligne[k] = !!val` au moment de l'écriture dans `vehicules`),
      // contrairement à `clients.restitution` (dossier, mono) qui est
      // une chaîne 'Oui'/'Non'. Comparaison explicite === true plutôt
      // qu'un simple truthy, pour ne jamais dépendre d'une convention
      // supposée.
      restitution: v.restitution_concernee === true ? {
        adresse: resoudreAdresse(v.restit_adresse_rue, v.restit_code_postal, v.restit_ville),
        date: v.restit_date || null,
        horaire: resoudreHoraire(v, "restit", "restit_heure"),
      } : null,
    }));
  } else if (client.marque_modele || client.type_vehicule) {
    snapshot.vehicules = [{
      position: 1,
      type_vehicule: client.type_vehicule || null,
      marque_modele: client.marque_modele || null,
      immatriculation: client.immatriculation || null,
    }];
  }

  // Restitution DOSSIER (mono uniquement — la carte véhicule mono ne
  // porte structurellement aucun champ restit_*). Noms de colonnes
  // réels, différents des colonnes véhicule : adresse_restit_rue /
  // code_postal_restit / ville_restit / date_restitution /
  // heure_restitution — jamais restit_*.
  if (monoPdf && client.restitution === "Oui") {
    const adresseLegacy = client.adresse_restit_rue
      ? null
      : (client.adresse_restitution || null);
    snapshot.restitution = {
      adresse: resoudreAdresse(client.adresse_restit_rue, client.code_postal_restit, client.ville_restit) || adresseLegacy,
      date: client.date_restitution || null,
      horaire: resoudreHoraire(client, "restit", "heure_restitution"),
    };
  }

  snapshot.options = {
    urgence: client.urgence === "Oui",
    plateau: client.plateau === "Oui",
  };

  return snapshot;
}

Deno.serve(async (req: Request) => {
  const origine = req.headers.get("origin");
  const { entetes: entetesCors, autorisee } = enTetesCors(origine);

  if (req.method === "OPTIONS") {
    if (!autorisee) return new Response(null, { status: 403, headers: entetesCors });
    return new Response(null, { status: 204, headers: entetesCors });
  }
  if (!autorisee) return erreur("ORIGIN_NOT_ALLOWED", "Origine non autorisée.", 403, entetesCors);
  if (req.method !== "POST") return erreur("METHOD_NOT_ALLOWED", "Seul POST est accepté.", 405, entetesCors);

  let corpsRequete: any;
  try { corpsRequete = await req.json(); } catch { return erreur("BAD_REQUEST", "Corps JSON invalide.", 400, entetesCors); }

  const action = corpsRequete?.action;
  if (!["prepare", "get", "accept", "refuse", "send_email"].includes(action)) {
    return erreur("BAD_REQUEST", "Action inconnue.", 400, entetesCors);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Config manquante : SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absente.");
    return erreur("SERVER_MISCONFIGURED", "Erreur serveur.", 500, entetesCors);
  }
  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  try {
    if (action === "prepare") return await actionPrepare(sb, req, corpsRequete, entetesCors);
    if (action === "get") return await actionGet(sb, corpsRequete, entetesCors);
    if (action === "accept") return await actionAccept(sb, corpsRequete, entetesCors);
    if (action === "send_email") return await actionSendEmail(sb, req, corpsRequete, entetesCors);
    return await actionRefuse(sb, corpsRequete, entetesCors);
  } catch (e) {
    console.error(`Erreur action=${action}:`, e instanceof Error ? e.message : String(e));
    return erreur("INTERNAL_ERROR", "Erreur serveur.", 500, entetesCors);
  }
});

// ============================================================
// ACTION 1 — PREPARE
// ============================================================
async function actionPrepare(sb: any, req: Request, corps: any, entetesCors: Record<string, string>) {
  const enteteAuth = req.headers.get("authorization") || "";
  const jwtAppelant = enteteAuth.replace(/^Bearer\s+/i, "").trim();
  if (!jwtAppelant) return erreur("UNAUTHORIZED", "Authentification requise.", 401, entetesCors);

  // auth.getUser(jwt) accepte le JWT en argument direct : Supabase
  // valide CE JWT précis auprès de son propre serveur d'auth, sur le
  // client service_role déjà existant. Aucun second client, aucun
  // secret supplémentaire nécessaire.
  const { data: userData, error: erreurUser } = await sb.auth.getUser(jwtAppelant);
  if (erreurUser || !userData?.user) {
    return erreur("UNAUTHORIZED", "Session invalide ou expirée.", 401, entetesCors);
  }

  const { data: admin, error: erreurAdmin } = await sb
    .from("admins")
    .select("id")
    .eq("auth_user_id", userData.user.id)
    .eq("actif", true)
    .maybeSingle();
  if (erreurAdmin) {
    console.error("Erreur vérification admin:", erreurAdmin.message);
    return erreur("INTERNAL_ERROR", "Erreur serveur.", 500, entetesCors);
  }
  if (!admin) return erreur("FORBIDDEN", "Droits administrateur requis.", 403, entetesCors);

  const devisId = corps?.devis_id;
  if (!devisId) return erreur("BAD_REQUEST", "devis_id est requis.", 400, entetesCors);

  // pdf_path inclus ici : nécessaire pour nettoyer l'ANCIEN fichier
  // après succès (cf. stratégie storage ci-dessous).
  const { data: devisActuel, error: erreurLecture } = await sb
    .from("devis")
    .select("id, reference, prix, statut, client_id, pdf_path")
    .eq("id", devisId)
    .maybeSingle();
  if (erreurLecture || !devisActuel) return erreur("NOT_FOUND", "Devis introuvable.", 404, entetesCors);

  // V50.5B.4D — Objectif 1 : vraie ALLOWLIST plutôt qu'une blacklist —
  // tout statut qui n'est ni 'genere' ni 'envoye' (y compris un futur
  // statut non encore anticipé) est refusé par défaut, jamais par
  // exception au cas par cas.
  const STATUTS_PREPARABLES = ["genere", "envoye"];
  if (!STATUTS_PREPARABLES.includes(devisActuel.statut)) {
    return erreur(
      "INVALID_STATE",
      "Ce devis n'est pas dans un état permettant sa préparation.",
      409,
      entetesCors,
    );
  }

  // vehicules.dossier_id = clients.id = devis.client_id — confirmé par
  // lecture directe de loadDemandesDevis dans le Dashboard.
  const { data: client, error: erreurClient } = await sb
    .from("clients")
    .select("*")
    .eq("id", devisActuel.client_id)
    .maybeSingle();
  if (erreurClient || !client) return erreur("NOT_FOUND", "Dossier introuvable.", 404, entetesCors);

  const { data: vehicules, error: erreurVehicules } = await sb
    .from("vehicules")
    .select(`
      position, type_vehicule, marque_modele, immatriculation, mode_transport,
      ville_depart, adresse_depart_rue, code_postal_depart,
      ville_arrivee, adresse_arrivee_rue, code_postal_arrivee,
      date_prise_en_charge, pc_heure_type, pc_creneau_debut, pc_creneau_fin, heure_prise_en_charge,
      date_livraison, liv_heure_type, liv_creneau_debut, liv_creneau_fin, heure_livraison,
      restitution_concernee, restit_adresse_rue, restit_code_postal, restit_ville,
      restit_date, restit_heure_type, restit_creneau_debut, restit_creneau_fin, restit_heure
    `)
    .eq("dossier_id", devisActuel.client_id)
    .order("position", { ascending: true });

  // Une erreur ici ne doit JAMAIS être silencieusement traitée comme
  // "0 véhicule" : un dossier réellement multi-véhicules serait alors
  // traité à tort comme mono, faussant tout le snapshot contractuel.
  // Arrêt immédiat : pas de snapshot construit, pas d'upload PDF, pas
  // de token généré/remplacé.
  if (erreurVehicules) {
    console.error("Erreur lecture vehicules (sans détail sensible) : lecture échouée.");
    return erreur("INTERNAL_ERROR", "Erreur serveur.", 500, entetesCors);
  }

  const snapshot = construireSnapshot(devisActuel, client, vehicules || []);

  // PDF — validation de contenu.
  const pdfBase64 = corps?.pdf_base64;
  const pdfMime = corps?.pdf_mime;
  if (typeof pdfBase64 !== "string" || !pdfBase64.length) {
    return erreur("BAD_REQUEST", "Le PDF est requis.", 400, entetesCors);
  }
  if (pdfMime !== "application/pdf") {
    return erreur("BAD_REQUEST", "Type de fichier invalide.", 400, entetesCors);
  }
  let octetsPdf: Uint8Array;
  try {
    octetsPdf = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0));
  } catch {
    return erreur("BAD_REQUEST", "Contenu PDF invalide (décodage échoué).", 400, entetesCors);
  }
  const TAILLE_MIN = 1024;
  const TAILLE_MAX = 10 * 1024 * 1024;
  if (octetsPdf.length < TAILLE_MIN || octetsPdf.length > TAILLE_MAX) {
    return erreur("BAD_REQUEST", "Taille du PDF hors limites acceptables.", 400, entetesCors);
  }
  const enteteAttendue = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
  if (!enteteAttendue.every((o, i) => octetsPdf[i] === o)) {
    return erreur("BAD_REQUEST", "Le contenu reçu n'est pas un PDF valide.", 400, entetesCors);
  }

  // Chemin UNIQUE à chaque préparation, jamais réutilisé. L'ancien
  // fichier (pdf_path lu ci-dessus, AVANT toute écriture) n'est
  // supprimé QU'APRÈS succès confirmé de l'UPDATE DB — jamais avant.
  const ancienPdfPath = devisActuel.pdf_path || null;
  const nouveauPdfPath = `${devisActuel.id}/devis-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.pdf`;

  const { error: erreurUpload } = await sb.storage
    .from("devis")
    .upload(nouveauPdfPath, octetsPdf, { contentType: "application/pdf", upsert: false });
  if (erreurUpload) {
    console.error("Erreur upload PDF (sans détail sensible) : upload échoué.");
    return erreur("PDF_UPLOAD_FAILED", "Échec du stockage du PDF.", 500, entetesCors);
  }

  const tokenBrut = genererTokenBrut();
  const tokenHash = await hasherToken(tokenBrut);
  const dateExpiration = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

  // V50.5B.4D — Objectif 2 : PROTECTION CONTRE LA COURSE PREPARE /
  // ACCEPT / REFUSE. Entre la lecture initiale du statut (plus haut) et
  // cet UPDATE final, le client a pu accepter/refuser le devis via une
  // autre requête. L'UPDATE ne doit donc PLUS filtrer uniquement par
  // `id` : il ne modifie la ligne QUE si son statut est ENCORE
  // préparable au moment exact de l'écriture — la même allowlist que
  // celle vérifiée en lecture, appliquée maintenant comme condition
  // atomique du UPDATE lui-même (PostgreSQL garantit qu'une seule
  // requête concurrente peut réussir cette condition).
  const { data: ligneMiseAJour, error: erreurEcriture } = await sb
    .from("devis")
    .update({
      acceptation_token_hash: tokenHash,
      date_expiration_token: dateExpiration,
      snapshot_devis: snapshot,
      pdf_path: nouveauPdfPath,
    })
    .in("statut", STATUTS_PREPARABLES)
    .eq("id", devisActuel.id)
    .select("id, statut")
    .maybeSingle();

  if (erreurEcriture) {
    // Échec technique réel (pas une course perdue) : le nouveau PDF
    // orphelin est supprimé, l'ancien n'est jamais touché.
    await sb.storage.from("devis").remove([nouveauPdfPath]).catch(() => {});
    console.error("Erreur écriture devis après upload réussi:", erreurEcriture.message);
    return erreur("INTERNAL_ERROR", "Échec de la préparation.", 500, entetesCors);
  }

  if (!ligneMiseAJour) {
    // Aucune ligne modifiée : le devis a changé de statut (accepté ou
    // refusé) entre la lecture initiale et cet UPDATE — la course a été
    // perdue. Le nouveau PDF est supprimé, l'ANCIEN n'est jamais touché
    // (il reste celui référencé par la ligne réelle, désormais
    // accepte/refuse). Le token brut n'est jamais renvoyé.
    await sb.storage.from("devis").remove([nouveauPdfPath]).catch(() => {});
    return erreur(
      "INVALID_STATE",
      "Ce devis a changé d'état entre-temps et ne peut plus être préparé.",
      409,
      entetesCors,
    );
  }

  // Écriture confirmée réellement réussie : l'ancien PDF peut désormais
  // être supprimé sans aucun risque.
  if (ancienPdfPath && ancienPdfPath !== nouveauPdfPath) {
    await sb.storage.from("devis").remove([ancienPdfPath]).catch(() => {});
  }

  return reponseJson({ ok: true, token: tokenBrut, date_expiration_token: dateExpiration }, 200, entetesCors);
}

// ============================================================
// ACTION 5 — SEND_EMAIL (Resend, admin-only)
// ============================================================
// V50.5D.3 — Expéditeur temporaire tant que le domaine HelixCar n'est
// pas vérifié auprès de Resend. Constante isolée, facile à remplacer
// une fois le domaine prêt — aucune autre ligne à toucher.
const RESEND_FROM_TEMPORAIRE = "HelixCar <onboarding@resend.dev>";

async function actionSendEmail(sb: any, req: Request, corps: any, entetesCors: Record<string, string>) {
  // Auth admin — EXACTEMENT le même mécanisme que actionPrepare :
  // JWT Supabase Auth de l'appelant, validé par Supabase lui-même via
  // auth.getUser(jwt), puis vérification d'appartenance à
  // public.admins avec actif = true. Aucune confiance dans quoi que
  // ce soit affirmé par le navigateur au-delà de ce JWT.
  const enteteAuth = req.headers.get("authorization") || "";
  const jwtAppelant = enteteAuth.replace(/^Bearer\s+/i, "").trim();
  if (!jwtAppelant) return erreur("UNAUTHORIZED", "Authentification requise.", 401, entetesCors);

  const { data: userData, error: erreurUser } = await sb.auth.getUser(jwtAppelant);
  if (erreurUser || !userData?.user) {
    return erreur("UNAUTHORIZED", "Session invalide ou expirée.", 401, entetesCors);
  }

  const { data: admin, error: erreurAdmin } = await sb
    .from("admins")
    .select("id")
    .eq("auth_user_id", userData.user.id)
    .eq("actif", true)
    .maybeSingle();
  if (erreurAdmin) {
    console.error("Erreur vérification admin:", erreurAdmin.message);
    return erreur("INTERNAL_ERROR", "Erreur serveur.", 500, entetesCors);
  }
  if (!admin) return erreur("FORBIDDEN", "Droits administrateur requis.", 403, entetesCors);

  const devisId = corps?.devis_id;
  const tokenBrut = corps?.token;
  if (!devisId) return erreur("BAD_REQUEST", "devis_id est requis.", 400, entetesCors);
  if (typeof tokenBrut !== "string" || tokenBrut.length < 20) {
    return erreur("BAD_REQUEST", "Token invalide.", 400, entetesCors);
  }

  // Relecture serveur exclusive — jamais de confiance dans un email
  // client, une référence, un prix, un trajet, une identité, un
  // statut ou un chemin PDF affirmés par le navigateur.
  const { data: devisActuel, error: erreurLecture } = await sb
    .from("devis")
    .select("id, reference, prix, statut, client_id, pdf_path, acceptation_token_hash, date_expiration_token")
    .eq("id", devisId)
    .maybeSingle();
  if (erreurLecture || !devisActuel) return erreur("NOT_FOUND", "Devis introuvable.", 404, entetesCors);

  // Le token fourni doit correspondre au token PREPARE actuellement
  // actif pour CE devis précis — jamais loggé.
  const tokenHash = await hasherToken(tokenBrut);
  if (devisActuel.acceptation_token_hash !== tokenHash) {
    return erreur("TOKEN_MISMATCH", "Le token fourni ne correspond pas à la préparation actuelle de ce devis.", 409, entetesCors);
  }
  if (!devisActuel.date_expiration_token || new Date(devisActuel.date_expiration_token) < new Date()) {
    return erreur("TOKEN_EXPIRED", "Le token de préparation a expiré.", 409, entetesCors);
  }
  if (!devisActuel.pdf_path) {
    return erreur("PDF_NOT_READY", "Aucun PDF préparé pour ce devis.", 409, entetesCors);
  }

  // V50.5D.3 — première version : autorisé UNIQUEMENT depuis 'genere'.
  // Les renvois d'un devis déjà 'envoye' ne sont volontairement PAS
  // gérés ici (cf. rapport) pour ne pas créer de problème
  // renvoi/invalidation de lien avant validation du premier envoi.
  if (devisActuel.statut !== "genere") {
    return erreur("INVALID_STATE", "Ce devis n'est pas dans un état permettant l'envoi (statut attendu : genere).", 409, entetesCors);
  }

  const { data: client, error: erreurClient } = await sb
    .from("clients")
    .select("email, prenom, nom")
    .eq("id", devisActuel.client_id)
    .maybeSingle();
  if (erreurClient || !client || !client.email) {
    return erreur("NOT_FOUND", "Client ou email introuvable pour ce devis.", 404, entetesCors);
  }

  // Récupération du PDF EXACT stocké par PREPARE — jamais une
  // deuxième copie demandée au Dashboard, jamais régénéré.
  const { data: pdfBlob, error: erreurTelechargement } = await sb.storage
    .from("devis")
    .download(devisActuel.pdf_path);
  if (erreurTelechargement || !pdfBlob) {
    console.error("Erreur téléchargement PDF (sans détail sensible) : téléchargement échoué.");
    return erreur("PDF_UNAVAILABLE", "Impossible de récupérer le PDF du devis.", 500, entetesCors);
  }
  const octetsPdf = new Uint8Array(await pdfBlob.arrayBuffer());
  if (!octetsPdf.length) {
    return erreur("PDF_UNAVAILABLE", "Le PDF récupéré est vide.", 500, entetesCors);
  }
  const enteteAttendue = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
  if (!enteteAttendue.every((o, i) => octetsPdf[i] === o)) {
    return erreur("PDF_UNAVAILABLE", "Le fichier récupéré n'est pas un PDF valide.", 500, entetesCors);
  }
  const pdfBase64Standard = base64EncodeStandard(octetsPdf);
  const nomPieceJointe = `Devis_HelixCar_${devisActuel.reference}.pdf`;

  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) {
    console.error("Config manquante : RESEND_API_KEY absente.");
    return erreur("SERVER_MISCONFIGURED", "Erreur serveur.", 500, entetesCors);
  }

  // Lien sécurisé — construit ici, jamais transmis par le navigateur.
  // Le token n'apparaît que dans ce href, nulle part ailleurs dans
  // l'email. Non échappé par echapperHtmlServeur : sa protection est
  // déjà assurée par encodeURIComponent (échappement HTML n'a pas de
  // sens sur un composant d'URL déjà encodé).
  const urlClient = `https://helixcar-i89b.vercel.app/devis.html?token=${encodeURIComponent(tokenBrut)}`;
  const nomClient = [client.prenom, client.nom].filter(Boolean).join(" ") || "client HelixCar";
  const sujet = `Votre devis HelixCar — ${devisActuel.reference}`;

  // V50.5D.3A — Objectif 2 : variables échappées, réservées au HTML
  // uniquement. La version texte brut plus bas continue d'utiliser les
  // valeurs normales (nomClient, devisActuel.reference) : pas de risque
  // d'injection dans du texte brut, aucune raison de les altérer.
  const nomClientHtml = echapperHtmlServeur(nomClient);
  const referenceHtml = echapperHtmlServeur(devisActuel.reference);

  const htmlEmail = `<!DOCTYPE html><html><body style="font-family:-apple-system,Helvetica,Arial,sans-serif;background:#F7F3EC;padding:24px;margin:0">
<div style="max-width:520px;margin:0 auto;background:#FFFFFF;border-radius:3px;overflow:hidden">
  <div style="background:#14181D;padding:20px 24px"><span style="color:#FFFFFF;font-size:1.3rem;font-weight:800">HELIX<span style="color:#E5484D">CAR</span></span></div>
  <div style="padding:28px 24px">
    <p>Bonjour ${nomClientHtml},</p>
    <p>Votre devis HelixCar <strong>${referenceHtml}</strong> est disponible.</p>
    <p>Vous trouverez également votre devis au format PDF en pièce jointe.</p>
    <div style="text-align:center;margin:28px 0">
      <a href="${urlClient}" style="background:#14181D;color:#FFFFFF;text-decoration:none;padding:14px 26px;border-radius:2px;display:inline-block;font-weight:600">Consulter et répondre à mon devis</a>
    </div>
    <p style="font-size:0.88rem;color:#454C55">Ce lien sécurisé vous permet de consulter votre devis et de l'accepter ou de le refuser en ligne.</p>
    <p>Cordialement,<br>L'équipe HelixCar</p>
  </div>
</div>
</body></html>`;

  const texteEmail =
    `Bonjour ${nomClient},\n\n` +
    `Votre devis HelixCar ${devisActuel.reference} est disponible.\n\n` +
    `Vous trouverez également votre devis au format PDF en pièce jointe.\n\n` +
    `Pour consulter votre devis et nous transmettre votre réponse : ${urlClient}\n\n` +
    `Ce lien sécurisé vous permet de consulter votre devis et de l'accepter ou de le refuser en ligne.\n\n` +
    `Cordialement,\nL'équipe HelixCar`;

  let reponseResend: Response;
  try {
    reponseResend = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: RESEND_FROM_TEMPORAIRE,
        to: [client.email],
        subject: sujet,
        html: htmlEmail,
        text: texteEmail,
        attachments: [{ filename: nomPieceJointe, content: pdfBase64Standard }],
      }),
    });
  } catch (e) {
    console.error("Erreur réseau Resend (sans détail sensible).");
    return erreur("EMAIL_SEND_FAILED", "Échec de l'envoi de l'email.", 502, entetesCors);
  }

  if (!reponseResend.ok) {
    console.error("Resend a refusé l'envoi, statut HTTP:", reponseResend.status);
    return erreur("EMAIL_SEND_FAILED", "Échec de l'envoi de l'email.", 502, entetesCors);
  }

  // Resend a confirmé l'acceptation de l'envoi — SEULEMENT MAINTENANT
  // le statut peut passer à 'envoye', et uniquement si la ligne est
  // encore 'genere' au moment exact de l'écriture (protection contre
  // une course concurrente, même principe qu'en PREPARE).
  const maintenant = new Date().toISOString();
  const { data: ligneMiseAJour, error: erreurEcriture } = await sb
    .from("devis")
    .update({ statut: "envoye", date_envoi: maintenant })
    .eq("id", devisId)
    .eq("statut", "genere")
    .select("id, statut, date_envoi")
    .maybeSingle();

  if (erreurEcriture || !ligneMiseAJour) {
    // CAS CRITIQUE : l'email est réellement parti, mais la mise à jour
    // du statut a échoué. Ne jamais prétendre le contraire, ne jamais
    // relancer automatiquement un nouvel envoi.
    console.error("Email envoyé mais échec de la mise à jour du statut:", erreurEcriture?.message || "aucune ligne mise à jour");
    return erreur(
      "EMAIL_SENT_DB_UPDATE_FAILED",
      "L'email a été envoyé au client, mais la mise à jour du statut a échoué. Vérifiez le dossier avant de réessayer.",
      500,
      entetesCors,
    );
  }

  return reponseJson({ ok: true, statut: ligneMiseAJour.statut, date_envoi: ligneMiseAJour.date_envoi }, 200, entetesCors);
}

// ============================================================
// ACTIONS 2-4 — GET / ACCEPT / REFUSE (inchangées)
// ============================================================
async function actionGet(sb: any, corps: any, entetesCors: Record<string, string>) {
  const tokenBrut = corps?.token;
  if (typeof tokenBrut !== "string" || tokenBrut.length < 20) {
    return erreur("INVALID_OR_EXPIRED_LINK", "Lien invalide ou expiré.", 404, entetesCors);
  }
  const tokenHash = await hasherToken(tokenBrut);
  const { data: devis, error } = await sb
    .from("devis")
    .select("reference, prix, statut, snapshot_devis, date_envoi, date_acceptation, date_refus, date_expiration_token, pdf_path")
    .eq("acceptation_token_hash", tokenHash)
    .maybeSingle();
  if (error || !devis) return erreur("INVALID_OR_EXPIRED_LINK", "Lien invalide ou expiré.", 404, entetesCors);
  if (devis.date_expiration_token && new Date(devis.date_expiration_token) < new Date()) {
    return erreur("INVALID_OR_EXPIRED_LINK", "Lien invalide ou expiré.", 404, entetesCors);
  }
  let pdfUrl: string | null = null;
  if (devis.pdf_path) {
    const { data: urlSignee } = await sb.storage.from("devis").createSignedUrl(devis.pdf_path, 10 * 60);
    pdfUrl = urlSignee?.signedUrl ?? null;
  }
  return reponseJson({
    ok: true,
    devis: {
      reference: devis.reference, prix: devis.prix, statut: devis.statut,
      snapshot: devis.snapshot_devis, date_envoi: devis.date_envoi,
      date_acceptation: devis.date_acceptation, date_refus: devis.date_refus,
      pdf_disponible: !!devis.pdf_path, pdf_url: pdfUrl,
    },
  }, 200, entetesCors);
}

async function actionAccept(sb: any, corps: any, entetesCors: Record<string, string>) {
  return await traiterReponseDevis(sb, corps, "accepte", entetesCors);
}
async function actionRefuse(sb: any, corps: any, entetesCors: Record<string, string>) {
  return await traiterReponseDevis(sb, corps, "refuse", entetesCors);
}

async function traiterReponseDevis(sb: any, corps: any, cibleStatut: "accepte" | "refuse", entetesCors: Record<string, string>) {
  const tokenBrut = corps?.token;
  if (typeof tokenBrut !== "string" || tokenBrut.length < 20) {
    return erreur("INVALID_OR_EXPIRED_LINK", "Lien invalide ou expiré.", 404, entetesCors);
  }
  const tokenHash = await hasherToken(tokenBrut);
  const maintenant = new Date().toISOString();
  const champsEcriture: Record<string, unknown> = cibleStatut === "accepte"
    ? { statut: "accepte", date_acceptation: maintenant, date_refus: null }
    : { statut: "refuse", date_refus: maintenant, motif_refus: nettoyerMotifRefus(corps?.motif) };

  const { data: ligneModifiee, error: erreurEcriture } = await sb
    .from("devis").update(champsEcriture)
    .eq("acceptation_token_hash", tokenHash).eq("statut", "envoye").gt("date_expiration_token", maintenant)
    .select("id, statut").maybeSingle();
  if (erreurEcriture) return erreur("INTERNAL_ERROR", "Erreur serveur.", 500, entetesCors);
  if (ligneModifiee) {
    return reponseJson({ ok: true, status: ligneModifiee.statut, already_accepted: false, already_refused: false }, 200, entetesCors);
  }
  const { data: etatActuel } = await sb.from("devis").select("statut, date_expiration_token").eq("acceptation_token_hash", tokenHash).maybeSingle();
  if (!etatActuel) return erreur("INVALID_OR_EXPIRED_LINK", "Lien invalide ou expiré.", 404, entetesCors);
  if (etatActuel.date_expiration_token && new Date(etatActuel.date_expiration_token) < new Date()) {
    return erreur("INVALID_OR_EXPIRED_LINK", "Lien invalide ou expiré.", 404, entetesCors);
  }
  if (etatActuel.statut === cibleStatut) {
    return reponseJson({ ok: true, status: etatActuel.statut, already_accepted: cibleStatut === "accepte", already_refused: cibleStatut === "refuse" }, 200, entetesCors);
  }
  return erreur("ACTION_IMPOSSIBLE", "Ce devis ne peut plus recevoir cette réponse.", 409, entetesCors);
}
