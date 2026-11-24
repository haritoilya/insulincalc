/* Веб-аналитика (Яндекс Метрика и Google Analytics 4) — только для информационных страниц.
   Включается, когда ниже вписаны идентификаторы. Пока они пустые, ничего не загружается.
   На /app/, /report/ и /cereal/ скрипт не подключён и работает защита по адресу: данные о здоровье в статистику не попадают. */
(function () {
  'use strict';
  var YM_ID = 0;      // номер счётчика Яндекс Метрики, например 12345678
  var GA_ID = '';     // идентификатор Google Analytics 4, например 'G-XXXXXXXXXX'

  if (/^\/(app|report|cereal)(\/|$)/.test(location.pathname)) return;   // страховка
  if (navigator.doNotTrack === '1' || window.doNotTrack === '1') return; // уважаем «Не отслеживать»

  if (YM_ID) {
    (function (m, e, t, r, i, k, a) {
      m[i] = m[i] || function () { (m[i].a = m[i].a || []).push(arguments); };
      m[i].l = 1 * new Date(); k = e.createElement(t); a = e.getElementsByTagName(t)[0]; k.async = 1; k.src = r; a.parentNode.insertBefore(k, a);
    })(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js', 'ym');
    // Вебвизор выключен: запись действий посетителей не ведётся
    window.ym(YM_ID, 'init', { clickmap: true, trackLinks: true, accurateTrackBounce: true, webvisor: false });
  }
  if (GA_ID) {
    var s = document.createElement('script'); s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_ID);
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GA_ID, { anonymize_ip: true, allow_google_signals: false });
  }
})();
