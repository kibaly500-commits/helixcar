/* Invalidation privée, regroupement des événements et protection des éditions. */
(function () {
  'use strict';
  var session = null, channels = [], timer = null, debounce = null, running = false;
  var context = null, epoch = 0, revision = 0, pending = false, currentPage = '';
  var dirty = new Set(), details = new Map(), lastRun = 0;
  var loaders = {
    'admin-dashboard': ['chargerAccueilAdmin'], 'admin-clients': ['chargerClientsAdmin'],
    'admin-candidatures': ['loadCandidatures', 'loadConvoyeursActifs'],
    'admin-missions': ['loadMissions'], 'admin-opportunites': ['loadOpportunitesAdmin'],
    'admin-facturation': ['loadFacturationAdmin'], 'admin-devis': ['loadDemandesDevis'],
    'admin-infos': ['chargerCentreInformationsAdmin'], 'admin-recontact': ['loadRecontacts'],
    'admin-acquisition': ['loadAcquisition'], 'admin-parametres': ['loadParametresAdmin'],
    'client-dashboard': ['loadDemandesClient', 'loadFideliteCarte', 'loadMissionsResumeClient'],
    'client-missions': ['loadMissionsClient'], 'client-infos': ['loadInfosClient'],
    'client-fidelite': ['loadFideliteClient'], 'client-notation': ['loadEvaluationsClient'],
    'client-profil': ['hcSyncProfilClient'],
    'convoyeur-dashboard': ['loadDashboardMissionsPreview'],
    'convoyeur-missions': ['loadMissionsConvoyeur'],
    'convoyeur-opportunites': ['loadOpportunitesPartenaire'],
    'convoyeur-historique': ['loadHistoriqueConvoyeur'],
    'convoyeur-facturation': ['loadFacturationConvoyeur'],
    'convoyeur-profil': ['hcSyncProfilPartenaire']
  };
  function page() { var el = document.querySelector('.page.active'); return el && el.id.replace(/^page-/, ''); }
  function role() { return typeof currentRole === 'string' ? currentRole : ''; }
  function editing() {
    var active = document.activeElement;
    return dirty.has(page()) || !!document.querySelector('.modal-overlay.open,dialog[open]') ||
      !!(active && active.matches('input,textarea,select,[contenteditable="true"],iframe')) ||
      (typeof _adminInfosBusy !== 'undefined' && _adminInfosBusy) ||
      (typeof _adminInfosCorrection !== 'undefined' && !!_adminInfosCorrection);
  }
  function visible() { return !document.hidden && navigator.onLine !== false && !!session && !!role(); }
  function detailKey(el) {
    var card = el.closest('[data-demande]'), group = el.closest('[data-groupe-demandes]');
    return page() + ':' + (el.id || (card ? card.dataset.demande : group ? group.dataset.groupeDemandes : '') + ':' + el.className);
  }
  function rememberDetails() {
    document.querySelectorAll('.page.active details').forEach(function (el) { details.set(detailKey(el), el.open); });
  }
  function restoreDetails() {
    document.querySelectorAll('.page.active details').forEach(function (el) {
      var key = detailKey(el); if (details.has(key) && el.open !== details.get(key)) el.open = details.get(key);
    });
  }
  function safe(cycle) {
    if (!cycle) return true;
    var ok = visible() && cycle.epoch === epoch && cycle.page === page() && cycle.revision === revision && !editing();
    if (!ok && cycle.epoch === epoch) pending = true;
    return ok;
  }
  function plan() {
    clearTimeout(timer);
    if (visible()) timer = setTimeout(function () { request(0); }, role() === 'client' ? 30000 : 15000);
  }
  window.hcSyncProfilClient = async function () {
    var cycle = context, rows = await chargerDemandesClient();
    if (!safe(cycle)) return;
    if (window._currentClient) {
      window._currentClient.demandes = rows;
      window._currentClient.profil = rows[0] || {};
      loadProfilClient();
    }
  };
  window.hcSyncProfilPartenaire = async function () {
    var cycle = context, conv = window._currentConvoyeur;
    if (!conv) return;
    var res = await sbAuth.from('convoyeurs').select('*').eq('id', conv.id).single();
    if (res.error || !res.data || !safe(cycle)) return;
    window._currentConvoyeur = res.data;
    remplirProfilConvoyeur(res.data);
  };
  async function refresh() {
    clearTimeout(debounce); debounce = null;
    if (!visible()) { pending = true; return; }
    if (running || editing()) { pending = true; plan(); return; }
    running = true; pending = false; lastRun = Date.now(); rememberDetails();
    var cycle = { epoch: ++epoch, page: page(), revision: revision };
    var scroll = { x: window.scrollX, y: window.scrollY }, scrollChanged = false;
    function scrolled() { scrollChanged = true; }
    window.addEventListener('scroll', scrolled, { passive: true });
    try {
      var tasks = [];
      (loaders[cycle.page] || []).forEach(function (name) {
        if (typeof window[name] !== 'function') return;
        context = cycle;
        try { tasks.push(Promise.resolve(window[name](true))); }
        catch (e) { pending = true; }
        finally { context = null; }
      });
      if (role() === 'admin') {
        if (typeof majBadgeDemandes === 'function') tasks.push(majBadgeDemandes(true));
        if (typeof majBadgeCandidatures === 'function') tasks.push(majBadgeCandidatures());
      }
      if (typeof verifierAccesPartenaireEnCours === 'function' && role() === 'convoyeur') tasks.push(verifierAccesPartenaireEnCours());
      await Promise.allSettled(tasks);
      restoreDetails();
      if (safe(cycle) && !scrollChanged && window.scrollY !== scroll.y) window.scrollTo(scroll.x, scroll.y);
    } finally {
      window.removeEventListener('scroll', scrolled);
      running = false; plan();
      if (pending && !editing() && visible()) request(1000);
    }
  }
  function request(delay) {
    pending = true;
    if (!visible() || running) return;
    clearTimeout(debounce);
    debounce = setTimeout(refresh, delay == null ? 700 : delay);
  }
  function disconnect() {
    clearTimeout(timer); clearTimeout(debounce); timer = debounce = null; ++epoch;
    channels.forEach(function (c) { sbAuth.removeChannel(c); }); channels = [];
  }
  async function connect() {
    disconnect();
    if (!visible() || !sbAuth.channel) return;
    var expected = epoch;
    try {
      await sbAuth.realtime.setAuth(session.access_token);
      if (expected !== epoch || !visible()) return;
      var topics = ['hc:user:' + session.user.id];
      if (role() === 'admin') topics.push('hc:admin');
      if (role() === 'convoyeur') topics.push('hc:partenaires');
      topics.forEach(function (topic) {
        var channel = sbAuth.channel(topic, { config: { private: true } })
          .on('broadcast', { event: 'changed' }, function () { request(); })
          .subscribe(function (status) { if (status === 'SUBSCRIBED') request(); });
        channels.push(channel);
      });
    } catch (e) { /* Le contrôle périodique prend le relais. */ }
    plan(); request(0);
  }
  document.addEventListener('input', function (e) {
    ++revision;
    if (e.target.closest('.page.active') && !/recherche|filtre|search/i.test(e.target.id || '') && e.target.type !== 'search') dirty.add(page());
  }, true);
  document.addEventListener('change', function (e) {
    ++revision;
    if (e.target.closest('.page.active') && !/recherche|filtre|search/i.test(e.target.id || '')) dirty.add(page());
  }, true);
  document.addEventListener('toggle', function (e) { if (e.target.matches('details')) details.set(detailKey(e.target), e.target.open); }, true);
  document.addEventListener('focusout', function () { if (pending) request(500); });
  document.addEventListener('reset', function () { dirty.delete(page()); request(); }, true);
  document.addEventListener('visibilitychange', function () { if (document.hidden) disconnect(); else connect(); });
  window.addEventListener('offline', disconnect);
  window.addEventListener('online', connect);
  window.addEventListener('pageshow', function (e) { if (e.persisted) connect(); });
  window.addEventListener('pagehide', disconnect);
  window.addEventListener('hc:page', function () { currentPage = page(); dirty.delete(currentPage); ++revision; rememberDetails(); if (pending) request(); });
  window.addEventListener('hc:role-ready', connect);
  new MutationObserver(function () {
    restoreDetails();
    if (pending && !editing() && !running && Date.now() - lastRun > 1000) request();
  }).observe(document.getElementById('app') || document.body, { childList: true, subtree: true });

  // Après une écriture réussie : relecture immédiate, sans toucher au résultat HTTP.
  var originalFetch = window.fetch;
  window.fetch = function (input, options) {
    var url = typeof input === 'string' ? input : input && input.url || '';
    var method = (options && options.method || input && input.method || 'GET').toUpperCase();
    var isWrite = url.indexOf(SUPABASE_URL + '/') === 0 && method !== 'GET' && method !== 'OPTIONS' &&
      (!url.includes('/rpc/') || /\/(enregistrer|valider|corriger|soumettre|accepter|refuser|publier|postuler|annuler|supprimer|confirmer|modifier|finaliser|decider|repondre|mettre)/.test(url));
    var startRevision = revision, startPage = page();
    return originalFetch.apply(this, arguments).then(function (response) {
      if (isWrite && response.ok) (response.status === 204 ? Promise.resolve(null) : response.clone().json()).then(function (body) {
        if (body === 0 || body === false || (Array.isArray(body) && !body.length) || (body && (body.ok === false || body.error))) return;
        if (startRevision === revision && startPage === page()) dirty.delete(startPage);
        request(300);
      }).catch(function () { request(300); });
      return response;
    });
  };
  window.HCSync = { capture: function () { return context; }, safe: safe, request: request, refresh: refresh,
    navigation: function () { ++epoch; ++revision; } };
  if (typeof sbAuth !== 'undefined' && sbAuth) {
    sbAuth.auth.onAuthStateChange(function (event, next) {
      setTimeout(function () {
        if (!next) { session = null; dirty.clear(); details.clear(); disconnect(); return; }
        var changed = !session || session.user.id !== next.user.id;
        session = next;
        if (changed) { dirty.clear(); details.clear(); }
        connect();
      }, 0);
    });
    sbAuth.auth.getSession().then(function (r) { if (!session) { session = r.data && r.data.session; connect(); } });
  }
  var topbar = document.querySelector('.topbar');
  if (topbar) {
    var button = document.createElement('button'); button.className = 'btn btn-sm btn-outline';
    button.textContent = 'Actualiser'; button.title = 'Les données se mettent aussi à jour automatiquement';
    button.addEventListener('click', function () { request(0); });
    // Le titre et les actions passent sur deux lignes si nécessaire sur mobile.
    topbar.style.flexWrap = 'wrap'; topbar.style.gap = '10px';
    var actions = topbar.querySelector('.topbar-actions') || topbar;
    actions.style.flexWrap = 'wrap';
    actions.appendChild(button);
  }
})();
