/* InsulinCalc — пошаговый калькулятор дозы (логика перенесена из виджета v2.3)
   + запоминание коэффициентов, активный инсулин, авто-привязка замеров, напоминания. */
(function () {
  'use strict';
  var $ = IC.$, esc = IC.esc, num = IC.num, ls = IC.ls;
  var H = 3600000;
  var S = {}, stack = [], events = [];

  function view(html) { var v = $('#view'); v.innerHTML = '<div class="step">' + html + '</div>'; $('#reminders').style.display = 'none'; window.scrollTo({ top: 0, behavior: 'smooth' }); return v; }
  var stampRU = IC.stamp;
  function r2(v) { return v == null ? null : Math.round(v * 100) / 100; }
  function mealLabel(m) { return t('meal.' + m); }
  var KIND_LABEL = { breakfast: 'meal.breakfast', lunch: 'meal.lunch', dinner: 'meal.dinner', corr: 'meal.correction', corrFood: 'meal.correction', snack: 'meal.snack', basal: 'meal.basal', glucose: 'meal.glucose', other: 'meal.correction' };

  function go(name) { stack.push(name); STEPS[name](); }
  function back() { stack.pop(); var p = stack[stack.length - 1]; if (!p) return menu(); STEPS[p](); }
  window.calcBack = back;

  function backBtn() { return '<button class="btn cancel" onclick="calcBack()">' + t('btn.back') + '</button>'; }

  // ---------------------------------------------------------------- универсальный шаг с числом
  function numStep(o) {
    var v = view('<p class="step-q">' + o.q + '</p>' + (o.hint ? '<p class="step-hint">' + o.hint + '</p>' : '') + (o.extra || '') +
      '<div class="input-wrap"><input class="num-input" id="num" type="text" inputmode="decimal" autocomplete="off">' +
      (o.unit ? '<span class="input-unit">' + o.unit + '</span>' : '') + '</div><div class="err" id="err"></div>' +
      '<div class="row">' + backBtn() + (o.skip ? '<button class="btn secondary" id="skip">' + t('btn.skip') + '</button>' : '') + '<button class="btn primary" id="ok">' + t('btn.next') + '</button></div>');
    var inp = $('#num');
    if (o.prefill != null && o.prefill !== '') inp.value = IC.dec(o.prefill);
    setTimeout(function () { inp.focus(); inp.select(); }, 80);
    function ok() {
      var x = num(inp.value), min = typeof o.min === 'function' ? o.min() : o.min, max = typeof o.max === 'function' ? o.max() : o.max;
      if (x == null || x < min || x > max) { $('#err').textContent = t('err.range', { min: min, max: max }); inp.focus(); return; }
      o.ok(x);
    }
    $('#ok').onclick = ok;
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') ok(); });
    if (o.skip) $('#skip').onclick = o.skip;
    if (o.after) o.after(v);
  }

  function gRange(lo, hi) { return Units.isMg() ? [Math.round(lo * IC.MGDL), Math.round(hi * IC.MGDL)] : [lo, hi]; }

  // ---------------------------------------------------------------- шаги
  var STEPS = {
    menu: menu,
    meal: function () {
      view(tzLine() + '<p class="step-q">' + t('step.meal') + '</p><div class="grid2">' +
        ['breakfast', 'lunch', 'dinner', 'correction', 'snack', 'basal'].map(function (m) {
          return '<button class="btn secondary" data-m="' + m + '">' + mealLabel(m) + '</button>';
        }).join('') + '</div>' + backBtn());
      document.querySelectorAll('[data-m]').forEach(function (b) {
        b.onclick = function () {
          var m = b.dataset.m; S = { meal: m };
          if (m === 'correction') go('inj');
          else if (m === 'basal') go('weight');
          else if (m === 'snack') go('snackCarbs');
          else go('uc');
        };
      });
    },
    inj: function () {
      view('<p class="step-q">' + t('step.injType') + '</p><div class="grid1">' +
        '<button class="btn secondary" id="nf">' + t('inj.noFood') + '</button><button class="btn secondary" id="wf">' + t('inj.withFood') + '</button></div>' + backBtn());
      $('#nf').onclick = function () { S.inj = 'no_food'; S.uc = 0; S.carbsG = 0; S.carbsHe = 0; go('target'); };
      $('#wf').onclick = function () { S.inj = 'with_food'; go('uc'); };
    },
    weight: function () {
      numStep({ q: t('step.weight'), hint: t('step.weightHint'), unit: t('common.kg'), min: 2, max: 200, prefill: Settings.get('weight'),
        ok: function (x) { S.weight = x; Settings.set({ weight: x }); go('basalDose'); },
        skip: function () { S.weight = null; go('basalDose'); } });
    },
    basalDose: function () {
      numStep({ q: t('step.basalDose'), unit: t('common.units'), min: 0.1, max: 100, prefill: Settings.get('basalDose'),
        ok: function (x) { S.basalDose = x; Settings.set({ basalDose: x }); saveBasal(); } });
    },
    snackCarbs: function () { carbsStep(function () { saveSnack(); }); },
    uc: function () {
      var key = S.meal === 'correction' ? 'uc_snack' : 'uc_' + S.meal;
      numStep({ q: t('step.uc', { meal: S.meal === 'correction' ? mealLabel('snack').replace('🍪 ', '') : mealLabel(S.meal) }), hint: Settings.get(key) ? t('step.ucHint') : '',
        unit: t('common.units') + '/' + t('common.xe'), min: 0.05, max: 50, prefill: Settings.get(key),
        ok: function (x) { S.uc = x; var o = {}; o[key] = x; Settings.set(o, false); go('target'); } });
    },
    target: function () {
      var rg = gRange(4, 12), p = num(Settings.get('target'));
      numStep({ q: t('step.target', { unit: Units.gLabel() }), unit: Units.gLabel(), min: rg[0], max: rg[1], step: Units.isMg() ? 1 : 0.1,
        prefill: p != null ? Units.toDisp(p) : '',
        ok: function (x) { S.target = Units.fromDisp(x); Settings.set({ target: r2(S.target) }, false); go(S.inj === 'no_food' ? 'pen' : 'carbs'); } });
    },
    carbs: function () { carbsStep(function () { go('pen'); }); },
    pen: function () {
      var cur = num(Settings.get('penStep'));
      view('<p class="step-q">' + t('step.pen') + '</p><div class="grid3">' + [0.1, 0.5, 1].map(function (s) {
        return '<button class="btn secondary' + (cur === s ? ' sel' : '') + '" data-s="' + s + '">' + String(s).replace('.', I18N.lang === 'ru' ? ',' : '.') + ' ' + t('common.units') + '</button>';
      }).join('') + '</div>' + backBtn());
      document.querySelectorAll('[data-s]').forEach(function (b) { b.onclick = function () { S.penStep = +b.dataset.s; Settings.set({ penStep: S.penStep }, false); go('isf'); }; });
    },
    isf: function () {
      var p = num(Settings.get('isf')), mg = Units.isMg();
      numStep({ q: t('step.isf', { unit: Units.gLabel() }), unit: Units.isfLabel(), min: mg ? 2 : 0.1, max: mg ? 540 : 30, step: mg ? 1 : 0.1,
        prefill: p != null ? Units.isfToDisp(p) : '',
        ok: function (x) { S.isf = Units.isfFromDisp(x); Settings.set({ isf: r2(S.isf) }, false); go('current'); } });
    },
    current: function () {
      var rg = gRange(1.5, 35), io = Stats.iob(events, new Date(), num(Settings.get('dia')) || 2.5);
      numStep({ q: t('step.current', { unit: Units.gLabel() }), unit: Units.gLabel(), min: rg[0], max: rg[1], step: Units.isMg() ? 1 : 0.1,
        extra: io.iob > 0 ? '<div class="note warn">💉 ' + t('iob.warn', { iob: io.iob, dose: num(io.last.selected_dose), time: IC.fmtTime(IC.parseWhen(io.last)) }) + '</div>' : '',
        ok: function (x) { S.current = Units.fromDisp(x); go('summary'); } });
    },
    summary: function () {
      var L = [];
      L.push('<b>' + t('sum.meal') + ':</b> ' + mealLabel(S.meal));
      if (S.meal === 'correction') L.push('<b>' + t('sum.type') + ':</b> ' + (S.inj === 'with_food' ? t('inj.withFood') : t('inj.noFood')));
      if (S.carbsG > 0) {
        L.push('<b>' + t('sum.uc') + ':</b> ' + S.uc + ' ' + t('common.units') + '/' + t('common.xe'));
        L.push('<b>' + t('sum.carbs') + ':</b> ' + S.carbsHe.toFixed(1) + ' ' + t('common.xe') + ' (' + Math.round(S.carbsG) + ' ' + t('common.g') + ', 1 ' + t('common.xe') + ' = ' + S.xeG + ' ' + t('common.g') + ')');
      }
      L.push('<b>' + t('sum.target') + ':</b> ' + Units.g(S.target) + ' ' + Units.gLabel());
      L.push('<b>' + t('sum.pen') + ':</b> ' + S.penStep + ' ' + t('common.units'));
      L.push('<b>' + t('sum.isf') + ':</b> ' + Units.isfToDisp(S.isf) + ' ' + Units.isfLabel());
      L.push('<b>' + t('sum.current') + ':</b> ' + Units.g(S.current) + ' ' + Units.gLabel());
      view('<div class="summary"><h3>' + t('sum.title') + '</h3>' + L.join('<br>') + '</div><div class="row">' + backBtn() + '<button class="btn primary" id="ok">' + t('btn.confirm') + '</button></div>');
      $('#ok').onclick = function () { compute(); go('result'); };
    },
    result: function () {
      var c = S.calc, u = t('common.units');
      var html = '<div class="result-box"><b>' + t('res.title') + '</b> — ' + mealLabel(S.meal) + '<br>' +
        '🩸 ' + Units.g(S.current) + ' → 🎯 ' + Units.g(S.target) + ' ' + Units.gLabel() + '<br><br><b>' + t('res.details') + ':</b><br>';
      if (S.carbsG > 0) html += '• ' + S.carbsHe.toFixed(1) + ' ' + t('common.xe') + ' (' + Math.round(S.carbsG) + ' ' + t('common.g') + ') × ' + S.uc + ' → ' + t('res.food') + ': ' + c.food.toFixed(2) + ' ' + u + '<br>';
      html += '• ' + t('res.corr') + ': ' + c.comp.toFixed(2) + ' ' + u + '<br>• ' + t('res.total') + ': <b>' + c.total.toFixed(2) + ' ' + u + '</b> (' + t('sum.pen').toLowerCase() + ' ' + S.penStep + ')' +
        '<div class="dose-cards"><div class="dose-card down"><div class="small">' + t('res.down') + '</div><div class="d">' + c.down.toFixed(1) + ' ' + u + '</div><div class="small muted">' + t('res.forecast') + ': ' + Units.g(c.predDown) + '</div></div>' +
        '<div class="dose-card up"><div class="small">' + t('res.up') + '</div><div class="d">' + c.up.toFixed(1) + ' ' + u + '</div><div class="small muted">' + t('res.forecast') + ': ' + Units.g(c.predUp) + '</div></div></div></div>';
      if (S.current < 3.9) html = '<div class="note danger">' + t('res.hypo') + '</div>' + html;
      else if (S.current < S.target) html += '<div class="note warn">' + t('res.belowTarget') + '</div>';
      html += '<p class="step-q">' + t('res.choose') + '</p><div class="grid1"><button class="btn secondary" id="cd">' + t('res.chooseDown') + ' — ' + c.down.toFixed(1) + ' ' + u + '</button>' +
        '<button class="btn secondary" id="cu">' + t('res.chooseUp') + ' — ' + c.up.toFixed(1) + ' ' + u + '</button><button class="btn secondary" id="cn">' + t('res.chooseNone') + '</button></div>' + backBtn();
      view(html);
      $('#cd').onclick = function () { choose('down'); };
      $('#cu').onclick = function () { choose('up'); };
      $('#cn').onclick = function () { done('<b>' + t('done.notApplied') + '</b>'); };
    },
    pause: function () {
      numStep({ q: t('step.pause'), unit: t('common.min'), min: 0, max: 60, step: 1, prefill: Settings.get('pause') != null ? Settings.get('pause') : 0,
        ok: function (x) { S.pause = Math.round(x); Settings.set({ pause: S.pause }); saveCalc(); } });
    },
    glucose: function () {
      var rg = gRange(1, 35);
      numStep({ q: t('step.glucoseValue', { unit: Units.gLabel() }), hint: t('step.glucoseHint'), unit: Units.gLabel(), min: rg[0], max: rg[1], step: Units.isMg() ? 1 : 0.1,
        ok: function (x) { saveGlucose(Units.fromDisp(x)); } });
    },
    help: function () {
      view('<h3 style="margin-top:0;color:var(--blue)">' + t('help.title') + '</h3><div style="font-size:15px">' + t('help.body') + '</div><button class="btn primary block" onclick="calcBack()">OK</button>');
    }
  };

  // строка «Время расчёта» в начале расчёта (пояс меняется в настройках)
  function tzLine() {
    var now = new Date(), z = IC.userTz();
    return '<div class="tz-line"><span>🕐 ' + t('tz.local') + ': <b>' + IC.stamp(now, z) + '</b> <span class="muted">' + esc(z.replace(/_/g, ' ')) + ', ' + IC.tzLabel(z, now) + ' · UTC ' + IC.stamp(now, 'UTC').split(', ')[1] + '</span></span>' +
      '<button class="link-btn" onclick="Shell.openSettings()">⚙️</button></div>';
  }

  // шаг углеводов: единица (ХЕ / граммы) и вес 1 ХЕ берутся из настроек — в расчёте только ввод числа.
  // Сохраняются и ХЕ, и граммы.
  function carbsStep(next) {
    var unit = Settings.get('carbUnit') === 'g' ? 'g' : 'xe', xg = Units.xeG();
    numStep({
      q: t('step.carbs'), hint: t('step.carbsHint', { g: IC.dec(xg) }) + ' · <button class="link-btn" onclick="Shell.openSettings()">' + t('step.inSettings') + '</button>',
      unit: unit === 'xe' ? t('common.xe') : t('common.g'), min: 0.1, max: unit === 'xe' ? 40 : 400,
      ok: function (x) {
        S.carbUnit = unit; S.xeG = xg;
        if (unit === 'xe') { S.carbsHe = x; S.carbsG = x * xg; } else { S.carbsG = x; S.carbsHe = x / xg; }
        next();
      }
    });
  }

  // ---------------------------------------------------------------- расчёт (формула из исходного виджета)
  function compute() {
    var comp = Math.max(0, (S.current - S.target) / S.isf);
    var food = (S.carbsHe || 0) * (S.uc || 0);
    var total = comp + food, st = S.penStep;
    var k = total / st;
    var down = Math.round(Math.floor(k + 1e-9) * st * 100) / 100, up = Math.round(Math.ceil(k - 1e-9) * st * 100) / 100;
    S.calc = { comp: comp, food: food, total: total, down: down, up: up,
      predDown: (total - down) * S.isf + S.target, predUp: (total - up) * S.isf + S.target };
  }

  function choose(c) { S.choice = c; if (S.meal === 'correction' && S.inj === 'no_food') saveCalc(); else go('pause'); }

  function subtype() { if (S.meal === 'correction') return S.inj === 'with_food' ? 'correction_with_food' : 'correction_only'; return S.meal; }

  // ---------------------------------------------------------------- сохранение
  function persistUC() { var s = {}; ['target', 'isf', 'penStep', 'carbUnit', 'xeGrams', 'uc_breakfast', 'uc_lunch', 'uc_dinner', 'uc_snack'].forEach(function (k) { s[k] = Settings.get(k); }); Settings.set(s); }

  function base(now, type, sub) {
    // timestamp_moscow — местное время в выбранном поясе (по умолчанию — пояс устройства; название поля временное),
    // timestamp_w — то же время в UTC («время 0»),
    // timestamp — московское: по нему скрипт таблицы и автозаполнение с сервера считают замеры через 2 и 4 ч
    return { event_id: Store.uid(), timestamp: stampRU(now), timestamp_moscow: IC.stamp(now, IC.userTz()), timestamp_w: IC.stamp(now, 'UTC'), event_type: type, event_subtype: sub };
  }

  function saving(on) { Shell.busy(on, t('common.saving')); }

  function saveCalc() {
    var now = new Date(), c = S.calc, dose = S.choice === 'down' ? c.down : c.up;
    var ev = Object.assign(base(now, 'insulin_calculation', subtype()), {
      target_glucose: r2(S.target), current_glucose: r2(S.current), uc: S.uc || null,
      carbs_he: S.carbsG ? r2(S.carbsHe) : null, carbs_grams: S.carbsG ? r2(S.carbsG) : null,
      compensation_dose: r2(c.comp), food_insulin: r2(c.food), total_raw: r2(c.total),
      dose_down: c.down, dose_up: c.up, selected_dose: dose, rounding_choice: S.choice,
      predicted_down: r2(c.predDown), predicted_up: r2(c.predUp),
      pause_minutes: S.pause || 0, pen_step: S.penStep, correction_factor: r2(S.isf),
      notes: mealLabel(S.meal) + (S.meal === 'correction' ? ' (' + (S.inj === 'with_food' ? 'food' : 'no food') + ')' : ''), event_status: 'pending_2h_4h'
    });
    saving(true);
    linkReading(S.current, now).then(function (linked) {
      return Store.append(ev).then(function () { events.push(ev); persistUC(); return linked; });
    }).then(function (linked) {
      saving(false);
      var t2 = new Date(now.getTime() + 2 * H), t4 = new Date(now.getTime() + 4 * H);
      var html = '<b>' + t('done.saved') + '</b><br>💉 ' + t('done.dose') + ': <b>' + dose.toFixed(1) + ' ' + t('common.units') + '</b> (' + (S.choice === 'down' ? '↓' : '↑') + ')' +
        (S.pause ? '<br>⏱ ' + t('done.pause') + ': ' + S.pause + ' ' + t('common.min') : '') + '<br>🕐 ' + t('done.time') + ': ' + IC.fmtDate(now) +
        '<br>' + t('done.measure') + '<br>' + t('done.reminders', { t2: IC.fmtTime(t2), t4: IC.fmtTime(t4) }) + linkedNote(linked);
      done(html, [calLink(2, t2), calLink(4, t4)]);
      Reminders.notifyLater(ev);
    });
  }

  function saveBasal() {
    var now = new Date();
    var ev = Object.assign(base(now, 'basal_insulin', 'night'), { selected_dose: S.basalDose, weight: S.weight || null, notes: mealLabel('basal'), event_status: 'done' });
    saving(true);
    Store.append(ev).then(function () {
      events.push(ev); saving(false);
      done('<b>' + t('done.basal') + '</b><br>💉 ' + S.basalDose + ' ' + t('common.units') + (S.weight ? '<br>⚖️ ' + S.weight + ' ' + t('common.kg') : '') + '<br>🕐 ' + IC.fmtDate(now));
    });
  }

  function saveSnack() {
    var now = new Date();
    var ev = Object.assign(base(now, 'snack_no_insulin', 'snack'), {
      carbs_he: r2(S.carbsHe), carbs_grams: r2(S.carbsG),
      notes: mealLabel('snack'), event_status: 'done' });
    saving(true);
    Store.append(ev).then(function () {
      events.push(ev); saving(false);
      done('<b>' + t('done.snack') + '</b><br>🍞 ' + S.carbsHe.toFixed(1) + ' ' + t('common.xe') + ' (' + Math.round(S.carbsG) + ' ' + t('common.g') + ')<br>🕐 ' + IC.fmtDate(now) + '<br>' + t('done.measure').replace(' и 4', '').replace(' and 4', ''));
    });
  }

  function saveGlucose(mmol) {
    var now = new Date();
    saving(true);
    linkReading(mmol, now).then(function (linked) {
      if (linked.length) return linked;
      var ev = Object.assign(base(now, 'glucose_measurement', 'reading'), { current_glucose: r2(mmol), notes: mealLabel('glucose'), event_status: 'done' });
      return Store.append(ev).then(function () { events.push(ev); return linked; });
    }).then(function (linked) {
      saving(false);
      done('<b>' + t('done.glucose') + '</b><br>🩸 ' + Units.g(mmol) + ' ' + Units.gLabel() + '<br>🕐 ' + IC.fmtDate(now) + linkedNote(linked));
    });
  }

  // замер, сделанный примерно через 2/4 ч после болюса, записываем в это событие
  function linkReading(mmol, when) {
    var links = Stats.findLinks(events, when.getTime(), 30);
    return links.reduce(function (p, l) {
      return p.then(function (acc) {
        var patch = {}; patch['glucose_' + l.h + 'h'] = r2(mmol); patch['glucose_' + l.h + 'h_timestamp'] = stampRU(when);
        var other = l.h === 2 ? num(l.ev.glucose_4h) : num(l.ev.glucose_2h);
        patch.event_status = other != null ? 'completed' : (l.h === 2 ? 'pending_4h' : 'pending_2h');
        return Store.update(l.ev.event_id, patch).then(function () { Object.assign(l.ev, patch); acc.push(l); return acc; });
      });
    }, Promise.resolve([]));
  }
  function linkedNote(linked) {
    return (linked || []).map(function (l) { return '<br>🔗 ' + t('done.linked', { time: IC.fmtTime(IC.parseWhen(l.ev)), h: l.h }); }).join('');
  }

  function calLink(h, when) {
    var f = function (d) { return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); };
    var url = 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent('🩸 ' + t('done.calTitle', { h: h })) +
      '&dates=' + f(when) + '/' + f(new Date(when.getTime() + 10 * 60000)) + '&details=' + encodeURIComponent(location.origin + '/app/');
    return '<a class="btn secondary block" target="_blank" rel="noopener" href="' + url + '">' + t(h === 2 ? 'done.cal2' : 'done.cal4') + '</a>';
  }

  function done(html, extra) {
    stack = [];
    view('<div class="done-box">' + html + '</div>' + (extra || []).join('') +
      '<div class="note warn">' + t('done.rules') + '</div>' +
      '<button class="btn primary block" id="again">' + t('done.new') + '</button><div class="row"><button class="btn cancel" id="home">' + t('done.menu') + '</button><a class="btn report" href="/report/">' + t('menu.report') + '</a></div>');
    $('#again').onclick = function () { S = {}; stack = ['menu']; go('meal'); };
    $('#home').onclick = menu;
  }

  // ---------------------------------------------------------------- главное меню
  function menu() {
    stack = [];
    var io = Stats.iob(events, new Date(), num(Settings.get('dia')) || 2.5);
    var bi = Stats.basalInfo(events, new Date(), num(Settings.get('basalDia')) || 24);
    var recent = events.slice().sort(function (a, b) { return (IC.parseWhen(b) || 0) - (IC.parseWhen(a) || 0); }).slice(0, 6);
    view('<div class="note warn">' + t('menu.disclaimer') + '</div>' +
      (io.iob > 0 ? '<div class="note">💉 ' + t('iob.warn', { iob: io.iob, dose: num(io.last.selected_dose), time: IC.fmtTime(IC.parseWhen(io.last)) }) + '</div>' : '') +
      (bi ? '<div class="note small">🌙 ' + t('basal.info', { dose: IC.dec(bi.dose), rate: IC.dec(bi.rate), until: IC.fmtTime(bi.until) }) + '</div>' : '') +
      '<button class="btn primary block big" id="m-start">' + t('menu.start') + '</button>' +
      '<button class="btn secondary block" id="m-gl">' + t('menu.glucose') + '</button>' +
      '<div class="divider"></div><div class="row"><a class="btn report" href="/report/">' + t('menu.report') + '</a><button class="btn ghost" id="m-help">' + t('menu.help') + '</button></div>' +
      '<div class="recent"><h3>' + t('menu.recent') + '</h3>' + (recent.length ? recent.map(recentRow).join('') : '<p class="muted small">' + t('menu.noRecent') + '</p>') + '</div>');
    $('#m-start').onclick = function () { S = {}; stack = ['menu']; go('meal'); };
    $('#m-gl').onclick = function () { stack = ['menu']; go('glucose'); };
    $('#m-help').onclick = function () { stack = ['menu']; go('help'); };
    Reminders.render();
  }
  function recentRow(ev) {
    var k = Stats.kind(ev), parts = [];
    var d = num(ev.selected_dose); if (d) parts.push('💉 ' + d + ' ' + t('common.units'));
    var xe = Units.xeOf(ev); if (xe) parts.push('🍞 ' + xe.toFixed(1) + ' ' + t('common.xe'));
    var g = num(ev.current_glucose); if (g != null) parts.push('🩸 ' + Units.g(g));
    var g2 = num(ev.glucose_2h); if (g2 != null) parts.push(t('log.g2') + '→' + Units.g(g2));
    return '<div class="recent-item"><span>' + IC.fmtDate(IC.parseWhen(ev)) + ' · ' + t(KIND_LABEL[k]) + (ev._pending ? ' <span class="pending">⏳</span>' : '') + '</span><span class="muted">' + parts.join(' · ') + '</span></div>';
  }

  // ---------------------------------------------------------------- напоминания о замерах 2 ч / 4 ч
  var Reminders = {
    state: function () { return ls('ic_rem') || {}; },
    save: function (s) { ls('ic_rem', s); },
    due: function () {
      var now = Date.now(), st = this.state(), out = [];
      events.forEach(function (ev) {
        if (String(ev.event_type) !== 'insulin_calculation') return;
        var w = IC.parseWhen(ev); if (!w) return;
        [2, 4].forEach(function (h) {
          if (num(ev['glucose_' + h + 'h']) != null) return;
          var id = ev.event_id + '_' + h, s = st[id] || {};
          if (s.skip || s.sent) return;
          if (s.snooze && s.snooze > now) return;
          var target = w.getTime() + h * H;
          if (now >= target - 5 * 60000 && now <= target + 3 * H) out.push({ id: id, ev: ev, h: h, target: new Date(target) });
        });
      });
      return out;
    },
    render: function () {
      var box = $('#reminders'), onMenu = stack.length === 0;
      var due = this.due();
      if (!onMenu || !due.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
      box.style.display = 'block';
      box.innerHTML = due.map(function (r) {
        return '<div class="rem-card" id="rem-' + r.id + '"><div class="t">' + t('rem.title', { h: r.h }) + '</div><div class="d">📅 ' + t('rem.inj') + ': ' + IC.fmtDate(IC.parseWhen(r.ev)) +
          ' · ' + t(KIND_LABEL[Stats.kind(r.ev)]) + '<br>🎯 ' + t('rem.at') + ': ' + IC.fmtTime(r.target) + '</div>' +
          '<input type="text" inputmode="decimal" placeholder="' + Units.gLabel() + '" data-in="' + r.id + '">' +
          '<div class="a"><button class="send" data-send="' + r.id + '">' + t('rem.send') + '</button><button class="sn" data-snz="' + r.id + '">' + t('rem.snooze') + '</button><button class="sn" data-skip="' + r.id + '">' + t('rem.skip') + '</button></div></div>';
      }).join('');
      var self = this;
      box.querySelectorAll('[data-send]').forEach(function (b) {
        b.onclick = function () {
          var r = due.filter(function (x) { return x.id === b.dataset.send; })[0];
          var v = num(box.querySelector('[data-in="' + r.id + '"]').value), rg = gRange(1, 35);
          if (v == null || v < rg[0] || v > rg[1]) { Shell.toast(t('err.range', { min: rg[0], max: rg[1] }), 'error'); return; }
          b.disabled = true; b.textContent = '…';
          var patch = {}; patch['glucose_' + r.h + 'h'] = r2(Units.fromDisp(v)); patch['glucose_' + r.h + 'h_timestamp'] = stampRU(r.target);
          var other = r.h === 2 ? num(r.ev.glucose_4h) : num(r.ev.glucose_2h);
          patch.event_status = other != null ? 'completed' : (r.h === 2 ? 'pending_4h' : 'pending_2h');
          Store.update(r.ev.event_id, patch).then(function () {
            Object.assign(r.ev, patch); var st = self.state(); st[r.id] = { sent: true }; self.save(st);
            $('#rem-' + r.id).innerHTML = '<div class="rem-sent">' + t('rem.sent') + '</div>';
            setTimeout(function () { self.render(); }, 1500);
          });
        };
      });
      box.querySelectorAll('[data-snz]').forEach(function (b) { b.onclick = function () { var st = self.state(); st[b.dataset.snz] = { snooze: Date.now() + 15 * 60000 }; self.save(st); self.render(); }; });
      box.querySelectorAll('[data-skip]').forEach(function (b) { b.onclick = function () { var st = self.state(); st[b.dataset.skip] = { skip: true }; self.save(st); self.render(); }; });
      box.querySelectorAll('input').forEach(function (i) { i.addEventListener('keydown', function (e) { if (e.key === 'Enter') box.querySelector('[data-send="' + i.dataset.in + '"]').click(); }); });
    },
    // уведомления браузера, пока вкладка открыта
    notify: function () {
      if (!Settings.get('notif') || !('Notification' in window) || Notification.permission !== 'granted') return;
      var st = this.state(), changed = false;
      this.due().forEach(function (r) {
        if (st[r.id] && st[r.id].notified) return;
        try { new Notification(t('rem.notifTitle'), { body: t('rem.title', { h: r.h }) + ' — ' + IC.fmtTime(r.target), icon: '/assets/img/icon-192.png', tag: r.id }); } catch (e) {}
        st[r.id] = Object.assign(st[r.id] || {}, { notified: true }); changed = true;
      });
      if (changed) this.save(st);
    },
    notifyLater: function () { /* проверка идёт по таймеру ниже */ },
    tick: function () { this.notify(); if (stack.length === 0) this.render(); }
  };

  // ---------------------------------------------------------------- запуск
  function onReady() {
    Store.events().then(function (list) { events = list; menu(); });
  }
  document.addEventListener('DOMContentLoaded', function () {
    Shell.boot('app', onReady);
    setInterval(function () { if (Store.current) Reminders.tick(); }, 60000);
    // обновляем данные при возврате на вкладку (вторая семья/устройство могли добавить записи)
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && Store.current && stack.length === 0) Store.events(true).then(function (l) { events = l; menu(); }).catch(function () {});
    });
  });
})();
