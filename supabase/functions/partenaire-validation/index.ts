// deno-lint-ignore-file no-explicit-any
// Validation d'une candidature partenaire + envoi automatique du lien
// de création de mot de passe. La décision et le destinataire sont
// toujours relus côté serveur ; aucun secret d'e-mail ne quitte Supabase.

export const ORIGINES_AUTORISEES = [
  "https://helixcar.vercel.app",
  "https://helixcar-i89b.vercel.app",
  "https://helixcar-git-codex-helixcar-f-0253b9-kibaly500-commits-projects.vercel.app",
  "https://helixcar-i89b-git-codex-helix-b25bf8-kibaly500-commits-projects.vercel.app",
];

function originesSupplementaires(valeur: string | null | undefined): string[] {
  return String(valeur || "").split(",").map((o) => o.trim())
    .filter((o) => /^https:\/\/[a-z0-9.-]+$/i.test(o));
}

function cors(origine: string | null, env: Record<string, string | undefined>) {
  const autorisees = ORIGINES_AUTORISEES.concat(originesSupplementaires(env.HELIXCAR_ORIGINES_SUPPLEMENTAIRES));
  const autorisee = !!origine && autorisees.includes(origine);
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
    "Vary": "Origin",
  };
  if (autorisee) headers["Access-Control-Allow-Origin"] = origine!;
  return { autorisee, headers };
}

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function erreur(code: string, message: string, status: number, headers: Record<string, string>, detail: Record<string, unknown> = {}) {
  return json({ ok: false, code, message, ...detail }, status, headers);
}

function echapperHtml(valeur: unknown): string {
  return String(valeur ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function urlPublique(env: Record<string, string | undefined>, origine: string | null): string {
  const configuree = String(env.HELIXCAR_URL_PUBLIQUE || "").trim().replace(/\/+$/, "");
  if (/^https:\/\/[a-z0-9.-]+$/i.test(configuree)) return configuree;
  if (origine && ORIGINES_AUTORISEES.concat(originesSupplementaires(env.HELIXCAR_ORIGINES_SUPPLEMENTAIRES)).includes(origine)) return origine;
  return "https://helixcar.vercel.app";
}

async function preuveLien(secret: string, id: string, email: string): Promise<string> {
  const encodeur = new TextEncoder();
  const cle = await crypto.subtle.importKey(
    "raw", encodeur.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC", cle, encodeur.encode(`${id}:${email.trim().toLowerCase()}`),
  );
  return Array.from(new Uint8Array(signature)).map((octet) => octet.toString(16).padStart(2, "0")).join("");
}

function identiquesTempsConstant(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

async function adminAuthentifie(sb: any, req: Request, headers: Record<string, string>) {
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return { refus: erreur("UNAUTHORIZED", "Authentification requise.", 401, headers) };
  const { data: utilisateur, error: erreurUtilisateur } = await sb.auth.getUser(jwt);
  if (erreurUtilisateur || !utilisateur?.user?.id) {
    return { refus: erreur("UNAUTHORIZED", "Session invalide ou expirée.", 401, headers) };
  }
  const { data: admin, error: erreurAdmin } = await sb.from("admins").select("id")
    .eq("auth_user_id", utilisateur.user.id).eq("actif", true).maybeSingle();
  if (erreurAdmin) return { refus: erreur("INTERNAL_ERROR", "Erreur serveur.", 500, headers) };
  if (!admin) return { refus: erreur("FORBIDDEN", "Droits administrateur requis.", 403, headers) };
  return { uid: utilisateur.user.id as string };
}

export async function traiterRequete(
  sb: any,
  req: Request,
  env: Record<string, string | undefined> = {},
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  const origine = req.headers.get("origin");
  const c = cors(origine, env);
  if (req.method === "OPTIONS") return new Response(null, { status: c.autorisee ? 204 : 403, headers: c.headers });
  if (!c.autorisee) return erreur("ORIGIN_NOT_ALLOWED", "Origine non autorisée.", 403, c.headers);
  if (req.method !== "POST") return erreur("METHOD_NOT_ALLOWED", "Seul POST est accepté.", 405, c.headers);

  let body: any;
  try { body = await req.json(); } catch { return erreur("BAD_REQUEST", "Demande invalide.", 400, c.headers); }

  // Le lien reçu par e-mail contient une preuve HMAC : la page peut ainsi
  // vérifier UNE candidature précise sans ouvrir la table des convoyeurs aux
  // visiteurs anonymes et sans transformer l'API en annuaire d'adresses.
  if (body?.action === "verifier_lien") {
    const id = typeof body?.convoyeur_id === "string" ? body.convoyeur_id : "";
    const email = typeof body?.email === "string" ? body.email.trim() : "";
    const preuve = typeof body?.preuve === "string" ? body.preuve.toLowerCase() : "";
    const secret = String(env.PARTENAIRE_LIEN_SECRET || "");
    if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      || !/^[0-9a-f]{64}$/.test(preuve) || !secret) {
      return erreur("LIEN_INVALIDE", "Ce lien de création de compte n'est pas valide.", 400, c.headers);
    }
    const attendue = await preuveLien(secret, id, email);
    if (!identiquesTempsConstant(preuve, attendue)) {
      return erreur("LIEN_INVALIDE", "Ce lien de création de compte n'est pas valide.", 403, c.headers);
    }
    const { data: partenaire, error: erreurLecture } = await sb.from("convoyeurs")
      .select("id,email,statut,auth_user_id").eq("id", id).maybeSingle();
    if (erreurLecture || !partenaire || String(partenaire.email || "").trim().toLowerCase() !== email.toLowerCase()) {
      return erreur("LIEN_INVALIDE", "Ce lien de création de compte n'est pas valide.", 404, c.headers);
    }
    return json({
      ok: true,
      convoyeur_id: partenaire.id,
      statut: partenaire.statut,
      compte_deja_cree: !!partenaire.auth_user_id,
    }, 200, c.headers);
  }

  if (!["valider", "renvoyer"].includes(body?.action)) return erreur("BAD_REQUEST", "Action inconnue.", 400, c.headers);
  const auth = await adminAuthentifie(sb, req, c.headers);
  if ("refus" in auth) return auth.refus;
  if (typeof body?.convoyeur_id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.convoyeur_id)) {
    return erreur("BAD_REQUEST", "Identifiant partenaire invalide.", 400, c.headers);
  }

  const { data: partenaire, error: erreurLecture } = await sb.from("convoyeurs")
    .select("id,prenom,nom,email,statut,auth_user_id,civilite").eq("id", body.convoyeur_id).maybeSingle();
  if (erreurLecture || !partenaire) return erreur("NOT_FOUND", "Candidature introuvable.", 404, c.headers);

  if (body.action === "valider") {
    if (!["en_attente", "actif"].includes(partenaire.statut)) {
      return erreur("INVALID_STATE", "Cette candidature n'est pas prête à être validée.", 409, c.headers);
    }
    if (partenaire.statut !== "actif") {
      const { data: ligne, error: erreurMaj } = await sb.from("convoyeurs").update({ statut: "actif" })
        .eq("id", partenaire.id).eq("statut", "en_attente").select("id").maybeSingle();
      if (erreurMaj || !ligne) return erreur("UPDATE_FAILED", "La validation n'a pas pu être enregistrée.", 409, c.headers);
      partenaire.statut = "actif";
    }
  } else if (partenaire.statut !== "actif") {
    return erreur("INVALID_STATE", "Le partenaire doit être validé avant l'envoi du lien.", 409, c.headers);
  }

  if (partenaire.auth_user_id) {
    return json({ ok: true, code: "COMPTE_DEJA_CREE", email_accepte: false, compte_deja_cree: true }, 200, c.headers);
  }
  const destinataire = String(partenaire.email || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destinataire)) {
    return erreur("EMAIL_INVALID", "La candidature est validée mais son adresse e-mail est invalide.", 409, c.headers, { validation_enregistree: true });
  }
  if (!env.RESEND_API_KEY) {
    return erreur("SERVER_MISCONFIGURED", "La candidature est validée mais l'envoi d'e-mail n'est pas configuré.", 500, c.headers, { validation_enregistree: true });
  }
  if (env.HELIXCAR_ENV === "recette") {
    const autorisees = String(env.HELIXCAR_DESTINATAIRES_RECETTE || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (!autorisees.includes(destinataire.toLowerCase())) {
      return erreur("DESTINATAIRE_NON_AUTORISE", "Cette adresse n'est pas autorisée pour la recette.", 403, c.headers, { validation_enregistree: true });
    }
  }

  const nom = [partenaire.prenom, partenaire.nom].filter(Boolean).join(" ") || "partenaire HelixCar";
  const secretLien = String(env.PARTENAIRE_LIEN_SECRET || "");
  if (!secretLien) {
    return erreur("SERVER_MISCONFIGURED", "La création du lien partenaire n'est pas configurée.", 500, c.headers, { validation_enregistree: true });
  }
  const preuve = await preuveLien(secretLien, partenaire.id, destinataire);
  const lien = `${urlPublique(env, origine)}/creer-compte-convoyeur.html?email=${encodeURIComponent(destinataire)}&dossier=${encodeURIComponent(partenaire.id)}&preuve=${preuve}`;
  const nomHtml = echapperHtml(nom);
  const lienHtml = echapperHtml(lien);
  const sujet = "Compte partenaire HelixCar validé";
  const texte = `Bonjour ${nom},\n\nVotre compte partenaire HelixCar est validé ! Bienvenue dans le réseau HelixCar.\n\nDernière étape : créez votre mot de passe pour accéder à votre espace partenaire et voir les missions disponibles :\n${lien}\n\nCordialement,\nL'équipe HelixCar`;
  const html = `<!DOCTYPE html><html><body style="font-family:-apple-system,Helvetica,Arial,sans-serif;background:#F7F3EC;padding:24px;margin:0"><div style="max-width:520px;margin:0 auto;background:#fff"><div style="background:#14181D;padding:20px 24px;color:#fff;font-size:20px;font-weight:800">HELI<span style="color:#E5484D">X</span>CAR</div><div style="padding:28px 24px"><p>Bonjour ${nomHtml},</p><p>Votre compte partenaire HelixCar est validé ! Bienvenue dans le réseau HelixCar.</p><p>Dernière étape : créez votre mot de passe pour accéder à votre espace partenaire.</p><p style="text-align:center;margin:28px 0"><a href="${lienHtml}" style="background:#14181D;color:#fff;text-decoration:none;padding:14px 24px;display:inline-block">Créer mon mot de passe</a></p><p>Cordialement,<br>L'équipe HelixCar</p></div></div></body></html>`;

  const cleRenvoi = body.action === "renvoyer" && typeof body.envoi_cle === "string"
    ? body.envoi_cle.replace(/[^a-z0-9_-]/gi, "").slice(0, 64) : "initial";
  let reponse: Response;
  try {
    reponse = await fetchFn("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: {
        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `helixcar-partenaire/${partenaire.id}/${cleRenvoi || "renvoi"}`,
      },
      body: JSON.stringify({
        from: env.RESEND_FROM || "HelixCar <onboarding@resend.dev>",
        to: [destinataire],
        reply_to: env.RESEND_REPLY_TO || "contact@helixcar.fr",
        subject: sujet,
        text: texte,
        html,
      }),
    });
  } catch {
    return erreur("EMAIL_RESULT_UNKNOWN", "La candidature est validée, mais la confirmation de l'envoi n'est pas arrivée.", 502, c.headers, { validation_enregistree: true });
  }
  let resultat: any = null;
  try { resultat = await reponse.json(); } catch { /* réponse illisible */ }
  if (!reponse.ok || !resultat?.id) {
    return erreur("EMAIL_SEND_FAILED", "La candidature est validée, mais le service de messagerie a refusé l'envoi.", 502, c.headers, { validation_enregistree: true });
  }
  return json({ ok: true, code: "EMAIL_ACCEPTE", email_accepte: true }, 200, c.headers);
}

if (typeof Deno !== "undefined" && typeof (Deno as any).serve === "function") {
  (Deno as any).serve(async (req: Request) => {
    const url = Deno.env.get("SUPABASE_URL");
    const cle = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !cle) return json({ ok: false, code: "SERVER_MISCONFIGURED", message: "Erreur serveur." }, 500, {});
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    const sb = createClient(url, cle, { auth: { persistSession: false } });
    return traiterRequete(sb, req, {
      RESEND_API_KEY: Deno.env.get("RESEND_API_KEY"),
      RESEND_FROM: Deno.env.get("RESEND_FROM"),
      RESEND_REPLY_TO: Deno.env.get("RESEND_REPLY_TO"),
      HELIXCAR_URL_PUBLIQUE: Deno.env.get("HELIXCAR_URL_PUBLIQUE"),
      HELIXCAR_ORIGINES_SUPPLEMENTAIRES: Deno.env.get("HELIXCAR_ORIGINES_SUPPLEMENTAIRES"),
      HELIXCAR_ENV: Deno.env.get("HELIXCAR_ENV"),
      HELIXCAR_DESTINATAIRES_RECETTE: Deno.env.get("HELIXCAR_DESTINATAIRES_RECETTE"),
      PARTENAIRE_LIEN_SECRET: Deno.env.get("PARTENAIRE_LIEN_SECRET") || cle,
    }, fetch);
  });
}
