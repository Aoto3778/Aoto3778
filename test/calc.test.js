'use strict';

// Pure-logic sanity tests for renderer/calc.js — run with: npm test
const C = require('../renderer/calc.js');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.error('  ✗ ' + name); }
}
function near(a, b, eps) { return Math.abs(a - b) <= (eps == null ? 0.05 : eps); }

const period = C.getPeriod(new Date(2026, 5, 6, 12, 0, 0).getTime(), {}); // 2026-06-06

console.log('getPeriod / periodMonths');
ok('startYear is 2026', period.startYear === 2026);
ok('starts Apr 1 2026', new Date(period.startMs).getMonth() === 3 && new Date(period.startMs).getDate() === 1);
ok('ends Jan 31 2027', new Date(period.endMs).getFullYear() === 2027 && new Date(period.endMs).getMonth() === 0 && new Date(period.endMs).getDate() === 31);
const months = C.periodMonths(2026);
ok('10 period months', months.length === 10);
ok('first month 2026-04', months[0] === '2026-04');
ok('last month 2027-01', months[9] === '2027-01');

console.log('Feb falls into prior academic year');
const febPeriod = C.getPeriod(new Date(2027, 1, 15, 12, 0, 0).getTime(), {});
ok('Feb 2027 → startYear 2026', febPeriod.startYear === 2026);

console.log('remainingMonths');
const juneMs = new Date(2026, 5, 6, 12, 0, 0).getTime();
ok('June 2026 → 8 remaining (Jun..Jan)', C.remainingMonths(juneMs, period) === 8);
ok('after period end → 0', C.remainingMonths(period.endMs + 1000, period) === 0);
ok('before period start → 10', C.remainingMonths(period.startMs - 1000, period) === 10);

console.log('prediction (calendar extrapolation)');
const totalMs = period.endMs - period.startMs;
const at30 = period.startMs + Math.round(totalMs * 0.30);
const p30 = C.prediction(135, at30, period, 450);
ok('135h at 30% elapsed → ~450h', near(p30.value, 450, 1));
ok('30% elapsed is not provisional', p30.provisional === false);
const pBefore = C.prediction(10, period.startMs - 1000, period, 450);
ok('before period → value = cumulative, note before', pBefore.value === 10 && pBefore.note === 'before');
const pEnded = C.prediction(420, period.endMs + 1000, period, 450);
ok('after period → value = cumulative, note ended', pEnded.value === 420 && pEnded.note === 'ended');
const pEarly = C.prediction(5, period.startMs + C.MS_PER_DAY, period, 450); // day 1
ok('day-1 prediction is flagged provisional', pEarly.provisional === true);
ok('day-1 prediction is capped (<= 3x target)', pEarly.value <= 450 * 3 + 0.001);

console.log('requiredPerMonth');
const r0 = C.requiredPerMonth(0, 450, juneMs, period);
ok('0h in June → 450/8 = 56.25', near(r0.value, 56.25) && r0.achieved === false);
const rDone = C.requiredPerMonth(460, 450, juneMs, period);
ok('>= target → achieved, 0', rDone.achieved === true && rDone.value === 0);

console.log('backgroundTier (350 / 450 thresholds)');
ok('300 → low', C.backgroundTier(300) === 'low');
ok('349.9 → low', C.backgroundTier(349.9) === 'low');
ok('350 → mid', C.backgroundTier(350) === 'mid');
ok('449.9 → mid', C.backgroundTier(449.9) === 'mid');
ok('450 → high', C.backgroundTier(450) === 'high');
ok('600 → high', C.backgroundTier(600) === 'high');

console.log('aggregation (sessions + manual)');
const ci = new Date(2026, 5, 10, 9, 0, 0).getTime();
const co = ci + 2 * C.MS_PER_HOUR; // 2h
const ci2 = new Date(2026, 5, 12, 13, 0, 0).getTime();
const co2 = ci2 + 4 * C.MS_PER_HOUR; // 4h, different day
const state = {
  version: 1,
  settings: { targetHours: 450, startYearOverride: null },
  sessions: [
    { id: 's1', checkIn: ci, checkOut: co },
    { id: 's2', checkIn: ci2, checkOut: co2 }
  ],
  manualMonths: { '2026-04': { hours: 40, days: 10 }, '2026-06': { hours: 4, days: 2 } },
  activeSessionId: null,
  appStart: ci
};
const now = new Date(2026, 5, 20, 12, 0, 0).getTime();
ok('cumulative = 2+4 (auto) + 40+4 (manual) = 50', near(C.cumulativeHours(state, now, period), 50));
ok('June auto hours = 6', near(C.monthAutoHours(state, '2026-06', now, period), 6));
ok('June auto days = 2', C.monthAutoDays(state, '2026-06', period) === 2);
ok('June total = 6 + 4 manual = 10', near(C.monthTotalHours(state, '2026-06', now, period), 10));
ok('June attended days = 2 + 2 manual = 4', C.monthAttendedDays(state, '2026-06', now, period) === 4);
ok('June avg/day = 10 / 4 = 2.5', near(C.monthAvgPerDay(state, '2026-06', now, period), 2.5));
ok('April (manual only) avg = 40 / 10 = 4', near(C.monthAvgPerDay(state, '2026-04', now, period), 4));
ok('empty month avg → null', C.monthAvgPerDay(state, '2026-09', now, period) === null);

console.log('live active session contributes to cumulative');
const liveState = {
  version: 1, settings: { targetHours: 450 },
  sessions: [{ id: 'a', checkIn: now - 3 * C.MS_PER_HOUR, checkOut: null }],
  manualMonths: {}, activeSessionId: 'a', appStart: now
};
ok('open session ~3h counts live', near(C.cumulativeHours(liveState, now, period), 3, 0.01));
ok('todayCheckIn returns the active session start', C.todayCheckIn(liveState, now) === now - 3 * C.MS_PER_HOUR);

console.log('academic-year helpers (multi-year)');
ok('academicYearOf 2026-05 = 2026', C.academicYearOf('2026-05') === 2026);
ok('academicYearOf 2027-01 = 2026 (Jan belongs to prior period)', C.academicYearOf('2027-01') === 2026);
ok('currentAcademicYear Jun 2026 = 2026', C.currentAcademicYear(new Date(2026, 5, 6).getTime()) === 2026);
ok('currentAcademicYear Feb 2027 = 2026', C.currentAcademicYear(new Date(2027, 1, 15).getTime()) === 2026);
ok('availableYears includes the data year 2026', C.availableYears(state, juneMs).indexOf(2026) !== -1);
// next April auto-rolls: same state, viewed in Apr 2027, current year becomes 2027 and excludes old data
var nextYearPeriod = C.getPeriod(new Date(2027, 3, 2, 12, 0, 0).getTime(), {});
ok('Apr 2027 → period startYear 2027', nextYearPeriod.startYear === 2027);
ok('2026 data excluded from 2027 period cumulative', C.cumulativeHours(state, new Date(2027, 3, 2).getTime(), nextYearPeriod) === 0);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
