// HERE est optionnel : la clé reste sur le serveur. Aucun abonnement créé ici.
export async function routeTolls(from,to,{key,fetcher=fetch}={}){
 const get=async(url)=>{const r=await fetcher(url,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Service itinéraire et péages indisponible');return r.json();};
 const point=async(address)=>{
  const d=await get('https://geocode.search.hereapi.com/v1/geocode?'+new URLSearchParams({q:address,in:'countryCode:FRA',limit:'1',apiKey:key}));
  const p=d.items?.[0]?.position;if(!Number.isFinite(p?.lat)||!Number.isFinite(p?.lng))throw Error('Adresse non reconnue');return p.lat+','+p.lng;
 };
 const [origin,destination]=await Promise.all([point(from),point(to)]);
 const data=await get('https://router.hereapi.com/v8/routes?'+new URLSearchParams({origin,destination,transportMode:'car',routingMode:'fast',departureTime:'any',return:'summary,tolls',currency:'EUR',apiKey:key}));
 const sections=data.routes?.[0]?.sections;if(!sections?.length)throw Error('Itinéraire introuvable');
 let km=0,minutes=0,tolls=0,complete=true;
 for(const s of sections){
  if(!Number.isFinite(s.summary?.length)||!Number.isFinite(s.summary?.duration))throw Error('Itinéraire incomplet');
  km+=s.summary.length/1000;minutes+=s.summary.duration/60;
  if(s.notices?.length||data.routes[0].notices?.length)complete=false;
  for(const t of s.tolls||[]){
   const fares=(t.fares||[]).filter(f=>f.paymentMethods?.some(m=>['cash','bankCard','creditCard'].includes(m)));
   const prices=fares.map(f=>f.price).filter(p=>p?.type==='value'&&p.currency==='EUR'&&Number.isFinite(p.value)&&p.value>=0);
   if(!prices.length)complete=false;else tolls+=Math.max(...prices.map(p=>p.value));
  }
 }
 return {km:Math.round(km*10)/10,minutes:Math.ceil(minutes),provider:'HERE',tollsEuros:complete?Math.round(tolls*100)/100:null,tollsStatus:complete?'estimation':'a_verifier',traffic:'non_inclus',fastestMotorwayConfirmed:false};
}
