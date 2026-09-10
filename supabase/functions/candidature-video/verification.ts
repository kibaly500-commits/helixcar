const BUCKET='candidatures-videos';
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
 const urlWorker=env.HELIXCAR_VIDEO_VALIDATION_URL,secret=env.HELIXCAR_VIDEO_VALIDATION_SECRET;
 if(!urlWorker||!/^https:\/\/[^/?#]+\/verifier$/.test(urlWorker)||!secret||secret.length<32)return {ok:false,code:'VERIFICATION_NON_CONFIGUREE'};
 if(!v){
   const insertion=await sb.from('video_verifications').insert({chemin_source:source,convoyeur_id:c.id,chemin_final:final,etat:'en_attente'});
   if(insertion.error){const relu=await sb.from('video_verifications').select('*').eq('chemin_source',source).maybeSingle();if(relu.error||!relu.data)return {ok:false,code:'VERIFICATION_INDISPONIBLE'};v=relu.data;}
 }
 const copie=await sb.storage.from(BUCKET).copy(source,final);
 if(copie.error){
   const liste=await sb.storage.from(BUCKET).list(final.slice(0,final.lastIndexOf('/')));
   if(liste.error||!liste.data?.some((o:any)=>o.name===final.slice(final.lastIndexOf('/')+1)))return {ok:false,code:'VERIFICATION_INDISPONIBLE'};
 }
 const sig=await sb.storage.from(BUCKET).createSignedUrl(final,180);
 if(sig.error||!sig.data?.signedUrl)return {ok:false,code:'VERIFICATION_INDISPONIBLE'};
 let rep:any;
 try{const r=await fetchFn(urlWorker,{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify({url:sig.data.signedUrl,candidature_id:c.id,mime:c.video_envoi_mime,duree_max:c.activites.includes('renfort')||c.activites.includes('technicien')?120:60}),signal:AbortSignal.timeout(95000)});rep=await r.json();if(!r.ok&&rep.ok)throw 0;}catch{return {ok:false,code:'VERIFICATION_INDISPONIBLE'};}
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
