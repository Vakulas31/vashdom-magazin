// Сопоставление витрины и продаж со строкой прайса.
//
// Раньше «в зале» брало модель (латиница или кавычки) и не смотрело размер:
// витринный Prime Hit 160×200 помечал все ширины «Матрас 200*090…200 Prime Hit».
// «Hit» и «Prime» по отдельности тоже проходили внутрь «Prime Hit».
// Теперь остаток относится к той же модели и тому же размеру. Записи без размера
// не размазываются по размерам. 90×200 и 200×90 — один размер только у матраса
// и кровати. «Продавали» остаётся подсчётом этой же позиции: хвост «в комплекте»
// по-прежнему не мешает, но другая ширина и другая модель не складываются.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VariantMatch = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var TYPES = [
    ['наматрас', 'наматрас'], ['матрац', 'матрас'], ['матрас', 'матрас'], ['топпер', 'топпер'],
    ['кроват', 'кроват'], ['кресл', 'кресл'], ['диван', 'диван'], ['тахт', 'диван'],
    ['основан', 'основан'], ['траверс', 'траверс'], ['ламел', 'ламел'], ['ящик', 'ящик'],
    ['комод', 'комод'], ['тумб', 'тумб'], ['шкаф', 'шкаф'], ['стеллаж', 'стеллаж'],
    ['стол', 'стол'], ['стул', 'стул'], ['пуф', 'пуф'], ['банкет', 'банкет'],
    ['прихож', 'прихож'], ['зеркал', 'зеркал'], ['полк', 'полк']
  ];

  function norm(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  }
  function escRe(w) {
    return String(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  // «Кровать … — в комплекте: траверса 1400×2000» — это та же кровать.
  // Размер части после двоеточия к варианту не относится.
  function stripKit(s) {
    return String(s == null ? '' : s).replace(/\s+[—–-]\s+в комплекте:[\s\S]*$/i, '');
  }
  function wantsSwap(text) {
    return /матрас|матрац|наматрас|топпер|кроват|спальн/.test(norm(text));
  }
  function toCm(raw) {
    var n = parseInt(raw, 10);
    if (!isFinite(n)) return null;
    if (n >= 300) n = Math.round(n / 10);
    if (n < 40 || n > 400) return null;
    return n;
  }
  function sizeToken(nums, swap) {
    if (nums.length >= 3) return nums.slice(0, 3).join('x');
    if (nums.length === 2) {
      var a = nums[0], b = nums[1];
      return swap ? (a < b ? a + 'x' + b : b + 'x' + a) : (a + 'x' + b);
    }
    return '';
  }
  // Группы «200*090», «90×200», «1600х2000», «80×190/195/200», «800×2200×600».
  // Список «длина 186, 190, 195, 200» парой не является.
  function sizeKeysIn(text, swap) {
    var t = norm(text).replace(/(\d)\s*[xх×*]\s*(?=\d)/g, '$1x');
    var re = /\d{2,4}(?:x\d{2,4}){1,2}(?:\s*\/\s*\d{2,4})*/g;
    var keys = [], m, seen = {};
    while ((m = re.exec(t))) {
      var parts = m[0].split('x');
      var a = toCm(parts[0]);
      if (a == null) continue;
      var bRaw = (parts[1] || '').split(/\s*\/\s*/);
      var c = parts[2] ? toCm(String(parts[2]).split(/\s*\/\s*/)[0]) : null;
      for (var i = 0; i < bRaw.length; i++) {
        var b = toCm(bRaw[i]);
        if (b == null) continue;
        var key = c != null ? sizeToken([a, b, c], false) : sizeToken([a, b], swap);
        if (key && !seen[key]) { seen[key] = 1; keys.push(key); }
      }
    }
    keys.sort();
    return keys;
  }
  function variantSizes(name, dims, swapText) {
    var swap = wantsSwap(swapText == null ? (name || '') : swapText);
    var fromName = sizeKeysIn(stripKit(name || ''), swap);
    if (fromName.length) return fromName;
    return sizeKeysIn(dims || '', swap);
  }

  // Модель — кавычки («Лидс», «Эльба 2») или латиница (Prime Hit).
  // Без этого витрину со словами «комод 4 ящика» к прайсу не относим.
  function modelSig(name) {
    var n = norm(stripKit(name)), q = n.match(/["«“„]([^"»”“]{2,40})["»”“]/), toks, i;
    if (q) toks = q[1].split(/[\s\-]+/);
    else {
      toks = [];
      var raw = n.match(/[a-z][a-z0-9\-]*/g) || [];
      for (i = 0; i < raw.length; i++) {
        var bits = raw[i].split('-');
        for (var j = 0; j < bits.length; j++) if (bits[j].length >= 2) toks.push(bits[j]);
      }
    }
    var out = [];
    for (i = 0; i < toks.length; i++) {
      var w = String(toks[i]).replace(/[^а-яa-z0-9]/g, '');
      if (w.length >= 2 || /^\d+$/.test(w)) out.push(w);
    }
    return out.length && out.some(function (w) { return /[а-яa-z]{2}/.test(w); }) ? out : [];
  }
  // Модель целиком: «Prime» ≠ «Prime Hit», «Hit» ≠ «Prime Hit», «Эльба» ≠ «Эльба 2».
  function modelIn(full, sig) {
    if (!sig || !sig.length) return false;
    var body = sig.map(escRe).join('[\\s\\-]*');
    var re = new RegExp('(^|[^а-яa-z0-9])' + body + '(?![а-яa-z0-9]|[\\s\\-]*\\d)', 'g');
    var m, guard = 0;
    while ((m = re.exec(full))) {
      if (++guard > 30) break;
      var at = m.index + (m[1] ? m[1].length : 0);
      var before = full.slice(0, at);
      var after = full.slice(m.index + m[0].length);
      if (/[a-z][a-z0-9]*[\s\-]*$/.test(before)) continue;
      if (/^[\s\-]*[a-z]/.test(after)) continue;
      return true;
    }
    return false;
  }
  function removeModel(text, sig) {
    if (!sig || !sig.length) return text;
    var body = sig.map(escRe).join('[\\s\\-]*');
    var re = new RegExp('(^|[^а-яa-z0-9])' + body + '(?![а-яa-z0-9]|[\\s\\-]*\\d)');
    return text.replace(re, ' ');
  }
  function typeOf(name) {
    var n = norm(stripKit(name)), bestAt = 1e9, id = '';
    for (var i = 0; i < TYPES.length; i++) {
      var at = n.indexOf(TYPES[i][0]);
      if (at >= 0 && at < bestAt) { bestAt = at; id = TYPES[i][1]; }
    }
    return id;
  }
  function kindStem(name) {
    var w = norm(stripKit(name)).split(/[\s\-"«“„]+/)[0] || '';
    return w.length >= 4 ? w.slice(0, Math.min(5, w.length - 1)) : '';
  }
  // Тип в прайсе не назван — лишние слова рядом с моделью это другой товар
  // («Угловой Эльба 2 НПБ», «мс Алиса КМ-1200»). Размер и цвет после « · » не мешают.
  function extraWords(shopName, priceName, sig) {
    var kind = kindStem(shopName);
    var full = norm(stripKit(priceName));
    if (!kind || full.indexOf(kind) >= 0) return false;
    var head = norm(String(priceName || '').split(' · ')[0]);
    head = norm(stripKit(head));
    var rest = removeModel(head, sig).replace(/["«»“”„()]/g, ' ');
    return /[а-яa-z]{2}/.test(rest);
  }

  function stockMatches(shop, price) {
    shop = shop || {};
    price = price || {};
    var sName = shop.name || '';
    var pName = price.product_name || price.name || '';
    var sig = modelSig(sName);
    if (!sig.length) return false;
    if (typeOf(sName) && typeOf(pName) && typeOf(sName) !== typeOf(pName)) return false;
    var full = norm([stripKit(pName), price.article || ''].filter(Boolean).join(' '));
    if (!modelIn(full, sig)) return false;
    if (extraWords(sName, pName, sig)) return false;
    var ctx = sName + ' ' + pName;
    var sSizes = variantSizes(sName, shop.dims, ctx);
    var pSizes = variantSizes(pName, price.dims, ctx);
    if (!pSizes.length && price.article) pSizes = variantSizes(price.article, '', ctx);
    if (!sSizes.length && !pSizes.length) return true;
    if (!sSizes.length || !pSizes.length) return false;
    for (var i = 0; i < sSizes.length; i++) if (pSizes.indexOf(sSizes[i]) >= 0) return true;
    return false;
  }
  function shopQty(price, items) {
    var n = 0;
    for (var i = 0; i < (items || []).length; i++) {
      if (stockMatches(items[i], price)) n += (+items[i].qty || 0);
    }
    return n;
  }

  // Ключ продажи: весь текст позиции, размер приведён к одной записи.
  // Другая ширина, другое слово модели и товар без размера остаются разными.
  function soldKey(name) {
    var base = norm(stripKit(name));
    if (!base) return '';
    var swap = wantsSwap(base);
    var t = base.replace(/(\d)\s*[xх×*]\s*(?=\d)/g, '$1x');
    var re = /\d{2,4}(?:x\d{2,4}){1,2}(?:\s*\/\s*\d{2,4})*/g;
    var parts = [], last = 0, m;
    while ((m = re.exec(t))) {
      parts.push(t.slice(last, m.index));
      var keys = sizeKeysIn(m[0], swap);
      parts.push(keys.length ? '{' + keys.join('+') + '}' : m[0]);
      last = m.index + m[0].length;
    }
    parts.push(t.slice(last));
    return norm(parts.join(' '));
  }
  function soldCountFor(priceName, orders) {
    var key = soldKey(priceName), n = 0;
    (orders || []).forEach(function (o) {
      if (/отмен/i.test(o.status || '')) return;
      var items = o.order_items || o.items || null;
      if (!items && (o.product_name || o.name)) items = [o];
      (items || []).forEach(function (it) {
        var nm = it.product_name || it.name || '';
        if (nm && soldKey(nm) === key) n += (parseInt(it.qty, 10) || 1);
      });
    });
    return n;
  }

  return {
    norm: norm,
    stripKit: stripKit,
    modelSig: modelSig,
    sizeKeys: function (text, swapText) { return variantSizes(text, '', swapText == null ? text : swapText); },
    soldKey: soldKey,
    stockMatches: stockMatches,
    shopQty: shopQty,
    soldCountFor: soldCountFor
  };
});
