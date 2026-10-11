/* Prototype autonome : simulation avant validation administrative.
 * Aucun fournisseur, appel réseau ou écriture en base.
 * Ne jamais publier internalBreakdown dans une annonce partenaire. */
(function(root){
'use strict';
const round=n=>Math.round((n+Number.EPSILON)*100)/100;
function number(v,name,{zero=true}={}){
 if(typeof v!=='number'||!Number.isFinite(v)||v<0||(!zero&&v===0))throw Error(name+' invalide');
 return v;
}
function estimate(input){
 if(!input||!Array.isArray(input.legs)||input.legs.length===0)throw Error('Trajets nécessaires');
 const remuneration=number(input.workPayEuros,'Rémunération du travail');
 const days=number(input.guardDays??0,'Jours de garde');
 if(!Number.isInteger(days))throw Error('Jours de garde : entier requis');
 const daily=10;
 const fuelPrice=number(input.fuelPricePerLiter,'Prix du carburant',{zero:false});
 const rate=number(input.consumptionLitersPer100Km,'Consommation');
 let km=0,minutes=0,tolls=0;const unresolved=[];
 input.legs.forEach((leg,i)=>{
   number(leg.km,'Kilomètres du trajet '+(i+1));number(leg.minutes,'Durée du trajet '+(i+1));
   if(leg.motorwayFastest!==true)throw Error('Itinéraire autoroutier le plus rapide non confirmé, trajet '+(i+1));
   km+=leg.km;minutes+=leg.minutes;
   if(leg.tollEuros===null||leg.tollEuros===undefined){unresolved.push(i+1);return;}
   number(leg.tollEuros,'Péage du trajet '+(i+1));tolls+=leg.tollEuros;
 });
 km=round(km);minutes=Math.round(minutes);
 const fuel=round(km*rate/100*fuelPrice);
 const garde=round(days*daily);
 const tollValue=unresolved.length?null:round(tolls);
 const fees=tollValue===null?null:round(fuel+tollValue);
 const total=fees===null?null:round(remuneration+garde+fees);
 return {
   status:fees===null?'peages_a_verifier':'estimation_complete',
   distanceKm:km,driveMinutes:minutes,receiptMarginMinutes:45,
   feesEuros:fees,totalEuros:total,missingTollLegs:unresolved,
   internalBreakdown:{workPayEuros:remuneration,guardDays:days,guardRateEuros:daily,guardEuros:garde,fuelEuros:fuel,tollEuros:tollValue},
   partnerPreview:total===null?null:{totalEuros:total,roadFeesIncludedEuros:fees}
 };
}
function partnerProjection(result){
 if(!result||!result.partnerPreview)return null;
 return {totalEuros:result.partnerPreview.totalEuros,roadFeesIncludedEuros:result.partnerPreview.roadFeesIncludedEuros};
}
const api={estimate,partnerProjection};
if(typeof module==='object'&&module.exports)module.exports=api;else root.HCRemunerationEstimation=api;
})(typeof window==='undefined'?globalThis:window);
