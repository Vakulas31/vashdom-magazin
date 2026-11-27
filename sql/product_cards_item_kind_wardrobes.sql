-- Вид товара в public.product_cards: к списку кроватей добавляются
-- шкаф, шкаф-купе и пенал. Существующие строки не переписываются.
-- Карточки, у которых вид лежит только в note, остаются как есть.

do $$
declare
  def text;
begin
  select pg_get_constraintdef(oid) into def
  from pg_constraint
  where conname = 'product_cards_item_kind_check'
    and conrelid = 'public.product_cards'::regclass;

  if def is null or position('шкаф-купе' in def) = 0 then
    alter table public.product_cards drop constraint if exists product_cards_item_kind_check;
    alter table public.product_cards
      add constraint product_cards_item_kind_check
      check (item_kind in (
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
      ));
  end if;
end $$;
