// deno-lint-ignore-file no-explicit-any
// ============================================================
// HelixCar — Edge Function « devis-secure »
// ============================================================
// Le cycle de vie d'un devis, CÔTÉ SERVEUR : préparation du PDF figé
// et du lien sécurisé, envoi réel par le prestataire d'e-mail,
// consultation, acceptation, refus. Cette fonction est le SEUL
// détenteur de la clé service_role et de la clé Resend.
//
// Historique : ce fichier vivait à la racine du dépôt (index.ts), hors
// de l'arborescence que la CLI Supabase sait déployer. Il est déplacé
// ici (historique git conservé) et rendu testable hors Deno : la
// logique est exportée, le démarrage réel n'a lieu que sous Deno.
//
// ------------------------------------------------------------
// LOT Q01 — CE QUI CHANGE, ET POURQUOI
// ------------------------------------------------------------
//   * ORIGINES : seul le domaine d'aperçu était autorisé. Le Dashboard
//     servi sur https://helixcar.vercel.app aurait été refusé au
//     preflight. Les deux domaines officiels sont autorisés, un futur
//     domaine s'ajoute par variable d'environnement (décision C07).
//   * LIEN CLIENT : construit à partir d'une URL publique canonique
//     configurée par environnement (HELIXCAR_URL_PUBLIQUE), à défaut
//     de l'origine autorisée qui appelle — jamais codé en dur sur le
//     domaine d'aperçu.
//   * VERSIONS : un devis a une version (migration 106). Préparer,
//     envoyer et accepter portent chacun la version concernée ; une
//     version modifiée après envoi doit être renvoyée et acceptée à
//     nouveau.
//   * JOURNAL (décision C11) : préparation, tentative, acceptation par
//     le prestataire, échec — chacun sa ligne dans devis_envois. Le
//     statut « envoyé » n'est posé qu'après acceptation réelle par le
//     prestataire. La RÉCEPTION en boîte n'est pas prouvée ici : elle
//     exigerait le webhook du prestataire (non configuré) — l'étape
//     reception_prouvee existe dans le journal, rien ne la renseigne.
//   * RENVOI EXPLICITE : possible depuis « envoyé », tracé comme tel,
//     sans nouveau devis ni nouvelle mission ni paiement.
//   * DOUBLE ENVOI : clé d'idempotence par tentative (envoi_cle) et
//     verrou serveur (envoi_en_cours_depuis) contre deux onglets.
//   * ÉTATS SÉPARÉS : consulté (première ouverture), accepté —
//     paiement en attente (paiement_statut), sans jamais toucher au
//     paiement lui-même : aucun objet Stripe n'existe dans ce lot.
//
// Déploiement (à faire par HelixCar, non exécuté ici) :
//   supabase functions deploy devis-secure
// Variables d'environnement des Edge Functions :
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY
//   HELIXCAR_URL_PUBLIQUE (facultative), HELIXCAR_ORIGINES_SUPPLEMENTAIRES
//   (facultative), RESEND_FROM (facultative, une fois le domaine vérifié)

import { construirePdfServeur } from "../_shared/devis-pdf.mjs";

export const ORIGINE_PRODUCTION = "https://helixcar.vercel.app";
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

export const ENTETES_AUTORISES = ["content-type", "authorization", "apikey", "x-client-info", "x-supabase-api-version"];

export function enTetesCors(origine: string | null): { entetes: Record<string, string>; autorisee: boolean } {
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
export function preflightAcceptable(demandes: string | null): boolean {
  if (!demandes) return true;
  return demandes.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean)
    .every((h) => ENTETES_AUTORISES.includes(h));
}

// L'URL PUBLIQUE CANONIQUE du site, pour les liens envoyés aux clients.
// Priorité : la variable d'environnement (un seul domaine officiel,
// décision C07) ; à défaut, l'origine AUTORISÉE qui appelle (le
// Dashboard servi sur le domaine courant) ; à défaut la production.
// Jamais une valeur venue du corps de la requête.
export function urlPubliqueSite(env: Record<string, string | undefined>, origineAppelante: string | null): string {
  const configuree = String(env.HELIXCAR_URL_PUBLIQUE || "").trim().replace(/\/+$/, "");
  if (/^https:\/\/[a-z0-9.-]+$/i.test(configuree)) return configuree;
  if (origineAppelante && ORIGINES_AUTORISEES.includes(origineAppelante) && /^https:/.test(origineAppelante)) {
    return origineAppelante;
  }
  return ORIGINE_PRODUCTION;
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
export async function hasherToken(tokenBrut: string): Promise<string> {
  const donnees = new TextEncoder().encode(tokenBrut);
  const digest = await crypto.subtle.digest("SHA-256", donnees);
  return Array.from(new Uint8Array(digest)).map((o) => o.toString(16).padStart(2, "0")).join("");
}

// Base64 STANDARD (avec padding) — nécessaire pour la pièce jointe
// Resend, distinct du base64url SANS padding utilisé pour le token.
function base64EncodeStandard(octets: Uint8Array): string {
  let binaire = "";
  const morceau = 0x8000;
  for (let i = 0; i < octets.length; i += morceau) {
    binaire += String.fromCharCode.apply(null, Array.from(octets.subarray(i, i + morceau)));
  }
  return btoa(binaire);
}

// Échappement HTML serveur pour toute donnée dynamique injectée dans le
// HTML de l'e-mail. Le token n'est jamais échappé ici : il ne transite
// que via encodeURIComponent dans la construction de l'URL.
export function echapperHtmlServeur(valeur: unknown): string {
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
  const sansVehicule = client.type_service === 'professionnel' && client.professionnel_details?.categorie === 'technicien';

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
    nombre_vehicules: sansVehicule ? 0 : monoPdf ? 1 : vehicules.length,
  };

  if (monoPdf && !sansVehicule) {
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

  if (!monoPdf && !sansVehicule) {
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
  } else if (!sansVehicule && (client.marque_modele || client.type_vehicule)) {
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
  if (monoPdf && !sansVehicule && client.restitution === "Oui") {
    const adresseLegacy = client.adresse_restit_rue
      ? null
      : (client.adresse_restitution || null);
    snapshot.restitution = {
      adresse: resoudreAdresse(client.adresse_restit_rue, client.code_postal_restit, client.ville_restit) || adresseLegacy,
      date: client.date_restitution || null,
      horaire: resoudreHoraire(client, "restit", "heure_restitution"),
    };
  }

  snapshot.nettoyage_details = client.nettoyage_details || null;
  snapshot.professionnel_details = client.professionnel_details || null;

  snapshot.options = {
    urgence: client.urgence === "Oui",
    plateau: client.plateau === "Oui",
  };

  return snapshot;
}


// ------------------------------------------------------------
// JOURNAL DES ENVOIS (migration 106) — un fait par ligne, jamais un
// secret. Le résultat permet au transport de refuser un envoi non tracé.
// ------------------------------------------------------------
async function journaliser(sb: any, ligne: {
  devis_id: string; version: number; etape: string; destinataire?: string | null;
  renvoi?: boolean; envoi_cle?: string | null; fournisseur?: string | null;
  fournisseur_id?: string | null; detail?: string | null; auteur?: string | null;
}) {
  try {
    const { error } = await sb.from("devis_envois").insert({
      devis_id: ligne.devis_id,
      version: ligne.version,
      etape: ligne.etape,
      destinataire: ligne.destinataire ?? null,
      renvoi: !!ligne.renvoi,
      envoi_cle: ligne.envoi_cle ?? null,
      fournisseur: ligne.fournisseur ?? null,
      fournisseur_id: ligne.fournisseur_id ?? null,
      detail: ligne.detail ?? null,
      auteur: ligne.auteur ?? null,
    });
    if (error) { console.error("Écriture du journal devis impossible."); return false; }
    return true;
  } catch (e) {
    console.error("Écriture du journal devis impossible.");
    return false;
  }
}

// Authentification d'un ADMINISTRATEUR : le JWT de session est validé
// par Supabase lui-même, puis l'appartenance à public.admins (actif).
async function adminAuthentifie(sb: any, req: Request, cors: Record<string, string>) {
  const enteteAuth = req.headers.get("authorization") || "";
  const jwtAppelant = enteteAuth.replace(/^Bearer\s+/i, "").trim();
  if (!jwtAppelant) return { refus: erreur("UNAUTHORIZED", "Authentification requise.", 401, cors) };
  const { data: userData, error: erreurUser } = await sb.auth.getUser(jwtAppelant);
  if (erreurUser || !userData?.user) {
    return { refus: erreur("UNAUTHORIZED", "Session invalide ou expirée. Reconnectez-vous puis réessayez.", 401, cors) };
  }
  const { data: admin, error: erreurAdmin } = await sb
    .from("admins").select("id").eq("auth_user_id", userData.user.id).eq("actif", true).maybeSingle();
  if (erreurAdmin) {
    console.error("Erreur vérification admin:", erreurAdmin.message);
    return { refus: erreur("INTERNAL_ERROR", "Erreur serveur.", 500, cors) };
  }
  if (!admin) return { refus: erreur("FORBIDDEN", "Droits administrateur requis.", 403, cors) };
  return { uid: userData.user.id as string };
}

const CHAMPS_DEVIS =
  "id, reference, prix, statut, client_id, date_generation, snapshot_devis, pdf_path, acceptation_token_hash, date_expiration_token, " +
  "version, version_preparee, version_envoyee, version_acceptee, envoi_en_cours_depuis, paiement_statut, date_envoi, annule_le, expire_le";

// ============================================================
// ACTION 1 — PREPARE : PDF figé + lien sécurisé, pour LA version courante
// ============================================================
export async function actionPrepare(sb: any, req: Request, corps: any, cors: Record<string, string>) {
  const auth = await adminAuthentifie(sb, req, cors);
  if ("refus" in auth) return auth.refus;

  const devisId = corps?.devis_id;
  if (typeof devisId !== "string" || !devisId) return erreur("BAD_REQUEST", "devis_id est requis.", 400, cors);

  const { data: devisActuel, error: erreurLecture } = await sb
    .from("devis").select(CHAMPS_DEVIS).eq("id", devisId).maybeSingle();
  if (erreurLecture || !devisActuel) return erreur("NOT_FOUND", "Devis introuvable.", 404, cors);

  const { data: operationActive, error: operationError } = await sb.from("devis_envoi_operations")
    .select("id").eq("devis_id", devisId).in("etat", ["en_cours", "a_reconcilier"]).limit(1).maybeSingle();
  if (operationError) return erreur("INTERNAL_ERROR", "Impossible de vérifier les envois précédents.", 500, cors);
  if (operationActive) return erreur("ENVOI_A_REPRENDRE", "Un envoi attend sa confirmation. Reprenez cet envoi avant de préparer un nouveau devis.", 409, cors);

  // ALLOWLIST : tout statut qui n'est ni 'genere' ni 'envoye' est refusé.
  const STATUTS_PREPARABLES = ["genere", "envoye"];
  if (!STATUTS_PREPARABLES.includes(devisActuel.statut) || devisActuel.annule_le || devisActuel.expire_le) {
    return erreur("INVALID_STATE", "Ce devis n'est pas dans un état permettant sa préparation.", 409, cors);
  }

  const { data: client, error: erreurClient } = await sb
    .from("clients").select("*").eq("id", devisActuel.client_id).maybeSingle();
  if (erreurClient || !client) return erreur("NOT_FOUND", "Dossier introuvable.", 404, cors);

  const { data: vehicules, error: erreurVehicules } = await sb
    .from("vehicules")
    .select("*")
    .eq("dossier_id", devisActuel.client_id)
    .order("position", { ascending: true });
  // Une erreur ici ne doit JAMAIS être traitée comme « 0 véhicule ».
  if (erreurVehicules) {
    console.error("Erreur lecture vehicules : lecture échouée.");
    return erreur("INTERNAL_ERROR", "Erreur serveur.", 500, cors);
  }

  const snapshot = construireSnapshot(devisActuel, client, vehicules || []);
  const comparable = (v:any) => { const r={...v};delete r.date_snapshot;delete r.version;return JSON.stringify(r); };
  if (devisActuel.snapshot_devis && devisActuel.version_preparee === devisActuel.version &&
      comparable(snapshot) !== comparable(devisActuel.snapshot_devis)) {
    const ancienneVersion=devisActuel.version;
    const {data:revisee,error:e}=await sb.from("devis").update({version:ancienneVersion+1,consulte_le:null})
      .eq("id",devisId).eq("version",ancienneVersion).in("statut",STATUTS_PREPARABLES).select("version").maybeSingle();
    if(e || !revisee) return erreur("INVALID_STATE","Le devis a changé. Rouvrez le dossier avant de préparer son envoi.",409,cors);
    devisActuel.version=revisee.version;
  }
  (snapshot as any).version = devisActuel.version ?? 1;

  // Q01-009 : le navigateur ne fournit plus aucun contenu PDF faisant foi.
  // Le moteur de rendu est dérivé du PDF validé, contrôlé à chaque test.
  const jspdf = typeof Deno !== "undefined"
    ? await import("npm:jspdf@4.2.1") : await import("jspdf");
  const dossierPdf = { ...client, _vehicules: vehicules || [] };
  const documentPdf = construirePdfServeur(jspdf.jsPDF, dossierPdf, devisActuel);
  const octetsPdf = new Uint8Array(documentPdf.output("arraybuffer"));
  if (octetsPdf.length < 1024 || octetsPdf.length > 10 * 1024 * 1024) {
    return erreur("PDF_GENERATION_FAILED", "Le PDF ne peut pas être préparé. Contactez HelixCar.", 500, cors);
  }

  // Chemin UNIQUE à chaque préparation. Les anciennes versions sont conservées.
  const nouveauPdfPath = `${devisActuel.id}/devis-v${devisActuel.version ?? 1}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.pdf`;

  const { error: erreurUpload } = await sb.storage
    .from("devis").upload(nouveauPdfPath, octetsPdf, { contentType: "application/pdf", upsert: false });
  if (erreurUpload) {
    console.error("Erreur upload PDF : upload échoué.");
    return erreur("PDF_UPLOAD_FAILED", "Échec du stockage du PDF.", 500, cors);
  }

  const tokenBrut = genererTokenBrut();
  const tokenHash = await hasherToken(tokenBrut);
  const dateExpiration = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

  // COURSE PREPARE / ACCEPT / REFUSE : l'UPDATE ne modifie la ligne QUE
  // si son statut est ENCORE préparable ET sa version encore celle qui
  // vient d'être lue — une modification de prix entre-temps ferait
  // préparer un PDF périmé.
  const { data: ligneMiseAJour, error: erreurEcriture } = await sb
    .from("devis")
    .update({
      acceptation_token_hash: tokenHash,
      date_expiration_token: dateExpiration,
      snapshot_devis: snapshot,
      pdf_path: nouveauPdfPath,
      version_preparee: devisActuel.version ?? 1,
    })
    .in("statut", STATUTS_PREPARABLES)
    .eq("id", devisActuel.id)
    .eq("version", devisActuel.version ?? 1)
    .select("id, statut, version")
    .maybeSingle();

  if (erreurEcriture) {
    try { await sb.storage.from("devis").remove([nouveauPdfPath]); } catch { /* nettoyage au mieux */ }
    console.error("Erreur écriture devis après upload réussi:", erreurEcriture.message);
    return erreur("INTERNAL_ERROR", "Échec de la préparation.", 500, cors);
  }
  if (!ligneMiseAJour) {
    try { await sb.storage.from("devis").remove([nouveauPdfPath]); } catch { /* nettoyage au mieux */ }
    return erreur("INVALID_STATE", "Ce devis a changé d'état entre-temps et ne peut plus être préparé. Rouvrez le dossier.", 409, cors);
  }
  const { error: archiveError } = await sb.from("devis_preparations").insert({
    devis_id: devisActuel.id, version: devisActuel.version ?? 1,
    token_hash: tokenHash, pdf_path: nouveauPdfPath, snapshot_devis: snapshot,
    date_expiration: dateExpiration, envoyee_le: null,
  });
  if (archiveError) return erreur("ARCHIVE_FAILED", "Le PDF est préparé mais son archivage doit être repris. Aucun envoi effectué.", 500, cors);
  // Les PDF antérieurs sont conservés : un renvoi ne détruit jamais une version envoyée.

  await journaliser(sb, {
    devis_id: devisActuel.id, version: devisActuel.version ?? 1, etape: "preparation",
    envoi_cle: typeof corps?.envoi_cle === "string" ? corps.envoi_cle.slice(0, 80) : null,
    auteur: auth.uid,
  });

  return reponseJson({
    ok: true, token: tokenBrut, date_expiration_token: dateExpiration, version: devisActuel.version ?? 1,
  }, 200, cors);
}

// ============================================================
// ACTION 5 — SEND_EMAIL : l'envoi RÉEL, tracé, une seule fois par tentative
// ============================================================
// Expéditeur par défaut tant que le domaine HelixCar n'est pas vérifié
// chez Resend ; remplaçable par RESEND_FROM sans toucher au code.
const RESEND_FROM_TEMPORAIRE = "HelixCar <onboarding@resend.dev>";
const VERROU_ENVOI_MINUTES = 2;

export async function actionSendEmail(
  sb: any, req: Request, corps: any, cors: Record<string, string>,
  env: Record<string, string | undefined>, fetchFn: typeof fetch,
) {
  const auth = await adminAuthentifie(sb, req, cors);
  if ("refus" in auth) return auth.refus;

  const devisId = corps?.devis_id;
  const tokenBrut = corps?.token;
  const renvoi = corps?.renvoi === true;
  const envoiCle = typeof corps?.envoi_cle === "string" && corps.envoi_cle.length >= 8 ? corps.envoi_cle.slice(0, 80) : null;
  if (typeof devisId !== "string" || !devisId) return erreur("BAD_REQUEST", "devis_id est requis.", 400, cors);
  const { data: operationAReprendre, error: lectureOperation } = await sb.from("devis_envoi_operations")
    .select("*").eq("devis_id", devisId).in("etat", ["en_cours", "a_reconcilier"]).limit(1).maybeSingle();
  if (lectureOperation) return erreur("INTERNAL_ERROR", "Impossible de vérifier les envois précédents.", 500, cors);
  if (operationAReprendre) return await livrerOperation(sb, operationAReprendre, cors, env, fetchFn);
  if (typeof tokenBrut !== "string" || tokenBrut.length < 20) return erreur("BAD_REQUEST", "Token invalide.", 400, cors);
  if (!envoiCle) return erreur("BAD_REQUEST", "Clé de tentative (envoi_cle) requise.", 400, cors);

  // Relecture serveur exclusive — jamais de confiance dans un e-mail,
  // une référence, un prix, un statut ou un chemin PDF affirmés par le
  // navigateur.
  const { data: devisActuel, error: erreurLecture } = await sb
    .from("devis").select(CHAMPS_DEVIS).eq("id", devisId).maybeSingle();
  if (erreurLecture || !devisActuel) return erreur("NOT_FOUND", "Devis introuvable.", 404, cors);
  const version = devisActuel.version ?? 1;

  const { data: operationAcceptee, error: erreurOperationAcceptee } = await sb
    .from("devis_envoi_operations").select("*").eq("devis_id", devisId)
    .eq("envoi_cle", envoiCle).eq("etat", "acceptee").maybeSingle();
  if (erreurOperationAcceptee) return erreur("INTERNAL_ERROR", "Impossible de relire cet envoi.", 500, cors);
  if (operationAcceptee) return await livrerOperation(sb, operationAcceptee, cors, env, fetchFn);

  // IDEMPOTENCE : cette tentative a déjà abouti (double clic, réponse
  // perdue) → on répond le résultat déjà obtenu, sans second e-mail.
  const { data: dejaFaite } = await sb
    .from("devis_envois").select("id, created_at, fournisseur_id")
    .eq("devis_id", devisId).eq("envoi_cle", envoiCle).eq("etape", "acceptee_prestataire")
    .limit(1).maybeSingle();
  if (dejaFaite) {
    if (!devisActuel.date_envoi || devisActuel.version_envoyee == null || devisActuel.statut === "genere") {
      return erreur("ENVOI_A_RECONCILIER", "L'e-mail a été accepté par le prestataire ; son état doit être réconcilié avant tout renvoi.", 409, cors);
    }
    return reponseJson({
      ok: true, deja_envoye: true, statut: devisActuel.statut,
      date_envoi: devisActuel.date_envoi || dejaFaite.created_at, version_envoyee: devisActuel.version_envoyee,
    }, 200, cors);
  }

  const tokenHash = await hasherToken(tokenBrut);
  if (devisActuel.acceptation_token_hash !== tokenHash) {
    return erreur("TOKEN_MISMATCH", "Le lien préparé ne correspond plus à ce devis. Relancez l'envoi.", 409, cors);
  }
  if (!devisActuel.date_expiration_token || new Date(devisActuel.date_expiration_token) < new Date()) {
    return erreur("TOKEN_EXPIRED", "La préparation a expiré. Relancez l'envoi.", 409, cors);
  }
  if (!devisActuel.pdf_path) return erreur("PDF_NOT_READY", "Aucun PDF préparé pour ce devis.", 409, cors);
  if ((devisActuel.version_preparee ?? 1) !== version) {
    return erreur("VERSION_OBSOLETE", "Le prix a changé depuis la préparation : le devis doit être préparé à nouveau.", 409, cors);
  }

  // Premier envoi depuis « genere » ; RENVOI EXPLICITE depuis « envoye ».
  // Jamais depuis accepté / refusé, jamais un renvoi implicite.
  if (devisActuel.statut === "envoye" && !renvoi) {
    return erreur("INVALID_STATE", "Ce devis a déjà été envoyé. Utilisez « Renvoyer au client » pour un renvoi explicite.", 409, cors);
  }
  if ((devisActuel.statut !== "genere" && devisActuel.statut !== "envoye") || devisActuel.annule_le || devisActuel.expire_le) {
    return erreur("INVALID_STATE", "Ce devis n'est plus dans un état permettant un envoi.", 409, cors);
  }

  // VERROU SERVEUR : une seule tentative à la fois (deux onglets, double
  // clic avant réponse). Posé par un UPDATE conditionnel ; un verrou
  // plus vieux que quelques minutes est considéré abandonné.
  const maintenant = new Date();
  const limiteVerrou = new Date(maintenant.getTime() - VERROU_ENVOI_MINUTES * 60 * 1000).toISOString();
  const { data: verrou, error: erreurVerrou } = await sb
    .from("devis")
    .update({ envoi_en_cours_depuis: maintenant.toISOString() })
    .eq("id", devisId)
    .or(`envoi_en_cours_depuis.is.null,envoi_en_cours_depuis.lt.${limiteVerrou}`)
    .select("id")
    .maybeSingle();
  if (erreurVerrou) {
    console.error("verrou envoi :", erreurVerrou.message);
    return erreur("INTERNAL_ERROR", "Erreur serveur.", 500, cors);
  }
  if (!verrou) return erreur("ENVOI_EN_COURS", "Un envoi de ce devis est déjà en cours. Patientez quelques secondes.", 409, cors);
  const libererVerrou = async () => {
    try { await sb.from("devis").update({ envoi_en_cours_depuis: null }).eq("id", devisId); }
    catch (e) { console.error("libération du verrou :", e instanceof Error ? e.message : String(e)); }
  };

  const { data: client, error: erreurClient } = await sb
    .from("clients").select("email, prenom, nom").eq("id", devisActuel.client_id).maybeSingle();
  if (erreurClient || !client || !client.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(client.email))) {
    await libererVerrou();
    return erreur("NOT_FOUND", "Aucune adresse e-mail valide n'est enregistrée pour ce client.", 404, cors);
  }
  const destinataire = String(client.email).trim();

  // Le PDF EXACT stocké par PREPARE — jamais régénéré, jamais fourni par
  // le navigateur au moment de l'envoi.
  const { data: pdfBlob, error: erreurTelechargement } = await sb.storage.from("devis").download(devisActuel.pdf_path);
  if (erreurTelechargement || !pdfBlob) {
    await libererVerrou();
    console.error("Erreur téléchargement PDF : téléchargement échoué.");
    return erreur("PDF_UNAVAILABLE", "Impossible de récupérer le PDF du devis.", 500, cors);
  }
  const octetsPdf = new Uint8Array(await pdfBlob.arrayBuffer());
  const enteteAttendue = [0x25, 0x50, 0x44, 0x46, 0x2d];
  if (!octetsPdf.length || !enteteAttendue.every((o, i) => octetsPdf[i] === o)) {
    await libererVerrou();
    return erreur("PDF_UNAVAILABLE", "Le PDF préparé est illisible. Relancez la préparation.", 500, cors);
  }
  const pdfBase64Standard = base64EncodeStandard(octetsPdf);
  const nomPieceJointe = `Devis_HelixCar_${devisActuel.reference}.pdf`;

  const resendApiKey = env.RESEND_API_KEY;
  if (!resendApiKey) {
    await libererVerrou();
    console.error("Config manquante : RESEND_API_KEY absente.");
    return erreur("SERVER_MISCONFIGURED", "L'envoi d'e-mail n'est pas configuré sur le serveur.", 500, cors);
  }

  // LIEN SÉCURISÉ — construit ici, à partir de l'URL publique canonique.
  const base = urlPubliqueSite(env, req.headers.get("origin"));
  const urlClient = `${base}/devis.html?token=${encodeURIComponent(tokenBrut)}`;
  const nomClient = [client.prenom, client.nom].filter(Boolean).join(" ") || "client HelixCar";
  const sujet = `Votre devis HelixCar — ${devisActuel.reference}`;
  const nomClientHtml = echapperHtmlServeur(nomClient);
  const referenceHtml = echapperHtmlServeur(devisActuel.reference);
  const introduction = renvoi
    ? `Voici de nouveau votre devis HelixCar <strong>${referenceHtml}</strong>.`
    : `Votre devis HelixCar <strong>${referenceHtml}</strong> est disponible.`;

  const htmlEmail = `<!DOCTYPE html><html><body style="font-family:-apple-system,Helvetica,Arial,sans-serif;background:#F7F3EC;padding:24px;margin:0">
<div style="max-width:520px;margin:0 auto;background:#FFFFFF;border-radius:3px;overflow:hidden">
  <div style="background:#14181D;padding:20px 24px"><span style="color:#FFFFFF;font-size:1.3rem;font-weight:800">HELI<span style="color:#E5484D">X</span>CAR</span></div>
  <div style="padding:28px 24px">
    <p>Bonjour ${nomClientHtml},</p>
    <p>${introduction}</p>
    <p>Vous trouverez également votre devis au format PDF en pièce jointe.</p>
    <div style="text-align:center;margin:28px 0">
      <a href="${urlClient}" style="background:#14181D;color:#FFFFFF;text-decoration:none;padding:14px 26px;border-radius:2px;display:inline-block;font-weight:600">Consulter et accepter mon devis</a>
    </div>
    <p style="font-size:0.88rem;color:#454C55">Ce lien sécurisé vous permet de consulter votre devis et de l'accepter ou de le refuser en ligne.</p>
    <p>Cordialement,<br>L'équipe HelixCar</p>
  </div>
</div>
</body></html>`;
  const texteEmail =
    `Bonjour ${nomClient},\n\n` +
    (renvoi ? `Voici de nouveau votre devis HelixCar ${devisActuel.reference}.\n\n`
            : `Votre devis HelixCar ${devisActuel.reference} est disponible.\n\n`) +
    `Vous trouverez également votre devis au format PDF en pièce jointe.\n\n` +
    `Pour consulter et accepter votre devis : ${urlClient}\n\n` +
    `Ce lien sécurisé vous permet de consulter votre devis et de l'accepter ou de le refuser en ligne.\n\n` +
    `Cordialement,\nL'équipe HelixCar`;

  const payload = {
    from: env.RESEND_FROM || RESEND_FROM_TEMPORAIRE, to: [destinataire], subject: sujet,
    html: htmlEmail, text: texteEmail,
    attachments: [{ filename: nomPieceJointe, content: pdfBase64Standard }],
  };
  const { data: operation, error: creationError } = await sb.from("devis_envoi_operations").insert({
    id: crypto.randomUUID(), devis_id: devisId, version, envoi_cle: envoiCle,
    token_hash: tokenHash, payload, destinataire, auteur: auth.uid, renvoi, etat: "en_cours",
  }).select("*").single();
  if (creationError || !operation) {
    await libererVerrou();
    return erreur("ENVOI_EN_COURS", "Cet envoi doit être relu avant une nouvelle tentative.", 409, cors);
  }
  return await livrerOperation(sb, operation, cors, env, fetchFn);
}

// Rejoue le MÊME payload avec la MÊME clé fournisseur, même après refresh.
// Resend ne conserve sa déduplication que 24 h : au-delà, aucun renvoi
// aveugle. L'opération reste à réconcilier avec le prestataire.
async function livrerOperation(sb: any, op: any, cors: Record<string,string>, env: Record<string,string|undefined>, fetchFn: typeof fetch) {
  const ligne = { devis_id: op.devis_id, version: op.version, destinataire: op.destinataire,
    renvoi: op.renvoi, envoi_cle: op.envoi_cle, fournisseur: "resend", auteur: op.auteur };
  const liberer = async () => { await sb.from("devis").update({envoi_en_cours_depuis:null}).eq("id",op.devis_id); };
  if (!env.RESEND_API_KEY) { await liberer(); return erreur("SERVER_MISCONFIGURED", "L'envoi d'e-mail n'est pas configuré sur le serveur.", 500, cors); }
  if (env.HELIXCAR_ENV === "recette") {
    const autorises = (env.HELIXCAR_DESTINATAIRES_RECETTE || "").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);
    if (!autorises.includes(String(op.destinataire).toLowerCase())) {
      await liberer(); return erreur("DESTINATAIRE_NON_AUTORISE", "Cette adresse n'est pas autorisée pour la recette.", 403, cors);
    }
  }
  let fournisseurId = op.fournisseur_id;
  let dateAcceptee = op.acceptee_le;
  if (!fournisseurId) {
    const {data:source,error:lectureSource}=await sb.from('devis').select('statut,annule_le,expire_le,version').eq('id',op.devis_id).maybeSingle();
    if(lectureSource || !source){await liberer();return erreur('INTERNAL_ERROR','Le dossier ne peut pas être relu.',500,cors);}
    if(source.annule_le || source.expire_le || !['genere','envoye'].includes(source.statut) || source.version!==op.version){
      await liberer();return erreur('ENVOI_A_RECONCILIER','Le dossier a changé. Vérifiez le résultat auprès du prestataire avant toute reprise.',409,cors);
    }
    if (Date.now() - Date.parse(op.created_at) >= 23 * 60 * 60 * 1000) {
      await liberer(); return erreur("ENVOI_A_RECONCILIER", "Le résultat de cet envoi doit être vérifié auprès du prestataire avant toute nouvelle tentative.", 409, cors);
    }
    if (!await journaliser(sb, {...ligne, etape:"tentative"})) {
      await liberer(); return erreur("JOURNAL_UNAVAILABLE", "L'envoi ne peut pas être enregistré. Aucun nouvel appel au prestataire.", 503, cors);
    }
    let reponse: Response;
    try {
      reponse = await fetchFn("https://api.resend.com/emails", {
        method:"POST", signal:AbortSignal.timeout(15000),
        headers:{Authorization:"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json","Idempotency-Key":"helixcar-devis/"+op.id},
        body:JSON.stringify(op.payload),
      });
    } catch {
      await sb.from("devis_envoi_operations").update({etat:"a_reconcilier"}).eq("id",op.id);
      await journaliser(sb,{...ligne,etape:"echec",detail:"reseau_resultat_inconnu"});
      await liberer();
      return erreur("ENVOI_A_REPRENDRE", "La confirmation d'envoi n'est pas arrivée. Reprenez cet envoi : aucune nouvelle préparation n'est nécessaire.",502,cors);
    }
    let contenu:any=null;try {contenu=await reponse.json();} catch {}
    fournisseurId=contenu && typeof contenu.id==="string" && contenu.id.trim() ? contenu.id : null;
    if (!reponse.ok || !fournisseurId) {
      const incertain = reponse.status >= 500 || reponse.ok || reponse.status === 409;
      await sb.from("devis_envoi_operations").update({etat:incertain?"a_reconcilier":"echec"}).eq("id",op.id);
      await journaliser(sb,{...ligne,etape:"echec",detail:reponse.ok?"reponse_prestataire_invalide":"http_"+reponse.status});
      await liberer();
      return erreur(incertain?"ENVOI_A_REPRENDRE":"EMAIL_SEND_FAILED",incertain
        ? "Le résultat de l'envoi n'est pas confirmé. Reprenez la tentative existante."
        : "Le prestataire a refusé l'envoi. Le devis reste enregistré.",502,cors);
    }
    dateAcceptee=new Date().toISOString();
    const { error: suiviError }=await sb.from("devis_envoi_operations").update({etat:"acceptee",fournisseur_id:fournisseurId,acceptee_le:dateAcceptee}).eq("id",op.id);
    if(suiviError) {await liberer();return erreur("EMAIL_SENT_DB_UPDATE_FAILED","Le prestataire a accepté l'e-mail mais sa confirmation doit être réconciliée.",500,cors);}
  }
  if(!await journaliser(sb,{...ligne,etape:"acceptee_prestataire",fournisseur_id:fournisseurId})) {
    await liberer();return erreur("EMAIL_SENT_DB_UPDATE_FAILED","Le prestataire a accepté l'e-mail mais le journal doit être réconcilié.",500,cors);
  }
  const {data: archive,error: archiveError}=await sb.from("devis_preparations").update({envoyee_le:dateAcceptee}).eq("devis_id",op.devis_id).eq("token_hash",op.token_hash).select("id").maybeSingle();
  if (archiveError || !archive) {
    await liberer();return erreur("EMAIL_SENT_DB_UPDATE_FAILED","L'envoi a été accepté mais son archive doit être réconciliée.",500,cors);
  }
  const {data: actuel,error:lectureActuel}=await sb.from("devis").select("id,version,statut,date_envoi,version_envoyee,annule_le,expire_le").eq("id",op.devis_id).maybeSingle();
  if (lectureActuel || !actuel) {await liberer();return erreur("INTERNAL_ERROR","Le dossier ne peut pas être relu.",500,cors);}
  if(actuel.annule_le || actuel.expire_le){await liberer();return erreur('OPERATION_DEJA_TRAITEE','Le prestataire a accepté cet envoi. Le devis est désormais annulé ou expiré ; son état est conservé.',409,cors);}
  if (actuel.version !== op.version) {
    await liberer();return erreur("OPERATION_DEJA_TRAITEE","Cet envoi concerne une version antérieure. Rechargez le devis courant.",409,cors);
  }
  if (!["genere","envoye"].includes(actuel.statut) && actuel.version_envoyee === op.version && actuel.date_envoi) {
    await liberer();return reponseJson({ok:true,deja_envoye:true,statut:actuel.statut,date_envoi:actuel.date_envoi,version_envoyee:actuel.version_envoyee,destinataire:op.destinataire},200,cors);
  }
  const {data: updated,error:updateError}=await sb.from("devis")
    .update({statut:"envoye",date_envoi:dateAcceptee,version_envoyee:op.version,envoi_en_cours_depuis:null})
    .eq("id",op.devis_id).eq("version",op.version).eq("acceptation_token_hash",op.token_hash)
    .in("statut",["genere","envoye"]).select("id,statut,date_envoi,version_envoyee").maybeSingle();
  if(archiveError || updateError || !updated) {
    await journaliser(sb,{...ligne,etape:"echec",fournisseur_id:fournisseurId,detail:"maj_statut_echouee_apres_envoi"});
    await liberer();return erreur("EMAIL_SENT_DB_UPDATE_FAILED","L'e-mail a été accepté par le prestataire. L'état du dossier doit être relu avant tout renvoi.",500,cors);
  }
  return reponseJson({ok:true,deja_envoye:!!(op.fournisseur_id && actuel.date_envoi && actuel.version_envoyee === op.version),statut:updated.statut,date_envoi:updated.date_envoi,version_envoyee:updated.version_envoyee,renvoi:op.renvoi,destinataire:op.destinataire,fournisseur_id:fournisseurId},200,cors);
}

export async function actionReprendreEnvoi(sb:any,req:Request,corps:any,cors:Record<string,string>,env:Record<string,string|undefined>,fetchFn:typeof fetch) {
  const auth=await adminAuthentifie(sb,req,cors);if("refus" in auth)return auth.refus;
  if(typeof corps?.devis_id!=="string")return erreur("BAD_REQUEST","Identifiant de devis requis.",400,cors);
  const {data:op,error}=await sb.from("devis_envoi_operations").select("*").eq("devis_id",corps.devis_id)
    .in("etat",["en_cours","a_reconcilier","acceptee"]).order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(error || !op)return erreur("NOT_FOUND","Aucun envoi à reprendre.",404,cors);
  return await livrerOperation(sb,op,cors,env,fetchFn);
}

// ============================================================
// ACTIONS 2-4 — identité Auth vérifiée ET propriété du dossier.
// Le lien identifie le devis ; il ne confère jamais le rôle de son client.
// ============================================================
async function devisDuClient(sb: any, corps: any, cors: Record<string, string>, req?: Request) {
  const jwt = (req?.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return { refus: erreur("UNAUTHORIZED", "Connectez-vous à votre espace client pour consulter ce devis.", 401, cors) };
  const { data, error: authError } = await sb.auth.getUser(jwt);
  if (authError || !data?.user?.id) return { refus: erreur("UNAUTHORIZED", "Votre session a expiré. Reconnectez-vous.", 401, cors) };
  const tokenBrut = corps?.token;
  const devisId = corps?.devis_id;
  const invalide = () => ({ refus: erreur("INVALID_OR_EXPIRED_LINK", "Devis inaccessible ou lien expiré.", 404, cors) });
  let query = sb.from("devis").select("*");
  let archive:any = null;
  if (typeof tokenBrut === "string" && tokenBrut.length >= 20 && tokenBrut.length <= 256) {
    const hash = await hasherToken(tokenBrut);
    const {data:preparation,error:archiveError} = await sb.from("devis_preparations").select("*").eq("token_hash",hash).maybeSingle();
    if(archiveError) return invalide();
    archive=preparation;
    if(archive && !archive.envoyee_le) return invalide();
    query = archive ? query.eq("id",archive.devis_id) : query.eq("acceptation_token_hash", hash);
  } else if (typeof devisId === "string" && /^[0-9a-f-]{36}$/i.test(devisId)) {
    query = query.eq("id", devisId);
  } else return invalide();
  const { data: devisCourant, error } = await query.maybeSingle();
  let devis = devisCourant;
  if (error || !devis) return invalide();
  const { data: dossier, error: dossierError } = await sb.from("clients").select("id")
    .eq("id", devis.client_id).eq("auth_user_id", data.user.id).maybeSingle();
  if (dossierError || !dossier) return invalide();
  if (!archive && typeof devisId === "string") {
    const {data:derniere,error:e}=await sb.from("devis_preparations").select("*").eq("devis_id",devis.id)
      .gt("envoyee_le","1970-01-01T00:00:00Z").order("created_at",{ascending:false}).limit(1).maybeSingle();
    if(e) return invalide();archive=derniere;
  }
  if(archive) devis={...devis, snapshot_devis:archive.snapshot_devis,pdf_path:archive.pdf_path,
    version_envoyee:archive.version,date_envoi:archive.envoyee_le,date_expiration_token:archive.date_expiration};

  if (!devis.date_expiration_token || !Number.isFinite(Date.parse(devis.date_expiration_token)) ||
      Date.parse(devis.date_expiration_token) <= Date.now()) return invalide();
  if (devis.annule_le || devis.expire_le || ["annule", "expire"].includes(devis.statut)) {
    return { refus: erreur("ACTION_IMPOSSIBLE", "Ce devis est annulé ou expiré.", 409, cors) };
  }
  return { devis, uid: data.user.id as string };
}

export async function actionGet(sb: any, corps: any, cors: Record<string, string>, req?: Request) {
  const autorisation = await devisDuClient(sb, corps, cors, req);
  if ("refus" in autorisation) return autorisation.refus;
  const { devis } = autorisation;
  // Un lien préparé mais jamais envoyé n'existe pas pour le client.
  if (devis.statut === "genere" && !devis.version_envoyee) {
    return erreur("INVALID_OR_EXPIRED_LINK", "Lien invalide ou expiré.", 404, cors);
  }
  const version = devis.version ?? 1;
  const versionObsolete = devis.version_envoyee != null && devis.version_envoyee !== version;

  // PREMIÈRE CONSULTATION : état distinct d'« envoyé », posé une fois.
  if (!devis.consulte_le && !versionObsolete) {
    try { await sb.from("devis").update({ consulte_le: new Date().toISOString() }).eq("id", devis.id).is("consulte_le", null); }
    catch (e) { console.error("consulte_le :", e instanceof Error ? e.message : String(e)); }
  }

  let pdfUrl: string | null = null;
  if (devis.pdf_path) {
    const { data: urlSignee } = await sb.storage.from("devis").createSignedUrl(devis.pdf_path, 10 * 60);
    pdfUrl = urlSignee?.signedUrl ?? null;
  }
  // Le prix affiché est celui de la VERSION ENVOYÉE (snapshot), jamais
  // un prix modifié depuis dans le Dashboard.
  const prixEnvoye = devis.snapshot_devis && devis.snapshot_devis.prix != null ? devis.snapshot_devis.prix : devis.prix;
  return reponseJson({
    ok: true,
    devis: {
      reference: devis.reference, prix: prixEnvoye, statut: devis.statut,
      snapshot: devis.snapshot_devis, date_envoi: devis.date_envoi,
      date_acceptation: devis.date_acceptation, date_refus: devis.date_refus,
      pdf_disponible: !!pdfUrl, pdf_url: pdfUrl,
      version: version, version_envoyee: devis.version_envoyee, version_acceptee: devis.version_acceptee,
      version_obsolete: versionObsolete, paiement_statut: devis.paiement_statut || "aucun",
    },
  }, 200, cors);
}

export async function actionAccept(sb: any, corps: any, cors: Record<string, string>, req?: Request) {
  return await traiterReponseDevis(sb, corps, "accepte", cors, req);
}
export async function actionRefuse(sb: any, corps: any, cors: Record<string, string>, req?: Request) {
  return await traiterReponseDevis(sb, corps, "refuse", cors, req);
}

async function traiterReponseDevis(sb: any, corps: any, cibleStatut: "accepte" | "refuse", cors: Record<string, string>, req?: Request) {
  const autorisation = await devisDuClient(sb, corps, cors, req);
  if ("refus" in autorisation) return autorisation.refus;
  const { devis: etat, uid } = autorisation;
  const maintenant = new Date().toISOString();
  const version = etat.version ?? 1;
  if (etat.version_envoyee != null && etat.version_envoyee !== version) {
    return erreur("VERSION_OBSOLETE", "Ce devis a été mis à jour depuis son envoi. Un nouveau devis vous sera envoyé : cette version ne peut plus être acceptée ni refusée.", 409, cors);
  }

  // L'acceptation enregistre l'identité Auth propriétaire du dossier,
  // la date, la version acceptée, et ouvre l'état « paiement en
  // attente » — SANS créer ni mission ni paiement (décision C02).
  const champsEcriture: Record<string, unknown> = cibleStatut === "accepte"
    ? { statut: "accepte", date_acceptation: maintenant, date_refus: null, accepte_par: uid, version_acceptee: version, paiement_statut: "en_attente" }
    : { statut: "refuse", date_refus: maintenant, refuse_par: uid, motif_refus: nettoyerMotifRefus(corps?.motif), paiement_statut: "aucun" };

  const { data: ligneModifiee, error: erreurEcriture } = await sb
    .from("devis").update(champsEcriture)
    .eq("id", etat.id).eq("statut", "envoye").eq("version", version)
    .is("annule_le", null).is("expire_le", null)
    .gt("date_expiration_token", maintenant)
    .select("id, statut, version_acceptee, paiement_statut").maybeSingle();
  if (erreurEcriture) return erreur("INTERNAL_ERROR", "Erreur serveur.", 500, cors);
  if (ligneModifiee) {
    return reponseJson({ ok: true, status: ligneModifiee.statut, already_accepted: false, already_refused: false,
      version_acceptee: ligneModifiee.version_acceptee ?? null, paiement_statut: ligneModifiee.paiement_statut }, 200, cors);
  }
  if (etat.statut === cibleStatut) {
    return reponseJson({ ok: true, status: etat.statut, already_accepted: cibleStatut === "accepte", already_refused: cibleStatut === "refuse" }, 200, cors);
  }
  return erreur("ACTION_IMPOSSIBLE", "Ce devis ne peut plus recevoir cette réponse.", 409, cors);
}

// ============================================================
// Routage — exporté pour être testable hors Deno
// ============================================================
export async function traiterRequete(
  sb: any, req: Request,
  env: Record<string, string | undefined> = {},
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  const origine = req.headers.get("origin");
  const { entetes: cors, autorisee } = enTetesCors(origine);

  if (req.method === "OPTIONS") {
    if (!autorisee) return new Response(null, { status: 403, headers: cors });
    if (!preflightAcceptable(req.headers.get("access-control-request-headers"))) {
      return new Response(null, { status: 403, headers: cors });
    }
    return new Response(null, { status: 204, headers: cors });
  }
  if (!autorisee) return erreur("ORIGIN_NOT_ALLOWED", "Origine non autorisée.", 403, cors);
  if (req.method !== "POST") return erreur("METHOD_NOT_ALLOWED", "Seul POST est accepté.", 405, cors);

  let corps: any;
  try { corps = await req.json(); } catch { return erreur("BAD_REQUEST", "Corps JSON invalide.", 400, cors); }

  const action = corps?.action;
  if (!["prepare", "get", "accept", "refuse", "send_email", "resume_send"].includes(action)) {
    return erreur("BAD_REQUEST", "Action inconnue.", 400, cors);
  }
  try {
    if (action === "resume_send") return await actionReprendreEnvoi(sb, req, corps, cors, env, fetchFn);
    if (action === "prepare") return await actionPrepare(sb, req, corps, cors);
    if (action === "get") return await actionGet(sb, corps, cors, req);
    if (action === "accept") return await actionAccept(sb, corps, cors, req);
    if (action === "send_email") return await actionSendEmail(sb, req, corps, cors, env, fetchFn);
    return await actionRefuse(sb, corps, cors, req);
  } catch (e) {
    console.error(`Erreur action=${action}:`, e instanceof Error ? e.message : String(e));
    return erreur("INTERNAL_ERROR", "Erreur serveur.", 500, cors);
  }
}

// Démarrage réel — uniquement sous Deno.
if (typeof Deno !== "undefined" && typeof (Deno as any).serve === "function") {
  (Deno as any).serve(async (req: Request) => {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const { entetes } = enTetesCors(req.headers.get("origin"));
    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Config manquante : SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absente.");
      return erreur("SERVER_MISCONFIGURED", "Erreur serveur.", 500, entetes);
    }
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const env = {
      RESEND_API_KEY: Deno.env.get("RESEND_API_KEY"),
      RESEND_FROM: Deno.env.get("RESEND_FROM"),
      HELIXCAR_ENV: Deno.env.get("HELIXCAR_ENV"),
      HELIXCAR_DESTINATAIRES_RECETTE: Deno.env.get("HELIXCAR_DESTINATAIRES_RECETTE"),
      HELIXCAR_URL_PUBLIQUE: Deno.env.get("HELIXCAR_URL_PUBLIQUE"),
    };
    return await traiterRequete(sb, req, env, fetch);
  });
}
