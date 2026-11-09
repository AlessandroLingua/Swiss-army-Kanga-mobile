/* ============================================================
 * Kanga Toolkit — desktop/scripts/fetch-adb.js
 * Scarica i platform-tools ufficiali di Google (solo adb/fastboot)
 * nella cartella di destinazione. Zero dipendenze: usa gli strumenti
 * di estrazione nativi del sistema operativo.
 *
 * Uso CLI:  node scripts/fetch-adb.js [destinazione]
 * Uso lib:  require('./scripts/fetch-adb').downloadPlatformTools(dest)
 * ============================================================ */

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const URLS = {
  win32: 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip',
  darwin: 'https://dl.google.com/android/repository/platform-tools-latest-darwin.zip',
  linux: 'https://dl.google.com/android/repository/platform-tools-latest-linux.zip'
};

function download(url, dest, redirects) {
  redirects = redirects || 0;
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('troppi redirect'));
    const req = https.get(url, { headers: { 'User-Agent': 'kanga-toolkit' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(download(res.headers.location, dest, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode + ' per ' + url));
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(dest)));
      file.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(new Error('timeout download')); });
  });
}

function unzip(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  if (process.platform === 'win32') {
    // PowerShell è sempre disponibile su Windows 10+
    execFileSync('powershell.exe', [
      '-NoProfile', '-Command',
      `Expand-Archive -LiteralPath "${zipPath}" -DestinationPath "${destDir}" -Force`
    ], { stdio: 'ignore' });
  } else {
    // unzip è presente su macOS e sulla quasi totalità delle distribuzioni Linux
    execFileSync('unzip', ['-o', zipPath, '-d', destDir], { stdio: 'ignore' });
  }
}

async function downloadPlatformTools(destDir) {
  const url = URLS[process.platform];
  if (!url) return { ok: false, error: 'piattaforma non supportata: ' + process.platform };

  const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';
  const tmpZip = path.join(os.tmpdir(), 'kanga-platform-tools.zip');

  try {
    fs.mkdirSync(destDir, { recursive: true });
    await download(url, tmpZip);
    unzip(tmpZip, destDir);
    fs.unlinkSync(tmpZip);
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }

  const adbPath = path.join(destDir, 'platform-tools', exe);
  if (!fs.existsSync(adbPath)) {
    return { ok: false, error: 'archivio scaricato ma adb non trovato in ' + adbPath };
  }
  try { fs.chmodSync(adbPath, 0o755); } catch (e) {}
  return { ok: true, path: destDir, adbPath };
}

module.exports = { downloadPlatformTools };

/* ---------- CLI ---------- ---------- */
if (require.main === module) {
  const dest = process.argv[2] || path.join(__dirname, '..', 'bin', 'platform-tools');
  console.log('⬇️  Download platform-tools da dl.google.com…');
  downloadPlatformTools(dest).then((r) => {
    if (r.ok) console.log('✅ ADB pronto in:', r.adbPath);
    else { console.error('❌', r.error); process.exit(1); }
  });
}
