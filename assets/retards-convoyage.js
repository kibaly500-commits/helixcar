/* Signalements privés : convoyeur affecté → planning HelixCar. */
(function(){
 'use strict';
 const esc=v=>escapeHtml(String(v??''));
 const fmt=v=>String(v||'').replace(' ','T').slice(0,16).replace(/(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/,'$3/$2/$1 à $4');
 let epoch=0,sending=false,selected=null;
 async function rpc(name,args){const r=await sbAuth.rpc(name,args);if(r.error)throw Error(r.error.message);return r.data;}
 const modal=document.createElement('div');modal.id='modal-retard-convoyage';modal.className='modal-overlay';
 modal.innerHTML='<div class="modal" style="max-width:480px"><h3>Signaler un retard à HelixCar</h3><p data-retard-prevu></p><p>Indiquez votre arrivée estimée au point de remise de Noisy-le-Grand. L’horaire prévu reste inchangé : HelixCar gère la suite.</p><form data-retard-form><label style="display:block">Arrivée estimée (heure de Paris)<input name="arrivee" type="datetime-local" required step="60" style="display:block;width:100%;margin:8px 0 16px"></label><label style="display:block">Motif (facultatif)<textarea name="motif" maxlength="500" rows="3" style="display:block;width:100%;margin:8px 0 16px"></textarea></label><p role="status" aria-live="polite" data-retard-message></p><div class="hc-prep-toolbar"><button type="submit" class="btn btn-primary">Alerter HelixCar</button><button type="button" class="btn btn-outline" data-retard-close>Fermer</button></div></form></div>';
 document.body.append(modal);
 const form=modal.querySelector('form'),message=modal.querySelector('[data-retard-message]');
 modal.querySelector('[data-retard-close]').addEventListener('click',()=>{if(!sending)closeModal('retard-convoyage');});
 function open(rdv){
  selected=rdv;message.textContent='';
  modal.querySelector('[data-retard-prevu]').textContent='Remise prévue le '+fmt(rdv.horaire_prevu)+'.';
  form.elements.arrivee.min=String(rdv.horaire_prevu).replace(' ','T').slice(0,16);
  form.elements.arrivee.value=String(rdv.alerte?.arrivee_estimee||'').replace(' ','T').slice(0,16);
  form.elements.motif.value=rdv.alerte?.motif||'';
  form.querySelector('[type=submit]').disabled=false;openModal('retard-convoyage');form.elements.arrivee.focus();
 }
 form.addEventListener('submit',async e=>{
  e.preventDefault();if(sending||!selected)return;
  const rdv=selected,ticket=epoch,button=form.querySelector('[type=submit]');
  if(form.elements.arrivee.value<=String(rdv.horaire_prevu).replace(' ','T').slice(0,16)){message.textContent='L’arrivée estimée doit être après l’horaire prévu.';return;}
  sending=true;button.disabled=true;message.textContent='Envoi du signalement…';
  try{
   await rpc('signaler_retard_convoyage',{p_preparation_id:rdv.preparation_id,p_etape:rdv.etape,p_horaire_prevu:rdv.horaire_prevu,p_arrivee_estimee:form.elements.arrivee.value,p_motif:form.elements.motif.value.trim()});
   if(ticket!==epoch)return;
   message.textContent='HelixCar a reçu votre signalement. Le rendez-vous initial reste inchangé.';
   await loadMissionsConvoyeur();
  }catch(error){if(ticket===epoch)message.textContent=error.message;}
  finally{sending=false;if(ticket===epoch)button.disabled=false;}
 });
 async function mount(container){
  const ticket=epoch,slots=[...container.querySelectorAll('[data-retard-mission]')];if(!slots.length)return;
  try{
   const rows=await rpc('lister_rendezvous_retard_convoyeur',{});if(ticket!==epoch||currentRole!=='convoyeur')return;
   for(const slot of slots){
    if(!slot.isConnected)continue;slot.textContent='';
    for(const rdv of rows.filter(r=>r.mission_id===slot.dataset.retardMission)){
     const button=document.createElement('button');button.type='button';button.className='btn btn-sm btn-outline';
     button.textContent=rdv.alerte?'Actualiser mon retard':'Signaler un retard';
     button.addEventListener('click',()=>open(rdv));slot.append(button);
     if(rdv.alerte){const text=document.createElement('small');text.style.display='block';text.textContent='Arrivée estimée : '+fmt(rdv.alerte.arrivee_estimee)+(rdv.alerte.traite_le?' · Pris en compte par HelixCar':' · Signalement transmis');slot.append(text);}
    }
   }
  }catch(_){for(const slot of slots)if(slot.isConnected&&ticket===epoch){const button=document.createElement('button');button.className='btn btn-sm btn-outline';button.textContent='Réessayer le suivi des retards';button.onclick=()=>mount(container);slot.replaceChildren(button);}}
 }
 async function loadAdmin(){
  const zone=document.getElementById('hc-retards-planning'),ticket=epoch;if(!zone||currentRole!=='admin')return;
  try{
   const rows=await sbFetchToutePage('retards_convoyage?select=*,missions(reference_courte,reference),convoyeurs(prenom,nom)&traite_le=is.null&order=signale_le.desc');
   if(ticket!==epoch||currentRole!=='admin')return;
   zone.innerHTML=rows.length?'<div class="card"><h3>Retards signalés · '+rows.length+'</h3><p>Ces alertes restent visibles jusqu’à leur prise en compte. Les horaires prévus ne sont pas modifiés.</p>'+rows.map(r=>'<article style="border-top:1px solid #ddd;padding:14px 0"><strong>'+esc(r.missions?.reference_courte||r.missions?.reference||'Mission')+' · '+esc([r.convoyeurs?.prenom,r.convoyeurs?.nom].filter(Boolean).join(' '))+'</strong><p>Remise à Noisy-le-Grand prévue : '+esc(fmt(r.horaire_prevu))+'<br><strong>Arrivée estimée : '+esc(fmt(r.arrivee_estimee))+'</strong></p>'+(r.motif?'<p>'+esc(r.motif)+'</p>':'')+'<button type="button" class="btn btn-outline" data-retard-traite="'+esc(r.id)+'" data-retard-revision="'+r.revision+'">Marquer comme pris en compte</button><p role="status" data-retard-feedback></p></article>').join('')+'</div>':'';
   afficherCompteurMenu('admin-planning',rows.length,'retards à prendre en compte');
  }catch(_){if(ticket===epoch&&currentRole==='admin')zone.textContent='Les alertes de retard sont indisponibles. Actualisez le planning.';}
 }
 document.getElementById('hc-retards-planning').addEventListener('click',async e=>{
  const button=e.target.closest('[data-retard-traite]');if(!button)return;button.disabled=true;
  const out=button.parentElement.querySelector('[data-retard-feedback]');
  try{await rpc('traiter_retard_convoyage',{p_id:button.dataset.retardTraite,p_revision:Number(button.dataset.retardRevision)});await loadAdmin();}
  catch(error){out.textContent=error.message;button.disabled=false;}
 });
 window.HCRetards={mount,loadAdmin};
 window.addEventListener('hc-session-fermee',()=>{++epoch;selected=null;form.reset();message.textContent='';closeModal('retard-convoyage');document.getElementById('hc-retards-planning').textContent='';});
})();
