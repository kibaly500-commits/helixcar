import {PREVIEW} from './stripe-payment.mjs';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function messageAttribution(n,from){
 const s=n.snapshot,m=s.mission,role=n.role_destinataire;
 const event=n.evenement||'attribution';
 const labels={depart:'Mission lancée',arrivee:'Véhicule livré',restitution_depart:'Restitution lancée',restitution_arrivee:'Restitution effectuée',terminee:'Mission terminée et contrôlée',validee:'Mission validée par HelixCar'};
 const title=labels[event]||'Prise en charge confirmée';
 const introduction=event!=='attribution' ? title+'. Consultez votre espace pour le suivi.' : role==='client'?'Votre convoyage est pris en charge par '+s.convoyeur_nom+'.':role==='convoyeur'?'Votre acceptation est confirmée. Voici les consignes propres à votre mission.':'Mission attribuée à '+s.convoyeur_nom+'.';
 let html='<h1>'+esc(title)+' — TEST</h1><p>'+esc(introduction)+'</p><p>Référence : '+esc(m.reference)+'</p><p>'+esc(m.ville_depart)+' → '+esc(m.ville_arrivee)+'</p>';
 if(role==='convoyeur'&&event==='attribution'){
   html+='<p>Rémunération prévue : '+esc(Number(m.remuneration_prevue).toFixed(2))+' €</p>';
   for(const [label,value] of [['Véhicule',[m.marque_modele,m.immatriculation].filter(Boolean).join(' — ')],['Prise en charge',m.date_prise_en_charge],['Adresse de départ',m.adresse_depart],['Contact de départ',[m.contact_depart_nom,m.contact_depart_tel].filter(Boolean).join(' — ')],['Livraison',m.date_livraison],['Adresse de livraison',m.adresse_arrivee],['Contact de livraison',[m.contact_arrivee_nom,m.contact_arrivee_tel].filter(Boolean).join(' — ')],['Consignes',m.consignes]]){
     if(value)html+='<p><strong>'+label+'</strong><br>'+esc(value)+'</p>';
   }
   if(m.restitution)html+='<p><strong>Restitution prévue</strong><br>'+esc(m.adresse_restitution)+'<br>'+esc(m.date_restitution_depart)+'</p>';
   if(s.point_remise){
     html+='<p><strong>Point de remise HelixCar</strong><br>'+esc(s.point_remise.adresse)+'</p>';
     if(s.point_remise.arriveeAvantStockage)html+='<p>Avant stockage : remettre le véhicule au point de remise après sa prise en charge chez le client.</p>';
     if(s.point_remise.departApresStockage)html+='<p>Après stockage : récupérer le véhicule au point de remise, puis le livrer à la destination prévue.</p>';
   }
 }
 html+='<p>Scénario de recette fictif. Ne réalisez aucun déplacement.</p><p><a href="'+PREVIEW+'/dashboard.html">Ouvrir mon espace HelixCar</a></p>';
 return {from,to:[n.destinataire],subject:'[TEST] '+title+' — '+m.reference,html};
}
export async function envoyerNotificationsMissionTest(missionId,{sb,env,fetchFn=fetch,now=()=>Date.now()}){
 if(!env.RESEND_API_KEY||!env.RESEND_FROM)throw new Error('EMAIL_CONFIGURATION');
 const check=async p=>{const r=await p;if(r.error)throw new Error('PERSISTENCE');return r.data;};
 const rows=await check(sb.from('notifications_mission_test').select('*').eq('mission_id',missionId));
 for(let n of rows){
   if(n.fournisseur_id)continue;
   if(!['helixcarpro@gmail.com','helixcarpro+qa-final01@gmail.com','kibaly500@gmail.com','kibaly500+qa-final01@gmail.com'].includes(n.destinataire.toLowerCase()))throw new Error('DESTINATAIRE_HORS_RECETTE');
   if(!n.premier_essai){
     if(n.role_destinataire==='convoyeur'&&(n.evenement||'attribution')==='attribution'){
       const remise=await check(sb.rpc('point_remise_mission',{p_mission_id:missionId}));
       n={...n,snapshot:{...n.snapshot,point_remise:remise}};
     }
     await check(sb.from('notifications_mission_test').update({payload:messageAttribution(n,env.RESEND_FROM),premier_essai:new Date(now()).toISOString()}).eq('id',n.id).is('premier_essai',null));
   }
   n=await check(sb.from('notifications_mission_test').select('*').eq('id',n.id).single());
   if(n.fournisseur_id)continue;
   if(now()-Date.parse(n.premier_essai)>=23*3600000)throw new Error('EMAIL_RECONCILIATION_REQUIRED');
   const r=await fetchFn('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'helixcar-mission-test/'+n.id},body:JSON.stringify(n.payload)});
   const d=await r.json();if(!r.ok||!d.id)throw new Error('EMAIL_RETRY_REQUIRED');
   await check(sb.from('notifications_mission_test').update({fournisseur_id:d.id}).eq('id',n.id));
 }
 return {ok:true};
}
