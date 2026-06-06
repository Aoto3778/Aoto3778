'use strict';
/*
 * Dev-only: launches the renderer in Electron and captures screenshots
 * in a few states. Not packaged (test/ is excluded from build.files).
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

function sample(manualMonths, sessions, activeId) {
  return JSON.stringify({
    version: 1,
    settings: { targetHours: 450, startYearOverride: null },
    sessions: sessions,
    manualMonths: manualMonths,
    activeSessionId: activeId || null,
    appStart: now - 10 * DAY
  });
}

const midData = sample(
  { '2026-04': { hours: 40, days: 12 }, '2026-05': { hours: 42, days: 14 } },
  [{ id: 's_a', checkIn: now - 4 * DAY + 9 * HR, checkOut: now - 4 * DAY + 12 * HR }]
);
const highData = sample(
  { '2026-04': { hours: 60, days: 18 }, '2026-05': { hours: 70, days: 20 } },
  [
    { id: 's_x', checkIn: now - 4 * DAY + 10 * HR, checkOut: now - 4 * DAY + 15 * HR },
    { id: 's_y', checkIn: now - 2 * DAY + 13 * HR, checkOut: now - 2 * DAY + 19 * HR },
    { id: 's_live', checkIn: now - 2 * HR - 12 * 60000, checkOut: null }
  ],
  's_live'
);

function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function shoot(win, name) {
  await wait(500);
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, name), img.toPNG());
  console.log('wrote', name);
}

async function seedAndReload(win, data) {
  await win.webContents.executeJavaScript(
    'localStorage.setItem(' + JSON.stringify(KEY) + ', ' + JSON.stringify(data) + '); true;'
  );
  await win.loadFile(INDEX);
}

app.whenReady().then(async function () {
  const win = new BrowserWindow({
    width: 1000, height: 920, show: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });

  await win.loadFile(INDEX);                 // page must be loaded before touching localStorage
  await win.webContents.executeJavaScript('localStorage.clear(); true;');
  await win.loadFile(INDEX);
  await shoot(win, 'shot-1-empty.png');

  await seedAndReload(win, midData);
  await shoot(win, 'shot-2-mid.png');

  await seedAndReload(win, highData);
  await shoot(win, 'shot-3-high.png');
  await win.webContents.executeJavaScript('window.scrollTo(0, document.body.scrollHeight); true;');
  await shoot(win, 'shot-4-high-bottom.png');

  console.log('done');
  setTimeout(function () { process.exit(0); }, 200);
}).catch(function (e) { console.error('ERR', e); setTimeout(function () { process.exit(1); }, 200); });
