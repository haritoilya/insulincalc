# Развёртывание InsulinCalc

Порядок: **GitHub (публичный репозиторий) → Vercel (тестовый адрес *.vercel.app) → Google Cloud (вход и таблицы) → проверка → домен insulincalc.online → SEO.**
Всё бесплатно. Время: ~1–1,5 часа.

---

## 1. Публичный репозиторий на GitHub

Код виден всем, но менять его можете только вы. Секретов и данных семей в репозитории нет: ключи из `config.js` защищены ограничением по домену в Google Cloud, а записи хранятся только в Google Таблицах пользователей.

1. github.com → **New repository** → имя `insulincalc` → **Public** → Create repository.
2. Загрузите файлы (содержимое архива, не саму папку):
   - **Через браузер:** на странице репозитория → *uploading an existing file* → перетащите все файлы и папки → *Commit changes*.
   - **Или через git:**
     ```bash
     cd insulincalc
     git init && git add . && git commit -m "InsulinCalc v1"
     git branch -M main
     git remote add origin https://github.com/<ваш-логин>/insulincalc.git
     git push -u origin main
     ```

### Защита публичного репозитория

- [ ] Двухфакторная защита: Settings → Password and authentication → Enable two-factor authentication. Взломанный аккаунт позволит изменить формулу дозы — это главный риск.
- [ ] Не добавляйте соавторов (Collaborators) без необходимости. Посторонние могут только предложить правку (Pull request), принимаете её вы.
- [ ] Settings → Rules → Rulesets → **New branch ruleset** для `main`: запретить удаление и force push.
- [ ] Settings → Code security: включить **Secret scanning** и **Push protection**.
- [ ] Никогда не загружайте выгрузки таблиц, CSV с записями и личные заметки — история изменений тоже публична.

Лицензия: без файла `LICENSE` все права на код остаются за вами (читать можно, использовать — нет). Чтобы разрешить другим использовать код: Add file → Create new file → `LICENSE` → Choose a license template.

> Хостинг — Vercel: тариф Hobby бесплатный и сам обновляет сайт после каждого коммита. Настройки хостинга — в файле `vercel.json`.

## 2. Тестовый сайт на Vercel

1. vercel.com → **Sign up / Log in with GitHub** (тариф Hobby).
2. **Add New… → Project** → *Import Git Repository* → при запросе дайте Vercel доступ **только к репозиторию `insulincalc`** → **Import**.
3. Настройки: Framework Preset — **Other**; Root Directory — `./`; Build Command и Output Directory — оставьте пустыми (Override выключен).
4. **Deploy**. Через ~30 секунд сайт будет доступен по адресу вида `https://insulincalc.vercel.app` (или `insulincalc-<ник>.vercel.app` — запомните точный адрес).
5. Проверьте: `https://<адрес>/app/` → «Попробовать без входа (демо)» работает уже сейчас.
6. Рекомендуется: Project → **Settings → Deployment Protection** → для *Preview* оставить Vercel Authentication (preview-сборки веток видны только вам), для *Production* — выключить.

Тестовый адрес `*.vercel.app` закрыт от индексации заголовком в `vercel.json`, дублей в поиске не будет.

## 3. Google Cloud: вход через Google и доступ к таблицам

1. console.cloud.google.com → создайте проект **InsulinCalc**.
2. **APIs & Services → Library** → включите: **Google Sheets API**, **Google Drive API**, **Google Picker API**.
3. **Google Auth Platform** (OAuth consent screen):
   - *Branding*: App name `InsulinCalc`, support email, App home page `https://insulincalc.online`, Privacy policy `https://insulincalc.online/privacy/`, Terms `https://insulincalc.online/terms/`, Authorized domain `insulincalc.online`.
   - *Audience*: **External**, статус **Testing**, в *Test users* добавьте свои e-mail (до 100 человек).
   - *Data access* → Add scopes: `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`, `.../auth/drive.file`.
4. *Clients* → **Create client** → тип **Web application**. В **Authorized JavaScript origins** добавьте:
   - `https://insulincalc.vercel.app` (ваш точный тестовый адрес)
   - `https://insulincalc.online`
   - `https://www.insulincalc.online`
   - `http://localhost:8080`
   Redirect URIs не нужны. Скопируйте **Client ID**.
5. **APIs & Services → Credentials → Create credentials → API key** → *Edit*:
   - Application restrictions: **Websites** → `https://insulincalc.vercel.app/*`, `https://insulincalc.online/*`, `https://www.insulincalc.online/*`, `http://localhost:8080/*`
   - API restrictions: **Google Picker API**. Скопируйте ключ.
6. Номер проекта: значок ⚙️ / **IAM & Admin → Settings → Project number**.
7. В GitHub откройте `assets/js/config.js` → ✏️ → вставьте `GOOGLE_CLIENT_ID`, `GOOGLE_API_KEY`, `GOOGLE_APP_ID` (номер проекта) → Commit. Vercel обновит сайт сам.

## 4. Проверка на тестовом адресе

- [ ] `/app/` → «Войти через Google» → окно Google (предупреждение «приложение не проверено» в режиме Testing — нормально) → отметить доступ к Drive.
- [ ] Нет таблицы → «Создать новую» → всплывающее окно со ссылкой, «Копировать», «Открыть», «Отправить себе на почту».
- [ ] Сделать расчёт → строка появилась в листе `Events`.
- [ ] Выйти/войти с другого устройства → сайт сам находит таблицу и предлагает продолжить в ней.
- [ ] Поделиться таблицей со вторым родителем (Редактор) → он входит → «Подключить существующую» → выбирает таблицу.
- [ ] Отчёты, графики, CSV, переключение RU/EN, ммоль/л ↔ мг/дл в ⚙️ Настройках.

**Перенос старых данных:** подключите старую таблицу через «Подключить существующую». Если в её первой строке есть колонка `event_id` (как у старого виджета), сайт продолжит писать в тот же лист и покажет историю в отчётах. Иначе будет создан новый лист `Events`, а старые листы останутся нетронутыми. Старый Apps Script не удаляйте, пока не убедитесь, что всё работает.

## 5. Подключение домена insulincalc.online

Главный адрес — `https://insulincalc.online` (без `www`), `www.insulincalc.online` перенаправляется на него (настройкой домена в Vercel, не в `vercel.json`: два встречных правила дадут бесконечный цикл).

1. Vercel → проект → **Settings → Domains** → **Add** → `insulincalc.online` (Production) и `www.insulincalc.online` (**Redirect to** `insulincalc.online`, 308).
2. Vercel покажет DNS-записи для вашего проекта (значения у каждого проекта свои — копируйте именно их):
   - `A` для `@` → IP из подсказки Vercel;
   - `CNAME` для `www` → значение из подсказки Vercel.
   У регистратора (DNS на REG.RU: `ns1.hosting.reg.ru`, `ns2.hosting.reg.ru`) замените старые `A`/`AAAA`/`CNAME` для `@` и `www`. **NS, MX и TXT-записи (почта, SPF/DKIM/DMARC) не меняйте** — иначе перестанет работать почта `support@insulincalc.online`. Серверы имён Vercel (`ns1/ns2.vercel-dns.com`) не используйте.
3. Если в зоне есть `CAA`, разрешите выпуск сертификатов для `letsencrypt.org`.
4. Подождите, пока в Vercel у домена появится статус **Valid Configuration** (минуты — до 24 ч). SSL-сертификат выпускается автоматически.
5. Старые ссылки `/sasha`, `/calc`, `/ru` и `/report` ведут на `/app/` и `/report/` (`vercel.json`). Прежний адрес `vidgenlab.pro` перенаправляется на `insulincalc.online`, пока он подключён к проекту.
6. При смене домена браузерные данные (настройки, выбранная таблица) не переносятся: после входа через Google настройки подтягиваются из листа `Settings` таблицы, таблицу выберите заново. Приложение, установленное на телефон, нужно установить заново с нового адреса.

## 6. Публикация приложения Google для всех пользователей

1. Подтвердите владение доменом в Google Search Console (шаг 7 — та же процедура).
2. Google Auth Platform → *Audience* → **Publish app** (In production).
3. Используются только не-чувствительные scopes (`drive.file`, email, profile) — проверка безопасности не нужна. Google может запросить проверку бренда (название/логотип/домен) — обычно 2–5 рабочих дней. До её завершения пользователи могут видеть предупреждение.

## 7. SEO

1. **Google Search Console** → Add property → *Domain* `insulincalc.online` → подтвердите TXT-записью в зоне домена на REG.RU (рядом с существующими TXT, их не удаляйте) → *Sitemaps* → `https://insulincalc.online/sitemap.xml`.
2. **Яндекс Вебмастер** (webmaster.yandex.ru) → добавить сайт → подтвердить (DNS или meta-тег в `<head>` главной) → *Индексирование → Файлы Sitemap* → тот же адрес. Укажите регион в «Региональности», если нужно.
3. **Bing Webmaster Tools** → *Import from Google Search Console*.
4. Проверки: Rich Results Test (FAQ, HowTo, WebApplication), PageSpeed Insights (цель 90+ на мобильных).
5. Аналитика (по желанию): **Vercel Web Analytics** (без cookie, вкладка Analytics проекта) или Яндекс Метрика / GA4 — только на лендинги, не на `/app/`.
6. Рост трафика: новые статьи (таблица ХЕ продуктов, гипогликемия у детей, диабет в школе, подсчёт углеводов), ссылки из родительских сообществ, школ диабета, Telegram-каналов, отзывы в каталогах приложений.

## 8. Как обновлять сайт

Любое изменение в ветке `main` (через сайт GitHub или `git push`) автоматически выкатывается Vercel за ~30 секунд. Изменения в другой ветке получают отдельный preview-адрес для проверки до выпуска.

## 7. GMI по данным датчика (сервер Juggluco / Nightscout)

График «Все замеры глюкозы» в отчётах считает GMI за 90 дней. Если подключён сервер датчика — по всем показаниям CGM; если нет — по замерам из таблицы (в легенде указан источник).

Сайт читает данные через свой прокси `/api/cgm` (файл `api/cgm.js`): браузер не может обращаться к `http://IP` с HTTPS-страницы, а адрес и пароль сервера не должны попадать в код сайта (репозиторий публичный).

**Что нужно от сервера.** HTTP-интерфейс в формате Nightscout: `GET /api/v1/entries/sgv.json`. В Juggluco это «Веб-сервер» (Web server, порт по умолчанию 17580). Порт «Zеркала» для этого не подходит — это внутренний протокол Juggluco.
- Juggluco на Android: Настройки → Веб-сервер → включить, «не только локальный», задать secret.
- Консольный juggluco на сервере: проверьте `./juggluco -h`, есть ли опция веб-сервера. Если нет — включите веб-сервер в Juggluco на телефоне, который получает данные, или выгружайте данные в Nightscout (Juggluco: Настройки → Nightscout).
- Порт веб-сервера должен быть открыт в фаерволе.
- Проверка из браузера: `http://<адрес сервера>:17580/api/v1/entries/sgv.json?count=3` — должен вернуться JSON с полями `sgv` и `date`.

**Vercel → Project → Settings → Environment Variables** (Production), затем Redeploy:

| Переменная | Пример | Зачем |
|---|---|---|
| `CGM_URL` | `http://<адрес сервера>:17580` | адрес веб-сервера Juggluco / Nightscout |
| `CGM_SECRET` | секрет веб-сервера | если задан (отправляется как SHA-1 в заголовке `api-secret`) |
| `CGM_TOKEN` | токен Nightscout | вместо `CGM_SECRET`, если используется токен |
| `CGM_ALLOWED_EMAILS` | `mom@gmail.com,dad@gmail.com` | Google-аккаунты, которым можно видеть данные датчика. Без этой переменной прокси выключен |

Проверка: войдите на сайт аккаунтом из списка → Отчёты → в легенде графика «GMI (по 90 дням, данные датчика)».
