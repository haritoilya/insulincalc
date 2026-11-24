# Переезд сайта с Vercel на GitHub Pages

Домен остаётся `insulincalc.online`, поэтому Google-вход, ключи, Apps Script и сервер GMI **не меняются**.
Что готово в репозитории: workflow `.github/workflows/pages.yml` (выкладка при каждом изменении `main`), файл `CNAME`,
`.nojekyll`, страницы-перенаправления `/sasha/`, `/calc/`, `/ru/`, проверочный скрипт `tools/check_site.sh`.

## Что изменится по сравнению с Vercel

| Было (Vercel) | Стало (GitHub Pages) |
|---|---|
| Серверные редиректы `/sasha`, `/calc`, `/ru` (`vercel.json`) | Маленькие HTML-страницы с мгновенным перенаправлением (`sasha/`, `calc/`, `ru/`) |
| Заголовок `X-Robots-Tag: noindex` для `/app/`, `/report/`, `/cereal/` | Тот же запрет, но мета-тегом `noindex` в самих страницах (он у них уже есть) |
| Свои заголовки безопасности и кеша | Недоступны. GitHub Pages сам отдаёт кеш на 10 минут (поэтому версии `?v=` в ссылках обновлены) |
| Превью веток | Нет. Проверять изменения нужно локально или после слияния в `main` |
| `www` → основной домен (настройка в Vercel) | GitHub делает это сам, если у `www` стоит CNAME на `haritoilya.github.io` |

## Шаг 0. Проверьте, что GitHub открывается у вас без VPN

Откройте с телефона по мобильной сети и с домашнего интернета, **без VPN**: `https://haritoilya.github.io/`
(страница 404 от GitHub — это нормально, главное, что она открылась). Если не открывается, переезд не решит проблему —
напишите мне, подготовлю вариант на другом хостинге (Cloudflare Pages, Yandex Cloud или Netlify).

## Шаг 1. Влить подготовку в `main`

Сделаю я по вашей команде. До переключения DNS Vercel продолжает обслуживать сайт, ничего не ломается.

## Шаг 2. Включить Pages (один раз, 30 секунд)

1. GitHub → репозиторий `insulincalc` → **Settings → Pages**.
2. **Build and deployment → Source: GitHub Actions**.
3. Вкладка **Actions** → «Deploy to GitHub Pages» → дождитесь зелёной галочки (если запуск не пошёл сам — **Run workflow**).

## Шаг 3. Подтвердить домен (защита от захвата)

GitHub → ваш аватар → **Settings → Pages → Add a domain** → `insulincalc.online` → GitHub покажет TXT-запись
вида `_github-pages-challenge-haritoilya` со значением. Добавьте её в DNS (шаг 5) и нажмите **Verify**.

## Шаг 4. Указать домен в Pages

Репозиторий → **Settings → Pages → Custom domain** → `insulincalc.online` → **Save**.
Сообщение «DNS check unsuccessful» до смены DNS нормально.

## Шаг 5. Изменить DNS на reg.ru (DNS-серверы `ns1.hosting.reg.ru`, `ns2.hosting.reg.ru`)

Удалите старые записи `@` и `www`, которые вели на Vercel (A `76.76.21.21`, CNAME `cname.vercel-dns.com`), и добавьте:

| Тип | Имя | Значение |
|---|---|---|
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| AAAA | `@` | `2606:50c0:8000::153` |
| AAAA | `@` | `2606:50c0:8001::153` |
| AAAA | `@` | `2606:50c0:8002::153` |
| AAAA | `@` | `2606:50c0:8003::153` |
| CNAME | `www` | `haritoilya.github.io` |
| TXT | `_github-pages-challenge-haritoilya` | значение из шага 3 |

**NS, MX и другие TXT-записи (почта, SPF/DKIM/DMARC) не трогайте.** Обновление DNS занимает от нескольких минут до суток.

## Шаг 6. Включить HTTPS

Когда в **Settings → Pages** у домена появится зелёная галочка DNS check, поставьте **Enforce HTTPS**
(сертификат выпускается автоматически, обычно до 15 минут, иногда дольше).

## Шаг 7. Проверка

```bash
./tools/check_site.sh
```

Скрипт проверит все страницы, перенаправления, 404, `http` → `https`, `www`, `noindex` у `/app/`.
Дополнительно откройте `https://insulincalc.online/app/` и войдите через Google, откройте `/cereal/` и `/report/`.

## Шаг 8. Отключить Vercel

1. Vercel → проект → **Settings → Domains** → удалить `insulincalc.online` и `www.insulincalc.online`.
2. Проект можно удалить (**Settings → General → Delete Project**), токены Vercel отозвать.
3. Файл `vercel.json` в репозитории больше не нужен, его можно удалить.
4. Google Cloud → Credentials → из разрешённых адресов можно убрать `https://*.vercel.app` (если они там были).

## Откат

Верните в DNS записи Vercel из шага 5 (A `76.76.21.21`, CNAME `www` на `cname.vercel-dns.com`) и заново добавьте домен
в проект Vercel. Репозиторий при этом не меняется.

## Дальше

- Любое слияние в `main` выкладывается автоматически за 1–2 минуты (смотрите вкладку **Actions**).
- Search Console / Яндекс Вебмастер: после смены хостинга ничего переподтверждать не нужно, если подтверждение через DNS (TXT).
