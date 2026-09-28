# -*- coding: utf-8 -*-
"""
Сборщик каталога «МиФ» (mebelmif.ru, Пенза) → Supabase catalog_items.
Запускается в GitHub Actions (.github/workflows/mif-scrape.yml).

Нужны размеры и цвет — для кнопки «🔗 Размеры с сайтов фабрик».

Как устроен сайт (разведка 27.09.2026): Битрикс.
  • Товары — в sitemap.xml → sitemap-iblock-6.xml, адреса вида
    /catalog/<раздел>/<номер>/ (около 1 370). Разделы без номера — списки, их пропускаем.
  • Карточка: h1 + блоки
      <div class="product-parametrs__item"><span>Ширина (Габарит) мм:</span> 600</div>
    «Ширина / Высота / Глубина (Габарит) мм», «Цвет:».
  • Есть карточки-наборы («Тумба ТВ + Шкаф + Комод») — их размеры
    приложение само не раздаёт строкам прайса (набор ≠ модуль).
"""
import os, re, sys, time, json
import requests
from bs4 import BeautifulSoup

SITE = "https://mebelmif.ru"
FACTORY = "МИФ"

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://zreqzoetvfnqewqdtqsy.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")
FIRECRAWL_KEY = os.environ.get("FIRECRAWL_API_KEY", "")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ru-RU,ru;q=0.9",
}
DELAY = 4.0          # сайт МиФ режет частые запросы (503) — идём медленно
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
    # Сайт МиФ при частых запросах отвечает 503 «Service Temporarily Unavailable»
    # (проверено 27.09.2026). Тогда ждём и пробуем снова: 10, 30, 60 секунд.
    for wait in (0, 10, 30, 60):
        if wait:
            print(f"  … сайт просит паузу, жду {wait} с")
            time.sleep(wait)
        try:
            r = session.get(url, timeout=TIMEOUT)
            if r.status_code == 200 and len(r.text) > 500 and "Service Temporarily Unavailable" not in r.text[:2000]:
                return r.text
            print(f"  ! ответ {r.status_code}")
            if r.status_code not in (429, 502, 503, 504):
                break
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
    """sitemap.xml → вложенные sitemap → адреса /catalog/<раздел>/<номер>/"""
    urls, seen = [], set()
    top = fetch(SITE + "/sitemap.xml") or ""
    maps = [SITE + "/sitemap.xml"] + [u for u in re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", top) if u.endswith(".xml")]
    for sm in maps:
        xml = top if sm == SITE + "/sitemap.xml" else (fetch(sm) or "")
        for loc in re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", xml):
            u = loc.split("?")[0]
            path = re.sub(r"^https?://[^/]+", "", u)
            if re.match(r"^/catalog/[^/]+/\d+/$", path) and u not in seen:
                seen.add(u)
                urls.append(SITE + path)
    return urls


def _mm(v):
    m = re.search(r"\d+(?:[.,]\d+)?", v or "")
    if not m:
        return None
    n = int(round(float(m.group(0).replace(",", "."))))
    return n if 100 <= n <= 5000 else None


def parse_product(url, html):
    soup = BeautifulSoup(html, "lxml")
    h1 = soup.find("h1")
    if not h1:
        return None
    name = re.sub(r"\s+", " ", h1.get_text(" ", strip=True)).strip()
    if not name or "Страница не найдена" in html[:30000] or "Service Temporarily" in name:
        return None
    props = {}
    for it in soup.select(".product-parametrs__item"):
        sp = it.find("span")
        if not sp:
            continue
        k = re.sub(r"\s+", " ", sp.get_text(" ", strip=True)).rstrip(":").strip()
        v = re.sub(r"\s+", " ", it.get_text(" ", strip=True).replace(sp.get_text(" ", strip=True), "", 1)).strip()
        if k and k not in props:
            props[k] = v
    w = h = d = None
    for k, v in props.items():
        kl = k.lower()
        if kl.startswith("ширина") and w is None: w = _mm(v)
        elif kl.startswith("высота") and h is None: h = _mm(v)
        elif (kl.startswith("глубина") or kl.startswith("длина")) and d is None: d = _mm(v)
    color = next((v[:80] for k, v in props.items() if k.lower().startswith("цвет")), None)
    price = None
    mp = re.search(r"(\d[\d\s\u00a0]{2,9})\s*₽", soup.get_text(" ", strip=True)[:6000])
    if mp:
        try: price = int(re.sub(r"\D", "", mp.group(1)))
        except Exception: price = None
    photo = None
    for im in soup.find_all("img"):
        src = im.get("data-src") or im.get("src") or ""
        if "/upload/" in src:
            photo = src if src.startswith("http") else SITE + src
            break
    crumbs = [a.get_text(strip=True) for a in soup.select(".breadcrumbs a, [class*=bread] a")]
    category = crumbs[-1] if crumbs else ""
    return {
        "factory": FACTORY, "name": name[:300], "url": url, "photo_url": photo,
        "price": price, "category": category[:120], "color": color,
        "dim_w": w, "dim_h": h, "dim_d": d,
        "raw_specs": (" | ".join(f"{k}: {v}" for k, v in props.items()))[:900] or None,
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
        print("⚠ sitemap не отдался — сайт закрыл доступ?")
        sys.exit(1)
    limit = int(os.environ.get("SCRAPE_LIMIT", "0") or 0) or None
    start = int(os.environ.get("SCRAPE_FROM", "0") or 0)
    batch = []
    fails = 0
    for i, url in enumerate(urls):
        if i < start:
            continue
        if limit and stats["products"] >= limit:
            print(f"Достигнут пробный лимит {limit} — стоп.")
            break
        time.sleep(DELAY)
        html = fetch(url)
        stats["pages"] += 1
        if not html:
            stats["errors"] += 1
            fails += 1
            print(f"[{i+1}/{len(urls)}] ✗ не скачалось: {url}")
            if fails >= 5:
                # сайт закрыл доступ надолго — сохраняем собранное и выходим спокойно
                save_batch(batch); batch = []
                print(f"⚠ Сайт перестал отвечать. Сохранено {stats['saved']}. "
                      f"Запустите позже с «Начать с» = {i} — продолжит с этого места.")
                print(json.dumps(stats, ensure_ascii=False))
                return
            continue
        fails = 0
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
