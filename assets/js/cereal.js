/* Углеводы в кашах: расчёт углеводов/ХЕ/БЖУ порции готовой каши или продукта. */
(function () {
  'use strict';

  // ------------------------------------------------------------ чистая математика
  function pos(x) { return typeof x === 'number' && isFinite(x) && x >= 0; }
  // каша: значения на 100 г сухой крупы
  // in: {c,p,f,k, dry, cooked, portion, g}; cooked — вес готовой каши без тары
  function cereal(i) {
    var k = i.dry / 100, share = i.portion / i.cooked;
    var tot = { c: i.c * k, p: (i.p || 0) * k, f: (i.f || 0) * k, k: (i.k || 0) * k };
    var por = { c: tot.c * share, p: tot.p * share, f: tot.f * share, k: tot.k * share };
    var per100 = { c: por.c / i.portion * 100, p: por.p / i.portion * 100, f: por.f / i.portion * 100, k: por.k / i.portion * 100 };
    return { total: tot, portion: por, per100: per100, xe: por.c / i.g, xe100: per100.c / i.g };
  }
  // молочная каша: крупа + молоко + сахар (у сахара углеводы на 100 г; ккал ≈ 4 на 1 г углеводов)
  function milk(i) {
    var a = i.dry / 100, b = i.milk / 100, s = (i.sugar || 0) / 100;
    function sum(key) { return (i.cer[key] || 0) * a + (i.mk[key] || 0) * b + (key === 'c' ? i.sc * s : key === 'k' ? i.sc * s * 4 : 0); }
    var parts = { cer: { c: i.cer.c * a }, mk: { c: i.mk.c * b }, sg: { c: i.sc * s } };
    var tot = { c: sum('c'), p: sum('p'), f: sum('f'), k: sum('k') };
    var share = i.portion / i.cooked;
    var por = { c: tot.c * share, p: tot.p * share, f: tot.f * share, k: tot.k * share };
    var per100 = { c: por.c / i.portion * 100, p: por.p / i.portion * 100, f: por.f / i.portion * 100, k: por.k / i.portion * 100 };
    return { parts: parts, total: tot, portion: por, per100: per100, xe: por.c / i.g, xe100: per100.c / i.g };
  }
  // продукт: значения на 100 г, вес продукта
  function product(i) {
    var f = i.weight / 100;
    var por = { c: i.c * f, p: (i.p || 0) * f, f: (i.f || 0) * f, k: (i.k || 0) * f };
    return { portion: por, xe: por.c / i.g };
  }
  window.Cereal = { cereal: cereal, milk: milk, product: product };

  if (typeof document === 'undefined' || !document.getElementById('view')) return;

  // ------------------------------------------------------------ интерфейс
  var $ = function (s) { return document.querySelector(s); };
  function esc(x) { return String(x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function parse(v) {
    v = String(v == null ? '' : v).trim().replace(/\s+/g, '').replace(',', '.');
    if (!/^\d*\.?\d+$|^\d+\.$/.test(v)) return null;
    var n = parseFloat(v); return isFinite(n) ? n : null;
  }
  function fmt(n, d) {
    if (d == null) d = 1;
    var r = (Math.round(n * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d);
    r = r.replace(/\.?0+$/, function (m) { return m.indexOf('.') < 0 ? m : ''; });
    return I18N.lang === 'ru' ? r.replace('.', ',') : r;
  }
  function G() { return Units.xeG(); }

  var S;  // состояние: {kind, mode, step, v:{}}
  function reset() { S = { kind: null, mode: null, step: 0, v: {} }; }

  function steps() {
    var full = S.mode === 'full', k = S.kind, a = [];
    function macro(prefix, obj, withC) {
      if (full) { a.push({ id: prefix + 'p', q: 'cr.q.p', obj: obj, max: 100 }); a.push({ id: prefix + 'f', q: 'cr.q.f', obj: obj, max: 100 }); }
      a.push({ id: prefix + 'c', q: 'cr.q.c', obj: obj, max: 100 });
      if (full) a.push({ id: prefix + 'k', q: 'cr.q.k', obj: obj, max: 900 });
    }
    if (k === 'product') {
      macro('', 'cr.o.product'); a.push({ id: 'w', q: 'cr.q.pw', max: 5000, gt0: 1 }); return a;
    }
    if (k === 'cereal') {
      macro('', 'cr.o.dry'); a.push({ id: 'dry', q: 'cr.q.dry', max: 5000, gt0: 1 });
    } else {
      macro('', 'cr.o.dry'); macro('m', 'cr.o.milk');
      a.push({ id: 'sc', q: 'cr.q.sc', max: 100 });
      a.push({ id: 'dry', q: 'cr.q.dry', max: 5000, gt0: 1 });
      a.push({ id: 'milk', q: 'cr.q.milkw', max: 10000, gt0: 1 });
      if (S.v.sc !== 0) a.push({ id: 'sugar', q: 'cr.q.sugarw', max: 2000 });
    }
    a.push({ id: 'tare', q: 'cr.q.tare', what: k === 'cereal' ? 'cr.w.cereal' : 'cr.w.milk', max: 20000 });
    a.push({ id: 'gross', q: 'gross', max: 30000, gt0: 1 });
    a.push({ id: 'portion', q: 'cr.q.portion', max: 5000, gt0: 1 });
    return a;
  }

  function title() {
    var f = S.mode === 'full', w = S.res ? S.res.w : '';
    if (S.kind === 'product') return t('cr.r.product', { w: w });
    if (S.kind === 'milk') return t(f ? 'cr.r.milkFull' : 'cr.r.milk', { w: w });
    return t(f ? 'cr.r.cerealFull' : 'cr.r.cereal', { w: w });
  }

  function view(h) { $('#view').innerHTML = h; var i = $('#cr-in'); if (i) i.focus(); }
  function backBtn() { return '<button class="btn ghost" id="cr-back">← ' + t('btn.back') + '</button>'; }

  function home() {
    reset();
    view('<p class="step-q">' + t('cr.chooseType') + '</p>' +
      ['cereal', 'milk', 'product'].map(function (k) { return '<button class="btn secondary block" data-k="' + k + '">' + t('cr.type.' + k) + '</button>'; }).join('') +
      '<button class="btn ghost block" id="cr-help">' + t('cr.help') + '</button>');
    document.querySelectorAll('[data-k]').forEach(function (b) {
      b.onclick = function () { S.kind = b.dataset.k; if (S.kind === 'product') { S.mode = 'full'; ask(); } else modeStep(); };
    });
    $('#cr-help').onclick = function () { Shell.modal('<h2>' + t('cr.help.title') + '</h2>' + t('cr.help.body') + '<button class="btn primary block" onclick="Shell.closeModal()">' + t('cr.ok') + '</button>'); };
  }

  function modeStep() {
    view('<p class="step-q">' + t('cr.mode.' + S.kind) + '</p>' +
      '<button class="btn secondary block" data-m="carbs">' + t('cr.mode.carbs') + '</button>' +
      '<button class="btn secondary block" data-m="full">' + t('cr.mode.full') + '</button>' + backBtn());
    document.querySelectorAll('[data-m]').forEach(function (b) { b.onclick = function () { S.mode = b.dataset.m; S.step = 0; ask(); }; });
    $('#cr-back').onclick = home;
  }

  function cooked() { return S.v.gross - S.v.tare; }
  function hint() {
    var st = steps()[S.step];
    if (st.id !== 'portion') return '';
    var r = compute(true);
    if (!r) return '';
    var tt = r.total;
    return '<p class="step-hint">' + (S.mode === 'full' ? t('cr.hint.totalFull', { p: fmt(tt.p), f: fmt(tt.f), c: fmt(tt.c), k: fmt(tt.k, 0) }) : t('cr.hint.total', { c: fmt(tt.c) })) + '</p>';
  }

  function ask(err) {
    var a = steps(), st = a[S.step];
    var q = st.q === 'gross' ? t(S.v.tare > 0 ? 'cr.q.gross' : 'cr.q.grossNo') : t(st.q, { obj: st.obj ? t(st.obj) : '', what: st.what ? t(st.what) : '' });
    var v = S.v[st.id];
    view('<div class="step"><p class="step-hint">' + t('cr.step', { n: S.step + 1, m: a.length }) + '</p><p class="step-q">' + esc(q) + '</p>' +
      '<input id="cr-in" class="input" type="text" inputmode="decimal" autocomplete="off" value="' + (v == null ? '' : esc(String(v).replace('.', I18N.lang === 'ru' ? ',' : '.'))) + '">' +
      '<div class="err" id="cr-err" style="color:#c62828;font-size:13px;min-height:18px;margin:6px 0">' + (err || '') + '</div>' + hint() +
      '<div class="row" style="display:flex;gap:8px">' + backBtn() + '<button class="btn primary" id="cr-next" style="flex:1">' + t('btn.next') + '</button></div></div>');
    $('#cr-back').onclick = function () { if (S.step === 0) { S.kind === 'product' ? home() : modeStep(); } else { S.step--; ask(); } };
    var go = function () {
      var n = parse($('#cr-in').value);
      if (n == null) return ask(t('cr.err.num'));
      if (st.gt0 ? n <= 0 : n < 0) return ask(st.gt0 ? t('cr.err.pos') : t('cr.err.range', { min: 0, max: st.max }));
      if (n > st.max) return ask(t('cr.err.range', { min: st.gt0 ? '>0' : 0, max: st.max }));
      if (st.id === 'gross' && n <= S.v.tare) return ask(t('cr.err.gross'));
      if (st.id === 'portion' && n > cooked()) return ask(t('cr.err.portion', { w: fmt(cooked()) }));
      S.v[st.id] = n;
      if (S.step + 1 < a.length) { S.step++; ask(); } else result();
    };
    $('#cr-next').onclick = go;
    $('#cr-in').onkeydown = function (e) { if (e.key === 'Enter') go(); };
  }

  function compute(partial) {
    var v = S.v, g = G();
    if (S.kind === 'product') return product({ c: v.c, p: v.p, f: v.f, k: v.k, weight: v.w, g: g });
    if (partial && (v.gross == null || v.tare == null)) return null;
    var base = { dry: v.dry, cooked: partial ? cooked() : cooked(), portion: partial ? cooked() : v.portion, g: g };
    if (S.kind === 'cereal') return cereal({ c: v.c, p: v.p, f: v.f, k: v.k, dry: v.dry, cooked: base.cooked, portion: base.portion, g: g });
    return milk({ cer: { c: v.c, p: v.p, f: v.f, k: v.k }, mk: { c: v.mc, p: v.mp, f: v.mf, k: v.mk }, sc: v.sc, dry: v.dry, milk: v.milk, sugar: v.sugar, cooked: base.cooked, portion: base.portion, g: g });
  }

  function result() {
    var r = compute(), v = S.v, full = S.mode === 'full', g = G(), L = [];
    var por = r.portion;
    S.res = { w: fmt(S.kind === 'product' ? v.w : v.portion, 0) };
    L.push('<b>' + title() + '</b>');
    var sh = S.kind === 'product' ? 1 : v.portion / cooked();
    if (S.kind === 'milk') {
      L.push(t('cr.r.cerealPart', { c: fmt(r.parts.cer.c * sh, 2), x: fmt(r.parts.cer.c * sh / g, 2) }));
      L.push(t('cr.r.milkPart', { c: fmt(r.parts.mk.c * sh, 2), x: fmt(r.parts.mk.c * sh / g, 2) }));
      if (v.sc > 0) L.push(t('cr.r.sugarPart', { c: fmt(r.parts.sg.c * sh, 2), x: fmt(r.parts.sg.c * sh / g, 2) }));
      L.push('<b>' + t('cr.r.total', { c: fmt(por.c, 2), x: fmt(r.xe, 2) }) + '</b>');
    } else {
      L.push(t('cr.r.carbs', { v: fmt(por.c, 2) }));
    }
    if (full) { L.push(t('cr.r.protein', { v: fmt(por.p) })); L.push(t('cr.r.fat', { v: fmt(por.f) })); L.push(t('cr.r.kcal', { v: fmt(por.k, 1) })); }
    if (S.kind !== 'milk') L.push('<b>' + t('cr.r.xe', { v: fmt(r.xe, 2), g: fmt(g) }) + '</b>');
    else L.push(t('cr.r.xe', { v: fmt(r.xe, 2), g: fmt(g) }));
    if (S.kind === 'product') {
      L.push('<span class="muted">' + t('cr.r.per100Prod', { p: fmt(v.p), f: fmt(v.f), c: fmt(v.c), k: fmt(v.k, 1) }) + '</span>');
    } else if (full) {
      L.push('<span class="muted">' + t('cr.r.per100Full', { p: fmt(r.per100.p), f: fmt(r.per100.f), c: fmt(r.per100.c, 2), k: fmt(r.per100.k, 1) }) + '</span>');
    } else {
      L.push('<span class="muted">' + t('cr.r.per100', { c: fmt(r.per100.c, 2), x: fmt(r.xe100, 2) }) + '</span>');
    }
    view('<div id="cr-res" class="note" style="line-height:1.7">' + L.join('<br>') + '</div>' +
      '<button class="btn primary block" id="cr-new">' + t('cr.new') + '</button>' + backBtn());
    $('#cr-new').onclick = home;
    $('#cr-back').onclick = function () { S.step = steps().length - 1; ask(); };
  }

  Shell.bootLight('cereal', function () {
    $('#cr-xe').innerHTML = t('cr.xe', { g: fmt(G()) }) + ' · <a href="#" id="cr-set">' + t('cr.xeChange') + '</a>';
    $('#cr-set').onclick = function (e) { e.preventDefault(); Shell.openSettings(); };
    home();
  });
})();
