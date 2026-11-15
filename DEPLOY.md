# Развёртывание InsulinCalc

Порядок: **GitHub (публичный репозиторий) → Vercel (тестовый адрес *.vercel.app) → Google Cloud (вход и таблицы) → проверка → домен www.vidgenlab.pro → SEO.**
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
   - *Branding*: App name `InsulinCalc`, support email, App home page `https://www.vidgenlab.pro`, Privacy policy `https://www.vidgenlab.pro/privacy/`, Terms `https://www.vidgenlab.pro/terms/`, Authorized domain `vidgenlab.pro`.
   - *Audience*: **External**, статус **Testing**, в *Test users* добавьте свои e-mail (до 100 человек).
   - *Data access* → Add scopes: `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`, `.../auth/drive.file`.
4. *Clients* → **Create client** → тип **Web application**. В **Authorized JavaScript origins** добавьте:
   - `https://insulincalc.vercel.app` (ваш точный тестовый адрес)
   - `https://www.vidgenlab.pro`
   - `https://vidgenlab.pro`
   - `http://localhost:8080`
   Redirect URIs не нужны. Скопируйте **Client ID**.
5. **APIs & Services → Credentials → Create credentials → API key** → *Edit*:
   - Application restrictions: **Websites** → `https://insulincalc.vercel.app/*`, `https://www.vidgenlab.pro/*`, `https://vidgenlab.pro/*`, `http://localhost:8080/*`
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

## 5. Подключение домена www.vidgenlab.pro

1. Vercel → проект → **Settings → Domains** → **Add** → `www.vidgenlab.pro`. Vercel предложит добавить и `vidgenlab.pro` с редиректом на основной — согласитесь.
2. Vercel покажет DNS-записи. У регистратора домена (или там, где сейчас DNS) сделайте:
   - `A` для `@` (корень) → IP, который показывает Vercel (обычно `76.76.21.21`);
   - `CNAME` для `www` → значение, которое показывает Vercel (обычно `cname.vercel-dns.com`).
   Старые A/CNAME-записи, указывающие на прежний конструктор (Tilda и т.п.), удалите. **MX/TXT записи почты не трогайте.**
3. Альтернатива: перенести NS домена на Vercel (`ns1.vercel-dns.com`, `ns2.vercel-dns.com`) — тогда перенесите в Vercel DNS и почтовые записи.
4. Подождите, пока в Vercel у домена появится статус **Valid Configuration** (минуты — до 24 ч). SSL-сертификат выпускается автоматически.
5. Если домен был привязан к конструктору — отвяжите его там.
6. Старые ссылки `/sasha` и `/report` автоматически ведут на `/app/` и `/report/` (`vercel.json`).

## 6. Публикация приложения Google для всех пользователей

1. Подтвердите владение доменом в Google Search Console (шаг 7 — та же процедура).
2. Google Auth Platform → *Audience* → **Publish app** (In production).
3. Используются только не-чувствительные scopes (`drive.file`, email, profile) — проверка безопасности не нужна. Google может запросить проверку бренда (название/логотип/домен) — обычно 2–5 рабочих дней. До её завершения пользователи могут видеть предупреждение.

## 7. SEO

1. **Google Search Console** → Add property → *Domain* `vidgenlab.pro` → подтвердите TXT-записью у регистратора домена (или в Vercel → Domains, если NS на Vercel) → *Sitemaps* → `https://www.vidgenlab.pro/sitemap.xml`.
2. **Яндекс Вебмастер** (webmaster.yandex.ru) → добавить сайт → подтвердить (DNS или meta-тег в `<head>` главной) → *Индексирование → Файлы Sitemap* → тот же адрес. Укажите регион в «Региональности», если нужно.
3. **Bing Webmaster Tools** → *Import from Google Search Console*.
4. Проверки: Rich Results Test (FAQ, HowTo, WebApplication), PageSpeed Insights (цель 90+ на мобильных).
5. Аналитика (по желанию): **Vercel Web Analytics** (без cookie, вкладка Analytics проекта) или Яндекс Метрика / GA4 — только на лендинги, не на `/app/`.
6. Рост трафика: новые статьи (таблица ХЕ продуктов, гипогликемия у детей, диабет в школе, подсчёт углеводов), ссылки из родительских сообществ, школ диабета, Telegram-каналов, отзывы в каталогах приложений.

## 8. Как обновлять сайт

Любое изменение в ветке `main` (через сайт GitHub или `git push`) автоматически выкатывается Vercel за ~30 секунд. Изменения в другой ветке получают отдельный preview-адрес для проверки до выпуска.
