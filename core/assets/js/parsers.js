/* ============================================================
 * Kanga Toolkit — parsers.js
 * Parser per l'output dei comandi Android (dumpsys, getprop,
 * df, du, meminfo…). Usati principalmente in modalità desktop.
 * ============================================================ */

window.Kanga = window.Kanga || {};

Kanga.parsers = (function () {
  'use strict';

  var HEALTH_MAP = {
    1: 'Sconosciuto', 2: 'Buona', 3: 'Surriscaldata', 4: 'Guasta',
    5: 'Sovratensione', 6: 'Guasto elettrico', 7: 'Troppo fredda'
  };
  var STATUS_MAP = {
    1: 'Sconosciuto', 2: 'In carica', 3: 'In scarica', 4: 'Non in carica', 5: 'Carica completa'
  };

  /** dumpsys battery → oggetto {level, health, status, temperature, voltage, chargeCounter, technology, powered} */
  function battery(text) {
    var out = {};
    (text || '').split('\n').forEach(function (line) {
      var m = line.match(/^\s*([A-Za-z ]+?):\s*(.+)$/);
      if (!m) return;
      var k = m[1].trim(), v = m[2].trim();
      if (k === 'level') out.level = parseInt(v, 10);
      else if (k === 'health') { out.health = parseInt(v, 10); out.healthLabel = HEALTH_MAP[out.health] || v; }
      else if (k === 'status') { out.status = parseInt(v, 10); out.statusLabel = STATUS_MAP[out.status] || v; }
      else if (k === 'temperature') out.temperature = parseInt(v, 10) / 10;   // decimi di °C
      else if (k === 'voltage') out.voltageMv = parseInt(v, 10);
      else if (k === 'Charge counter') out.chargeCounter = parseInt(v, 10);   // µAh
      else if (k === 'technology') out.technology = v;
      else if (/powered/i.test(k) && v === 'true') out.powered = (out.powered || []) , out.powered.push(k.replace('powered','').trim());
    });
    return out;
  }

  /**
   * Output dello script sysfs della batteria:
   *   charge_full=…  charge_full_design=…  cycle_count=…  temp=…  present=…
   */
  function batterySysfs(text) {
    var out = {};
    (text || '').split('\n').forEach(function (line) {
      var m = line.match(/^\s*(\w+)=(.*)$/);
      if (!m) return;
      var v = m[2].trim();
      if (v === '' || v.indexOf('No such') >= 0) return;
      if (m[1] === 'charge_full') out.chargeFull = parseInt(v, 10);         // µAh
      else if (m[1] === 'charge_full_design') out.chargeFullDesign = parseInt(v, 10);
      else if (m[1] === 'cycle_count') out.cycleCount = parseInt(v, 10);
      else if (m[1] === 'temp') out.tempRaw = parseFloat(v);                 // spesso °C, a volte decimi
    });
    return out;
  }

  /** df -h → [{fs, size, used, avail, usePct, mount}] */
  function df(text) {
    var rows = [];
    (text || '').split('\n').forEach(function (line) {
      var m = line.match(/^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/);
      if (!m) return;
      if (/^Filesystem$/i.test(m[1])) return;
      rows.push({ fs: m[1], size: m[2], used: m[3], avail: m[4], usePct: m[5], mount: m[6].trim() });
    });
    return rows;
  }

  /** du -k -d 1 | sort -rn → [{kb, path}] */
  function du(text) {
    var rows = [];
    (text || '').split('\n').forEach(function (line) {
      var m = line.match(/^(\d+)\s+(\/.*)$/);
      if (m) rows.push({ kb: parseInt(m[1], 10), path: m[2].trim() });
    });
    return rows;
  }

  /** /proc/meminfo head → {totalKb, freeKb, availKb} */
  function meminfo(text) {
    var out = {};
    (text || '').split('\n').forEach(function (line) {
      var m = line.match(/^(MemTotal|MemFree|MemAvailable):\s+(\d+)/);
      if (!m) return;
      if (m[1] === 'MemTotal') out.totalKb = parseInt(m[2], 10);
      if (m[1] === 'MemFree') out.freeKb = parseInt(m[2], 10);
      if (m[1] === 'MemAvailable') out.availKb = parseInt(m[2], 10);
    });
    return out;
  }

  /** dumpsys wifi (estratto grep) → {enabled, ssid, rssi, linkSpeed} */
  function wifi(text) {
    var out = {};
    (text || '').split('\n').forEach(function (line) {
      var l = line.toLowerCase();
      if (/wi-fi is enabled/.test(l)) out.enabled = true;
      if (/wi-fi is disabled/.test(l)) out.enabled = false;
      var m = line.match(/SSID:\s*([^,]+)/i) || line.match(/mWifiInfo.*SSID[=:]([^,]+)/i);
      if (m && m[1] && m[1] !== '<unknown ssid>' && !out.ssid) out.ssid = m[1].trim().replace(/^"|"$/g, '');
      m = line.match(/rssi[=:]\s*(-?\d+)/i); if (m && out.rssi === undefined) out.rssi = parseInt(m[1], 10);
      m = line.match(/link\s*speed[=:]\s*(\d+)/i); if (m && out.linkSpeed === undefined) out.linkSpeed = parseInt(m[1], 10);
    });
    return out;
  }

  /** dumpsys telephony.registry (estratto) → {level, networkType} (level 0–4) */
  function telephony(text) {
    var out = {};
    (text || '').split('\n').forEach(function (line) {
      var m = line.match(/mSignalStrength=\s*SignalStrength:\s*(\d+)/i);
      if (m && out.raw === undefined) out.raw = parseInt(m[1], 10);
      m = line.match(/level=(\d+)/i); if (m && out.level === undefined) out.level = parseInt(m[1], 10);
      m = line.match(/mServiceState=\s*\d+\s*.*?(home|roaming|out of service|off)/i);
      if (m && !out.service) out.service = m[1];
    });
    return out;
  }

  /** ping output → {sent, recv, loss, avgMs} */
  function ping(text) {
    var out = { sent: 0, recv: 0, loss: 100, avgMs: null };
    var m = (text || '').match(/(\d+) packets transmitted,\s*(\d+) (?:received|received,)/);
    if (m) {
      out.sent = parseInt(m[1], 10);
      out.recv = parseInt(m[2], 10);
      out.loss = out.sent ? Math.round((out.sent - out.recv) * 100 / out.sent) : 100;
    }
    m = (text || '').match(/(?:rtt|round-trip)[^=]*=\s*[\d.]+\/([\d.]+)/i);
    if (m) out.avgMs = parseFloat(m[1]);
    return out;
  }

  /** dumpsys thermalservice (estratto) → righe utili */
  function thermal(text) {
    var lines = [];
    (text || '').split('\n').forEach(function (line) {
      if (/throttl|status|temperature|severity|isStatus/i.test(line) && line.trim().length < 200) {
        var t = line.trim();
        if (t && lines.indexOf(t) < 0 && lines.length < 12) lines.push(t);
      }
    });
    return lines;
  }

  /** getprop multipli (una proprietà per riga: "nome valore") → {nome: valore} */
  function props(text) {
    var out = {};
    (text || '').split('\n').forEach(function (line) {
      var m = line.match(/^\[([^\]]+)\]:\s*\[(.*)\]/);
      if (m) out[m[1]] = m[2];
      else {
        // formato "nome valore" usato dal nostro script combinato
        m = line.match(/^(\S+)\s+(\S.*)$/);
        if (m) out[m[1]] = m[2];
      }
    });
    return out;
  }

  /** sensor service header → elenco sensori [{name, vendor, status}] */
  function sensors(text) {
    var list = [];
    (text || '').split('\n').forEach(function (line) {
      var m = line.match(/^\s*\d+-(\d+)\s+(.+?)\s*\|+(.*)$/);
      if (m && list.length < 40) list.push({ handle: m[1], name: m[2].trim(), rest: m[3].trim() });
    });
    return list;
  }

  /** top -n 1 (toybox) → prime righe processi */
  function topProcs(text) {
    var rows = [];
    (text || '').split('\n').forEach(function (line) {
      if (rows.length >= 12) return;
      if (/^\s*PID/.test(line)) { rows.push({ header: line.trim() }); return; }
      var m = line.match(/^\s*(\d+)\s+(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/);
      if (m) rows.push({ pid: m[1], user: m[2], cpu: m[5], s: m[7], name: m[9].trim(), raw: line.trim() });
    });
    return rows;
  }

  /* ---------- utilità formato ---------- */
  function human(bytes) {
    if (bytes === null || bytes === undefined || isNaN(bytes)) return '—';
    var u = ['B', 'KB', 'MB', 'GB', 'TB'], i = 0, v = bytes;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return (i === 0 ? v : v.toFixed(1)) + ' ' + u[i];
  }
  function pct(n) { return (n === null || n === undefined || isNaN(n)) ? '—' : Math.round(n) + '%'; }
  function kbHuman(kb) { return human(kb * 1024); }

  return {
    battery: battery,
    batterySysfs: batterySysfs,
    df: df,
    du: du,
    meminfo: meminfo,
    wifi: wifi,
    telephony: telephony,
    ping: ping,
    thermal: thermal,
    props: props,
    sensors: sensors,
    topProcs: topProcs,
    human: human,
    kbHuman: kbHuman,
    pct: pct,
    HEALTH_MAP: HEALTH_MAP
  };
})();
