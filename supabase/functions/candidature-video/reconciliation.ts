// Réconciliation conservatrice : uniquement les candidatures déjà finalisées
// depuis plus de 25 h (au-delà des signatures et reprises TUS de 24 h).
// Un upload abandonné mais encore associé à un dossier reste conservé.
export async function reconcilierVideos(sb:any,appliquer=false,maintenant=Date.now(),apres:string|null=null){
 const borne=new Date(maintenant-25*3600000).toISOString();
 let requete=sb.from('convoyeurs')
   .select('id,video_chemin,video_envoyee_le,video_envoi_chemin')
   .lt('video_envoyee_le',borne).order('id').limit(100);
 if(apres)requete=requete.gt('id',apres);
 const {data:candidatures,error}=await requete;
 if(error)throw new Error('RECONCILIATION_INDISPONIBLE');
 const bilan={examines:0,conserves:0,supprimes:0,a_supprimer:0,erreurs:0,prochain_id:candidatures?.length===100?candidatures[99].id:null};
 const bucket=sb.storage.from('candidatures-videos');
 for(const c of candidatures||[]){
   // Relire juste avant l'examen : une reprise active gagne toujours.
   const relu=await sb.from('convoyeurs').select('id,video_chemin,video_envoyee_le,video_envoi_chemin').eq('id',c.id).maybeSingle();
   if(relu.error){bilan.erreurs++;continue;}
   const actuel=relu.data;
   if(!actuel||actuel.video_envoi_chemin||!actuel.video_chemin||!actuel.video_envoyee_le||Date.parse(actuel.video_envoyee_le)>=Date.parse(borne))continue;
   const prefixe='candidatures/'+c.id+'/';
   if(!actuel.video_chemin.startsWith(prefixe)){bilan.erreurs++;continue;}
   const historiques=await sb.from('video_verifications').select('chemin_final').eq('convoyeur_id',c.id).eq('etat','verifie');
   if(historiques.error){bilan.erreurs++;continue;}
   const proteges=new Set([actuel.video_chemin,...(historiques.data||[]).map((v:any)=>v.chemin_final)]);
   for(const dossier of [prefixe.slice(0,-1),prefixe+'verifie']){
     const objets=[];
     // D'abord tout lister : supprimer pendant la pagination sauterait des objets.
     for(let offset=0;;offset+=100){
       const liste=await bucket.list(dossier,{limit:100,offset,sortBy:{column:'name',order:'asc'}});
       if(liste.error){bilan.erreurs++;break;}
       objets.push(...(liste.data||[]));if(!liste.data||liste.data.length<100)break;
     }
     for(const objet of objets){
       if(!objet.id||typeof objet.name!=='string'||objet.name.includes('/')||objet.name.includes('..'))continue;
       const chemin=dossier+'/'+objet.name;bilan.examines++;
       // Un objet récent peut provenir d'une ancienne URL encore en cours : attendre.
       const date=Date.parse(objet.updated_at||objet.created_at||'');
       if(proteges.has(chemin)||!Number.isFinite(date)||date>=Date.parse(borne)){bilan.conserves++;continue;}
       bilan.a_supprimer++;
       if(appliquer){const r=await bucket.remove([chemin]);if(r.error)bilan.erreurs++;else bilan.supprimes++;}
     }
   }
 }
 return bilan;
}
