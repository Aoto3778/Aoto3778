'use strict';

// The renderer is fully self-contained (plain HTML/CSS/JS + localStorage),
// so this preload only exposes a tiny, read-only bit of host info.
// Kept with contextIsolation:true and nodeIntegration:false for safety.
const { contextBridge } = require('electron');

try {
  contextBridge.exposeInMainWorld('appHost', {
    platform: process.platform,
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome
    }
  });
} catch (_) {
  /* no-op: exposing host info is best-effort and non-critical */
}
