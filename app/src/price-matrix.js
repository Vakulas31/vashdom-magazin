// Матрица прайса. Пустая шапка колонки получает запасное имя «вариант N».
// Такая строка — эхо, если рядом уже есть настоящая подпись с тем же
// хвостом артикула и той же ценой. Текст «вариант 4», «вариант4» или «Цена»
// сам по себе эхом не считается: это может быть настоящий заголовок.
// Цвет, размер, группа и категория ткани не склеиваются.
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
  // Пустая шапка → запасное имя. Настоящий заголовок, даже «Вариант 4»,
  // «вариант4» или «Цена», остаётся подписью колонки.
  function labelFromHeader(raw, columnIndex) {
    var text = clean(raw);
    if (text) return { label: text, fromEmptyHeader: false };
    var n = (parseInt(columnIndex, 10) || 0) + 1;
    return { label: 'вариант ' + n, fromEmptyHeader: true };
  }
  function generatedEcho(row) {
    return !!(row && row._fromEmptyHeader);
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
  function withoutFlag(row) {
    if (!row || !row._fromEmptyHeader) return row;
    var out = {};
    for (var k in row) if (k !== '_fromEmptyHeader') out[k] = row[k];
    return out;
  }
  // Снимает только строку, которую сборщик пометил как пустую шапку,
  // и только когда рядом есть другая подпись с тем же хвостом и той же ценой.
  // Совпадение одной цены без этой пометки строку не удаляет.
  function dropEchoRows(rows) {
    var list = rows || [];
    var hasReal = {};
    for (var i = 0; i < list.length; i++) {
      if (generatedEcho(list[i])) continue;
      var parts = splitArticle(list[i].article);
      hasReal[rowIdentity(list[i], parts)] = 1;
    }
    var seenEcho = {};
    var out = [];
    for (var j = 0; j < list.length; j++) {
      var row = list[j];
      var sp = splitArticle(row.article);
      var id = rowIdentity(row, sp);
      if (generatedEcho(row)) {
        if (hasReal[id]) continue;
        if (seenEcho[id]) continue;
        seenEcho[id] = 1;
      }
      out.push(withoutFlag(row));
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
    labelFromHeader: labelFromHeader,
    generatedEcho: generatedEcho,
    splitArticle: splitArticle,
    dropEchoRows: dropEchoRows,
    reimport: reimport
  };
});
