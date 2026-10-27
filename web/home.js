// An update that throws before it is ready is rolled back by the TV (see WebHome.java).
window.onerror = function (message, source, line) { window.familyError = message + ' (' + source + ':' + line + ')'; };
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  // The scaled page is larger than the WebView viewport; focusing must never scroll it.
  var still = { preventScroll: true };

  // Older WebViews only know the pre-2022 spelling of Kyiv.
  var TZ = (function () {
    var names = ['Europe/Kyiv', 'Europe/Kiev'];
    for (var i = 0; i < names.length; i++) {
      try { new Intl.DateTimeFormat('en-GB', { timeZone: names[i] }); return names[i]; } catch (_) {}
    }
    return undefined;
  })();
  window.FAMILY_TZ = TZ;

  function read(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (_) { return null; } }
  // config.json of the web part, with this TV's own section applied (see /api/config).
  var config = {}, about = {}, screensaver = '';
  // The parents' house is in queue 3.1 (config.json); a choice made in the settings overrides it.
  var queue = localStorage.getItem('family.queue') || '3.1';
  if (!/^[1-6]\.[12]$/.test(queue)) queue = '3.1';
  var mapSource = localStorage.getItem('family.map') || 'neptun';
  var data = { weather: read('family.weather'), power: read('family.power'), rates: read('family.rates'), address: read('family.address') };
  var failed = { weather: false, power: false, rates: false, address: false };
  // Minutes between checks of each source while the home screen is visible.
  var every = { weather: 20, power: 5, rates: 15, address: 5 };
  var timer = null, running = true, previousFocus = null, loading = {};

  function fit() {
    var scale = Math.min(innerWidth / 1280, innerHeight / 720), home = $('home');
    home.style.transform = 'scale(' + scale + ')';
    home.style.left = (innerWidth - 1280 * scale) / 2 + 'px';
    home.style.top = (innerHeight - 720 * scale) / 2 + 'px';
  }
  function format(options, date) { options.timeZone = TZ; return new Intl.DateTimeFormat('uk-UA', options).format(date || new Date()); }
  function hour() { return Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(new Date())) % 24; }
  function stamp(time) { return format({ hour: '2-digit', minute: '2-digit', hour12: false }, new Date(time)); }
  function age(time) { return Math.max(0, Math.floor((Date.now() - time) / 60000)); }
  function number(value, digits) { return value.toFixed(digits).replace('.', ','); }
  function grouped(value) { return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }

  function clock() {
    $('clock').textContent = format({ hour: '2-digit', minute: '2-digit', hour12: false });
    $('date').textContent = format({ weekday: 'long', day: 'numeric', month: 'long' });
    var h = hour(), scene = h >= 5 && h < 8 ? 'dawn' : h >= 8 && h < 17 ? 'valley' : h >= 17 && h < 20 ? 'sunset' : 'lake';
    // New Year season, as on Roman's box: 1 December to 15 January, day pictures 7:00 to 18:00.
    var day = Number(format({ day: 'numeric' })), month = Number(format({ month: 'numeric' }));
    if (month === 12 || (month === 1 && day <= 15)) scene = h >= 7 && h < 18 ? 'festive-day' : 'festive-night';
    if ($('bg').dataset.scene !== scene) { $('bg').dataset.scene = scene; $('bg').style.backgroundImage = 'url(bg/' + scene + '.jpg)'; }
  }

  function sky(code, day) {
    if (code === 0) return ['Ясно', day ? 'clear-day' : 'clear-night'];
    if (code <= 2) return ['Мінлива хмарність', day ? 'partly-day' : 'partly-night'];
    if (code === 3) return ['Хмарно', 'overcast'];
    if (code <= 48) return ['Туман', 'fog'];
    if (code <= 57) return ['Мряка', 'rain'];
    if (code <= 67) return ['Дощ', 'rain'];
    if (code <= 77) return ['Сніг', 'snow'];
    if (code <= 82) return ['Злива', 'rain'];
    if (code <= 86) return ['Снігопад', 'snow'];
    return ['Гроза', 'storm'];
  }
  function bindWeather() {
    var w = data.weather;
    if (!w || !w.data) { if (failed.weather) { $('weather-text').textContent = 'Погода недоступна'; $('weather-range').textContent = 'Немає зв’язку'; } return; }
    var c = w.data.current, d = w.data.daily, temp = Number(c.temperature_2m);
    if (!isFinite(temp)) return;
    var look = sky(Number(c.weather_code), Number(c.is_day) === 1);
    $('temperature').textContent = Math.round(temp) + '°';
    $('weather-text').textContent = look[0];
    var photo = 'url(weather/' + look[1] + '.jpg)';
    if ($('weather-photo').style.backgroundImage.indexOf(look[1]) < 0) $('weather-photo').style.backgroundImage = photo;
    var range = 'мін ' + Math.round(d.temperature_2m_min[0]) + '° · макс ' + Math.round(d.temperature_2m_max[0]) + '°';
    var old = age(w.fetchedAt);
    $('weather-range').textContent = old >= 60 || failed.weather ? range + ' · ' + old + ' хв тому' : range;
  }

  function bindRates() {
    var r = data.rates;
    if (!r || !r.data) { if (failed.rates) $('rates-age').textContent = 'Курси недоступні · немає зв’язку'; return; }
    var v = r.data;
    if (typeof v.usd === 'number') $('usd').textContent = number(v.usd, 2) + ' ₴';
    if (typeof v.eur === 'number') $('eur').textContent = number(v.eur, 2) + ' ₴';
    if (typeof v.btc === 'number') {
      $('btc').textContent = '$' + grouped(v.btc);
      var change = Number(v.btcChange) || 0, mark = $('btc-change');
      mark.textContent = (change >= 0 ? '▲ ' : '▼ ') + number(Math.abs(change), 1) + '%';
      mark.className = change >= 0 ? 'up' : 'down';
    }
    var note = 'НБУ' + (v.nbuDate ? ' на ' + v.nbuDate.slice(0, 5) : '') + ' · BTC CoinGecko';
    var old = age(r.fetchedAt);
    $('rates-age').textContent = old >= 180 || failed.rates ? note + ' · оновлено ' + stamp(r.fetchedAt) : note;
  }

  function bindPower() {
    $('queue-label').textContent = 'Черга ' + queue;
    var p = data.power, slots = [];
    if (p && p.html) {
      var result = Power.parse(p.html, queue), stale = age(p.fetchedAt) >= 15 || failed.power;
      $('power-title').textContent = stale ? 'Дані потребують оновлення' : result.title;
      $('power-description').textContent = stale ? 'Остання перевірка о ' + stamp(p.fetchedAt) + '. Поточний стан невідомий.' : result.description;
      if (!stale && result.slots) slots = result.slots;
      $('power-age').textContent = (failed.power ? 'Немає зв’язку · ' : 'Перевірено ') + stamp(p.fetchedAt);
    } else if (failed.power) {
      $('power-title').textContent = 'Немає зв’язку з оператором';
      $('power-description').textContent = 'Поточний стан невідомий. Перевірте інтернет або відкрийте сайт Житомиробленерго.';
      $('power-age').textContent = 'Немає даних';
    }
    var signature = slots.join(','), line = $('timeline');
    if (line.dataset.signature === signature && line.children.length) return;
    line.dataset.signature = signature; clear(line);
    for (var i = 0; i < 48; i++) { var cell = document.createElement('span'); cell.className = 'slot ' + (slots[i] || 'unknown'); line.appendChild(cell); }
  }

  function kyivTime(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return format({ hour: '2-digit', minute: '2-digit', hour12: false }, d) + ', ' + format({ day: '2-digit', month: '2-digit' }, d);
  }
  // typeOff values of the operator's outage records.
  var outageNames = ['Планове відключення', 'Аварійне відключення', 'Оперативні перемикання', 'Планове відключення'];
  function bindAddress() {
    var a = data.address, dot = $('address-dot');
    if (!a || !a.data) {
      if (failed.address) {
        $('address-title').textContent = 'Немає зв’язку з оператором';
        $('address-text').textContent = 'Стан за адресою невідомий. Перевірте інтернет.';
      }
      return;
    }
    var now = a.data.now || [];
    var planned = (a.data.planned || []).filter(function (p) { return new Date(p.to).getTime() > Date.now(); });
    if (now.length) {
      var o = now[0], text = 'З ' + kyivTime(o.from) + '. ';
      text += new Date(o.to).getTime() < Date.now() ? 'Відновлення планувалося на ' + kyivTime(o.to) + ', оператор ще не оновив.' : 'Відновлення орієнтовно ' + kyivTime(o.to) + '.';
      if (o.reason) text += ' Причина: ' + o.reason + '.';
      $('address-title').textContent = outageNames[o.type] || 'Відключення';
      $('address-text').textContent = text;
      dot.style.background = '#e7a55d';
    } else {
      $('address-title').textContent = 'Відключень не зареєстровано';
      $('address-text').textContent = 'Оператор не повідомляє про відключення за цією адресою.';
      dot.style.background = '#5fae8c';
    }
    if (age(a.fetchedAt) >= 20 || failed.address) {
      dot.style.background = '#8e877e';
      $('address-text').textContent += ' Дані на ' + stamp(a.fetchedAt) + '.';
    }
    var p = planned[0];
    $('address-next').textContent = p ? 'Заплановано: ' + kyivTime(p.from) + ' – ' + kyivTime(p.to) + (p.reason ? ', ' + p.reason : '') : '';
  }

  function bindAll() { bindWeather(); bindRates(); bindPower(); bindAddress(); }

  function fetchData(name) {
    if (loading[name]) return;
    loading[name] = true;
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timeout = setTimeout(function () { if (controller) controller.abort(); }, 35000);
    fetch('/api/' + name, { cache: 'no-store', signal: controller ? controller.signal : undefined })
      .then(function (r) { if (!r.ok) throw Error('source'); return r.json(); })
      .then(function (result) {
        if (!result.ok || !result.fetchedAt) throw Error('source');
        if (name === 'power' ? typeof result.html !== 'string' : !result.data) throw Error('shape');
        data[name] = result; failed[name] = false;
        try { localStorage.setItem('family.' + name, JSON.stringify(result)); } catch (_) {}
      })
      .catch(function () { failed[name] = true; })
      .then(function () { clearTimeout(timeout); loading[name] = false; bindAll(); });
  }
  function refresh(force) {
    if (!running) return;
    ['weather', 'power', 'rates', 'address'].forEach(function (name) {
      var d = data[name], wait = failed[name] ? 2 : every[name];
      if (force || !d || !d.fetchedAt || age(d.fetchedAt) >= wait) fetchData(name);
    });
  }

  function tiles() { return Array.prototype.slice.call(document.querySelectorAll('.apps .tile')); }
  function firstTile() { return tiles()[0] || $('settings-button'); }

  // Tiles from config.json: { pkg } or { find: part of the package or label }, title, caption,
  // fallback "browser" (built-in browser while the app is missing) and art (picture while it is missing).
  function buildTiles(list) {
    if (!list || !list.length) return;
    var section = document.querySelector('.apps'); clear(section);
    list.forEach(function (t, i) {
      var b = document.createElement('button'); b.className = 'tile'; b.id = t.id || 'tile-' + i;
      b.setAttribute('aria-label', t.title || '');
      b.dataset.action = 'app';
      ['pkg', 'find', 'title', 'fallback', 'art'].forEach(function (k) { if (t[k]) b.dataset[k] = t[k]; });
      var art = document.createElement('span'); art.className = 'art';
      var img = document.createElement('img'); img.alt = ''; art.appendChild(img);
      var fb = document.createElement('span'); fb.className = 'fallback'; fb.textContent = t.title || ''; art.appendChild(fb);
      var label = document.createElement('span'); label.className = 'label'; label.textContent = t.title || '';
      var small = document.createElement('small'); small.textContent = t.caption || ''; label.appendChild(small);
      b.appendChild(art); b.appendChild(label); section.appendChild(b);
    });
    lastTile = null;
  }

  function loadArt() {
    fetch('/api/packages', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (apps) {
      tiles().forEach(function (tile) {
        var d = tile.dataset, img = tile.querySelector('img'), pkg = null;
        apps.forEach(function (a) {
          if (pkg) return;
          if (d.pkg ? a.pkg === d.pkg : d.find && (a.pkg + ' ' + a.label).toLowerCase().indexOf(d.find.toLowerCase()) >= 0) pkg = a.pkg;
        });
        // Without «БРАУЗЕР» installed the tile opens the built-in browser and keeps its own art.
        if (pkg) {
          tile.classList.remove('missing');
          img.onerror = function () { if (d.art) img.src = d.art; else tile.classList.add('missing'); };
          img.src = 'art/' + pkg + '.png?t=' + Date.now();
        } else if (d.art) img.src = d.art;
        else tile.classList.add('missing');
      });
    }).catch(function () {});
  }

  function maps() { return config.maps || { neptun: { title: 'Карта NEPTUN', label: 'NEPTUN · онлайн-моніторинг, не офіційне оповіщення' } }; }
  function showMapSource() {
    if (!maps()[mapSource]) mapSource = Object.keys(maps())[0];
    $('map-source').textContent = maps()[mapSource].label || maps()[mapSource].title || '';
  }

  function action(name, params) {
    var query = [];
    for (var key in params || {}) query.push(encodeURIComponent(key) + '=' + encodeURIComponent(params[key]));
    location.href = 'xiaomytv://' + name + (query.length ? '?' + query.join('&') : '');
  }

  // Timers and the home-screen switch, read from the TV each time the settings menu opens.
  var tv = null;
  function refreshSettings() {
    fetch('/api/tv', { cache: 'no-store' }).then(function (r) { return r.json(); })
      .then(function (state) { tv = state; }).catch(function () { tv = null; })
      .then(function () {
        if ($('modal').hidden || $('dialog-title').textContent !== 'Налаштування') return;
        var active = document.activeElement;
        openModal('settings', true, active && active.tagName === 'BUTTON' ? active.textContent : null);
      });
  }
  var dimChoices = [[1, '1 хв'], [2, '2 хв'], [5, '5 хв'], [10, '10 хв'], [0, 'Не затемнювати']];
  var screensaverChoices = [[5, '5 хв'], [10, '10 хв'], [15, '15 хв'], [30, '30 хв'], [0, 'Без заставки']];
  var sleepChoices = [[30, '30 хв'], [60, '1 год'], [120, '2 год'], [240, '4 год'], [-1, 'Ніколи']];

  function openModal(type, fresh, focusLabel) {
    if ($('modal').hidden) previousFocus = document.activeElement;
    var body = $('dialog-body'); clear(body);
    $('dialog-title').textContent = type === 'queue' ? 'Моя черга відключень' : type === 'stock' ? 'Стандартний екран' : 'Налаштування';
    function paragraph(text) { var p = document.createElement('p'); p.textContent = text; body.appendChild(p); }
    function group(className) { var g = document.createElement('div'); g.className = className || 'buttons'; body.appendChild(g); return g; }
    function button(parent, text, cb, selected) {
      var b = document.createElement('button'); b.textContent = text; b.className = 'pill' + (selected ? ' selected' : '');
      b.addEventListener('click', cb); parent.appendChild(b); return b;
    }
    if (type === 'queue') {
      paragraph((about.address ? about.address + '. ' : '') + 'Номер черги є на сайті Житомиробленерго (пошук за адресою) або в особовому рахунку.');
      var grid = group('queues');
      for (var main = 1; main <= 6; main++) for (var sub = 1; sub <= 2; sub++) (function (value) {
        button(grid, value, function () { queue = value; localStorage.setItem('family.queue', value); bindPower(); closeModal(); }, queue === value);
      })(main + '.' + sub);
      button(group(), 'Знайти чергу на сайті оператора ↗', function () { action('power'); });
      paragraph('Під час аварійних відключень погодинні графіки можуть не діяти. Сірі клітинки означають, що перевірених даних немає.');
    } else if (type === 'stock') {
      paragraph('Кнопка «Додому» відкриватиме стандартний екран Xiaomi. Цей екран залишиться у списку програм як «Xiaomi TV · Родина»: щоб повернутися, відкрийте його, натисніть MENU і «Увімкнути екран Родина».');
      var choice = group();
      button(choice, 'Скасувати', function () { openModal('settings'); });
      button(choice, 'Так, повернути стандартний екран', function () { closeModal(); action('shell', { mode: 'stock' }); });
    } else {
      var main = group();
      button(main, 'Моя черга' + (queue ? ': ' + queue : ''), function () { openModal('queue'); });
      button(main, 'Оновити погоду, курси й світло', function () { refresh(true); closeModal(); });
      button(main, 'Налаштування телевізора', function () { action('settings'); });
      button(main, 'Кнопки пульта', function () { action('remote'); });

      var timers = function (screensaver, sleep) {
        action('timers', { screensaver: screensaver, sleep: sleep });
        setTimeout(refreshSettings, 500);
      };
      paragraph('Затемнення головного екрана, коли пультом не користуються:');
      var dim = group();
      dimChoices.forEach(function (c) {
        button(dim, c[1], function () {
          dimMinutes = c[0]; localStorage.setItem('family.dim', String(c[0])); openModal('settings', true, c[1]);
        }, dimMinutes === c[0]);
      });
      var savers = config.screensavers || [];
      if (savers.length) {
        paragraph('Заставка:');
        var kind = group();
        savers.forEach(function (s) {
          button(kind, s.title, function () {
            screensaver = s.id; action('screensaver', { id: s.id }); openModal('settings', true, s.title);
          }, screensaver === s.id);
        });
        button(kind, 'Показати зараз', function () { action('screensaver', { id: screensaver, preview: 1 }); });
      }
      if (tv && tv.canWrite) {
        paragraph('Заставка вмикається, коли пультом не користуються:');
        var saver = group();
        screensaverChoices.forEach(function (c) { button(saver, c[1], function () { timers(c[0], tv.sleep); }, tv.screensaver === c[0]); });
        paragraph('Телевізор вимикається, якщо ним не користуються:');
        var sleep = group();
        sleepChoices.forEach(function (c) { button(sleep, c[1], function () { timers(tv.screensaver, c[0]); }, tv.sleep === c[0]); });
      } else if (tv) {
        paragraph('Час заставки й вимкнення можна змінити після встановлення з комп’ютера.');
      }

      if (tv && !tv.familyHome) {
        button(group(), 'Увімкнути екран Родина', function () { action('shell', { mode: 'family' }); setTimeout(refreshSettings, 500); });
      } else if (tv && tv.stockHome) {
        button(group(), 'Повернути стандартний екран Xiaomi', function () { openModal('stock'); });
      } else if (tv) {
        paragraph('Стандартний екран Xiaomi вимкнено під час встановлення. Повернути його можна з комп’ютера (restore).');
      }

      paragraph('Карта тривог: NEPTUN показує повідомлення про повітряні загрози, alerts.in.ua є запасним варіантом. Це додатковий моніторинг, а не офіційне оповіщення.');
      var sources = group();
      Object.keys(maps()).forEach(function (name) {
        button(sources, maps()[name].title || name, function () {
          mapSource = name; localStorage.setItem('family.map', name); showMapSource(); closeModal();
        }, mapSource === name);
      });
      paragraph('Погода: Open-Meteo. Курси: НБУ, біткоїн: CoinGecko. Світло: сайт Житомиробленерго.');
      paragraph('Версія: програма ' + (about.apk || '?') + ', екран ' + (about.web ? about.web : 'вбудований') + '. Оновлення приходять самі.');
      button(group(), 'Перевірити оновлення', function () { action('update'); closeModal(); });
      if (!fresh) refreshSettings();
    }
    $('modal').hidden = false;
    var buttons = Array.prototype.slice.call(body.querySelectorAll('button'));
    var target = focusLabel && buttons.filter(function (b) { return b.textContent === focusLabel; })[0];
    // In the queue list start on the current queue, so a stray OK does not change it.
    if (!target && type === 'queue') target = body.querySelector('.selected');
    (target || buttons[0]).focus(still);
    if (focusLabel) (target || buttons[0]).scrollIntoView({ block: 'nearest' });
  }
  function closeModal() {
    $('modal').hidden = true;
    if (previousFocus && document.contains(previousFocus)) previousFocus.focus(still); else firstTile().focus(still);
  }

  document.addEventListener('click', function (event) {
    var target = event.target.closest('button'); if (!target) return;
    if (target.dataset.ui) { if (target.dataset.ui === 'close') closeModal(); else openModal(target.dataset.ui); }
    else if (target.dataset.action) {
      var name = target.dataset.action, params = {};
      if (name === 'app') ['pkg', 'find', 'title', 'fallback'].forEach(function (k) { if (target.dataset[k]) params[k] = target.dataset[k]; });
      if (name === 'map') params.source = target.dataset.source || mapSource;
      action(name, params);
    }
  });

  function candidates() {
    return Array.prototype.filter.call(($('modal').hidden ? $('home') : $('modal')).querySelectorAll('button'), function (b) {
      return b.getBoundingClientRect().width > 0 && !b.disabled;
    });
  }
  function focusMove(key) {
    var buttons = candidates(), active = document.activeElement;
    if (buttons.indexOf(active) < 0) { (buttons[0] || firstTile()).focus(still); return; }
    var rect = active.getBoundingClientRect(), ax = rect.left + rect.width / 2, ay = rect.top + rect.height / 2, best = null;
    var horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
    // Nearest row (or column) in the pressed direction first, then the closest button within it,
    // so a short button at the start of the next row is never skipped for one further down.
    var options = [];
    buttons.forEach(function (b) {
      if (b === active) return;
      var r = b.getBoundingClientRect();
      var gap = key === 'ArrowRight' ? r.left - rect.right : key === 'ArrowLeft' ? rect.left - r.right :
        key === 'ArrowDown' ? r.top - rect.bottom : rect.top - r.bottom;
      if (gap < -4) return;
      // Left/right stay within the current row; up/down prefer the button aligned with this one's left edge.
      var overlap = horizontal ? r.top < rect.bottom && r.bottom > rect.top : r.left < rect.right && r.right > rect.left;
      var side = horizontal ? Math.abs(r.top + r.height / 2 - ay) :
        overlap ? Math.abs(r.left - rect.left) : 10000 + Math.abs(r.left + r.width / 2 - ax);
      options.push({ button: b, gap: Math.max(0, gap), side: side, overlap: overlap });
    });
    if (horizontal) options = options.filter(function (o) { return o.overlap; });
    if (options.length) {
      var nearest = Math.min.apply(null, options.map(function (o) { return o.gap; }));
      best =options.filter(function (o) { return o.gap <= nearest + 12; }).sort(function (a, b) { return a.side - b.side; })[0].button;
    }
    if (best) { best.focus({ preventScroll: true }); if (!$('modal').hidden) best.scrollIntoView({ block: 'nearest' }); }
  }
  // The home screen dims after a few idle minutes, before the screensaver; the first key only wakes it.
  var storedDim = localStorage.getItem('family.dim');
  var dimMinutes = storedDim === null ? 2 : Number(storedDim);
  if (!(dimMinutes >= 0)) dimMinutes = 2;
  var lastInput = Date.now();
  function wake() {
    lastInput = Date.now();
    if (!document.body.classList.contains('dimmed')) return false;
    document.body.classList.remove('dimmed');
    return true;
  }
  setInterval(function () {
    if (running && dimMinutes > 0 && $('modal').hidden && Date.now() - lastInput >= dimMinutes * 60000) document.body.classList.add('dimmed');
  }, 15000);

  document.addEventListener('keydown', function (event) {
    var key = event.key || '';
    if (wake()) { event.preventDefault(); return; }
    if (key.indexOf('Arrow') === 0) { event.preventDefault(); focusMove(key); }
    else if (key === 'Enter' || key === ' ') {
      event.preventDefault();
      if (!event.repeat && document.activeElement && document.activeElement.tagName === 'BUTTON') document.activeElement.click();
    } else if (key === 'Escape' || key === 'Backspace') { event.preventDefault(); window.familyBack(); }
  });

  window.familyBack = function () { if (wake()) return; if (!$('modal').hidden) closeModal(); else firstTile().focus(still); };
  window.familyMenu = function () { if (wake()) return; if ($('modal').hidden) openModal('settings'); else closeModal(); };
  window.familyHome = function () { wake(); if (!$('modal').hidden) $('modal').hidden = true; firstTile().focus(still); };
  // Android moves focus into the WebView on its own; put it back on the tile used last.
  var lastTile = null;
  $('home').addEventListener('focusin', function (event) { if (event.target.classList.contains('tile')) lastTile = event.target; });
  window.familyFocus = function () { if ($('modal').hidden) (lastTile || firstTile()).focus(still); };
  window.familyPause = function () { running = false; clearInterval(timer); };
  window.familyResume = function () {
    wake();
    if (running) return;
    running = true; clock(); bindAll(); loadArt(); refresh(false);
    timer = setInterval(tick, 30000);
  };
  function tick() { if (running) { clock(); bindAll(); refresh(false); } }

  window.addEventListener('resize', fit);
  window.addEventListener('scroll', function () { if (window.scrollX || window.scrollY) window.scrollTo(0, 0); });
  fit(); clock(); bindAll(); showMapSource(); refresh(false);
  firstTile().focus(still);
  timer = setInterval(tick, 30000);

  // Settings sent with the web part. Without them the page keeps the built-in tiles and still counts as started.
  fetch('/api/config', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (info) {
    about = info; config = info.config || {};
    // The address lives in the APK only, never in the public update channel.
    if (info.address) $('address-label').textContent = info.address.replace(/^Коростишів, /, '');
    if (!localStorage.getItem('family.queue') && /^[1-6]\.[12]$/.test(config.queue || '')) queue = config.queue;
    screensaver = info.screensaver || config.screensaver || ((config.screensavers || [])[0] || {}).id || '';
    var focused = document.activeElement && document.activeElement.classList.contains('tile');
    buildTiles(config.tiles);
    if (focused || !document.activeElement || document.activeElement === document.body) firstTile().focus(still);
  }).catch(function () {}).then(function () {
    showMapSource(); bindPower(); loadArt();
    window.familyStatus = { tiles: tiles().length, config: !!about.config };
    window.familyReady = true;
  });
})();
