/* ============================================================
 * Kanga Toolkit — desktop/scripts/prepare-build.js
 * Copia la UI condivisa (../core) dentro desktop/core prima della
 * build con electron-builder, così l'installer è autosufficiente.
 * ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

const src = path.join(__dirname, '..', '..', 'core');
const dest = path.join(__dirname, '..', 'core');

if (!fs.existsSync(path.join(src, 'index.html'))) {
  console.error('❌ Cartella core non trovata:', src);
  process.exit(1);
}
copyDir(src, dest);
console.log('✅ core/ copiata in', dest);
