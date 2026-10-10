/* Intégration du plan dans la fiche de demande. Aucune mutation à l'ouverture. */
(function () {
  'use strict';
  let state=null,busy=false,generation=0,totalDevis=null;
  const esc=v=>escapeHtml(v==null?'':String(v));
  const display=v=>esc(String(v??'').replace(/(\d{4})-(\d{2})-(\d{2})/g,'$3/$2/$1'));
  const money=v=>v==null?'À définir':Number(v).toLocaleString('fr-FR',{style:'currency',currency:'EUR'});
  const modal=document.createElement('div');modal.id='modal-preparation-missions';modal.className='modal-overlay';
  modal.innerHTML='<div class="modal hc-prep-modal"><div class="hc-prep-head"><div><div id="hc-prep-ref" class="hc-prep-muted"></div><h3>Préparer les missions</h3></div><button type="button" class="btn btn-outline" id="hc-prep-close">Fermer</button></div><div id="hc-prep-message" role="status" aria-live="polite"></div><div id="hc-prep-body"></div></div>';
  document.body.append(modal);
  const el=id=>document.getElementById(id);
  window.addEventListener('hc-session-fermee',()=>{++generation;state=null;totalDevis=null;el('hc-prep-ref').textContent='';el('hc-prep-body').textContent='';closeModal('preparation-missions');});
  function note(t,error){el('hc-prep-message').textContent=t;el('hc-prep-message').className=error?'hc-note hc-note--erreur visible':'hc-note visible';el('hc-prep-message').style.display=t?'block':'none';}
  async function rpc(name,args){const r=await sbAuth.rpc(name,args);if(r.error)throw Error(r.error.message);if(!r.data)throw Error('Réponse indisponible');return r.data;}
  function adopt(source){
    const saved=source.brouillons||[],fresh=HCPreparation.preservePublished(HCPreparation.build(source.client,source.vehicules,source.point_remise),saved);
    const plans=fresh.map(p=>{const s=saved.find(x=>x.cle===p.key);
      if(!s||!(s.empreinte===source.empreinte||s.mission_id))return p;
      const result=Object.assign({},s.plan,{saved:s,remuneration:s.plan.remuneration});
      if(!s.mission_id&&p.category==='convoyage'){
        result.missing=p.missing;
        // Réactualise aussi les dates calculées d'un ancien brouillon.
        // Une heure saisie pour une autre journée doit être revalidée.
        for(const [dateKey,hourKey,label,missionKey] of [
          ['date_debut',p.kind==='apres_stockage'?'heure_retrait':'heure_prise_en_charge','Prise en charge','date_prise_en_charge'],
          ['date_fin','heure_remise','Livraison','date_livraison']
        ]){
          const internal=(label==='Prise en charge'&&p.kind==='apres_stockage')||(label==='Livraison'&&p.kind==='avant_stockage');
          if(internal&&result[dateKey]!==p[dateKey]){
            result[hourKey]='';result.mission=Object.assign({},result.mission,{[missionKey]:null});
            result.rows=result.rows.map(r=>r.label===label?p.rows.find(x=>x.label===label):r);
          }
          result[dateKey]=p[dateKey];
        }
        result.stockage=p.stockage;
        result.retrait_veille=p.retrait_veille;
        result.rows=result.rows.filter(r=>!['Garde du véhicule','Garde du véhicule récupéré'].includes(r.label)).concat(p.rows.filter(r=>['Garde du véhicule','Garde du véhicule récupéré'].includes(r.label)));
        for(const key of ['motorisation','restit_motorisation']){
          if(p[key]){result[key]=p[key];result.mission[key]=p[key];}
        }
        for(const [label,key] of [['Prise en charge','date_prise_en_charge'],['Livraison','date_livraison']]){
          if((label==='Prise en charge'&&p.kind!=='apres_stockage')||(label==='Livraison'&&p.kind!=='avant_stockage')){
            result.mission[key]=p.mission[key];const row=result.rows.find(r=>r.label===label);if(row)row.value=p.rows.find(r=>r.label===label).value;
          }
        }
      }
      return result;
    });
    saved.filter(s=>s.mission_id&&!plans.some(p=>p.key===s.cle)).forEach(s=>plans.push(Object.assign({},s.plan,{saved:s})));
    plans.forEach(p=>{
      if(p.category!=='convoyage')return;
      if(!p.saved?.mission_id)p.missing=[...new Set([...(p.missing||[]),...HCPreparation.missingVins(p.mission)])];
      const pickupKey=p.kind==='apres_stockage'?'heure_retrait':'heure_prise_en_charge';
      if(p[pickupKey]==null)p[pickupKey]=p.rows.find(r=>r.label==='Prise en charge')?.value?.match(/\d{1,2}:\d{2}/)?.[0]||'';
      if(p.kind==='avant_stockage'&&p.heure_remise==null)p.heure_remise=p.rows.find(r=>r.label==='Livraison')?.value?.match(/\d{1,2}:\d{2}/)?.[0]||'';
    });
    plans.forEach(p=>{if(p.retour_helixcar)p.missing=[...(p.missing||[]).filter(x=>!x.startsWith('Rendez-vous : ')),...HCPlanningCalcul.retourErrors(p,true).map(x=>'Rendez-vous : '+x)];});
    state={source,plans,preview:false};
  }
  window.ouvrirPreparationDemande=async function(clientId){
    if(busy)return;const ticket=++generation;busy=true;state=null;totalDevis=null;el('hc-prep-ref').textContent='';openModal('preparation-missions');el('hc-prep-body').textContent='Chargement des informations de la demande…';note('');
    try{const source=await rpc('source_preparation_missions',{p_client_id:clientId});if(ticket!==generation)return;
      // Lecture admin du devis exact ; le total reste hors des plans et annonces.
      let montant=null;
      try{const r=await sbAuth.from('devis').select('prix').eq('id',source.devis_id).eq('client_id',clientId).eq('statut','accepte').eq('paiement_statut','paye').maybeSingle();
        const value=r.data?.prix;if(!r.error&&value!=null&&String(value).trim()!==''&&Number.isFinite(Number(value))&&Number(value)>=0)montant=Number(value);
      }catch(_){}
      if(ticket!==generation)return;totalDevis=montant;adopt(source);render();}
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
      h+='<section class="hc-prep-leg" aria-label="Restitution"><header class="hc-prep-annonce-head"><h4>Restitution</h4></header>'+route(raw('Arrivée'),destination,null,raw('Restitution prévue'))+
        facts([['Modèle',returned.model],['Motorisation',raw('Motorisation restitution')],...(returned.type?[['Catégorie',returned.type]]:[]),['Transport',raw('Transport')]])+'</section>';
    }
    const shared=[['Distance de la mission',raw('Distance')],...(raw('Garde du véhicule')?[['Garde du véhicule',raw('Garde du véhicule')]]:[]),...(raw('Garde du véhicule récupéré')?[['Garde du véhicule récupéré',raw('Garde du véhicule récupéré')]]:[]),...(!raw('Restitution')?[['Restitution','Non']]:[])];
    return h+'</div><footer class="hc-prep-mission-footer">'+facts(shared)+'</footer></section>';
  }
  window.hcPreparationCarteOpportunite=function(o,options){
    let html=card(o.preparation_annonce);if(options?.partenaire){html+='<div id="opp-msg-'+esc(o.id)+'" class="hc-note" role="status"></div>';
      if(o.ma_candidature_etat==='retenu')html+='<button class="btn btn-outline" '+actionHtml('ouvrirDetailsPreparation',[o.mission_id])+'>Voir les détails de la mission</button>';
      if(o.ma_candidature_etat)html+='<p>Votre candidature : '+esc(_libEtatCandidature(o.ma_candidature_etat,window._currentConvoyeur))+'</p>';
      else if(o.statut==='a_pourvoir')html+='<button class="btn btn-primary" id="opp-postuler-'+esc(o.id)+'" '+actionHtml('postulerOpportunite',[o.id])+'>Postuler</button>';
    }return '<div class="hc-prep-public" data-opportunite="'+esc(o.id)+'">'+html+'</div>';
  };
  function input(p,i,key,label,type='number'){return '<label>'+label+'<input data-plan="'+i+'" data-field="'+key+'" type="'+type+'" '+(type==='number'?'min="0" step="'+(key==='distance'?'0.1':'0.01')+'"':'')+' value="'+esc(p[key]??'')+'"></label>';}
  function motor(p,i,key,label){
    const source=HCPreparation.build(state.source.client,state.source.vehicules,state.source.point_remise).find(x=>x.key===p.key);
    if(source?.[key])return '<div><span>'+esc(label)+'</span><p><strong>'+esc(p[key])+'</strong></p><small class="hc-prep-muted">Reprise de la demande</small></div>';
    return '<label>'+label+'<select data-plan="'+i+'" data-field="'+key+'">'+['','Essence','Diesel','Hybride','Hybride rechargeable','Électrique','Autre'].map(x=>'<option value="'+esc(x)+'"'+(p[key]===x?' selected':'')+'>'+esc(x||'À préciser')+'</option>').join('')+'</select></label>';}
  function vehicleRow(p,i,r){
    const key=r.label==='Véhicule'?'marque_modele':r.label==='Restitution'?'restit_marque_modele':null;
    if(!key)return '<div><dt>'+esc(r.label)+'</dt><dd>'+display(r.value)+'</dd></div>';
    return '<div><dt>'+esc(r.label)+'</dt><dd><span>'+display(r.value)+'</span> <button type="button" class="hc-prep-edit-vehicle" data-edit-vehicle="'+i+'" data-vehicle-key="'+key+'" aria-label="Modifier la marque et le modèle du véhicule'+(key==='restit_marque_modele'?' à restituer':'')+'" title="Modifier la marque et le modèle"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z"/></svg></button></dd></div>';
  }
  function render(){
    if(!state)return;el('hc-prep-ref').textContent=state.source.reference+' · Devis payé';
    let h='<div class="hc-prep-toolbar"><button type="button" class="btn '+(!state.preview?'btn-primary':'btn-outline')+'" data-prep-view="admin">Préparation admin</button><button type="button" class="btn '+(state.preview?'btn-primary':'btn-outline')+'" data-prep-view="preview">Aperçu partenaire</button></div>';
    if(!state.preview)h+='<aside class="hc-prep-budget" aria-label="Repère financier administrateur"><span>Montant total payé par le client</span><strong>'+esc(totalDevis===null?'Montant indisponible':money(totalDevis))+'</strong><small>Pour l’ensemble de la demande · Avant rémunération des partenaires et autres frais.</small></aside>';
    if(!state.plans.length)h+='<p>Aucun trajet à confier : dépôt et récupération par le client, ou véhicules à compléter dans la demande.</p>';
    state.plans.forEach((p,i)=>{
      const linked=p.saved?.mission_id;
      if(state.preview||linked){h+=card(p.saved?.annonce||HCPreparation.publicData(p));if(linked){h+='<p class="hc-prep-muted">Mission déjà créée</p>';if(!state.preview&&p.retour_helixcar)h+='<div class="hc-prep-internal"><p><strong>Réception — convoyeur → HelixCar :</strong> '+display(p.retour_reception?.replace('T',' · '))+'</p><p><strong>Remise — HelixCar → client :</strong> '+display(p.retour_remise?.replace('T',' · '))+'</p><p>Suivi des deux rendez-vous dans le planning HelixCar.</p></div>';}else {if(p.missing.length)h+='<p class="hc-prep-incomplete">Publication bloquée · À compléter dans la demande : '+esc(p.missing.join(' · '))+'</p>';h+='<button type="button" class="btn btn-primary" data-prep-publish="'+i+'"'+(p.missing.length?' disabled':'')+'>Publier cette mission</button>';}return;}
      h+='<section class="hc-prep-card"><div class="hc-prep-head"><div><small>'+esc(p.position?'Véhicule '+p.position:'Prestation')+'</small><h4>'+esc(p.title)+'</h4></div><span class="badge badge-pending">Brouillon</span></div>';
      if(p.category==='convoyage'&&p.kind!=='direct')h+='<p class="hc-prep-step">'+(p.kind==='avant_stockage'?'Trajet 1 · remise à HelixCar':'Trajet 2 · départ du point HelixCar')+'</p>';
      h+='<dl class="hc-prep-facts">'+p.rows.map(r=>vehicleRow(p,i,r)).join('')+'</dl>';
      if(p.category==='convoyage'&&p.kind==='direct')h+='<p class="hc-prep-muted">Horaires repris de la demande client.</p>';
      if(p.stockage)h+='<p class="hc-prep-internal">Organisation interne · stockage HelixCar du '+display(p.stockage)+' (absent de l’annonce partenaire)</p>';
      h+='<div class="hc-prep-fields">'+input(p,i,'remuneration','Prix total de la mission (€)');
      if(p.category==='convoyage'){h+=input(p,i,'distance','Distance du trajet (km)')+motor(p,i,'motorisation','Motorisation');if(p.mission.restitution)h+=motor(p,i,'restit_motorisation','Motorisation restitution');
        if(p.kind==='avant_stockage')h+=input(p,i,'heure_remise','Heure de réception par vous chez HelixCar','time');
        if(p.kind==='apres_stockage')h+=input(p,i,'heure_retrait','Heure de remise au convoyeur la veille','time');}
      h+='</div>';
      if(p.retour_helixcar){
        const d=p.retour_helixcar.demande;
        h+='<section class="hc-prep-internal"><h4>Retour du véhicule récupéré chez HelixCar</h4><p><strong>'+esc(p.mission.restit_marque_modele||'Véhicule à récupérer')+' · '+esc(p.mission.restit_immatriculation||'Immatriculation à compléter')+'</strong></p><p>'+esc(HCPlanningCalcul.POINT)+'</p><div class="hc-prep-fields">'+input(p,i,'retour_reception','1. Réception — convoyeur → HelixCar','datetime-local')+input(p,i,'retour_remise','2. Remise — HelixCar → client','datetime-local')+'</div><p>Retour du convoyeur : livraison du premier véhicule + durée du trajet retour vérifiée par vous + 45 minutes de battement.</p><p><strong>Récupération souhaitée par le client :</strong> '+display(HCPlanningCalcul.retourDemande(p))+'</p><p>Personne attendue : '+esc(d.contact||[state.source.client.prenom,state.source.client.nom].filter(Boolean).join(' ')||'Client')+' · '+esc(d.telephone||state.source.client.telephone||'Téléphone à compléter')+'</p><p>Ces deux rendez-vous seront suivis séparément dans votre planning. Seul le retour du convoyeur figure dans l’annonce partenaire.</p></section>';
      }
      if(p.kind==='avant_stockage'||p.kind==='apres_stockage'){
        const guide=HCPlanningCalcul.guidance(p);
        h+='<div class="hc-planning-estimate"><p><strong>'+esc(guide.label)+' :</strong> '+display(guide.when)+'</p><p>'+esc(guide.address)+'</p><p><strong>'+esc(guide.target)+'</strong></p><p>'+esc(HCPlanningCalcul.POINT)+'</p><p><strong>Prévoir 45 minutes de battement.</strong> '+esc(guide.rule)+'</p></div>';
      }
      if(p.missing.length)h+='<p class="hc-prep-incomplete">À compléter dans la demande : '+esc(p.missing.join(' · '))+'</p>';
      const privateLabels={adresse_depart:'Adresse de prise en charge',adresse_arrivee:'Adresse de livraison',contact_depart_nom:'Contact au départ',contact_depart_tel:'Téléphone au départ',contact_arrivee_nom:'Contact à l’arrivée',contact_arrivee_tel:'Téléphone à l’arrivée',immatriculation:'Immatriculation du véhicule',vin:'VIN du véhicule livré',consignes:'Consignes',adresse_restitution:'Adresse de restitution',restit_contact_nom:'Contact à la restitution',restit_contact_tel:'Téléphone à la restitution',restit_immatriculation:'Immatriculation du véhicule à restituer',restit_vin:'VIN du véhicule à restituer',restit_info:'Consignes de restitution'};
      h+='<details class="hc-prep-private"><summary>Informations privées de la mission</summary><p class="hc-prep-muted">Réservées à l’administration ; communiquées au partenaire retenu après attribution.</p><dl class="hc-prep-facts">'+Object.entries(privateLabels).filter(([k])=>p.mission[k]||(p.category==='convoyage'&&(k==='vin'||(k==='restit_vin'&&p.mission.restitution)))).map(([k,label])=>'<div><dt>'+esc(label)+'</dt><dd>'+esc(p.mission[k]||'À compléter dans la demande')+'</dd></div>').join('')+'</dl></details></section>';
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
  });
    state.plans.forEach(p=>{
      if(!p.retour_helixcar)return;
      p.mission.date_restitution_depart=p.retour_reception||null;
      const row=p.rows.find(r=>r.label==='Restitution prévue');if(row)row.value=p.retour_reception?p.retour_reception.replace('T',' · '):'Réception chez HelixCar à fixer';
      p.missing=[...(p.missing||[]).filter(x=>!x.startsWith('Rendez-vous : ')),...HCPlanningCalcul.retourErrors(p,true).map(x=>'Rendez-vous : '+x)];
    });
  }
  async function save(){readEdits();const errors=state.plans.flatMap(p=>HCPlanningCalcul.retourErrors(p,false));if(errors.length)throw Error(errors.join(' · '));const data=await rpc('enregistrer_preparation_missions',{p_client_id:state.source.client.id,p_empreinte:state.source.empreinte,p_plans:state.plans.map(p=>{const copy=Object.assign({},p);delete copy.saved;copy.public=HCPreparation.publicData(p);return copy;})});adopt(data);}
  modal.addEventListener('click',async e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.id==='hc-prep-close'){if(busy)return;++generation;closeModal('preparation-missions');return;}
    if(busy||!state)return;busy=true;b.disabled=true;
    try{
      if(b.hasAttribute('data-edit-vehicle')){
        readEdits();const i=Number(b.dataset.editVehicle),key=b.dataset.vehicleKey,p=state.plans[i];
        if(!p||p.saved?.mission_id||!['marque_modele','restit_marque_modele'].includes(key))return;
        const box=document.createElement('div');box.className='hc-prep-vehicle-editor';
        box.innerHTML='<label>Marque et modèle<input type="text" maxlength="160" data-vehicle-value value="'+esc(p.mission[key]||'')+'"></label><button type="button" class="btn btn-outline" data-cancel-vehicle>Annuler</button><button type="button" class="btn btn-primary" data-save-vehicle="'+i+'" data-vehicle-key="'+key+'">Enregistrer</button>';
        modal.querySelectorAll('.hc-prep-vehicle-editor').forEach(x=>x.remove());b.closest('dd').append(box);box.querySelector('input').focus();
      }
      if(b.hasAttribute('data-cancel-vehicle'))b.closest('.hc-prep-vehicle-editor').remove();
      if(b.hasAttribute('data-save-vehicle')){
        const p=state.plans[Number(b.dataset.saveVehicle)],key=b.dataset.vehicleKey;
        if(!p||p.saved?.mission_id||!['marque_modele','restit_marque_modele'].includes(key))return;
        const value=b.closest('.hc-prep-vehicle-editor').querySelector('input').value.trim();
        if(!value||value.length>160)throw Error('Renseignez la marque et le modèle du véhicule (160 caractères maximum).');
        readEdits();
        state.plans.filter(x=>!x.saved?.mission_id&&String(x.key).split(':')[0]===String(p.key).split(':')[0]).forEach(x=>{
          const label=key==='marque_modele'?'Véhicule':'Restitution',r=x.rows.find(r=>r.label===label);if(!r)return;
          const previous=x.mission[key]||'',prefix=previous&&r.value.endsWith(previous)?r.value.slice(0,-previous.length):'';
          x.mission[key]=value;r.value=prefix+value;
        });
        await save();render();note('Marque et modèle corrigés dans les missions en préparation.');
      }
      if(b.hasAttribute('data-prep-save')){await save();render();note('Brouillon enregistré. Rien n’est publié.');}
      if(b.dataset.prepView==='admin'){state.preview=false;render();note('');}
      if(b.dataset.prepView==='preview'){await save();state.preview=true;render();note('');}
      if(b.hasAttribute('data-prep-publish')){
        const p=state.plans[Number(b.dataset.prepPublish)];if(!p.saved)throw Error('Enregistrez le brouillon avant publication.');
        if(p.missing.length)throw Error('Publication bloquée : '+p.missing.join(' · '));
        if(!confirm('Publier cette mission au prix total de '+money(p.remuneration)+' auprès des partenaires éligibles ?'))return;
        await rpc('publier_preparation_mission',{p_id:p.saved.id});
        adopt(await rpc('source_preparation_missions',{p_client_id:state.source.client.id}));state.preview=true;render();note('Mission publiée dans les opportunités partenaires.');
        await loadOpportunitesAdmin();
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
