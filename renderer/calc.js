/*
 * calc.js — pure calculation & formatting helpers (no DOM, no localStorage).
 * UMD wrapper so the same file works in the browser (window.LabCalc)
 * and in Node (require) for unit tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LabCalc = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MS_PER_HOUR = 3600000;
  var MS_PER_DAY = 86400000;

  // Playful-background thresholds (fixed by spec, independent of target).
  var LOW_THRESHOLD = 350;   // 予想 < 350h  → bg-low
  var HIGH_THRESHOLD = 450;  // 予想 ≥ 450h → bg-high (mid is in between)

  // Prediction tuning: dampen the first ~2 weeks and cap runaway values.
  var PREDICTION_MIN_DAYS = 14;
  var PREDICTION_CAP_FACTOR = 3;

  function pad2(n) { return String(n).padStart(2, '0'); }
  function hoursFromMs(ms) { return ms / MS_PER_HOUR; }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

  function monthKey(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1);
  }
  function dayKey(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  }

  // Academic-year period containing `nowMs`: Apr 1 → Jan 31 (next year).
  function getPeriod(nowMs, settings) {
    settings = settings || {};
    var startYear;
    if (settings.startYearOverride != null && settings.startYearOverride !== '') {
      startYear = Number(settings.startYearOverride);
    } else {
      var d = new Date(nowMs);
      var m = d.getMonth() + 1; // 1..12
      startYear = (m >= 4) ? d.getFullYear() : d.getFullYear() - 1;
    }
    var startMs = new Date(startYear, 3, 1, 0, 0, 0, 0).getTime();          // Apr 1 00:00
    var endMs = new Date(startYear + 1, 0, 31, 23, 59, 59, 999).getTime();  // Jan 31 23:59:59.999
    return { startYear: startYear, startMs: startMs, endMs: endMs };
  }

  // Ordered list of the 10 period months as "YYYY-MM".
  function periodMonths(startYear) {
    var arr = [];
    for (var m = 4; m <= 12; m++) arr.push(startYear + '-' + pad2(m));
    arr.push((startYear + 1) + '-01');
    return arr;
  }

  function monthLabelJp(mk) {
    var parts = mk.split('-');
    return parts[0] + '年' + Number(parts[1]) + '月';
  }

  // Academic year (Apr–Jan) that a "YYYY-MM" month belongs to.
  function academicYearOf(mk) {
    var p = mk.split('-');
    var y = +p[0], m = +p[1];
    return (m >= 4) ? y : y - 1;
  }

  // Academic year containing nowMs (Jan–Mar belong to the prior year's period).
  function currentAcademicYear(nowMs) {
    var d = new Date(nowMs);
    var m = d.getMonth() + 1;
    return (m >= 4) ? d.getFullYear() : d.getFullYear() - 1;
  }

  // Sorted list of academic years that have data, plus the current one.
  function availableYears(state, nowMs) {
    var set = {};
    set[currentAcademicYear(nowMs)] = true;
    (state.sessions || []).forEach(function (s) {
      set[academicYearOf(monthKey(new Date(s.checkIn)))] = true;
    });
    Object.keys(state.manualMonths || {}).forEach(function (k) {
      set[academicYearOf(k)] = true;
    });
    return Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
  }

  function targetHoursOf(state) {
    return num((state.settings && state.settings.targetHours)) || 450;
  }

  // Hours for one session; an open session (checkOut == null) runs live to nowMs.
  function sessionHours(session, nowMs) {
    var end = (session.checkOut != null) ? session.checkOut : nowMs;
    return Math.max(0, end - session.checkIn) / MS_PER_HOUR;
  }

  // A session belongs to the period if its CHECK-IN falls within it.
  function sessionInPeriod(session, period) {
    return session.checkIn >= period.startMs && session.checkIn <= period.endMs;
  }

  function manualOf(state, mk) {
    var e = (state.manualMonths || {})[mk];
    return { hours: num(e && e.hours), days: Math.floor(num(e && e.days)) };
  }

  // (2) Cumulative so far: in-period sessions (live) + manual months in period.
  function cumulativeHours(state, nowMs, period) {
    var total = 0;
    var i;
    for (i = 0; i < state.sessions.length; i++) {
      if (sessionInPeriod(state.sessions[i], period)) {
        total += sessionHours(state.sessions[i], nowMs);
      }
    }
    var monthSet = {};
    periodMonths(period.startYear).forEach(function (mk) { monthSet[mk] = true; });
    var keys = Object.keys(state.manualMonths || {});
    for (i = 0; i < keys.length; i++) {
      if (monthSet[keys[i]]) total += num(state.manualMonths[keys[i]].hours);
    }
    return total;
  }

  function monthAutoHours(state, mk, nowMs, period) {
    var total = 0;
    for (var i = 0; i < state.sessions.length; i++) {
      var s = state.sessions[i];
      if (!sessionInPeriod(s, period)) continue;
      if (monthKey(new Date(s.checkIn)) === mk) total += sessionHours(s, nowMs);
    }
    return total;
  }

  function monthAutoDays(state, mk, period) {
    var set = {};
    var count = 0;
    for (var i = 0; i < state.sessions.length; i++) {
      var s = state.sessions[i];
      if (!sessionInPeriod(s, period)) continue;
      if (monthKey(new Date(s.checkIn)) === mk) {
        var dk = dayKey(new Date(s.checkIn));
        if (!set[dk]) { set[dk] = true; count++; }
      }
    }
    return count;
  }

  // (5) per-month total = auto + manual hours
  function monthTotalHours(state, mk, nowMs, period) {
    return monthAutoHours(state, mk, nowMs, period) + manualOf(state, mk).hours;
  }

  // attended days = distinct auto days + manual days
  function monthAttendedDays(state, mk, nowMs, period) {
    return monthAutoDays(state, mk, period) + manualOf(state, mk).days;
  }

  // (4) per-month average per attended day; null when no attended days.
  function monthAvgPerDay(state, mk, nowMs, period) {
    var days = monthAttendedDays(state, mk, nowMs, period);
    if (days <= 0) return null;
    return monthTotalHours(state, mk, nowMs, period) / days;
  }

  // (3) predicted cumulative by Jan 31 — calendar-based linear extrapolation.
  function prediction(cumHrs, nowMs, period, targetHours) {
    var totalMs = period.endMs - period.startMs;
    var elapsedMs = nowMs - period.startMs;
    if (elapsedMs <= 0) return { value: cumHrs, provisional: false, note: 'before' };
    if (elapsedMs >= totalMs) return { value: cumHrs, provisional: false, note: 'ended' };
    var totalDays = totalMs / MS_PER_DAY;
    var minFrac = PREDICTION_MIN_DAYS / totalDays;
    var frac = elapsedMs / totalMs;
    var effFrac = Math.max(frac, minFrac);
    var raw = cumHrs / effFrac;
    var cap = PREDICTION_CAP_FACTOR * targetHours;
    var provisional = frac < minFrac;
    return { value: Math.min(raw, cap), provisional: provisional, note: provisional ? 'provisional' : null };
  }

  // 残り月数 = current month through January inclusive.
  function remainingMonths(nowMs, period) {
    var months = periodMonths(period.startYear);
    if (nowMs < period.startMs) return months.length;
    if (nowMs > period.endMs) return 0;
    var idx = months.indexOf(monthKey(new Date(nowMs)));
    if (idx === -1) return 0;
    return months.length - idx;
  }

  // (6) required hours per remaining month to hit target.
  function requiredPerMonth(cumHrs, targetHours, nowMs, period) {
    if (cumHrs >= targetHours) return { value: 0, achieved: true, note: null };
    var rem = remainingMonths(nowMs, period);
    if (rem <= 0) return { value: null, achieved: false, note: 'ended' };
    return { value: (targetHours - cumHrs) / rem, achieved: false, note: null };
  }

  function backgroundTier(predValue) {
    if (predValue < LOW_THRESHOLD) return 'low';
    if (predValue < HIGH_THRESHOLD) return 'mid';
    return 'high';
  }

  // (1) today's check-in instant (active session if started today, else earliest today).
  function todayCheckIn(state, nowMs) {
    var today = dayKey(new Date(nowMs));
    var active = state.activeSessionId
      ? state.sessions.find(function (s) { return s.id === state.activeSessionId; })
      : null;
    if (active && dayKey(new Date(active.checkIn)) === today) return active.checkIn;
    var earliest = null;
    for (var i = 0; i < state.sessions.length; i++) {
      var s = state.sessions[i];
      if (dayKey(new Date(s.checkIn)) === today) {
        if (earliest == null || s.checkIn < earliest) earliest = s.checkIn;
      }
    }
    return earliest;
  }

  // ---- formatters (pure) ----
  function fmtHours(h) { return (Math.round(h * 10) / 10).toFixed(1); }

  function fmtClock(ms) { // duration → HH:MM:SS (hours may exceed 24)
    var totalSec = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    return pad2(h) + ':' + pad2(m) + ':' + pad2(s);
  }

  function fmtHM(ms) { var d = new Date(ms); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function fmtMD(ms) { var d = new Date(ms); return (d.getMonth() + 1) + '/' + d.getDate(); }
  function fmtMDHM(ms) { return fmtMD(ms) + ' ' + fmtHM(ms); }

  function toLocalInputValue(ms) {
    var d = new Date(ms);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function fromLocalInputValue(str) {
    if (!str) return NaN;
    var t = new Date(str).getTime();
    return isNaN(t) ? NaN : t;
  }

  return {
    MS_PER_HOUR: MS_PER_HOUR,
    MS_PER_DAY: MS_PER_DAY,
    LOW_THRESHOLD: LOW_THRESHOLD,
    HIGH_THRESHOLD: HIGH_THRESHOLD,
    pad2: pad2,
    num: num,
    hoursFromMs: hoursFromMs,
    monthKey: monthKey,
    dayKey: dayKey,
    getPeriod: getPeriod,
    periodMonths: periodMonths,
    monthLabelJp: monthLabelJp,
    academicYearOf: academicYearOf,
    currentAcademicYear: currentAcademicYear,
    availableYears: availableYears,
    targetHoursOf: targetHoursOf,
    sessionHours: sessionHours,
    sessionInPeriod: sessionInPeriod,
    manualOf: manualOf,
    cumulativeHours: cumulativeHours,
    monthAutoHours: monthAutoHours,
    monthAutoDays: monthAutoDays,
    monthTotalHours: monthTotalHours,
    monthAttendedDays: monthAttendedDays,
    monthAvgPerDay: monthAvgPerDay,
    prediction: prediction,
    remainingMonths: remainingMonths,
    requiredPerMonth: requiredPerMonth,
    backgroundTier: backgroundTier,
    todayCheckIn: todayCheckIn,
    fmtHours: fmtHours,
    fmtClock: fmtClock,
    fmtHM: fmtHM,
    fmtMD: fmtMD,
    fmtMDHM: fmtMDHM,
    toLocalInputValue: toLocalInputValue,
    fromLocalInputValue: fromLocalInputValue
  };
});
