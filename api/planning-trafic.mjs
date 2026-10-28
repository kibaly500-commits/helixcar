// Calcul automatique arrêté : aucun appel à Google Maps, même si une clé existe.
export default function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 return res.status(410).json({code:'PLANNING_MANUEL',error:'Les horaires sont renseignés manuellement dans Planning HelixCar.'});
}
