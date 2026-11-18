import C from '../../assets/planning-calcul.js';
import Preparation from '../../assets/preparation-missions.js';
const URL_SB='https://zsetmqnmmupqbkgqbjbo.supabase.co';
export async function estimate(plan,battement,route,now=Date.now()){
 const m=plan.mission,b=C.margin(battement),buffer=b*C.MINUTE;
 if(plan.category!=='convoyage')throw Error('Ce dossier ne contient pas de trajet routier');
 if(m.plateau)throw Error('Transport sur plateau : estimation poids lourd à vérifier séparément');
 if(!C.address(m.adresse_depart)||!C.address(m.adresse_arrivee))throw Error('Adresse complète nécessaire : rue, numéro, code postal et ville');
 const warnings=[];
 const call=async(from,to,departure)=>{
  if(departure<now)throw Error('Horaire passé : choisissez une mission à venir');
  const r=await route(from,to,departure);
  if(!(r.seconds>0)||!(r.meters>0)||!Number.isFinite(r.seconds+r.meters))throw Error('Itinéraire indisponible');
  return r;
 };
 let r,suggestion,departure,arrival;
 if(plan.kind==='apres_stockage'){
  const delivery=C.bounds(plan,'Livraison',m.date_livraison);arrival=delivery[0];
  if(delivery.length>1)warnings.push('Calcul pour le début du créneau de livraison client.');
  // Résolution à rebours : chaque durée est recalculée au départ envisagé.
  let travel=3600000;
  for(let i=0;i<4;i++){
   suggestion=arrival-buffer-travel;departure=suggestion+20*C.MINUTE;
   r=await call(m.adresse_depart,m.adresse_arrivee,departure);
   const needed=Math.ceil(r.seconds)*1000;
   if(needed<=travel&&travel-needed<60000)break;
   travel=needed;
  }
  if(departure+r.seconds*1000+(b-20)*C.MINUTE>arrival+1000)throw Error('Trafic trop variable : recalculer avant de confirmer');
  if(C.civil(suggestion).slice(0,10)<plan.date_debut)throw Error('La livraison nécessiterait un départ avant la fin du stockage');
 }else{
  const pickup=C.bounds(plan,'Prise en charge',m.date_prise_en_charge);
  const start=pickup[pickup.length-1];departure=start+20*C.MINUTE;
  if(pickup.length>1)warnings.push('Estimation prudente depuis la fin du créneau de prise en charge.');
  r=await call(m.adresse_depart,m.adresse_arrivee,departure);
  suggestion=start+buffer+r.seconds*1000;arrival=suggestion;
  if(plan.kind==='avant_stockage'&&C.civil(suggestion).slice(0,10)!==plan.date_fin)warnings.push('Réception estimée sur un autre jour que le début de stockage prévu.');
  if(plan.kind==='direct'){
   const delivery=C.bounds(plan,'Livraison',m.date_livraison);
   if(suggestion>delivery[delivery.length-1])warnings.push('Livraison client incompatible avec le trajet et le battement.');
  }
 }
 let restitution=null;
 if(m.restitution){
  if(!C.address(m.adresse_restitution))throw Error('Adresse complète de restitution à compléter');
  const delivery=C.bounds(plan,'Livraison',m.date_livraison),start=Math.max(arrival,delivery[0])+20*C.MINUTE;
  const rr=await call(m.adresse_arrivee,m.adresse_restitution,start);
  const deadline=C.bounds(plan,'Restitution prévue',m.date_restitution_depart);
  restitution={km:Math.round(rr.meters/100)/10,minutes:Math.ceil(rr.seconds/60),arrival:C.civil(start+rr.seconds*1000)};
  if(start+rr.seconds*1000>deadline[deadline.length-1])warnings.push('Restitution incompatible : temps de trajet et 20 minutes de remise à prévoir.');
 }
 return {provider:'Google Maps',calculatedAt:new Date(now).toISOString(),margin:b,km:Math.round(r.meters/100)/10,minutes:Math.ceil(r.seconds/60),staticMinutes:Math.ceil(r.staticSeconds/60)||null,suggestion:C.civil(suggestion),departure:C.civil(departure),restitution,warnings,kind:plan.kind};
}
export async function handle(body,headers,{fetcher=fetch,env=process.env,now=Date.now()}={}){
 const authorization=headers.authorization||'',apikey=headers.apikey||'';
 if(!/^Bearer [\w.\-]+$/.test(authorization)||!apikey)return {status:401,body:{error:'Reconnectez-vous à votre espace administrateur.'}};
 const rpc=async(name,args)=>{const r=await fetcher(URL_SB+'/rest/v1/rpc/'+name,{method:'POST',headers:{Authorization:authorization,apikey,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('Accès administrateur requis ou session expirée');return r.json();};
 try{
  if(await rpc('est_admin',{})!==true)return {status:403,body:{error:'Accès réservé à l’administration.'}};
  if(!/^[a-f\d-]{36}$/i.test(body.clientId||'')||typeof body.key!=='string'||body.key.length>100)throw Error('Demande invalide');
  C.margin(body.margin);
  if(!env.GOOGLE_MAPS_ROUTES_API_KEY)return {status:503,body:{code:'TRAFIC_NON_CONFIGURE',error:'Le calcul avec trafic n’est pas encore connecté. Aucun horaire estimé n’a été inventé.'}};
  const source=await rpc('source_preparation_missions',{p_client_id:body.clientId});
  const plan=Preparation.build(source.client,source.vehicules,C.POINT).find(p=>p.key===body.key);
  if(!plan)throw Error('Trajet introuvable dans la demande actuelle');
  const route=async(from,to,departure)=>{
   const r=await fetcher('https://routes.googleapis.com/directions/v2:computeRoutes',{method:'POST',headers:{'Content-Type':'application/json','X-Goog-Api-Key':env.GOOGLE_MAPS_ROUTES_API_KEY,'X-Goog-FieldMask':'routes.duration,routes.staticDuration,routes.distanceMeters'},body:JSON.stringify({origin:{address:from},destination:{address:to},travelMode:'DRIVE',routingPreference:'TRAFFIC_AWARE_OPTIMAL',departureTime:new Date(departure).toISOString(),languageCode:'fr-FR',regionCode:'fr',units:'METRIC'}),signal:AbortSignal.timeout(18000)});
   if(!r.ok)throw Error('Le service de trafic ne répond pas. Réessayez plus tard.');
   const data=await r.json(),x=data.routes?.[0];
   return {seconds:parseFloat(x?.duration),staticSeconds:parseFloat(x?.staticDuration),meters:x?.distanceMeters};
  };
  return {status:200,body:{estimate:await estimate(plan,body.margin,route,now),fingerprint:source.empreinte}};
 }catch(e){return {status:422,body:{error:e.name==='TimeoutError'?'Le calcul prend trop de temps. Réessayez.':e.message}};}
}
