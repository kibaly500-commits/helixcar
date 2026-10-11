/* Intégration du plan dans la fiche de demande. Aucune mutation à l'ouverture. */
(function () {
  'use strict';
  let state=null,busy=false,generation=0,totalDevis=null,autosaveTimer=null,editVersion=0;
  const autoDrafts=new Map();
  const pricingDrafts=new Map(); // Uniquement côté administrateur, jamais dans un plan Supabase.
  const esc=v=>escapeHtml(v==null?'':String(v));
  const display=v=>esc(String(v??'').replace(/(\d{4})-(\d{2})-(\d{2})/g,'$3/$2/$1'));
  const money=v=>v==null?'À définir':Number(v).toLocaleString('fr-FR',{style:'currency',currency:'EUR'});
  const modal=document.createElement('div');modal.id='modal-preparation-missions';modal.className='modal-overlay';
  modal.innerHTML='<div class="modal hc-prep-modal"><div class="hc-prep-head"><div><div id="hc-prep-ref" class="hc-prep-muted"></div><h3>Préparer les missions</h3></div><button type="button" class="btn btn-outline" id="hc-prep-close">Fermer</button></div><div id="hc-prep-message" role="status" aria-live="polite"></div><div id="hc-prep-body"></div></div>';
  document.body.append(modal);
  const el=id=>document.getElementById(id);
  window.addEventListener('hc-session-fermee',()=>{++generation;clearTimeout(autosaveTimer);autoDrafts.clear();pricingDrafts.clear();state=null;totalDevis=null;el('hc-prep-ref').textContent='';el('hc-prep-body').textContent='';closeModal('preparation-missions');});
  function note(t,error){el('hc-prep-message').textContent=t;el('hc-prep-message').className=error?'hc-note hc-note--erreur visible':'hc-note visible';el('hc-prep-message').style.display=t?'block':'none';}
  async function rpc(name,args){const r=await sbAuth.rpc(name,args);if(r.error)throw Error(r.error.message);if(!r.data)throw Error('Réponse indisponible');return r.data;}
  function stable(value){
    if(value==null||typeof value!=='object')return JSON.stringify(value);
    if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
    return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
  }
  const draftFields=['remuneration','distance','distance_aller','distance_basis','carburant_peages','motorisation','restit_motorisation','heure_remise','heure_retrait','heure_prise_en_charge','retour_reception','retour_remise'];
  function draftKey(source){const admin=window._currentAdmin;return admin?.id&&source?.client?.id?'hc-prep-draft:'+admin.id+':'+source.client.id+':'+source.devis_id:null;}
  function backup(){
    if(!state)return;const key=draftKey(state.source);if(!key)return;
    try{localStorage.setItem(key,JSON.stringify({fingerprint:state.source.empreinte,plans:state.plans.filter(p=>!p.saved?.mission_id).map(p=>({key:p.key,organisation:p.organisation,fields:Object.fromEntries(draftFields.filter(k=>p[k]!==undefined).map(k=>[k,p[k]]))}))}));}
    catch(_){note('La copie locale est indisponible. Attendez la confirmation de sauvegarde avant de quitter.',true);}
  }
  function restoreDraft(){
    const key=draftKey(state?.source);if(!key)return;
    try{const draft=JSON.parse(localStorage.getItem(key)||'null');if(!draft||draft.fingerprint!==state.source.empreinte)return;
      for(const p of state.plans){const old=draft.plans.find(x=>x.key===p.key&&stable(x.organisation)===stable(p.organisation));if(old&&!p.saved?.mission_id)for(const k of draftFields)if(Object.hasOwn(old.fields,k))p[k]=old.fields[k];}
    }catch(_){}
  }
  function queueSave(){
    clearTimeout(autosaveTimer);
    autosaveTimer=setTimeout(async()=>{
      if(!state||state.preview)return;
      if(busy){queueSave();return;}busy=true;
      try{await save(false);note('Brouillon enregistré automatiquement.');}
      catch(e){note('Saisie conservée sur cet appareil. Sauvegarde serveur à compléter : '+e.message,true);}
      finally{busy=false;}
    },800);
  }
  function adopt(source){
    const saved=source.brouillons||[],exceptions={};
    saved.forEach(s=>{if(s.empreinte===source.empreinte&&s.plan.organisation)exceptions[s.plan.vehicule_id||'principal']=s.plan.organisation;});
    const fresh=HCPreparation.preservePublished(HCPreparation.build(source.client,source.vehicules,source.point_remise,exceptions),saved);
    const plans=fresh.map(p=>{const s=saved.find(x=>x.cle===p.key);
      if(!s||!(s.empreinte===source.empreinte||s.mission_id))return p;
      if(!s.mission_id&&stable(s.plan.organisation)!==stable(p.organisation))return p;
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
      HCMissionBudget.useOutboundDistance(p);
      if(!p.saved?.mission_id)p.missing=[...new Set([...(p.missing||[]),...HCPreparation.missingVins(p.mission)])];
      const pickupKey=p.kind==='apres_stockage'?'heure_retrait':'heure_prise_en_charge';
      if(p[pickupKey]==null)p[pickupKey]=p.rows.find(r=>r.label==='Prise en charge')?.value?.match(/\d{1,2}:\d{2}/)?.[0]||'';
      if(p.kind==='avant_stockage'&&p.heure_remise==null)p.heure_remise=p.rows.find(r=>r.label==='Livraison')?.value?.match(/\d{1,2}:\d{2}/)?.[0]||'';
    });
    plans.forEach(p=>{if(p.retour_helixcar)p.missing=[...(p.missing||[]).filter(x=>!x.startsWith('Rendez-vous : ')),...HCPlanningCalcul.retourErrors(p,true).map(x=>'Rendez-vous : '+x)];});
    state={source,plans,preview:false};
  }
  window.ouvrirPreparationDemande=async function(clientId){
    if(busy)return;
    pricingDrafts.clear();autoDrafts.clear();const ticket=++generation;busy=true;state=null;totalDevis=null;el('hc-prep-ref').textContent='';openModal('preparation-missions');el('hc-prep-body').textContent='Chargement des informations de la demande…';note('');
    try{const source=await rpc('source_preparation_missions',{p_client_id:clientId});if(ticket!==generation)return;
      // Lecture admin du devis exact ; le total reste hors des plans et annonces.
      let montant=null;
      try{const r=await sbAuth.from('devis').select('prix').eq('id',source.devis_id).eq('client_id',clientId).eq('statut','accepte').eq('paiement_statut','paye').maybeSingle();
        const value=r.data?.prix;if(!r.error&&value!=null&&String(value).trim()!==''&&Number.isFinite(Number(value))&&Number(value)>=0)montant=Number(value);
      }catch(_){}
      if(ticket!==generation)return;totalDevis=montant;adopt(source);restoreDraft();render();
      if(state.plans.length&&state.plans.every(p=>p.category==='convoyage')&&state.plans.some(p=>!p.saved?.mission_id&&(!(Number(p.distance)>0)||(p.mission.restitution&&!(Number(p.distance_aller)>0)))))await calculateAll(ticket,true);
    }
    catch(e){if(ticket===generation){if(!state)el('hc-prep-body').textContent='';note(e.message,true);}}
    finally{busy=false;}
  };
  async function calculateAll(ticket=generation,automatic=false){
    state.plans.forEach(p=>HCMissionBudget.useOutboundDistance(p));
    readEdits();
    if(totalDevis==null)throw Error('Montant du devis payé indisponible.');
    if(state.plans.some(p=>p.category!=='convoyage'))throw Error('Répartition automatique réservée aux missions de convoyage.');
    const snapshot=state;
    const failures=[];
    for(const [i,p] of snapshot.plans.entries()){
      if(p.saved?.mission_id)continue;
      note('Calcul automatique : mission '+(i+1)+' sur '+snapshot.plans.length+'…');
      try{
        let minutes=null,source='Distance renseignée ou conservée';
        if(!(Number(p.distance)>0&&Number.isFinite(Number(p.distance)))||(p.mission.restitution&&!(Number(p.distance_aller)>0))){
          const session=(await sbAuth.auth.getSession()).data?.session;
          if(!session?.access_token)throw Error('Renseignez les kilomètres ou reconnectez-vous au calcul routier.');
          const response=await fetch('/api/route-gratuite',{method:'POST',headers:{Authorization:'Bearer '+session.access_token,apikey:SUPABASE_KEY,'Content-Type':'application/json'},body:JSON.stringify({clientId:snapshot.source.client.id,key:p.key,vehiculeId:p.vehicule_id,organisation:p.organisation})});
          const data=await response.json();
          if(ticket!==generation||state!==snapshot)return;
          if(!response.ok)throw Error('Kilomètres automatiques indisponibles. Saisissez la distance aller uniquement, puis relancez le calcul.');
          if(data.fingerprint!==snapshot.source.empreinte)throw Error('Demande modifiée : rechargez la préparation.');
          const routes=data.routes;
          if(!routes?.length||routes.some(r=>!Number.isFinite(r.km)||r.km<=0))throw Error('Distance indisponible');
          p.distance=HCMissionBudget.wholeKm(routes[0].km);p.distance_basis='outbound_v1';
          p.distance_aller=p.distance;
          minutes=routes[0].minutes;source=data.source;
        }
        const local=HCMissionBudget.local(p),custody=HCMissionBudget.guardPricing(p);
        autoDrafts.set(p.key,{...custody,distanceBasis:'outbound_v1',pricingPolicy:'rounded_v1',local,source,minutes,rate:local?0:0.22});
      }catch(e){failures.push('Mission '+(i+1)+' : '+e.message);}
    }
    if(ticket!==generation||state!==snapshot)return;
    render();
    if(failures.length){note('Calcul incomplet. '+failures.join(' · ')+'. Aucun prix existant remplacé.',true);return;}
    snapshot.plans.filter(p=>!p.saved?.mission_id).forEach(p=>Object.assign(autoDrafts.get(p.key),HCMissionBudget.travelPricing(p,snapshot.plans)));
    const items=snapshot.plans.map(p=>{
      if(p.saved?.mission_id||(automatic&&p.remuneration!=null&&p.remuneration!==''))return {key:p.key,locked:true,total:Number(p.remuneration)};
      const a=autoDrafts.get(p.key);return {key:p.key,fees:a.fees,guard:a.guard,extra:a.extra,weight:HCRemunerationEstimation.proposedLabor(a.outboundKm,a.local?'idf':'hors_idf')};
    });
    const result=HCMissionBudget.roundAllocation(HCMissionBudget.allocate(totalDevis,items),items);
    for(const r of result.missions){
      const p=snapshot.plans.find(p=>p.key===r.key);p.remuneration=r.total;
      p.carburant_peages=autoDrafts.get(p.key).local?null:r.fees;
      Object.assign(autoDrafts.get(p.key),{work:r.work,total:r.total,standardWork:r.standardWork,adjusted:r.adjusted});p.calcul_interne={...autoDrafts.get(p.key)};
    }
    render();note((result.adjusted?'Tarifs adaptés au budget client. ':'')+'Proposition calculée : '+money(result.spent)+' pour les missions ; '+money(result.remaining)+' conservés par HelixCar avant ses autres frais. Vérifiez puis enregistrez le brouillon.');
  }
  function budgetErrors(){
    if(totalDevis==null||state.plans.some(p=>p.category!=='convoyage'))return [];
    const budget=HCMissionBudget.allocate(totalDevis,[]).budget;
    const sum=state.plans.reduce((s,p)=>s+Number(p.remuneration||0),0);
    return sum>budget+0.001?['Les rémunérations dépassent les 70 % du devis. Réduisez les montants pour préserver les 30 % HelixCar.']:[];
  }
  function card(a){
    const rows=a.rows||[],raw=label=>String(rows.find(r=>r.label===label)?.value||'');
    const facts=items=>'<dl class="hc-prep-leg-facts">'+items.map(([label,value])=>'<div><dt>'+esc(label)+'</dt><dd>'+display(value||'À préciser')+'</dd></div>').join('')+'</dl>';
    const schedule=value=>{
      const date=value.match(/\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4}/)?.[0];
      const hours=value.match(/\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?/)?.[0];
      return '<span class="hc-prep-date">'+display(date||'Date à préciser')+'</span><strong class="hc-prep-time'+(hours?'':' hc-prep-unspecified')+'">'+esc(hours||'Heure à préciser')+'</strong>';
    };
    const vehicle=value=>{const parts=value.split(' · ');return {model:parts.length>1?parts.slice(1).join(' · '):value,type:parts.length>1?parts[0]:''};};
    const route=(from,to,start,end)=>'<div class="hc-prep-route"><div><span class="hc-prep-route-label">Véhicule à récupérer à</span><strong class="hc-prep-city">'+display(from||'Ville à préciser')+'</strong>'+(start!==null?schedule(start):'')+'</div><span class="hc-prep-direction" aria-hidden="true">→</span><div><span class="hc-prep-route-label">À livrer à</span><strong class="hc-prep-city">'+display(to||'Ville à préciser')+'</strong>'+(end!==null?schedule(end):'')+'</div></div>';
    const frais=raw('Carburant et péages inclus (€)');
    const fraisTexte=a.category==='convoyage'&&frais!==''&&Number.isFinite(Number(frais))&&Number(frais)>=0&&a.remuneration!=null&&Number(frais)<=Number(a.remuneration)?'<small class="hc-prep-muted"> (dont '+esc(Math.trunc(Number(frais)).toLocaleString('fr-FR',{style:'currency',currency:'EUR',minimumFractionDigits:0,maximumFractionDigits:0}))+' pour carburant et péages)</small>':'';
    let h='<section class="hc-prep-card hc-prep-annonce"><div class="hc-prep-mission-summary"><strong>'+esc(a.category==='convoyage'?'Convoyage':a.title)+'</strong><div><span>Rémunération totale</span><strong class="hc-prep-price">'+esc(a.remuneration==null?'À définir':Number(a.remuneration).toLocaleString('fr-FR',{style:'currency',currency:'EUR',minimumFractionDigits:0,maximumFractionDigits:0}))+'</strong>'+fraisTexte+'</div></div>';
    if(!rows.some(r=>r.label==='Départ'))return h+facts(rows.map(r=>[r.label,r.value]))+'</section>';
    const delivered=vehicle(raw('Véhicule'));
    h+='<div class="hc-prep-legs'+(raw('Restitution')?' hc-prep-legs--return':'')+'"><section class="hc-prep-leg" aria-label="Livraison"><header class="hc-prep-annonce-head"><h4>Livraison</h4></header>'+route(raw('Départ'),raw('Arrivée'),raw('Prise en charge'),raw('Livraison'))+
      facts([['Modèle',delivered.model],['Motorisation',raw('Motorisation')],...(delivered.type?[['Catégorie',delivered.type]]:[]),['Transport',raw('Transport')],['Distance',raw('Distance')]])+'</section>';
    if(raw('Restitution')){
      const returned=vehicle(raw('Restitution')),returnRoute=raw('Trajet de restitution'),prefix=raw('Arrivée')+' · ';
      const destination=returnRoute.startsWith(prefix)?returnRoute.slice(prefix.length):returnRoute.includes(' · ')?returnRoute.split(' · ').slice(1).join(' · '):'';
      h+='<section class="hc-prep-leg" aria-label="Restitution"><header class="hc-prep-annonce-head"><h4>Véhicule à restituer</h4></header>'+route(raw('Arrivée'),destination,raw('Livraison'),raw('Restitution prévue'))+
        facts([['Modèle',returned.model],['Motorisation',raw('Motorisation restitution')],...(returned.type?[['Catégorie',returned.type]]:[]),['Transport',raw('Transport')]])+'</section>';
    }
    return h+'</div></section>';
  }
  window.hcPreparationCarteOpportunite=function(o,options){
    let html=card(o.preparation_annonce);if(options?.partenaire){html+='<div id="opp-msg-'+esc(o.id)+'" class="hc-note" role="status"></div>';
      if(o.ma_candidature_etat==='retenu')html+='<button class="btn btn-outline" '+actionHtml('ouvrirDetailsPreparation',[o.mission_id])+'>Voir les détails de la mission</button>';
      if(o.ma_candidature_etat)html+='<p>Votre candidature : '+esc(_libEtatCandidature(o.ma_candidature_etat,window._currentConvoyeur))+'</p>';
      else if(o.statut==='a_pourvoir')html+='<button class="btn btn-primary" id="opp-postuler-'+esc(o.id)+'" '+actionHtml('postulerOpportunite',[o.id])+'>Postuler</button>';
    }return '<div class="hc-prep-public" data-opportunite="'+esc(o.id)+'">'+html+'</div>';
  };
  function input(p,i,key,label,type='number'){
    const min=key==='retour_reception'?HCPlanningCalcul.retourReceptionMin(p):'';
    const value=p[key]??'';
    const invalid=min&&value&&String(value).slice(0,16)<min;
    return '<label>'+label+'<input data-plan="'+i+'" data-field="'+key+'" type="'+type+'" '+(type==='number'?'min="0" step="'+(key==='distance'?'1':key==='remuneration'?'5':'0.01')+'"':'')+(min?' min="'+esc(min)+'"':'')+' value="'+esc(invalid?'':value)+'">'+(invalid?'<small>La date précédente était antérieure à la livraison. Choisissez un nouveau rendez-vous.</small>':'')+'</label>';
  }
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
    if(!state.preview)h+='<aside class="hc-prep-budget" aria-label="Repère financier administrateur"><span>Montant total payé par le client</span><strong>'+esc(totalDevis===null?'Montant indisponible':money(totalDevis))+'</strong><small>'+esc(totalDevis==null?'':('Minimum HelixCar (30 %) : '+money(HCMissionBudget.allocate(totalDevis,[]).reserve)+' · Plafond missions (70 %) : '+money(HCMissionBudget.allocate(totalDevis,[]).budget)))+'</small></aside>';
    if(!state.preview){
      h+='<button type="button" class="btn btn-primary" data-auto-budget>Calculer les tarifs des missions</button><p class="hc-prep-muted">Tarifs selon le kilométrage aller, frais de route, restitution et garde inclus. Si le budget client est inférieur au barème, la part travail est réduite proportionnellement, en conservant les frais et suppléments. Aucun tarif n’est augmenté pour dépenser les 70 %. Missions publiées conservées. Prix arrondis à 5 € près et kilomètres entiers. Si nécessaire, un prix est arrondi vers le bas pour respecter le plafond global. Le recalcul remplace les prix des brouillons.</p>';
      h+='<section class="hc-prep-internal"><h4>Organisation des véhicules</h4><p>Jusqu’à 5 jours inclus : même convoyeur. Au-delà : stockage à Noisy et mission séparée. Chaque dérogation concerne uniquement la période choisie.</p>';
      const seen=new Set();state.plans.forEach(p=>{const id=p.vehicule_id||'principal';if(seen.has(id)||!p.organisation)return;seen.add(id);
        const family=state.plans.filter(x=>(x.vehicule_id||'principal')===id),locked=family.some(x=>x.saved?.mission_id),o=p.organisation;
        h+='<div class="hc-prep-return-step"><h5>Véhicule '+esc(p.position)+' · '+esc(p.mission.marque_modele)+'</h5>';
        if(o.depotClient)h+='<p>Le client dépose le véhicule à Noisy. Un convoyeur le récupère la veille de la livraison, à l’heure que vous fixez.</p>';
        if(o.retraitClient)h+='<p>Le client récupère le véhicule à Noisy : aucune mission de livraison ensuite.</p>';
        for(const [key,label,days,long] of [['before','Avant la livraison',o.beforeDays,o.longBefore],['return','Avant la restitution',o.returnDays,o.longReturn]]){
          if(days==null)continue;
          h+='<p><strong>'+label+' : '+esc(days)+' jour(s).</strong> '+(key==='return'&&o.retourClient?'Retour à Noisy puis récupération par le client, sans nouvelle mission.':long?(o[key]?'Dérogation : garde par le même convoyeur.':'Plus de 5 jours : passage à Noisy et mission séparée.'):'Seuil de 5 jours non dépassé.')+'</p>';
          if(long&&!locked)h+='<button type="button" class="btn btn-outline" data-garde-vehicle="'+esc(id)+'" data-garde-period="'+key+'">'+(o[key]?'Rétablir le passage à Noisy':'Autoriser la garde par le même convoyeur')+'</button>';
        }
        h+='<p><strong>'+family.length+' mission(s) à organiser</strong></p><ol>'+family.map(x=>'<li>'+esc(x.mission.ville_depart)+' → '+esc(x.mission.ville_arrivee)+(x.mission.restitution?' → '+esc(x.retour_helixcar?'Noisy-le-Grand':x.rows.find(r=>r.label==='Trajet de restitution')?.value?.split(' · ').slice(1).join(' · ')||'restitution'):'')+'</li>').join('')+'</ol>'+(locked?'<p>Découpage verrouillé : une mission est déjà publiée.</p>':'')+'</div>';
      });h+='</section>';
    }
    if(!state.plans.length)h+='<p>Aucun trajet à confier : dépôt et récupération par le client, ou véhicules à compléter dans la demande.</p>';
    state.plans.forEach((p,i)=>{
      const linked=p.saved?.mission_id;
      if(state.preview||linked){h+=card(linked?(p.saved?.annonce||HCPreparation.publicData(p)):HCPreparation.publicData(p));if(linked){h+='<p class="hc-prep-muted">Mission déjà créée</p>';if(!state.preview&&p.retour_helixcar)h+='<div class="hc-prep-internal"><p><strong>Retour du convoyeur à Noisy :</strong> '+display(p.retour_reception?.replace('T',' · '))+'</p><p><strong>'+(p.retour_helixcar.transfert?'Départ du prochain convoyeur :':'Récupération par le client à Noisy :')+'</strong> '+display(p.retour_remise?.replace('T',' · '))+'</p><p>Suivi des deux rendez-vous dans le planning HelixCar.</p></div>';}else {if(p.missing.length)h+='<p class="hc-prep-incomplete">Publication bloquée · À compléter dans la demande : '+esc(p.missing.join(' · '))+'</p>';h+='<button type="button" class="btn btn-primary" data-prep-publish="'+i+'"'+(p.missing.length?' disabled':'')+'>Publier cette mission</button>';}return;}
      h+='<section class="hc-prep-card"><div class="hc-prep-head"><div><small>'+esc(p.position?'Véhicule '+p.position:'Prestation')+'</small><h4>'+esc(p.title)+'</h4></div><span class="badge badge-pending">Brouillon</span></div>';
      if(p.category==='convoyage'&&p.kind!=='direct')h+='<p class="hc-prep-step">'+(p.kind==='avant_stockage'?'Trajet 1 · remise à HelixCar':'Trajet 2 · départ du point HelixCar')+'</p>';
      h+='<dl class="hc-prep-facts">'+p.rows.map(r=>vehicleRow(p,i,r)).join('')+'</dl>';
      if(p.category==='convoyage'&&p.kind==='direct')h+='<p class="hc-prep-muted">Horaires repris de la demande client.</p>';
      if(p.stockage)h+='<p class="hc-prep-internal">Organisation interne · stockage HelixCar du '+display(p.stockage)+' (absent de l’annonce partenaire)</p>';
      const auto=autoDrafts.get(p.key)||(p.calcul_interne?.pricingPolicy==='rounded_v1'?p.calcul_interne:null);
      if(!auto&&p.calcul_interne)h+='<p class="hc-prep-muted">Ancien calcul enregistré : relancez le calcul pour adapter les tarifs au budget client.</p>';
      if(auto)h+='<aside class="hc-prep-internal"><strong>'+esc(auto.local?'Île-de-France · prix forfaitaire':'Hors Île-de-France · forfait HelixCar')+'</strong><p>'+esc(p.distance)+' km aller'+(auto.minutes==null?'':' · '+esc(auto.minutes)+' min hors trafic')+'</p><p>Garde convoyeur : '+(auto.periods?esc(auto.periods.filter(d=>d>0).join(' + ')||0)+' jour(s) · 25 € par tranche complète de 4 jours, par véhicule = '+esc(money(auto.guard)):'Ancien calcul enregistré. Recalculez les brouillons pour appliquer les nouveaux paliers.')+'</p>'+(auto.local?'':'<p>Frais de route inclus : '+esc(auto.outboundKm??p.distance)+' km aller × 0,22 € = '+esc(money(auto.outboundFees??auto.fees))+'</p>')+(auto.returnFees>0?'<p>Restitution hors Île-de-France : 50 % des frais de l’aller ('+esc(money(auto.referenceFees))+') = '+esc(money(auto.returnFees))+'</p>':'')+(auto.extra>0?'<p>Supplément restitution Île-de-France : '+esc(money(auto.extra))+'</p>':'')+(auto.adjusted?'<p><strong>Adapté au budget client</strong> · Travail au barème : '+esc(money(auto.standardWork))+' ; travail ajusté : '+esc(money(auto.work))+'</p>':'')+(auto.work==null?'':'<p>Travail : '+esc(money(auto.work))+' · Total proposé : '+esc(money(auto.total))+'</p>')+'<small>'+esc(auto.source)+' · Forfait carburant et péages, sans calcul de leur coût réel. Vous pouvez ajuster les montants avant validation.</small></aside>';
      h+='<div class="hc-prep-fields">'+input(p,i,'remuneration','Prix total de la mission (€)');
      if(p.category==='convoyage'){h+=(HCMissionBudget.local(p)?'':input(p,i,'carburant_peages','Dont forfait carburant et péages (€)'))+input(p,i,'distance','Distance aller uniquement (km)')+motor(p,i,'motorisation','Motorisation');h+='<button type="button" class="btn btn-outline" data-estimate-free="'+i+'">Estimer les kilomètres gratuitement</button><p class="hc-prep-muted">Kilomètres calculés automatiquement par IGN en France pour l’aller uniquement. Itinéraire voiture le plus rapide, hors trafic. Vous pouvez corriger la distance si nécessaire.</p>';if(p.mission.restitution)h+=motor(p,i,'restit_motorisation','Motorisation restitution');
        if(p.kind==='avant_stockage')h+=input(p,i,'heure_remise','Heure de réception par vous chez HelixCar','time');
        if(p.kind==='apres_stockage')h+=input(p,i,'heure_retrait','Heure de remise au convoyeur la veille','time');}
      h+='</div>';
      if(p.retour_helixcar?.transfert){
        h+='<section class="hc-prep-internal hc-prep-return"><h4>Retour à Noisy avant une nouvelle mission</h4><p>Après la livraison, ce convoyeur ramène le véhicule récupéré à Noisy. Sa mission se termine à votre réception.</p><p><strong>Livraison précédente :</strong> '+display(p.rows.find(r=>r.label==='Livraison')?.value)+'</p><div class="hc-prep-fields">'+input(p,i,'retour_reception','Date et heure de réception à Noisy','datetime-local')+'</div><p>Prévoyez la durée du trajet retour et 45 minutes de marge. Le départ suivant est à régler dans la mission de restitution ci-dessous.</p></section>';
      }else if(p.retour_helixcar){
        const d=p.retour_helixcar.demande;
        const livraison=p.rows.find(r=>r.label==='Livraison')?.value||p.mission.date_livraison;
        h+='<section class="hc-prep-internal hc-prep-return"><h4>Retour à Noisy et récupération par le client</h4><p><strong>'+esc(p.mission.restit_marque_modele||'Véhicule à récupérer')+' · '+esc(p.mission.restit_immatriculation||'Immatriculation à compléter')+'</strong></p>';
        h+='<div class="hc-prep-return-step"><h5>1. Le convoyeur livre le premier véhicule</h5><p><strong>'+display(livraison)+'</strong></p><p>'+esc(p.mission.adresse_arrivee||'Adresse de livraison à compléter')+'</p><p>Il récupère ensuite le véhicule à ramener à Noisy.</p></div>';
        h+='<div class="hc-prep-return-step"><h5>2. Réception — convoyeur → HelixCar</h5><p>'+esc(HCPlanningCalcul.POINT)+'</p><p><strong>Rendez-vous à fixer par vous.</strong> Prévoyez le temps du trajet retour après la livraison, puis 45 minutes de marge.</p><div class="hc-prep-fields">'+input(p,i,'retour_reception','Date et heure de retour du convoyeur à Noisy','datetime-local')+'</div><p>La mission du convoyeur se termine lorsqu’il vous remet le véhicule.</p></div>';
        h+='<div class="hc-prep-return-step"><h5>3. Remise — HelixCar → client</h5><p><strong>Rendez-vous demandé par le client :</strong> '+display(HCPlanningCalcul.retourDemande(p))+'</p><div class="hc-prep-fields">'+input(p,i,'retour_remise','Date et heure de récupération par le client','datetime-local')+'</div><p>Personne attendue : '+esc(d.contact||[state.source.client.prenom,state.source.client.nom].filter(Boolean).join(' ')||'Client')+' · '+esc(d.telephone||state.source.client.telephone||'Téléphone à compléter')+'</p></div><p>Le véhicule reste chez HelixCar entre le retour du convoyeur et la récupération par le client. Les deux rendez-vous sont suivis séparément dans votre planning.</p></section>';
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
    if(key==='remuneration'&&!p.saved?.mission_id&&p[key]!=null){p[key]=Math.round(p[key]/5)*5;e.value=p[key];}
    if(key==='distance'&&!p.saved?.mission_id){if(p.distance!=null)p.distance=HCMissionBudget.wholeKm(p.distance);e.value=p.distance??'';p.distance_aller=p.distance;p.distance_basis='outbound_v1';}
    if(e.type==='time'&&e.value===previous)return;
    if(key==='heure_remise'){p.mission.date_livraison=HCPreparation.stamp(p.date_fin,e.value);p.rows.find(r=>r.label==='Livraison').value=[p.date_fin,e.value].filter(Boolean).join(' · ');}
    if(key==='heure_retrait'||key==='heure_prise_en_charge'){p.mission.date_prise_en_charge=HCPreparation.stamp(p.date_debut,e.value);p.rows.find(r=>r.label==='Prise en charge').value=[p.date_debut,e.value].filter(Boolean).join(' · ');}
  });
    state.plans.filter(p=>p.parent_retour_key).forEach(p=>{
      const parent=state.plans.find(x=>x.key===p.parent_retour_key);if(parent)parent.retour_remise=p.mission.date_prise_en_charge||'';
    });
    state.plans.forEach(p=>{
      if(!p.retour_helixcar)return;
      p.mission.date_restitution_depart=p.retour_reception||null;
      const row=p.rows.find(r=>r.label==='Restitution prévue');if(row)row.value=p.retour_reception?p.retour_reception.replace('T',' · '):'Réception chez HelixCar à fixer';
      p.missing=[...(p.missing||[]).filter(x=>!x.startsWith('Rendez-vous : ')),...HCPlanningCalcul.retourErrors(p,true).map(x=>'Rendez-vous : '+x)];
    });
  }
  async function save(refresh=true){
    readEdits();backup();const version=editVersion,snapshot=state,key=draftKey(state.source);
    const errors=budgetErrors().concat(state.plans.flatMap(p=>HCPreparation.fraisErrors(p).concat(HCPlanningCalcul.retourErrors(p,false))));
    if(errors.length)throw Error(errors.join(' · '));
    const data=await rpc('enregistrer_preparation_missions',{p_client_id:state.source.client.id,p_empreinte:state.source.empreinte,p_plans:state.plans.map(p=>{const copy=Object.assign({},p);delete copy.saved;copy.public=HCPreparation.publicData(p);return copy;})});
    if(state!==snapshot)return;
    if(version===editVersion&&key){try{localStorage.removeItem(key);}catch(_){}}
    if(refresh&&version===editVersion)adopt(data);
    else{state.source=data;state.plans.forEach(p=>{const saved=data.brouillons?.find(x=>x.cle===p.key);if(saved)p.saved=saved;});}
  }
  modal.addEventListener('input',e=>{
    if(!state||state.preview||!e.target.dataset?.field)return;
    const p=state.plans[Number(e.target.dataset.plan)],key=e.target.dataset.field;
    if(!p||p.saved?.mission_id||!draftFields.includes(key))return;
    p[key]=e.target.type==='number'?(e.target.value===''?null:Number(e.target.value)):e.target.value;
    if(key==='distance'){p.distance_aller=p.distance;p.distance_basis='outbound_v1';}
    editVersion++;backup();queueSave();
  });
  window.addEventListener('beforeunload',()=>{if(state&&!state.preview)backup();});
  modal.addEventListener('change',e=>{
    const field=e.target;
    if(field.dataset?.field!=='retour_reception'||!state)return;
    const p=state.plans[Number(field.dataset.plan)],min=HCPlanningCalcul.retourReceptionMin(p);
    if(field.value&&min&&field.value.slice(0,16)<min){
      field.value='';p.retour_reception='';
      note('Le retour à Noisy doit être postérieur à la livraison du premier véhicule. Choisissez un rendez-vous à partir du '+min.slice(0,10).split('-').reverse().join('/')+'.',true);
    }else p.retour_reception=field.value;
    const row=p.rows.find(r=>r.label==='Restitution prévue');
    if(row)row.value=p.retour_reception?p.retour_reception.replace('T',' · '):'Réception chez HelixCar à fixer';
    p.mission.date_restitution_depart=p.retour_reception||null;
    editVersion++;backup();queueSave();
  });
  modal.addEventListener('click',async e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.id==='hc-prep-close'){if(busy)return;clearTimeout(autosaveTimer);if(state&&!state.preview){busy=true;try{await save();}catch(e){note('Saisie conservée sur cet appareil : '+e.message,true);return;}finally{busy=false;}}++generation;closeModal('preparation-missions');return;}
    if(busy||!state)return;busy=true;b.disabled=true;
    try{
      if(b.hasAttribute('data-auto-budget')){await calculateAll();editVersion++;backup();queueSave();}
      if(b.hasAttribute('data-garde-vehicle')){
        readEdits();const id=b.dataset.gardeVehicle,key=b.dataset.gardePeriod;
        const family=state.plans.filter(p=>(p.vehicule_id||'principal')===id);
        if(!['before','return'].includes(key)||family.some(p=>p.saved?.mission_id))throw Error('Découpage déjà publié : modification impossible.');
        const exceptions={};state.plans.forEach(p=>{if(p.organisation)exceptions[p.vehicule_id||'principal']={...p.organisation};});
        exceptions[id][key]=!exceptions[id][key];
        const fresh=HCPreparation.build(state.source.client,state.source.vehicules,state.source.point_remise,exceptions);
        state.plans=state.plans.filter(p=>(p.vehicule_id||'principal')!==id).concat(fresh.filter(p=>(p.vehicule_id||'principal')===id)).sort((a,b)=>a.position-b.position);
        autoDrafts.clear();render();note('Découpage recalculé pour ce véhicule. Vérifiez les horaires, distances et prix, puis enregistrez le brouillon.');
      }
      if(b.hasAttribute('data-estimate-free')){
        const i=Number(b.dataset.estimateFree),p=state.plans[i];
        if(!p||p.category!=='convoyage'||p.saved?.mission_id)throw Error('Ce calcul concerne uniquement un brouillon convoyage.');
        readEdits();
        const session=(await sbAuth.auth.getSession()).data?.session;
        if(!session?.access_token)throw Error('Reconnectez-vous pour demander une estimation.');
        const response=await fetch('/api/route-gratuite',{method:'POST',headers:{Authorization:'Bearer '+session.access_token,apikey:SUPABASE_KEY,'Content-Type':'application/json'},body:JSON.stringify({clientId:state.source.client.id,key:p.key,vehiculeId:p.vehicule_id,organisation:p.organisation})});
        const data=await response.json();
        if(!response.ok)throw Error(data.error||'Calcul routier indisponible');
        if(data.fingerprint!==state.source.empreinte)throw Error('La demande a changé. Rechargez les missions.');
        const routes=data.routes||[];
        if(!routes.length)throw Error('Aucun itinéraire calculé');
        const distance=Number(routes[0].km);p.distance_basis='outbound_v1';
        p.distance=HCMissionBudget.wholeKm(distance);p.distance_aller=p.distance;
        render();
        note('Distance estimée : '+p.distance.toLocaleString('fr-FR')+' km · '+Number(routes[0].minutes||0)+' min de conduite hors trafic. Cliquez sur Calculer les tarifs des missions pour appliquer le forfait de frais de route.');
      }
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
          const returned=p.restitution_secondaire||key==='restit_marque_modele';
          if(!returned&&x.restitution_secondaire)return;
          const target=returned&&!x.restitution_secondaire?'restit_marque_modele':'marque_modele';
          const label=target==='marque_modele'?'Véhicule':'Restitution',r=x.rows.find(r=>r.label===label);if(!r)return;
          const previous=x.mission[target]||'',prefix=previous&&r.value.endsWith(previous)?r.value.slice(0,-previous.length):'';
          x.mission[target]=value;r.value=prefix+value;
        });
        await save();render();note('Marque et modèle corrigés dans les missions en préparation.');
      }
      if(b.hasAttribute('data-prep-save')){await save();render();note('Brouillon enregistré. Rien n’est publié.');}
      if(b.dataset.prepView==='admin'){state.preview=false;render();note('');}
      if(b.dataset.prepView==='preview'){
        readEdits();
        if(state.plans.some(p=>!p.saved?.mission_id&&p.category==='convoyage'&&(!(Number(p.remuneration)>0)||!(Number(p.distance)>0))))await calculateAll(generation,true);
        if(state.plans.some(p=>!p.saved?.mission_id&&p.category==='convoyage'&&(!(Number(p.remuneration)>0)||!(Number(p.distance)>0))))throw Error('Complétez ou calculez le prix et la distance avant de voir l’aperçu partenaire.');
        await save();state.preview=true;render();note('');
      }
      if(b.hasAttribute('data-prep-publish')){
        readEdits();if(budgetErrors().length)throw Error(budgetErrors().join(' · '));
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
