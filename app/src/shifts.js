/* Правка смен владельцем.
   Смена попадает в зарплату только из таблицы manager_days.
   Утренний выбор «кто сегодня работает» пишет туда сам, и только если есть связь.
   Этот файл даёт владельцу дописать пропущенный день или исправить ошибочный.
   В базу уходят только дата и имя. Оклад по-прежнему «число смен × ставка»,
   премия — процент от оборота. Отдельные часы не спрашиваем: они не хранятся.
   Правила цен и оплат здесь не считаются.
   Серверное ограничение (чтобы продавец не записал старую дату в обход экрана)
   в этот файл не входит и само не выполняется — его нужно показать владельцу отдельно. */
(function (factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') {
    window.VdShifts = api;
    var boot = function () { try { api.install(); } catch (e) {} };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})(function () {
  'use strict';
  var EARLIEST = '2023-01-01';
  var UNSAVED_KEY = 'vd_shift_unsaved';
  var MONTHS = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
  var memStore = null;

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function todayLocal(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function nowMinutes(d) {
    d = d || new Date();
    return d.getHours() * 60 + d.getMinutes();
  }
  function cleanName(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function foldName(s) {
    return cleanName(s).replace(/ё/g, 'е').replace(/Ё/g, 'Е').toLowerCase();
  }
  function samePerson(a, b) { return !!foldName(a) && foldName(a) === foldName(b); }
  function isRealDate(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return false;
    var p = String(s).split('-');
    var y = +p[0], m = +p[1], d = +p[2];
    var dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }
  function dayOf(r) { return String(r && r.work_date || '').slice(0, 10); }
  function monthOf(date) { return String(date || '').slice(0, 7); }
  function fmtDate(iso) {
    var p = String(iso || '').slice(0, 10).split('-');
    if (p.length < 3 || p[0].length !== 4) return String(iso || '');
    return p[2] + '.' + p[1] + '.' + p[0];
  }
  function fmtMonth(ym) {
    var p = String(ym || '').split('-');
    var m = +p[1];
    if (!p[0] || m < 1 || m > 12) return String(ym || '');
    return MONTHS[m - 1] + ' ' + p[0];
  }
  function fmtRub(n) {
    var v = Math.round(+n || 0);
    var neg = v < 0;
    var s = String(Math.abs(v));
    var out = '';
    for (var i = 0; i < s.length; i++) {
      if (i && (s.length - i) % 3 === 0) out += '\u00a0';
      out += s.charAt(i);
    }
    return (neg ? '−' : '') + out + ' ₽';
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function parseTime(s) {
    var m = String(s || '').trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    var h = +m[1], min = +m[2];
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }
  function fmtTime(mins) {
    var h = Math.floor(mins / 60), m = mins % 60;
    return pad(h) + ':' + pad(m);
  }
  function canonicalName(name, list) {
    var n = cleanName(name);
    var exact = '';
    var folded = '';
    (list || []).forEach(function (x) {
      var c = cleanName(x);
      if (!c) return;
      if (!exact && c === n) exact = c;
      if (!folded && foldName(c) === foldName(n)) folded = c;
    });
    return exact || folded || n;
  }
  function monthBounds(ym) {
    if (!/^\d{4}-\d{2}$/.test(String(ym || ''))) return null;
    var y = +String(ym).slice(0, 4), m = +String(ym).slice(5, 7);
    if (m < 1 || m > 12) return null;
    var ny = m === 12 ? y + 1 : y;
    var nm = m === 12 ? 1 : m + 1;
    return { from: ym + '-01', to: ny + '-' + pad(nm) + '-01' };
  }
  function monthRange(ym) {
    var b = monthBounds(ym);
    if (!b) return null;
    var p = b.from.split('-');
    return { from: new Date(+p[0], +p[1] - 1, 1), to: new Date(+p[0], +p[1], 1) };
  }
  /* Тот же подсчёт, что в зарплате журнала: уникальная пара «имя как записано + дата».
     Пустое имя не считается. Повтор той же пары не удваивает день.
     Формулу денег не меняем: оклад = Math.round(смены × ставка). */
  function countShiftsForSalary(md, range) {
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
  function salaryBase(days, rate) { return Math.round((+days || 0) * (+rate || 0)); }
  function dbPayload(row) {
    return { work_date: row.work_date, manager: row.manager };
  }
  function safeErr(e) {
    var m = String((e && e.message) || e || '');
    m = m.replace(/eyJ[A-Za-z0-9_\-\.]+/g, '[скрыто]');
    m = m.replace(/(api[_-]?key|authorization|bearer)\s*[:=]\s*\S+/gi, '$1 [скрыто]');
    m = m.replace(/\s+/g, ' ').trim();
    return m.slice(0, 180);
  }
  function humanDbError(e) {
    var m = safeErr(e);
    if (/manager_days|does not exist|pgrst205|schema cache/i.test(m)) {
      return 'В базе ещё нет таблицы смен. Нужен уже существующий шаг SQL 7.0. Этот экран новые таблицы не создаёт.';
    }
    if (/23505|duplicate key|unique constraint/i.test(m)) {
      return 'Такая смена уже есть: этот человек в этот день записан. Вторую такую же база не примет.';
    }
    if (/42501|permission denied|row-level|rls/i.test(m)) {
      return 'База не разрешила эту запись. Смену не изменили.';
    }
    if (!m) return 'Не сохранилось. Если строки в списке нет — в базе ничего не изменилось.';
    return 'Не сохранилось: ' + m;
  }
  function validateShift(input, ctx) {
    ctx = ctx || {};
    input = input || {};
    var warnings = [];
    var nameRaw = cleanName(input.manager);
    if (!nameRaw) return { ok: false, error: 'Впишите, кто работал.' };
    if (nameRaw.length < 2 || nameRaw.length > 80 || /[<>]/.test(nameRaw) || /[\u0000-\u001F]/.test(nameRaw)) {
      return { ok: false, error: 'Имя выглядит неправильно. Нужны буквы, без знаков < и >.' };
    }
    var manager = canonicalName(nameRaw, ctx.knownNames);
    var known = (ctx.knownNames || []).some(function (x) { return foldName(x) === foldName(manager); });
    var date = String(input.work_date || '').slice(0, 10);
    if (!date) return { ok: false, error: 'Укажите день смены.' };
    if (!isRealDate(date)) return { ok: false, error: 'Такого дня в календаре нет.' };
    var earliest = ctx.earliest || EARLIEST;
    if (date < earliest) {
      return { ok: false, error: 'Эта дата раньше ' + fmtDate(earliest) + '. Так далеко смену не пишем, чтобы опечатка не начислила лишнюю зарплату.' };
    }
    var today = ctx.today || todayLocal();
    if (date > today) {
      return { ok: false, error: 'Этот день ещё не наступил. Пропущенную смену можно записать за сегодня или за прошедший день.' };
    }
    var tf = String(input.time_from || '').trim();
    var tt = String(input.time_to || '').trim();
    var timeFrom = '', timeTo = '';
    if (tf || tt) {
      if (!tf || !tt) return { ok: false, error: 'Если указываете время, нужны и начало, и конец. Если часы неизвестны — оставьте оба поля пустыми.' };
      var a = parseTime(tf), b = parseTime(tt);
      if (a == null || b == null) return { ok: false, error: 'Время запишите как часы:минуты, например 09:30. Если часы неизвестны — оставьте оба поля пустыми.' };
      if (b <= a) return { ok: false, error: 'Конец смены должен быть позже начала. Через полночь смена не переносится: один день — одна смена.' };
      if (date === today && ctx.nowMinutes != null && a > ctx.nowMinutes) {
        return { ok: false, error: 'На сегодня это время ещё не наступило.' };
      }
      timeFrom = fmtTime(a);
      timeTo = fmtTime(b);
    }
    var editId = input.id || ctx.editingId || '';
    var prev = ctx.previous;
    if (prev && dayOf(prev) === date && cleanName(prev.manager) === manager && !timeFrom) {
      return { ok: false, error: 'Ничего не изменилось.' };
    }
    if (prev && dayOf(prev) === date && cleanName(prev.manager) === manager && timeFrom) {
      return { ok: false, error: 'Время в базу не записывается, а дата и имя те же. Менять нечего.' };
    }
    var sameDay = (ctx.rows || []).filter(function (r) {
      return dayOf(r) === date && String(r.id) !== String(editId || '');
    });
    var dup = sameDay.filter(function (r) { return samePerson(r.manager, manager); });
    if (dup.length) {
      return { ok: false, error: 'Смена «' + manager + '» за ' + fmtDate(date) + ' уже есть. Вторую такую же не записываем: иначе легко задвоить день.' };
    }
    var others = [];
    sameDay.forEach(function (r) {
      var nm = cleanName(r.manager);
      if (nm && !samePerson(nm, manager) && others.indexOf(nm) < 0) others.push(nm);
    });
    if (others.length) {
      warnings.push('В этот день уже отмечен ' + others.join(' и ') + '. Вторая смена — это второй человек и вторая ставка. Если работал один, не записывайте второго.');
    }
    var alt = {};
    (ctx.rows || []).forEach(function (r) {
      if (String(r.id) === String(editId || '')) return;
      var nm = cleanName(r.manager);
      if (nm && samePerson(nm, manager) && nm !== manager) alt[nm] = 1;
    });
    var alts = Object.keys(alt);
    if (alts.length) {
      warnings.push('Похожее имя уже записано иначе: ' + alts.join(', ') + '. Зарплата считает разное написание разными людьми. Поправьте старую строку, чтобы имя совпало буква в букву.');
    }
    if (!known) {
      warnings.push('Имени «' + manager + '» нет среди уже известных сотрудников. Проверьте написание: новый вариант зарплата посчитает отдельно, со ставкой по умолчанию, пока свою не сохраните в таблице ниже.');
    }
    var value = { id: editId || null, manager: manager, work_date: date, time_from: timeFrom, time_to: timeTo };
    return {
      ok: true,
      warnings: warnings,
      unknownName: !known,
      value: value,
      row: dbPayload(value),
      action: editId ? 'update' : 'insert'
    };
  }
  function decideSave(input, ctx) { return validateShift(input, ctx); }
  function project(rows, change, month) {
    var out = [];
    (rows || []).forEach(function (r) {
      if (change.action !== 'insert' && String(r.id) === String(change.id)) {
        if (change.action === 'update' && monthOf(change.row.work_date) === month) {
          out.push({ id: r.id, work_date: change.row.work_date, manager: change.row.manager });
        }
        return;
      }
      out.push(r);
    });
    if ((change.action === 'insert' || change.action === 'update') && monthOf(change.row.work_date) === month) {
      var exists = out.some(function (r) { return String(r.id) === String(change.id); });
      if (!exists) out.push({ id: change.id || 'new', work_date: change.row.work_date, manager: change.row.manager });
    }
    return out;
  }
  function describeChange(packs, change, rateOf) {
    var lines = [];
    (packs || []).forEach(function (p) {
      var range = monthRange(p.month);
      var before = countShiftsForSalary(p.rows, range);
      var after = countShiftsForSalary(project(p.rows, change, p.month), range);
      var names = {};
      Object.keys(before).forEach(function (n) { names[n] = 1; });
      Object.keys(after).forEach(function (n) { names[n] = 1; });
      Object.keys(names).sort().forEach(function (n) {
        var b = before[n] || 0, a = after[n] || 0;
        if (a === b) return;
        var rate = rateOf ? rateOf(n) : null;
        if (rate == null) {
          lines.push(n + ', ' + fmtMonth(p.month) + ': смен было ' + b + ', станет ' + a + '. Оклад изменится на эту разницу ставок. Своя ставка берётся из таблицы зарплаты, здесь она не подменяется.');
        } else {
          lines.push(n + ', ' + fmtMonth(p.month) + ': смен было ' + b + ', станет ' + a + '. Оклад ' + fmtRub(salaryBase(b, rate)) + ' → ' + fmtRub(salaryBase(a, rate)) + ' при ставке ' + fmtRub(rate) + '.');
        }
      });
    });
    if (!lines.length) lines.push('Число оплачиваемых смен не меняется.');
    lines.push('Премия — процент от оборота — считается по-старому и от этой правки не зависит.');
    return lines;
  }
  function rowFlags(rows) {
    var by = {}, flags = {};
    (rows || []).forEach(function (r) {
      var k = dayOf(r) + '|' + foldName(r.manager);
      (by[k] = by[k] || []).push(r);
    });
    Object.keys(by).forEach(function (k) {
      if (by[k].length < 2) return;
      var exact = {};
      by[k].forEach(function (r) { exact[cleanName(r.manager)] = 1; });
      var msg = Object.keys(exact).length > 1
        ? 'Похожие имена в один день. Зарплата может посчитать их разными людьми.'
        : 'Две одинаковые отметки. В зарплате этот день всё равно один, лишнюю строку можно снять.';
      by[k].forEach(function (r) { flags[String(r.id)] = msg; });
    });
    return flags;
  }
  function findRow(rows, id) {
    if (id == null || id === '') return null;
    for (var i = 0; i < (rows || []).length; i++) {
      if (String(rows[i].id) === String(id)) return rows[i];
    }
    return null;
  }
  function store() {
    if (memStore) return memStore;
    try { if (typeof localStorage !== 'undefined') return localStorage; } catch (e) {}
    return null;
  }
  function readUnsaved() {
    var s = store();
    if (!s) return [];
    try {
      var a = JSON.parse(s.getItem(UNSAVED_KEY) || '[]');
      return Array.isArray(a) ? a : [];
    } catch (e) { return []; }
  }
  function writeUnsaved(a) {
    var s = store();
    if (!s) return;
    try { s.setItem(UNSAVED_KEY, JSON.stringify((a || []).slice(0, 30))); } catch (e) {}
  }
  function shouldRememberFailure(e) {
    var m = String((e && e.message) || e || '').toLowerCase();
    if (m.indexOf('does not exist') >= 0 || m.indexOf('pgrst205') >= 0 || m.indexOf('schema cache') >= 0) return false;
    return true;
  }
  function rememberUnsaved(date, name) {
    date = String(date || '').slice(0, 10);
    name = cleanName(name);
    if (!isRealDate(date) || !name) return;
    var a = readUnsaved().filter(function (x) {
      return !(String(x.work_date).slice(0, 10) === date && samePerson(x.manager, name));
    });
    a.unshift({ work_date: date, manager: name });
    writeUnsaved(a);
    if (typeof window !== 'undefined' && window.toast) {
      window.toast('Смена не попала в базу: нет связи. На этом устройстве осталась пометка ' + name + ', ' + fmtDate(date) + '. Когда интернет появится, владелец может записать день в «Аналитике». Сама пометка в базу не уйдёт.', 'err', 8000);
    }
  }
  function forgetUnsaved(date, name) {
    var d = String(date || '').slice(0, 10);
    writeUnsaved(readUnsaved().filter(function (x) {
      return !(String(x.work_date).slice(0, 10) === d && samePerson(x.manager, name));
    }));
  }
  function collectKnown(host, rows) {
    var list = [];
    if (host && host.knownNames) list = list.concat(host.knownNames() || []);
    (rows || []).forEach(function (r) { if (r && r.manager) list.push(r.manager); });
    return list;
  }
  function ctxFrom(rows, host, editId, previous) {
    return {
      today: host.today ? host.today() : todayLocal(),
      nowMinutes: host.nowMinutes ? host.nowMinutes() : nowMinutes(),
      rows: rows || [],
      knownNames: collectKnown(host, rows),
      earliest: EARLIEST,
      editingId: editId || '',
      previous: previous || null
    };
  }
  function stateOf(container) {
    if (!container._vd) {
      container._vd = {
        month: '', editId: '', date: '', name: '', timeFrom: '', timeTo: '',
        note: '', noteKind: '', confirm: null, busy: false, rows: null,
        loadError: '', loading: false, token: 0, host: null
      };
    }
    return container._vd;
  }
  function saveBlocked(st) { return !!(st.loading || !st.rows || st.loadError || st.busy); }
  function liveText(st) {
    var host = st.host;
    if (!host) return '';
    if (st.loading) return 'Загружаю смены…';
    if (st.loadError) return st.loadError;
    if (!st.date && !cleanName(st.name)) return 'Укажите день и сотрудника. Одна смена — один день и одна ставка.';
    var prev = findRow(st.rows, st.editId);
    var ctx = ctxFrom(st.rows || [], host, st.editId, prev ? { work_date: dayOf(prev), manager: prev.manager } : null);
    var d = decideSave({
      id: st.editId || null, manager: st.name, work_date: st.date,
      time_from: st.timeFrom, time_to: st.timeTo
    }, ctx);
    if (!d.ok) return d.error;
    if (st.month && d.row.work_date.slice(0, 7) === st.month && st.rows) {
      return describeChange(
        [{ month: st.month, rows: st.rows }],
        { action: d.action, id: st.editId, row: d.row },
        host.rateOf
      ).concat(d.warnings || []).join(' ');
    }
    return 'Дата в другом месяце. Перед записью покажем, как изменится оклад. Процент от оборота не меняется.';
  }
  function paint(container) {
    var st = stateOf(container);
    var host = st.host || {};
    var today = host.today ? host.today() : todayLocal();
    var flags = rowFlags(st.rows || []);
    var names = collectKnown(host, st.rows || []);
    var seen = {}, opts = [];
    names.forEach(function (n) {
      var c = cleanName(n);
      var f = foldName(c);
      if (!c || seen[f]) return;
      seen[f] = 1;
      opts.push(c);
    });
    opts.sort();
    var pending = host.pending ? host.pending() : [];
    var h = '';
    h += '<div style="font-weight:700;font-size:13px;margin-bottom:6px">Пропущенные и ошибочные смены</div>';
    h += '<div style="font-size:12.5px;line-height:1.5;color:var(--text2);margin-bottom:10px">Смена попадает в зарплату только если она записана в базу. Утренний выбор «кто сегодня работает» делает это сам, но без интернета остаётся лишь на этом компьютере. Здесь владелец может дописать такой день или поправить ошибку. Заказы, цены и процент от оборота не меняются. Одна смена — одна ставка за день.</div>';
    if (pending.length) {
      h += '<div style="background:#fbf0e2;border:1px solid #e6c284;border-radius:8px;padding:8px 10px;font-size:12.5px;line-height:1.5;margin-bottom:10px">На этом устройстве есть смены, которые не дошли до базы. Они сами не отправятся. Проверьте и нажмите «Подставить», затем «Записать смену».<div style="margin-top:6px">';
      pending.forEach(function (p, i) {
        h += '<div style="margin-top:4px">' + esc(fmtDate(p.work_date)) + ' — ' + esc(p.manager)
          + ' <button type="button" class="btn btn-outline" style="padding:2px 8px;font-size:12px" data-act="use-pending" data-i="' + i + '">Подставить</button>'
          + ' <button type="button" class="btn btn-outline" style="padding:2px 8px;font-size:12px" data-act="drop-pending" data-i="' + i + '">Это не смена</button></div>';
      });
      h += '</div></div>';
    }
    h += '<label style="font-size:11px;color:var(--text2)">Месяц<br><input id="vd-sh-month" type="month" min="2023-01" max="' + esc(today.slice(0, 7)) + '" value="' + esc(st.month) + '" style="width:160px;padding:6px 8px"></label>';
    if (st.loading) h += '<p style="font-size:13px;color:var(--text2);margin:10px 0">Загружаю смены…</p>';
    else if (st.loadError) h += '<p style="font-size:13px;color:#c62828;margin:10px 0">' + esc(st.loadError) + '</p>';
    else if (!(st.rows || []).length) h += '<p style="font-size:13px;color:var(--text2);margin:10px 0">В этом месяце смен в базе нет. Если магазин работал — добавьте день ниже.</p>';
    else {
      var list = (st.rows || []).slice().sort(function (a, b) {
        if (dayOf(a) === dayOf(b)) {
          var an = cleanName(a.manager), bn = cleanName(b.manager);
          return an < bn ? -1 : (an > bn ? 1 : 0);
        }
        return dayOf(a) < dayOf(b) ? 1 : -1;
      });
      h += '<div style="overflow-x:auto;margin-top:8px"><table style="width:100%;border-collapse:collapse;font-size:12.5px">';
      list.forEach(function (r) {
        var flag = flags[String(r.id)] || '';
        h += '<tr><td style="padding:6px 8px;border-bottom:1px solid var(--border);font-weight:600">' + esc(fmtDate(dayOf(r))) + '</td>';
        h += '<td style="padding:6px 8px;border-bottom:1px solid var(--border)">' + esc(cleanName(r.manager))
          + (flag ? '<div style="font-size:11px;color:#8a5a18;font-weight:400">' + esc(flag) + '</div>' : '') + '</td>';
        h += '<td style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:right;white-space:nowrap">';
        h += '<button type="button" class="btn btn-outline" style="padding:2px 8px;font-size:12px" data-act="edit" data-id="' + esc(r.id) + '">Исправить</button> ';
        h += '<button type="button" class="btn btn-outline" style="padding:2px 8px;font-size:12px" data-act="remove" data-id="' + esc(r.id) + '">Снять</button>';
        h += '</td></tr>';
      });
      h += '</table></div>';
    }
    h += '<div style="margin-top:12px;padding-top:10px;border-top:1px dashed var(--border)">';
    h += '<div style="font-size:12px;font-weight:700;margin-bottom:6px">' + (st.editId ? 'Исправить выбранную смену' : 'Добавить смену') + '</div>';
    h += '<datalist id="vd-sh-names">' + opts.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist>';
    h += '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">';
    h += '<label style="font-size:11px;color:var(--text2)">День<br><input data-f="date" type="date" min="' + EARLIEST + '" max="' + esc(today) + '" value="' + esc(st.date) + '" style="width:150px;padding:6px 8px"></label>';
    h += '<label style="font-size:11px;color:var(--text2)">Кто работал<br><input data-f="name" list="vd-sh-names" autocomplete="off" value="' + esc(st.name) + '" placeholder="имя" style="width:180px;padding:6px 8px"></label>';
    h += '</div>';
    h += '<div style="font-size:11px;color:var(--text2);margin-top:6px">Записывается день и имя. Оклад — одна ставка за этот день. Часы не спрашиваем: в расчёте их нет.</div>';
    var hint = st.note || liveText(st);
    var col = st.noteKind === 'err' ? '#c62828' : (st.noteKind === 'ok' ? '#1B5E20' : 'var(--text2)');
    h += '<div id="vd-sh-hint" style="font-size:12.5px;line-height:1.45;margin-top:8px;color:' + col + '">' + esc(hint) + '</div>';
    if (st.confirm) {
      h += '<div style="margin-top:8px;background:#EBF3FB;border:1px solid #D6E4F0;border-radius:8px;padding:10px;white-space:pre-wrap;font-size:12.5px;line-height:1.45">' + esc(st.confirm.text) + '</div>';
      h += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">';
      h += '<button type="button" class="btn btn-primary" data-act="confirm-yes"' + (st.busy ? ' disabled' : '') + '>' + esc(st.confirm.yes || 'Да, записать') + '</button>';
      h += '<button type="button" class="btn btn-outline" data-act="confirm-no"' + (st.busy ? ' disabled' : '') + '>Отмена, не менять</button>';
      h += '</div>';
    } else {
      h += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">';
      h += '<button type="button" class="btn btn-primary" data-act="save"' + (saveBlocked(st) ? ' disabled' : '') + '>' + (st.editId ? 'Сохранить исправление' : 'Записать смену') + '</button>';
      if (st.editId) h += '<button type="button" class="btn btn-outline" data-act="cancel-edit">Не исправлять</button>';
      h += '</div>';
      h += '<div style="font-size:11px;color:var(--text2);margin-top:6px">Перед записью программа ещё раз спросит базу, владелец ли это. Кнопки продавца для старых дат нет.</div>';
    }
    h += '</div>';
    container.innerHTML = h;
  }
  function paintGate(container, kind) {
    if (kind === 'check') {
      container.innerHTML = '<p style="font-size:12.5px;color:var(--text2);margin:8px 0">Проверяю, кто вошёл…</p>';
      return;
    }
    if (kind === 'idle') {
      container.innerHTML = '<p style="font-size:12.5px;color:var(--text2);margin:8px 0">Пропущенные смены можно дописать здесь, когда откроется этот раздел.</p>';
      return;
    }
    container.innerHTML = '';
  }
  function reload(container) {
    var st = stateOf(container);
    var host = st.host;
    var token = ++st.token;
    st.loading = true;
    st.loadError = '';
    st.confirm = null;
    paint(container);
    Promise.resolve(host.loadMonth(st.month)).then(function (rows) {
      if (st.token !== token) return;
      st.loading = false;
      st.rows = rows || [];
      if (st.rows.length >= 500) st.loadError = 'Смен слишком много для одного списка. Запись выключена, чтобы не создать дубль, не видя все строки.';
      paint(container);
    }, function (e) {
      if (st.token !== token) return;
      st.loading = false;
      st.rows = [];
      st.loadError = humanDbError(e);
      paint(container);
    });
  }
  function renderEditor(container, host) {
    if (!container) return;
    var st = stateOf(container);
    st.host = host;
    if (!container._vdBound) {
      container._vdBound = true;
      container.addEventListener('input', onInput);
      container.addEventListener('change', onInput);
      container.addEventListener('click', onClick);
    }
    if (!host || (host.roleReady && !host.roleReady())) { paintGate(container, 'check'); return; }
    if (host.isOwner && !host.isOwner()) { container.innerHTML = ''; return; }
    if (!st.month) st.month = monthOf(host.today ? host.today() : todayLocal());
    if (st.rows === null && !st.loading) {
      if (host.deferLoad && host.deferLoad()) paintGate(container, 'idle');
      else reload(container);
    } else paint(container);
  }
  function fieldKey(t) {
    if (!t || !t.getAttribute) return '';
    return t.getAttribute('data-f') || '';
  }
  function onInput(e) {
    var box = e.currentTarget;
    var st = stateOf(box);
    var t = e.target;
    if (t && t.id === 'vd-sh-month') {
      if (e.type !== 'change') return;
      var v = String(t.value || '');
      if (!monthBounds(v) || v === st.month) return;
      st.month = v;
      st.note = '';
      st.noteKind = '';
      reload(box);
      return;
    }
    var k = fieldKey(t);
    if (k !== 'date' && k !== 'name' && k !== 'timeFrom' && k !== 'timeTo') return;
    st[k] = t.value;
    st.note = '';
    st.noteKind = '';
    var hint = box.querySelector('#vd-sh-hint');
    if (hint) { hint.style.color = 'var(--text2)'; hint.textContent = liveText(st); }
  }
  function onClick(e) {
    var box = e.currentTarget;
    var st = stateOf(box);
    var host = st.host;
    var btn = e.target;
    while (btn && btn !== box) {
      if (btn.getAttribute && btn.getAttribute('data-act')) break;
      btn = btn.parentNode;
    }
    if (!btn || btn === box || !btn.getAttribute) return;
    var act = btn.getAttribute('data-act');
    if (st.busy && act !== 'confirm-no') return;
    if (act === 'cancel-edit') {
      st.editId = ''; st.date = ''; st.name = ''; st.timeFrom = ''; st.timeTo = '';
      st.note = ''; st.noteKind = ''; st.confirm = null;
      paint(box); return;
    }
    if (act === 'confirm-no') {
      st.confirm = null; st.note = ''; st.noteKind = ''; paint(box); return;
    }
    if (act === 'edit') {
      var row = findRow(st.rows, btn.getAttribute('data-id'));
      if (!row) return;
      st.editId = String(row.id);
      st.date = dayOf(row);
      st.name = cleanName(row.manager);
      st.timeFrom = ''; st.timeTo = '';
      st.note = ''; st.noteKind = ''; st.confirm = null;
      paint(box); return;
    }
    if (act === 'use-pending' || act === 'drop-pending') {
      var list = host.pending ? host.pending() : [];
      var item = list[+btn.getAttribute('data-i')];
      if (!item) return;
      if (act === 'drop-pending') {
        if (host.forget) host.forget(item.work_date, item.manager);
        else forgetUnsaved(item.work_date, item.manager);
        paint(box); return;
      }
      st.editId = '';
      st.date = String(item.work_date).slice(0, 10);
      st.name = cleanName(item.manager);
      st.timeFrom = ''; st.timeTo = '';
      st.month = monthOf(st.date);
      st.note = 'Проверьте день и имя. В базу ничего не уйдёт, пока не нажмёте «Записать смену» и не подтвердите.';
      st.noteKind = '';
      st.confirm = null;
      reload(box); return;
    }
    if (act === 'remove') { prepareRemove(box, btn.getAttribute('data-id')); return; }
    if (act === 'save') { prepareSave(box); return; }
    if (act === 'confirm-yes') { commit(box); return; }
  }
  function readInput(st) {
    return {
      id: st.editId || null,
      manager: st.name,
      work_date: st.date,
      time_from: st.timeFrom,
      time_to: st.timeTo
    };
  }
  function fail(box, msg) {
    var st = stateOf(box);
    st.busy = false;
    st.confirm = null;
    st.note = msg;
    st.noteKind = 'err';
    paint(box);
  }
  function prepareSave(box) {
    var st = stateOf(box);
    var host = st.host;
    if (saveBlocked(st)) return;
    var prev = findRow(st.rows, st.editId);
    var localCtx = ctxFrom(st.rows || [], host, st.editId, prev ? { work_date: dayOf(prev), manager: prev.manager } : null);
    var local = decideSave(readInput(st), localCtx);
    if (!local.ok) { fail(box, local.error); return; }
    st.busy = true;
    st.note = 'Проверяю список в базе, чтобы не создать дубль…';
    st.noteKind = '';
    paint(box);
    var date = local.row.work_date;
    var months = {};
    months[monthOf(date)] = 1;
    if (prev) months[monthOf(dayOf(prev))] = 1;
    var keys = Object.keys(months);
    Promise.resolve(host.loadDate(date)).then(function (dateRows) {
      return Promise.all(keys.map(function (m) {
        return Promise.resolve(host.loadMonth(m)).then(function (rows) { return { month: m, rows: rows || [] }; });
      })).then(function (packs) {
        var merged = [];
        packs.forEach(function (p) { merged = merged.concat(p.rows); });
        merged = merged.filter(function (r) { return dayOf(r) !== date; }).concat(dateRows || []);
        var ctx = ctxFrom(merged, host, st.editId, prev ? { work_date: dayOf(prev), manager: prev.manager } : null);
        var fresh = decideSave(readInput(st), ctx);
        if (!fresh.ok) { fail(box, fresh.error); return; }
        var lines = describeChange(packs, { action: fresh.action, id: st.editId, row: fresh.row }, host.rateOf);
        var text = [];
        if (fresh.action === 'update') {
          text.push('Было: ' + (prev ? (fmtDate(dayOf(prev)) + ', ' + cleanName(prev.manager)) : 'запись') + '.');
          text.push('Станет: ' + fmtDate(fresh.row.work_date) + ', ' + fresh.row.manager + '.');
        } else {
          text.push('Записать смену: ' + fresh.row.manager + ', ' + fmtDate(fresh.row.work_date) + '.');
        }
        text.push('В зарплату идёт одна смена за этот день.');
        text = text.concat(lines).concat(fresh.warnings || []);
        if (host.periodHint) text.push(host.periodHint(fresh.row.work_date));
        text.push('Заказы и оплаты не изменятся. «Отмена» ничего не запишет.');
        st.busy = false;
        st.note = '';
        st.confirm = {
          text: text.join('\n'),
          yes: fresh.action === 'update' ? 'Да, исправить' : 'Да, записать смену',
          action: fresh.action,
          id: st.editId,
          row: fresh.row
        };
        paint(box);
      });
    }).catch(function (e) { fail(box, humanDbError(e)); });
  }
  function prepareRemove(box, id) {
    var st = stateOf(box);
    var host = st.host;
    var row = findRow(st.rows, id);
    if (!row || st.busy) return;
    st.busy = true;
    st.note = 'Считаю, как изменится оклад…';
    st.noteKind = '';
    paint(box);
    var month = monthOf(dayOf(row));
    Promise.resolve(host.loadMonth(month)).then(function (rows) {
      var change = { action: 'delete', id: row.id, row: { work_date: dayOf(row), manager: cleanName(row.manager) } };
      var lines = describeChange([{ month: month, rows: rows || [] }], change, host.rateOf);
      st.busy = false;
      st.note = '';
      st.confirm = {
        text: ['Снять смену ' + cleanName(row.manager) + ' за ' + fmtDate(dayOf(row)) + '?'].concat(lines).concat(['Заказы и оплаты не трогаем. «Отмена» оставит смену на месте.']).join('\n'),
        yes: 'Да, снять смену',
        action: 'delete',
        id: row.id,
        row: change.row
      };
      paint(box);
    }).catch(function (e) { fail(box, humanDbError(e)); });
  }
  function commit(box) {
    var st = stateOf(box);
    var host = st.host;
    var c = st.confirm;
    if (!c || st.busy) return;
    st.busy = true;
    paint(box);
    Promise.resolve(host.ensureOwner()).then(function (ok) {
      if (!ok) { fail(box, 'Запись не отправлена: править смены может только владелец.'); return; }
      var req;
      if (c.action === 'delete') req = host.remove(c.id);
      else if (c.action === 'update') req = host.update(c.id, dbPayload(c.row));
      else req = host.insert(dbPayload(c.row));
      return Promise.resolve(req).then(function (res) {
        if (c.action === 'delete') {
          return Promise.resolve(host.loadDate(c.row.work_date)).then(function (left) {
            var still = (left || []).some(function (r) { return String(r.id) === String(c.id); });
            if (still) throw new Error('База не сняла смену. Она на месте, зарплату не меняли.');
          });
        }
        var got = Array.isArray(res) ? res[0] : res;
        if (!got || !got.work_date) throw new Error('База не подтвердила запись. Обновите страницу и посмотрите список, прежде чем записывать ещё раз.');
      }).then(function () {
        if (host.forget) host.forget(c.row.work_date, c.row.manager);
        else forgetUnsaved(c.row.work_date, c.row.manager);
        st.busy = false;
        st.confirm = null;
        st.editId = '';
        st.date = ''; st.name = ''; st.timeFrom = ''; st.timeTo = '';
        st.note = c.action === 'delete'
          ? 'Смена снята. Оклад пересчитается без неё. Процент от оборота не меняется.'
          : 'Готово. Оклад пересчитается: смены × ставка. Процент от оборота не меняется.';
        st.noteKind = 'ok';
        if (host.afterChange) host.afterChange();
        reload(box);
      });
    }).catch(function (e) { fail(box, humanDbError(e)); });
  }
  function appRate(name) {
    if (typeof window === 'undefined' || !window._rates) return null;
    var exact = window._rates[name];
    if (exact && exact.d != null && !isNaN(+exact.d)) return +exact.d;
    var keys = Object.keys(window._rates);
    var f = foldName(name);
    for (var i = 0; i < keys.length; i++) {
      var rec = window._rates[keys[i]];
      if (foldName(keys[i]) === f && rec && rec.d != null && !isNaN(+rec.d)) return +rec.d;
    }
    return typeof window.VD_RATE_DAY === 'number' ? window.VD_RATE_DAY : 1650;
  }
  function withFreshOwner(label) {
    if (typeof window === 'undefined') return Promise.resolve(false);
    if (typeof window.ownerOnly === 'function' && !window.ownerOnly(label)) return Promise.resolve(false);
    if (window._isOwner === false) {
      if (window.toast) window.toast('⛔ ' + (label || 'Это действие') + ' — только для владельца', 'err', 4500);
      return Promise.resolve(false);
    }
    var uid = window._authUserId ? window._authUserId() : null;
    if (!uid) {
      if (window.toast) window.toast('Войдите в приложение заново — без этого смену менять нельзя', 'err', 5000);
      return Promise.resolve(false);
    }
    if (typeof window.sbGet !== 'function') return Promise.resolve(false);
    return window.sbGet('app_roles', 'select=role&user_id=eq.' + encodeURIComponent(uid)).then(function (r) {
      // Пустой ответ — не владелец. Отдельной строки «продавец» в ролях нет и она не нужна:
      // сегодняшнюю отметку пишет утреннее окно, эта проверка его не касается.
      var ok = !!(r && r[0] && r[0].role === 'owner');
      window._isOwner = ok;
      if (window._applyRole) window._applyRole();
      if (!ok && window.toast) window.toast('⛔ База не подтвердила права владельца. Смена не изменена.', 'err', 5000);
      return ok;
    }).catch(function (e) {
      if (window._roleTableMissing && window._roleTableMissing(e)) return true;
      window._isOwner = false;
      if (window._applyRole) window._applyRole();
      if (window.toast) window.toast('⚠️ Не удалось проверить права. Смена не изменена.', 'err', 5000);
      return false;
    });
  }
  function appHost() {
    return {
      roleReady: function () { return typeof window !== 'undefined' && window._vdRoleReady === true; },
      isOwner: function () { return typeof window !== 'undefined' && !!window._isOwner; },
      deferLoad: function () {
        var page = document.getElementById('page-stats');
        return !(page && page.className.indexOf('active') >= 0);
      },
      today: function () { return window._ymd ? window._ymd() : todayLocal(); },
      nowMinutes: function () { return nowMinutes(); },
      knownNames: function () {
        var list = [];
        if (window._mgrGetList) list = list.concat(window._mgrGetList() || []);
        if (window._rates) list = list.concat(Object.keys(window._rates));
        return list;
      },
      pending: function () { return readUnsaved(); },
      forget: function (d, n) { forgetUnsaved(d, n); },
      rateOf: function (n) { return appRate(n); },
      loadMonth: function (month) {
        var b = monthBounds(month);
        if (!b) return Promise.reject(new Error('Непонятный месяц'));
        return window.sbGet('manager_days', 'select=id,work_date,manager&work_date=gte.' + b.from + '&work_date=lt.' + b.to + '&order=work_date.asc&limit=500');
      },
      loadDate: function (date) {
        return window.sbGet('manager_days', 'select=id,work_date,manager&work_date=eq.' + encodeURIComponent(date) + '&limit=50');
      },
      insert: function (row) {
        return window.sbPost('manager_days', dbPayload(row));
      },
      update: function (id, row) {
        return window.sbPatch('manager_days', dbPayload(row), 'id=eq.' + encodeURIComponent(String(id)));
      },
      remove: function (id) {
        return window.sbDel('manager_days', 'id=eq.' + encodeURIComponent(String(id)));
      },
      ensureOwner: function () { return withFreshOwner('Правка смен'); },
      afterChange: function () {
        try { window._mdCache = null; } catch (e1) {}
        if (typeof window.renderStats === 'function') window.renderStats();
      },
      periodHint: function (date) {
        if (typeof window._statsRange !== 'function') return '';
        var r = window._statsRange(window._statsPeriod);
        if (!r) return 'В аналитике сейчас период «всё время» — эта смена попадёт в зарплату.';
        var dt = new Date(String(date).slice(0, 10) + 'T00:00:00');
        if (dt >= r.from && dt < r.to) return 'Эта дата входит в период, который сейчас открыт в зарплате.';
        return 'Эта дата не входит в период, который сейчас открыт в зарплате. После записи выберите нужный месяц сверху — правило расчёта то же.';
      }
    };
  }
  var installed = false;
  function mount(force) {
    if (typeof document === 'undefined') return;
    var el = document.getElementById('chart-workdays');
    if (!el || !el.parentNode) return;
    var box = document.getElementById('vd-shift-editor');
    if (!box) {
      box = document.createElement('div');
      box.id = 'vd-shift-editor';
      box.style.marginTop = '14px';
      box.style.paddingTop = '12px';
      box.style.borderTop = '1px dashed var(--border)';
      el.parentNode.appendChild(box);
    }
    if (!force && box._vdMounted && document.activeElement && box.contains(document.activeElement)) return;
    renderEditor(box, appHost());
    box._vdMounted = true;
  }
  function wrapFn(name, label) {
    var orig = window[name];
    if (typeof orig !== 'function' || orig._vdShift) return;
    var wrapped = function () {
      var args = arguments, self = this;
      return withFreshOwner(label).then(function (ok) {
        if (!ok) return;
        return orig.apply(self, args);
      });
    };
    wrapped._vdShift = true;
    window[name] = wrapped;
  }
  function install() {
    if (typeof window === 'undefined' || installed) return;
    installed = true;
    wrapFn('backfillWorkdays', 'Дозаполнение смен');
    wrapFn('wdRemove', 'Снятие смены');
    var chart = document.getElementById('chart-workdays');
    if (chart && window.MutationObserver) {
      var obs = new MutationObserver(function () { mount(false); });
      obs.observe(chart, { childList: true });
    }
    mount(false);
  }
  return {
    EARLIEST: EARLIEST,
    todayLocal: todayLocal,
    nowMinutes: nowMinutes,
    cleanName: cleanName,
    foldName: foldName,
    samePerson: samePerson,
    isRealDate: isRealDate,
    canonicalName: canonicalName,
    monthBounds: monthBounds,
    monthRange: monthRange,
    countShiftsForSalary: countShiftsForSalary,
    salaryBase: salaryBase,
    dbPayload: dbPayload,
    safeErr: safeErr,
    humanDbError: humanDbError,
    validateShift: validateShift,
    decideSave: decideSave,
    describeChange: describeChange,
    project: project,
    rowFlags: rowFlags,
    fmtRub: fmtRub,
    fmtDate: fmtDate,
    esc: esc,
    shouldRememberFailure: shouldRememberFailure,
    rememberUnsaved: rememberUnsaved,
    readUnsaved: readUnsaved,
    forgetUnsaved: forgetUnsaved,
    renderEditor: renderEditor,
    withFreshOwner: withFreshOwner,
    mount: mount,
    install: install,
    _setStore: function (s) { memStore = s; }
  };
});
