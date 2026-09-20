// Modèle préparé ; aucun envoi automatique n'est branché à ce stade.
export const STOCKAGE_ACCES_ENVOI_ACTIF = false;
export const POINT_REMISE_HELIXCAR = 'ALDI — 12 rue de l’Université, 93160 Noisy-le-Grand';

const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function preparerMailAccesStockage({reference, adresse = POINT_REMISE_HELIXCAR, depotClient = false, recuperationClient = false, dateDepot = '', heureDepot = '', dateRecuperation = '', heureRecuperation = ''}) {
  if (!depotClient && !recuperationClient) throw new Error('Aucun déplacement du client au lieu de stockage.');
  if (!String(adresse || '').trim()) throw new Error('L’adresse exacte doit être renseignée avant de préparer un mail destiné au client.');
  if (!String(reference || '').trim()) throw new Error('La référence de la demande est requise.');
  const rendezVous = (titre, date, heure) => titre + ' : ' + (date ? 'le ' + date : 'date à confirmer') + (heure ? ' à ' + heure : ', horaire à confirmer') + '.';
  const lignes = [
    'Bonjour,',
    'Votre demande ' + reference + ' a été acceptée et votre paiement a bien été enregistré.',
    'Voici les informations pratiques pour votre stockage automobile.',
    ...(depotClient ? [rendezVous('Dépôt de votre véhicule par vos soins', dateDepot, heureDepot)] : []),
    ...(recuperationClient ? [rendezVous('Récupération de votre véhicule par vos soins après stockage', dateRecuperation, heureRecuperation)] : []),
    'Point de remise HelixCar :\n' + String(adresse).trim(),
    'Il s’agit du point de rendez-vous pour la remise de votre véhicule. Votre véhicule sera stocké sur un site distinct.',
    'Cette adresse concerne uniquement le dépôt et/ou la récupération que vous effectuez vous-même, selon les choix de votre demande.',
    'Pour toute question ou modification de rendez-vous, contactez notre équipe.',
    'L’équipe HelixCar'
  ];
  return {
    subject: 'HelixCar — Adresse et rendez-vous de stockage — ' + String(reference).replace(/[\r\n]+/g, ' '),
    text: lignes.join('\n\n'),
    html: '<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body style="font-family:Arial,sans-serif;color:#20252b;line-height:1.6;max-width:600px;margin:auto;padding:24px"><h1 style="font-size:22px">Votre stockage automobile</h1>' + lignes.map(l => '<p>' + escapeHtml(l).replace(/\n/g, '<br>') + '</p>').join('') + '</body></html>'
  };
}
