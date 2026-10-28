/* Une seule progression pilote la ligne et les repères qu'elle atteint. */
(function () {
  'use strict';
  var style = document.createElement('style');
  style.textContent = `
    .hero2-route{position:relative}
    .hero2-route .hero2-route-line{background:transparent;overflow:visible}
    .hero2-route .hero2-route-line::after,
    .loyalty-track .track-line::before,.loyalty-track .track-line::after{display:none!important}
    .hero2-route .hero2-route-dot,.hero2-panel-progress-stage,.loyalty-track .node-circle{
      animation:none!important;transition:none!important}
    .hero2-route .hero2-route-dot{position:relative;z-index:2;width:9px;height:9px;
      box-sizing:border-box;background:#202a33!important;border:2px solid rgba(245,242,234,.52)!important;
      opacity:1!important;box-shadow:none!important}
    .hero2-route .hero2-route-dot.hc-reached,.hero2-panel-progress-stage.hc-reached{
      background:var(--paper)!important;border-color:var(--accent)!important;
      box-shadow:0 0 0 4px rgba(229,72,77,.16),0 0 12px rgba(229,72,77,.5)!important}
    .hero2-panel-progress-fill,.hero2-panel-progress-marker{animation:none!important;opacity:1!important}
    .hc-sync-line{position:absolute;height:2px;background:rgba(245,242,234,.16);pointer-events:none}
    .hc-sync-fill{display:block;height:100%;background:linear-gradient(90deg,var(--accent) 0%,var(--accent) 90%,#fff 100%);
      box-shadow:0 0 7px rgba(229,72,77,.55)}
    .loyalty-track .track-line{overflow:visible;display:block}
    .loyalty-track .node-circle{border-color:rgba(255,255,255,.15);color:inherit;box-shadow:none;transform:none}
    .loyalty-track .node-circle.hc-reached{border-color:var(--accent);color:var(--accent);
      box-shadow:0 0 15px rgba(229,72,77,.3)}
  `;
  document.head.appendChild(style);
  var groups = [];
  document.querySelectorAll('.hero2-route, .loyalty-track').forEach(function (root) {
    var loyalty = root.classList.contains('loyalty-track');
    var nodes = Array.from(root.querySelectorAll(loyalty ? '.node-circle' : '.hero2-route-dot'));
    var line = loyalty ? root.querySelector('.track-line') : document.createElement('div');
    if (!line || nodes.length < 2) return;
    line.classList.add('hc-sync-line');
    if (!loyalty) root.appendChild(line);
    var fill = document.createElement('span'); fill.className = 'hc-sync-fill'; line.appendChild(fill);
    groups.push({root:root,nodes:nodes,line:line,fill:fill});
  });
  var reduced = matchMedia('(prefers-reduced-motion: reduce)');
  var origin = performance.now();
  // Exportée pour vérifier les seuils exacts à différentes largeurs.
  window._hcRendreProgressionVitrine = function (progress) {
    groups.forEach(function (g) {
      if (!g.root.getClientRects().length || !g.root.offsetWidth) return;
      var rect = g.root.getBoundingClientRect();
      var centers = g.nodes.map(function (n) { var r=n.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}; });
      var first=centers[0],last=centers[centers.length-1],vertical=Math.abs(last.y-first.y)>Math.abs(last.x-first.x);
      var width=vertical?last.y-first.y:last.x-first.x;
      g.line.style.left=(first.x-rect.left)+'px';g.line.style.right='auto';
      g.line.style.top=(first.y-rect.top-(vertical?0:1))+'px';
      g.line.style.width=(vertical?2:width)+'px';g.line.style.height=(vertical?width:2)+'px';
      g.fill.style.width=(vertical?100:progress*100)+'%';g.fill.style.height=(vertical?progress*100:100)+'%';
      g.line.dataset.direction=vertical?'vertical':'horizontal';
      centers.forEach(function(c,i){g.nodes[i].classList.toggle('hc-reached',(vertical?c.y-first.y:c.x-first.x) <= progress*width + 0.01);});
    });
    document.querySelectorAll('.hero2-panel-progress-track').forEach(function (track) {
      track.querySelector('.hero2-panel-progress-fill').style.width=(progress*100)+'%';
      track.querySelector('.hero2-panel-progress-marker').style.left=(progress*100)+'%';
      track.querySelector('.hero2-panel-progress-stage').classList.toggle('hc-reached',progress>=0.5);
    });
  };
  function frame(now) {
    var phase=((now-origin)%12000)/12000;
    window._hcRendreProgressionVitrine(reduced.matches ? 1 : Math.min(1,phase/0.85));
    if (!reduced.matches) requestAnimationFrame(frame);
  }
  reduced.addEventListener('change',function(){origin=performance.now();frame(origin);});
  window.addEventListener('resize',function(){if(reduced.matches)window._hcRendreProgressionVitrine(1);});
  frame(origin);
})();
