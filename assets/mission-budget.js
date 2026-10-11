/* Calculs administratifs purs. Aucun détail financier interne dans publicData. */
(function(root){
'use strict';
const cents=n=>Math.round(n*100);
function amount(v){if(typeof v!=='number'||!Number.isFinite(v)||v<0)throw Error('Montant invalide');return v;}
function allocate(total,items){
 const invoice=cents(amount(total)),reserve=Math.ceil(invoice*0.30),budget=invoice-reserve;
 const fixed=items.filter(x=>x.locked).reduce((s,x)=>s+cents(amount(x.total)),0);
 const open=items.filter(x=>!x.locked);
 const costs=open.map(x=>cents(amount(x.fees))+cents(amount(x.guard)));
 const available=budget-fixed-costs.reduce((a,b)=>a+b,0);
 if(available<0)throw Error('Budget insuffisant : frais et garde dépassent les 70 % disponibles. Les 30 % HelixCar sont préservés.');
 const weights=open.map(x=>amount(x.weight));const sum=weights.reduce((a,b)=>a+b,0);
 if(open.length&&!sum)throw Error('Distances nécessaires pour répartir le budget');
 const shares=weights.map(w=>Math.floor(available*w/sum));
 let rest=available-shares.reduce((a,b)=>a+b,0);
 const order=weights.map((w,i)=>({i,r:available*w/sum-shares[i]})).sort((a,b)=>b.r-a.r||a.i-b.i);
 for(let j=0;j<rest&&order.length;j++)shares[order[j%order.length].i]++;
 return {reserve:reserve/100,budget:budget/100,unallocated:open.length?0:(budget-fixed)/100,
  missions:open.map((x,i)=>({key:x.key,total:(costs[i]+shares[i])/100,work:shares[i]/100,fees:x.fees,guard:x.guard}))};
}
function local(plan){
 const m=plan.mission,addresses=[m.adresse_depart,m.adresse_arrivee];if(m.restitution)addresses.push(m.adresse_restitution);
 return addresses.every(a=>/\b(?:75|77|78|91|92|93|94|95)\d{3}\b/.test(a||''));
}
function guardDays(p){
 const o=p.organisation||{};
 // Ne compter que la garde confiée au convoyeur, jamais le séjour au dépôt.
 const before=p.kind==='apres_stockage'?1:p.kind==='direct'&&!o.retraitClient&&!o.depotClient?Math.max(0,o.beforeDays||0):0;
 const after=p.mission.restitution&&!p.retour_helixcar?Math.max(0,o.returnDays||0):0;
 return before+after;
}
function roadFees(km,isLocal){amount(km);if(km===0)throw Error('Distance nécessaire');return isLocal?0:Math.round(km*22)/100;}
const api={allocate,local,guardDays,roadFees};
if(typeof module==='object'&&module.exports)module.exports=api;else root.HCMissionBudget=api;
})(typeof window==='undefined'?globalThis:window);
