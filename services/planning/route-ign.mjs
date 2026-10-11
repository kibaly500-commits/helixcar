/* Géoplateforme IGN : accès ouvert, sans compte ni clé. France uniquement.
 * Adresses et itinéraires restent en mémoire du serveur, cache borné de 24 h. */
const cache=new Map();let nextRequest=0;
async function request(url,fetcher){
 if(fetcher===fetch){const now=Date.now(),wait=Math.max(0,nextRequest-now);nextRequest=Math.max(now,nextRequest)+260;if(wait)await new Promise(r=>setTimeout(r,wait));}
 const r=await fetcher(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error(r.status===429?'Service routier occupé, réessayez dans un instant.':'Service routier IGN temporairement indisponible.');
 return r.json();
}
export async function routeIgn(from,to,{fetcher=fetch}={}){
 const key=from+'\n'+to,cached=fetcher===fetch&&cache.get(key);
 if(cached&&cached.expires>Date.now())return {...cached.result};
 const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
 const point=async(address)=>{
  const postcode=address.match(/\b\d{5}\b/)?.[0];
  if(!postcode)throw Error('Code postal manquant : complétez l’adresse.');
  const data=await request('https://data.geopf.fr/geocodage/search?'+new URLSearchParams({q:address,index:'address',limit:'5'}),fetcher);
  const [street,city]=address.split(postcode);
  const matches=(data.features||[]).filter(f=>{const p=f.properties||{};
   const exactPlace=normalize(p.city)===normalize(city)&&normalize(p.name)===normalize(street);
   return (p.postcode===postcode||exactPlace)&&p.score>=0.55&&['housenumber','street'].includes(p.type);
  });
  const p=matches[0]?.geometry?.coordinates;
  if(!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite))throw Error('Adresse non reconnue avec suffisamment de précision : '+address);
  return p.join(',');
 };
 const start=await point(from),end=await point(to);
 const d=await request('https://data.geopf.fr/navigation/itineraire?'+new URLSearchParams({resource:'bdtopo-osrm',start,end,profile:'car',optimization:'fastest',distanceUnit:'kilometer',timeUnit:'minute',getSteps:'false',getBbox:'false'}),fetcher);
 if(!Number.isFinite(d.distance)||d.distance<=0||!Number.isFinite(d.duration)||d.duration<=0)throw Error('Itinéraire IGN non calculable.');
 const result={km:Math.round(d.distance*10)/10,minutes:Math.ceil(d.duration),provider:'IGN Géoplateforme',tollsEuros:null,tollsStatus:'forfait_kilometrique',traffic:'non_inclus',fastestMotorwayConfirmed:false};
 if(fetcher===fetch){if(cache.size>=300)cache.delete(cache.keys().next().value);cache.set(key,{result,expires:Date.now()+86400000});}
 return result;
}
