/* InsulinCalc — страница отчётов (все расчёты в браузере по данным из Google Таблицы) */
(function () {
  'use strict';
  var $ = IC.$, esc = IC.esc, num = IC.num;
  var all = [], charts = {}, last = null;
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

  function build() {
    var days = Math.max(1, Math.min(365, parseInt($('#days').value, 10) || 14));
    var from = Date.now() - days * DAY;
    var period = all.filter(function (e) { var w = IC.parseWhen(e); return w && w.getTime() >= from; });
    var regrSet = $('#regr').value === 'all' ? all : period;

    // --- 1. независимые
    var isfI = Stats.isfIndependent(period);
    var ukI = Stats.ukIndependent(period, isfI.value);
    var curIsf = num(Settings.get('isf'));
    $('#k-indep').innerHTML =
      kcard(t('rep.uk'), ukTxt(ukI.value), '<div class="muted">' + ukGrams(ukI.value) + '</div>' + confHtml(ukI.events)) +
      kcard(t('rep.isf'), isfTxt(isfI.value), confHtml(isfI.events) + curUsing(curIsf ? isfTxt(curIsf) : ''), true);

    // --- 3. регрессия
    var rows = Stats.rowsOf(regrSet);
    var reg = rows.length >= 4 ? Stats.regressJoint(rows) : null;
    var regOk = reg && reg.ok;
    var pLabel = $('#regr').value === 'all' ? t('rep.regrAll') : days + ' ' + (I18N.lang === 'ru' ? 'дн.' : 'days');
    var regMeta = '<div>' + t('rep.method') + ': ' + pLabel + '</div><div>' + t('rep.r2') + ': ' + (reg && reg.r2 != null ? reg.r2.toFixed(3) : '—') + '</div><div>' + t('rep.events') + ': ' + rows.length + '</div>' +
      (!regOk && rows.length ? '<div class="muted">' + t('rep.noData') + '</div>' : '');
    $('#k-regr').innerHTML = kcard(t('rep.uk') + ' — ' + t('tab.regression').toLowerCase(), regOk ? ukTxt(reg.uk) : '—', (regOk ? '<div class="muted">' + ukGrams(reg.uk) + '</div>' : '') + regMeta) +
      kcard(t('rep.isf') + ' — ' + t('tab.regression').toLowerCase(), regOk ? isfTxt(reg.isf) : '—', regMeta, true);

    // --- 2. по приёмам пищи
    var isfRef = isfI.value || (regOk ? reg.isf : null);
    var bm = Stats.byMeal(regrSet, isfRef);
    $('#k-meals').innerHTML = ['breakfast', 'lunch', 'dinner'].map(function (m) {
      var r = bm[m], icon = { breakfast: '🌅', lunch: '☀️', dinner: '🌙' }[m], cur = num(Settings.get('uc_' + m));
      return '<div class="kcard"><h4>' + icon + ' ' + t('meal.' + m) + '</h4>' +
        '<div class="small muted">' + t('rep.uk') + '</div><div class="kval">' + ukTxt(r.value) + '</div><div class="kmeta"><div class="muted">' + ukGrams(r.value) + '</div>' + confHtml(r.events) +
        (r.method ? '<div>' + t('rep.method') + ': ' + (r.method === 'regression' ? t('tab.regression') + (r.r2 != null ? ' (R² ' + r.r2.toFixed(2) + ')' : '') : (I18N.lang === 'ru' ? 'медиана событий' : 'median of events')) + '</div>' : '') +
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
    return Object.assign({ label: label, data: data, borderColor: color, backgroundColor: color + '22', tension: 0.3, fill: true, pointRadius: 3 }, extra || {});
  }
  function lbl(day) { var p = day.split('-'); return p[2] + '.' + p[1]; }

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
    chart('c-weight', 'line', labels, [ds(t('ch.weightKg'), daily.map(function (d) { return d.weight; }), '#34a853', { pointRadius: 5 })], t('common.kg'), { noZero: true });
    chart('c-food', 'bar', labels, [
      ds(t('ch.bolus'), daily.map(function (d) { return d.any ? r1(d.bolus) : null; }), '#1a73e8', { backgroundColor: '#1a73e8bb' }),
      ds(t('ch.basal'), daily.map(function (d) { return d.any ? r1(d.basal) : null; }), '#ff9800', { backgroundColor: '#ff9800bb' }),
      ds(t('ch.xe'), daily.map(function (d) { return d.any ? r1(d.xe) : null; }), '#34a853', { type: 'line', fill: false, yAxisID: 'y' })
    ], u + ' / ' + t('common.xe'));
    var rd = Stats.readings(period);
    var tg = num(Settings.get('target')), rg = num(Settings.get('range')) || 2;
    var gl = [ds(t('ch.glucoseL') + ' (' + Units.gLabel() + ')', rd.map(function (r) { return Units.toDisp(r.v); }), '#7b1fa2', { fill: false, tension: 0.2 })];
    if (tg) {
      gl.push(ds('+' + rg, rd.map(function () { return Units.toDisp(tg + rg); }), '#34a853', { fill: false, borderDash: [6, 4], pointRadius: 0, borderWidth: 1 }));
      gl.push(ds('−' + rg, rd.map(function () { return Units.toDisp(Math.max(0, tg - rg)); }), '#34a853', { fill: false, borderDash: [6, 4], pointRadius: 0, borderWidth: 1 }));
    }
    // GMI по дням: для каждого дня — средняя всех замеров таблицы за 90 дней до конца этого дня
    // (не только за выбранный период). Одна точка на день, на последнем замере дня; ось справа, %.
    var allRd = Stats.readings(all), dayEnd = {}, lastIdx = {};
    rd.forEach(function (r, i) {
      var d = new Date(r.t); d.setHours(23, 59, 59, 999);
      var k = d.getTime(); dayEnd[i] = d; lastIdx[k] = i;
    });
    var idxs = Object.keys(lastIdx).map(function (k) { return lastIdx[k]; }).sort(function (x, y) { return x - y; });
    var means = Stats.rollingMean(allRd, idxs.map(function (i) { return dayEnd[i]; }), 90);
    var gmiData = rd.map(function () { return null; }), meanData = rd.map(function () { return null; }), lastG = null;
    idxs.forEach(function (i, j) { if (means[j] != null) { meanData[i] = means[j]; gmiData[i] = Math.round(Stats.gmi(means[j]) * 100) / 100; lastG = gmiData[i]; } });
    var extraScales = {};
    if (lastG != null) {
      gl.push(ds(t('ch.gmi') + ' · ' + lastG.toFixed(1) + '%', gmiData, '#0d1b5e',
        { fill: false, tension: 0.35, pointRadius: 3, pointBackgroundColor: '#0d1b5e', borderWidth: 3, yAxisID: 'y2', spanGaps: true, mean: meanData, order: -1 }));
      extraScales.y2 = { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'GMI, %' }, ticks: { callback: function (v) { return v.toFixed(2); } } };
    }
    chart('c-glucose', 'line', rd.map(function (r) { return IC.fmtDate(r.t); }), gl, Units.gLabel(), { noZero: true, extra: { plugins: {
      legend: { position: 'top' },
      tooltip: { filter: function (c) { return c.raw != null; }, callbacks: { label: function (c) {
        if (c.dataset.yAxisID === 'y2') return 'GMI: ' + c.raw.toFixed(2) + '% (' + t('ch.avg90') + ': ' + Units.g(c.dataset.mean[c.dataIndex]) + ' ' + Units.gLabel() + ')';
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
      build();
    }).catch(function (e) { Shell.handleError(e); });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var saved = IC.ls('ic_rep_days'); if (saved) $('#days').value = saved;
    Shell.boot('report', onReady);
    $('#build').onclick = function () { IC.ls('ic_rep_days', $('#days').value); Store.events(true).then(function (l) { all = l; build(); }); };
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
