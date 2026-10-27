/* The operator may replace its page with an emergency notice at any time. */
(function (global) {
  'use strict';
  function kyivDay(now) {
    var parts = new Intl.DateTimeFormat('en-GB', { timeZone: global.FAMILY_TZ || 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now || new Date());
    var value = {}; parts.forEach(function (p) { value[p.type] = p.value; });
    return value.day + '.' + value.month + '.' + value.year;
  }
  function clean(element) { return (element.textContent || '').replace(/\s+/g, ' ').trim(); }
  function normalizeColor(value) { return value.toLowerCase().replace(/\s|!important/g, ''); }
  function parse(html, queue, now) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script,style,noscript').forEach(function (e) { e.remove(); });
    var text = clean(doc.body);
    var result = { state: 'unknown', slots: null, date: null, title: 'Перевірте графік оператора', description: 'Дані не розпізнано. Відкрийте офіційний сайт.', queue: queue || '' };
    if (/аварійн[іи]\s+(?:знеструмлення|відключення)/i.test(text) && /графіки[\s\S]{0,100}не\s+діють/i.test(text)) {
      result.state = 'emergency'; result.title = 'Аварійні відключення';
      result.description = 'Оператор повідомляє: погодинні графіки зараз не діють. Час повернення світла не визначено.';
      return result;
    }
    if (!queue) {
      result.state = 'choose'; result.title = 'Оберіть чергу будинку';
      result.description = 'У Коростишеві кілька черг. Знайдіть свою за адресою на сайті оператора та оберіть її тут.';
      return result;
    }
    // Interpret only an explicitly dated, complete half-hour table with an explicit legend.
    // Unknown styles, colours or a changed provider layout never become an all-green day.
    var today = kyivDay(now), table = null;
    doc.querySelectorAll('table').forEach(function (t) {
      if (clean(t).indexOf(today) >= 0 && t.querySelectorAll('td,th').length >= 48) table = t;
    });
    if (!table) {
      result.title = 'Графік на сьогодні недоступний';
      result.description = 'Не знайдено підтвердженого графіка на ' + today + '. Відкрийте сайт оператора.';
      return result;
    }
    var legend = {};
    function color(cell) {
      var c = cell.getAttribute('bgcolor') || cell.style.backgroundColor || '';
      if (c) return normalizeColor(c);
      return '';
    }
    doc.querySelectorAll('td,span,div').forEach(function (e) {
      var t = clean(e), c = color(e), parent = e.parentElement;
      if (!c || t.length > 110) return;
      if (!t && parent && clean(parent).length < 120) t = clean(parent);
      if (/можлив[еі]|ймовірн|може\s+бути/i.test(t)) legend[c] = 'possible';
      else if (/немає\s+(?:світла|електроенергії)|відсутн[яє]\s+електро|електроенергі[яї]\s+відсутня|без\s+світла|відключен[оа]|не\s+буде\s+світла/i.test(t)) legend[c] = 'off';
      else if (/електроенергія\s+є|світло\s+є|без\s+відключень|наявн[ае]\s+електро/i.test(t)) legend[c] = 'on';
    });
    var currentMain = '', found = null;
    table.querySelectorAll('tr').forEach(function (row) {
      var cells = Array.from(row.children).filter(function (e) { return /^(TD|TH)$/.test(e.tagName); });
      if (cells.length < 49 || cells.length > 50) return;
      var offset = cells.length - 48, prefix = cells.slice(0, offset).map(clean);
      var rowQueue;
      if (offset === 2 && /^[1-6]$/.test(prefix[0]) && /^[12]$/.test(prefix[1])) {
        currentMain = prefix[0]; rowQueue = currentMain + '.' + prefix[1];
      } else if (offset === 1 && /^[1-6]\.[12]$/.test(prefix[0])) rowQueue = prefix[0];
      else if (offset === 1 && currentMain && /^[12]$/.test(prefix[0])) rowQueue = currentMain + '.' + prefix[0];
      if (rowQueue !== queue) return;
      var slots = cells.slice(offset).map(function (c) {
        if (Number(c.getAttribute('colspan') || 1) !== 1) return null;
        return legend[color(c)] || null;
      });
      if (slots.length === 48 && slots.every(Boolean)) found = slots;
    });
    if (!found) {
      result.title = 'Графік потребує перевірки';
      result.description = 'Формат таблиці змінився або немає даних для черги ' + queue + '. Перевірте сайт оператора.';
      return result;
    }
    result.state = 'schedule'; result.date = today; result.slots = found;
    result.title = 'План на сьогодні · ' + queue;
    result.description = 'Зелений: за планом зі світлом. Помаранчевий: відключення. Штрихування: можливе. Аварії можуть змінити план.';
    return result;
  }
  global.Power = { parse: parse, kyivDay: kyivDay };
})(window);
