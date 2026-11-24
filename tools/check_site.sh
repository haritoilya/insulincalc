#!/usr/bin/env bash
# Проверка сайта после переезда: ./tools/check_site.sh [https://insulincalc.online]
BASE="${1:-https://insulincalc.online}"; HOST="${BASE#*://}"; fail=0
ok()  { printf '  OK    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; fail=1; }
code() { curl -s -m 20 -o /dev/null -w '%{http_code}' "$@"; }

echo "Страницы ($BASE):"
for p in / /en/ /app/ /report/ /cereal/ /kak-rasschitat-dozu-insulina/ /en/insulin-dose-guide/ /privacy/ /terms/ /robots.txt /sitemap.xml /llms.txt /manifest.webmanifest /assets/css/style.css /assets/js/core.js /assets/js/cereal.js /assets/vendor/chart.umd.min.js /assets/img/og-image.jpg; do
  c=$(code "$BASE$p"); [ "$c" = 200 ] && ok "$p" || bad "$p → $c (ожидалось 200)"
done

echo "Старые адреса (перенаправления):"
for p in /sasha/ /calc/ /ru/; do
  body=$(curl -s -m 20 "$BASE$p"); echo "$body" | grep -q 'http-equiv="refresh"' && ok "$p → мета-редирект" || bad "$p без редиректа"
done

echo "Несуществующая страница:"
c=$(code "$BASE/net-takoj-stranicy/"); [ "$c" = 404 ] && ok "404" || bad "404 → $c"

echo "Адреса без слэша и http/www:"
c=$(code "$BASE/app"); case "$c" in 301|308) ok "/app → $c";; *) bad "/app → $c";; esac
c=$(code "http://$HOST/"); case "$c" in 301|308) ok "http → https ($c)";; *) bad "http → $c";; esac
c=$(code "https://www.$HOST/"); case "$c" in 301|308) ok "www → основной ($c)";; *) bad "www → $c";; esac

echo "Содержимое:"
curl -s -m 20 "$BASE/app/" | grep -q 'noindex' && ok "/app/ закрыт от индексации" || bad "/app/ без noindex"
curl -s -m 20 "$BASE/" | grep -q 'rel="canonical" href="https://insulincalc.online/"' && ok "canonical главной" || bad "canonical главной"
curl -s -m 20 "$BASE/sitemap.xml" | grep -q '<loc>https://insulincalc.online/</loc>' && ok "sitemap.xml" || bad "sitemap.xml"

[ $fail = 0 ] && echo "ВСЁ В ПОРЯДКЕ" || { echo "ЕСТЬ ПРОБЛЕМЫ"; exit 1; }
