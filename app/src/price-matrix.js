// Матрица прайса: колонка без своего имени («вариант N») или колонка
// «просто другая цена того же товара» не должна задваивать строку, у которой
// уже есть настоящая подпись (группа отделки, цвет, размер, категория ткани).
// Разные подписи при любой цене остаются: это разные комплектации.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.priceMatrix = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function clean(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  }
  function norm(s) {
    return clean(s).toLowerCase().replace(/ё/g, 'е');
  }
  // Запасное имя из _collectMulti: пустая шапка колонки c → «вариант »+(c+1).
  function syntheticLabel(label) {
    return /^вариант \d+$/i.test(clean(label));
  }
  // Не комплектация, а вторая запись той же цены. «2 группа», «венге», «1200»,
  // «кат. 1» сюда не входят.
  function altPriceLabel(label) {
    var t = norm(label).replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
    return /^(цена|оптовая цена|опт|оптовая|стоимость|сумма|итого|ррц|ррц мр)$/.test(t);
  }
  function echoLabel(label) {
    return syntheticLabel(label) || altPriceLabel(label);
  }
  function splitArticle(article) {
    var s = clean(article);
    var i = s.indexOf(' · ');
    if (i < 0) return { label: '', tail: s };
    return { label: s.slice(0, i), tail: s.slice(i + 3) };
  }
  function rowIdentity(row, parts) {
    var price = Math.round((+row.price_opt || 0) * 100);
    return [
      norm(row.supplier),
      norm(row.factory),
      norm(row.sheet_name),
      norm(row.product_name),
      norm(parts.tail),
      String(price)
    ].join('\u0001');
  }
  // Убирает эхо-строку, только если рядом есть строка с настоящей подписью,
  // тем же хвостом артикула и той же ценой. Подписи «1 группа» и «2 группа»,
  // цвета и размеры не трогает, даже когда цены совпали.
  function dropEchoRows(rows) {
    var list = rows || [];
    var hasReal = {};
    for (var i = 0; i < list.length; i++) {
      var parts = splitArticle(list[i].article);
      if (!echoLabel(parts.label)) hasReal[rowIdentity(list[i], parts)] = 1;
    }
    var seenEcho = {};
    var out = [];
    for (var j = 0; j < list.length; j++) {
      var row = list[j];
      var sp = splitArticle(row.article);
      var id = rowIdentity(row, sp);
      if (echoLabel(sp.label)) {
        if (hasReal[id]) continue;
        if (seenEcho[id]) continue;
        seenEcho[id] = 1;
      }
      out.push(row);
    }
    return out;
  }
  // Повторный импорт заменяет только ту же полку: поставщик + фабрика + лист.
  // Другой лист, другая фабрика и чужой поставщик остаются.
  // whole=true — как «все листы» этой фабрики: листы внутри полки заменяются целиком.
  function reimport(existing, incoming, scope) {
    var sup = norm(scope && scope.supplier);
    var fac = norm(scope && scope.factory);
    var sheet = norm(scope && scope.sheet_name);
    var whole = !!(scope && scope.whole);
    var kept = (existing || []).filter(function (row) {
      if (norm(row.supplier) !== sup || norm(row.factory) !== fac) return true;
      if (whole) return false;
      return norm(row.sheet_name) !== sheet;
    });
    return kept.concat(incoming || []);
  }
  return {
    clean: clean,
    norm: norm,
    syntheticLabel: syntheticLabel,
    altPriceLabel: altPriceLabel,
    echoLabel: echoLabel,
    splitArticle: splitArticle,
    dropEchoRows: dropEchoRows,
    reimport: reimport
  };
});
