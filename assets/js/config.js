/* ============================================================================
   InsulinCalc — настройки сайта
   Заполните 3 значения из Google Cloud Console (см. DEPLOY.md, шаг 2).
   Эти значения НЕ секретные: Client ID и API key видны в любом браузере,
   защита обеспечивается ограничениями по домену в Google Cloud.
   ============================================================================ */
window.APP_CONFIG = {
  // OAuth 2.0 Client ID (тип «Web application»)
  GOOGLE_CLIENT_ID: '207213151715-oie38vb2489g22q7n4ma0m0tgjp2hb45.apps.googleusercontent.com',

  // API key (ограничьте: Google Picker API + HTTP referrers вашего домена)
  GOOGLE_API_KEY: 'AIzaSyD3Sz8ybq5FGCxM05919kj1D8hLGl4YEt4',

  // Номер проекта Google Cloud (Project number, только цифры) — нужен для Picker
  GOOGLE_APP_ID: '207213151715',

  // Основной адрес сайта (для ссылок в письмах и канонических URL)
  SITE_URL: 'https://insulincalc.online',

  // Метка, по которой сайт находит «свои» таблицы в Google Drive пользователя
  APP_TAG: 'insulincalc',

  // Название новой таблицы
  SHEET_TITLE: { ru: 'InsulinCalc — дневник диабета', en: 'InsulinCalc — diabetes log' }
};
