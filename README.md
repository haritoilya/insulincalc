# InsulinCalc — www.vidgenlab.pro

Калькулятор дозы инсулина и дневник диабета 1 типа. Статический сайт без собственного сервера:
браузер пользователя через Google OAuth (scope `drive.file`) пишет данные в **его собственную Google Таблицу**.

## Структура

| Путь | Что это |
|---|---|
| `/index.html`, `/en/` | Лендинги RU / EN (SEO) |
| `/app/` | Калькулятор (бывш. `/sasha`, редирект в `_redirects`) |
| `/report/` | Отчёты: УК/ФЧИ, графики, метрики, журнал, CSV |
| `/kak-rasschitat-dozu-insulina/`, `/en/insulin-dose-guide/` | SEO-статьи |
| `/privacy/`, `/terms/` | Политика и условия (нужны для Google OAuth) |
| `assets/js/config.js` | **Единственный файл, который нужно заполнить** (Client ID, API key, номер проекта) |
| `assets/js/core.js` | Вход Google, Drive/Sheets API, демо-режим, очередь неотправленных записей, общий интерфейс |
| `assets/js/calc.js` | Пошаговый калькулятор, напоминания 2 ч / 4 ч, активный инсулин |
| `assets/js/stats.js` | Расчёт УК/ФЧИ (чистые события, регрессия, по приёмам), агрегаты |
| `assets/js/report.js` | Страница отчётов |
| `assets/js/i18n.js` | Переводы RU / EN |
| `vercel.json` | Настройки Vercel: редиректы `/sasha → /app/`, заголовки, noindex для *.vercel.app |
| `robots.txt`, `sitemap.xml`, `manifest.webmanifest` | SEO / PWA |

## Схема листа `Events`

Колонки листа (31, в порядке рабочей таблицы): `timestamp, user_id, event_type, event_subtype, target_glucose, current_glucose, uc, carbs_he, carbs_grams, compensation_dose, food_insulin, total_raw, dose_down, dose_up, selected_dose, rounding_choice, predicted_down, predicted_up, pause_minutes, pen_step, correction_factor, weight, glucose_2h, glucose_2h_timestamp, glucose_4h, glucose_4h_timestamp, notes, timestamp_w, timestamp_moscow, event_id, event_status`. Время: `timestamp`, `timestamp_moscow` и `glucose_*_timestamp` — московское (`15.11.2026, 12:10`), от него считаются замеры через 2 и 4 ч (в т.ч. автозаполнение с сервера Juggluco); `timestamp_w` — местное время в часовом поясе, выбранном в начале расчёта (по умолчанию — пояс устройства). Статус после обоих замеров — `completed`. Числа записываются как числа, вводить можно через точку или запятую. Приём пищи распознаётся без учёта регистра и языка: `завтрак` = `breakfast`, `обед` = `lunch`, `ужин` = `dinner`. Старые записи с прежними названиями колонок читаются автоматически.
Глюкоза хранится в ммоль/л, углеводы — в граммах (и ХЕ). Лист `Settings` — настройки (ключ/значение).

## Локальный запуск

```bash
python3 -m http.server 8080
# открыть http://localhost:8080/app/  (демо-режим работает без настройки Google)
```

Развёртывание — см. `DEPLOY.md`.
