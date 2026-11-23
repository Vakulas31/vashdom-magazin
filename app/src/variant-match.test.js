// Тестовые остатки и продажи. Это не данные магазина и не запись в базу.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('./variant-match.js');

function row(name, extra) {
  return Object.assign({ product_name: name }, extra || {});
}
function hall(name, qty, extra) {
  return Object.assign({ name: name, qty: qty, dims: '' }, extra || {});
}

// Ширины со скриншота «hit матрас»: 90, 120, 140, 160, 180, 70, 80, 200.
const WIDTHS = [90, 120, 140, 160, 180, 70, 80, 200];
function askona(w) {
  return 'Матрас 200*' + String(w).padStart(3, '0') + ' Prime Hit';
}

test('Prime Hit: остаток 160×200 не попадает на остальные ширины', function () {
  var items = [
    hall('Матрас Prime Hit 160×200', 2),
    hall('Матрас 90×200 Prime Hit', 1)
  ];
  var got = {};
  WIDTHS.forEach(function (w) { got[w] = vm.shopQty(row(askona(w)), items); });
  assert.deepEqual(got, { 90: 1, 120: 0, 140: 0, 160: 2, 180: 0, 70: 0, 80: 0, 200: 0 });
  assert.equal(vm.shopQty(row('Матрас 160×200 Prime Hit'), items), 2);
  assert.equal(vm.shopQty(row('Матрас 200×160 Prime Hit'), items), 2);
});

test('размер витрины в отдельном поле dims, название без ширины', function () {
  var items = [hall('Матрас Prime Hit', 2, { dims: '160×200 см' })];
  assert.equal(vm.shopQty(row(askona(160)), items), 2);
  assert.equal(vm.shopQty(row(askona(90)), items), 0);
  assert.equal(vm.shopQty(row('Матрас Prime Hit'), items), 0);
});

test('запись без размера не приписывается всем вариантам', function () {
  var items = [hall('Матрас Prime Hit', 4)];
  WIDTHS.forEach(function (w) {
    assert.equal(vm.shopQty(row(askona(w)), items), 0, 'ширина ' + w);
  });
  assert.equal(vm.shopQty(row('Матрас Prime Hit'), items), 4);
  var sized = [hall('Матрас Prime Hit 160×200', 2)];
  assert.equal(vm.shopQty(row('Матрас Prime Hit'), sized), 0);
});

test('90×200 и 200×90 совпадают у матраса и не совпадают у стола', function () {
  var mattress = [hall('Матрас Prime Hit 90×200', 1)];
  assert.equal(vm.shopQty(row('Матрас 200*090 Prime Hit'), mattress), 1);
  assert.equal(vm.shopQty(row('Матрас 200×90 Prime Hit'), mattress), 1);
  assert.equal(vm.shopQty(row(askona(160)), mattress), 0);
  var table = [hall('Стол «Оскар» 90×200', 1)];
  assert.equal(vm.shopQty(row('Стол «Оскар» 90×200'), table), 1);
  assert.equal(vm.shopQty(row('Стол «Оскар» 200×90'), table), 0);
  assert.equal(vm.shopQty(row('Шкаф «Оскар» 800×2200×600'), [hall('Шкаф «Оскар» 600×2200×800', 1)]), 0);
});

test('общие слова модели не дают чужой остаток', function () {
  var primeHit = [hall('Матрас Prime Hit 200*160', 2)];
  assert.equal(vm.shopQty(row('Матрас 200*160 HIT'), primeHit), 0);
  assert.equal(vm.shopQty(row('Матрас 200*160 Prime'), primeHit), 0);
  assert.equal(vm.shopQty(row('Матрас 200*160 Prime Hit Comfort'), primeHit), 0);
  assert.equal(vm.shopQty(row('Матрас 200*160 Prime-Hit'), primeHit), 2);
  var onlyHit = [hall('Матрас HIT 200*160', 3)];
  assert.equal(vm.shopQty(row(askona(160)), onlyHit), 0);
  var onlyPrime = [hall('Матрас Prime 200*160', 3)];
  assert.equal(vm.shopQty(row(askona(160)), onlyPrime), 0);
  assert.equal(vm.shopQty(row('Диван «Эльба 2»'), [hall('Диван «Эльба»', 1)]), 0);
  assert.equal(vm.shopQty(row('Диван «Эльба»'), [hall('Диван «Эльба 2»', 1)]), 0);
  assert.equal(vm.shopQty(row('Диван «Эльба 21»'), [hall('Диван «Эльба 2»', 1)]), 0);
  assert.equal(vm.shopQty(row('Комод «Лидс»'), [hall('Комод «Ода»', 1)]), 0);
  assert.equal(vm.shopQty(row('Комода белая'), [hall('Тумба «Ода»', 1)]), 0);
});

test('без названия модели общие слова типа не красят весь прайс', function () {
  var vague = [hall('Комод 4 ящика', 2)];
  assert.equal(vm.shopQty(row('Комод 4 ящика Джали'), vague), 0);
  assert.equal(vm.shopQty(row('Комод 4 ящика'), vague), 0);
  assert.equal(vm.modelSig('Комод 4 ящика').length, 0);
});

test('тип изделия и лишние слова по-прежнему разделяют товары', function () {
  var elba = [hall('Диван «Эльба 2»', 1)];
  assert.equal(vm.shopQty(row('Диван «Эльба 2»'), elba), 1);
  assert.equal(vm.shopQty(row('Диван Эльба 2'), elba), 1);
  assert.equal(vm.shopQty(row('Кресло-кровать «Эльба 2»'), elba), 0);
  assert.equal(vm.shopQty(row('Угловой Эльба 2 НПБ'), elba), 0);
  assert.equal(vm.shopQty(row('мс Алиса КМ-1200'), [hall('Комод «Алиса»', 1)]), 0);
  assert.equal(vm.shopQty(row('Стол «Лидс»'), [hall('Комод «Лидс»', 1)]), 0);
  assert.equal(vm.shopQty(row('Пуф «Мартин»'), [hall('Диван «Мартин»', 1)]), 0);
  assert.equal(vm.shopQty(row('Наматрасник Prime Hit 160×200'), [hall('Матрас Prime Hit 160×200', 2)]), 0);
});

test('составной товар: комплект того же размера, не размер части', function () {
  var bed = [hall('Кровать «Соня» 160×200', 1)];
  var kit = 'Кровать «Соня» 160×200 — в комплекте: траверса 1400×2000, ящики';
  assert.equal(vm.shopQty(row(kit), bed), 1);
  assert.equal(vm.shopQty(row('Кровать «Соня» 140×200'), bed), 0);
  assert.equal(vm.shopQty(row('Кровать «Соня» 1600×2000'), bed), 1);
  assert.equal(vm.shopQty(row('Основание «Соня» 160×200'), bed), 0);
  assert.equal(vm.shopQty(row('Траверса 140×200'), bed), 0);
  var kitHall = [hall('Кровать «Соня» 160×200 — в комплекте: ящики', 1)];
  assert.equal(vm.shopQty(row('Кровать «Соня» 140×200 — в комплекте: траверса 160×200'), kitHall), 0);
  assert.equal(vm.shopQty(row('Кровать «Соня» 160×200'), kitHall), 1);
});

test('несколько остатков одного размера складываются, чужие нет', function () {
  var items = [
    hall('Матрас Prime Hit 160×200', 2),
    hall('Матрас 200*160 Prime Hit', 1),
    hall('Матрас Prime Hit 90×200', 1)
  ];
  assert.equal(vm.shopQty(row(askona(160)), items), 3);
  assert.equal(vm.shopQty(row(askona(90)), items), 1);
});

test('продавали: та же ошибка размера не повторяется, комплект и запись размера сохраняются', function () {
  var orders = [
    { status: 'Закрыт', order_items: [
      { product_name: 'Матрас 200*090 Prime Hit', qty: 1 },
      { product_name: 'Матрас 90×200 Prime Hit', qty: 1 },
      { product_name: 'Матрас 200*160 Prime Hit', qty: 2 }
    ]},
    { status: 'Новый', order_items: [
      { product_name: 'Матрас Prime Hit', qty: 5 },
      { product_name: 'Матрас HIT 200*160', qty: 3 },
      { product_name: 'Матрас 200*160 Prime Hit Comfort', qty: 4 },
      { product_name: 'Кровать «Соня» 160×200 — в комплекте: траверса 1400×2000, ящики', qty: 1 }
    ]},
    { status: 'Отменён', order_items: [
      { product_name: 'Матрас 200*160 Prime Hit', qty: 9 }
    ]}
  ];
  assert.equal(vm.soldCountFor(askona(90), orders), 2);
  assert.equal(vm.soldCountFor('Матрас 90×200 Prime Hit', orders), 2);
  assert.equal(vm.soldCountFor(askona(160), orders), 2);
  assert.equal(vm.soldCountFor(askona(120), orders), 0);
  assert.equal(vm.soldCountFor(askona(200), orders), 0);
  assert.equal(vm.soldCountFor('Матрас Prime Hit', orders), 5);
  assert.equal(vm.soldCountFor('Матрас HIT 200*160', orders), 3);
  assert.equal(vm.soldCountFor('Матрас 200*160 Prime Hit Comfort', orders), 4);
  assert.equal(vm.soldCountFor('Кровать «Соня» 160×200', orders), 1);
  assert.equal(vm.soldCountFor('Кровать «Соня» 140×200', orders), 0);
  assert.equal(vm.soldCountFor('Траверса 1400×2000', orders), 0);
  assert.notEqual(vm.soldKey('Стол «Оскар» 90×200'), vm.soldKey('Стол «Оскар» 200×90'));
  assert.equal(vm.soldKey('Матрас 200*090 Prime Hit'), vm.soldKey('Матрас 90×200 Prime Hit'));
});

test('список длин в подписи не становится размером позиции', function () {
  var items = [hall('Матрас Prime Hit 160×200', 2)];
  var price = row(askona(160), { article: 'длина 186,190,195,200' });
  assert.equal(vm.shopQty(price, items), 2);
  assert.equal(vm.shopQty(row(askona(90), { article: 'длина 186,190,195,200' }), items), 0);
  var multi = row('Матрас «Орто» · 80×190/195/200');
  assert.equal(vm.shopQty(multi, [hall('Матрас «Орто» 80×200', 1)]), 1);
  assert.equal(vm.shopQty(multi, [hall('Матрас «Орто» 80×180', 1)]), 0);
});
