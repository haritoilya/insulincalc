/* ============================================================================
   InsulinCalc — ядро: единицы, авторизация Google, хранилище (Google Sheets / демо),
   очередь неотправленных записей, общий интерфейс (шапка, вход, выбор таблицы).
   Никакого собственного сервера: браузер работает напрямую с Google API
   под учётной записью пользователя (scope drive.file).
   ============================================================================ */
(function () {
  'use strict';
  var CFG = window.APP_CONFIG;
  var DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
  var SCOPES = 'openid email profile ' + DRIVE_SCOPE;
  var MGDL = 18.0182;
  var XE_MIN = 9, XE_MAX = 13; // допустимый вес 1 ХЕ, г

  // Колонки листа «Events» — совпадают со структурой рабочей таблицы.
  var HEADERS = [
    'event_id', 'timestamp', 'event_type', 'event_subtype',
    'target_glucose', 'current_glucose', 'uc', 'carbs_he', 'carbs_grams',
    'compensation_dose', 'food_insulin', 'total_raw', 'dose_down', 'dose_up',
    'selected_dose', 'rounding_choice', 'predicted_down', 'predicted_up',
    'pause_minutes', 'pen_step', 'correction_factor', 'weight',
    'glucose_2h', 'glucose_2h_timestamp', 'glucose_4h', 'glucose_4h_timestamp',
    'notes', 'event_status', 'user_id'
  ];
  // Старые названия колонок → новые (для записей, сделанных до переименования)
  var LEGACY = {
    dose_rounded_down: 'dose_down', dose_rounded_up: 'dose_up',
    predicted_glucose_down: 'predicted_down', predicted_glucose_up: 'predicted_up',
    insulin_event_pause: 'pause_minutes', entered_by: 'user_id'
  };

  // ---------------------------------------------------------------- helpers
  function $(sel, root) { return (root || document).querySelector(sel); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ls(k, v) {
    try {
      if (v === undefined) { var r = localStorage.getItem(k); return r ? JSON.parse(r) : null; }
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v));
    } catch (e) { return null; }
  }
  function ss(k, v) {
    try {
      if (v === undefined) { var r = sessionStorage.getItem(k); return r ? JSON.parse(r) : null; }
      if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, JSON.stringify(v));
    } catch (e) { return null; }
  }
  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
    return isFinite(n) ? n : null;
  }
  function uid() { return 'evt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 11); }
  function loadScript(src) {
    return new Promise(function (res, rej) {
      if (document.querySelector('script[src="' + src + '"]')) {
        var s0 = document.querySelector('script[src="' + src + '"]');
        if (s0.dataset.loaded) return res(); s0.addEventListener('load', res); s0.addEventListener('error', rej); return;
      }
      var s = document.createElement('script'); s.src = src; s.async = true;
      s.onload = function () { s.dataset.loaded = '1'; res(); }; s.onerror = rej; document.head.appendChild(s);
    });
  }
  function fmtDate(d, withYear) {
    if (!(d instanceof Date)) d = new Date(d);
    if (isNaN(d)) return '—';
    var o = { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' };
    if (withYear) o.year = 'numeric';
    return d.toLocaleString(I18N.lang === 'ru' ? 'ru-RU' : undefined, o);
  }
  function fmtTime(d) { return new Date(d).toLocaleTimeString(I18N.lang === 'ru' ? 'ru-RU' : undefined, { hour: '2-digit', minute: '2-digit' }); }

  // Разбор даты события: ISO в timestamp (или старом created_at), «дд.мм.гггг, чч:мм» или серийная дата Sheets
  function parseWhen(ev) {
    var vals = [ev.timestamp, ev.created_at];
    for (var i = 0; i < vals.length; i++) {
      var c = vals[i];
      if (c == null || c === '') continue;
      if (typeof c === 'number') return new Date(Math.round((c - 25569) * 86400000));
      var s = String(c);
      var m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})[,\s]+(\d{1,2}):(\d{2})/);
      if (m) return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]);
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) { var d = new Date(s); if (!isNaN(d)) return d; }
    }
    return null;
  }

  // ---------------------------------------------------------------- settings
  var DEFAULTS = {
    glucoseUnit: 'mmol', xeGrams: 12, carbUnit: I18N.lang === 'ru' ? 'xe' : 'g',
    range: 2, dia: 4, name: '', notif: false,
    target: '', isf: '', penStep: '', uc_breakfast: '', uc_lunch: '', uc_dinner: '', uc_snack: '', weight: ''
  };
  var Settings = {
    data: Object.assign({}, DEFAULTS, ls('ic_settings') || {}),
    get: function (k) { return this.data[k]; },
    set: function (obj, persist) {
      Object.assign(this.data, obj); ls('ic_settings', this.data);
      if (persist !== false && Store.current) Store.current.saveSettings(this.data).catch(function (e) { console.warn(e); });
    },
    merge: function (obj) { Object.assign(this.data, obj || {}); ls('ic_settings', this.data); }
  };

  // ---------------------------------------------------------------- units
  var Units = {
    isMg: function () { return Settings.get('glucoseUnit') === 'mgdl'; },
    gLabel: function () { var ru = I18N.lang === 'ru'; return this.isMg() ? (ru ? 'мг/дл' : 'mg/dL') : (ru ? 'ммоль/л' : 'mmol/L'); },
    // глюкоза: хранится в ммоль/л
    toDisp: function (mmol) { if (mmol == null) return null; return this.isMg() ? Math.round(mmol * MGDL) : Math.round(mmol * 10) / 10; },
    fromDisp: function (v) { if (v == null) return null; return this.isMg() ? v / MGDL : v; },
    g: function (mmol) { var v = this.toDisp(mmol); return v == null ? '—' : (this.isMg() ? String(v) : v.toFixed(1)); },
    // ФЧИ: хранится в ммоль/л на 1 ЕД
    isfToDisp: function (v) { if (v == null) return null; return this.isMg() ? Math.round(v * MGDL) : Math.round(v * 100) / 100; },
    isfFromDisp: function (v) { if (v == null) return null; return this.isMg() ? v / MGDL : v; },
    isfLabel: function () { return this.gLabel() + '/' + t('common.units'); },
    xeG: function () { var g = num(Settings.get('xeGrams')); return g != null && g >= XE_MIN && g <= XE_MAX ? g : 12; },
    // ХЕ события с учётом настроек (граммы — первичны)
    // ХЕ события: carbs_he записан с тем весом ХЕ, который был при вводе; иначе — из граммов
    xeOf: function (ev) {
      var he = num(ev.carbs_he); if (he != null) return he;
      var g = num(ev.carbs_grams);
      return g == null ? 0 : g / this.xeG();
    }
  };

  // ---------------------------------------------------------------- auth
  function AuthError(msg) { this.name = 'AuthError'; this.message = msg || 'auth'; }
  AuthError.prototype = Object.create(Error.prototype);

  var Auth = {
    client: null,
    configured: function () { return CFG.GOOGLE_CLIENT_ID && CFG.GOOGLE_CLIENT_ID.indexOf('PASTE_') !== 0; },
    tok: function () { var t0 = ss('ic_token'); return t0 && t0.exp > Date.now() + 60000 ? t0.access : null; },
    user: function () { return ls('ic_user'); },
    init: function () {
      var self = this;
      if (!this.configured()) return Promise.resolve(false);
      return loadScript('https://accounts.google.com/gsi/client').then(function () {
        self.client = google.accounts.oauth2.initTokenClient({ client_id: CFG.GOOGLE_CLIENT_ID, scope: SCOPES, callback: function () {} });
        return true;
      });
    },
    // Должна вызываться из обработчика клика (иначе браузер заблокирует окно)
    signIn: function () {
      var self = this;
      return new Promise(function (resolve, reject) {
        if (!self.client) return reject(new Error('Google sign-in not loaded'));
        self.client.callback = function (resp) {
          if (resp.error) return reject(new Error(resp.error));
          if (!google.accounts.oauth2.hasGrantedAllScopes(resp, DRIVE_SCOPE)) return reject(new AuthError('scope'));
          ss('ic_token', { access: resp.access_token, exp: Date.now() + (resp.expires_in || 3599) * 1000 });
          fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + resp.access_token } })
            .then(function (r) { return r.json(); })
            .then(function (u) { ls('ic_user', { email: u.email, name: u.name, picture: u.picture }); ls('ic_mode', 'google'); resolve(u); })
            .catch(reject);
        };
        self.client.error_callback = function (e) { reject(new Error(e && e.type || 'popup')); };
        var u = self.user();
        self.client.requestAccessToken(u && u.email ? { prompt: '', login_hint: u.email } : { prompt: 'select_account' });
      });
    },
    signOut: function () {
      var t0 = this.tok();
      if (t0 && window.google && google.accounts) try { google.accounts.oauth2.revoke(t0, function () {}); } catch (e) {}
      ss('ic_token', null); ls('ic_user', null); ls('ic_mode', null);
    }
  };

  function api(url, opts) {
    var token = Auth.tok();
    if (!token) return Promise.reject(new AuthError('expired'));
    opts = opts || {};
    var headers = Object.assign({ Authorization: 'Bearer ' + token }, opts.body ? { 'Content-Type': 'application/json' } : {});
    return fetch(url, { method: opts.method || 'GET', headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function (r) {
        if (r.status === 401) { ss('ic_token', null); throw new AuthError('expired'); }
        if (!r.ok) return r.text().then(function (txt) { var e = new Error('HTTP ' + r.status + ': ' + txt.slice(0, 300)); e.status = r.status; throw e; });
        return r.status === 204 ? null : r.json();
      });
  }
  var SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets/';
  var DRIVE = 'https://www.googleapis.com/drive/v3/files';
  function rng(sheet, a1) { return encodeURIComponent("'" + sheet.replace(/'/g, "''") + "'!" + a1); }
  function colLetter(i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }

  // ---------------------------------------------------------------- Drive: поиск / создание / подключение
  var Drive = {
    find: function () {
      var q = "appProperties has { key='app' and value='" + CFG.APP_TAG + "' } and trashed=false and mimeType='application/vnd.google-apps.spreadsheet'";
      return api(DRIVE + '?q=' + encodeURIComponent(q) + '&orderBy=modifiedTime desc&fields=files(id,name,webViewLink,modifiedTime,ownedByMe)&supportsAllDrives=true&includeItemsFromAllDrives=true')
        .then(function (r) { return r.files || []; });
    },
    tag: function (id) {
      return api(DRIVE + '/' + id + '?supportsAllDrives=true', { method: 'PATCH', body: { appProperties: { app: CFG.APP_TAG, schema: '1' } } }).catch(function (e) { console.warn('tag', e); });
    },
    create: function () {
      var title = CFG.SHEET_TITLE[I18N.lang] || CFG.SHEET_TITLE.en;
      var u = Auth.user(); if (u && u.name) title += ' (' + u.name + ')';
      return api(SHEETS.slice(0, -1), {
        method: 'POST', body: {
          properties: { title: title, locale: I18N.lang === 'ru' ? 'ru_RU' : 'en_US' },
          sheets: [
            { properties: { sheetId: 1, title: 'Events', gridProperties: { frozenRowCount: 1 } } },
            { properties: { sheetId: 2, title: 'Settings' } }
          ]
        }
      }).then(function (ss0) {
        var id = ss0.spreadsheetId;
        return api(SHEETS + id + '/values/' + rng('Events', 'A1') + '?valueInputOption=RAW', { method: 'PUT', body: { values: [HEADERS] } })
          .then(function () {
            return api(SHEETS + id + ':batchUpdate', { method: 'POST', body: { requests: [{ repeatCell: { range: { sheetId: 1, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.91, green: 0.94, blue: 1 } } }, fields: 'userEnteredFormat(textFormat,backgroundColor)' } }] } }).catch(function () {});
          })
          .then(function () { return Drive.tag(id); })
          .then(function () { return { id: id, url: ss0.spreadsheetUrl, name: title }; });
      });
    },
    // Подключение существующей таблицы: ищем лист с колонкой event_id, иначе создаём «Events»
    connect: function (id) {
      return api(SHEETS + id + '?fields=spreadsheetId,spreadsheetUrl,properties.title,sheets.properties(sheetId,title)').then(function (meta) {
        var titles = meta.sheets.map(function (s) { return s.properties.title; });
        var q = titles.map(function (tt) { return 'ranges=' + rng(tt, '1:1'); }).join('&');
        return api(SHEETS + id + '/values:batchGet?' + q).then(function (r) {
          var found = null, header = null;
          (r.valueRanges || []).forEach(function (vr, i) {
            var h = (vr.values && vr.values[0]) || [];
            if (!found && h.indexOf('event_id') >= 0) { found = titles[i]; header = h; }
          });
          var p = Promise.resolve();
          if (!found) {
            found = titles.indexOf('Events') >= 0 ? 'InsulinCalc Events' : 'Events';
            header = HEADERS.slice();
            p = api(SHEETS + id + ':batchUpdate', { method: 'POST', body: { requests: [{ addSheet: { properties: { title: found, gridProperties: { frozenRowCount: 1 } } } }] } })
              .then(function () { return api(SHEETS + id + '/values/' + rng(found, 'A1') + '?valueInputOption=RAW', { method: 'PUT', body: { values: [HEADERS] } }); });
          } else {
            var missing = HEADERS.filter(function (h) { return header.indexOf(h) < 0; });
            if (missing.length) {
              var start = colLetter(header.length);
              header = header.concat(missing);
              p = api(SHEETS + id + '/values/' + rng(found, start + '1') + '?valueInputOption=RAW', { method: 'PUT', body: { values: [missing] } });
            }
          }
          return p.then(function () { return Drive.tag(id); })
            .then(function () { return { id: id, url: meta.spreadsheetUrl, name: meta.properties.title, sheet: found }; });
        });
      });
    },
    pick: function () {
      return Promise.all([loadScript('https://apis.google.com/js/api.js')]).then(function () {
        return new Promise(function (resolve, reject) {
          gapi.load('picker', {
            callback: function () {
              try {
                var view = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS).setIncludeFolders(true).setMode(google.picker.DocsViewMode.LIST);
                var shared = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS).setOwnedByMe(false).setMode(google.picker.DocsViewMode.LIST);
                var picker = new google.picker.PickerBuilder()
                  .addView(view).addView(shared)
                  .setOAuthToken(Auth.tok()).setDeveloperKey(CFG.GOOGLE_API_KEY).setAppId(CFG.GOOGLE_APP_ID)
                  .setLocale(I18N.lang).setTitle(t('setup.connect'))
                  .setCallback(function (data) {
                    if (data.action === google.picker.Action.PICKED) resolve(data.docs[0].id);
                    else if (data.action === google.picker.Action.CANCEL) resolve(null);
                  }).build();
                picker.setVisible(true);
              } catch (e) { reject(e); }
            }, onerror: reject
          });
        });
      });
    }
  };

  // ---------------------------------------------------------------- хранилище: Google Sheets
  function rowToEvent(header, row, idx) {
    var ev = { _row: idx };
    header.forEach(function (h, i) { if (h) ev[h] = row[i] === '' ? null : row[i]; });
    Object.keys(LEGACY).forEach(function (k) { if (ev[k] != null && ev[LEGACY[k]] == null) ev[LEGACY[k]] = ev[k]; });
    return ev;
  }
  function eventToRow(header, ev) { return header.map(function (h) { var v = ev[h]; return v === undefined || v === null ? '' : v; }); }

  function SheetStore(info) {
    this.mode = 'google'; this.id = info.id; this.url = info.url || ('https://docs.google.com/spreadsheets/d/' + info.id + '/edit');
    this.name = info.name || ''; this.sheet = info.sheet || 'Events'; this.header = null; this.events = null;
  }
  SheetStore.prototype.load = function () {
    var self = this;
    return api(SHEETS + this.id + '?fields=properties.title,sheets.properties.title').then(function (meta) {
      self.name = meta.properties.title;
      var titles = meta.sheets.map(function (s) { return s.properties.title; });
      if (titles.indexOf(self.sheet) < 0) {
        // таблица могла быть переименована — ищем лист с event_id
        return Drive.connect(self.id).then(function (c) { self.sheet = c.sheet; });
      }
    }).then(function () { return self.getSettings(); }).then(function (s) { Settings.merge(s); return self.listEvents(true); });
  };
  SheetStore.prototype.listEvents = function (force) {
    var self = this;
    if (this.events && !force) return Promise.resolve(Outbox.merge(this.events));
    return api(SHEETS + this.id + '/values/' + rng(this.sheet, 'A1:AZ') + '?valueRenderOption=UNFORMATTED_VALUE').then(function (r) {
      var v = r.values || [];
      self.header = v[0] || HEADERS.slice();
      self.events = v.slice(1).map(function (row, i) { return rowToEvent(self.header, row, i + 2); }).filter(function (e) { return e.event_id || e.timestamp || e.created_at; });
      return Outbox.merge(self.events);
    });
  };
  SheetStore.prototype.append = function (ev) {
    var self = this;
    var go = this.header ? Promise.resolve() : this.listEvents(true);
    return go.then(function () {
      return api(SHEETS + self.id + '/values/' + rng(self.sheet, 'A1') + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', { method: 'POST', body: { values: [eventToRow(self.header, ev)] } });
    }).then(function (r) {
      var m = r && r.updates && r.updates.updatedRange && r.updates.updatedRange.match(/!(?:[A-Z]+)(\d+)/);
      var copy = Object.assign({}, ev, { _row: m ? +m[1] : null });
      if (self.events) self.events.push(copy);
      return copy;
    });
  };
  SheetStore.prototype.update = function (eventId, patch) {
    var self = this;
    var ev = (this.events || []).filter(function (e) { return e.event_id === eventId; })[0];
    var go = ev && ev._row ? Promise.resolve(ev) : this.listEvents(true).then(function () {
      return (self.events || []).filter(function (e) { return e.event_id === eventId; })[0];
    });
    return go.then(function (e) {
      if (!e || !e._row) throw new Error('event not found: ' + eventId);
      var data = Object.keys(patch).filter(function (k) { return self.header.indexOf(k) >= 0; }).map(function (k) {
        return { range: "'" + self.sheet.replace(/'/g, "''") + "'!" + colLetter(self.header.indexOf(k)) + e._row, values: [[patch[k] == null ? '' : patch[k]]] };
      });
      return api(SHEETS + self.id + '/values:batchUpdate', { method: 'POST', body: { valueInputOption: 'RAW', data: data } })
        .then(function () { Object.assign(e, patch); return e; });
    });
  };
  SheetStore.prototype.getSettings = function () {
    return api(SHEETS + this.id + '/values/' + rng('Settings', 'A1:B60') + '?valueRenderOption=UNFORMATTED_VALUE').then(function (r) {
      var o = {}; (r.values || []).forEach(function (row) { if (row[0]) o[row[0]] = row[1]; }); return o;
    }).catch(function () { return {}; });
  };
  SheetStore.prototype.saveSettings = function (obj) {
    var self = this;
    var rows = Object.keys(obj).map(function (k) { return [k, obj[k] == null ? '' : obj[k]]; });
    var put = function () { return api(SHEETS + self.id + '/values/' + rng('Settings', 'A1') + '?valueInputOption=RAW', { method: 'PUT', body: { values: rows } }); };
    return put().catch(function (e) {
      if (e.status !== 400) throw e;
      return api(SHEETS + self.id + ':batchUpdate', { method: 'POST', body: { requests: [{ addSheet: { properties: { title: 'Settings' } } }] } }).then(put);
    });
  };

  // ---------------------------------------------------------------- хранилище: демо (localStorage)
  function DemoStore() { this.mode = 'demo'; this.url = null; this.name = 'Demo'; }
  DemoStore.prototype.load = function () { Settings.merge(ls('ic_demo_settings') || {}); return this.listEvents(); };
  DemoStore.prototype.listEvents = function () { return Promise.resolve((ls('ic_demo_events') || []).slice()); };
  DemoStore.prototype.append = function (ev) { var a = ls('ic_demo_events') || []; a.push(ev); ls('ic_demo_events', a); return Promise.resolve(ev); };
  DemoStore.prototype.update = function (id, patch) {
    var a = ls('ic_demo_events') || []; var e = a.filter(function (x) { return x.event_id === id; })[0];
    if (e) Object.assign(e, patch); ls('ic_demo_events', a); return Promise.resolve(e);
  };
  DemoStore.prototype.saveSettings = function (o) { ls('ic_demo_settings', o); return Promise.resolve(); };

  // ---------------------------------------------------------------- очередь: если нет сети или истёк вход — запись не теряется
  var Outbox = {
    items: function () { return ls('ic_outbox') || []; },
    push: function (op) { var a = this.items(); a.push(op); ls('ic_outbox', a); Shell.outboxBadge(); },
    merge: function (events) {
      var a = this.items(); if (!a.length) return events.slice();
      var out = events.map(function (e) { return Object.assign({}, e); });
      a.forEach(function (op) {
        if (op.op === 'append' && !out.some(function (e) { return e.event_id === op.ev.event_id; })) out.push(Object.assign({ _pending: true }, op.ev));
        if (op.op === 'update') out.forEach(function (e) { if (e.event_id === op.id) Object.assign(e, op.patch); });
      });
      return out;
    },
    flush: function () {
      var a = this.items(); if (!a.length || !Store.current) return Promise.resolve(0);
      var self = this, done = 0;
      return a.reduce(function (p, op) {
        return p.then(function () {
          var f = op.op === 'append' ? Store.current.append(op.ev) : Store.current.update(op.id, op.patch);
          return f.then(function () { done++; });
        });
      }, Promise.resolve()).then(function () { ls('ic_outbox', []); Shell.outboxBadge(); return done; })
        .catch(function (e) { ls('ic_outbox', a.slice(done)); Shell.outboxBadge(); throw e; });
    }
  };

  var Store = {
    current: null,
    events: function (force) { return Store.current.listEvents(force); },
    append: function (ev) {
      ev.user_id = ev.user_id || ((Auth.user() || {}).email || '');
      return Store.current.append(ev).catch(function (e) {
        Outbox.push({ op: 'append', ev: ev }); Shell.handleError(e, true); return ev;
      });
    },
    update: function (id, patch) {
      return Store.current.update(id, patch).catch(function (e) {
        Outbox.push({ op: 'update', id: id, patch: patch }); Shell.handleError(e, true); return null;
      });
    },
    uid: uid
  };

  // ---------------------------------------------------------------- UI-оболочка
  var Shell = {
    page: null, onReady: null,
    toast: function (msg, kind) {
      var el = document.createElement('div'); el.className = 'toast ' + (kind || ''); el.innerHTML = msg;
      document.body.appendChild(el); setTimeout(function () { el.classList.add('show'); }, 10);
      setTimeout(function () { el.classList.remove('show'); setTimeout(function () { el.remove(); }, 300); }, kind === 'error' ? 6000 : 3000);
    },
    busy: function (on, text) {
      var b = $('#busy'); if (!b) return;
      b.style.display = on ? 'flex' : 'none'; if (text) $('#busy-text').textContent = text;
    },
    modal: function (html, opts) {
      opts = opts || {};
      Shell.closeModal();
      var wrap = document.createElement('div'); wrap.className = 'modal-wrap'; wrap.id = 'modal';
      wrap.innerHTML = '<div class="modal" role="dialog" aria-modal="true">' + (opts.closable === false ? '' : '<button class="modal-x" aria-label="close">×</button>') + html + '</div>';
      document.body.appendChild(wrap);
      if (opts.closable !== false) {
        wrap.querySelector('.modal-x').onclick = Shell.closeModal;
        wrap.addEventListener('click', function (e) { if (e.target === wrap) Shell.closeModal(); });
      }
      return wrap;
    },
    closeModal: function () { var m = $('#modal'); if (m) m.remove(); },
    handleError: function (e, queued) {
      console.error(e);
      if (e instanceof AuthError || e.name === 'AuthError') {
        Shell.toast((queued ? '💾 ' + (I18N.lang === 'ru' ? 'Запись сохранена в браузере и будет отправлена после входа. ' : 'Saved in this browser; it will be sent after you sign in. ') : '') +
          '<button class="link-btn" onclick="Shell.relogin()">' + t('gate.signin') + '</button>', 'error');
      } else if (queued) {
        Shell.toast('💾 ' + (I18N.lang === 'ru' ? 'Нет связи с Google. Запись сохранена в браузере и будет отправлена позже.' : 'No connection to Google. Saved in this browser, will be sent later.'), 'error');
      } else {
        Shell.toast('⚠️ ' + t('common.error') + ': ' + esc(e.message || e), 'error');
      }
    },
    relogin: function () {
      Auth.signIn().then(function () { return Outbox.flush(); }).then(function (n) {
        Shell.renderHeader(); if (n) Shell.toast('✅ ' + t('common.saved') + ' (' + n + ')');
        if (Shell.onReady) Shell.onReady(true);
      }).catch(function (e) { Shell.handleError(e); });
    },
    outboxBadge: function () {
      var n = Outbox.items().length, b = $('#outbox-badge');
      if (!b) return; b.style.display = n ? 'inline-flex' : 'none'; b.textContent = '⏳ ' + n;
      b.title = I18N.lang === 'ru' ? 'Не отправлено в таблицу. Нажмите, чтобы отправить.' : 'Not yet sent to the sheet. Click to send.';
    },

    renderHeader: function () {
      var h = $('#topbar'); if (!h) return;
      var u = Auth.user(), mode = ls('ic_mode');
      var p = Shell.page;
      var userHtml = '';
      if (mode === 'google' && u) {
        userHtml = '<div class="user-menu"><button class="avatar-btn" id="user-btn" aria-haspopup="true">' +
          (u.picture ? '<img src="' + esc(u.picture) + '" alt="" referrerpolicy="no-referrer">' : '<span>' + esc((u.name || u.email || '?')[0]) + '</span>') + '</button>' +
          '<div class="dropdown" id="user-dd"><div class="dd-head"><b>' + esc(u.name || '') + '</b><br><small>' + esc(u.email || '') + '</small></div>' +
          (Store.current && Store.current.url ? '<a href="' + esc(Store.current.url) + '" target="_blank" rel="noopener">📄 ' + t('nav.sheet') + '</a>' : '') +
          '<button onclick="Shell.setupSheet(true)">🔁 ' + t('nav.switchSheet') + '</button>' +
          '<button onclick="Shell.openSettings()">⚙️ ' + t('nav.settings') + '</button>' +
          '<button onclick="Shell.signOut()">🚪 ' + t('nav.signout') + '</button></div></div>';
      } else if (mode === 'demo') {
        userHtml = '<button class="btn-sm" onclick="Shell.openSettings()" title="' + t('nav.settings') + '">⚙️</button>';
      }
      var guide = I18N.lang === 'ru' ? '/kak-rasschitat-dozu-insulina/' : '/en/insulin-dose-guide/';
      h.innerHTML = '<div class="topbar-in"><a class="brand" href="' + (I18N.lang === 'ru' ? '/' : '/en/') + '"><img src="/assets/img/favicon.svg" alt="" width="28" height="28"><span>InsulinCalc</span></a>' +
        '<nav class="nav"><a href="/app/"' + (p === 'app' ? ' class="active"' : '') + '>' + t('nav.calc') + '</a>' +
        '<a href="/report/"' + (p === 'report' ? ' class="active"' : '') + '>' + t('nav.report') + '</a>' +
        '<a href="' + guide + '" class="hide-sm">' + t('nav.guide') + '</a></nav>' +
        '<div class="right"><button id="outbox-badge" class="badge" style="display:none" onclick="Shell.relogin()"></button>' +
        '<button class="lang-btn" onclick="Shell.toggleLang()" aria-label="language">' + (I18N.lang === 'ru' ? 'EN' : 'RU') + '</button>' + userHtml + '</div></div>';
      var ub = $('#user-btn');
      if (ub) {
        ub.onclick = function (e) { e.stopPropagation(); $('#user-dd').classList.toggle('open'); };
        document.addEventListener('click', function () { var d = $('#user-dd'); if (d) d.classList.remove('open'); });
      }
      var demoBar = $('#demo-bar');
      if (demoBar) {
        demoBar.style.display = mode === 'demo' ? 'block' : 'none';
        demoBar.innerHTML = '🧪 ' + t('demo.banner') + (Auth.configured() ? ' <button class="link-btn" onclick="Shell.startGoogle()">' + t('demo.signin') + '</button>' : '');
      }
      Shell.outboxBadge();
    },
    toggleLang: function () { I18N.set(I18N.lang === 'ru' ? 'en' : 'ru'); location.reload(); },
    signOut: function () { Auth.signOut(); Store.current = null; location.reload(); },

    gate: function (msg) {
      $('#app').style.display = 'none';
      var g = $('#gate'); g.style.display = 'block';
      g.innerHTML = '<div class="card gate"><div class="gate-icon">📒</div><h1>' + t('gate.title') + '</h1><p>' + t('gate.text') + '</p>' +
        (msg ? '<div class="note warn">' + msg + '</div>' : '') +
        (Auth.configured() ? '<button class="g-btn" id="g-signin"><svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>' + t('gate.signin') + '</button>'
          : '<div class="note">' + t('gate.notConfigured') + '</div>') +
        '<button class="btn ghost" id="g-demo">' + t('gate.demo') + '</button>' +
        '<p class="small muted">🔒 ' + t('gate.privacy') + ' <a href="/privacy/">Privacy</a></p></div>';
      var b = $('#g-signin'); if (b) b.onclick = Shell.startGoogle;
      $('#g-demo').onclick = function () { ls('ic_mode', 'demo'); Shell.boot(Shell.page, Shell.onReady); };
    },
    startGoogle: function () {
      Auth.signIn().then(function () { Shell.renderHeader(); return Shell.setupSheet(false); })
        .catch(function (e) {
          if (e.name === 'AuthError') Shell.gate(t('gate.scopeDenied'));
          else Shell.handleError(e);
        });
    },

    sheetKey: function () { var u = Auth.user(); return 'ic_sheet_' + (u ? u.email : 'x'); },

    // Шаг 2 ТЗ: найти таблицу → предложить продолжить / создать / подключить
    setupSheet: function (forceChoice) {
      Shell.modal('<h2>' + t('setup.title') + '</h2><p class="muted">' + t('setup.searching') + '</p><div class="spinner"></div>', { closable: false });
      return Drive.find().then(function (files) {
        var html = '<h2>📒 ' + t('setup.title') + '</h2>';
        if (files.length === 1) {
          html += '<p>' + t('setup.found') + '</p><a class="sheet-card" href="' + esc(files[0].webViewLink) + '" target="_blank" rel="noopener">📄 ' + esc(files[0].name) + '<small>' + fmtDate(files[0].modifiedTime, true) + '</small></a>' +
            '<button class="btn primary block" data-use="' + esc(files[0].id) + '">' + t('setup.use') + '</button>';
        } else if (files.length > 1) {
          html += '<p>' + t('setup.foundMany') + '</p>' + files.map(function (f) {
            return '<div class="sheet-row"><a class="sheet-card" href="' + esc(f.webViewLink) + '" target="_blank" rel="noopener">📄 ' + esc(f.name) + '<small>' + fmtDate(f.modifiedTime, true) + (f.ownedByMe === false ? ' · shared' : '') + '</small></a><button class="btn primary" data-use="' + esc(f.id) + '">✓</button></div>';
          }).join('');
        } else {
          html += '<p><b>' + t('setup.question') + '</b></p><p class="muted">' + t('setup.none') + '</p>';
        }
        html += '<div class="divider"></div><button class="btn secondary block" id="s-create">' + t('setup.create') + '</button>' +
          '<button class="btn secondary block" id="s-connect">' + t('setup.connect') + '</button><p class="small muted">' + t('setup.connectHint') + '</p>';
        var m = Shell.modal(html, { closable: !!forceChoice && !!Store.current });
        m.querySelectorAll('[data-use]').forEach(function (b) {
          b.onclick = function () { var f = files.filter(function (x) { return x.id === b.dataset.use; })[0]; Shell.useSheet({ id: f.id, url: f.webViewLink, name: f.name }); };
        });
        $('#s-create').onclick = function () {
          Shell.modal('<h2>' + t('setup.create') + '</h2><div class="spinner"></div>', { closable: false });
          Drive.create().then(function (info) { Shell.useSheet(info, 'created'); }).catch(function (e) { Shell.closeModal(); Shell.handleError(e); Shell.setupSheet(true); });
        };
        $('#s-connect').onclick = function () {
          Drive.pick().then(function (id) {
            if (!id) return;
            Shell.modal('<h2>' + t('setup.connect') + '</h2><div class="spinner"></div>', { closable: false });
            return Drive.connect(id).then(function (info) { Shell.useSheet(info, 'connected'); });
          }).catch(function (e) { Shell.handleError(new Error(t('setup.pickerFail') + ' ' + (e.message || ''))); Shell.setupSheet(true); });
        };
      }).catch(function (e) {
        Shell.closeModal();
        if (e.name === 'AuthError') Shell.gate(); else Shell.handleError(e);
      });
    },
    useSheet: function (info, how) {
      ls(Shell.sheetKey(), { id: info.id, url: info.url, name: info.name, sheet: info.sheet });
      ls('ic_mode', 'google');
      if (how) Shell.showLink(info, how);
      else Shell.closeModal();
      Shell.boot(Shell.page, Shell.onReady, true);
    },
    // Всплывающее окно со ссылкой + отправка себе на почту
    showLink: function (info, how) {
      var u = Auth.user() || {};
      var url = info.url;
      var body = t('setup.mailBody', { url: url, site: CFG.SITE_URL + '/app/' });
      var gmail = 'https://mail.google.com/mail/?view=cm&fs=1&to=' + encodeURIComponent(u.email || '') + '&su=' + encodeURIComponent(t('setup.mailSubject')) + '&body=' + encodeURIComponent(body);
      var m = Shell.modal('<h2>' + t(how === 'created' ? 'setup.created' : 'setup.connected') + '</h2><p>' + t('setup.linkText') + '</p>' +
        '<div class="link-box"><input readonly value="' + esc(url) + '" id="sheet-link"><button class="btn secondary" id="copy-link">' + t('btn.copy') + '</button></div>' +
        '<a class="btn primary block" href="' + esc(url) + '" target="_blank" rel="noopener">📄 ' + t('btn.open') + '</a>' +
        '<a class="btn secondary block" href="' + esc(gmail) + '" target="_blank" rel="noopener">' + t('setup.email') + '</a>' +
        '<div class="note">👨‍👩‍👧 ' + t('setup.shareHint') + '</div><button class="btn ghost block" onclick="Shell.closeModal()">' + t('btn.close') + '</button>');
      m.querySelector('#copy-link').onclick = function () {
        var i = m.querySelector('#sheet-link'); i.select();
        (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.resolve(document.execCommand('copy'))).then(function () { m.querySelector('#copy-link').textContent = t('btn.copied'); });
      };
    },

    openSettings: function () {
      var s = Settings.data;
      var m = Shell.modal('<h2>⚙️ ' + t('settings.title') + '</h2><form id="set-form" class="form">' +
        '<label>' + t('settings.lang') + '<select name="lang"><option value="ru">Русский</option><option value="en">English</option></select></label>' +
        '<label>' + t('settings.glucoseUnit') + '<select name="glucoseUnit"><option value="mmol">mmol/L (ммоль/л)</option><option value="mgdl">mg/dL (мг/дл)</option></select></label>' +
        '<label>' + t('settings.carbUnit') + '<select name="carbUnit"><option value="xe">' + t('common.xe') + '</option><option value="g">' + (I18N.lang === 'ru' ? 'граммы' : 'grams') + '</option></select></label>' +
        '<label>' + t('settings.xeGrams') + '<input name="xeGrams" type="number" step="0.5" min="' + XE_MIN + '" max="' + XE_MAX + '"></label>' +
        '<label>' + t('settings.range') + '<input name="range" type="number" step="0.1" min="0.5" max="5"></label>' +
        '<label>' + t('settings.dia') + '<input name="dia" type="number" step="0.5" min="2" max="8"></label>' +
        '<label>' + t('settings.name') + '<input name="name" type="text" maxlength="40"></label>' +
        '<label class="check"><input name="notif" type="checkbox"> ' + t('settings.notifOn') + '</label>' +
        '<button class="btn primary block" type="submit">' + t('btn.save') + '</button></form>');
      var f = m.querySelector('#set-form');
      f.lang.value = I18N.lang; f.glucoseUnit.value = s.glucoseUnit; f.carbUnit.value = s.carbUnit; f.xeGrams.value = Units.xeG();
      f.range.value = s.range; f.dia.value = s.dia; f.name.value = s.name || ''; f.notif.checked = !!s.notif;
      f.onsubmit = function (e) {
        e.preventDefault();
        var o = { glucoseUnit: f.glucoseUnit.value, carbUnit: f.carbUnit.value, xeGrams: Math.min(XE_MAX, Math.max(XE_MIN, num(f.xeGrams.value) || 12)), range: num(f.range.value) || 2, dia: num(f.dia.value) || 4, name: f.name.value.trim(), notif: f.notif.checked };
        if (o.notif && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
        Settings.set(o);
        var langChanged = f.lang.value !== I18N.lang;
        if (langChanged) I18N.set(f.lang.value);
        Shell.closeModal(); setTimeout(function () { location.reload(); }, 400);
      };
    },

    boot: function (page, onReady, skipAuthCheck) {
      Shell.page = page; Shell.onReady = onReady;
      I18N.apply();
      if (!$('#busy')) {
        var b = document.createElement('div'); b.id = 'busy'; b.className = 'busy';
        b.innerHTML = '<div class="spinner"></div><span id="busy-text"></span>'; document.body.appendChild(b);
      }
      var mode = ls('ic_mode');
      var initP = Auth.client ? Promise.resolve() : Auth.init().catch(function (e) { console.warn('GIS load failed', e); });
      return initP.then(function () {
        Shell.renderHeader();
        if (mode === 'demo') { Store.current = new DemoStore(); return Shell.start(); }
        if (mode === 'google' && Auth.tok()) {
          var info = ls(Shell.sheetKey());
          if (!info) return Shell.setupSheet(false);
          Store.current = new SheetStore(info);
          return Shell.start();
        }
        Shell.gate(mode === 'google' && Auth.user() ? (I18N.lang === 'ru' ? 'Сессия истекла — войдите снова (1 клик).' : 'Session expired — sign in again (1 click).') : null);
      });
    },
    start: function () {
      $('#gate').style.display = 'none';
      Shell.busy(true, t('common.loading'));
      return Store.current.load().then(function () {
        Shell.busy(false); Shell.renderHeader();
        $('#app').style.display = 'block';
        if (Outbox.items().length) Outbox.flush().then(function (n) { if (n) Shell.toast('✅ ' + t('common.saved') + ' (' + n + ')'); }).catch(function () {});
        if (Shell.onReady) Shell.onReady();
      }).catch(function (e) {
        Shell.busy(false);
        if (e.name === 'AuthError') return Shell.gate();
        if (e.status === 404 || e.status === 403) { ls(Shell.sheetKey(), null); return Shell.setupSheet(false); }
        Shell.handleError(e);
      });
    }
  };

  window.IC = { $: $, esc: esc, num: num, ls: ls, fmtDate: fmtDate, fmtTime: fmtTime, parseWhen: parseWhen, HEADERS: HEADERS, MGDL: MGDL, XE_MIN: XE_MIN, XE_MAX: XE_MAX };
  window.Settings = Settings; window.Units = Units; window.Auth = Auth; window.Store = Store; window.Shell = Shell; window.Outbox = Outbox;
})();
