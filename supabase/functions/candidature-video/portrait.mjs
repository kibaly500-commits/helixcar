// Le jeton est vérifié par le même résolveur que la vidéo. Aucun accès Storage anonyme.
export async function recevoirPortrait(sb,req,corps,cors,resoudre){
 const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
 const r=await resoudre(sb,req,corps);
 if(r.erreur)return reply({ok:false,message:r.erreur[1]},r.erreur[2]);
 if(r.jetonConsomme||r.candidature.statut!=='video_attendue')return reply({ok:false,message:'Autorisation de dépôt expirée.'},403);
 if(!['image/jpeg','image/png'].includes(corps.mime)||typeof corps.base64!=='string'||corps.base64.length>6990508)return reply({ok:false,message:'Photo JPG ou PNG, 5 Mo maximum.'},400);
 let bytes;try{bytes=Uint8Array.from(atob(corps.base64),c=>c.charCodeAt(0));}catch{return reply({ok:false,message:'Photo invalide.'},400);}
 const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 const png=[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v);
 if(!bytes.length||bytes.length>5242880||!(corps.mime==='image/jpeg'?jpeg:png))return reply({ok:false,message:'Le fichier doit être une photo JPG ou PNG.'},400);
 const id=r.candidature.id,chemin='inscription/'+id+'.'+(jpeg?'jpg':'png');
 const existing=await sb.from('convoyeurs').select('photo_profil_chemin').eq('id',id).single();
 if(existing.error)return reply({ok:false,message:'Photo indisponible. Réessayez.'},503);
 if(existing.data.photo_profil_chemin)return reply({ok:true});
 const bucket=sb.storage.from('portraits-partenaires');
 // Un seul nom par format et dossier ; pas de création arbitraire de fichiers.
 const upload=await bucket.upload(chemin,bytes,{contentType:corps.mime,upsert:true});
 if(upload.error)return reply({ok:false,message:'La photo n’a pas pu être envoyée. Réessayez.'},503);
 const save=await sb.from('convoyeurs').update({photo_profil_chemin:chemin}).eq('id',id).eq('statut','video_attendue').select('id').maybeSingle();
 if(save.error||!save.data)return reply({ok:false,message:'La photo n’a pas pu être enregistrée. Réessayez.'},503);
 return reply({ok:true});
}
