/* Calculs purs du planning. Les horaires civils sont toujours ceux de Paris. */
(function(root){
'use strict';
const POINT='12 rue de l’Université, 93160 Noisy-le-Grand';
const MINUTE=60000;
function civil(value){
 const d=new Date(value);if(!Number.isFinite(d.getTime()))throw Error('Date invalide');
 const p=Object.fromEntries(new Intl.DateTimeFormat('fr-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d).map(x=>[x.type,x.value]));
 return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
function instant(value){
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value||''))throw Error('Date et heure précises nécessaires');
 const naive=Date.parse(value+'Z'),choices=[0,1,2].map(h=>naive-h*3600000).filter(t=>Number.isFinite(t)&&civil(t)===value);
 if(choices.length!==1)throw Error('Horaire inexistant ou ambigu lors du changement d’heure');
 return choices[0];
}
function margin(value=45){const n=Number(value);if(!Number.isInteger(n)||n<20||n>180)throw Error('Battement : de 20 à 180 minutes');return n;}
function address(value){return typeof value==='string'&&value.length<400&&/\b\d{5}[,\s]+\S/.test(value)&&/\d/.test(value.split(',')[0]);}
function bounds(plan,label,fallback){
 const row=plan.rows.find(r=>r.label===label)?.value||'';
 const day=row.match(/\d{4}-\d{2}-\d{2}/)?.[0]||fallback?.slice(0,10);
 const hours=row.match(/\d{1,2}:\d{2}/g)||[];
 if(!day||!hours.length)throw Error('Horaire client à compléter : '+label);
 return hours.map(h=>instant(day+'T'+h.padStart(5,'0')));
}
function overlap(a,b){return a.start<b.end&&b.start<a.end;}
function slot(kind,time){const t=instant(time);return kind==='avant_stockage'?{start:t,end:t+20*MINUTE}:{start:t,end:t+20*MINUTE};}
function guidance(p){
 if(!['avant_stockage','apres_stockage'].includes(p.kind))return null;
 const incoming=p.kind==='avant_stockage',label=incoming?'Prise en charge':'Livraison';
 return {
  label:incoming?'Prise en charge chez le client':'Livraison attendue chez le client',
  when:p.rows?.find(r=>r.label===label)?.value||(incoming?p.mission.date_prise_en_charge:p.mission.date_livraison)||'Horaire client à préciser',
  address:incoming?p.mission.adresse_depart:p.mission.adresse_arrivee,
  target:incoming?'Votre heure de réception chez HelixCar':'Votre heure de remise au convoyeur chez HelixCar',
  rule:incoming?'Heure de prise en charge + durée du trajet vérifiée par vous + 45 minutes de battement.':'Heure de livraison attendue − durée du trajet vérifiée par vous − 45 minutes de battement.'
 };
}
const api={POINT,MINUTE,civil,instant,margin,address,bounds,overlap,slot,guidance};
if(typeof module==='object'&&module.exports)module.exports=api;else root.HCPlanningCalcul=api;
})(typeof window==='undefined'?globalThis:window);
