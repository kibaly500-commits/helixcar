/* Espace opérationnel unique. La file de préparation est une projection en lecture :
   aucun dossier, mission ou publication n'est créé lors de son affichage. */
(function(root){
 'use strict';
 function etape(m,o,archivee){
  if(['terminee','annulee'].includes(m.statut))return 'historique';
  // Une réalisation déclarée doit rester à vérifier, même après sa date de fin.
  if(['en_cours','fini'].includes(m.statut))return 'encours';
  if(archivee)return 'historique';
  if(m.convoyeur_id&&m.statut==='acceptee')return 'avenir';
  if(o?.publiee_le&&o.statut==='a_pourvoir'||m.statut==='proposee')return 'attribuer';
  return 'preparer';
 }
 function datesCiviles(m,fin){const copy={...m};for(const k of ['date_livraison','date_restitution_depart','date_restitution_arrivee','heure_intervention','heure_debut_intervention','heure_fin_intervention'])if(typeof copy[k]==='string')copy[k]=copy[k].replace(/(\d{2}:\d{2}:\d{2})\.\d+/g,'$1');if(!copy.date_livraison&&fin)copy.date_livraison=fin;return copy;}
 const api={etape,datesCiviles};
 if(typeof module==='object'&&module.exports){module.exports=api;return;}
 const esc=v=>escapeHtml(String(v??'')),el=id=>document.getElementById(id);
 const steps=[['preparer','À préparer'],['attribuer','À attribuer'],['avenir','À venir'],['encours','En cours'],['historique','Historique']];
 let items=[],sources=new Map(),generation=0,step='preparer',client=null,reading=null,readingPage=null;
 const page=document.createElement('div');page.id='page-admin-operations';page.className='page';
 page.innerHTML='<div class="hm-intro"><div><h2>Vos missions, étape par étape</h2><p>Préparez, publiez et suivez chaque prestation au même endroit.</p></div><button class="btn btn-outline" data-hm-create>Nouvelle demande</button></div><div class="hm-tabs" role="tablist" aria-label="Étapes des missions"></div><div class="hm-filters"><label>Prestation<select id="hm-type"><option value="">Toutes les prestations</option><option value="convoyage">Convoyage</option><option value="nettoyage">Nettoyage</option><option value="professionnel">Renfort professionnel</option><option value="stockage">Stockage</option></select></label><label>Rechercher<input type="search" id="hm-search" placeholder="Référence, client, partenaire…"></label><label id="hm-diffusion-label" hidden>Diffusion<select id="hm-diffusion"><option value="">Toutes</option><option value="publiee">Publiées</option><option value="directe">Propositions existantes</option></select></label><button class="btn btn-outline" id="hm-clear" hidden>Tout afficher</button></div><p id="hm-status" role="status"></p><div id="hm-list"></div>';
 el('page-admin-missions').before(page);
 const detail=document.createElement('div');detail.id='modal-mission-gestion';detail.className='modal-overlay';detail.innerHTML='<div class="modal hm-modal"><div class="hm-intro"><h3 id="hm-detail-title">Mission</h3><button class="btn btn-outline" data-hm-close>Fermer</button></div><div id="hm-detail"></div></div>';document.body.append(detail);
 detail.querySelector('[data-hm-close]').onclick=()=>{closeModal('mission-gestion');chargerMissionsUnifiees();};
 el('hm-detail').addEventListener('click',e=>{if(e.target.closest('button'))closeModal('mission-gestion');},true);
 const name=c=>[c?.prenom,c?.nom].filter(Boolean).join(' ')||c?.societe||'—';
 const date=m=>m.date_prise_en_charge||m.date_intervention||'';
 const money=v=>v==null?'À définir':Number(v).toLocaleString('fr-FR',{style:'currency',currency:'EUR'});
 function render(){
  const q=el('hm-search').value.trim().toLocaleLowerCase('fr'),type=el('hm-type').value;
  const base=items.filter(x=>(!client||x.clientId===client)&&(!type||x.type===type)&&(!q||x.search.includes(q)));
  page.querySelector('.hm-tabs').innerHTML=steps.map(([k,t])=>'<button type="button" role="tab" aria-selected="'+(step===k)+'" data-hm-step="'+k+'" class="hm-tab hm-'+k+'">'+t+' <span>'+base.filter(x=>x.step===k).length+'</span></button>').join('');
  el('hm-diffusion-label').hidden=step!=='attribuer';el('hm-clear').hidden=!client;
  const diffusion=el('hm-diffusion').value;
  const selected=base.filter(x=>x.step===step&&(step!=='attribuer'||!diffusion||(diffusion==='publiee'?!!x.opp?.publiee_le:!x.opp?.publiee_le)));
  el('hm-list').innerHTML=selected.length?'<div class="hm-grid">'+selected.map(x=>{
   const state=x.virtual?'Paiement confirmé · dossier validé':x.m.statut==='fini'?'Réalisation à valider':x.step==='attribuer'?(x.opp?.publiee_le?'Offre publiée · '+Number(x.opp.nb_a_etudier||0)+' candidature(s) à examiner':'Proposition en attente'):x.step==='preparer'?'Préparation à finaliser':LIB_STATUT_MISSION[x.m.statut]||x.m.statut;
   const action=x.virtual?(x.step==='historique'||x.stockage?'Dossier':'Préparer'):x.step==='attribuer'&&x.opp?'Candidatures':'Voir';
   return '<article class="hm-card hm-'+x.step+'"><div class="hm-card-head"><strong>'+esc(x.ref)+'</strong><span class="hm-chip">'+esc(x.label)+'</span></div><h3>'+esc(x.title)+'</h3>'+(x.vehicle?'<p class="hm-vehicle">'+esc(x.vehicle)+'</p>':'')+'<dl><div><dt>Prévu</dt><dd>'+esc(x.when?_dvHoraireMission(x.when)+(x.end&&String(x.end).slice(0,10)!==String(x.when).slice(0,10)?' → '+_dvHoraireMission(x.end):''):'À préciser')+'</dd></div><div><dt>Client</dt><dd>'+esc(x.customer)+'</dd></div><div><dt>Partenaire</dt><dd>'+esc(x.partner||'À attribuer')+'</dd></div><div><dt>Rémunération</dt><dd>'+esc(money(x.amount))+'</dd></div></dl><p class="hm-state">'+esc(state)+'</p><div class="hm-card-actions"><button class="btn btn-primary" data-hm-open="'+esc(x.key)+'">'+action+'</button><button class="btn btn-outline" data-hm-dossier="'+esc(x.clientId)+'">Dossier</button></div></article>';
  }).join('')+'</div>':'<div class="hm-empty">Aucune mission dans cette rubrique'+(q||type||client?' avec ces filtres':'')+'.</div>';
 }
 async function read(){
  if(currentRole!=='admin')return;
  const ticket=++generation,cycle=window.HCSync?.capture();
  el('hm-status').textContent='Actualisation du suivi…';
  const valid=()=>ticket===generation&&currentRole==='admin'&&(!cycle||window.HCSync.safe(cycle));
  try{
   const [missions,opps,customers,partners,quotes]=await Promise.all([
    sbFetchToutePage('missions?order=created_at.desc'),sbFetchToutePage('v_opportunites_admin?order=created_at.desc'),sbFetchToutePage('clients?order=created_at.desc'),sbFetchToutePage('convoyeurs?select=id,prenom,nom'),sbAuthListeDevisTriee()
   ]);
   if(!valid())return;
   const cm=new Map(customers.map(c=>[c.id,c])),pm=new Map(partners.map(p=>[p.id,p])),om=new Map();
   for(const o of opps)if(!om.has(o.mission_id))om.set(o.mission_id,o);
   const result=missions.map(m=>{
    const o=om.get(m.id),type=m.type_mission||'convoyage',c=cm.get(m.client_id),p=pm.get(m.convoyeur_id);
    return {key:m.id,m,opp:o,step:etape(m,o,missionArchivee(datesCiviles(m))),type,clientId:m.client_id,ref:referenceMission(m),vehicle:[m.marque_modele,m.immatriculation].filter(Boolean).join(' · '),label:type==='professionnel'?'Renfort professionnel':type==='nettoyage'?'Nettoyage':'Convoyage',title:missionSurPlace(m)?m.prestation||m.ville_intervention||'Intervention':[m.ville_depart,m.ville_arrivee].filter(Boolean).join(' → '),when:date(m),end:m.date_fin_intervention||m.date_livraison,customer:name(c),partner:p?name(p):'',amount:m.remuneration_prevue,search:[referenceMission(m),c?.numero_client,name(c),name(p),m.marque_modele,m.immatriculation,m.ville_depart,m.ville_arrivee].join(' ').toLocaleLowerCase('fr')};
   });
   const latest=new Map();for(const d of quotes)if(!latest.has(d.client_id)||String(d.date_generation)>String(latest.get(d.client_id).date_generation))latest.set(d.client_id,d);
   const paid=customers.filter(c=>latest.get(c.id)?.statut==='accepte'&&latest.get(c.id)?.paiement_statut==='paye');
   const nextSources=new Map();let unavailable=0;
   for(let i=0;i<paid.length;i+=4){
    await Promise.all(paid.slice(i,i+4).map(async c=>{
     const r=await sbAuth.rpc('source_preparation_missions',{p_client_id:c.id});
     if(r.error){if(!/Dossier incomplet|informations|date.*dépass|paiement confirmé/i.test(r.error.message||''))unavailable++;return;}
     if(!r.data?.client)return;
     const source=r.data,saved=source.brouillons||[],exceptions={};saved.forEach(s=>{if(s.plan?.organisation)exceptions[s.plan.vehicule_id||'principal']=s.plan.organisation;});
     const plans=HCPreparation.preservePublished(HCPreparation.build(source.client,source.vehicules,source.point_remise,exceptions),saved);
     // Les anciens dossiers déjà transformés sans plan conservent leurs missions.
     const legacy=missions.some(m=>m.client_id===c.id&&!m.preparation_id);
     nextSources.set(c.id,{source,plans});
     if(legacy)return;
     if(!plans.length&&source.client.type_service==='stockage'){
      const m={type_mission:'stockage',date_livraison:source.client.stockage_date_fin};
      result.push({key:'stockage:'+c.id,virtual:true,stockage:true,m,step:missionArchivee(m)?'historique':'preparer',clientId:c.id,type:'stockage',ref:c.numero_client||source.reference,label:'Stockage',title:'Stockage sans transport · suivi interne',when:source.client.stockage_date_debut,customer:name(c),partner:'Gestion HelixCar',amount:null,search:[c.numero_client,name(c),'stockage'].join(' ').toLocaleLowerCase('fr')});
     }
     for(const p of plans){
      if(saved.some(s=>s.cle===p.key&&s.mission_id))continue;
      const existing=saved.find(s=>s.cle===p.key),m=p.mission||{},expired=missionArchivee(datesCiviles(m,p.date_fin));
      const type=m.type_mission||'convoyage';
      result.push({key:'plan:'+c.id+':'+p.key,virtual:true,m,step:expired?'historique':'preparer',clientId:c.id,type,ref:(c.numero_client||source.reference)+(p.position?' · Véhicule '+p.position:''),vehicle:[m.marque_modele,m.immatriculation].filter(Boolean).join(' · '),label:type==='professionnel'?'Renfort professionnel':type==='nettoyage'?'Nettoyage':'Convoyage',title:p.zone||p.title,when:p.date_debut,end:p.date_fin,customer:name(c),partner:'',amount:existing?.plan?.remuneration,search:[c.numero_client,source.reference,name(c),p.title,p.zone,m.marque_modele,m.immatriculation].join(' ').toLocaleLowerCase('fr')});
     }
    }));
    if(!valid())return;
   }
   items=result.sort((a,b)=>String(a.when||'9999').localeCompare(String(b.when||'9999')));sources=nextSources;
   el('hm-status').textContent=unavailable?unavailable+' dossier(s) n’ont pas pu être vérifiés. Actualisez pour réessayer.':'';
   if(client&&!items.some(x=>x.clientId===client&&x.step===step))step=items.find(x=>x.clientId===client)?.step||'preparer';
   render();afficherCompteurMenu('admin-operations',items.filter(x=>x.step!=='historique').length,'missions à suivre');
   if(typeof filtrerDemandesDevis==='function')filtrerDemandesDevis(el('recherche-devis')?.value||'');
   priorities();
  }catch(e){if(valid())el('hm-status').textContent='Chargement incomplet. Les dernières données restent affichées. Utilisez Actualiser.';}
 }
 window.chargerMissionsUnifiees=function(){const active=document.querySelector('.page.active')?.id;if(reading)return active===readingPage?reading:reading.then(()=>chargerMissionsUnifiees());readingPage=active;reading=read().finally(()=>reading=null);return reading;};
 function priorities(){
  let box=el('hm-priorites');if(!box){box=document.createElement('div');box.id='hm-priorites';box.className='card';el('page-admin-dashboard').prepend(box);}
  box.innerHTML='<div class="card-header"><h3>À traiter · Missions</h3></div><div class="hm-priorites">'+[['preparer','À préparer'],['attribuer','À attribuer'],['encours','Réalisations à valider']].map(([k,t])=>{const count=items.filter(x=>k==='encours'?x.m.statut==='fini':x.step===k).length;return '<button class="btn btn-outline" data-hm-priority="'+k+'">'+t+' <strong>'+count+'</strong></button>';}).join('')+'</div>';
 }
 async function dossier(id){
  await loadDemandesDevis(true);if(currentRole==='admin')ouvrirFicheDemande(id);
 }
 async function manage(x){
  openModal('mission-gestion');el('hm-detail-title').textContent=x.ref;el('hm-detail').textContent='Chargement…';
  const type=missionSurPlace(x.m)?'autres':'convoyage';
  const old={...filtresMissionsAdmin[type]};
  filtresMissionsAdmin[type]={archives:missionArchivee(x.m),recherche:x.ref};
  try{
   await loadMissions();if(currentRole!=='admin'||!detail.classList.contains('open'))return;
   const row=document.querySelector('[data-gestion-mission="'+CSS.escape(x.m.id)+'"]');
   if(!row)throw Error('Mission indisponible');
   const heads=Array.from(row.closest('table').querySelectorAll('thead th')).map(h=>h.textContent);
   el('hm-detail').innerHTML='<dl class="hm-detail-grid">'+Array.from(row.cells).map((cell,i)=>'<div><dt>'+esc(heads[i])+'</dt><dd>'+cell.innerHTML+'</dd></div>').join('')+'</dl>';
   el('hm-detail').querySelectorAll('button').forEach(b=>{const labels={'✅ Confirmer la mission':'Valider','✅ Valider la prestation':'Valider','✅ Valider pour paiement':'Valider le paiement','✅ Terminer':'Terminer','✗ Annuler':'Annuler','📣 Opportunité':'Offre','Contrôler le dossier':'Dossier','Voir les détails':'Détails','Confirmer la réalisation':'Valider'};const t=b.textContent.trim();if(labels[t])b.textContent=labels[t];});
  }catch(e){el('hm-detail').textContent='Impossible de charger la mission. Fermez puis réessayez.';}
  finally{filtresMissionsAdmin[type]=old;}
 }
 page.addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.hmStep){step=b.dataset.hmStep;render();return;}
  if(b.hasAttribute('data-hm-create')){openNewMission();return;}
  if(b.id==='hm-clear'){client=null;render();return;}
  if(b.dataset.hmDossier){await dossier(b.dataset.hmDossier);return;}
  const x=items.find(x=>x.key===b.dataset.hmOpen);if(!x)return;
  if(x.virtual){if(x.step==='historique'||x.stockage)await dossier(x.clientId);else await ouvrirPreparationDemande(x.clientId);}
  else if(x.step==='attribuer'&&x.opp)await ouvrirOpportuniteAdmin(x.opp.id);
  else await manage(x);
 });
 ['hm-type','hm-diffusion'].forEach(id=>el(id).addEventListener('change',render));el('hm-search').addEventListener('input',render);
 document.addEventListener('click',e=>{const b=e.target.closest('[data-hm-priority]');if(b){step=b.dataset.hmPriority;client=null;showPage('admin-operations');}});
 window.HCMissions={...api,link(id){return sources.has(String(id))||items.some(x=>x.clientId===String(id));},open(id){client=id||null;step='preparer';el('hm-search').value='';el('hm-type').value='';el('hm-diffusion').value='';showPage('admin-operations');},badge(id){return this.link(id)?'<span class="hm-transfer">Transmis aux missions</span><button class="btn btn-sm btn-outline" '+actionHtml('voirMissionsDemande',[id])+'>Voir les missions</button>':'';}};
 HC_ACTIONS.voirMissionsDemande=id=>window.HCMissions.open(id);
 window.addEventListener('hc-session-fermee',()=>{generation++;items=[];sources.clear();client=null;step='preparer';el('hm-list').replaceChildren();el('hm-detail').replaceChildren();el('hm-priorites')?.remove();});
 const suivi=document.createElement('select');suivi.id='hm-devis-suivi';suivi.setAttribute('aria-label','Suivi des dossiers');suivi.innerHTML='<option value="a_traiter">À traiter</option><option value="transmis">Transmis aux missions</option><option value="">Tous les dossiers</option>';el('recherche-devis').after(suivi);suivi.addEventListener('change',()=>filtrerDemandesDevis(el('recherche-devis').value));
 for(const id of ['admin-missions','admin-autres-missions','admin-opportunites']){const back=document.createElement('button');back.className='btn btn-outline hm-return';back.textContent='← Missions';back.onclick=()=>showPage('admin-operations');el('page-'+id).prepend(back);}
 render();
})(typeof window!=='undefined'?window:globalThis);
