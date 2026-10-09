# -*- coding: utf-8 -*-
"""
Сборщик каталога «ДСВ» (dsv-mebel.ru) → Supabase catalog_items.
Запускается в GitHub Actions (.github/workflows/dsv-scrape.yml).

Нужны размеры и цвет — для кнопки «🔗 Размеры с сайтов фабрик».

Как устроен сайт (разведка 09.10.2026): WordPress + WooCommerce, тема Rey.
  • Список всех товаров отдаёт открытый API магазина:
      /wp-json/wc/store/v1/products?per_page=100&page=N   (≈156 товаров)
    Запасной путь — /product-sitemap.xml (адреса /mebel/<slug>/).
  • Размеры — на странице товара, в блоке «Свойства» (div.rey-wcPanel):
      «Габариты (ШхВхГ): 782х478х16 мм»               — порядок указан в скобках;
      «Высота: 980 мм. Ширина: 1432 мм. Глубина: 2032 мм.» — построчно;
      «Габариты (ШхВхГ мм): 1532 х 1035 х 2150  1720 х 1035 х 2150 …»
      «Спальное место (ШхВхГ мм): 1400 х 2000  1600 х 2000 …» — у мягких кроватей
       несколько размеров сразу: на каждую ширину спального места пишем отдельную
       строку «<название> спальное место 1400х2000» (так же, как у Браво) — приложение
       даст её размеры только строке прайса с этой шириной.
  • У стульев «Ширина сиденья / Высота спинки» — это не габарит, их пропускаем;
    берём «Высота общая».
  • Модульная система «Роза» на сайте одной страницей без размеров модулей —
    её строки прайса (Комод 1300, Шкаф 900…) отсюда размеры не получат.
  • Запуск №2 (09.10.2026): серверам GitHub сайт отдаёт заглушку вместо данных
    (ответ 200, но не JSON) — такое теперь распознаётся, и страница берётся
    через Firecrawl (секрет FIRECRAWL_API_KEY, тот же, что у Браво).
"""
import os, re, sys, time, json
import requests
from bs4 import BeautifulSoup

SITE = "https://dsv-mebel.ru"
FACTORY = "ДСВ"

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://zreqzoetvfnqewqdtqsy.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")
FIRECRAWL_KEY = os.environ.get("FIRECRAWL_API_KEY", "")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8",
    "Accept-Language": "ru-RU,ru;q=0.9",
}
DELAY = 2.0
TIMEOUT = 40
session = requests.Session()
session.headers.update(HEADERS)
stats = {"pages": 0, "products": 0, "rows": 0, "with_dims": 0, "saved": 0, "firecrawl": 0, "errors": 0}


def _sb_headers():
    h = {"apikey": SUPABASE_KEY, "Content-Type": "application/json",
         "Prefer": "resolution=merge-duplicates,return=minimal"}
    if SUPABASE_KEY.startswith("eyJ"):
        h["Authorization"] = f"Bearer {SUPABASE_KEY}"
    return h


def _looks_ok(text, kind):
    """Проверка, что пришло то, что просили, а не заглушка защиты от ботов.
    Запуск №2 (09.10.2026): сайт отдал серверам GitHub ответ 200, но не JSON —
    сборщик молча получил «0 товаров». Теперь такое распознаём."""
    t = (text or "").lstrip()
    if kind == "json":
        return t.startswith("[") or t.startswith("{")
    if kind == "xml":
        return "<loc>" in t
    return ("rey-wcPanel" in t) or ("woocommerce" in t and "<h1" in t)


def _json_from_firecrawl(html):
    """Firecrawl отдаёт JSON, завёрнутый в <pre> страницы браузера — достаём."""
    import html as _h
    t = _h.unescape(re.sub(r"<[^>]+>", "", html or "")).strip()
    a, b = t.find("["), t.rfind("]")
    return t[a:b + 1] if a >= 0 and b > a else ""


def fetch(url, min_len=500, kind="html"):
    for wait in (0, 10, 30):
        if wait:
            print(f"  … сайт просит паузу, жду {wait} с")
            time.sleep(wait)
        try:
            r = session.get(url, timeout=TIMEOUT)
            if r.status_code == 200 and len(r.text) > min_len and _looks_ok(r.text, kind):
                return r.text
            if r.status_code == 200:
                head = re.sub(r"\s+", " ", r.text[:160])
                print(f"  ! сайт ответил, но не то, что нужно (защита от ботов?): «{head}»")
                break
            print(f"  ! ответ {r.status_code}")
            if r.status_code not in (429, 502, 503, 504):
                break
        except Exception as e:
            print(f"  ! прямой запрос не удался: {e}")
            break
    if FIRECRAWL_KEY:
        try:
            fr = requests.post("https://api.firecrawl.dev/v2/scrape",
                               headers={"Authorization": f"Bearer {FIRECRAWL_KEY}"},
                               json={"url": url, "formats": ["rawHtml"]}, timeout=120)
            if fr.ok:
                data = fr.json().get("data") or {}
                html = data.get("rawHtml") or data.get("html") or ""
                if kind == "json":
                    html = _json_from_firecrawl(html)
                if len(html) > min_len and _looks_ok(html, kind):
                    stats["firecrawl"] += 1
                    return html
                print(f"  ! firecrawl тоже отдал не то ({len(html)} знаков)")
            else:
                print(f"  ! firecrawl: ответ {fr.status_code} {fr.text[:120]}")
        except Exception as e:
            print(f"  ! firecrawl не удался: {e}")
    else:
        print("  ! ключа FIRECRAWL_API_KEY нет — обойти защиту нечем")
    return None


def _strip(html):
    t = re.sub(r"<[^>]+>", " ", html or "")
    t = re.sub(r"&nbsp;|&#160;", " ", t)
    t = re.sub(r"&[a-z#0-9]+;", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def product_list():
    """[{name, url, photo, price, category}] — из API магазина, иначе из sitemap."""
    out, seen = [], set()
    for page in range(1, 11):
        txt = fetch(f"{SITE}/wp-json/wc/store/v1/products?per_page=100&page={page}", min_len=2, kind="json")
        if not txt:
            break
        try:
            arr = json.loads(txt)
        except Exception:
            print("  ! список товаров пришёл, но это не JSON")
            break
        if not isinstance(arr, list) or not arr:
            break
        for p in arr:
            url = (p.get("permalink") or "").split("?")[0]
            if not url or url in seen:
                continue
            seen.add(url)
            imgs = p.get("images") or []
            price = None
            try:
                pr = int((p.get("prices") or {}).get("price") or 0)
                minor = int((p.get("prices") or {}).get("currency_minor_unit") or 0)
                price = (pr // (10 ** minor)) or None
            except Exception:
                price = None
            out.append({
                "name": _strip(p.get("name")),
                "url": url,
                "photo": (imgs[0].get("src") if imgs else None),
                "price": price,
                "category": ", ".join(c.get("name", "") for c in (p.get("categories") or []))[:120],
                "api_text": _strip(p.get("description")) + " " + _strip(p.get("short_description")),
            })
        if len(arr) < 100:
            break
    if out:
        return out
    # запасной путь — sitemap
    xml = fetch(SITE + "/product-sitemap.xml", min_len=50, kind="xml") or ""
    for loc in re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", xml):
        u = loc.split("?")[0]
        if re.search(r"/mebel/[^/]+/?$", u) and u not in seen:
            seen.add(u)
            out.append({"name": "", "url": u, "photo": None, "price": None, "category": "", "api_text": ""})
    return out


_X = r"\s*[хx×*]\s*"


def parse_specs(text):
    """Текст блока «Свойства» → {'sizes': [(w,h,d)…], 'sleep': [(w,l)…], 'colors': str|None}"""
    t = (text or "").replace(" ", " ")
    sizes, sleep = [], []
    g = re.search(r"Габарит[а-я]*\s*\(\s*([ШВГДшвгд])" + _X + r"([ШВГДшвгд])" + _X + r"([ШВГДшвгд])[^)]*\)\s*:?\s*((?:\d{2,4}" + _X + r"\d{2,4}" + _X + r"\d{2,4}[\s,;.мм]*)+)", t, re.I)
    if g:
        order = [x.upper().replace("Д", "Г") for x in g.group(1, 2, 3)]
        for m in re.finditer(r"(\d{2,4})" + _X + r"(\d{2,4})" + _X + r"(\d{2,4})", g.group(4)):
            o = dict(zip(order, (int(m.group(1)), int(m.group(2)), int(m.group(3)))))
            sizes.append((o.get("Ш"), o.get("В"), o.get("Г")))
    sp = re.search(r"Спальн[а-я]*\s+мест[а-я]*[^:]{0,20}:\s*((?:\d{3,4}" + _X + r"\d{3,4}[\s,;.мм]*)+)", t, re.I)
    if sp:
        sleep = [(int(m.group(1)), int(m.group(2))) for m in re.finditer(r"(\d{3,4})" + _X + r"(\d{3,4})", sp.group(1))]
    if not sizes:
        def one(rx):
            m = re.search(rx, t, re.I)
            return int(m.group(1)) if m else None
        w = one(r"(?:^|[\s.,;])Ширина(?!\s+(?:сиден|спинк))[^:\d]{0,12}:?\s*(\d{2,4})")
        h = one(r"(?:^|[\s.,;])Высота(?!\s+(?:сиден|спинк|подлок))(?:\s+общая)?[^:\d]{0,12}:?\s*(\d{2,4})")
        d = one(r"(?:^|[\s.,;])(?:Глубина|Длина)(?!\s+(?:сиден|спинк))[^:\d]{0,12}:?\s*(\d{2,4})")
        if w or h or d:
            sizes.append((w, h, d))
    colors = None
    c = re.search(r"Оттенки[^:]{0,30}:\s*(.+?)(?=\s(?:Материал|Фасады|Направляющ|Высота|Ширина|Глубина|Габарит|Видеообзор|Комплектац)|$)", t, re.I)
    if c:
        colors = c.group(1).strip(" .;")[:120]
    return {"sizes": sizes, "sleep": sleep, "colors": colors}


def _ok(n):
    return n if (n and 10 <= n <= 5000) else None


def _name_width(name):
    """Ширина из названия: «Шкаф «Пальма» 1600» → 1600, «МШ 900.2» → 900. Иначе None."""
    m = re.search(r"(?:^|[\s»])(\d{3,4})(?:\.\d)?(?:\s|$)", name)
    n = int(m.group(1)) if m else None
    return n if n and n >= 300 else None


def _sane(name, w, h, d):
    """На сайте ДСВ у части карточек размеры скопированы с соседней
    («Антресоль «Пальма» 1600» — 800×400×510, «Полка «Пальма» 1600» — 782 мм).
    Если ширина в названии и ширина в карточке расходятся больше чем на 15 % —
    размерам не верим: лучше пусто, чем неправда на ценнике."""
    nw = _name_width(name)
    if nw and w and abs(w - nw) > 0.15 * nw and not re.search(r"спальное место|кроват", name, re.I):
        return None, None, None
    return w, h, d


def parse_product(item, html):
    soup = BeautifulSoup(html, "lxml")
    name = item.get("name") or ""
    if not name:
        h1 = soup.find("h1")
        name = re.sub(r"\s+", " ", h1.get_text(" ", strip=True)).strip() if h1 else ""
    if not name:
        return []
    panels = soup.select(".rey-wcPanel")
    text = " \n ".join(p.get_text(" ", strip=True) for p in panels) if panels else soup.get_text(" ", strip=True)
    spec = parse_specs(text)
    if not spec["sizes"] and item.get("api_text"):
        spec2 = parse_specs(item["api_text"])
        spec["sizes"] = spec2["sizes"]
        spec["sleep"] = spec["sleep"] or spec2["sleep"]
        spec["colors"] = spec["colors"] or spec2["colors"]
    photo = item.get("photo")
    if not photo:
        im = soup.select_one(".woocommerce-product-gallery img")
        photo = (im.get("data-src") or im.get("src")) if im else None
    base = {"factory": FACTORY, "photo_url": photo, "price": item.get("price"),
            "category": (item.get("category") or "")[:120], "color": spec["colors"],
            "raw_specs": re.sub(r"\s+", " ", text)[:900] or None}
    rows = []
    sizes, sleep = spec["sizes"], spec["sleep"]
    if len(sizes) > 1 and len(sleep) == len(sizes):
        # мягкая кровать с несколькими размерами: строка на каждую ширину
        for (w, h, d), (sw, sl) in zip(sizes, sleep):
            rows.append(dict(base, name=f"{name} спальное место {sw}х{sl}"[:300], url=f"{item['url']}#sm{sw}",
                             dim_w=_ok(w), dim_h=_ok(h), dim_d=_ok(d)))
    else:
        w, h, d = sizes[0] if len(sizes) == 1 else (None, None, None)
        nm = name
        if len(sleep) == 1:
            nm = f"{name} спальное место {sleep[0][0]}х{sleep[0][1]}"
        w, h, d = _sane(name, _ok(w), _ok(h), _ok(d))
        rows.append(dict(base, name=nm[:300], url=item["url"], dim_w=w, dim_h=h, dim_d=d))
    return rows


def save_batch(rows):
    if not rows:
        return
    if not SUPABASE_KEY:
        raise SystemExit("Нет ключа Supabase: добавьте секрет репозитория SUPABASE_KEY (sb_secret_…)")
    r = requests.post(f"{SUPABASE_URL}/rest/v1/catalog_items?on_conflict=url", headers=_sb_headers(),
                      data=json.dumps(rows, ensure_ascii=False).encode("utf-8"), timeout=60)
    if not r.ok:
        print("!! Supabase:", r.status_code, r.text[:300])
        stats["errors"] += 1
    else:
        stats["saved"] += len(rows)


def main():
    print(f"═══ Сборщик {FACTORY} ═══")
    items = product_list()
    print(f"Товаров на сайте: {len(items)}")
    if not items:
        print("⚠ список товаров не отдался — сайт закрыл доступ?")
        sys.exit(1)
    limit = int(os.environ.get("SCRAPE_LIMIT", "0") or 0) or None
    start = int(os.environ.get("SCRAPE_FROM", "0") or 0)
    batch, fails = [], 0
    for i, it in enumerate(items):
        if i < start:
            continue
        if limit and stats["products"] >= limit:
            print(f"Достигнут пробный лимит {limit} — стоп.")
            break
        time.sleep(DELAY)
        html = fetch(it["url"])
        stats["pages"] += 1
        if not html:
            stats["errors"] += 1
            fails += 1
            print(f"[{i+1}/{len(items)}] ✗ не скачалось: {it['url']}")
            if fails >= 5:
                save_batch(batch); batch = []
                print(f"⚠ Сайт перестал отвечать. Сохранено {stats['saved']}. "
                      f"Запустите позже с «Начать с» = {i} — продолжит с этого места.")
                print(json.dumps(stats, ensure_ascii=False))
                return
            continue
        fails = 0
        rows = parse_product(it, html)
        if not rows:
            continue
        stats["products"] += 1
        for r in rows:
            stats["rows"] += 1
            if r["dim_w"] or r["dim_h"] or r["dim_d"]:
                stats["with_dims"] += 1
            dims = "×".join(str(x or "—") for x in (r["dim_w"], r["dim_h"], r["dim_d"]))
            print(f"[{i+1}/{len(items)}] ✓ {r['name'][:70]} · {dims}")
        batch.extend(rows)
        if len(batch) >= 50:
            save_batch(batch); batch = []
    save_batch(batch)
    print("═══ ИТОГ ═══")
    print(json.dumps(stats, ensure_ascii=False))
    if stats["saved"] == 0:
        print("⚠ Ничего не сохранено — смотрите лог выше.")
        sys.exit(1)


if __name__ == "__main__":
    main()
