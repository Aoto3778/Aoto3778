'use strict';
/*
 * Dev-only: launches the renderer in Electron and captures screenshots.
 * Not packaged (test/ is excluded from build.files).
 * Run: xvfb-run -a ./node_modules/.bin/electron test/screenshot.js
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.commandLine.appendSwitch('no-sandbox');
app.disableHardwareAcceleration();

const INDEX = path.join(__dirname, '..', 'renderer', 'index.html');
const KEY = 'labTracker.v1';
const now = Date.now();
const HR = 3600000, DAY = 86400000;

function payload(override) {
  return JSON.stringify({
    version: 1,
    settings: { targetHours: 450, startYearOverride: override },
    sessions: [
      // 2025年度 (Apr 2025 – Jan 2026)
      { id: 'p1', checkIn: new Date(2025, 5, 10, 9, 0, 0).getTime(), checkOut: new Date(2025, 5, 10, 17, 0, 0).getTime() },
      { id: 'p2', checkIn: new Date(2025, 10, 5, 10, 0, 0).getTime(), checkOut: new Date(2025, 10, 5, 15, 0, 0).getTime() },
      // 2026年度 (current)
      { id: 'c1', checkIn: new Date(2026, 5, 2, 10, 0, 0).getTime(), checkOut: new Date(2026, 5, 2, 16, 0, 0).getTime() },
      { id: 'c_live', checkIn: now - 90 * 60000, checkOut: null }
    ],
    manualMonths: {
      '2025-05': { hours: 50, days: 15 },
      '2026-04': { hours: 60, days: 18 },
      '2026-05': { hours: 55, days: 16 }
    },
    activeSessionId: 'c_live',
    appStart: now - 30 * DAY
  });
}

function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
async function shoot(win, name) {
  await wait(500);
  fs.writeFileSync(path.join(__dirname, name), (await win.webContents.capturePage()).toPNG());
  console.log('wrote', name);
}
async function seed(win, data) {
  await win.webContents.executeJavaScript('localStorage.setItem(' + JSON.stringify(KEY) + ', ' + JSON.stringify(data) + '); true;');
  await win.loadFile(INDEX);
}

app.whenReady().then(async function () {
  const win = new BrowserWindow({ width: 1000, height: 980, show: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false } });
  await win.loadFile(INDEX);

  await seed(win, payload(null));   // auto → current academic year (2026)
  await shoot(win, 'shot-year-current.png');

  await seed(win, payload(2025));   // review a past academic year
  await shoot(win, 'shot-year-past.png');

  console.log('done');
  setTimeout(function () { process.exit(0); }, 200);
}).catch(function (e) { console.error('ERR', e); setTimeout(function () { process.exit(1); }, 200); });
