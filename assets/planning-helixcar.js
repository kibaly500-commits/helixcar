/* Vue privée de l'administration. Les horaires confirmés ne suivent jamais
 * automatiquement les estimations de trafic. */
(function(){
'use strict';
const C=HCPlanningCalcul,esc=v=>escapeHtml(String(v??''));
let rows=[],records=new Map(),ticket=0;
const panel=()=>document.getElementById('hc-planning-list');
const fmt=v=>v?String(v).replace(/(\d{4})-(\d{2})-(\d{2})T?(\d{2}:\d{2})?.*/,(_,y,m,d,h)=>`${d}/${m}/${y}${h?' à '+h:''}`):'À fixer';
const schedule=p=>p.kind==='avant_stockage'?p.mission.date_livraison:p.mission.date_prise_en_charge;
async function calculate(clientId,key,margin){
 const s=await sbAuth.auth.getSession();if(!s.data?.session)throw Error('Reconnectez-vous à votre espace administrateur.');
 const response=await fetch('/api/planning-trafic',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+s.data.session.access_token,apikey:SUPABASE_KEY},body:JSON.stringify({clientId,key,margin})});
 let data;try{data=await response.json();}catch{throw Error('Le calcul avec trafic n’est pas encore disponible sur ce déploiement.');}
 if(!response.ok)throw Error(data.error||'Calcul indisponible');return data;
}
function summary(e,plan){
 if(!e)return '<p>Estimation non calculée. Les horaires du client restent la référence.</p>';
 const fixed=plan&&schedule(plan);
 const risky=fixed&&((e.kind==='apres_stockage'&&fixed.slice(0,16)>e.suggestion)||(e.kind==='avant_stockage'&&fixed.slice(0,16)<e.suggestion));
 return (risky?'<p class="hc-planning-warning">L’horaire saisi laisse moins de temps que l’estimation. Vérifiez le rendez-vous avant confirmation.</p>':'')+'<p><strong>'+esc(e.km)+' km · '+esc(e.minutes)+' min de route</strong> · battement '+esc(e.margin)+' min (20 min de remise et '+esc(e.margin-20)+' min de sécurité).</p>'
 +'<p>'+esc(e.kind==='avant_stockage'?'Réception conseillée':e.kind==='apres_stockage'?'Remise conseillée':'Arrivée estimée avec battement')+' : <strong>'+esc(fmt(e.suggestion))+'</strong></p>'
 +(e.restitution?'<p>Restitution : '+esc(e.restitution.km)+' km · '+esc(e.restitution.minutes)+' min, après 20 min de remise au client.</p>':'')
 +'<p class="hc-prep-muted">'+esc(e.provider)+' · estimation au '+esc(_dvDateHeure(e.calculatedAt))+' · à actualiser avant le départ.</p>'
 +(e.warnings||[]).map(w=>'<p class="hc-planning-warning">'+esc(w)+'</p>').join('');
}
async function action(id,kind){
 const r=records.get(id),response=await sbAuth.rpc('action_planning_helixcar',{p_preparation_id:id,p_action:kind,p_revision:r?.revision||0});
 if(response.error)throw Error(response.error.message);records.set(id,response.data);return response.data;
}
async function load(){
 const current=++ticket;panel().textContent='Chargement du planning…';
 try{
  const [data,states]=await Promise.all([sbFetchToutePage('preparations_missions?select=id,client_id,cle,empreinte,plan,mission_id,clients(numero_client),missions!preparations_missions_mission_id_fkey(reference,statut,convoyeurs!missions_convoyeur_id_fkey(prenom,nom))&order=updated_at.desc'),sbFetchToutePage('planning_helixcar?select=*')]);
  if(current!==ticket||_hcNavigationRole!=='admin')return;
  rows=data.filter(r=>['avant_stockage','apres_stockage'].includes(r.plan?.kind)&&!['annule','annulee'].includes(r.missions?.statut));records=new Map(states.map(r=>[r.preparation_id,r]));render();
 }catch(e){if(current===ticket)panel().textContent='Le planning reste à actualiser. '+e.message;}
}
function render(){
 const day=document.getElementById('hc-planning-day').value;
 const kind=document.getElementById('hc-planning-kind').value;
 const list=rows.filter(r=>(!day||(records.get(r.id)?.horaire_confirme||schedule(r.plan)||r.plan.date_debut||'').slice(0,10)===day)&&(!kind||r.plan.kind===kind));
 list.sort((a,b)=>String(records.get(a.id)?.horaire_confirme||schedule(a.plan)||a.plan.date_debut).localeCompare(String(records.get(b.id)?.horaire_confirme||schedule(b.plan)||b.plan.date_debut)));
 if(!list.length){panel().innerHTML='<div class="card">Aucun rendez-vous pour cette sélection. Les trajets passant par HelixCar apparaissent après l’enregistrement de leur préparation.</div>';return;}
 panel().innerHTML=list.map(r=>{
  const p=r.plan,s=records.get(r.id),inbound=p.kind==='avant_stockage',time=schedule(p);
  const stale=s?.horaire_confirme&&(s.empreinte_confirmee!==r.empreinte||s.horaire_confirme.slice(0,16)!==time?.slice(0,16));
  const collisions=s?.horaire_confirme&&!s.cles_effectuees_le&&rows.some(other=>{
   const o=records.get(other.id);if(other.id===r.id||!o?.horaire_confirme||o.cles_effectuees_le)return false;
   try{return C.overlap(C.slot(p.kind,s.horaire_confirme.slice(0,16)),C.slot(other.plan.kind,o.horaire_confirme.slice(0,16)));}catch{return false;}
  });
  const who=r.missions?.convoyeurs,partner=who?[who.prenom,who.nom].filter(Boolean).join(' '):'Partenaire à attribuer';
  return '<article class="card hc-planning-card" data-planning-id="'+esc(r.id)+'"><div class="card-header"><div><span class="badge">'+(inbound?'À réceptionner':'À remettre')+'</span><h3>'+esc(p.mission.marque_modele||'Véhicule')+' · '+esc(p.mission.immatriculation||'Immatriculation à compléter')+'</h3><p>'+esc(r.clients?.numero_client||r.missions?.reference||'Dossier')+' · '+esc(partner)+'</p></div><strong>'+esc(fmt(s?.horaire_confirme||time))+'</strong></div>'
  +'<p>'+esc(p.mission.adresse_depart)+' → '+esc(p.mission.adresse_arrivee)+'</p>'
  +'<p>'+(s?.cles_effectuees_le?'Clés '+(inbound?'reçues':'remises')+' le '+esc(_dvDateHeure(s.cles_effectuees_le)):s?.horaire_confirme?'Horaire confirmé':'Horaire à confirmer')+'</p>'
  +(stale?'<p class="hc-planning-warning">La préparation a changé depuis la confirmation. Vérifiez le rendez-vous.</p>':'')
  +(collisions?'<p class="hc-planning-warning">Un autre rendez-vous confirmé chevauche ces 20 minutes de remise.</p>':'')
  +'<div class="hc-planning-estimate">'+summary(p.planning_estimate,p)+'</div>'
  +'<div class="hc-prep-toolbar"><button type="button" class="btn btn-outline" data-planning-action="ouvrir">Ouvrir la préparation</button><button type="button" class="btn btn-outline" data-planning-action="trafic">Actualiser le trafic</button>'
  +(!s?.cles_effectuees_le?'<button type="button" class="btn btn-primary" data-planning-action="confirmer"'+(!time?' disabled':'')+'>Confirmer cet horaire</button><button type="button" class="btn btn-outline" data-planning-action="cles"'+(!s?.horaire_confirme||stale?' disabled':'')+'>'+(inbound?'Clés reçues':'Clés remises')+'</button>':'')+'</div><p class="hc-planning-feedback" role="status"></p></article>';
 }).join('');
}
const section=document.getElementById('page-admin-planning');
section.addEventListener('change',e=>{if(e.target.matches('input,select'))render();});
section.addEventListener('click',async e=>{
 const b=e.target.closest('button');if(!b)return;if(b.id==='hc-planning-refresh'){await load();return;}
 const card=b.closest('[data-planning-id]'),r=rows.find(x=>x.id===card?.dataset.planningId);if(!r)return;
 const out=card.querySelector('.hc-planning-feedback');b.disabled=true;out.textContent='';
 try{
  const kind=b.dataset.planningAction;
  if(kind==='ouvrir'){await ouvrirPreparationDemande(r.client_id);return;}
  if(kind==='trafic'){
   out.textContent='Calcul du trajet avec trafic…';const data=await calculate(r.client_id,r.cle,r.plan.planning_margin??45);
   if(!card.isConnected||_hcNavigationRole!=='admin')return;
   card.querySelector('.hc-planning-estimate').innerHTML=summary(data.estimate,r.plan);
   out.textContent=data.fingerprint!==r.empreinte?'La demande a changé : rouvrez la préparation.':'Estimation actualisée. Votre rendez-vous confirmé reste inchangé.';return;
  }
  if(!confirm(kind==='cles'?'Confirmer que la remise physique des clés a eu lieu ?':'Confirmer ce rendez-vous HelixCar ?'))return;
  await action(r.id,kind);render();
 }catch(err){out.textContent=err.message;}finally{b.disabled=false;}
});
window.HCPlanning={calculate,summary,load,action};
window.addEventListener('hc-session-fermee',()=>{++ticket;rows=[];records.clear();panel().textContent='';});
})();
