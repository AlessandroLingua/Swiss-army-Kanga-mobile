/* ============================================================
 * Kanga Toolkit — desktop/lib/adb.js
 * Ricerca ed esecuzione di ADB (spawn), parsing dispositivi.
 * Nessuna dipendenza esterna.
 * ============================================================ */

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const IS_WIN = process.platform === 'win32';

class Adb {
  constructor() {
    this.customPath = null;   // impostato da main (persistito)
  }

  /** Cartella per ADB scaricato (scrivibile sia in dev sia pacchettizzato) */
  getDownloadDir() {
    if (process.env.KANGA_ADB_DIR) return process.env.KANGA_ADB_DIR;
    // se l'app è pacchettizzata, scriviamo in userData (main lo passa via env)
    return path.join(__dirname, '..', 'bin', 'platform-tools');
  }

  /** Elenca i percorsi candidati per il binario adb */
  candidatePaths() {
    const exe = IS_WIN ? 'adb.exe' : 'adb';
    const list = [];
    if (this.customPath) list.push(this.customPath);
    if (process.env.ADB_PATH) list.push(process.env.ADB_PATH);
    list.push(path.join(this.getDownloadDir(), exe));
    // lo zip di Google contiene già la cartella platform-tools/
    list.push(path.join(this.getDownloadDir(), 'platform-tools', exe));
    // percorsi comuni
    const home = os.homedir();
    list.push(path.join(home, 'AppData', 'Local', 'Android', 'Sdk', 'platform-tools', 'adb.exe'));
    list.push(path.join(home, 'Library', 'Android', 'sdk', 'platform-tools', 'adb'));
    list.push(path.join(home, 'Android', 'Sdk', 'platform-tools', 'adb'));
    list.push('/usr/lib/android-sdk/platform-tools/adb');
    list.push('/opt/platform-tools/adb');
    if (process.env.PATH) {
      process.env.PATH.split(path.delimiter).forEach((p) => {
        if (p) list.push(path.join(p, exe));
      });
    }
    return list;
  }

  /** Trova un adb eseguibile; resolve con il percorso o null */
  async find() {
    for (const p of this.candidatePaths()) {
      if (await isExecutable(p)) return p;
    }
    return null;
  }

  /** Esegue adb con argomenti; timeout in ms (default 20s) */
  run(args, timeoutMs) {
    return new Promise(async (resolve) => {
      const adbPath = (await this.find()) || 'adb'; // fallback: speriamo nel PATH
      let child;
      try {
        child = spawn(adbPath, args, { windowsHide: true });
      } catch (e) {
        return resolve({ ok: false, stdout: '', stderr: String(e && e.message || e), code: -1 });
      }
      let stdout = '', stderr = '', settled = false;
      const timer = setTimeout(() => {
        if (!settled) { settled = true; try { child.kill(); } catch (e) {} }
      }, timeoutMs || 20000);

      child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
      child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
      child.on('error', (e) => {
        if (settled) return; settled = true; clearTimeout(timer);
        resolve({ ok: false, stdout, stderr: String(e && e.message || e), code: -1 });
      });
      child.on('close', (code) => {
        if (settled && code === null) return; // timeout già gestito
        settled = true; clearTimeout(timer);
        resolve({ ok: code === 0, stdout, stderr, code: code === null ? -1 : code });
      });
      if (timeoutMs && timeoutMs < 0) clearTimeout(timer); // no timeout
    });
  }

  /** Esegue uno script shell sul dispositivo (eventualmente con -s serial) */
  shell(script, serial, timeoutMs) {
    const args = serial ? ['-s', serial, 'shell', script] : ['shell', script];
    return this.run(args, timeoutMs || 20000);
  }

  /** Lista dispositivi: [{serial, state, model}] */
  async devices() {
    const r = await this.run(['devices', '-l'], 10000);
    if (!r.ok && !r.stdout) return { adbReady: false, devices: [], error: r.stderr };
    const devices = [];
    r.stdout.split('\n').forEach((line) => {
      const t = line.trim();
      if (!t || t.startsWith('List of')) return;
      const parts = t.split(/\s+/);
      if (parts.length < 2) return;
      const serial = parts[0];
      const state = parts[1];
      let model = '';
      const m = t.match(/model:([^\s]+)/);
      if (m) model = m[1].replace(/_/g, ' ');
      if (serial && !/^\*$/.test(serial)) devices.push({ serial, state, model });
    });
    return { adbReady: true, devices };
  }
}

function isExecutable(p) {
  return new Promise((resolve) => {
    try {
      fs.access(p, fs.constants.F_OK, (err) => {
        if (err) return resolve(false);
        if (!IS_WIN) {
          fs.access(p, fs.constants.X_OK, (e2) => resolve(!e2));
        } else resolve(true);
      });
    } catch (e) { resolve(false); }
  });
}

module.exports = { Adb, isExecutable };
