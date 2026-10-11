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

// Barème PROPOSÉ, administrativement ajustable. Ne constitue pas une grille approuvée.
const DEFAULT_POLICY=Object.freeze({
 idf:{minimum:45,base:20,tiers:[{upTo:50,rate:0.90},{upTo:150,rate:0.55},{upTo:400,rate:0.42},{upTo:Infinity,rate:0.32}]},
 hors_idf:{minimum:85,base:40,tiers:[{upTo:50,rate:0.90},{upTo:150,rate:0.55},{upTo:400,rate:0.42},{upTo:Infinity,rate:0.32}]}
});
function proposedLabor(km,zone,policy=DEFAULT_POLICY){
 number(km,'Distance totale');
 if(!['idf','hors_idf'].includes(zone))throw Error('Zone de mission inconnue');
 const p=policy[zone];
 if(!p||!Array.isArray(p.tiers))throw Error('Barème de rémunération indisponible');
 number(p.base,'Base');number(p.minimum,'Minimum');
 let last=0,cost=p.base;
 for(const tier of p.tiers){
  const end=tier.upTo;
  if(!(end>last)||!(Number.isFinite(end)||end===Infinity))throw Error('Paliers incohérents');
  number(tier.rate,'Tarif kilométrique');
  cost+=(Math.min(km,end)-last>0?Math.min(km,end)-last:0)*tier.rate;
  last=end;
  if(km<=end)break;
 }
 if(last<km)throw Error('Barème kilométrique incomplet');
 return round(Math.max(p.minimum,cost));
}
function quoteMission(input){
 if(!input||!Array.isArray(input.legs)||!input.legs.length)throw Error('Trajets nécessaires');
 const km=input.legs.reduce((sum,leg)=>sum+number(leg.km,'Kilomètres'),0);
 const proposedWorkEuros=proposedLabor(km,input.zone,input.policy||DEFAULT_POLICY);
 const workPayEuros=input.workPayEuros==null?proposedWorkEuros:number(input.workPayEuros,'Travail du convoyeur');
 // L'Île-de-France n'ajoute pas automatiquement de frais, mais des frais explicites restent possibles.
 const local=input.zone==='idf';
 const roadLegs=input.legs.map(leg=>({
  ...leg,
  tollEuros:local&&leg.tollEuros==null?0:leg.tollEuros
 }));
 const simulation=estimate({...input,legs:roadLegs,workPayEuros,
   fuelPricePerLiter:local&&input.fuelPricePerLiter==null?1:input.fuelPricePerLiter,
   consumptionLitersPer100Km:local&&input.consumptionLitersPer100Km==null?0:input.consumptionLitersPer100Km});
 // Pour l'IDF, carburant et péages non ajoutés par défaut ; explicite = calcul réel.
 const invoice=input.clientAmountEuros;
 const remaining=invoice==null||simulation.totalEuros==null?null:round(number(invoice,'Montant client')-simulation.totalEuros);
 return {...simulation,zone:input.zone,proposedWorkEuros,remainingBeforeCostsEuros:remaining,pricingPolicy:'simulation_non_validee'};
}
const api={estimate,partnerProjection,quoteMission,proposedLabor,DEFAULT_POLICY};
if(typeof module==='object'&&module.exports)module.exports=api;else root.HCRemunerationEstimation=api;
})(typeof window==='undefined'?globalThis:window);
