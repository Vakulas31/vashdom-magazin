/* Локальная проверка журнала. Включается только на 127.0.0.1 или localhost
   и только с ?vd_local_fixture=1. На сайте магазина ничего не делает и
   запросы в базу не подменяет. Имена ниже учебные. */
(function (factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.VdLocalFixture = api;
  if (typeof window !== 'undefined' && api.allow(window.location)) api.install();
})(function () {
  function allow(loc) {
    loc = loc || { hostname: '', search: '' };
    var host = String(loc.hostname || '');
    if (host !== '127.0.0.1' && host !== 'localhost') return false;
    return /(?:^|[?&])vd_local_fixture=1(?:&|$)/.test(String(loc.search || ''));
  }
  function ymd(d) {
    d = d || new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function b64url(obj) {
    var s = btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    return s;
  }
  function install() {
    if (typeof window === 'undefined' || !allow(window.location) || window.__vdFixtureOn) return;
    window.__vdFixtureOn = true;
    var shifts = [
      { id: 1, work_date: '2026-11-18', manager: 'Проверка Анна' },
      { id: 2, work_date: '2026-11-19', manager: 'Проверка Борис' }
    ];
    var cards = [
      { id: 11, supplier: 'Учебный', factory: 'Учебная', model: 'Кровать пример', variant: '', item_kind: 'кровать', note: '' },
      { id: 12, supplier: 'Учебный', factory: 'МИФ', model: 'Ларго', variant: '800', item_kind: 'другое', note: 'Вид: шкаф. учебная строка, не из магазина' },
      { id: 13, supplier: 'Учебный', factory: 'МИФ', model: 'Элегант', variant: '', item_kind: 'шкаф-купе', note: '' },
      { id: 14, supplier: 'Учебный', factory: 'МИФ', model: 'Флэш', variant: '', item_kind: 'пенал', note: '' }
    ];
    var nextId = 3;
    var rates = [
      { manager: 'Проверка Анна', rate_day: 1650, bonus_pct: 1 },
      { manager: 'Проверка Борис', rate_day: 1650, bonus_pct: 1 }
    ];
    try {
      localStorage.setItem('vd_auth', JSON.stringify({
        access_token: b64url({ alg: 'none', typ: 'JWT' }) + '.' + b64url({ sub: 'local-fixture' }) + '.local',
        refresh_token: 'local-only',
        expires_at: Date.now() + 60 * 60 * 1000,
        email: 'local-fixture@example.test'
      }));
      localStorage.setItem('vd_manager', 'Проверка Анна');
      localStorage.setItem('vd_manager_day', ymd());
      localStorage.setItem('vd_managers', JSON.stringify(['Проверка Анна', 'Проверка Борис']));
      localStorage.removeItem('vd_shift_unsaved');
    } catch (e) {}
    function tableOf(url) {
      var m = String(url).match(/\/rest\/v1\/([^?]+)/);
      return m ? decodeURIComponent(m[1]) : '';
    }
    function queryOf(url) {
      var i = String(url).indexOf('?');
      return i < 0 ? '' : String(url).slice(i + 1);
    }
    function filterShifts(qs) {
      var parts = String(qs || '').split('&');
      return shifts.filter(function (r) {
        for (var i = 0; i < parts.length; i++) {
          var m = parts[i].match(/^work_date=(eq|gte|gt|lt|lte)\.(.+)$/);
          if (!m) continue;
          var d = decodeURIComponent(m[2]);
          var v = String(r.work_date);
          if (m[1] === 'eq' && v !== d) return false;
          if (m[1] === 'gte' && v < d) return false;
          if (m[1] === 'gt' && v <= d) return false;
          if (m[1] === 'lt' && v >= d) return false;
          if (m[1] === 'lte' && v > d) return false;
        }
        return true;
      });
    }
    function json(data, status) {
      return Promise.resolve(new Response(data == null ? '' : JSON.stringify(data), {
        status: status || 200,
        headers: { 'Content-Type': 'application/json' }
      }));
    }
    var nativeFetch = window.fetch;
    window.fetch = function (url, opts) {
      var u = String(url || '');
      if (u.indexOf('supabase') < 0 && u.indexOf('/auth/v1/') < 0) {
        return nativeFetch.apply(window, arguments);
      }
      opts = opts || {};
      var method = String(opts.method || 'GET').toUpperCase();
      var table = tableOf(u);
      var qs = queryOf(u);
      if (table === 'product_cards') {
        if (method === 'GET') return json(cards);
        if (method === 'PATCH') {
          var body = JSON.parse(opts.body || '{}');
          var keys = Object.keys(body);
          if (keys.length !== 1 || keys[0] !== 'item_kind') {
            return json({ message: 'В карточку пришло не только поле вида' }, 400);
          }
          if (!window.ProductCardKinds || !window.ProductCardKinds.isItemKind(body.item_kind)) {
            return json({ message: 'item_kind check violation', code: '23514' }, 400);
          }
          var idm = qs.match(/id=eq\.([^&]+)/);
          var id = idm ? decodeURIComponent(idm[1]) : '';
          var found = null;
          cards.forEach(function (r) {
            if (String(r.id) === String(id)) {
              r.item_kind = body.item_kind;
              found = r;
            }
          });
          return json(found ? [found] : []);
        }
      }
      if (table === 'manager_days') {
        if (method === 'GET') return json(filterShifts(qs));
        if (method === 'POST') {
          var body = JSON.parse(opts.body || '{}');
          var item = { id: nextId++, work_date: body.work_date, manager: body.manager };
          if (body.time_from || body.time_to || Object.keys(body).sort().join(',') !== 'manager,work_date') {
            return json({ message: 'В смену пришло лишнее поле' }, 400);
          }
          shifts.push(item);
          return json([item]);
        }
        if (method === 'PATCH') {
          var patch = JSON.parse(opts.body || '{}');
          var idm = qs.match(/id=eq\.([^&]+)/);
          var id = idm ? decodeURIComponent(idm[1]) : '';
          var found = null;
          shifts.forEach(function (r) {
            if (String(r.id) === String(id)) {
              r.work_date = patch.work_date;
              r.manager = patch.manager;
              found = r;
            }
          });
          return json(found ? [found] : []);
        }
        if (method === 'DELETE') {
          var dm = qs.match(/id=eq\.([^&]+)/);
          var did = dm ? decodeURIComponent(dm[1]) : '';
          shifts = shifts.filter(function (r) { return String(r.id) !== String(did); });
          return json(null);
        }
      }
      if (method !== 'GET') return json([]);
      if (table === 'app_roles') return json([{ role: 'owner', user_id: 'local-fixture' }]);
      if (table === 'staff_rates') return json(rates);
      if (table === 'app_settings') return json([{ key: 'markup_pct', value: '50' }]);
      if (table === 'orders') return json([]);
      return json([]);
    };
    function bannerText() {
      var lines = ['Локальная проверка журнала v8.33. Это не сайт магазина. Запросы в базу не уходят. Имена учебные.'];
      if (window.VariantMatch && window.VariantMatch.shopQty) {
        var hall = [
          { name: 'Матрас Prime Hit 160×200', qty: 2, dims: '' },
          { name: 'Матрас 90×200 Prime Hit', qty: 1, dims: '' }
        ];
        var q90 = window.VariantMatch.shopQty({ product_name: 'Матрас 200*090 Prime Hit' }, hall);
        var q120 = window.VariantMatch.shopQty({ product_name: 'Матрас 200*120 Prime Hit' }, hall);
        lines.push('Остаток в поиске: Prime Hit 90×200 — ' + q90 + ', 120×200 — ' + q120 + '.');
      } else lines.push('Модуль размера не загрузился.');
      if (window.priceMatrix && window.priceMatrix.dropEchoRows) {
        var kept = window.priceMatrix.dropEchoRows([
          { supplier: 'Учебный', factory: '', sheet_name: 'лист', product_name: 'Стол', article: 'вариант 4 · ПКС', price_opt: 6700, _fromEmptyHeader: true },
          { supplier: 'Учебный', factory: '', sheet_name: 'лист', product_name: 'Стол', article: '2 группа · ПКС', price_opt: 6700 },
          { supplier: 'Учебный', factory: '', sheet_name: 'лист', product_name: 'Стол', article: 'вариант4 · ПКС', price_opt: 6700 },
          { supplier: 'Учебный', factory: '', sheet_name: 'лист', product_name: 'Стол', article: 'Цена · ПКС', price_opt: 6700 }
        ]).map(function (r) { return r.article; });
        lines.push('Матрица оставила: ' + kept.join(', ') + '.');
      } else lines.push('Модуль матрицы не загрузился.');
      return lines.join(' ');
    }
    function paintBanner() {
      var bar = document.getElementById('vd-local-banner');
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'vd-local-banner';
        bar.style.cssText = 'background:#fff3e0;border-bottom:1px solid #e6c284;padding:10px 16px;font-size:13px;line-height:1.45';
        if (document.body.firstChild) document.body.insertBefore(bar, document.body.firstChild);
        else document.body.appendChild(bar);
      }
      bar.textContent = bannerText();
    }
    document.addEventListener('DOMContentLoaded', function () {
      paintBanner();
      var n = 0;
      var timer = setInterval(function () {
        n++;
        paintBanner();
        if (window.allOrders && window._vdRoleReady && typeof window.showPage === 'function') {
          window._pinOkAt = Date.now();
          var ov = document.getElementById('auth-overlay');
          if (ov) ov.style.display = 'none';
          window.showPage('stats');
          clearInterval(timer);
          setTimeout(paintBanner, 400);
        }
        if (n > 80) clearInterval(timer);
      }, 100);
    });
  }
  return { allow: allow, install: install };
});
