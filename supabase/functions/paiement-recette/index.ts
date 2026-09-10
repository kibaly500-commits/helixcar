// deno-lint-ignore-file no-explicit-any
// Simulation de paiement réservée aux Previews et aux dossiers QA.
// Aucun appel à un prestataire et aucun débit réel ne sont effectués.

const ORIGINES_RECETTE = new Set([
  "https://helixcar-i89b.vercel.app",
  "https://helixcar-git-codex-helixcar-f-0253b9-kibaly500-commits-projects.vercel.app",
  "https://helixcar-i89b-git-codex-helix-b25bf8-kibaly500-commits-projects.vercel.app",
]);
const PREFIXE_QA = "TEST-QA-CLAUDE-HELIXCAR";

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
    .some((v) => String(v || "").toUpperCase().includes(PREFIXE_QA));
}

export async function traiterPaiementRecette(sb: any, req: Request): Promise<Response> {
  const {allowed, headers} = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response(null, {status: allowed ? 204 : 403, headers});
  if (!allowed) return json({ok:false,code:"ORIGIN_NOT_ALLOWED",message:"Simulation disponible uniquement dans la recette HelixCar."},403,headers);
  if (req.method !== "POST") return json({ok:false,code:"METHOD_NOT_ALLOWED",message:"Méthode refusée."},405,headers);

  const jwt=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
  const {data:userData,error:userError}=jwt ? await sb.auth.getUser(jwt) : {data:null,error:true};
  if(userError||!userData?.user?.id)return json({ok:false,code:"UNAUTHORIZED",message:"Reconnectez-vous pour continuer."},401,headers);

  let body:any; try{body=await req.json();}catch{return json({ok:false,code:"BAD_REQUEST",message:"Demande invalide."},400,headers);}
  const scenarios=new Set(["success","refused","abandoned","requires_action"]);
  if(typeof body?.devis_id!=="string"||!scenarios.has(body?.scenario))return json({ok:false,code:"BAD_REQUEST",message:"Scénario de recette invalide."},400,headers);

  const {data:quote,error:quoteError}=await sb.from("devis").select("id,reference,client_id,prix,statut,paiement_statut,version,version_acceptee").eq("id",body.devis_id).maybeSingle();
  if(quoteError||!quote)return json({ok:false,code:"NOT_FOUND",message:"Devis inaccessible."},404,headers);
  const {data:client,error:clientError}=await sb.from("clients").select("id,auth_user_id,numero_client,prenom,nom,email").eq("id",quote.client_id).eq("auth_user_id",userData.user.id).maybeSingle();
  if(clientError||!client)return json({ok:false,code:"NOT_FOUND",message:"Devis inaccessible."},404,headers);
  if(!dossierQa(client))return json({ok:false,code:"QA_ONLY",message:"Cette simulation est strictement réservée aux dossiers TEST-QA-CLAUDE-HELIXCAR."},403,headers);
  if(quote.statut!=="accepte"||quote.version_acceptee!==quote.version)return json({ok:false,code:"DEVIS_NON_ACCEPTE",message:"Le devis envoyé doit être accepté avant la simulation."},409,headers);
  if(quote.paiement_statut==="paye")return json({ok:true,code:"DEJA_PAYE",message:"Ce paiement de recette est déjà enregistré. Aucun nouveau traitement."},200,headers);

  const eventId=PREFIXE_QA+"-SIM-"+crypto.randomUUID();
  if(body.scenario!=="success"){
    const labels:any={refused:["PAIEMENT_REFUSE","Paiement de recette refusé. Aucun débit, aucune mission."],abandoned:["PAIEMENT_ABANDONNE","Paiement de recette abandonné. Aucun débit, aucune mission."],requires_action:["ACTION_REQUISE","Simulation 3D Secure : validation supplémentaire requise. Aucun débit."]};
    const [code,message]=labels[body.scenario];
    await sb.from("paiement_evenements").insert({devis_id:quote.id,fournisseur:"test",evenement_id:eventId,type:"echec",montant:quote.prix,devise:"EUR",resultat:code,detail:{simulation:true,scenario:body.scenario,version:quote.version}});
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
