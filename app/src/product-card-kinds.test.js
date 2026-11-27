'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const kinds = require('./product-card-kinds.js');

const root = path.join(__dirname, '../..');
const sql = fs.readFileSync(path.join(root, 'sql/product_cards_item_kind_wardrobes.sql'), 'utf8');

function sqlKinds(text) {
  var m = text.match(/check\s*\(\s*item_kind\s+in\s*\(([\s\S]*?)\)\s*\)/i);
  assert.ok(m, 'в SQL нет проверки item_kind');
  return m[1].match(/'[^']*'/g).map(function (s) { return s.slice(1, -1); });
}

test('три вида шкафов стоят в списке теми же словами', function () {
  ['шкаф', 'шкаф-купе', 'пенал'].forEach(function (k) {
    assert.equal(kinds.isItemKind(k), true, k);
  });
  assert.deepEqual(
    kinds.ITEM_KINDS.filter(function (k) { return k === 'шкаф' || k === 'шкаф-купе' || k === 'пенал'; }),
    ['шкаф', 'шкаф-купе', 'пенал']
  );
});

test('кроватные виды на месте, другие типы мебели в список не попали', function () {
  ['кровать', 'лестница', 'подъёмный механизм', 'основание', 'изголовье', 'деталь', 'матрас', 'другое']
    .forEach(function (k) { assert.equal(kinds.isItemKind(k), true, k); });
  ['комод', 'тумба', 'полка', 'стеллаж', 'стол', 'диван', 'Шкаф', 'шкаф купе', ''].forEach(function (k) {
    assert.equal(kinds.isItemKind(k), false, k);
  });
  assert.equal(kinds.ITEM_KINDS[kinds.ITEM_KINDS.length - 1], 'другое');
});

test('поле «Вид товара» показывает выбранный вид и все три новых', function () {
  var html = kinds.kindSelectHtml('шкаф-купе', ' id="pc-kind"');
  assert.match(html, /<select id="pc-kind">/);
  kinds.ITEM_KINDS.forEach(function (k) {
    assert.ok(html.indexOf('value="' + k + '"') >= 0, k);
  });
  assert.match(html, /<option value="шкаф-купе" selected>шкаф-купе<\/option>/);
  assert.equal((html.match(/selected/g) || []).length, 1);
  var row = kinds.rowsHtml([{
    id: 7,
    supplier: 'Мебель Рум',
    factory: 'МИФ',
    model: 'Элегант',
    variant: '',
    item_kind: 'пенал',
    note: 'Вид: пенал. учебная строка'
  }], true);
  assert.match(row, /Вид товара/);
  assert.match(row, /<option value="пенал" selected>пенал<\/option>/);
  assert.match(row, /<option value="шкаф">шкаф<\/option>/);
  assert.match(row, /data-pc-kind="7"/);
  assert.match(row, /onchange="pcSetKind\(7, this\.value\)"/);
});

test('отбор карточек оставляет шкаф в поле вида и не смотрит на чужие типы', function () {
  var rows = [
    { model: 'Ларго', factory: 'МИФ', supplier: 'Мебель Рум', item_kind: 'шкаф', note: 'Вид: шкаф' },
    { model: 'Элегант', factory: 'МИФ', supplier: 'Мебель Рум', item_kind: 'шкаф-купе', note: '' },
    { model: 'Флэш', factory: 'МИФ', supplier: 'Мебель Рум', item_kind: 'пенал', note: '' },
    { model: 'Гранд', factory: 'Браво', supplier: 'Мебель Рум', item_kind: 'кровать', note: '' }
  ];
  assert.deepEqual(kinds.filterCards(rows, '', 'шкаф').map(function (r) { return r.model; }), ['Ларго']);
  assert.deepEqual(kinds.filterCards(rows, 'элегант', '').map(function (r) { return r.item_kind; }), ['шкаф-купе']);
  assert.deepEqual(kinds.filterCards(rows, 'комод', '').length, 0);
});

test('проверка в SQL принимает ровно тот же список и не переписывает строки', function () {
  assert.deepEqual(sqlKinds(sql), kinds.ITEM_KINDS);
  assert.match(sql, /product_cards_item_kind_check/);
  assert.doesNotMatch(sql, /\bupdate\s+public\.product_cards\b/i);
  assert.doesNotMatch(sql, /\binsert\s+into\b/i);
});
