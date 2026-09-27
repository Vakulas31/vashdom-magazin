# -*- coding: utf-8 -*-
"""
Сборщик каталога «МебельГрад» (mebelgrad.com) → Supabase catalog_items.
Запускается в GitHub Actions (.github/workflows/mebelgrad-scrape.yml).

Цены с сайта нам НЕ нужны (сохраняются только для справки) — главное
размеры и цвет, чтобы кнопка «🔗 Размеры с сайтов фабрик» в приложении
дописала их товарам прайса МебельГрада.

Как устроен сайт (разведка 27.09.2026): Битрикс, шаблон Aspro Max.
  • Список товаров — в sitemap-iblock-68.xml и sitemap-iblock-66.xml
    (во втором ссылки с ?offer=… — варианты цвета/ширины; берём адрес без него).
  • Карточка /product/<slug>/: h1 + таблица характеристик
      <span class="js-prop-title">Размеры (ШхГхВ), мм</span>
      <span class="js-prop-value">1020х535х2265</span>
    ВНИМАНИЕ: порядок Ш×Г×В (глубина вторая!). Запасные строки —
    «Ширина, мм», «Глубина, мм», «Высота, мм». «Цветовое исполнение» — цвет.
  • У кроватей несколько вариантов по ширине, а на странице — размеры одного.
    Такой товар сохраняем с пометкой «спальное место 1800х2000» в названии,
    чтобы приложение не раздало эти размеры кроватям другой ширины.
"""
import os, re, sys, time, json
import requests
from bs4 import BeautifulSoup

SITE = "https://mebelgrad.com"
FACTORY = "МебельГрад"
SITEMAPS = ["/sitemap-iblock-68.xml", "/sitemap-iblock-66.xml"]

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://zreqzoetvfnqewqdtqsy.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")
FIRECRAWL_KEY = os.environ.get("FIRECRAWL_API_KEY", "")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ru-RU,ru;q=0.9",
}
DELAY = 1.0
TIMEOUT = 40
session = requests.Session()
session.headers.update(HEADERS)
stats = {"pages": 0, "products": 0, "with_dims": 0, "saved": 0, "firecrawl": 0, "errors": 0}


def _sb_headers():
    h = {"apikey": SUPABASE_KEY, "Content-Type": "application/json",
         "Prefer": "resolution=merge-duplicates,return=minimal"}
    if SUPABASE_KEY.startswith("eyJ"):
        h["Authorization"] = f"Bearer {SUPABASE_KEY}"
    return h


def fetch(url):
    try:
        r = session.get(url, timeout=TIMEOUT)
        if r.status_code == 200 and len(r.text) > 500:
            return r.text
        print(f"  ! ответ {r.status_code}")
    except Exception as e:
        print(f"  ! прямой запрос не удался: {e}")
    if FIRECRAWL_KEY:
        try:
            fr = requests.post("https://api.firecrawl.dev/v2/scrape",
                               headers={"Authorization": f"Bearer {FIRECRAWL_KEY}"},
                               json={"url": url, "formats": ["rawHtml"]}, timeout=90)
            if fr.ok:
                data = fr.json().get("data") or {}
                html = data.get("rawHtml") or data.get("html") or ""
                if len(html) > 500:
                    stats["firecrawl"] += 1
                    return html
        except Exception as e:
            print(f"  ! firecrawl не удался: {e}")
    return None


def product_urls():
    urls = []
    seen = set()
    for sm in SITEMAPS:
        xml = fetch(SITE + sm) or ""
        for loc in re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", xml):
            u = loc.split("?")[0]
            if "/product/" in u and u not in seen:
                seen.add(u)
                urls.append(u)
    return urls


def _num(s):
    s = (s or "").replace(",", ".")
    m = re.search(r"\d+(?:\.\d+)?", s)
    return float(m.group(0)) if m else None


def parse_dims(props):
    """→ (ширина, высота, глубина) в мм. «Размеры (ШхГхВ)» — порядок Ш, Г, В."""
    w = h = d = None
    for k, v in props.items():
        kl = k.lower()
        if kl.startswith("размеры"):
            nums = [int(round(float(x.replace(",", ".")))) for x in re.findall(r"\d+(?:[.,]\d+)?", v)]
            order = re.search(r"\(([^)]*)\)", k)
            order = (order.group(1).lower().replace(" ", "") if order else "шхгхв")
            letters = [c for c in re.split(r"[хx×*]", order) if c]
            unit_cm = "см" in kl and "мм" not in kl
            for letter, n in zip(letters, nums):
                n = n * 10 if unit_cm else n
                if letter.startswith("ш") and w is None: w = n
                elif letter.startswith("г") and d is None: d = n
                elif letter.startswith("в") and h is None: h = n
                elif letter.startswith("д") and d is None: d = n   # «длина» у кроватей
            break
    for k, v in props.items():
        kl = k.lower()
        n = _num(v)
        if n is None or "спальн" in kl or "опор" in kl or "сиден" in kl:
            continue
        n = int(round(n * (10 if ("см" in kl and "мм" not in kl) else 1)))
        if kl.startswith("ширина") and w is None: w = n
        elif kl.startswith("высота") and h is None: h = n
        elif (kl.startswith("глубина") or kl.startswith("длина")) and d is None: d = n
    ok = lambda x: x if (x is not None and 100 <= x <= 5000) else None
    return ok(w), ok(h), ok(d)


def parse_product(url, html):
    soup = BeautifulSoup(html, "lxml")
    h1 = soup.find("h1")
    if not h1:
        return None
    name = re.sub(r"\s+", " ", h1.get_text(" ", strip=True)).strip()
    if not name or name.lower() in ("каталог", "404") or "Страница не найдена" in html[:30000]:
        return None
    props = {}
    for tr in soup.select(".tab-pane.char tr, .char tr"):
        k = tr.select_one(".js-prop-title")
        v = tr.select_one(".js-prop-value")
        if k and v:
            kk = re.sub(r"\s+", " ", k.get_text(" ", strip=True))
            if kk not in props:
                props[kk] = re.sub(r"\s+", " ", v.get_text(" ", strip=True))
    w, h, d = parse_dims(props)
    color = None
    for k, v in props.items():
        if k.lower().startswith("цвет"):
            color = v[:80]
            break
    # кровать с вариантами ширины: размеры на странице — только одного варианта
    # (у диванов варианты — это ткань, размер тот же; у кроватей — «Ширина: 140/160/180»)
    widths = set(re.findall(r"(?:Ширина|Размер)[^<>]{0,5}:\s*(\d{2,4})", html))
    sleep = next((v for k, v in props.items() if k.lower().startswith("спальное место")), None)
    if sleep and len(widths) > 1:
        sm = re.findall(r"\d{3,4}", sleep)
        if len(sm) >= 2:
            name = f"{name} спальное место {sm[0]}х{sm[1]}"
    price = None
    mp = soup.find("meta", attrs={"itemprop": "price"})
    if mp and mp.get("content"):
        try: price = int(float(mp["content"]))
        except Exception: price = None
    photo = None
    og = soup.find("meta", property="og:image")
    if og and og.get("content"):
        photo = og["content"]
        if photo.startswith("/"):
            photo = SITE + photo
    crumbs = [a.get_text(strip=True) for a in soup.select(".breadcrumbs a")]
    category = crumbs[-1] if len(crumbs) > 2 else ""
    specs = [f"{k}: {v}" for k, v in props.items()
             if not re.search(r"Высота опор", k)][:14]
    return {
        "factory": FACTORY, "name": name[:300], "url": url, "photo_url": photo,
        "price": price, "category": category[:120], "color": color,
        "dim_w": w, "dim_h": h, "dim_d": d,
        "raw_specs": (" | ".join(specs))[:900] or None,
    }


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
    urls = product_urls()
    print(f"Карточек товаров в sitemap: {len(urls)}")
    if not urls:
        print("⚠ sitemap не отдался — сайт закрыл доступ? Попробуйте с секретом FIRECRAWL_API_KEY.")
        sys.exit(1)
    limit = int(os.environ.get("SCRAPE_LIMIT", "0") or 0) or None
    batch = []
    for i, url in enumerate(urls):
        if limit and stats["products"] >= limit:
            print(f"Достигнут пробный лимит {limit} — стоп.")
            break
        time.sleep(DELAY)
        html = fetch(url)
        stats["pages"] += 1
        if not html:
            stats["errors"] += 1
            print(f"[{i+1}/{len(urls)}] ✗ не скачалось: {url}")
            continue
        item = parse_product(url, html)
        if not item:
            continue
        stats["products"] += 1
        if item["dim_w"] or item["dim_h"] or item["dim_d"]:
            stats["with_dims"] += 1
        batch.append(item)
        dims = "×".join(str(x or "—") for x in (item["dim_w"], item["dim_h"], item["dim_d"]))
        print(f"[{i+1}/{len(urls)}] ✓ {item['name'][:60]} · {dims}")
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
