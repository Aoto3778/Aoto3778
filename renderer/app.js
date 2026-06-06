/*
 * app.js — UI controller: state (localStorage), rendering, events, live timer.
 * Pure math/formatting lives in calc.js (window.LabCalc).
 */
(function () {
  'use strict';

  var C = window.LabCalc;
  var STORAGE_KEY = 'labTracker.v1';

  // ---------- state ----------
  function genId() {
    return 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  function defaultState() {
    return {
      version: 1,
      settings: { targetHours: 450, startYearOverride: null },
      sessions: [],
      manualMonths: {},
      activeSessionId: null,
      appStart: Date.now()
    };
  }

  function normalizeState(obj) {
    var s = {
      version: 1,
      settings: {
        targetHours: (obj.settings && C.num(obj.settings.targetHours)) || 450,
        startYearOverride: (obj.settings && obj.settings.startYearOverride != null && obj.settings.startYearOverride !== '')
          ? Math.floor(C.num(obj.settings.startYearOverride)) : null
      },
      sessions: Array.isArray(obj.sessions)
        ? obj.sessions
            .filter(function (x) { return x && typeof x.checkIn === 'number'; })
            .map(function (x) {
              return {
                id: String(x.id || genId()),
                checkIn: x.checkIn,
                checkOut: (typeof x.checkOut === 'number') ? x.checkOut : null
              };
            })
        : [],
      manualMonths: {},
      activeSessionId: null,
      appStart: (typeof obj.appStart === 'number') ? obj.appStart : Date.now()
    };
    if (obj.manualMonths && typeof obj.manualMonths === 'object') {
      Object.keys(obj.manualMonths).forEach(function (k) {
        var e = obj.manualMonths[k];
        var h = C.num(e && e.hours);
        var d = Math.floor(C.num(e && e.days));
        if (h > 0 || d > 0) s.manualMonths[k] = { hours: h, days: d };
      });
    }
    // Keep a single active session; close any stray open sessions.
    var open = s.sessions.filter(function (x) { return x.checkOut == null; });
    if (open.length) {
      s.activeSessionId = open[0].id;
      for (var i = 1; i < open.length; i++) open[i].checkOut = open[i].checkIn;
    }
    return s;
  }

  function loadState() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { raw = null; }
    if (!raw) return defaultState();
    try {
      return normalizeState(JSON.parse(raw));
    } catch (e) {
      try { localStorage.setItem(STORAGE_KEY + '.corrupt-' + Date.now(), raw); } catch (_) {}
      alert('保存データの読み込みに失敗したため、新しいデータで開始します（壊れたデータは別キーに保持しています）。');
      return defaultState();
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      alert('データの保存に失敗しました（保存容量の制限の可能性があります）。');
    }
  }

  var state = loadState();
  var tickTimer = null;
  var appliedTier = null;

  // ---------- DOM refs ----------
  function $(id) { return document.getElementById(id); }
  var el = {
    periodLabel: $('period-label'),
    toggleBtn: $('toggle-btn'), toggleLabel: $('toggle-label'), toggleSub: $('toggle-sub'),
    todayCheckin: $('today-checkin'), liveWrap: $('live-wrap'), liveTimer: $('live-timer'),
    cumulative: $('stat-cumulative'), progressBar: $('progress-bar'), progressText: $('stat-progress-text'),
    prediction: $('stat-prediction'), provisionalChip: $('provisional-chip'), predictionFoot: $('stat-prediction-foot'),
    remaining: $('stat-remaining'), remainingFoot: $('stat-remaining-foot'),
    required: $('stat-required'), requiredFoot: $('stat-required-foot'),
    monthTbody: $('month-tbody'),
    records: $('records'),
    setTarget: $('set-target'), setStartYear: $('set-startyear'),
    btnExport: $('btn-export'), btnImport: $('btn-import'), importFile: $('import-file'),
    forgotBanner: $('forgot-banner'), forgotText: $('forgot-text'),
    forgotCheckout: $('forgot-checkout'), forgotEdit: $('forgot-edit'),
    appVersion: $('app-version')
  };

  // ---------- helpers ----------
  function period() { return C.getPeriod(Date.now(), state.settings); }
  function activeSession() {
    if (!state.activeSessionId) return null;
    return state.sessions.find(function (s) { return s.id === state.activeSessionId; }) || null;
  }
  function isoDate(ms) {
    var d = new Date(ms);
    return d.getFullYear() + '-' + C.pad2(d.getMonth() + 1) + '-' + C.pad2(d.getDate());
  }
  function escapeAttr(v) { return String(v).replace(/"/g, '&quot;'); }

  function applyBackground(tier) {
    if (tier === appliedTier) return;
    appliedTier = tier;
    document.body.classList.remove('bg-low', 'bg-mid', 'bg-high');
    document.body.classList.add('bg-' + tier);
  }

  // ---------- rendering ----------
  function updateToggle() {
    var active = activeSession();
    if (active) {
      el.toggleBtn.classList.add('on');
      el.toggleLabel.textContent = '退勤';
      el.toggleSub.textContent = '押して退勤';
    } else {
      el.toggleBtn.classList.remove('on');
      el.toggleLabel.textContent = '出勤';
      el.toggleSub.textContent = '押して開始';
    }
  }

  function updateSummary() {
    var now = Date.now();
    var p = period();
    var target = C.targetHoursOf(state);
    var cum = C.cumulativeHours(state, now, p);

    el.cumulative.textContent = C.fmtHours(cum);
    var pct = Math.max(0, Math.min(100, target > 0 ? cum / target * 100 : 0));
    el.progressBar.style.width = pct + '%';
    el.progressText.textContent = '達成率 ' + (Math.round(pct * 10) / 10) + '%（目標 ' + target + '時間）';

    el.remaining.textContent = C.fmtHours(Math.max(0, target - cum));
    el.remainingFoot.textContent = (cum >= target) ? '目標達成！🎉' : '/ 目標 ' + target + '時間';

    var pred = C.prediction(cum, now, p, target);
    el.prediction.textContent = C.fmtHours(pred.value);
    el.provisionalChip.classList.toggle('hidden', !pred.provisional);
    el.predictionFoot.textContent =
      pred.note === 'before' ? '期間開始前' :
      pred.note === 'ended' ? '期間終了（=累計）' : '現在ペースで延長';

    var req = C.requiredPerMonth(cum, target, now, p);
    var rem = C.remainingMonths(now, p);
    if (req.achieved) {
      el.required.textContent = '0.0';
      el.requiredFoot.textContent = '目標達成！🎉';
    } else if (req.value == null) {
      el.required.textContent = '—';
      el.requiredFoot.textContent = '期間終了';
    } else {
      el.required.textContent = C.fmtHours(req.value);
      el.requiredFoot.textContent = '残り ' + rem + ' ヶ月';
    }

    var tci = C.todayCheckIn(state, now);
    el.todayCheckin.textContent = (tci != null) ? C.fmtHM(tci) : '—';

    applyBackground(C.backgroundTier(pred.value));

    var active = activeSession();
    if (active) {
      el.liveWrap.classList.remove('hidden');
      el.liveTimer.textContent = C.fmtClock(now - active.checkIn);
    } else {
      el.liveWrap.classList.add('hidden');
    }
  }

  function updateLiveCells() {
    var now = Date.now();
    var p = period();
    C.periodMonths(p.startYear).forEach(function (mk) {
      var tot = $('mtot-' + mk);
      if (!tot) return;
      tot.textContent = C.fmtHours(C.monthTotalHours(state, mk, now, p));
      $('mday-' + mk).textContent = String(C.monthAttendedDays(state, mk, now, p));
      var avg = C.monthAvgPerDay(state, mk, now, p);
      $('mavg-' + mk).textContent = (avg == null) ? '—' : C.fmtHours(avg);
    });
    var ad = $('active-dur');
    if (ad) { var a = activeSession(); if (a) ad.textContent = C.fmtClock(now - a.checkIn); }
  }

  function buildMonthTable() {
    var now = Date.now();
    var p = period();
    var curMk = C.monthKey(new Date(now));
    var html = '';
    C.periodMonths(p.startYear).forEach(function (mk) {
      var manual = C.manualOf(state, mk);
      var isCur = (mk === curMk);
      html +=
        '<tr class="' + (isCur ? 'current' : '') + '">' +
          '<td class="mlabel">' + C.monthLabelJp(mk) + (isCur ? ' <span class="now-tag">今月</span>' : '') + '</td>' +
          '<td id="mtot-' + mk + '" class="num"></td>' +
          '<td id="mday-' + mk + '" class="num"></td>' +
          '<td id="mavg-' + mk + '" class="num"></td>' +
          '<td class="manual">' +
            '<input type="number" min="0" step="0.5" class="m-hours" data-mk="' + mk + '" value="' + (manual.hours ? manual.hours : '') + '" placeholder="0" />' +
            '<span class="sep">/</span>' +
            '<input type="number" min="0" step="1" class="m-days" data-mk="' + mk + '" value="' + (manual.days ? manual.days : '') + '" placeholder="0" />' +
          '</td>' +
        '</tr>';
    });
    el.monthTbody.innerHTML = html;
    el.monthTbody.querySelectorAll('.m-hours, .m-days').forEach(function (inp) {
      inp.addEventListener('change', onManualChange);
    });
    updateLiveCells();
  }

  function onManualChange(e) {
    var mk = e.target.getAttribute('data-mk');
    var hoursInp = el.monthTbody.querySelector('.m-hours[data-mk="' + mk + '"]');
    var daysInp = el.monthTbody.querySelector('.m-days[data-mk="' + mk + '"]');
    var hours = Math.max(0, C.num(hoursInp.value));
    var days = Math.max(0, Math.floor(C.num(daysInp.value)));
    if (hours <= 0 && days <= 0) delete state.manualMonths[mk];
    else state.manualMonths[mk] = { hours: hours, days: days };
    saveState();
    updateSummary();
    updateLiveCells();
  }

  function buildRecords() {
    var sessions = state.sessions.slice().sort(function (a, b) { return b.checkIn - a.checkIn; });
    if (sessions.length === 0) {
      el.records.innerHTML = '<div class="empty">まだ記録がありません。中央のボタンで出勤を記録しましょう。</div>';
      return;
    }
    var now = Date.now();
    var html = '';
    sessions.forEach(function (s) {
      var active = (s.checkOut == null);
      var dur = active
        ? '<span id="active-dur" class="dur live">' + C.fmtClock(now - s.checkIn) + '</span>'
        : '<span class="dur">' + C.fmtHours(C.sessionHours(s, now)) + 'h</span>';
      html +=
        '<div class="rec ' + (active ? 'active' : '') + '" data-id="' + escapeAttr(s.id) + '">' +
          '<div class="rec-main">' +
            '<span class="rec-in">' + C.fmtMDHM(s.checkIn) + '</span>' +
            '<span class="arrow">→</span>' +
            '<span class="rec-out">' + (active ? '<em>記録中</em>' : C.fmtMDHM(s.checkOut)) + '</span>' +
            dur +
          '</div>' +
          '<div class="rec-actions">' +
            (active ? '<button class="btn tiny" data-act="checkout" data-id="' + escapeAttr(s.id) + '">退勤</button>' : '') +
            '<button class="btn tiny ghost" data-act="edit" data-id="' + escapeAttr(s.id) + '">編集</button>' +
            '<button class="btn tiny danger" data-act="del" data-id="' + escapeAttr(s.id) + '">削除</button>' +
          '</div>' +
        '</div>';
    });
    el.records.innerHTML = html;
    el.records.querySelectorAll('button[data-act]').forEach(function (b) {
      b.addEventListener('click', onRecordAction);
    });
  }

  function onRecordAction(e) {
    var act = e.target.getAttribute('data-act');
    var id = e.target.getAttribute('data-id');
    if (act === 'del') deleteSession(id);
    else if (act === 'checkout') checkoutSession(id);
    else if (act === 'edit') openEdit(id);
  }

  function deleteSession(id) {
    if (!window.confirm('この記録を削除しますか？')) return;
    state.sessions = state.sessions.filter(function (s) { return s.id !== id; });
    if (state.activeSessionId === id) state.activeSessionId = null;
    saveState();
    fullRender();
    ensureTick();
  }

  function checkoutSession(id) {
    var s = state.sessions.find(function (x) { return x.id === id; });
    if (!s) return;
    s.checkOut = Date.now();
    if (state.activeSessionId === id) state.activeSessionId = null;
    saveState();
    fullRender();
    ensureTick();
  }

  function openEdit(id) {
    var s = state.sessions.find(function (x) { return x.id === id; });
    if (!s) return;
    var rec = el.records.querySelector('.rec[data-id="' + escapeAttr(id) + '"]');
    if (!rec) return;
    var inVal = C.toLocalInputValue(s.checkIn);
    var outVal = (s.checkOut != null) ? C.toLocalInputValue(s.checkOut) : '';
    rec.innerHTML =
      '<div class="rec-edit">' +
        '<label>出勤 <input type="datetime-local" class="e-in" value="' + inVal + '"></label>' +
        '<label>退勤 <input type="datetime-local" class="e-out" value="' + outVal + '"></label>' +
        '<div class="edit-actions">' +
          '<button class="btn tiny" data-act="save">保存</button>' +
          '<button class="btn tiny ghost" data-act="cancel">キャンセル</button>' +
        '</div>' +
        '<div class="edit-err hidden"></div>' +
      '</div>';
    rec.querySelector('[data-act="save"]').addEventListener('click', function () { saveEdit(id, rec); });
    rec.querySelector('[data-act="cancel"]').addEventListener('click', function () { buildRecords(); });
  }

  function saveEdit(id, rec) {
    var s = state.sessions.find(function (x) { return x.id === id; });
    if (!s) return;
    var errEl = rec.querySelector('.edit-err');
    function showErr(msg) { errEl.textContent = msg; errEl.classList.remove('hidden'); }

    var ci = C.fromLocalInputValue(rec.querySelector('.e-in').value);
    if (isNaN(ci)) { showErr('出勤時刻を入力してください。'); return; }
    var outStr = rec.querySelector('.e-out').value;
    var co = null;
    if (outStr) {
      co = C.fromLocalInputValue(outStr);
      if (isNaN(co)) { showErr('退勤時刻が不正です。'); return; }
      if (co < ci) { showErr('退勤は出勤より後にしてください。'); return; }
    }
    if (co == null && state.activeSessionId && state.activeSessionId !== id) {
      showErr('他に記録中の記録があります。先にそちらを退勤してください。');
      return;
    }
    s.checkIn = ci;
    s.checkOut = co;
    if (co == null) state.activeSessionId = id;
    else if (state.activeSessionId === id) state.activeSessionId = null;
    saveState();
    fullRender();
    ensureTick();
  }

  function checkForgotBanner() {
    var a = activeSession();
    var now = Date.now();
    if (a && C.dayKey(new Date(a.checkIn)) !== C.dayKey(new Date(now))) {
      el.forgotText.textContent = '前回の退勤が記録されていません（出勤: ' + C.fmtMDHM(a.checkIn) + '）。';
      el.forgotBanner.classList.remove('hidden');
      el.forgotCheckout.onclick = function () { checkoutSession(a.id); };
      el.forgotEdit.onclick = function () {
        openEdit(a.id);
        el.records.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
    } else {
      el.forgotBanner.classList.add('hidden');
    }
  }

  function fullRender() {
    var p = period();
    el.periodLabel.textContent = '期間: ' + isoDate(p.startMs) + ' 〜 ' + isoDate(p.endMs);
    el.setTarget.value = C.targetHoursOf(state);
    el.setStartYear.value = (state.settings.startYearOverride != null) ? state.settings.startYearOverride : '';
    updateToggle();
    buildMonthTable();
    buildRecords();
    updateSummary();
    checkForgotBanner();
  }

  // ---------- live tick ----------
  function tick() { updateSummary(); updateLiveCells(); }
  function ensureTick() {
    var active = !!activeSession();
    if (active && !tickTimer) tickTimer = setInterval(tick, 1000);
    else if (!active && tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  }

  // ---------- export / import ----------
  function exportData() {
    var data = JSON.stringify(state, null, 2);
    var blob = new Blob([data], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var d = new Date();
    a.href = url;
    a.download = 'lab-tracker-backup-' + d.getFullYear() + C.pad2(d.getMonth() + 1) + C.pad2(d.getDate()) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function importData(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var obj = JSON.parse(reader.result);
        if (!obj || typeof obj !== 'object' || !Array.isArray(obj.sessions)) {
          throw new Error('形式が不正です');
        }
        state = normalizeState(obj);
        saveState();
        fullRender();
        ensureTick();
        alert('インポートが完了しました。');
      } catch (err) {
        alert('インポートに失敗しました: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  // ---------- events ----------
  el.toggleBtn.addEventListener('click', function () {
    var a = activeSession();
    var now = Date.now();
    if (a) {
      a.checkOut = now;
      state.activeSessionId = null;
    } else {
      var s = { id: genId(), checkIn: now, checkOut: null };
      state.sessions.push(s);
      state.activeSessionId = s.id;
      if (!state.appStart) state.appStart = now;
    }
    saveState();
    fullRender();
    ensureTick();
  });

  el.setTarget.addEventListener('change', function () {
    var v = Math.max(1, Math.floor(C.num(el.setTarget.value)) || 450);
    state.settings.targetHours = v;
    el.setTarget.value = v;
    saveState();
    fullRender();
  });

  el.setStartYear.addEventListener('change', function () {
    var raw = el.setStartYear.value.trim();
    state.settings.startYearOverride = (raw === '') ? null : Math.floor(C.num(raw));
    saveState();
    fullRender();
  });

  el.btnExport.addEventListener('click', exportData);
  el.btnImport.addEventListener('click', function () { el.importFile.click(); });
  el.importFile.addEventListener('change', function (e) {
    if (e.target.files && e.target.files[0]) {
      importData(e.target.files[0]);
      e.target.value = '';
    }
  });

  if (window.appHost && window.appHost.versions) {
    el.appVersion.textContent = 'Electron ' + window.appHost.versions.electron;
  }

  // ---------- boot ----------
  fullRender();
  ensureTick();
})();
