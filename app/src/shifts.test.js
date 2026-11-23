/* Проверки правки смен. Базу не трогают и реальных людей не записывают. */
var fs = require('fs');
var path = require('path');
var S = require('./shifts.js');

var failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed++;
    console.error('FAIL: ' + msg);
  }
}
function eq(a, b, msg) {
  if (a !== b) {
    failed++;
    console.error('FAIL: ' + msg + ' | ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b));
  }
}

var TODAY = '2026-11-23';
function ctx(extra) {
  var c = {
    today: TODAY,
    nowMinutes: 10 * 60,
    rows: [],
    knownNames: ['Учебный Иван', 'Учебная Мария'],
    earliest: S.EARLIEST
  };
  extra = extra || {};
  Object.keys(extra).forEach(function (k) { c[k] = extra[k]; });
  return c;
}
function save(input, extra) { return S.decideSave(input, ctx(extra)); }

/* ── дата, имя, часы, дубли ── */
var ok = save({ manager: 'Учебный Иван', work_date: '2026-11-20' });
assert(ok.ok, 'прошедший день без часов принимается');
eq(ok.row.manager, 'Учебный Иван', 'имя сохраняется как в списке');
eq(ok.row.work_date, '2026-11-20', 'дата сохраняется');
eq(Object.keys(ok.row).sort().join(','), 'manager,work_date', 'в базу не уходят часы и лишние поля');
eq(ok.action, 'insert', 'новая смена — это добавление');

ok = save({ manager: '  учебный   иван ', work_date: '2026-11-20' });
eq(ok.row.manager, 'Учебный Иван', 'пробелы и регистр схлопываются к уже известному имени');

assert(!save({ manager: '', work_date: '2026-11-20' }).ok, 'пустое имя');
assert(save({ manager: '', work_date: '2026-11-20' }).error.indexOf('кто работал') >= 0, 'понятный текст про имя');
assert(!save({ manager: '<script>', work_date: '2026-11-20' }).ok, 'имя с разметкой');
assert(!save({ manager: 'Учебный Иван', work_date: '' }).ok, 'пустая дата');
assert(!save({ manager: 'Учебный Иван', work_date: '2026-02-31' }).ok, '31 февраля');
assert(!save({ manager: 'Учебный Иван', work_date: '2026-02-29' }).ok, '2026 не високосный');
assert(save({ manager: 'Учебный Иван', work_date: '2024-02-29' }).ok, 'настоящий 29 февраля');
assert(!save({ manager: 'Учебный Иван', work_date: '2026-13-01' }).ok, '13-й месяц');
assert(!save({ manager: 'Учебный Иван', work_date: '2026-11-24' }).ok, 'завтрашний день');
assert(save({ manager: 'Учебный Иван', work_date: '2026-11-24' }).error.indexOf('ещё не наступил') >= 0, 'текст про будущий день');
assert(save({ manager: 'Учебный Иван', work_date: TODAY }).ok, 'сегодня можно');
assert(!save({ manager: 'Учебный Иван', work_date: '2022-12-31' }).ok, 'слишком давняя дата');

var dup = save({ manager: 'учебный иван', work_date: '2026-11-18' }, {
  rows: [{ id: 1, work_date: '2026-11-18', manager: 'Учебный Иван' }]
});
assert(!dup.ok, 'тот же человек в тот же день — дубль');
assert(dup.error.indexOf('уже есть') >= 0, 'текст про дубль');

var yo = save({ manager: 'Алёна', work_date: '2026-11-18' }, {
  knownNames: ['Алена'],
  rows: [{ id: 1, work_date: '2026-11-18', manager: 'Алена' }]
});
assert(!yo.ok, 'ё и е — один человек, вторую смену не пишем');

var editOk = save({ id: 1, manager: 'Учебная Мария', work_date: '2026-11-18' }, {
  rows: [{ id: 1, work_date: '2026-11-18', manager: 'Учебный Иван' }],
  previous: { work_date: '2026-11-18', manager: 'Учебный Иван' }
});
assert(editOk.ok && editOk.action === 'update', 'исправление чужого имени в той же строке');
var editDup = save({ id: 2, manager: 'Учебный Иван', work_date: '2026-11-18' }, {
  rows: [
    { id: 1, work_date: '2026-11-18', manager: 'Учебный Иван' },
    { id: 2, work_date: '2026-11-19', manager: 'Учебная Мария' }
  ],
  previous: { work_date: '2026-11-19', manager: 'Учебная Мария' }
});
assert(!editDup.ok, 'нельзя перенести смену на день, где этот человек уже есть');

var same = save({ id: 1, manager: 'Учебный Иван', work_date: '2026-11-18' }, {
  rows: [{ id: 1, work_date: '2026-11-18', manager: 'Учебный Иван' }],
  previous: { work_date: '2026-11-18', manager: 'Учебный Иван' }
});
assert(!same.ok && same.error.indexOf('Не изменилось') < 0 && same.error.indexOf('не изменилось') >= 0, 'правка без изменений');

var second = save({ manager: 'Учебная Мария', work_date: '2026-11-18' }, {
  rows: [{ id: 1, work_date: '2026-11-18', manager: 'Учебный Иван' }]
});
assert(second.ok, 'два разных человека в один день можно, это две ставки');
assert(second.warnings.join(' ').indexOf('второй') >= 0, 'про вторую ставку есть предупреждение');

var badTime = save({ manager: 'Учебный Иван', work_date: '2026-11-20', time_from: '25:00', time_to: '26:00' });
assert(!badTime.ok, 'несуществующее время');
var oneSide = save({ manager: 'Учебный Иван', work_date: '2026-11-20', time_from: '09:00', time_to: '' });
assert(!oneSide.ok, 'только начало без конца');
var order = save({ manager: 'Учебный Иван', work_date: '2026-11-20', time_from: '18:00', time_to: '09:00' });
assert(!order.ok && order.error.indexOf('позже начала') >= 0, 'конец раньше начала');
var hours = save({ manager: 'Учебный Иван', work_date: '2026-11-20', time_from: '9:00', time_to: '18:05' });
assert(hours.ok, 'нормальные часы проходят проверку');
eq(hours.value.time_from, '09:00', 'время приводится к часам и минутам');
eq(hours.row.time_from, undefined, 'часы не кладутся в строку базы');
var futureStart = save({ manager: 'Учебный Иван', work_date: TODAY, time_from: '11:00', time_to: '12:00' });
assert(!futureStart.ok, 'сегодня смена не может начаться в будущем');
var started = save({ manager: 'Учебный Иван', work_date: TODAY, time_from: '09:00', time_to: '19:00' });
assert(started.ok, 'сегодняшняя смена, которая уже идёт, допустима, даже если конец ещё впереди');

var fresh = save({ manager: 'Новый Человек', work_date: '2026-11-20' });
assert(fresh.ok && fresh.unknownName, 'новое имя не запрещено, но помечается');
assert(fresh.warnings.join(' ').indexOf('Проверьте написание') >= 0, 'предупреждение про новое написание');

/* ── зарплата: та же формула, что уже в журнале ── */
function legacyCount(md, range) {
  var seen = {}, days = {};
  (md || []).forEach(function (r) {
    var n = (r.manager || '').trim(), d = r.work_date;
    if (!n || !d) return;
    if (range) {
      var dt = new Date(d + 'T00:00:00');
      if (dt < range.from || dt >= range.to) return;
    }
    var k = n + '|' + d;
    if (seen[k]) return;
    seen[k] = 1;
    days[n] = (days[n] || 0) + 1;
  });
  return days;
}
function legacyBase(days, rate) { return Math.round(days * rate); }
function legacyBonus(rev, pct) { return Math.round(rev * pct / 100); }

var sample = [
  { manager: 'Учебный Иван', work_date: '2026-11-01' },
  { manager: 'Учебный Иван', work_date: '2026-11-01' },
  { manager: 'учебный иван', work_date: '2026-11-02' },
  { manager: '  ', work_date: '2026-11-03' },
  { manager: 'Учебная Мария', work_date: '2026-11-18' },
  { manager: 'Учебный Иван', work_date: '2026-12-01' }
];
var range = S.monthRange('2026-11');
var a = S.countShiftsForSalary(sample, range);
var b = legacyCount(sample, range);
eq(JSON.stringify(a), JSON.stringify(b), 'подсчёт смен совпадает с текущей зарплатой');
eq(a['Учебный Иван'], 1, 'повтор одного и того же дня не удваивает смену');
eq(a['учебный иван'], 1, 'другое написание старая формула считает отдельным человеком — поэтому при записи имя приводится к уже известному');
eq(a['Учебная Мария'], 1, 'чужая смена считается отдельно');
assert(!a[''], 'пустое имя не идёт в оклад');
eq(S.salaryBase(a['Учебный Иван'], 1650), legacyBase(a['Учебный Иван'], 1650), 'оклад = округление(смены × ставка)');
eq(S.salaryBase(2, 10.4), legacyBase(2, 10.4), 'дробная ставка округляется так же');
var rev = 100000, pct = 1;
eq(legacyBonus(rev, pct), 1000, 'премия не зависит от числа смен');
eq(S.salaryBase(2, 1650) + legacyBonus(rev, pct), 4300, 'к выплате = оклад + премия');
eq(S.salaryBase(1, 1650) + legacyBonus(rev, pct), 2650, 'одна добавленная смена увеличивает только оклад');

var before = [{ id: 1, work_date: '2026-11-18', manager: 'Учебный Иван' }];
var lines = S.describeChange(
  [{ month: '2026-11', rows: before }],
  { action: 'insert', id: null, row: { work_date: '2026-11-20', manager: 'Учебный Иван' } },
  function () { return 1650; }
).join('\n');
assert(lines.indexOf(S.fmtRub(1650)) >= 0 && lines.indexOf(S.fmtRub(3300)) >= 0, 'подсказка показывает оклад до и после');
assert(lines.indexOf('не зависит') >= 0, 'подсказка говорит, что процент от оборота не меняется');

var moved = S.describeChange(
  [
    { month: '2026-11', rows: [{ id: 5, work_date: '2026-11-18', manager: 'Учебный Иван' }] },
    { month: '2026-10', rows: [] }
  ],
  { action: 'update', id: 5, row: { work_date: '2026-10-30', manager: 'Учебная Мария' } },
  function () { return 1650; }
).join('\n');
assert(moved.indexOf('Учебный Иван') >= 0 && moved.indexOf('Учебная Мария') >= 0, 'перенос смены двигает оклад обоих');
assert(moved.indexOf('октябрь') >= 0 && moved.indexOf('ноябрь') >= 0, 'видны оба месяца');

var flags = S.rowFlags([
  { id: 1, work_date: '2026-11-18', manager: 'Учебный Иван' },
  { id: 2, work_date: '2026-11-18', manager: 'Учебный Иван' },
  { id: 3, work_date: '2026-11-19', manager: 'Алена' },
  { id: 4, work_date: '2026-11-19', manager: 'Алёна' }
]);
assert(flags['1'].indexOf('одинаковые') >= 0, 'две одинаковые строки помечены');
assert(flags['3'].indexOf('Похожие') >= 0, 'разное написание в один день помечено');

/* ── потерянная из-за сети смена не уходит сама ── */
var mem = { v: null, getItem: function () { return this.v; }, setItem: function (k, val) { this.v = val; } };
S._setStore(mem);
S.rememberUnsaved('2026-11-20', 'Учебный Иван');
S.rememberUnsaved('2026-11-20', 'учебный иван');
eq(S.readUnsaved().length, 1, 'одна и та же потерянная смена не копится');
assert(!S.shouldRememberFailure({ message: 'relation manager_days does not exist' }), 'если таблицы ещё нет, каждое утро не помечаем как сбой связи');
assert(S.shouldRememberFailure({ message: 'Failed to fetch' }), 'обрыв связи запоминаем');
S.forgetUnsaved('2026-11-20', 'Учебный Иван');
eq(S.readUnsaved().length, 0, 'после записи пометка снимается');
S._setStore(null);

/* ── права: не только спрятанная кнопка ── */
var calls = [];
var toasts = [];
global.window = {
  ownerOnly: function () { return true; },
  _isOwner: true,
  _authUserId: function () { return 'user-1'; },
  _applyRole: function () {},
  sbGet: function (table, q) { calls.push(table + '?' + q); return Promise.resolve([{ role: 'seller' }]); },
  toast: function (m) { toasts.push(m); }
};
S.withFreshOwner('Правка смен').then(function (ok) {
  assert(ok === false, 'роль продавца из базы запрещает запись, даже если экран считает иначе');
  assert(calls.length === 1 && calls[0].indexOf('app_roles') >= 0, 'перед записью роль читается из базы');
  assert(toasts.join(' ').indexOf('eyJ') < 0, 'в сообщении нет ключа');
  calls = []; toasts = [];
  global.window.ownerOnly = function () { return false; };
  return S.withFreshOwner('Правка смен');
}).then(function (ok) {
  assert(ok === false && calls.length === 0, 'если владелец не подтверждён на экране, до базы запись не доходит');
  global.window.ownerOnly = function () { return true; };
  global.window._authUserId = function () { return null; };
  return S.withFreshOwner('Правка смен');
}).then(function (ok) {
  assert(ok === false, 'без входа смену менять нельзя');
  global.window._authUserId = function () { return 'user-1'; };
  global.window._isOwner = true;
  global.window.sbGet = function () { return Promise.resolve([{ role: 'owner' }]); };
  return S.withFreshOwner('Правка смен');
}).then(function (ok) {
  assert(ok === true && global.window._isOwner === true, 'владелец по строке в базе проходит');
  global.window.sbGet = function () { return Promise.reject(new Error('app_roles does not exist')); };
  global.window._roleTableMissing = function () { return true; };
  return S.withFreshOwner('Правка смен');
}).then(function (ok) {
  assert(ok === true, 'если справочника ролей ещё нет, владельца не запираем — как и остальной журнал');
  global.window.sbGet = function () { return Promise.reject(new Error('Failed to fetch')); };
  global.window._roleTableMissing = function () { return false; };
  global.window._isOwner = true;
  return S.withFreshOwner('Правка смен');
}).then(function (ok) {
  assert(ok === false && global.window._isOwner === false, 'если права не удалось проверить, запись не делаем');
  global.window._isOwner = true;
  global.window.sbGet = function () { return Promise.resolve([]); };
  return S.withFreshOwner('Правка смен');
}).then(function (ok) {
  assert(ok === false, 'нет строки владельца — заднюю дату не пишем; роль продавца для этого не нужна');
  var row = S.dbPayload({ work_date: '2026-11-20', manager: 'Учебный Иван', created_at: 'не отправлять', time_from: '09:00' });
  eq(Object.keys(row).sort().join(','), 'manager,work_date', 'в базу уходят только дата и имя');
  assert(S.humanDbError(new Error('duplicate key value violates unique constraint 23505')).indexOf('уже есть') >= 0, 'повтор даты и имени база уже не примет');
  delete global.window;
  finish();
}).catch(function (e) {
  failed++;
  console.error('FAIL: проверка прав упала ' + (e && e.message));
  try { delete global.window; } catch (e2) {}
  finish();
});

function finish() {
  var html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
  var src = fs.readFileSync(path.join(__dirname, 'shifts.js'), 'utf8');
  function has(hay, needle, msg) { assert(hay.indexOf(needle) >= 0, msg || needle); }
  function lacks(hay, needle, msg) { assert(hay.indexOf(needle) < 0, msg || ('не должно быть: ' + needle)); }
  has(html, 'src="app/src/shifts.js"', 'журнал подключает правку смен');
  has(html, 'VdShifts.rememberUnsaved', 'обрыв связи не глотается молча');
  has(html, 'VdShifts.shouldRememberFailure', 'отсутствие старой таблицы не считается обрывом');
  has(html, 'window._vdRoleReady=true', 'редактор ждёт проверку роли');
  has(html, 'function retailFromOpt(opt)', 'формула розничной цены на месте');
  has(html, 'return Math.ceil(o*markupK()/100)*100;', 'округление цены за штуку вверх до сотни на месте');
  has(html, 'return retailFromOpt(opt)*q;', 'сначала цена штуки, потом количество');
  has(html, 'var base=Math.round(d.days*r.d), bonus=Math.round(d.rev*r.p/100), sum=base+bonus;', 'формула зарплаты не заменена');
  has(html, "var k=n+'|'+d;if(seen[k])return;seen[k]=1;", 'уникальность смены в зарплате не заменена');
  has(html, 'function _ssColorFind', 'поиск, который правят другие, не вырезан');
  lacks(src, 'retailFromOpt', 'модуль смен не считает цены');
  lacks(src, 'markupK', 'модуль смен не меняет наценку');
  lacks(src, 'DROP POLICY', 'в коде нет команды, которая меняет права базы');
  lacks(src, 'create policy', 'политика базы не спрятана в программу');
  lacks(html, 'DROP POLICY', 'журнал не получил миграцию');
  lacks(src, 'vd_is_owner', 'свою функцию владельца не придумываем');
  lacks(html, 'vd_is_owner', 'в журнале нет чужой функции владельца');
  eq(S.safeErr({ message: 'eyJhbGciOiJIUzI1NiJ9.payload.sig broke' }).indexOf('eyJ'), -1, 'текст ошибки прячет ключ');
  assert(S.humanDbError(new Error('permission denied')).indexOf('не разрешила') >= 0, 'отказ базы объясняется словами');

  if (failed) {
    console.error('Не прошло проверок: ' + failed);
    process.exit(1);
  }
  console.log('Все проверки смен прошли.');
}
