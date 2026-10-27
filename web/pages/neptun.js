// Run by the app on the NEPTUN map page: frames Zhytomyr and Kyiv oblasts, arrows pan, OK toggles all of Ukraine.
(function () {
  if (window.familyKey) return;
  var REGION = [[27.1, 49.1], [32.3, 51.8]], UKRAINE = [[22.0, 44.3], [40.3, 52.4]], region = true;
  function map() { return window.__neptun && window.__neptun.map; }
  function frame() { var m = map(); if (m) { try { m.fitBounds(region ? REGION : UKRAINE, { padding: 30, duration: 600 }); } catch (e) {} } }
  // The map object appears a moment after the page loads.
  (function wait(n) { if (map()) frame(); else if (n < 60) setTimeout(function () { wait(n + 1); }, 500); })(0);
  window.familyKey = function (key, repeat) {
    var m = map();
    if (!m) return;
    if (key === 'ok') { if (!repeat) { region = !region; frame(); } return; }
    var step = Math.round(innerWidth * (repeat > 3 ? 0.18 : 0.1));
    m.panBy([key === 'left' ? -step : key === 'right' ? step : 0, key === 'up' ? -step : key === 'down' ? step : 0], { duration: 250 });
  };
})();
