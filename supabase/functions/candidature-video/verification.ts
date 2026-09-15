const BUCKET='candidatures-videos';
function base64url(b:Uint8Array){return btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
async function sha256(texte:string){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(texte));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');}
// Le chemin de copie ne reçoit JAMAIS de signature d'écriture navigateur.
// Une signature encore valide sur l'upload source ne modifie donc pas la
// vidéo figée, mesurée et finalement référencée dans la candidature.
export async function verifierObjet(sb:any,c:any,env:Record<string,string|undefined>,fetchFn:typeof fetch=fetch){
 const source=String(c.video_envoi_chemin);
 const final=source.slice(0,source.lastIndexOf('/')+1)+'verifie/'+source.slice(source.lastIndexOf('/')+1);
 let {data:v,error}=await sb.from('video_verifications').select('*').eq('chemin_source',source).maybeSingle();
 if(error)return {ok:false,code:'VERIFICATION_INDISPONIBLE'};
 if(v?.etat==='verifie')return v;
 if(v?.etat==='refuse')return {ok:false,code:v.code_refus};
 const origine=env.HELIXCAR_ORIGINE;
 const configuree=env.HELIXCAR_VIDEO_VALIDATION_URL;
 const urlWorker=configuree||((origine&&/^https:\/\/[^/?#]+$/.test(origine))?origine+'/api/video-validation':undefined);
 const secret=env.HELIXCAR_VIDEO_VALIDATION_SECRET;
 if(!urlWorker||!/^https:\/\/[^/?#]+\/(?:verifier|api\/video-validation)$/.test(urlWorker))return {ok:false,code:'VERIFICATION_NON_CONFIGUREE'};
 if(!v){
   const insertion=await sb.from('video_verifications').insert({chemin_source:source,convoyeur_id:c.id,chemin_final:final,etat:'en_attente'});
   if(insertion.error){const relu=await sb.from('video_verifications').select('*').eq('chemin_source',source).maybeSingle();if(relu.error||!relu.data)return {ok:false,code:'VERIFICATION_INDISPONIBLE'};v=relu.data;}
 }
 const copie=await sb.storage.from(BUCKET).copy(source,final);
 if(copie.error){
   const liste=await sb.storage.from(BUCKET).list(final.slice(0,final.lastIndexOf('/')));
   if(liste.error||!liste.data?.some((o:any)=>o.name===final.slice(final.lastIndexOf('/')+1)))return {ok:false,code:'VERIFICATION_INDISPONIBLE'};
 }
 let corpsWorker:any,entetes:any={'Content-Type':'application/json'};
 if(configuree&&secret&&secret.length>=32){
   const sig=await sb.storage.from(BUCKET).createSignedUrl(final,180);
   if(sig.error||!sig.data?.signedUrl)return {ok:false,code:'VERIFICATION_INDISPONIBLE'};
   entetes.Authorization='Bearer '+secret;
   corpsWorker={url:sig.data.signedUrl,candidature_id:c.id,mime:c.video_envoi_mime,duree_max:120};
 }else{
   const brut=new Uint8Array(32);crypto.getRandomValues(brut);const jeton=base64url(brut),hash=await sha256(jeton);
   const jetonMaj=await sb.from('video_verifications').update({jeton_worker_hash:hash,jeton_worker_expire_le:new Date(Date.now()+180000).toISOString(),jeton_worker_consomme_le:null}).eq('chemin_source',source).eq('etat','en_attente');
   if(jetonMaj.error)return {ok:false,code:'VERIFICATION_INDISPONIBLE'};
   const supabase=env.SUPABASE_URL;
   if(!supabase||!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(supabase))return {ok:false,code:'VERIFICATION_NON_CONFIGUREE'};
   corpsWorker={claim_url:supabase+'/functions/v1/candidature-video',token:jeton,candidature_id:c.id};
 }
 let rep:any;
 try{const r=await fetchFn(urlWorker,{method:'POST',headers:entetes,body:JSON.stringify(corpsWorker),signal:AbortSignal.timeout(280000)});rep=await r.json();if(!r.ok&&rep.ok)throw 0;}catch{return {ok:false,code:'VERIFICATION_INDISPONIBLE'};}
 if(rep.ok!==true){
   const stables=['TAILLE_REFUSEE','DUREE_REFUSEE','FORMAT_INCOHERENT','VIDEO_ILLISIBLE'];
   const code=stables.includes(rep.code)?rep.code:'VERIFICATION_INDISPONIBLE';
   if(stables.includes(code))await sb.from('video_verifications').update({etat:'refuse',code_refus:code}).eq('chemin_source',source);
   return {ok:false,code};
 }
 if(!Number.isSafeInteger(rep.taille_octets)||rep.taille_octets!==Number(c.video_envoi_taille_octets)||!Number.isFinite(rep.duree_secondes)||rep.duree_secondes<=0||rep.duree_secondes>120||rep.mime!==c.video_envoi_mime||!rep.codec||!(/^[a-f0-9]{64}$/).test(rep.sha256))return {ok:false,code:'METADONNEES_INCOHERENTES'};
 const mesure={etat:'verifie',taille_octets:rep.taille_octets,duree_secondes:rep.duree_secondes,mime:rep.mime,codec:rep.codec,sha256:rep.sha256,verifie_le:new Date().toISOString()};
 const maj=await sb.from('video_verifications').update(mesure).eq('chemin_source',source);
 return maj.error?{ok:false,code:'VERIFICATION_INDISPONIBLE'}:{ok:true,...mesure};
}
