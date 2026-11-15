/* InsulinCalc — расчёты: классификация событий, активный инсулин, авто-привязка замеров,
   оценки УК/ФЧИ (чистые события, регрессия, по приёмам пищи), агрегаты для графиков. */
(function () {
  'use strict';
  var num = IC.num, parseWhen = IC.parseWhen;
  var H = 3600000;

  var MEAL_MAP = { 'завтрак': 'breakfast', 'breakfast': 'breakfast', 'обед': 'lunch', 'lunch': 'lunch', 'ужин': 'dinner', 'dinner': 'dinner',
    'correction_only': 'corr', 'correction_with_food': 'corrFood', 'night': 'basal', 'snack': 'snack', 'перекус': 'snack' };

  // «Завтрак», «🍳 завтрак», «Breakfast », «BREAKFAST» → одно и то же значение
  function mealKey(v) { return String(v == null ? '' : v).toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я_]/g, ''); }
  function kind(ev) {
    var tp = String(ev.event_type || '').toLowerCase().trim(), sub = mealKey(ev.event_subtype);
    if (tp === 'basal_insulin') return 'basal';
    if (tp === 'snack_no_insulin') return 'snack';
    if (tp === 'glucose_measurement') return 'glucose';
    if (tp === 'insulin_calculation' || !tp) return MEAL_MAP[sub] || 'other';
    return 'other';
  }
  function isBolus(ev) { return String(ev.event_type) === 'insulin_calculation' && (num(ev.selected_dose) || 0) > 0; }

  function median(a) {
    if (!a.length) return null;
    var s = a.slice().sort(function (x, y) { return x - y; }), m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  // отбрасываем грубые выбросы (за пределами 1.5 IQR), если точек достаточно
  function trim(a) {
    if (a.length < 5) return a;
    var s = a.slice().sort(function (x, y) { return x - y; });
    var q1 = s[Math.floor(s.length * 0.25)], q3 = s[Math.floor(s.length * 0.75)], iqr = q3 - q1;
    return a.filter(function (v) { return v >= q1 - 1.5 * iqr && v <= q3 + 1.5 * iqr; });
  }

  // замер «после»: для чистых коррекций приоритет 4 ч (инсулин успевает подействовать), для еды — 2 ч
  function after(ev) {
    var g2 = num(ev.glucose_2h), g4 = num(ev.glucose_4h);
    if (kind(ev) === 'corr') return g4 != null ? g4 : g2;
    return g2 != null ? g2 : g4;
  }

  // ---------------------------------------------------------------- активный инсулин (линейная модель)
  function iob(events, now, diaH) {
    now = now || new Date(); diaH = diaH || 4;
    var total = 0, last = null;
    events.forEach(function (ev) {
      if (!isBolus(ev)) return;
      var w = parseWhen(ev); if (!w) return;
      var el = (now - w) / H;
      if (el < 0 || el >= diaH) return;
      total += num(ev.selected_dose) * (1 - el / diaH);
      if (!last || w > parseWhen(last)) last = ev;
    });
    return { iob: Math.round(total * 10) / 10, last: last };
  }

  // Последний базальный: доза, скорость (доза / длительность в ч/ч) и сколько ещё действует.
  // В активный инсулин НЕ добавляется — показывается отдельно, для информации.
  function basalInfo(events, now, durH) {
    now = now || new Date(); durH = durH || 24;
    var last = null, lw = null;
    events.forEach(function (ev) {
      if (String(ev.event_type) !== 'basal_insulin' || !(num(ev.selected_dose) > 0)) return;
      var w = parseWhen(ev); if (!w || w > now) return;
      if (!lw || w > lw) { last = ev; lw = w; }
    });
    if (!last) return null;
    var dose = num(last.selected_dose), el = (now - lw) / H;
    if (el >= durH) return null;
    return { dose: dose, rate: Math.round(dose / durH * 100) / 100, left: Math.round(dose * (1 - el / durH) * 10) / 10, until: new Date(lw.getTime() + durH * H), at: lw };
  }

  // ---------------------------------------------------------------- авто-привязка замера к событию 2ч/4ч
  function findLinks(events, when, windowMin) {
    windowMin = windowMin || 30;
    var best = { 2: null, 4: null };
    events.forEach(function (ev) {
      if (String(ev.event_type) !== 'insulin_calculation') return;
      var w = parseWhen(ev); if (!w) return;
      [2, 4].forEach(function (h) {
        if (num(ev['glucose_' + h + 'h']) != null) return;
        var diff = Math.abs(when - (w.getTime() + h * H)) / 60000;
        if (diff <= windowMin && (!best[h] || diff < best[h].diff)) best[h] = { ev: ev, diff: diff, h: h };
      });
    });
    return [best[2], best[4]].filter(Boolean);
  }

  // ---------------------------------------------------------------- регрессия Δg = a·XE − b·Dose
  function regress(rows) {
    // rows: {xe, dose, dy}
    var n = rows.length; if (n < 3) return null;
    var sxx = 0, sdd = 0, sxd = 0, sxy = 0, sdy = 0;
    rows.forEach(function (r) { sxx += r.xe * r.xe; sdd += r.dose * r.dose; sxd += r.xe * r.dose; sxy += r.xe * r.dy; sdy += r.dose * r.dy; });
    // переменные: x1 = xe, x2 = -dose  → коэффициенты a, b
    var A = sxx, B = -sxd, C = sdd, Y1 = sxy, Y2 = -sdy;
    var det = A * C - B * B;
    if (Math.abs(det) < 1e-9) return null;
    var a = (Y1 * C - B * Y2) / det, b = (A * Y2 - B * Y1) / det;
    var mean = rows.reduce(function (s, r) { return s + r.dy; }, 0) / n;
    var ssr = 0, sst = 0;
    rows.forEach(function (r) { var p = a * r.xe - b * r.dose; ssr += Math.pow(r.dy - p, 2); sst += Math.pow(r.dy - mean, 2); });
    var r2 = sst > 0 ? Math.max(0, 1 - ssr / sst) : null;
    var ok = b > 0.05 && a > 0 && b < 30;
    return { a: a, isf: b, uk: ok ? a / b : null, r2: r2, n: n, ok: ok };
  }

  // общий МНК через нормальные уравнения (Гаусс)
  function ols(X, y) {
    var k = X[0].length, A = [], i, j, r;
    for (i = 0; i < k; i++) { A.push(new Array(k + 1).fill(0)); }
    X.forEach(function (x, n) { for (i = 0; i < k; i++) { for (j = 0; j < k; j++) A[i][j] += x[i] * x[j]; A[i][k] += x[i] * y[n]; } });
    for (i = 0; i < k; i++) {
      var piv = i; for (r = i + 1; r < k; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r;
      if (Math.abs(A[piv][i]) < 1e-9) return null;
      var tmp = A[i]; A[i] = A[piv]; A[piv] = tmp;
      for (r = 0; r < k; r++) if (r !== i) { var f = A[r][i] / A[i][i]; for (j = i; j <= k; j++) A[r][j] -= f * A[i][j]; }
    }
    return A.map(function (row, i2) { return row[k] / row[i2]; });
  }

  // Совместная модель: у каждого приёма пищи свой коэффициент углеводов, ФЧИ — общий.
  // Δg = Σ a_m·XE·[приём=m] − ФЧИ·Доза. Подколки без еды «якорят» ФЧИ.
  function regressJoint(rows) {
    var groups = {};
    rows.forEach(function (r) { if (r.xe > 0.1) { var g = r.meal || 'other'; groups[g] = (groups[g] || 0) + 1; } });
    var names = Object.keys(groups).filter(function (g) { return groups[g] >= 2; });
    var use = rows.filter(function (r) { return r.xe <= 0.1 || names.indexOf(r.meal || 'other') >= 0; });
    var k = names.length + 1;
    if (use.length < k + 2) return null;
    var X = use.map(function (r) { var x = names.map(function (g) { return (r.meal || 'other') === g ? r.xe : 0; }); x.push(-r.dose); return x; });
    var y = use.map(function (r) { return r.dy; });
    var c = ols(X, y); if (!c) return null;
    var isf = c[k - 1], mean = y.reduce(function (s, v) { return s + v; }, 0) / y.length, ssr = 0, sst = 0;
    X.forEach(function (x, n) { var p = 0; for (var i = 0; i < k; i++) p += x[i] * c[i]; ssr += Math.pow(y[n] - p, 2); sst += Math.pow(y[n] - mean, 2); });
    var ok = isf > 0.05 && isf < 30;
    var per = {}, wsum = 0, wn = 0;
    names.forEach(function (g, i) { var uk = ok && c[i] > 0 ? c[i] / isf : null; per[g] = { uk: uk, n: groups[g] }; if (uk) { wsum += uk * groups[g]; wn += groups[g]; } });
    return { isf: ok ? isf : null, uk: wn ? wsum / wn : null, per: per, r2: sst > 0 ? Math.max(0, 1 - ssr / sst) : null, n: use.length, ok: ok && wn > 0 };
  }

  function rowsOf(events) {
    var out = [];
    events.forEach(function (ev) {
      if (String(ev.event_type) !== 'insulin_calculation') return;
      var g0 = num(ev.current_glucose), g1 = after(ev), d = num(ev.selected_dose);
      if (g0 == null || g1 == null || d == null) return;
      var k = kind(ev); out.push({ xe: Units.xeOf(ev), dose: d, dy: g1 - g0, ev: ev, meal: k === 'corrFood' ? 'snack' : k });
    });
    return out;
  }

  // ---------------------------------------------------------------- независимые («чистые события»)
  function isfIndependent(events) {
    var vals = [];
    events.forEach(function (ev) {
      if (kind(ev) !== 'corr') return;
      var g0 = num(ev.current_glucose), g1 = after(ev), d = num(ev.selected_dose);
      if (g0 == null || g1 == null || !d) return;
      var v = (g0 - g1) / d; if (v > 0 && v < 30) vals.push(v);
    });
    vals = trim(vals);
    return { value: median(vals), events: vals.length };
  }
  function ukIndependent(events, isfRef) {
    var vals = [];
    events.forEach(function (ev) {
      var k = kind(ev);
      if (['breakfast', 'lunch', 'dinner', 'corrFood'].indexOf(k) < 0) return;
      var g0 = num(ev.current_glucose), g1 = after(ev), d = num(ev.selected_dose), tg = num(ev.target_glucose), xe = Units.xeOf(ev);
      var isf = isfRef || num(ev.correction_factor);
      if (g0 == null || g1 == null || d == null || tg == null || !isf || xe < 0.5) return;
      if (Math.abs(g0 - tg) > 1.5) return;
      var v = (d + (g1 - tg) / isf) / xe; if (v > 0 && v < 20) vals.push(v);
    });
    vals = trim(vals);
    return { value: median(vals), events: vals.length };
  }

  // ---------------------------------------------------------------- по приёмам пищи
  function byMeal(events, isfRef) {
    var res = {};
    ['breakfast', 'lunch', 'dinner'].forEach(function (m) {
      var rows = rowsOf(events.filter(function (e) { return kind(e) === m; })).filter(function (r) { return r.xe >= 0.5; });
      var out = { value: null, fchi: null, events: rows.length, method: null };
      var reg = rows.length >= 4 ? regress(rows) : null;
      if (reg && reg.ok) { out.value = reg.uk; out.fchi = reg.isf; out.method = 'regression'; out.r2 = reg.r2; }
      else {
        var vals = [];
        rows.forEach(function (r) {
          var isf = isfRef || num(r.ev.correction_factor); if (!isf) return;
          var v = (r.dose + r.dy / isf) / r.xe; if (v > 0 && v < 20) vals.push(v);
        });
        vals = trim(vals);
        out.value = median(vals); out.method = 'events';
        // ФЧИ для приёма: по событиям этого приёма, где ХЕ мало влияет — оцениваем из остатка
        var fv = [];
        rows.forEach(function (r) {
          var uk = num(r.ev.uc); if (!uk || !r.dose) return;
          var corrPart = r.dose - r.xe * uk; // часть дозы сверх «нормы» на еду
          if (corrPart > 0.3) { var v = (-r.dy) / corrPart; if (v > 0 && v < 30) fv.push(v); }
        });
        out.fchi = fv.length >= 2 ? median(fv) : null;
      }
      res[m] = out;
    });
    return res;
  }

  // ---------------------------------------------------------------- метрики
  function metrics(events, range) {
    range = range || 2;
    var n = 0, inT = 0, hi = 0, lo = 0, hypo = 0;
    events.forEach(function (ev) {
      if (String(ev.event_type) !== 'insulin_calculation') return;
      var g = num(ev.glucose_2h), tg = num(ev.target_glucose);
      if (g == null || tg == null) return;
      n++; var d = g - tg;
      if (Math.abs(d) <= range) inT++; else if (d > 0) hi++; else lo++;
      if (g < 3.9) hypo++;
    });
    var all = readings(events).map(function (r) { return r.v; });
    var avg = all.length ? all.reduce(function (s, v) { return s + v; }, 0) / all.length : null;
    var pct = function (x) { return n ? x / n * 100 : null; };
    return { n: n, inTarget: pct(inT), high: pct(hi), low: pct(lo), missRate: n ? 100 - pct(inT) : null, hypo: hypo, avg: avg, readings: all.length };
  }

  // Средняя глюкоза (ммоль/л) за `days` дней до каждого момента из `times`.
  // `rs` — все замеры, отсортированные по времени.
  function rollingMean(rs, times, days) {
    var win = days * 86400000, lo = 0, hi = 0, sum = 0;
    return times.map(function (tm) {
      var end = tm.getTime();
      while (hi < rs.length && rs[hi].t.getTime() <= end) { sum += rs[hi].v; hi++; }
      while (lo < hi && rs[lo].t.getTime() <= end - win) { sum -= rs[lo].v; lo++; }
      return hi > lo ? sum / (hi - lo) : null;
    });
  }
  // GMI (Glucose Management Indicator), %: 3,31 + 0,02392 × средняя глюкоза в мг/дл
  function gmi(meanMmol) { return 3.31 + 0.02392 * meanMmol * 18.0182; }
  function readings(events) {
    var out = [];
    events.forEach(function (ev) {
      var w = parseWhen(ev); if (!w) return;
      var c = num(ev.current_glucose); if (c != null) out.push({ t: w, v: c });
      var g2 = num(ev.glucose_2h); if (g2 != null) out.push({ t: new Date(w.getTime() + 2 * H), v: g2 });
      var g4 = num(ev.glucose_4h); if (g4 != null) out.push({ t: new Date(w.getTime() + 4 * H), v: g4 });
    });
    out.sort(function (a, b) { return a.t - b.t; });
    // один и тот же замер мог попасть и как «текущая» нового события, и как 2/4 ч предыдущего
    return out.filter(function (r, i) { var p = out[i - 1]; return !(p && Math.abs(r.t - p.t) < 20 * 60000 && Math.abs(r.v - p.v) < 0.05); });
  }

  // ---------------------------------------------------------------- агрегаты по дням
  function dayKey(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function daily(events, days, allEvents) {
    var now = new Date(), map = {}, keys = [];
    for (var i = days - 1; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      var k = dayKey(d); keys.push(k); map[k] = { bolus: 0, basal: 0, xe: 0, weight: null, any: false };
    }
    events.forEach(function (ev) {
      var w = parseWhen(ev); if (!w) return; var k = dayKey(w); var r = map[k]; if (!r) return;
      var d = num(ev.selected_dose) || 0, kd = kind(ev);
      if (kd === 'basal') { r.basal += d; r.any = true; }
      else if (String(ev.event_type) === 'insulin_calculation') { r.bolus += d; r.any = true; }
      if (['breakfast', 'lunch', 'dinner', 'corrFood', 'snack'].indexOf(kd) >= 0) { r.xe += Units.xeOf(ev); r.any = true; }
      var wt = num(ev.weight); if (wt) r.weight = wt;
    });
    // вес: последний известный на дату (включая записи до начала периода)
    var lastW = null;
    (allEvents || events).slice().sort(function (a, b) { return (parseWhen(a) || 0) - (parseWhen(b) || 0); }).forEach(function (ev) {
      var w = parseWhen(ev); if (w && dayKey(w) < keys[0] && num(ev.weight)) lastW = num(ev.weight);
    });
    var rows = keys.map(function (k) {
      var r = map[k]; if (r.weight) lastW = r.weight;
      return { day: k, bolus: r.bolus, basal: r.basal, total: r.bolus + r.basal, xe: r.xe, weight: r.weight, wKnown: lastW, any: r.any };
    });
    return rows;
  }

  window.Stats = { regressJoint: regressJoint, ols: ols, kind: kind, isBolus: isBolus, iob: iob, basalInfo: basalInfo, findLinks: findLinks, regress: regress, rowsOf: rowsOf,
    isfIndependent: isfIndependent, ukIndependent: ukIndependent, byMeal: byMeal, metrics: metrics, readings: readings, rollingMean: rollingMean, gmi: gmi, daily: daily, median: median, after: after };
})();
