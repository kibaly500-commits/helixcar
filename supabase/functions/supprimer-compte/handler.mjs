const origins=['https://helixcar.fr','https://www.helixcar.fr','https://helixcar-i89b-git-codex-helix-b25bf8-kibaly500-commits-projects.vercel.app'];
export async function supprimerCompte(req,sb){
 const origin=req.headers.get('origin')||'';
 const headers={'Access-Control-Allow-Origin':origins.includes(origin)?origin:'null','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin'};
 const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{...headers,'Content-Type':'application/json'}});
 if(!origins.includes(origin))return json({error:'Origine interdite'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return json({error:'Méthode interdite'},405);
 try{
  const token=(req.headers.get('authorization')||'').replace(/^Bearer /i,'');
  const {data,error}=await sb.auth.getUser(token);if(error||!data.user)return json({error:'Connexion requise'},401);
  const body=await req.json();if(body.confirmation!=='SUPPRIMER'||typeof body.motif!=='string'||!body.motif.trim()||body.motif.length>1000)return json({error:'Motif et confirmation requis'},400);
  // Identité exclusivement tirée du JWT vérifié ; aucun UUID client n'est accepté.
  const id=data.user.id;
  const ready=await sb.rpc('preparer_suppression_compte',{p_uid:id,p_motif:body.motif});if(ready.error)return json({error:'La fermeture du compte n’a pas pu être préparée.'},409);
  // Suppression logique Auth : conserve les références des documents historiques.
  const removed=await sb.auth.admin.deleteUser(id,true);
  if(removed.error)return json({error:'La fermeture est préparée mais non finalisée. Réessayez la suppression.'},503);
  await sb.from('suppressions_comptes').update({auth_supprime_le:new Date().toISOString()}).eq('auth_user_id',id);
  return json({ok:true});
 }catch{return json({error:'Suppression indisponible. Réessayez.'},500);}
}
