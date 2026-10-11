/* Calcul routier sans facturation : clé du quota gratuit ORS requise.
 * Ne retourne ni péage inventé, ni trafic temps réel. Accès administrateur seul. */
const SB='https://zsetmqnmmupqbkgqbjbo.supabase.co';
const ORS='https://api.heigit.org';
const POINT='12 rue de l’Université, 93160 Noisy-le-Grand';
const valid=s=>typeof s==='string'&&s.length>=8&&s.length<400&&/\d{5}/.test(s);
export async function routeFree(from,to,{fetcher=fetch,key}={}){
 if(!key)throw Error('Clé gratuite openrouteservice non configurée');
 if(!valid(from)||!valid(to))throw Error('Adresses complètes nécessaires');
 const headers={'Authorization':key,'Accept':'application/json'};
 const geocode=async address=>{
  const url=ORS+'/pelias/v1/search?text='+encodeURIComponent(address)+'&size=1&boundary.country=FR';
  const r=await fetcher(url,{headers,signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw Error('Géocodage indisponible');
  const f=(await r.json()).features?.[0];
  const c=f?.geometry?.coordinates;
  if(!Array.isArray(c)||c.length<2||!c.every(Number.isFinite))throw Error('Adresse introuvable dans le service routier');
  return c;
 };
 const [a,b]=await Promise.all([geocode(from),geocode(to)]);
 const r=await fetcher(ORS+'/openrouteservice/v2/directions/driving-car/json',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({coordinates:[a,b],preference:'fastest',instructions:false}),signal:AbortSignal.timeout(18000)});
 if(!r.ok)throw Error('Calcul routier gratuit indisponible');
 const summary=(await r.json()).routes?.[0]?.summary;
 if(!Number.isFinite(summary?.distance)||!Number.isFinite(summary?.duration)||summary.distance<=0||summary.duration<=0)throw Error('Itinéraire non calculable');
 return {km:Math.round(summary.distance/100)/10,minutes:Math.ceil(summary.duration/60),provider:'openrouteservice',tollsEuros:null,tollsStatus:'a_verifier',traffic:'non_inclus',fastestMotorwayConfirmed:false,
  warning:'Durée hors trafic. Autoroute la plus rapide et tarif des péages à confirmer avant validation.'};
}
export async function handleFreeRoute(body,headers,{fetcher=fetch,env=process.env}={}){
 const auth=headers?.authorization||'',apikey=headers?.apikey||'';
 if(!/^Bearer [\w.\-]+$/.test(auth)||!apikey)return {status:401,body:{error:'Session administrateur nécessaire'}};
 const rpc=async(name,args)=>{const r=await fetcher(SB+'/rest/v1/rpc/'+name,{method:'POST',headers:{Authorization:auth,apikey,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('Accès administrateur refusé');return r.json();};
 try{
  if(await rpc('est_admin',{})!==true)return {status:403,body:{error:'Réservé à HelixCar administration'}};
  if(!env.ORS_FREE_API_KEY)return {status:503,body:{code:'ORS_NON_CONFIGURE',error:'Clé gratuite openrouteservice non configurée. Aucune estimation inventée.'}};
  if(!/^[a-f\d-]{36}$/i.test(body?.clientId||'')||typeof body?.key!=='string'||body.key.length>100)throw Error('Demande invalide');
  const source=await rpc('source_preparation_missions',{p_client_id:body.clientId});
  const mod=await import('../../assets/preparation-missions.js');
  const plan=mod.default?.build?.(source.client,source.vehicules,source.point_remise||POINT)?.find(p=>p.key===body.key);
  if(!plan||plan.category!=='convoyage')throw Error('Mission non trouvée');
  if(plan.mission.plateau)throw Error('Transport plateau non pris en charge');
  const legs=[[plan.mission.adresse_depart,plan.mission.adresse_arrivee]];
  if(plan.mission.restitution)legs.push([plan.mission.adresse_arrivee,plan.mission.adresse_restitution]);
  const routes=[];
  for(const [from,to] of legs)routes.push(await routeFree(from,to,{fetcher,key:env.ORS_FREE_API_KEY}));
  return {status:200,body:{fingerprint:source.empreinte,routes,source:'OpenStreetMap © contributeurs · openrouteservice by HeiGIT'}};
 }catch(e){return {status:422,body:{error:e.name==='TimeoutError'?'Service temporairement indisponible':e.message}};}
}
