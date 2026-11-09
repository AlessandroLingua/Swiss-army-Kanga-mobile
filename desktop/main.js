/* ============================================================
 * Kanga Toolkit — desktop/main.js
 * Processo principale Electron: finestra, IPC, motore ADB,
 * mini-server HTTP per i test hardware sul telefono.
 * ============================================================ */

'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

const { Adb } = require('./lib/adb');
const { downloadPlatformTools } = require('./scripts/fetch-adb');

let win = null;
const adb = new Adb();
let pollTimer = null;
let hwServer = null;
let hwPort = 0;

/* ---------- percorso della UI condivisa (core) ---------- */
function coreDir() {
  const inPkg = path.join(__dirname, 'core');        // pacchettizzato (prepare-build)
  if (fs.existsSync(path.join(inPkg, 'index.html'))) return inPkg;
  return path.join(__dirname, '..', 'core');          // sviluppo
}

/* ---------- impostazioni persistite ---------- */
const settingsFile = () => path.join(app.getPath('userData'), 'kanga-settings.json');
function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch (e) { return {}; }
}
function writeSettings(s) {
  try { fs.mkdirSync(path.dirname(settingsFile()), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2)); } catch (e) {}
}

/* ---------- finestra ---------- */
function createWindow() {
  win = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 940,
    minHeight: 640,
    backgroundColor: '#0d1117',
    autoHideMenuBar: true,
    title: 'Kanga Toolkit',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });
  win.loadFile(path.join(coreDir(), 'index.html'));

  // link esterni nel browser di sistema
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('closed', () => { win = null; });
  startPolling();
}

/* ---------- polling dispositivi (ogni 2,5s) ---------- */
function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (!win || win.isDestroyed()) return;
    try {
      const r = await adb.devices();
      if (win && !win.isDestroyed()) win.webContents.send('kanga:devices', r.devices || []);
    } catch (e) { /* silenzioso */ }
  }, 2500);
}

/* ---------- mini server HTTP per i test sul telefono ---------- */
function ensureHwServer() {
  return new Promise((resolve, reject) => {
    if (hwServer) return resolve(hwPort);
    const dir = coreDir();
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
    hwServer = http.createServer((req, res) => {
      let p = req.url.split('?')[0].split('#')[0];
      if (p === '/') p = '/index.html';
      const file = path.join(dir, path.normalize(p).replace(/^([/\\])+/, ''));
      if (!file.startsWith(dir)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, {
          'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store'
        });
        res.end(data);
      });
    });
    hwServer.on('error', reject);
    hwServer.listen(0, '127.0.0.1', () => {
      hwPort = hwServer.address().port;
      resolve(hwPort);
    });
  });
}

/* ---------- IPC ---------- */
ipcMain.handle('kanga:cmd', async (event, msg) => {
  const cmd = msg && msg.cmd;

  try {
    if (cmd === 'devices') {
      const r = await adb.devices();
      return { adbReady: r.adbReady, devices: r.devices || [], error: r.error || null };
    }

    if (cmd === 'shell') {
      const script = String(msg.script || '');
      if (!/^[\x20-\x7E\r\n]*$/.test(script)) return { ok: false, stdout: '', stderr: 'script non valido' };
      // timeout più lungo per ping / du / dexopt / cronologia batteria
      const long = /ping|du |dumpsys batterystats|package compile|bg-dexopt-job/.test(script);
      return await adb.shell(script, msg.serial || null, long ? 30000 : 20000);
    }

    if (cmd === 'getSettings') {
      const s = readSettings();
      adb.customPath = s.adbPath || null;
      return { adbPath: await adb.find() };
    }

    if (cmd === 'pickAdb') {
      const r = await dialog.showOpenDialog(win, {
        title: 'Scegli il binario adb',
        properties: ['openFile'],
        filters: [{ name: 'adb', extensions: [process.platform === 'win32' ? 'exe' : '*'] }]
      });
      if (r.canceled || !r.filePaths.length) return { picked: false };
      const s = readSettings();
      s.adbPath = r.filePaths[0];
      writeSettings(s);
      adb.customPath = s.adbPath;
      return { picked: true, path: s.adbPath };
    }

    if (cmd === 'fetchAdb') {
      const dest = adb.getDownloadDir();
      const r = await downloadPlatformTools(dest);
      if (r.ok) {
        const s = readSettings();
        s.adbPath = r.adbPath;
        writeSettings(s);
        adb.customPath = r.adbPath;
      }
      return r;
    }

    if (cmd === 'adbControl') {
      if (msg.action === 'kill') return await adb.run(['kill-server'], 15000);
      await adb.run(['kill-server'], 15000).catch(() => {});
      return await adb.run(['start-server'], 15000);
    }

    if (cmd === 'openHwTest') {
      const dev = await adb.devices();
      const first = (dev.devices || []).filter((d) => d.state === 'device')[0];
      if (!first) return { ok: false, error: 'nessun telefono collegato/autorizzato' };
      const port = await ensureHwServer();
      const rev = await adb.run(['-s', first.serial, 'reverse', `tcp:${port}`, `tcp:${port}`], 10000);
      if (!rev.ok) return { ok: false, error: 'adb reverse non riuscito: ' + (rev.stderr || rev.stdout || '') };
      const open = await adb.run(['-s', first.serial, 'shell',
        `am start -a android.intent.action.VIEW -d "http://127.0.0.1:${port}/#hwtest"`], 15000);
      if (!open.ok) return { ok: false, error: 'apertura Chrome non riuscita: ' + (open.stderr || '') };
      return { ok: true, url: `http://127.0.0.1:${port}/#hwtest` };
    }

    return { error: 'comando sconosciuto: ' + cmd };
  } catch (e) {
    return { error: String(e && e.message || e) };
  }
});

/* ---------- ciclo di vita ---------- */
app.whenReady().then(() => {
  // se pacchettizzata, ADB va scaricato in userData (l'asar non è scrivibile)
  if (app.isPackaged && !process.env.KANGA_ADB_DIR) {
    process.env.KANGA_ADB_DIR = path.join(app.getPath('userData'), 'platform-tools');
  }
  const s = readSettings();
  adb.customPath = s.adbPath || null;
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (pollTimer) clearInterval(pollTimer);
  if (hwServer) hwServer.close();
  if (process.platform !== 'darwin') app.quit();
});
