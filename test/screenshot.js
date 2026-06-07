'use strict';
/*
 * Dev-only: captures clean screenshots for the user manual.
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

const working = JSON.stringify({
  version: 1,
  settings: { targetHours: 450, startYearOverride: null },
  sessions: [
    { id: 'a', checkIn: new Date(2026, 5, 2, 9, 30, 0).getTime(), checkOut: new Date(2026, 5, 2, 15, 30, 0).getTime() },
    { id: 'b', checkIn: new Date(2026, 5, 4, 10, 0, 0).getTime(), checkOut: new Date(2026, 5, 4, 14, 0, 0).getTime() },
    { id: 'live', checkIn: now - 47 * 60000, checkOut: null }
  ],
  manualMonths: { '2026-04': { hours: 40, days: 12 }, '2026-05': { hours: 38, days: 12 } },
  activeSessionId: 'live',
  appStart: now - 20 * DAY
});

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
  const win = new BrowserWindow({ width: 1000, height: 900, show: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false } });
  await win.loadFile(INDEX);
  await win.webContents.executeJavaScript('localStorage.clear(); true;');
  await win.loadFile(INDEX);
  await shoot(win, 'manual-first.png');     // first run (empty)

  await seed(win, working);
  await shoot(win, 'manual-working.png');    // typical use, checked in
  console.log('done');
  setTimeout(function () { process.exit(0); }, 200);
}).catch(function (e) { console.error('ERR', e); setTimeout(function () { process.exit(1); }, 200); });
