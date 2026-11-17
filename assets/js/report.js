/* InsulinCalc — страница отчётов (все расчёты в браузере по данным из Google Таблицы) */
(function () {
  'use strict';
  var $ = IC.$, esc = IC.esc, num = IC.num;
  var all = [], charts = {}, last = null, cgm = null; // cgm: суточные данные датчика из листа CGM_daily (или null)
  var DAY = 86400000;

  function conf(n) { if (!n || n <= 0) return 0; if (n >= 10) return 100; if (n >= 5) return 75; if (n >= 3) return 50; return 25; }
  function confCls(c) { return c >= 75 ? 'conf-high' : c >= 50 ? 'conf-medium' : 'conf-low'; }
  function ukTxt(v) { return v == null ? '—' : v.toFixed(2) + ' ' + t('common.units') + '/' + t('common.xe'); }
  function ukGrams(v) { return v ? '≈ 1 ' + t('common.units') + ' / ' + Math.round(Units.xeG() / v) + ' ' + t('common.g') : ''; }
  function isfTxt(v) { return v == null ? '—' : (Units.isMg() ? Units.isfToDisp(v) : v.toFixed(2)) + ' ' + Units.isfLabel(); }
  function pct(v) { return v == null ? '—' : v.toFixed(1) + '%'; }

  function kcard(title, value, metaHtml, red) {
    return '<div class="kcard' + (red ? ' red' : '') + '"><h4>' + title + '</h4><div class="kval' + (red ? ' red' : '') + '">' + value + '</div><div class="kmeta">' + metaHtml + '</div></div>';
  }
  function confHtml(n) {
    var c = conf(n);
    return '<div>' + t('rep.events') + ': <b>' + (n || 0) + '</b></div><div>' + t('rep.confidence') + ': ' + c + '%</div><div class="bar"><div class="' + confCls(c) + '" style="width:' + c + '%"></div></div>';
  }
  function curUsing(v) { return v ? '<div>' + t('rep.current') + ': ' + v + '</div>' : ''; }

  function repDays() { return Math.max(1, Math.min(365, parseInt($('#days').value, 10) || 14)); }
  function build() {
    var days = repDays();
    var from = Date.now() - days * DAY;
    var period = all.filter(function (e) { var w = IC.parseWhen(e); return w && w.getTime() >= from; });
    var regrSet = $('#regr').value === 'all' ? all : period;

    // --- 1. независимые
    var isfI = Stats.isfIndependent(period, all);
    // опорный ФЧИ для УК — по чистым подколкам, если их хотя бы 3; иначе ФЧИ, использованный в каждом расчёте
    var ukI = Stats.ukIndependent(period, isfI.events >= 3 ? isfI.value : null, all);
    var curIsf = num(Settings.get('isf'));
    $('#k-indep').innerHTML =
      kcard(t('rep.uk'), ukTxt(ukI.value), '<div class="muted">' + ukGrams(ukI.value) + '</div>' + confHtml(ukI.events)) +
      kcard(t('rep.isf'), isfTxt(isfI.value), confHtml(isfI.events) + curUsing(curIsf ? isfTxt(curIsf) : ''), true);

    // --- 3. регрессия
    var rows = Stats.rowsOf(regrSet, all);
    var reg = rows.length >= 4 ? Stats.regressJoint(rows) : null;
    var regOk = reg && reg.ok;
    var pLabel = $('#regr').value === 'all' ? t('rep.regrAll') : days + ' ' + (I18N.lang === 'ru' ? 'дн.' : 'days');
    var regMeta = '<div>' + t('rep.method') + ': ' + pLabel + '</div><div>' + t('rep.r2') + ': ' + (reg && reg.r2 != null ? reg.r2.toFixed(3) : '—') + '</div><div>' + t('rep.events') + ': ' + rows.length + '</div>' +
      (rows.skipped ? '<div class="muted">' + t('rep.skipped') + ': ' + rows.skipped + '</div>' : '') +
      (!regOk && rows.length ? '<div class="muted">' + t('rep.noData') + '</div>' : '');
    $('#k-regr').innerHTML = kcard(t('rep.uk') + ' — ' + t('tab.regression').toLowerCase(), regOk ? ukTxt(reg.uk) : '—', (regOk ? '<div class="muted">' + ukGrams(reg.uk) + '</div>' : '') + regMeta) +
      kcard(t('rep.isf') + ' — ' + t('tab.regression').toLowerCase(), regOk ? isfTxt(reg.isf) : '—', regMeta, true);

    // --- 2. по приёмам пищи
    // опорный ФЧИ для приёмов пищи: чистые подколки (≥ 3) → регрессия (если получилась) → ФЧИ из самого расчёта
    var isfRef = isfI.events >= 3 ? isfI.value : (regOk ? reg.isf : null);
    var bm = Stats.byMeal(regrSet, isfRef, all);
    $('#k-meals').innerHTML = ['breakfast', 'lunch', 'dinner'].map(function (m) {
      var r = bm[m], icon = { breakfast: '🌅', lunch: '☀️', dinner: '🌙' }[m], cur = num(Settings.get('uc_' + m));
      return '<div class="kcard"><h4>' + icon + ' ' + t('meal.' + m) + '</h4>' +
        '<div class="small muted">' + t('rep.uk') + '</div><div class="kval">' + ukTxt(r.value) + '</div><div class="kmeta"><div class="muted">' + ukGrams(r.value) + '</div>' + confHtml(r.events) +
        (r.method ? '<div>' + t('rep.method') + ': ' + (r.method === 'regression' ? t('tab.regression') + (r.r2 != null ? ' (R² ' + r.r2.toFixed(2) + ')' : '') : (I18N.lang === 'ru' ? 'медиана событий' : 'median of events')) + '</div>' : '') +
        (r.value == null && r.small ? '<div class="muted">' + t('rep.smallMeals', { n: r.small }) + '</div>' : '') +
        curUsing(cur ? cur + ' ' + t('common.units') + '/' + t('common.xe') : '') + '</div>' +
        '<div class="small muted" style="margin-top:10px">' + t('rep.isf') + '</div><div class="kval red" style="font-size:20px">' + isfTxt(r.fchi) + '</div></div>';
    }).join('');

    // --- графики
    var daily = Stats.daily(period, days, all);
    renderCharts(daily, period);

    // --- метрики
    var m = Stats.metrics(period, num(Settings.get('range')) || 2);
    var rTxt = (Units.isMg() ? Math.round((num(Settings.get('range')) || 2) * IC.MGDL) : (num(Settings.get('range')) || 2)) + ' ' + Units.gLabel();
    $('#metrics').innerHTML =
      metric('m1', t('m.miss'), pct(m.missRate), t('m.missSub', { r: rTxt })) +
      metric('m2', t('m.in'), pct(m.inTarget), t('m.inSub') + ' (' + m.n + ')') +
      metric('m3', t('m.high'), pct(m.high), t('m.highSub')) +
      metric('m4', t('m.low'), pct(m.low), t('m.lowSub', { n: m.hypo })) +
      metric('m5', t('m.avg'), m.avg == null ? '—' : Units.g(m.avg), Units.gLabel() + ' · ' + t('m.avgSub') + ' (' + m.readings + ')');

    // --- журнал
    renderLog(period);
    last = { days: days, period: period, ukI: ukI, isfI: isfI, reg: reg, bm: bm, m: m };
  }

  function metric(cls, label, v, sub) { return '<div class="metric ' + cls + '"><div class="l">' + label + '</div><div class="v">' + v + '</div><div class="s">' + sub + '</div></div>'; }

  // ---------------------------------------------------------------- графики
  function chart(id, type, labels, datasets, yTitle, opts) {
    if (charts[id]) { charts[id].destroy(); delete charts[id]; }
    var box = $('#' + id);
    var hasData = datasets.some(function (d) { return d.data.some(function (v) { return v != null && v !== 0; }); });
    if (!labels.length || !hasData || !window.Chart) { box.innerHTML = '<div class="empty">' + t('ch.noData') + '</div>'; return; }
    box.innerHTML = '<canvas></canvas>';
    charts[id] = new Chart(box.querySelector('canvas'), {
      type: type, data: { labels: labels, datasets: datasets },
      options: Object.assign({ responsive: true, maintainAspectRatio: false, spanGaps: true, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'top' } }, scales: Object.assign({ y: { beginAtZero: !(opts && opts.noZero), title: { display: true, text: yTitle } } }, opts && opts.scales) }, opts && opts.extra)
    });
  }
  function ds(label, data, color, extra) {
    return Object.assign({ label: label, data: data, borderColor: color, backgroundColor: color + '22', tension: 0.3, fill: true, pointRadius: 3, pointHoverRadius: 5, pointBorderWidth: 1 }, extra || {}); // одинаковые маркеры на всех графиках
  }
  function lbl(day) { var p = day.split('-'); return p[2] + '.' + p[1]; }

  // Суточные данные датчика из листа CGM_daily (GMI за 90 дней уже посчитан на сервере). Нет листа — null, график по замерам таблицы.
  function loadCgm() {
    return Store.cgmDaily().then(function (d) { cgm = d; }).catch(function () { cgm = null; });
  }
  var GMI_AXIS_MIN = 6.2, GMI_AXIS_MAX = 7.5; // границы оси GMI справа, %
  var WCOV_MIN = 70; // меньше этой доли данных в 90-дневном окне — GMI неполный (рисуется пунктиром)

  function renderCharts(daily, period) {
    var labels = daily.map(function (d) { return lbl(d.day); });
    var u = t('common.units'), r1 = function (v) { return Math.round(v * 10) / 10; };
    chart('c-daily', 'line', labels, [
      ds(t('ch.total'), daily.map(function (d) { return d.any ? r1(d.total) : null; }), '#1a73e8'),
      ds(t('ch.basal'), daily.map(function (d) { return d.any ? r1(d.basal) : null; }), '#ff9800')
    ], u);
    chart('c-kg', 'line', labels, [
      ds(t('ch.totalKg'), daily.map(function (d) { return d.any && d.wKnown ? Math.round(d.total / d.wKnown * 100) / 100 : null; }), '#1a73e8'),
      ds(t('ch.basalKg'), daily.map(function (d) { return d.any && d.wKnown ? Math.round(d.basal / d.wKnown * 100) / 100 : null; }), '#ff9800')
    ], u + '/' + t('common.kg'));
    chart('c-weight', 'line', labels, [ds(t('ch.weightKg'), daily.map(function (d) { return d.weight; }), '#34a853')], t('common.kg'), { noZero: true });
    // линии с заливкой (как «Общее количество инсулина в сутки»): болюсный, базальный, ХЕ
    var area = { tension: 0.4 }; // маркеры — как на остальных графиках (размер по умолчанию в ds)
    chart('c-food', 'line', labels, [
      ds(t('ch.bolus'), daily.map(function (d) { return d.any ? r1(d.bolus) : null; }), '#1a73e8', area),
      ds(t('ch.basal'), daily.map(function (d) { return d.any ? r1(d.basal) : null; }), '#ff9800', area),
      ds(t('ch.xe'), daily.map(function (d) { return d.any ? r1(d.xe) : null; }), '#34a853', area)
    ], u + ' / ' + t('common.xe'));
    var rd = Stats.readings(period);
    // Целевая зона 4–9 ммоль/л: зелёные пунктирные границы и заливка между ними (границы и ось хранятся в ммоль/л, показ — в единицах пользователя)
    var ZONE_LO = 4, ZONE_HI = 9, AXIS_MIN = 3.5, AXIS_MAX = 17;
    var gl = [ds(t('ch.glucoseL') + ' (' + Units.gLabel() + ')', rd.map(function (r) { return Units.toDisp(r.v); }), '#7b1fa2', { fill: false, tension: 0.2 })];
    var zl = Units.toDisp(ZONE_LO), zh = Units.toDisp(ZONE_HI);
    gl.push(ds(String(zl), rd.map(function () { return zl; }), '#34a853', { fill: false, borderDash: [6, 4], pointRadius: 0, borderWidth: 1, zoneLow: true }));
    gl.push(ds(zl + '–' + zh + ' ' + Units.gLabel(), rd.map(function () { return zh; }), '#34a853', { fill: '-1', backgroundColor: 'rgba(52,168,83,0.15)', borderDash: [6, 4], pointRadius: 0, borderWidth: 1 }));
    // GMI по дням (ось справа, %). Источник — лист CGM_daily (данные датчика, GMI за 90 дней посчитан на сервере);
    // нет листа — по замерам из таблицы. Одна точка на день, на последнем замере этого дня.
    var allRd = Stats.readings(all), lastIdx = {}, dayEnd = {};
    rd.forEach(function (r, i) { var k = IC.mskDay(r.t); lastIdx[k] = i; dayEnd[k] = IC.mskDayEnd(r.t); });
    var dayKeys = Object.keys(lastIdx);
    var gmiData = rd.map(function () { return null; }), meanData = rd.map(function () { return null; }), wcovData = rd.map(function () { return null; }), lastG = null;
    var useCgm = !!cgm;
    if (useCgm) {
      // Полнота 90-дневного окна: на сервере она считается относительно накопленной истории (в начале — одни сутки = «100%»),
      // поэтому здесь приводим к полным 90 суткам: данные × (накопленные дни / 90)
      var firstDay = Date.parse(Object.keys(cgm).sort()[0] + 'T00:00:00Z');
      dayKeys.forEach(function (k) {
        var row = cgm[k]; if (!row || row.gmi == null) return;
        var span = Math.min(90, Math.round((Date.parse(k + 'T00:00:00Z') - firstDay) / 86400000) + 1);
        var i = lastIdx[k]; gmiData[i] = Math.round(row.gmi * 100) / 100; meanData[i] = row.mean90;
        wcovData[i] = row.wcov != null ? row.wcov * span / 90 : null; lastG = gmiData[i];
      });
    } else {
      var means = Stats.rollingMean(allRd, dayKeys.map(function (k) { return dayEnd[k]; }), 90);
      dayKeys.forEach(function (k, j) { if (means[j] != null) { var i = lastIdx[k]; meanData[i] = means[j]; gmiData[i] = Math.round(Stats.gmi(means[j]) * 100) / 100; lastG = gmiData[i]; } });
    }
    var extraScales = { y: { min: Units.toDisp(AXIS_MIN), max: Units.toDisp(AXIS_MAX), title: { display: true, text: Units.gLabel() },
      // деления через 1 ммоль/л (4 … 17), чтобы границы зоны 4 и 9 были подписаны
      afterBuildTicks: Units.isMg() ? undefined : function (sc) { var a = []; for (var v = 4; v <= AXIS_MAX; v++) a.push({ value: v }); sc.ticks = a; },
      ticks: { autoSkip: false } } };
    if (lastG != null) {
      gl.push(ds(t(useCgm ? 'ch.gmiCgm' : 'ch.gmi') + ' · ' + lastG.toFixed(1) + '%', gmiData, '#0d1b5e',
        { fill: false, tension: 0.35, borderWidth: 3, yAxisID: 'y2', spanGaps: true, mean: meanData, wcov: wcovData, order: -1,
          // участки, где данных в 90-дневном окне меньше WCOV_MIN %, — пунктиром (GMI неполный)
          segment: { borderDash: function (ctx) { var w = wcovData[ctx.p1DataIndex]; return w != null && w < WCOV_MIN ? [6, 4] : undefined; } } }));
      // Ось GMI фиксирована: 6,2 … 7,5 %. Если значения вдруг выходят за эти границы, ось расширяется, чтобы кривую не обрезало.
      var gv = gmiData.filter(function (v) { return v != null; });
      extraScales.y2 = { position: 'right', min: Math.min(GMI_AXIS_MIN, Math.floor(Math.min.apply(null, gv) * 10) / 10), max: Math.max(GMI_AXIS_MAX, Math.ceil(Math.max.apply(null, gv) * 10) / 10),
        grid: { drawOnChartArea: false }, title: { display: true, text: 'GMI, %' }, ticks: { stepSize: 0.1, autoSkip: false, callback: function (v) { return v.toFixed(1); } } };
    }
    chart('c-glucose', 'line', rd.map(function (r) { return IC.fmtDate(r.t); }), gl, Units.gLabel(), { noZero: true, extra: { plugins: {
      legend: { position: 'top', labels: { filter: function (it, d) { return !d.datasets[it.datasetIndex].zoneLow; } } },
      tooltip: { filter: function (c) { return c.raw != null && !c.dataset.zoneLow; }, callbacks: { label: function (c) {
        if (c.dataset.yAxisID === 'y2') {
          var w = c.dataset.wcov && c.dataset.wcov[c.dataIndex];
          return 'GMI: ' + c.raw.toFixed(2) + '% (' + t('ch.avg90') + ': ' + Units.g(c.dataset.mean[c.dataIndex]) + ' ' + Units.gLabel() +
            (w != null ? '; ' + t('ch.dataIn90') + ': ' + Math.round(w) + '%' + (w < WCOV_MIN ? ' — ' + t('ch.partial') : '') : '') + ')';
        }
        return c.dataset.label + ': ' + c.formattedValue;
      } } } } }, scales: extraScales });
  }

  // ---------------------------------------------------------------- журнал
  var LABEL = { breakfast: 'meal.breakfast', lunch: 'meal.lunch', dinner: 'meal.dinner', corr: 'meal.correction', corrFood: 'meal.correction', snack: 'meal.snack', basal: 'meal.basal', glucose: 'meal.glucose', other: 'meal.correction' };
  function renderLog(period) {
    var rows = period.slice().sort(function (a, b) { return (IC.parseWhen(b) || 0) - (IC.parseWhen(a) || 0); });
    var g = function (v) { v = num(v); return v == null ? '' : Units.g(v); };
    $('#log').innerHTML = '<thead><tr><th>' + t('log.time') + '</th><th>' + t('log.event') + '</th><th>' + t('log.glucose') + '</th><th>' + t('log.carbs') + '</th><th>' + t('log.dose') + '</th><th>' + t('log.g2') + '</th><th>' + t('log.g4') + '</th></tr></thead><tbody>' +
      (rows.length ? rows.map(function (e) {
        var k = Stats.kind(e), xe = Units.xeOf(e);
        return '<tr><td>' + IC.fmtDate(IC.parseWhen(e)) + '</td><td>' + t(LABEL[k]) + (k === 'corrFood' ? ' 🍴' : '') + (e._pending ? ' ⏳' : '') + '</td><td>' + g(e.current_glucose) + '</td><td>' + (xe ? xe.toFixed(1) : '') +
          '</td><td>' + (num(e.selected_dose) != null ? num(e.selected_dose) : '') + '</td><td>' + g(e.glucose_2h) + '</td><td>' + g(e.glucose_4h) + '</td></tr>';
      }).join('') : '<tr><td colspan="7" class="muted">' + t('menu.noRecent') + '</td></tr>') + '</tbody>';
  }

  // ---------------------------------------------------------------- CSV
  function csv() {
    if (!last) return;
    var q = function (v) { v = v == null ? '' : String(v); return /[",;\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var f = function (v, d) { return v == null ? '' : v.toFixed(d); };
    var L = [['Parameter', 'Value', 'Units', 'Events'],
      ['UK (independent)', f(last.ukI.value, 2), 'U/XE', last.ukI.events],
      ['ISF (independent)', f(last.isfI.value, 2), 'mmol/L/U', last.isfI.events],
      ['UK (regression)', last.reg && last.reg.ok ? f(last.reg.uk, 2) : '', 'U/XE', last.reg ? last.reg.n : 0],
      ['ISF (regression)', last.reg && last.reg.ok ? f(last.reg.isf, 2) : '', 'mmol/L/U', last.reg ? last.reg.n : 0],
      ['UK breakfast', f(last.bm.breakfast.value, 2), 'U/XE', last.bm.breakfast.events],
      ['UK lunch', f(last.bm.lunch.value, 2), 'U/XE', last.bm.lunch.events],
      ['UK dinner', f(last.bm.dinner.value, 2), 'U/XE', last.bm.dinner.events],
      ['In target 2h', f(last.m.inTarget, 1), '%', last.m.n],
      ['Miss rate 2h', f(last.m.missRate, 1), '%', last.m.n],
      [], IC.HEADERS];
    last.period.forEach(function (e) { L.push(IC.HEADERS.map(function (h) { return e[h]; })); });
    var text = '﻿' + L.map(function (r) { return r.map(q).join(','); }).join('\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = 'insulincalc_report_' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
  }

  function onReady() {
    Store.events(true).then(function (list) {
      all = list;
      if (Store.current.url) { var o = $('#open-sheet'); o.href = Store.current.url; o.style.display = 'inline-flex'; }
      return loadCgm().then(build);
    }).catch(function (e) { Shell.handleError(e); });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var saved = IC.ls('ic_rep_days'); if (saved) $('#days').value = saved;
    Shell.boot('report', onReady);
    $('#build').onclick = function () { IC.ls('ic_rep_days', $('#days').value); Store.events(true).then(function (l) { all = l; return loadCgm(); }).then(build); };
    $('#days').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('#build').click(); });
    $('#csv').onclick = csv;
    document.querySelectorAll('.tab-btn').forEach(function (b) {
      b.onclick = function () {
        document.querySelectorAll('.tab-btn').forEach(function (x) { x.classList.remove('active'); });
        document.querySelectorAll('.tab').forEach(function (x) { x.style.display = 'none'; });
        b.classList.add('active'); $('#tab-' + b.dataset.tab).style.display = 'block';
      };
    });
  });
})();
