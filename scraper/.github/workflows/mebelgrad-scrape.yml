name: Сборщик каталога МебельГрад (размеры и цвета)

on:
  workflow_dispatch:          # ручной запуск кнопкой (Actions → Run workflow)
    inputs:
      limit:
        description: "Пробный лимит товаров (0 = без лимита)"
        default: "30"
  # ОТКЛЮЧЕНО 27.07.2026 по просьбе владельца: скрейпер сам по расписанию
  # не запускается. Чтобы включить обратно — снять решётки с двух строк ниже.
  # schedule:
  #   - cron: "0 3 * * 1"     # каждый понедельник 03:00 UTC (06:00 МСК)

jobs:
  scrape:
    runs-on: ubuntu-latest
    timeout-minutes: 120
    steps:
      - uses: actions/checkout@v5

      - uses: actions/setup-python@v6
        with:
          python-version: "3.12"

      - name: Установка зависимостей
        run: pip install requests beautifulsoup4 lxml

      - name: Запуск скрейпера
        env:
          FIRECRAWL_API_KEY: ${{ secrets.FIRECRAWL_API_KEY }}
          # v7.26: анонимный доступ к базе закрыт — пишем секретным ключом
          SUPABASE_KEY: ${{ secrets.SUPABASE_KEY }}
          SCRAPE_LIMIT: ${{ github.event.inputs.limit || '0' }}
        run: python scraper/mebelgrad_scraper.py
