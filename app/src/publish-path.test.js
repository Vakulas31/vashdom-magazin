'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const fixture = require('./local-fixture.js');

const root = path.join(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

test('скрипты журнала относительные и лежат рядом с index.html', function () {
  ['shifts.js', 'variant-match.js', 'price-matrix.js', 'local-fixture.js'].forEach(function (name) {
    assert.ok(html.indexOf('src="app/src/' + name + '"') >= 0, name);
    assert.ok(fs.existsSync(path.join(root, 'app/src', name)), name + ' файл');
  });
  assert.equal(html.indexOf('src="/app/src/'), -1);
  assert.ok(html.indexOf('>v8.32<') >= 0);
});

test('формулы цены и зарплаты на месте', function () {
  assert.ok(html.indexOf('return Math.ceil(o*markupK()/100)*100;') >= 0);
  assert.ok(html.indexOf('return retailFromOpt(opt)*q;') >= 0);
  assert.ok(html.indexOf('var base=Math.round(d.days*r.d), bonus=Math.round(d.rev*r.p/100), sum=base+bonus;') >= 0);
});

test('пустая шапка помечается, служебное поле снимается до записи', function () {
  assert.ok(html.indexOf('priceMatrix.labelFromHeader') >= 0);
  assert.ok(html.indexOf('delete rows[_ei]._fromEmptyHeader') >= 0);
});

test('локальная проверка не включается на сайте', function () {
  assert.equal(fixture.allow({ hostname: 'vakulas31.github.io', search: '?vd_local_fixture=1' }), false);
  assert.equal(fixture.allow({ hostname: '127.0.0.1', search: '' }), false);
  assert.equal(fixture.allow({ hostname: '', search: '?vd_local_fixture=1' }), false);
  assert.equal(fixture.allow({ hostname: '127.0.0.1', search: '?vd_local_fixture=1' }), true);
  assert.equal(fixture.allow({ hostname: 'localhost', search: '?x=1&vd_local_fixture=1' }), true);
});

test('публикация отдаёт свои файлы через сеть, а не только из старого списка оболочки', function () {
  assert.ok(sw.indexOf('url.origin === location.origin') >= 0);
  assert.ok(sw.indexOf("if (url.hostname.indexOf('supabase') >= 0) return;") >= 0);
  assert.equal(sw.indexOf('app/src/shifts.js'), -1);
});
