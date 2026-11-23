'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const pm = require('./price-matrix.js');

function row(article, opt, extra) {
  return Object.assign({
    supplier: 'Восход',
    factory: '',
    sheet_name: '1гр окт18',
    product_name: 'Компьютерный стол',
    article: article,
    price_opt: opt,
    price_retail: 0
  }, extra || {});
}

test('ПКС-15: безымянная колонка «вариант 4» с той же ценой, что «2 группа», не остаётся', function () {
  var rows = pm.dropEchoRows([
    row('вариант 4 · ПКС-15', 6700),
    row('2 группа · ПКС-15', 6700),
    row('вариант 4 · ПКС-17', 10500),
    row('2 группа · ПКС-17', 10500)
  ]);
  assert.deepEqual(rows.map(function (r) { return r.article; }), [
    '2 группа · ПКС-15',
    '2 группа · ПКС-17'
  ]);
  assert.equal(rows[0].price_opt, 6700);
  assert.equal(rows[0].product_name, 'Компьютерный стол');
});

test('повторный разбор того же листа не добавляет вторую копию', function () {
  var parsed = pm.dropEchoRows([
    row('вариант 4 · ПКС-15', 6700),
    row('2 группа · ПКС-15', 6700),
    row('2 группа · ПКС-3', 5450)
  ]);
  var again = pm.dropEchoRows(parsed.map(function (r) { return Object.assign({}, r); }));
  assert.equal(again.length, parsed.length);
  assert.deepEqual(again.map(function (r) { return r.article + '@' + r.price_opt; }), [
    '2 группа · ПКС-15@6700',
    '2 группа · ПКС-3@5450'
  ]);
});

test('повторный импорт заменяет лист и не трогает другую полку', function () {
  var oldSheet = [
    row('вариант 4 · ПКС-15', 6700),
    row('2 группа · ПКС-15', 6700),
    row('2 группа · АН-1', 8800, { product_name: '"Анечка"' })
  ];
  var otherSheet = [row('1 группа · ПКС-15', 5900, { sheet_name: '1 группа октябрь', price_opt: 5900 })];
  var otherFactory = [row('2 группа · ПКС-15', 6700, { factory: 'Восход' })];
  var otherSupplier = [row('2 группа · ПКС-15', 6700, { supplier: 'МиФ', product_name: 'Стол МиФ' })];
  var existing = oldSheet.concat(otherSheet, otherFactory, otherSupplier);
  var incoming = pm.dropEchoRows(oldSheet);
  var next = pm.reimport(existing, incoming, {
    supplier: 'Восход',
    factory: '',
    sheet_name: '1гр окт18'
  });
  var pks = next.filter(function (r) {
    return r.supplier === 'Восход' && !(r.factory || '') && r.sheet_name === '1гр окт18' && r.article.indexOf('ПКС-15') >= 0;
  });
  assert.equal(pks.length, 1);
  assert.equal(pks[0].article, '2 группа · ПКС-15');
  assert.equal(pks[0].price_opt, 6700);
  assert.equal(next.filter(function (r) { return r.sheet_name === '1 группа октябрь'; }).length, 1);
  assert.equal(next.filter(function (r) { return r.factory === 'Восход'; }).length, 1);
  assert.equal(next.filter(function (r) { return r.supplier === 'МиФ'; }).length, 1);
  var second = pm.reimport(next, incoming, { supplier: 'Восход', factory: '', sheet_name: '1гр окт18' });
  assert.equal(second.length, next.length);
});

test('группы отделки сосуществуют и при одинаковой, и при разной цене', function () {
  var rows = pm.dropEchoRows([
    row('1 группа · ПКС-15', 5900),
    row('2 группа · ПКС-15', 6700),
    row('3 группа · ПКС-15', 7500),
    row('4 группа · ПКС-15', 8300),
    row('1 группа · М-5', 6650, { product_name: 'Шкаф 2-дверный' }),
    row('2 группа · М-5', 6650, { product_name: 'Шкаф 2-дверный' }),
    row('вариант 4 · ПКС-15', 6700)
  ]);
  assert.deepEqual(rows.map(function (r) { return r.article; }), [
    '1 группа · ПКС-15',
    '2 группа · ПКС-15',
    '3 группа · ПКС-15',
    '4 группа · ПКС-15',
    '1 группа · М-5',
    '2 группа · М-5'
  ]);
});

test('настоящие варианты: цвет, размер и другая цена безымянной колонки остаются', function () {
  var rows = pm.dropEchoRows([
    row('венге · КВ2/60/1.3/0з', 21800, { product_name: 'Шкаф Купе "Версаль"' }),
    row('дуб молочный · КВ2/60/1.3/0з', 21800, { product_name: 'Шкаф Купе "Версаль"' }),
    row('1200 · ПКС-15', 6700),
    row('1600 · ПКС-15', 8900),
    row('кат. 1 · ткань до 300 ₽/м · диван', 24000, { product_name: 'Диван' }),
    row('кат. 2 · ткань 300–400 ₽/м · диван', 26000, { product_name: 'Диван' }),
    row('3 ВАРИАНТ · винный', 2035, { supplier: 'Браво', product_name: 'Карина-5' }),
    row('вариант 4 · ПКС-15', 7100)
  ]);
  assert.equal(rows.length, 8);
  assert.ok(rows.some(function (r) { return r.article === 'вариант 4 · ПКС-15' && r.price_opt === 7100; }));
  assert.ok(rows.some(function (r) { return r.article === '3 ВАРИАНТ · винный'; }));
  assert.ok(rows.some(function (r) { return r.article === 'венге · КВ2/60/1.3/0з'; }));
  assert.ok(rows.some(function (r) { return r.article === 'дуб молочный · КВ2/60/1.3/0з'; }));
});

test('колонка «Цена» с той же суммой, что группа, не задваивает товар; одинокая «Цена» остаётся', function () {
  var rows = pm.dropEchoRows([
    row('Цена · ПКС-15', 6700),
    row('2 группа · ПКС-15', 6700),
    row('Цена · СВ-15', 5550, { product_name: 'Комод' })
  ]);
  assert.deepEqual(rows.map(function (r) { return r.article; }), [
    '2 группа · ПКС-15',
    'Цена · СВ-15'
  ]);
});

test('эхо без пары не выбрасывается: это единственная цена товара', function () {
  var rows = pm.dropEchoRows([
    row('вариант 4 · ПН-1', 1150, { product_name: 'Полка навесная' }),
    row('вариант 4 · ПН-1', 1150, { product_name: 'Полка навесная' })
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].article, 'вариант 4 · ПН-1');
  assert.equal(rows[0].price_opt, 1150);
});
