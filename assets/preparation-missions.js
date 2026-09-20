/* Préparation administrative. Les annonces utilisent une projection explicite,
 * jamais le JSON client, les consignes libres ni les coordonnées privées. */
(function (root) {
  'use strict';
  const text = v => v == null ? '' : String(v);
  const join = (...v) => v.filter(x => x !== null && x !== undefined && x !== '').join(' · ');
  const date = d => /^\d{4}-\d{2}-\d{2}$/.test(text(d).slice(0,10)) ? text(d).slice(0,10) : null;
  const hour = (v, prefix) => v[prefix+'_heure_type'] === 'creneau'
    ? [v[prefix+'_creneau_debut'],v[prefix+'_creneau_fin']].filter(Boolean).join(' - ')
    : text(v[{pc:'heure_prise_en_charge',liv:'heure_livraison',restit:'restit_heure'}[prefix]]);
  const firstHour = h => { const x = text(h).match(/^(\d{1,2})[:h](\d{2})/); return x ? x[1].padStart(2,'0')+':'+x[2] : null; };
  const stamp = (d,h) => date(d) && firstHour(h) ? date(d)+'T'+firstHour(h) : null;
  const daysBetween = (a,b) => date(a)&&date(b) ? Math.round((Date.parse(date(b))-Date.parse(date(a)))/86400000) : null;
  const address = (v,end) => [v['adresse_'+end+'_rue'],[v['code_postal_'+end],v['ville_'+end]].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const row = (label,value) => ({label,value:text(value)||'À préciser'});
  const service = {interieur:'Nettoyage intérieur',exterieur:'Nettoyage extérieur',interieur_exterieur:'Nettoyage intérieur et extérieur',preparation_complete:'Préparation complète',conseil:'Prestation à préciser'};
  const metier = {jockey:'Jockey automobile',accueil_preparation:'Accueil en concession',soutien_administratif:'Soutien administratif',mecanique:'Mécanique',carrosserie:'Carrosserie',diagnostic:'Diagnostic',autre:'Spécialité à préciser',conseil:'Métier à préciser'};
  function legacy(c) {return Object.assign({},c,{id:null,position:1,pc_contact_nom:c.contact_pc_nom,pc_contact_tel:c.contact_pc_tel,liv_contact_nom:c.contact_liv_nom,liv_contact_tel:c.contact_liv_tel,restitution_concernee:c.restitution,restit_adresse_rue:c.adresse_restit_rue,restit_code_postal:c.code_postal_restit,restit_ville:c.ville_restit,restit_date:c.date_restitution,restit_heure:c.heure_restitution,restit_contraintes:c.contraintes_restit});}
  function build(c,vehicles,pointAdresse) {
    const point=pointAdresse||'Point de remise HelixCar';
    const type=c.type_service||'convoyage', plans=[];
    if(type==='professionnel'||type==='nettoyage') {
      const pro=type==='professionnel',d=(pro?c.professionnel_details:c.nettoyage_details)||{};
      const title=pro?(metier[d.specialite||d.mission]||'Professionnel automobile'):(service[d.type_nettoyage]||'Nettoyage automobile');
      const start=pro?d.date_debut:d.date_souhaitee,end=d.date_fin||start;
      const schedule=[pro?d.heure_debut:d.creneau_debut,pro?d.heure_fin:d.creneau_fin].filter(Boolean).join(' - ')||d.heure_precise||'';
      const category=pro?(d.categorie||'renfort'):'nettoyage';
      const m={type_mission:pro?'professionnel':'nettoyage',prestation:title,adresse_intervention:d.adresse_rue,code_postal_intervention:d.adresse_cp,ville_intervention:d.adresse_ville,
        contact_nom:d.contact_sur_place?.nom,contact_tel:d.contact_sur_place?.telephone,date_intervention:date(start),date_fin_intervention:date(end),heure_intervention:schedule,
        heure_debut_intervention:firstHour(pro?d.heure_debut:d.creneau_debut),heure_fin_intervention:firstHour(pro?d.heure_fin:d.creneau_fin),
        nb_vehicules:Number(d.nombre_vehicules_approx||d.nombre_vehicules)||null,consignes:join(d.description,d.informations_complementaires,d.consignes,d.precision)};
      const details=[row('Lieu d’intervention',d.adresse_ville),row('Période',join(start,end!==start?end:null)),row('Horaires',schedule),row('Prestation',title)];
      if(pro){details.push(row('Professionnels',d.nombre_professionnels));if(d.description)details.push(row('Tâches demandées',d.description));}else details.push(row('Véhicules',m.nb_vehicules),row('Organisation','Créneau groupé'));
      if(Array.isArray(d.vehicules))d.vehicules.forEach((v,i)=>details.push(row('Véhicule '+(i+1),join(v.type_vehicule,v.marque_modele))));
      if(Array.isArray(d.repartition_categories))d.repartition_categories.forEach(v=>details.push(row('Véhicules',join(v.categorie||v.type_vehicule,v.nombre||v.quantite))));
      const missing=[];if(!d.adresse_ville)missing.push('Ville d’intervention');if(!start||!end)missing.push('Dates');if(!schedule)missing.push('Horaires');
      if(pro&&(d.conseil||!d.categorie||!d.nombre_professionnels))missing.push('Métier et nombre de professionnels');
      if(!pro&&c.type_client!=='professionnel'&&!c.societe&&!c.siret)missing.push('Nettoyage réservé aux entreprises');
      plans.push({key:type,title,category,nb_professionnels:pro?(Number(d.nombre_professionnels)||1):1,date_debut:date(start),date_fin:date(end),zone:d.adresse_ville||'',rows:details,mission:m,missing,kind:'intervention'});return plans;
    }
    let vs=vehicles?.length?vehicles:(!c.flotte_a_detailler&&Number(c.nb_vehicules||1)===1?[legacy(c)]:[]);
    vs.forEach(raw=>{
      const v=c.trajet_commun===true?Object.assign(legacy(c),Object.fromEntries(Object.entries(raw).filter(([,value])=>value!==null&&value!==''))):raw;
      const delta=daysBetween(v.date_prise_en_charge,v.date_livraison);
      const explicit=type==='stockage'||type==='convoyage_stockage';
      const split=explicit||(delta!==null&&delta>2);
      const before=type!=='stockage'||c.stockage_acheminement==='helixcar';
      const after=type!=='stockage'||(v.livraison_apres_stockage===true||(v.livraison_apres_stockage!==false&&c.stockage_sortie==='helixcar'));
      const base={type_mission:'convoyage',marque_modele:v.marque_modele,type_vehicule:v.type_vehicule,immatriculation:v.immatriculation,vin:v.vin,motorisation:v.motorisation,nb_vehicules:1,
        ville_depart:v.ville_depart,ville_arrivee:v.ville_arrivee,adresse_depart:address(v,'depart'),adresse_arrivee:address(v,'arrivee'),contact_depart_nom:v.pc_contact_nom,contact_depart_tel:v.pc_contact_tel,contact_arrivee_nom:v.liv_contact_nom,contact_arrivee_tel:v.liv_contact_tel,
        date_prise_en_charge:stamp(v.date_prise_en_charge,hour(v,'pc')),date_livraison:stamp(v.date_livraison,hour(v,'liv')),plateau:v.mode_transport==='plateau',consignes:join(v.consignes,c.notes,c.stockage_notes),
        restitution:!!v.restitution_concernee,adresse_restitution:[v.restit_adresse_rue,v.restit_code_postal,v.restit_ville].filter(Boolean).join(', '),restit_contact_nom:v.restit_contact_nom,restit_contact_tel:v.restit_contact_tel,restit_marque_modele:v.restit_marque_modele,restit_immatriculation:v.restit_immatriculation,restit_vin:v.restit_vin,restit_motorisation:v.restit_motorisation,restit_info:v.restit_contraintes,date_restitution_depart:stamp(v.restit_date,hour(v,'restit'))};
      const add=(leg)=>{
        const m=Object.assign({},base),pre=leg==='avant_stockage',post=leg==='apres_stockage';
        let start=v.date_prise_en_charge,end=v.date_livraison,sh=hour(v,'pc'),eh=hour(v,'liv');
        if(pre){m.ville_arrivee='Noisy-le-Grand';m.adresse_arrivee=point;m.contact_arrivee_nom=null;m.contact_arrivee_tel=null;end=c.stockage_date_debut||start;eh='';m.date_livraison=null;m.restitution=false;['adresse_restitution','restit_contact_nom','restit_contact_tel','restit_marque_modele','restit_immatriculation','restit_vin','restit_motorisation','restit_info','date_restitution_depart'].forEach(k=>m[k]=null);}
        if(post){m.ville_depart='Noisy-le-Grand';m.adresse_depart=point;m.contact_depart_nom=null;m.contact_depart_tel=null;start=type==='stockage'?(v.date_livraison||c.stockage_date_fin):(c.stockage_date_fin||end);sh='';m.date_prise_en_charge=null;}
        const title=pre?'Prise en charge avant stockage':post?'Livraison après stockage':'Convoyage automobile';
        const details=[row('Départ',m.ville_depart),row('Arrivée',m.ville_arrivee),row('Prise en charge',join(start,sh)),row('Livraison',join(end,eh)),row('Véhicule',join(v.type_vehicule,v.marque_modele)),row('Transport',m.plateau?'Plateau':'Convoyage par la route')];
        if(!split&&delta>0)details.push(row('Stockage',delta+' jour'+(delta>1?'s':'')));
        if(m.restitution)details.push(row('Restitution',join(v.restit_type_vehicule,v.restit_marque_modele)),row('Trajet de restitution',join(m.ville_arrivee,v.restit_ville)),row('Restitution prévue',join(v.restit_date,hour(v,'restit'))));
        const missing=[];if(!m.ville_depart||!m.ville_arrivee)missing.push('Villes du trajet');if(!v.marque_modele)missing.push('Modèle du véhicule');if(!start||!end)missing.push('Dates du trajet');if(delta!==null&&delta<0)missing.push('Livraison antérieure à la prise en charge');
        plans.push({key:(v.id||'principal')+':'+leg,title,category:'convoyage',kind:leg,vehicule_id:v.id||null,position:v.position||1,nb_professionnels:1,date_debut:date(start),date_fin:date(end),zone:join(m.ville_depart,m.ville_arrivee),rows:details,mission:m,missing,stockage:split?join(c.stockage_date_debut||v.date_prise_en_charge,c.stockage_date_fin||v.date_livraison):'',distance:null,motorisation:v.motorisation||'',restit_motorisation:v.restit_motorisation||''});
      };
      if(split){if(before)add('avant_stockage');if(after)add('apres_stockage');}else add('direct');
    });return plans;
  }
  // Cette projection exclut les champs privés, même s'ils sont ajoutés à une mission.
  function publicData(p){return {title:p.title,category:p.category,rows:p.rows.concat(p.category==='convoyage'?[row('Distance',p.distance==null?'À préciser':p.distance+' km'),row('Motorisation',p.motorisation),...(p.mission.restitution?[row('Motorisation restitution',p.restit_motorisation)]:[])]:[]),remuneration:p.remuneration==null?null:Number(p.remuneration),nb_professionnels:p.nb_professionnels};}
  const api={build,publicData,stamp,daysBetween};if(typeof module==='object'&&module.exports)module.exports=api;else root.HCPreparation=api;
})(typeof window==='undefined'?globalThis:window);
