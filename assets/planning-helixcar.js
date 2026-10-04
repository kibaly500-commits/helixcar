/* Planning manuel privé : réceptions et remises de clés chez HelixCar. */
(function(){
'use strict';
const C=HCPlanningCalcul,esc=v=>escapeHtml(String(v??''));
let rows=[],records=new Map(),ticket=0;
const panel=()=>document.getElementById('hc-planning-list');
const fmt=v=>v?String(v).replace(/(\d{4})-(\d{2})-(\d{2})T?(\d{2}:\d{2})?.*/,(_,y,m,d,h)=>`${d}/${m}/${y}${h?' à '+h:''}`):'À fixer';
const schedule=p=>p.kind==='avant_stockage'?p.mission.date_livraison:p.mission.date_prise_en_charge;
async function action(id,kind){
 const r=records.get(id),response=await sbAuth.rpc('action_planning_helixcar',{p_preparation_id:id,p_action:kind,p_revision:r?.revision||0});
 if(response.error)throw Error(response.error.message);records.set(id,response.data);return response.data;
}
// Les passages clients proviennent de la demande, sans mission artificielle.
function clientRows(clients){
 const result=[];
 for(const c of clients){
  if(c.type_service!=='stockage'||['annule','annulee'].includes(c.statut)||!(c.devis||[]).some(d=>d.paiement_statut==='paye'&&!['annule','annulee','refuse'].includes(d.statut)))continue;
  const vehicles=c.vehicules?.length?c.vehicules:[{id:'principal',marque_modele:c.marque_modele,immatriculation:c.immatriculation}];
  const multi=Number(c.nb_vehicules||c.stockage_nb_vehicules||vehicles.length)>1;
  for(const v of vehicles){
   const inbound=['depot_client','client'].includes(c.stockage_acheminement);
   const outbound=v.livraison_apres_stockage===false||(v.livraison_apres_stockage!==true&&['recuperation_client','client'].includes(c.stockage_sortie));
   for(const [kind,active,date,hour] of [
    ['avant_stockage',inbound,c.stockage_date_debut,c.stockage_heure_entree],
    ['apres_stockage',outbound,c.stockage_date_fin,multi?v.heure_recuperation_client:c.stockage_heure_sortie]
   ]){
    if(!active)continue;
    const incoming=kind==='avant_stockage',time=date?(date+(hour?'T'+hour.slice(0,5):'')):null;
    result.push({id:'client:'+c.id+':'+v.id+':'+kind,client_id:c.id,clientPassage:true,phone:c.telephone,person:[c.prenom,c.nom].filter(Boolean).join(' ')||c.societe||'Client',clients:{numero_client:c.numero_client},plan:{kind,date_debut:date,mission:{marque_modele:v.marque_modele,immatriculation:v.immatriculation,date_livraison:incoming?time:null,date_prise_en_charge:incoming?null:time,adresse_depart:incoming?'Client':C.POINT,adresse_arrivee:incoming?C.POINT:'Client'}}});
   }
  }
 }
 return result;
}
async function load(){
 const current=++ticket;rows=[];records.clear();panel().textContent='Chargement du planning…';
 try{
  if(_hcNavigationRole!=='admin')return;
  const [data,states,clients]=await Promise.all([sbFetchToutePage('preparations_missions?select=id,client_id,cle,empreinte,plan,mission_id,clients(numero_client),missions!preparations_missions_mission_id_fkey(reference,statut,convoyeurs!missions_convoyeur_id_fkey(prenom,nom))&order=updated_at.desc'),sbFetchToutePage('planning_helixcar?select=*'),sbFetchToutePage('clients?select=*,vehicules(id,marque_modele,immatriculation,livraison_apres_stockage,heure_recuperation_client),devis(statut,paiement_statut)&type_service=eq.stockage&order=created_at.desc')]);
  if(current!==ticket||_hcNavigationRole!=='admin')return;
  const candidates=data.filter(r=>['avant_stockage','apres_stockage'].includes(r.plan?.kind)&&!['annule','annulee'].includes(r.missions?.statut));
  const passages=clientRows(clients),ids=[...new Set([...candidates,...passages].map(r=>r.client_id))],ready=new Set(),currentKeys=new Map();
  // Même contrôle serveur que l'ouverture de la préparation : paiement,
  // informations fournies/validées, aucune correction en attente.
  for(let i=0;i<ids.length;i+=4){
   await Promise.all(ids.slice(i,i+4).map(async id=>{
    const response=await sbAuth.rpc('source_preparation_missions',{p_client_id:id});
    if(response.error){
     if(/Dossier incomplet|Le devis doit être accepté et le paiement confirmé|Demande introuvable/.test(response.error.message||''))return;
     throw Error('La vérification des dossiers reste à effectuer. Réessayez.');
    }
    const source=response.data;
    if(!source?.client||!Array.isArray(source.vehicules))throw Error('Réponse de vérification indisponible.');
    const plans=HCPreparation.preservePublished(HCPreparation.build(source.client,source.vehicules,source.point_remise),source.brouillons||[]);
    if(plans.some(p=>p.missing?.length))return;
    currentKeys.set(id,new Set(plans.map(p=>p.key)));
    ready.add(id);
   }));
   if(current!==ticket||_hcNavigationRole!=='admin')return;
  }
  rows=[...candidates,...passages].filter(r=>ready.has(r.client_id)&&(r.clientPassage||r.mission_id||currentKeys.get(r.client_id)?.has(r.cle||r.plan.key)));records=new Map(states.map(r=>[r.preparation_id,r]));render();
 }catch(e){if(current===ticket)panel().textContent='Le planning reste à actualiser. '+e.message;}
}
function render(){
 const day=document.getElementById('hc-planning-day').value;
 const kind=document.getElementById('hc-planning-kind').value;
 const list=rows.filter(r=>(!day||(records.get(r.id)?.horaire_confirme||schedule(r.plan)||r.plan.date_debut||'').slice(0,10)===day)&&(!kind||r.plan.kind===kind));
 list.sort((a,b)=>String(records.get(a.id)?.horaire_confirme||schedule(a.plan)||a.plan.date_debut).localeCompare(String(records.get(b.id)?.horaire_confirme||schedule(b.plan)||b.plan.date_debut)));
 if(!list.length){panel().innerHTML='<div class="card">Aucun rendez-vous pour cette sélection. Seuls les dossiers payés, complets et sans information en attente de validation apparaissent ici.</div>';return;}
 panel().innerHTML=list.map(r=>{
  const p=r.plan,s=records.get(r.id),inbound=p.kind==='avant_stockage',time=schedule(p);
  if(r.clientPassage)return '<article class="card hc-planning-card" data-planning-id="'+esc(r.id)+'"><div class="card-header"><div><span class="badge">'+(inbound?'À réceptionner · Client':'À remettre · Client')+'</span><h3>'+esc(p.mission.marque_modele||'Véhicule à préciser')+' · '+esc(p.mission.immatriculation||'Immatriculation à compléter')+'</h3><p>'+esc(r.clients.numero_client||'Dossier')+' · '+esc(r.person)+'</p></div><strong>'+esc(fmt(time))+(time&&!time.includes('T')?' · Heure à préciser':'')+'</strong></div><p>'+esc(C.POINT)+'</p><p><strong>'+(inbound?'Le client vous apporte le véhicule.':'Le client vient récupérer le véhicule auprès de vous.')+'</strong></p><p>Horaire communiqué par le client.</p><details class="hc-prep-private"><summary>Coordonnées du client</summary><p>'+esc(r.person)+' · '+esc(r.phone||'Téléphone non renseigné')+'</p></details><p class="hc-planning-feedback" role="status"></p></article>';
  const stale=s?.horaire_confirme&&(s.empreinte_confirmee!==r.empreinte||s.horaire_confirme.slice(0,16)!==time?.slice(0,16));
  const collisions=s?.horaire_confirme&&!s.cles_effectuees_le&&rows.some(other=>{
   const o=records.get(other.id);if(other.id===r.id||!o?.horaire_confirme||o.cles_effectuees_le)return false;
   try{return C.overlap(C.slot(p.kind,s.horaire_confirme.slice(0,16)),C.slot(other.plan.kind,o.horaire_confirme.slice(0,16)));}catch{return false;}
  });
  const guide=C.guidance(p);
  const who=r.missions?.convoyeurs,partner=who?[who.prenom,who.nom].filter(Boolean).join(' '):'Partenaire à attribuer';
  return '<article class="card hc-planning-card" data-planning-id="'+esc(r.id)+'"><div class="card-header"><div><span class="badge">'+(inbound?'À réceptionner':'À remettre')+'</span><h3>'+esc(p.mission.marque_modele||'Véhicule')+' · '+esc(p.mission.immatriculation||'Immatriculation à compléter')+'</h3><p>'+esc(r.clients?.numero_client||r.missions?.reference||'Dossier')+' · '+esc(partner)+'</p></div><strong>'+esc(fmt(s?.horaire_confirme||time))+'</strong></div>'
  +'<div class="hc-planning-estimate"><p><strong>'+esc(guide.label)+' :</strong> '+esc(guide.when.replace(/(\d{4})-(\d{2})-(\d{2})/g,'$3/$2/$1'))+'</p><p>'+esc(guide.address)+'</p><p><strong>'+esc(guide.target)+' :</strong> '+esc(fmt(time))+'</p><p>'+esc(C.POINT)+'</p><p><strong>Prévoir 45 minutes de battement.</strong> '+esc(guide.rule)+'</p></div>'
  +'<p>'+(s?.cles_effectuees_le?'Clés '+(inbound?'reçues':'remises')+' le '+esc(_dvDateHeure(s.cles_effectuees_le)):s?.horaire_confirme?'Horaire confirmé':time?'Horaire à confirmer':inbound?'Votre heure de réception reste à fixer':'Votre heure de remise au convoyeur reste à fixer')+'</p>'
  +(stale?'<p class="hc-planning-warning">La préparation a changé depuis la confirmation. Vérifiez le rendez-vous.</p>':'')
  +(collisions?'<p class="hc-planning-warning">Un autre rendez-vous confirmé chevauche ces 20 minutes de remise.</p>':'')
  +'<p><strong>'+ (inbound?'Votre intervention : réceptionner le véhicule au point HelixCar.':'Votre intervention : remettre le véhicule au convoyeur au point HelixCar.')+'</strong></p>'
  +'<div class="hc-prep-toolbar"><button type="button" class="btn btn-outline" data-planning-action="ouvrir">Voir / régler les horaires</button>'
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
  if(!confirm(kind==='cles'?'Confirmer que la remise physique des clés a eu lieu ?':'Confirmer ce rendez-vous HelixCar ?'))return;
  await action(r.id,kind);render();
 }catch(err){out.textContent=err.message;}finally{b.disabled=false;}
});
window.HCPlanning={load,action};
window.addEventListener('hc-session-fermee',()=>{++ticket;rows=[];records.clear();panel().textContent='';});
})();
