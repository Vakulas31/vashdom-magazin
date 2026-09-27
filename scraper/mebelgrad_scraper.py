# Проверка разбора карточки МебельГрада на вёрстке, снятой с сайта 27.09.2026
import mebelgrad_scraper as M
ROW='<tr class="js-prop-replace"><td class="char_name"><div class="props_item"><span itemprop="name" class="js-prop-title">{k}</span></div></td><td class="char_value"><span class="js-prop-value" itemprop="value"> {v} </span></td></tr>'
def page(h1,rows,offers="",og="/upload/x.webp"):
    return ('<html><head><meta property="og:image" content="%s"><meta itemprop="price" content="19890"></head><body>'
            '<div class="breadcrumbs"><a>Главная</a><a>Каталог</a><a>Мебель по сериям</a><a>Серия мебели «Глазго»</a></div>'
            '<h1>%s</h1><div class="tab-pane char"><table>%s</table></div><script>{%s}</script>' % (og,h1,"".join(ROW.format(k=k,v=v) for k,v in rows),offers)) + "x"*600 + '</body></html>'
R=[];ok=lambda n,c,e="":R.append((n,bool(c),e))
p=M.parse_product("https://mebelgrad.com/product/a/",page('Шкаф двухдверный "Глазго" спальня',[("Размеры (ШхГхВ), мм","1020х535х2265"),("Цветовое исполнение","Металл Бруклин/Таксония"),("Глубина, мм","535"),("Высота, мм","2265")]))
ok("шкаф Глазго: Ш1020 В2265 Г535 (порядок ШхГхВ)",(p["dim_w"],p["dim_h"],p["dim_d"])==(1020,2265,535),p)
ok("цвет",p["color"]=="Металл Бруклин/Таксония",p["color"])
ok("фото с адресом сайта",p["photo_url"]=="https://mebelgrad.com/upload/x.webp",p["photo_url"])
ok("категория из крошек",p["category"]=="Серия мебели «Глазго»",p["category"])
ok("цена справочно",p["price"]==19890)
p=M.parse_product("https://mebelgrad.com/product/b/",page('Кровать "Нора" спальня',[("Высота опор","16 см"),("Спальное место, мм","1800х2000"),("Размеры (ШхГхВ), мм","1840х2105х1025")],"'OFFERS_ID':[19375,25622,25623]</script><div title='Ширина: 160'>Ширина: 160</div><div>Ширина: 180</div><script>"))
ok("кровать с вариантами: пометка спального места",p["name"]=='Кровать "Нора" спальня спальное место 1800х2000',p["name"])
ok("кровать: Ш1840 Г2105 В1025",(p["dim_w"],p["dim_h"],p["dim_d"])==(1840,1025,2105),p)
p=M.parse_product("https://mebelgrad.com/product/c/",page('Кровать "Соня"',[("Спальное место, мм","800х1900"),("Размеры (ШхГхВ), мм","850х1950х900")],"'OFFERS_ID':[1,2]</script><div>Ширина: 80</div><script>"))
ok("кровать с одной шириной — без пометки",p["name"]=='Кровать "Соня"',p["name"])
p=M.parse_product("https://mebelgrad.com/product/f/",page('Диван-кровать "Бостон" СТАНДАРТ',[("Спальное место, мм","1460х2800"),("Размеры (ШхГхВ), мм","3200х1040х720")],"'OFFERS_ID':[1,2,3]"))
ok("диван: варианты ткани — без пометки",p["name"]=='Диван-кровать "Бостон" СТАНДАРТ',p["name"])
p=M.parse_product("https://mebelgrad.com/product/d/",page('Стул "Х"',[("Ширина, мм","450"),("Высота сиденья от пола","46 см"),("Высота, мм","900"),("Глубина, мм","520")]))
ok("без строки «Размеры» — из Ширина/Высота/Глубина; высота сиденья не берётся",(p["dim_w"],p["dim_h"],p["dim_d"])==(450,900,520),p)
p=M.parse_product("https://mebelgrad.com/product/e/",page('Модульная гостиная "Ницца" композиция #2',[]))
ok("композиция без размеров — пусто",p["dim_w"] is None and p["dim_h"] is None,p)
ok("не товар — None",M.parse_product("u","<html>"+"x"*600+"</html>") is None)
f=0
for n,c,e in R:
    print(("✓ " if c else "✗ ")+n+("" if c else "  → "+str(e)[:200])); f+=0 if c else 1
print(f"{len(R)-f}/{len(R)}")
