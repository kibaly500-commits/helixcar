/* Intégration du plan dans la fiche de demande. Aucune mutation à l'ouverture. */
(function () {
  'use strict';
  let state=null,busy=false,generation=0;
  const esc=v=>escapeHtml(v==null?'':String(v));
  const display=v=>esc(String(v??'').replace(/(\d{4})-(\d{2})-(\d{2})/g,'$3/$2/$1'));
  const money=v=>v==null?'À définir':Number(v).toLocaleString('fr-FR',{style:'currency',currency:'EUR'});
  const modal=document.createElement('div');modal.id='modal-preparation-missions';modal.className='modal-overlay';
  modal.innerHTML='<div class="modal hc-prep-modal"><div class="hc-prep-head"><div><div id="hc-prep-ref" class="hc-prep-muted"></div><h3>Préparer les missions</h3></div><button type="button" class="btn btn-outline" id="hc-prep-close">Fermer</button></div><div id="hc-prep-message" role="status" aria-live="polite"></div><div id="hc-prep-body"></div></div>';
  document.body.append(modal);
  const el=id=>document.getElementById(id);
  function note(t,error){el('hc-prep-message').textContent=t;el('hc-prep-message').className=error?'hc-note hc-note--erreur visible':'hc-note visible';el('hc-prep-message').style.display=t?'block':'none';}
  async function rpc(name,args){const r=await sbAuth.rpc(name,args);if(r.error)throw Error(r.error.message);if(!r.data)throw Error('Réponse indisponible');return r.data;}
  function adopt(source){
    const fresh=HCPreparation.build(source.client,source.vehicules,source.point_remise),saved=source.brouillons||[];
    const plans=fresh.map(p=>{const s=saved.find(x=>x.cle===p.key);return s&&(s.empreinte===source.empreinte||s.mission_id)?Object.assign({},s.plan,{saved:s,remuneration:s.plan.remuneration}):p;});
    saved.filter(s=>s.mission_id&&!plans.some(p=>p.key===s.cle)).forEach(s=>plans.push(Object.assign({},s.plan,{saved:s})));
    plans.forEach(p=>{
      if(p.category!=='convoyage')return;
      const pickupKey=p.kind==='apres_stockage'?'heure_retrait':'heure_prise_en_charge';
      if(p[pickupKey]==null)p[pickupKey]=p.rows.find(r=>r.label==='Prise en charge')?.value?.match(/\d{1,2}:\d{2}/)?.[0]||'';
      if(p.kind==='avant_stockage'&&p.heure_remise==null)p.heure_remise=p.rows.find(r=>r.label==='Livraison')?.value?.match(/\d{1,2}:\d{2}/)?.[0]||'';
    });
    state={source,plans,preview:false};
  }
  window.ouvrirPreparationDemande=async function(clientId){
    if(busy)return;const ticket=++generation;busy=true;openModal('preparation-missions');el('hc-prep-body').textContent='Chargement des informations de la demande…';note('');
    try{const source=await rpc('source_preparation_missions',{p_client_id:clientId});if(ticket!==generation)return;adopt(source);render();}
    catch(e){if(ticket===generation){el('hc-prep-body').textContent='';note(e.message,true);}}
    finally{busy=false;}
  };
  function card(a){
    const rows=a.rows||[],raw=label=>String(rows.find(r=>r.label===label)?.value||'');
    const facts=items=>'<dl class="hc-prep-leg-facts">'+items.map(([label,value])=>'<div><dt>'+esc(label)+'</dt><dd>'+display(value||'À préciser')+'</dd></div>').join('')+'</dl>';
    const schedule=value=>{
      const date=value.match(/\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4}/)?.[0];
      const hours=value.match(/\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?/)?.[0];
      return '<span class="hc-prep-date">'+display(date||'Date à préciser')+'</span><strong class="hc-prep-time'+(hours?'':' hc-prep-unspecified')+'">'+esc(hours||'Heure à préciser')+'</strong>';
    };
    const vehicle=value=>{const parts=value.split(' · ');return {model:parts.length>1?parts.slice(1).join(' · '):value,type:parts.length>1?parts[0]:''};};
    const route=(from,to,start,end)=>'<div class="hc-prep-route"><div><span class="hc-prep-route-label">Départ</span><strong class="hc-prep-city">'+display(from||'Ville à préciser')+'</strong>'+(start!==null?schedule(start):'')+'</div><span class="hc-prep-direction" aria-hidden="true">→</span><div><span class="hc-prep-route-label">Arrivée</span><strong class="hc-prep-city">'+display(to||'Ville à préciser')+'</strong>'+(end!==null?schedule(end):'')+'</div></div>';
    let h='<section class="hc-prep-card hc-prep-annonce"><div class="hc-prep-mission-summary"><strong>'+esc(a.category==='convoyage'?'Convoyage':a.title)+'</strong><div><span>Rémunération totale</span><strong class="hc-prep-price">'+esc(money(a.remuneration))+'</strong></div></div>';
    if(!rows.some(r=>r.label==='Départ'))return h+facts(rows.map(r=>[r.label,r.value]))+'</section>';
    const delivered=vehicle(raw('Véhicule'));
    h+='<div class="hc-prep-legs'+(raw('Restitution')?' hc-prep-legs--return':'')+'"><section class="hc-prep-leg" aria-label="Livraison"><header class="hc-prep-annonce-head"><h4>Livraison</h4></header>'+route(raw('Départ'),raw('Arrivée'),raw('Prise en charge'),raw('Livraison'))+
      facts([['Modèle',delivered.model],['Motorisation',raw('Motorisation')],...(delivered.type?[['Catégorie',delivered.type]]:[]),['Transport',raw('Transport')]])+'</section>';
    if(raw('Restitution')){
      const returned=vehicle(raw('Restitution')),returnRoute=raw('Trajet de restitution'),prefix=raw('Arrivée')+' · ';
      const destination=returnRoute.startsWith(prefix)?returnRoute.slice(prefix.length):returnRoute.includes(' · ')?returnRoute.split(' · ').slice(1).join(' · '):'';
      h+='<section class="hc-prep-leg" aria-label="Restitution"><header class="hc-prep-annonce-head"><h4>Restitution</h4></header>'+route(raw('Arrivée'),destination,null,null)+
        '<div class="hc-prep-return-schedule"><span>Restitution prévue</span><div>'+schedule(raw('Restitution prévue'))+'</div></div>'+
        facts([['Modèle',returned.model],['Motorisation',raw('Motorisation restitution')],...(returned.type?[['Catégorie',returned.type]]:[]),['Transport',raw('Transport')]])+'</section>';
    }
    const shared=[['Distance de la mission',raw('Distance')],...(raw('Garde du véhicule')?[['Garde du véhicule',raw('Garde du véhicule')]]:[]),...(!raw('Restitution')?[['Restitution','Non']]:[])];
    return h+'</div><footer class="hc-prep-mission-footer">'+facts(shared)+'</footer></section>';
  }
  window.hcPreparationCarteOpportunite=function(o,options){
    let html=card(o.preparation_annonce);if(options?.partenaire){html+='<div id="opp-msg-'+esc(o.id)+'" class="hc-note" role="status"></div>';
      if(o.ma_candidature_etat==='retenu')html+='<button class="btn btn-outline" '+actionHtml('ouvrirDetailsPreparation',[o.mission_id])+'>Voir les détails de la mission</button>';
      if(o.ma_candidature_etat)html+='<p>Votre candidature : '+esc(_libEtatCandidature(o.ma_candidature_etat,window._currentConvoyeur))+'</p>';
      else if(o.statut==='a_pourvoir')html+='<button class="btn btn-primary" id="opp-postuler-'+esc(o.id)+'" '+actionHtml('postulerOpportunite',[o.id])+'>Postuler</button>';
    }return '<div class="hc-prep-public" data-opportunite="'+esc(o.id)+'">'+html+'</div>';
  };
  function input(p,i,key,label,type='number'){return '<label>'+label+'<input data-plan="'+i+'" data-field="'+key+'" type="'+type+'" '+(type==='number'?'min="0" step="'+(key==='distance'?'1':'0.01')+'"':'')+' value="'+esc(p[key]??'')+'"></label>';}
  function motor(p,i,key,label){return '<label>'+label+'<select data-plan="'+i+'" data-field="'+key+'">'+['','Essence','Diesel','Hybride','Hybride rechargeable','Électrique','Autre'].map(x=>'<option value="'+esc(x)+'"'+(p[key]===x?' selected':'')+'>'+esc(x||'À préciser')+'</option>').join('')+'</select></label>';}
  function render(){
    if(!state)return;el('hc-prep-ref').textContent=state.source.reference+' · Devis payé';
    let h='<div class="hc-prep-toolbar"><button type="button" class="btn '+(!state.preview?'btn-primary':'btn-outline')+'" data-prep-view="admin">Préparation admin</button><button type="button" class="btn '+(state.preview?'btn-primary':'btn-outline')+'" data-prep-view="preview">Aperçu partenaire</button></div>';
    if(!state.plans.length)h+='<p>Aucun trajet à confier : dépôt et récupération par le client, ou véhicules à compléter dans la demande.</p>';
    state.plans.forEach((p,i)=>{
      const linked=p.saved?.mission_id;
      if(state.preview||linked){h+=card(p.saved?.annonce||HCPreparation.publicData(p));if(linked)h+='<p class="hc-prep-muted">Mission déjà créée</p>';else h+='<button type="button" class="btn btn-primary" data-prep-publish="'+i+'">Publier cette mission</button>';return;}
      h+='<section class="hc-prep-card"><div class="hc-prep-head"><div><small>'+esc(p.position?'Véhicule '+p.position:'Prestation')+'</small><h4>'+esc(p.title)+'</h4></div><span class="badge badge-pending">Brouillon</span></div>';
      if(p.category==='convoyage'&&p.kind!=='direct')h+='<p class="hc-prep-step">'+(p.kind==='avant_stockage'?'Trajet 1 · remise à HelixCar':'Trajet 2 · départ du point HelixCar')+'</p>';
      h+='<dl class="hc-prep-facts">'+p.rows.map(r=>'<div><dt>'+esc(r.label)+'</dt><dd>'+display(r.value)+'</dd></div>').join('')+'</dl>';
      if(p.stockage)h+='<p class="hc-prep-internal">Organisation interne · stockage HelixCar du '+display(p.stockage)+' (absent de l’annonce partenaire)</p>';
      h+='<div class="hc-prep-fields">'+input(p,i,'remuneration','Prix total de la mission (€)');
      if(p.category==='convoyage'){h+=input(p,i,'distance','Distance du trajet (km)')+motor(p,i,'motorisation','Motorisation');if(p.mission.restitution)h+=motor(p,i,'restit_motorisation','Motorisation restitution');
        if(p.kind!=='apres_stockage')h+=input(p,i,'heure_prise_en_charge','Heure de prise en charge','time');
        if(p.kind==='avant_stockage')h+=input(p,i,'heure_remise','Heure de remise au point HelixCar','time');
        if(p.kind==='apres_stockage')h+=input(p,i,'heure_retrait','Heure de prise en charge','time');}
      h+='</div>';
      if(p.missing.length)h+='<p class="hc-prep-incomplete">À compléter dans la demande : '+esc(p.missing.join(' · '))+'</p>';
      const privateLabels={adresse_depart:'Adresse de prise en charge',adresse_arrivee:'Adresse de livraison',contact_depart_nom:'Contact au départ',contact_depart_tel:'Téléphone au départ',contact_arrivee_nom:'Contact à l’arrivée',contact_arrivee_tel:'Téléphone à l’arrivée',immatriculation:'Immatriculation du véhicule',vin:'VIN du véhicule livré',consignes:'Consignes',adresse_restitution:'Adresse de restitution',restit_contact_nom:'Contact à la restitution',restit_contact_tel:'Téléphone à la restitution',restit_immatriculation:'Immatriculation du véhicule à restituer',restit_vin:'VIN du véhicule à restituer',restit_info:'Consignes de restitution'};
      h+='<details class="hc-prep-private"><summary>Informations privées de la mission</summary><p class="hc-prep-muted">Réservées à l’administration ; communiquées au partenaire retenu après attribution.</p><dl class="hc-prep-facts">'+Object.entries(privateLabels).filter(([k])=>p.mission[k]).map(([k,label])=>'<div><dt>'+esc(label)+'</dt><dd>'+esc(p.mission[k])+'</dd></div>').join('')+'</dl></details></section>';
    });
    if(!state.preview&&state.plans.some(p=>!p.saved?.mission_id))h+='<div class="hc-prep-toolbar"><button type="button" class="btn btn-outline" data-prep-save>Enregistrer le brouillon</button><button type="button" class="btn btn-primary" data-prep-view="preview">Voir l’aperçu partenaire</button></div>';
    el('hc-prep-body').innerHTML=h;
  }
  function readEdits(){modal.querySelectorAll('[data-field]').forEach(e=>{
    const p=state.plans[Number(e.dataset.plan)],key=e.dataset.field;
    const previous=p[key]??'';
    p[key]=e.type==='number'?(e.value===''?null:Number(e.value)):e.value;
    if(e.type==='time'&&e.value===previous)return;
    if(key==='heure_remise'){p.mission.date_livraison=HCPreparation.stamp(p.date_fin,e.value);p.rows.find(r=>r.label==='Livraison').value=[p.date_fin,e.value].filter(Boolean).join(' · ');}
    if(key==='heure_retrait'||key==='heure_prise_en_charge'){p.mission.date_prise_en_charge=HCPreparation.stamp(p.date_debut,e.value);p.rows.find(r=>r.label==='Prise en charge').value=[p.date_debut,e.value].filter(Boolean).join(' · ');}
  });}
  async function save(){readEdits();const data=await rpc('enregistrer_preparation_missions',{p_client_id:state.source.client.id,p_empreinte:state.source.empreinte,p_plans:state.plans.map(p=>{const copy=Object.assign({},p);delete copy.saved;copy.public=HCPreparation.publicData(p);return copy;})});adopt(data);}
  modal.addEventListener('click',async e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.id==='hc-prep-close'){if(busy)return;++generation;closeModal('preparation-missions');return;}
    if(busy||!state)return;busy=true;b.disabled=true;
    try{
      if(b.hasAttribute('data-prep-save')){await save();render();note('Brouillon enregistré. Rien n’est publié.');}
      if(b.dataset.prepView==='admin'){state.preview=false;render();note('');}
      if(b.dataset.prepView==='preview'){await save();state.preview=true;render();note('');}
      if(b.hasAttribute('data-prep-publish')){
        const p=state.plans[Number(b.dataset.prepPublish)];if(!p.saved)throw Error('Enregistrez le brouillon avant publication.');
        if(!confirm('Publier cette mission au prix total de '+money(p.remuneration)+' auprès des partenaires éligibles ?'))return;
        await rpc('publier_preparation_mission',{p_id:p.saved.id});
        adopt(await rpc('source_preparation_missions',{p_client_id:state.source.client.id}));state.preview=true;render();note('Mission publiée dans les opportunités partenaires.');
      }
    }catch(err){note(err.message,true);}finally{busy=false;b.disabled=false;}
  });
  const detail=document.createElement('div');detail.id='modal-preparation-detail';detail.className='modal-overlay';
  detail.innerHTML='<div class="modal hc-prep-modal"><div class="hc-prep-head"><h3>Détails de la mission</h3><button type="button" class="btn btn-outline">Fermer</button></div><div class="hc-prep-detail-body"></div></div>';
  document.body.append(detail);detail.querySelector('button').addEventListener('click',()=>closeModal('preparation-detail'));
  HC_ACTIONS.ouvrirDetailsPreparation=async function(id){
    openModal('preparation-detail');const body=detail.querySelector('.hc-prep-detail-body');body.textContent='Chargement…';
    const fields={reference:'Référence',adresse_depart:'Prise en charge',adresse_arrivee:'Livraison',contact_depart_nom:'Contact prise en charge',contact_depart_tel:'Téléphone prise en charge',contact_arrivee_nom:'Contact livraison',contact_arrivee_tel:'Téléphone livraison',immatriculation:'Immatriculation',vin:'VIN',motorisation:'Motorisation',restit_motorisation:'Motorisation restitution',consignes:'Consignes',adresse_restitution:'Restitution',restit_contact_nom:'Contact restitution',restit_contact_tel:'Téléphone restitution',restit_marque_modele:'Véhicule à restituer',restit_immatriculation:'Immatriculation restitution',restit_vin:'VIN restitution',restit_info:'Consignes de restitution',adresse_intervention:'Lieu d’intervention',code_postal_intervention:'Code postal',ville_intervention:'Ville',contact_nom:'Contact',contact_tel:'Téléphone'};
    try{const r=await sbAuth.from('missions').select(Object.keys(fields).join(',')).eq('id',id).maybeSingle();if(r.error)throw Error(r.error.message);if(!r.data)throw Error('Mission non accessible.');body.innerHTML='<dl class="hc-prep-facts">'+Object.entries(fields).filter(([k])=>r.data[k]).map(([k,label])=>'<div><dt>'+esc(label)+'</dt><dd>'+esc(r.data[k])+'</dd></div>').join('')+'</dl>';}
    catch(e){body.textContent=e.message;}
  };
  HC_ACTIONS.ouvrirPreparationDemande=window.ouvrirPreparationDemande;
})();
