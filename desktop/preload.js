/* ============================================================
 * Kanga Toolkit — desktop/preload.js
 * Ponte sicuro renderer ↔ main (contextIsolation attivo).
 * ============================================================ */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kangaDesktop', {
  /** invoca un comando nel processo principale */
  invoke: (cmd, payload) => ipcRenderer.invoke('kanga:cmd', Object.assign({ cmd }, payload || {})),
  /** notifiche periodiche della lista dispositivi */
  onDevices: (cb) => ipcRenderer.on('kanga:devices', (_e, list) => cb(list))
});
