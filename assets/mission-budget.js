/* Calculs administratifs purs. Aucun détail financier interne dans publicData. */
(function(root){
'use strict';
const cents=n=>Math.round(n*100);
function amount(v){if(typeof v!=='number'||!Number.isFinite(v)||v<0)throw Error('Montant invalide');return v;}
function allocate(total,items){
 const invoice=cents(amount(total)),reserve=Math.ceil(invoice*0.30),budget=invoice-reserve;
 const fixed=items.filter(x=>x.locked).reduce((s,x)=>s+cents(amount(x.total)),0);
 const open=items.filter(x=>!x.locked);
 const costs=open.map(x=>cents(amount(x.fees))+cents(amount(x.guard))+cents(amount(x.extra||0)));
 const available=budget-fixed-costs.reduce((a,b)=>a+b,0);
 if(available<0)throw Error('Budget insuffisant : frais et garde dépassent les 70 % disponibles. Les 30 % HelixCar sont préservés.');
 const weights=open.map(x=>amount(x.weight));const sum=weights.reduce((a,b)=>a+b,0);
 if(open.length&&!sum)throw Error('Distances nécessaires pour répartir le budget');
 const shares=weights.map(w=>Math.floor(available*w/sum));
 let rest=available-shares.reduce((a,b)=>a+b,0);
 const order=weights.map((w,i)=>({i,r:available*w/sum-shares[i]})).sort((a,b)=>b.r-a.r||a.i-b.i);
 for(let j=0;j<rest&&order.length;j++)shares[order[j%order.length].i]++;
 return {reserve:reserve/100,budget:budget/100,unallocated:open.length?0:(budget-fixed)/100,
  missions:open.map((x,i)=>({key:x.key,total:(costs[i]+shares[i])/100,work:shares[i]/100,fees:x.fees,guard:x.guard,extra:x.extra||0}))};
}
function local(plan){
 const m=plan.mission,addresses=[m.adresse_depart,m.adresse_arrivee];if(m.restitution)addresses.push(m.adresse_restitution);
 return addresses.every(a=>/\b(?:75|77|78|91|92|93|94|95)\d{3}\b/.test(a||''));
}
function guardPeriods(p){
 const o=p.organisation||{};
 // Ne compter que la garde confiée au convoyeur, jamais le séjour au dépôt.
 const before=p.kind==='apres_stockage'?1:p.kind==='direct'&&!o.retraitClient&&!o.depotClient?Math.max(0,o.beforeDays||0):0;
 const after=p.mission.restitution&&!p.retour_helixcar?Math.max(0,o.returnDays||0):0;
 return [before,after];
}
function guardDays(p){return guardPeriods(p).reduce((a,b)=>a+b,0);}
function guardAllowance(days){amount(days);return Math.floor(days/4)*25;}
function guardPricing(p){const periods=guardPeriods(p);return {periods,days:guardDays(p),guard:periods.reduce((sum,days)=>sum+guardAllowance(days),0)};}
function roadFees(km,isLocal){amount(km);if(km===0)throw Error('Distance nécessaire');return isLocal?0:Math.round(km*22)/100;}
function localAddresses(...addresses){return addresses.every(a=>/\b(?:75|77|78|91|92|93|94|95)\d{3}\b/.test(a||''));}
function travelPricing(p,plans=[]){
 const m=p.mission;
 const outboundKm=Number(m.restitution?p.distance_aller:p.distance);
 const outboundFees=roadFees(outboundKm,localAddresses(m.adresse_depart,m.adresse_arrivee));
 let returnFees=0,extra=0,referenceFees=outboundFees;
 const secondary=p.restitution_secondaire;
 if(secondary){
  const parent=plans.find(x=>x!==p&&x.vehicule_id===p.vehicule_id&&x.retour_helixcar?.transfert);
  if(!parent)throw Error('Mission aller nécessaire pour calculer les frais de restitution.');
  referenceFees=roadFees(Number(parent.distance_aller),localAddresses(parent.mission.adresse_depart,parent.mission.adresse_arrivee));
  if(localAddresses(parent.mission.adresse_arrivee,m.adresse_arrivee))extra=20;
  else returnFees=Math.round(referenceFees*50)/100;
  return {outboundKm,outboundFees:0,returnFees,extra,fees:returnFees,referenceFees};
 }
 if(m.restitution&&!p.retour_helixcar?.transfert){
  if(localAddresses(m.adresse_arrivee,m.adresse_restitution))extra=20;
  else returnFees=Math.round(outboundFees*50)/100;
 }
 return {outboundKm,outboundFees,returnFees,extra,fees:Math.round((outboundFees+returnFees)*100)/100,referenceFees};
}
const api={allocate,local,guardDays,guardAllowance,guardPricing,roadFees,travelPricing};
if(typeof module==='object'&&module.exports)module.exports=api;else root.HCMissionBudget=api;
})(typeof window==='undefined'?globalThis:window);
