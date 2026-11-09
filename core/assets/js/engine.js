/* ============================================================
 * Kanga Toolkit — engine.js
 * Livello comandi: sceglie il motore disponibile.
 *   desktop → Electron IPC → ADB (telefono collegato via USB)
 *   native  → bridge Kotlin (app Android)
 *   web     → API del browser (funzionalità ridotte)
 * ============================================================ */

window.Kanga = window.Kanga || { version: '1.0.0' };

Kanga.engine = (function () {
  'use strict';

  var mode =
    (window.kangaDesktop && window.kangaDesktop.invoke) ? 'desktop' :
    (window.KangaNative && window.KangaNative.run) ? 'native' :
    'web';

  /* ---------- stato ---------- */
  var state = {
    mode: mode,
    devices: [],        // desktop: [{serial, model, state}]
    currentSerial: null,
    deviceInfo: null,   // native: info dal bridge
    adbReady: false
  };

  var listeners = [];
  function emit() { listeners.forEach(function (fn) { try { fn(state); } catch (e) { /* ignore */ } }); }
  function onChange(fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (x) { return x !== fn; }); }; }

  /* ---------- desktop: IPC verso Electron ---------- */
  function invoke(cmd, payload) {
    if (mode !== 'desktop') return Promise.reject(new Error('Solo in modalità desktop'));
    return window.kangaDesktop.invoke(cmd, payload || {});
  }

  /**
   * Esegue uno script shell sul telefono (via ADB). Solo modalità desktop.
   * @param {string} script es. "dumpsys battery"
   * @returns {Promise<{ok:boolean, stdout:string, stderr:string}>}
   */
  function shell(script) {
    return invoke('shell', { script: script, serial: state.currentSerial }).then(function (r) {
      if (r && r.ok) state.adbReady = true;
      return r || { ok: false, stdout: '', stderr: 'nessuna risposta' };
    }).catch(function (err) {
      return { ok: false, stdout: '', stderr: String(err && err.message || err) };
    });
  }

  /* ---------- native: bridge Kotlin ---------- */
  var cbSeq = 0;
  var cbMap = {};

  /** Callback richiamata da Kotlin con il risultato. */
  window.__kangaNativeResult = function (cbId, ok, json) {
    var entry = cbMap[cbId];
    if (!entry) return;
    delete cbMap[cbId];
    var data;
    try { data = JSON.parse(json); } catch (e) { data = { error: 'risposta non valida' }; }
    if (ok) entry.resolve(data);
    else entry.reject(new Error(data && data.error || 'errore bridge'));
  };

  /**
   * Chiama un handler nativo (app Android). Solo modalità native.
   * @param {string} cmd nome comando (es. "battery")
   * @param {object} payload argomenti opzionali
   */
  function native(cmd, payload) {
    if (mode !== 'native') return Promise.reject(new Error('Solo in modalità app Android'));
    return new Promise(function (resolve, reject) {
      var id = 'cb' + (++cbSeq);
      cbMap[id] = { resolve: resolve, reject: reject };
      try {
        window.KangaNative.run(cmd, JSON.stringify(payload || {}), id);
      } catch (e) {
        delete cbMap[id];
        reject(e);
      }
      // safety timeout 30s
      setTimeout(function () {
        if (cbMap[id]) { delete cbMap[id]; reject(new Error('timeout bridge: ' + cmd)); }
      }, 30000);
    });
  }

  /* ---------- web: API browser ---------- */
  function webBattery() {
    if (navigator.getBattery) {
      return navigator.getBattery().then(function (b) {
        return {
          level: Math.round(b.level * 100),
          charging: b.charging,
          chargingTime: (b.chargingTime === Infinity || !isFinite(b.chargingTime)) ? null : b.chargingTime,
          dischargingTime: (b.dischargingTime === Infinity || !isFinite(b.dischargingTime)) ? null : b.dischargingTime,
          partial: true // il browser non espone salute/cicli
        };
      }).catch(function () { return null; });
    }
    return Promise.resolve(null);
  }

  function webStorage() {
    if (navigator.storage && navigator.storage.estimate) {
      return navigator.storage.estimate().then(function (e) {
        return { usage: e.usage || 0, quota: e.quota || 0, partial: true };
      }).catch(function () { return null; });
    }
    return Promise.resolve(null);
  }

  function webNet() {
    var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
    return {
      online: navigator.onLine,
      effectiveType: c ? c.effectiveType : null,
      downlink: c && typeof c.downlink === 'number' ? c.downlink : null,   // Mbps stimati
      rtt: c && typeof c.rtt === 'number' ? c.rtt : null
    };
  }

  /* ---------- inizializzazione per modalità ---------- */

  function initDesktop() {
    return invoke('devices').then(function (r) {
      state.devices = (r && r.devices) || [];
      state.adbReady = !!(r && r.adbReady);
      var first = state.devices.filter(function (d) { return d.state === 'device'; })[0];
      if (first) state.currentSerial = first.serial;
      emit();
      return state;
    }).catch(function (e) {
      state.adbReady = false;
      state.adbError = String(e && e.message || e);
      emit();
      return state;
    });
  }

  function initNative() {
    return native('deviceInfo').then(function (info) {
      state.deviceInfo = info;
      emit();
      return state;
    }).catch(function () { emit(); return state; });
  }

  function initWeb() {
    state.deviceInfo = {
      model: 'Browser',
      platform: navigator.platform || 'web',
      userAgent: navigator.userAgent
    };
    emit();
    return Promise.resolve(state);
  }

  function init() {
    if (mode === 'desktop') {
      if (window.kangaDesktop.onDevices) {
        window.kangaDesktop.onDevices(function (list) {
          state.devices = list || [];
          if (!state.currentSerial) {
            var first = state.devices.filter(function (d) { return d.state === 'device'; })[0];
            if (first) state.currentSerial = first.serial;
          } else {
            var still = state.devices.some(function (d) { return d.serial === state.currentSerial && d.state === 'device'; });
            if (!still) {
              var alt = state.devices.filter(function (d) { return d.state === 'device'; })[0];
              state.currentSerial = alt ? alt.serial : null;
            }
          }
          emit();
        });
      }
      return initDesktop();
    }
    if (mode === 'native') return initNative();
    return initWeb();
  }

  /* ---------- scheda dispositivo (home) ---------- */
  function fmtUptime(sec) {
    sec = Number(sec) || 0;
    var d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    return (d ? d + 'g ' : '') + (d || h ? h + 'h ' : '') + m + 'm';
  }

  function deviceInfo() {
    var P = Kanga.parsers;
    if (mode === 'desktop') {
      return Promise.all([
        shell('echo "manufacturer=$(getprop ro.product.manufacturer)"; echo "model=$(getprop ro.product.model) $(getprop ro.product.marketname)"; echo "release=$(getprop ro.build.version.release)"; echo "sdk=$(getprop ro.build.version.sdk)"; echo "patch=$(getprop ro.build.version.security_patch)"; echo "soc=$(getprop ro.soc.model)$(getprop ro.board.platform)"; echo "crypto=$(getprop ro.crypto.state)/$(getprop ro.crypto.type)"; echo "uptime=$(cat /proc/uptime)"'),
        shell('cat /proc/meminfo | head -n 3'),
        shell('df -h /data | tail -n 1')
      ]).then(function (r) {
        var v = {};
        (r[0].stdout || '').split(/\r?\n/).forEach(function (l) { var m = l.match(/^(\w+)=(.*)$/); if (m) v[m[1]] = m[2]; });
        var mem = P.meminfo(r[1].stdout || '');
        var dfRow = P.df(r[2].stdout || '')[0] || {};
        var kv = [
          ['Modello', ((v.manufacturer || '') + ' ' + (v.model || '')).trim() || '—'],
          ['Android', (v.release || '—') + ' (API ' + (v.sdk || '?') + ')'],
          ['Patch di sicurezza', v.patch || '—'],
          ['SoC', v.soc || '—'],
          ['RAM', mem.totalKb ? P.kbHuman(mem.totalKb) + ' · libera ' + P.kbHuman(mem.availKb || mem.freeKb) : '—'],
          ['Memoria', dfRow.size ? dfRow.used + ' usati su ' + dfRow.size + ' (' + dfRow.usePct + ')' : '—'],
          ['Acceso da', fmtUptime(v.uptime)],
          ['Crittografia', v.crypto || '—', true],
          ['Numero build', v.sdk ? (v.release + '.' + v.sdk) : '—', true]
        ];
        return { kv: kv };
      });
    }
    if (mode === 'native') {
      return Promise.all([native('deviceInfo'), native('memory'), native('storage')]).then(function (r) {
        var d = r[0], m = r[1], s = r[2];
        var kv = [
          ['Modello', ((d.manufacturer || '') + ' ' + (d.model || '')).trim()],
          ['Android', (d.release || '—') + ' (API ' + (d.sdk || '?') + ')'],
          ['Patch di sicurezza', d.securityPatch || '—'],
          ['Schermo', d.widthPx + '×' + d.heightPx + (d.refreshHz ? ' @ ' + Math.round(d.refreshHz) + ' Hz' : '')],
          ['RAM', P.human(m.totalMem) + ' · libera ' + P.human(m.availMem)],
          ['Memoria', P.human(s.totalBytes - s.availBytes) + ' usati su ' + P.human(s.totalBytes)],
          ['Acceso da', fmtUptime((d.uptimeMs || 0) / 1000)],
          ['Densità', d.densityDpi ? d.densityDpi + ' dpi' : '—', true]
        ];
        return { kv: kv };
      });
    }
    return Promise.resolve({
      kv: [
        ['Browser', navigator.userAgent.slice(0, 60)],
        ['Piattaforma', navigator.platform || '—'],
        ['Schermo', screen.width + '×' + screen.height],
        ['RAM (indicata)', navigator.deviceMemory ? navigator.deviceMemory + ' GB' : '—'],
        ['Lingua', navigator.language || '—']
      ]
    });
  }

  /* ---------- API pubbliche ---------- */
  return {
    mode: mode,
    state: state,
    init: init,
    onChange: onChange,
    shell: shell,
    native: native,
    invoke: invoke,
    deviceInfo: deviceInfo,
    selectDevice: function (serial) { state.currentSerial = serial; emit(); },
    webBattery: webBattery,
    webStorage: webStorage,
    webNet: webNet,
    /** true se c'è un telefono pronto (desktop) o siamo sull'app (native) */
    hasDevice: function () {
      if (mode === 'native') return true;
      if (mode === 'desktop') return state.devices.some(function (d) { return d.state === 'device' && d.serial === state.currentSerial; });
      return false;
    },
    /** Descrizione cordiale della modalità corrente */
    modeLabel: function () {
      return { desktop: 'Desktop + ADB', native: 'App Android', web: 'Browser (limitata)' }[mode];
    }
  };
})();
