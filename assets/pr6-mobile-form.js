// Formulaire client public et intégré : accès aux sélecteurs sans focus natif.
(function () {
  'use strict';
  var modal = document.getElementById('modal-client');
  if (!modal) return;
  var selector = 'input[type="date"],input[type="time"]';
  function enhance(input) {
    if (input.type === 'date' && !_hcContexteChamp(input.id)) return;
    var wrap = input.parentElement;
    if (!wrap.classList.contains('hc-picker-field')) {
      wrap = document.createElement('span');
      wrap.className = 'hc-picker-field';
      input.before(wrap); wrap.appendChild(input);
      var button = document.createElement('button');
      button.type = 'button'; button.className = 'hc-picker-trigger';
      button.setAttribute('aria-haspopup', 'dialog');
      button.dataset.field = input.id;
      wrap.appendChild(button);
      button.addEventListener('click', function () {
        if (input.disabled) return;
        var active = document.activeElement;
        if (active && active !== document.body) active.blur();
        if (input.type === 'date') _hcOuvrirCalendrier(input);
        else _hpOuvrirPicker(input);
      });
    }
    // Le champ reste la source des valeurs et de la validation. Seul le
    // bouton reçoit les interactions tactiles et la navigation au clavier.
    input.readOnly = true; input.tabIndex = -1;
    input.setAttribute('inert', '');
    input.setAttribute('inputmode', 'none');
    input.setAttribute('aria-hidden', 'true');
    var trigger = wrap.querySelector('.hc-picker-trigger');
    trigger.disabled = input.disabled;
    trigger.setAttribute('aria-invalid', input.getAttribute('aria-invalid') || 'false');
    var error = document.getElementById(input.id + '-err');
    if (error) trigger.setAttribute('aria-describedby', error.id);
    var label = (input.closest('.modal-form-group') || wrap.parentElement).querySelector('label');
    var name = label ? label.textContent.replace(/\s+/g, ' ').trim() : (input.type === 'date' ? 'Date' : 'Horaire');
    var value = input.type === 'date' && input.value ? _formaterDateFr(input.value) : input.value;
    trigger.setAttribute('aria-label', name + (value ? ' : ' + value : ' : choisir'));
  }
  function scan() {
    observer.disconnect();
    try {
      modal.querySelectorAll(selector).forEach(enhance);
      var end = (document.getElementById('stock-fin') || {}).value;
      modal.querySelectorAll('[data-hc-stock-fin-rappel]').forEach(function (el) {
        var text = 'Date de fin de stockage choisie à l’étape précédente : ' + (_formaterDateFr(end) || 'À renseigner');
        if (el.textContent !== text) el.textContent = text;
      });
    } finally { observer.observe(modal, {childList:true, subtree:true, attributes:true, attributeFilter:['disabled','aria-invalid']}); }
  }
  var observer = new MutationObserver(scan);
  modal.addEventListener('change', scan);
  scan();
  // La fermeture du calendrier ne doit pas redonner le focus au champ natif.
  window._hcFocusApresDate = function (input) {
    var button = input.parentElement.querySelector('.hc-picker-trigger');
    if (button && !button.disabled) button.focus({preventScroll:true});
  };

  // Fond indépendant de visualViewport : Safari révèle une partie du
  // viewport de mise en page sous sa barre translucide lorsque le clavier
  // réduit la zone de saisie. Cette surface doit rester opaque en entier.
  var backdrop = document.createElement('div');
  backdrop.id = 'hc-client-mobile-backdrop';
  backdrop.hidden = true;
  backdrop.setAttribute('aria-hidden', 'true');
  document.body.appendChild(backdrop);
  var locked = false, pageY = 0, frame = 0;
  function updateViewport() {
    frame = 0;
    var mobile = window.matchMedia('(max-width:720px)').matches;
    var publicOpen = mobile && modal.classList.contains('open') && !document.body.classList.contains('hc-integre');
    backdrop.hidden = !publicOpen;
    if (publicOpen && !locked) {
      pageY = window.scrollY; locked = true;
      document.body.style.setProperty('--hc-page-y', -pageY + 'px');
      document.documentElement.classList.add('hc-client-mobile-open');
    } else if (!publicOpen && locked) {
      locked = false;
      document.documentElement.classList.remove('hc-client-mobile-open');
      document.body.style.removeProperty('--hc-page-y');
      window.scrollTo(0, pageY);
    }
    if (!publicOpen) return;
    var vv = window.visualViewport;
    modal.style.setProperty('--hc-visible-top', (vv ? vv.offsetTop : 0) + 'px');
    modal.style.setProperty('--hc-visible-height', (vv ? vv.height : window.innerHeight) + 'px');
  }
  function scheduleViewport() { if (!frame) frame = requestAnimationFrame(updateViewport); }
  new MutationObserver(scheduleViewport).observe(modal, {attributes:true,attributeFilter:['class']});
  window.addEventListener('resize', scheduleViewport);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scheduleViewport);
    window.visualViewport.addEventListener('scroll', scheduleViewport);
  }
  updateViewport();
})();
