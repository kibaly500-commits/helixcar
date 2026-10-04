/* Le formulaire partagé est chargé avec la session admin. Toutes les autorisations
   et le rattachement final sont contrôlés par les RPC, jamais par ce fichier. */
(function () {
  'use strict';
  var generation = 0;
  var el = function (id) { return document.getElementById(id); };
  window.fermerDemandeAdmin = function () {
    generation++;
    el('admin-demande-cadre').removeAttribute('src');
    el('admin-demande-cadre').hidden = true;
  };
  window.openNewMission = function () {
    if (currentRole !== 'admin') return;
    window.fermerDemandeAdmin();
    el('admin-numero-client').value = '';
    el('admin-numero-client').disabled = false;
    el('admin-client-chercher').disabled = false;
    el('admin-client-identite').hidden = true;
    el('admin-client-message').textContent = '';
    openModal('new-mission');
    el('admin-numero-client').focus();
  };
  window.rechercherClientAdmin = async function () {
    if (currentRole !== 'admin') return;
    var numero = el('admin-numero-client').value.trim().toUpperCase();
    if (!/^CLI-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/.test(numero)) {
      el('admin-client-message').textContent = 'Saisissez un numéro comme CLI-A7K9P.'; return;
    }
    var demande = ++generation;
    el('admin-client-chercher').disabled = true;
    el('admin-client-message').textContent = 'Recherche du client…';
    try {
      var r = await sbAuth.rpc('rechercher_compte_client_admin', { p_numero: numero });
      if (demande !== generation) return;
      if (r.error || !r.data || !r.data.profil) throw new Error((r.error && r.error.message) || 'Client introuvable.');
      var p = r.data.profil, zone = el('admin-client-identite');
      zone.replaceChildren();
      var titre = document.createElement('strong');
      titre.textContent = [p.prenom, p.nom].filter(Boolean).join(' ') || p.societe || 'Client';
      var detail = document.createElement('span');
      detail.textContent = r.data.numero + ' · ' + (p.email || '');
      zone.append(titre, detail); zone.hidden = false;
      el('admin-numero-client').disabled = true;
      el('admin-client-message').textContent = 'Client retrouvé. Complétez sa demande ci-dessous.';
      var cadre = el('admin-demande-cadre');
      cadre.src = 'index.html?nouvelle-demande=1&integre=1&admin-client=' + encodeURIComponent(r.data.numero);
      cadre.hidden = false;
    } catch (e) {
      if (demande === generation) {
        el('admin-client-message').textContent = e.message || 'Recherche indisponible. Réessayez.';
        el('admin-client-chercher').disabled = false;
      }
    }
  };
  window.addEventListener('message', function (e) {
    var cadre = el('admin-demande-cadre');
    if (e.origin !== location.origin || !cadre || e.source !== cadre.contentWindow || currentRole !== 'admin') return;
    if (e.data && e.data.type === 'hc-admin-demande-enregistree') {
      cadre.hidden = true; cadre.removeAttribute('src');
      el('admin-client-message').textContent = 'Demande enregistrée dans l’espace du client. Retrouvez-la dans « Demandes de devis » pour préparer son devis.';
      if (typeof loadDemandesDevis === 'function') loadDemandesDevis();
    }
    if (e.data && e.data.type === 'hc-admin-demande-erreur') {
      window.fermerDemandeAdmin();
      el('admin-client-message').textContent = e.data.message || 'Client indisponible.';
      el('admin-numero-client').disabled = false;
      el('admin-client-chercher').disabled = false;
    }
  });
  window.chargerNumeroClient = async function (uid) {
    var zone = el('client-numero-permanent');
    zone.hidden = true;
    try {
      var r = await sbAuth.from('comptes_clients').select('numero').eq('auth_user_id', uid).maybeSingle();
      if (r.error || !r.data || currentRole !== 'client' || !window._currentClient || window._currentClient.authUserId !== uid) return;
      var code = document.createElement('strong'); code.textContent = r.data.numero;
      zone.replaceChildren(document.createTextNode('Votre numéro client'), code, document.createTextNode('À communiquer lors de vos demandes par téléphone.'));
      zone.hidden = false;
    } catch (e) { /* Le parcours existant reste disponible. */ }
  };
})();
