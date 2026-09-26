// deno-lint-ignore-file no-explicit-any
// Simulation de paiement réservée aux Previews et aux dossiers QA.
// Aucun appel à un prestataire et aucun débit réel ne sont effectués.

const ORIGINES_RECETTE = new Set([
  "https://helixcar-i89b.vercel.app",
  "https://helixcar-git-codex-helixcar-f-0253b9-kibaly500-commits-projects.vercel.app",
  "https://helixcar-i89b-git-codex-helix-b25bf8-kibaly500-commits-projects.vercel.app",
]);
const PREFIXE_QA = "TEST-QA-CLAUDE-HELIXCAR";
const DOSSIERS_QA = [PREFIXE_QA, "TEST-QA-DALBUG"];

function cors(origin: string | null) {
  const allowed = !!origin && ORIGINES_RECETTE.has(origin);
  const headers: Record<string,string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
    "Vary": "Origin",
  };
  if (allowed) headers["Access-Control-Allow-Origin"] = origin!;
  return { allowed, headers };
}
function json(body: unknown, status: number, headers: Record<string,string>) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type":"application/json", ...headers } });
}
function dossierQa(client: any) {
  return [client?.numero_client, client?.prenom, client?.nom, client?.email]
    .some((v) => DOSSIERS_QA.some(prefix => String(v || "").toUpperCase().startsWith(prefix)));
}

export async function traiterPaiementRecette(sb: any, req: Request): Promise<Response> {
  const {allowed, headers} = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response(null, {status: allowed ? 204 : 403, headers});
  if (!allowed) return json({ok:false,code:"ORIGIN_NOT_ALLOWED",message:"Simulation disponible uniquement dans la recette HelixCar."},403,headers);
  if (req.method !== "POST") return json({ok:false,code:"METHOD_NOT_ALLOWED",message:"Méthode refusée."},405,headers);

  let body:any; try{body=await req.json();}catch{return json({ok:false,code:"BAD_REQUEST",message:"Demande invalide."},400,headers);}
  const scenarios=new Set(["success","refused","abandoned","requires_action"]);
  if(!scenarios.has(body?.scenario))return json({ok:false,code:"BAD_REQUEST",message:"Scénario de recette invalide."},400,headers);
  const inaccessible=()=>json({ok:false,code:"NOT_FOUND",message:"Devis inaccessible ou lien expiré."},404,headers);
  let uid:string|null=null, archive:any=null;
  let query=sb.from("devis").select("id,reference,client_id,prix,statut,paiement_statut,version,version_acceptee,version_envoyee,date_expiration_token,annule_le,expire_le");
  if(body.token!=null){
    if(typeof body.token!=="string"||body.token.length<20||body.token.length>256)return inaccessible();
    const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(body.token));
    const hash=Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,"0")).join("");
    const result=await sb.from("devis_preparations").select("devis_id,version,envoyee_le,date_expiration").eq("token_hash",hash).maybeSingle();
    if(result.error)return inaccessible();
    archive=result.data;
    if(archive&&!archive.envoyee_le)return inaccessible();
    query=archive?query.eq("id",archive.devis_id):query.eq("acceptation_token_hash",hash);
  }else{
    const jwt=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
    const {data:userData,error:userError}=jwt?await sb.auth.getUser(jwt):{data:null,error:true};
    if(userError||!userData?.user?.id)return json({ok:false,code:"UNAUTHORIZED",message:"Reconnectez-vous pour continuer."},401,headers);
    uid=userData.user.id;
    if(typeof body.devis_id!=="string")return json({ok:false,code:"BAD_REQUEST",message:"Identifiant de devis requis."},400,headers);
    query=query.eq("id",body.devis_id);
  }
  const {data:quote,error:quoteError}=await query.maybeSingle();
  if(quoteError||!quote)return inaccessible();
  if(body.token!=null){
    const expiration=Date.parse(archive?archive.date_expiration:quote.date_expiration_token);
    if(!Number.isFinite(expiration)||expiration<=Date.now()||quote.annule_le||quote.expire_le)return inaccessible();
    if((archive?archive.version:quote.version_envoyee)!==quote.version)return json({ok:false,code:"VERSION_OBSOLETE",message:"Ce devis a été mis à jour. Utilisez son dernier lien."},409,headers);
    if(body.devis_id&&body.devis_id!==quote.id)return inaccessible();
  }
  let clientQuery=sb.from("clients").select("id,auth_user_id,numero_client,prenom,nom,email").eq("id",quote.client_id);
  if(uid)clientQuery=clientQuery.eq("auth_user_id",uid);
  const {data:client,error:clientError}=await clientQuery.maybeSingle();
  if(clientError||!client)return inaccessible();
  if(!dossierQa(client))return json({ok:false,code:"QA_ONLY",message:"Cette simulation est réservée aux dossiers de test HelixCar."},403,headers);
  if(quote.statut!=="accepte"||quote.version_acceptee!==quote.version)return json({ok:false,code:"DEVIS_NON_ACCEPTE",message:"Le devis envoyé doit être accepté avant la simulation."},409,headers);
  if(quote.paiement_statut==="paye")return json({ok:true,code:"DEJA_PAYE",paiement_statut:"paye",message:"Ce paiement de recette est déjà enregistré. Aucun nouveau traitement."},200,headers);

  const eventId=PREFIXE_QA+"-SIM-"+crypto.randomUUID();
  if(body.scenario!=="success"){
    const labels:any={refused:["PAIEMENT_REFUSE","Paiement de recette refusé. Aucun débit, aucune mission."],abandoned:["PAIEMENT_ABANDONNE","Paiement de recette abandonné. Aucun débit, aucune mission."],requires_action:["ACTION_REQUISE","Simulation 3D Secure : validation supplémentaire requise. Aucun débit."]};
    const [code,message]=labels[body.scenario];
    const {error:writeError}=await sb.from("paiement_evenements").insert({devis_id:quote.id,fournisseur:"test",evenement_id:eventId,type:"echec",montant:quote.prix,devise:"EUR",resultat:code,detail:{simulation:true,scenario:body.scenario,version:quote.version}});
    if(writeError)return json({ok:false,code:"INTERNAL_ERROR",message:"La simulation n’a pas pu être enregistrée."},500,headers);
    return json({ok:true,simulation:true,code,message,paiement_statut:"en_attente"},200,headers);
  }

  const {data:result,error:rpcError}=await sb.rpc("traiter_paiement_confirme",{p_devis_id:quote.id,p_fournisseur:"test",p_evenement_id:eventId,p_montant:quote.prix,p_devise:"EUR",p_detail:{simulation:true,scenario:"success",version:quote.version}});
  if(rpcError){console.error("Simulation paiement:",rpcError.message);return json({ok:false,code:"INTERNAL_ERROR",message:"La simulation n'a pas pu être enregistrée."},500,headers);}
  if(!result?.ok)return json({ok:false,code:result?.code||"PAYMENT_REJECTED",message:"La simulation a été refusée par la règle serveur."},409,headers);
  return json({ok:true,simulation:true,code:result.code,message:"Paiement de recette confirmé. Aucun débit réel.",paiement_statut:"paye",mission:result.mission||null},200,headers);
}

if(typeof Deno!=="undefined"&&typeof (Deno as any).serve==="function"){
  (Deno as any).serve(async(req:Request)=>{
    const origin=req.headers.get("origin");const c=cors(origin);
    const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if(!url||!key)return json({ok:false,code:"SERVER_MISCONFIGURED",message:"Erreur serveur."},500,c.headers);
    const {createClient}=await import("https://esm.sh/@supabase/supabase-js@2");
    return traiterPaiementRecette(createClient(url,key,{auth:{persistSession:false}}),req);
  });
}
