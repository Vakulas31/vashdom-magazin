// Вид товара в карточке (public.product_cards.item_kind).
// Список совпадает с проверкой product_cards_item_kind_check.
// Кроватные виды были в ней с самого начала. Шкаф, шкаф-купе и пенал
// добавлены отдельно: ночные карточки МиФ писали вид в примечание,
// потому что проверка базы эти три слова не принимала.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ProductCardKinds = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var ITEM_KINDS = [
    'кровать',
    'лестница',
    'подъёмный механизм',
    'основание',
    'изголовье',
    'деталь',
    'матрас',
    'шкаф',
    'шкаф-купе',
    'пенал',
    'другое'
  ];

  function isItemKind(value) {
    return ITEM_KINDS.indexOf(String(value == null ? '' : value)) >= 0;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Выпадающий список поля «Вид товара». Текущее значение, даже если его
  // ещё нет в списке, остаётся видимым и выбранным.
  function kindSelectHtml(selected, attrs) {
    var cur = String(selected == null ? '' : selected);
    var html = '<select' + (attrs || '') + '>';
    var seen = false;
    ITEM_KINDS.forEach(function (k) {
      var on = k === cur;
      if (on) seen = true;
      html += '<option value="' + esc(k) + '"' + (on ? ' selected' : '') + '>' + esc(k) + '</option>';
    });
    if (cur && !seen) {
      html += '<option value="' + esc(cur) + '" selected>' + esc(cur) + '</option>';
    }
    html += '</select>';
    return html;
  }

  function cardLine(row, canEdit) {
    var id = row && row.id != null ? row.id : '';
    var kind = row && row.item_kind != null ? String(row.item_kind) : '';
    var title = [row && row.model, row && row.variant].filter(Boolean).join(' · ');
    var meta = [row && row.factory, row && row.supplier].filter(Boolean).join(' · ');
    var dis = canEdit ? '' : ' disabled';
    var on = canEdit ? ' onchange="pcSetKind(' + JSON.stringify(id) + ', this.value)"' : '';
    var note = row && row.note ? String(row.note) : '';
    return '<div class="pc-row" data-pc-id="' + esc(id) + '" style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;padding:10px 0;border-bottom:1px solid var(--border)">'
      + '<div style="flex:1;min-width:180px"><div style="font-weight:700">' + esc(title || 'без модели') + '</div>'
      + '<div style="font-size:12px;color:var(--text2)">' + esc(meta) + '</div>'
      + (note ? '<div class="pc-note" style="font-size:12px;color:var(--text2);margin-top:4px">' + esc(note) + '</div>' : '')
      + '</div>'
      + '<label style="font-size:12px;color:var(--text2);min-width:200px">Вид товара<br>'
      + kindSelectHtml(kind, ' data-pc-kind="' + esc(id) + '" style="margin-top:4px"' + dis + on)
      + '</label></div>';
  }

  function rowsHtml(rows, canEdit) {
    rows = rows || [];
    if (!rows.length) return '<div class="empty"><p>Таких карточек нет.</p></div>';
    return rows.map(function (row) { return cardLine(row, !!canEdit); }).join('');
  }

  function filterCards(rows, query, kind) {
    var q = String(query || '').toLowerCase().replace(/ё/g, 'е').trim();
    var want = String(kind || '');
    return (rows || []).filter(function (row) {
      if (want && String(row.item_kind || '') !== want) return false;
      if (!q) return true;
      var hay = [row.model, row.variant, row.factory, row.supplier, row.item_kind, row.note]
        .join(' ').toLowerCase().replace(/ё/g, 'е');
      return hay.indexOf(q) >= 0;
    });
  }

  return {
    ITEM_KINDS: ITEM_KINDS,
    isItemKind: isItemKind,
    kindSelectHtml: kindSelectHtml,
    rowsHtml: rowsHtml,
    filterCards: filterCards
  };
});

if (typeof window !== 'undefined' && window.ProductCardKinds) {
  (function (K) {
    var rows = null;
    var query = '';
    var kind = '';

    function canEdit() {
      return typeof window._isOwner === 'undefined' || !!window._isOwner;
    }

    function paint() {
      var list = document.getElementById('pc-list');
      var chips = document.getElementById('pc-kinds');
      if (!list) return;
      var shown = K.filterCards(rows || [], query, kind);
      if (chips) {
        var counts = {};
        (rows || []).forEach(function (r) {
          var k = String(r.item_kind || '');
          counts[k] = (counts[k] || 0) + 1;
        });
        var chip = function (value, label, n) {
          var on = value === kind ? ' chip-active' : '';
          var arg = JSON.stringify(value).replace(/"/g, '&quot;');
          return '<span class="chip' + on + '" style="background:#eef1f5;color:#5b6270" onclick="pcKindFilter('
            + arg + ')">' + String(label).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            + (n != null ? ' ' + n : '') + '</span>';
        };
        var html = chip('', 'Все', (rows || []).length);
        K.ITEM_KINDS.forEach(function (k) {
          if (!counts[k]) return;
          html += chip(k, k, counts[k]);
        });
        chips.innerHTML = html;
      }
      list.innerHTML = '<div style="font-size:12px;color:var(--text2);margin-bottom:6px">Показано ' + shown.length
        + ' из ' + (rows || []).length + '</div>' + K.rowsHtml(shown, canEdit());
    }

    window.renderProductCards = function () {
      var list = document.getElementById('pc-list');
      if (!list) return;
      if (typeof window.sbGet !== 'function') {
        list.innerHTML = '<div class="empty"><p>Список карточек недоступен.</p></div>';
        return;
      }
      list.innerHTML = '<div class="empty"><p>Загрузка...</p></div>';
      window.sbGet('product_cards', 'select=id,supplier,factory,model,variant,item_kind,note&order=model.asc,id.asc&limit=2000')
        .then(function (got) {
          rows = got || [];
          paint();
        })
        .catch(function (e) {
          var m = String((e && e.message) || e || '');
          list.innerHTML = '<div class="empty"><p>'
            + (/product_cards|does not exist|42P01|PGRST/i.test(m)
              ? 'Таблица карточек в базе не найдена.'
              : 'Не удалось загрузить карточки.')
            + '</p></div>';
        });
    };

    window.pcSearch = function (value) {
      query = String(value || '');
      if (rows) paint();
    };

    window.pcKindFilter = function (value) {
      kind = String(value || '');
      if (rows) paint();
    };

    window.pcSetKind = function (id, value) {
      if (!K.isItemKind(value)) {
        if (typeof window.toast === 'function') window.toast('Такого вида товара в списке нет', 'err', 4000);
        return;
      }
      if (typeof window.ownerOnly === 'function' && !window.ownerOnly('Вид товара в карточке')) {
        paint();
        return;
      }
      if (typeof window.sbPatch !== 'function') return;
      window.sbPatch('product_cards', { item_kind: value }, 'id=eq.' + encodeURIComponent(id))
        .then(function () {
          (rows || []).forEach(function (r) {
            if (String(r.id) === String(id)) r.item_kind = value;
          });
          paint();
          if (typeof window.toast === 'function') window.toast('Вид товара: ' + value);
        })
        .catch(function (e) {
          var m = String((e && e.message) || '');
          if (typeof window.toast === 'function') {
            window.toast(/item_kind|check|23514/i.test(m)
              ? 'База не приняла этот вид. Нужна проверка product_cards_item_kind_check с шкафом, шкафом-купе и пеналом.'
              : 'Вид не сохранился', 'err', 6000);
          }
          paint();
        });
    };
  })(window.ProductCardKinds);
}
