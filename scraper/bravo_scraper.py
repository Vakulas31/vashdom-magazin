# -*- coding: utf-8 -*-
"""
Скрейпер каталога «Браво Мебель» (tdbravomebel.ru) → Supabase catalog_items.
Запускается в GitHub Actions (см. .github/workflows/bravo-scrape.yml).

Логика:
1) Берём sitemap.xml (или обходим известные разделы), собираем URL страниц /catalogue/.
2) Каждую страницу качаем с браузерным User-Agent (вежливо, с паузой).
   Если сайт не отдаёт страницы напрямую — фолбэк через Firecrawl API (ключ в secrets).
3) Распознаём карточки товара (h1 + характеристики/цена), вытаскиваем:
   название, цену, размеры (из характеристик или из URL: ..._2090_1500_1080_...),
   цвет, категорию (из пути), фото (og:image).
4) Пишем в Supabase upsert'ом по url (on_conflict) — повторный запуск обновляет цены.
"""
import os, re, sys, time, json, xml.etree.ElementTree as ET
import requests
from bs4 import BeautifulSoup

SITE = "https://tdbravomebel.ru"
FACTORY = "Браво Мебель"

# Ключи Supabase те же, что в приложении (анонимный ключ публичен по дизайну)
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://zreqzoetvfnqewqdtqsy.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpyZXF6b2V0dmZucWV3cWR0cXN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0NjQzNTQsImV4cCI6MjA5NzA0MDM1NH0.2GtDtMQEIRHaCfCq2Ne37-4m7tAuV_PmoFco_pUgzW4")
FIRECRAWL_KEY = os.environ.get("FIRECRAWL_API_KEY", "")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ru-RU,ru;q=0.9",
}
DELAY = 1.0          # пауза между запросами — вежливость к сайту
TIMEOUT = 30
session = requests.Session()
session.headers.update(HEADERS)

stats = {"pages": 0, "products": 0, "saved": 0, "firecrawl": 0, "errors": 0}


def fetch(url):
    """Страница напрямую; при неудаче — через Firecrawl (если есть ключ)."""
    try:
        r = session.get(url, timeout=TIMEOUT)
        if r.status_code == 200 and len(r.text) > 500:
            return r.text
    except Exception as e:
        print(f"  ! прямой запрос не удался: {e}")
    if FIRECRAWL_KEY:
        try:
            fr = requests.post(
                "https://api.firecrawl.dev/v2/scrape",
                headers={"Authorization": f"Bearer {FIRECRAWL_KEY}"},
                json={"url": url, "formats": ["html"]},
                timeout=90,
            )
            if fr.ok:
                data = fr.json().get("data") or {}
                html = data.get("html") or ""
                if len(html) > 500:
                    stats["firecrawl"] += 1
                    return html
        except Exception as e:
            print(f"  ! firecrawl не удался: {e}")
    return None


def get_urls_from_sitemap():
    urls = set()
    for sm in ("/sitemap.xml", "/sitemap_index.xml"):
        try:
            r = session.get(SITE + sm, timeout=TIMEOUT)
            if not r.ok:
                continue
            root = ET.fromstring(r.content)
            ns = {"s": root.tag.split("}")[0].strip("{")}
            locs = [e.text.strip() for e in root.iter() if e.tag.endswith("loc") and e.text]
            for u in locs:
                if u.endswith(".xml"):  # вложенный sitemap
                    try:
                        r2 = session.get(u, timeout=TIMEOUT)
                        root2 = ET.fromstring(r2.content)
                        urls.update(e.text.strip() for e in root2.iter()
                                    if e.tag.endswith("loc") and e.text)
                    except Exception:
                        pass
                else:
                    urls.add(u)
        except Exception as e:
            print(f"sitemap {sm}: {e}")
    return urls


DIM_IN_URL = re.compile(r"_(\d{3,4})_(\d{3,4})(?:_(\d{3,4}))?(?:_|/|$)")


def dims_from_url(url):
    m = DIM_IN_URL.search(url)
    if not m:
        return (None, None, None)
    nums = [int(x) for x in m.groups() if x]
    nums = [n for n in nums if 200 <= n <= 4000]
    while len(nums) < 3:
        nums.append(None)
    return tuple(nums[:3])


def parse_price(text):
    m = re.search(r"(\d[\d\s ]{2,9})\s*(?:₽|руб)", text)
    if not m:
        return None
    try:
        return int(re.sub(r"\D", "", m.group(1)))
    except Exception:
        return None


def parse_product(url, html):
    soup = BeautifulSoup(html, "lxml")
    h1 = soup.find("h1")
    if not h1:
        return None
    name = re.sub(r"\s+", " ", h1.get_text(strip=True))
    if not name or len(name) < 3:
        return None
    text = soup.get_text(" ", strip=True)
    # признаки карточки товара: характеристики или цена или «добавить/купить»
    is_product = bool(re.search(r"Характеристики|Ширина|Габарит|₽|Цена|В корзину|Купить", text, re.I))
    if not is_product:
        return None

    price = None
    for sel in ("[itemprop=price]", ".price", ".product-price"):
        el = soup.select_one(sel)
        if el:
            price = parse_price(el.get("content") or el.get_text(" "))
            if price:
                break
    if not price:
        price = parse_price(text[:4000])

    specs, color, w, h, d = [], None, None, None, None
    for row in soup.select("tr, .props__item, .characteristics__row, li"):
        t = re.sub(r"\s+", " ", row.get_text(" ", strip=True))
        if len(t) > 120 or ":" not in t and not re.search(r"Ширина|Высота|Глубина|Цвет|Материал|Спальное", t, re.I):
            continue
        if re.search(r"Ширина", t, re.I):
            mm = re.search(r"(\d{3,4})", t)
            w = w or (int(mm.group(1)) if mm else None)
        elif re.search(r"Высота", t, re.I):
            mm = re.search(r"(\d{3,4})", t)
            h = h or (int(mm.group(1)) if mm else None)
        elif re.search(r"Глубина|Длина", t, re.I):
            mm = re.search(r"(\d{3,4})", t)
            d = d or (int(mm.group(1)) if mm else None)
        elif re.search(r"Цвет", t, re.I):
            color = color or t.split(":")[-1].strip()[:80]
        if re.search(r"Ширина|Высота|Глубина|Цвет|Материал|Спальное|Основание", t, re.I):
            specs.append(t)

    uw, uh, ud = dims_from_url(url)
    w, h, d = w or uw, h or uh, d or ud

    photo = None
    og = soup.find("meta", property="og:image")
    if og and og.get("content"):
        photo = og["content"]
        if photo.startswith("/"):
            photo = SITE + photo

    # категория из пути: /catalogue/<раздел>/<категория>/<товар>/
    parts = [p for p in url.replace(SITE, "").split("/") if p]
    category = parts[-2].replace("_", " ").replace("-", " ") if len(parts) >= 3 else (parts[0] if parts else "")

    return {
        "factory": FACTORY,
        "name": name[:300],
        "url": url,
        "photo_url": photo,
        "price": price,
        "category": category[:120],
        "color": color,
        "dim_w": w, "dim_h": h, "dim_d": d,
        "raw_specs": (" | ".join(specs[:12]))[:900] or None,
    }


def save_batch(rows):
    if not rows:
        return
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/catalog_items?on_conflict=url",
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
        data=json.dumps(rows, ensure_ascii=False).encode("utf-8"),
        timeout=60,
    )
    if not r.ok:
        print("!! Supabase:", r.status_code, r.text[:300])
        stats["errors"] += 1
    else:
        stats["saved"] += len(rows)


def main():
    print(f"═══ Скрейпер {FACTORY} ═══")
    urls = get_urls_from_sitemap()
    cat_urls = sorted(u for u in urls if "/catalogue/" in u or "/katalog/" in u or "/catalog/" in u)
    print(f"В sitemap: {len(urls)} URL, из них каталожных: {len(cat_urls)}")
    if not cat_urls:
        # запасной план: обходим известные разделы и собираем ссылки из них
        print("Sitemap пуст — обходим разделы с главной...")
        html = fetch(SITE + "/")
        if html:
            soup = BeautifulSoup(html, "lxml")
            cat_urls = sorted({
                (a["href"] if a["href"].startswith("http") else SITE + a["href"])
                for a in soup.select('a[href*="catalogue"], a[href*="katalog"]')
                if a.get("href")
            })
        print(f"Найдено ссылок: {len(cat_urls)}")

    limit = int(os.environ.get("SCRAPE_LIMIT", "0")) or None  # для пробного запуска
    batch = []
    seen_pages = set()
    for i, url in enumerate(cat_urls):
        if limit and stats["products"] >= limit:
            print(f"Достигнут пробный лимит {limit} товаров — стоп.")
            break
        if url in seen_pages:
            continue
        seen_pages.add(url)
        time.sleep(DELAY)
        html = fetch(url)
        stats["pages"] += 1
        if not html:
            stats["errors"] += 1
            print(f"[{i+1}/{len(cat_urls)}] ✗ не скачалось: {url}")
            continue
        item = parse_product(url, html)
        if item:
            stats["products"] += 1
            batch.append(item)
            print(f"[{i+1}/{len(cat_urls)}] ✓ {item['name'][:60]} · {item['price'] or '—'} ₽")
            if len(batch) >= 50:
                save_batch(batch); batch = []
        else:
            # это страница раздела — дособираем из неё ссылки на товары
            soup = BeautifulSoup(html, "lxml")
            extra = 0
            for a in soup.select('a[href*="/catalogue/"], a[href*="/katalog/"]'):
                u = a.get("href") or ""
                u = u if u.startswith("http") else SITE + u
                u = u.split("#")[0].split("?")[0]
                if u not in seen_pages and u not in cat_urls and u.count("/") >= 5:
                    cat_urls.append(u); extra += 1
            print(f"[{i+1}/{len(cat_urls)}] раздел, +{extra} ссылок: {url}")

    save_batch(batch)
    print("═══ ИТОГ ═══")
    print(json.dumps(stats, ensure_ascii=False))
    if stats["saved"] == 0:
        print("⚠ Ничего не сохранено — проверьте лог выше (SQL 7.1 выполнен? сайт отвечает?)")
        sys.exit(1)


if __name__ == "__main__":
    main()
