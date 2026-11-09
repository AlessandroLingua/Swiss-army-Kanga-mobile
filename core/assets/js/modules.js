/* ============================================================
 * Kanga Toolkit — modules.js
 * I 7 moduli diagnostici. Ogni modulo implementa run() per le
 * modalità disponibili e restituisce:
 *   { score: 0-100 | null, status, summary, findings[], actions[], kv[], rows, raw }
 * ============================================================ */

window.Kanga = window.Kanga || {};

(function () {
  'use strict';

  var E = null;      // Kanga.engine (inject dopo il load)
  var P = Kanga.parsers;

  /* ---------- helper comuni ---------- */
  function sh(script) {
    return E.shell(script).then(function (r) { return r.ok ? (r.stdout || '') : ''; });
  }
  function needDevice() {
    if (E.mode === 'web') return 'In modalità browser non è possibile leggere questi dati dal telefono. Apri questa pagina nell’app Android o collega il telefono con l’app desktop.';
    if (E.mode === 'desktop' && !E.hasDevice()) return 'Nessun telefono collegato. Collega il telefono via USB con il debug USB attivo, poi riprova.';
    return null;
  }
  function f(level, text, expert) { return { level: level, text: text, expert: !!expert }; }
  function ok(text) { return f('ok', text); }
  function info(text) { return f('info', text); }
  function warn(text) { return f('warn', text); }
  function bad(text) { return f('bad', text); }

  function statusFromScore(score) {
    if (score === null || score === undefined) return 'info';
    if (score >= 80) return 'ok';
    if (score >= 55) return 'warn';
    return 'bad';
  }

  /** mini benchmark CPU/JS (indicativo): millisecondi per 30M iterazioni */
  function benchCPU() {
    var t0 = performance.now();
    var x = 0;
    for (var i = 0; i < 30000000; i++) { x += Math.sqrt(i % 997) * 0.5; }
    var ms = performance.now() - t0;
    if (x === -1) console.log('impossibile'); // evita dead-code elimination
    return ms;
  }

  /* Stima (modificabile) degli anni di patch per produttore */
  var OEM_PATCH_YEARS = {
    google: 7, samsung: 5, xiaomi: 4, redmi: 4, pocophone: 4,
    oppo: 4, oneplus: 4, realme: 3, motorola: 3, sony: 3, 'hmd global': 3,
    honor: 4, huawei: 3, asus: 3, vivo: 3, tecno: 2
  };
  var SDK_NAMES = {
    26: 'Android 8.0', 27: 'Android 8.1', 28: 'Android 9', 29: 'Android 10',
    30: 'Android 11', 31: 'Android 12', 32: 'Android 12L', 33: 'Android 13',
    34: 'Android 14', 35: 'Android 15', 36: 'Android 16'
  };

  function monthsSince(y, m, d) {
    if (!y) return null;
    var then = new Date(y, (m || 1) - 1, d || 1);
    var now = new Date();
    return Math.max(0, (now.getFullYear() - then.getFullYear()) * 12 + (now.getMonth() - then.getMonth()));
  }

  /* ---------- Laboratorio Batteria: helper ---------- */

  /** Capacità di progetto (mAh) per modello — estendibile; override manuale in localStorage */
  function designCapacity(modelStr) {
    try {
      var m = parseInt(localStorage.getItem('kanga.batlab.design'), 10);
      if (m > 500) return m;
    } catch (e) { /* niente override */ }
    if (!modelStr) return null;
    var s = String(modelStr).toLowerCase();
    var db = [
      [/(21121210g|ingres|poco f4 gt)/, 4700],
      [/(alioth|poco f3|mi 11x)/, 4520],
      [/(marble|poco f5)/, 5100],
      [/(poco x3 pro|poco x4 pro)/, 5160],
      [/note 1[0-4] pro/, 5000],
      [/note 1[0-4][ ^]/, 5000],
      [/pixel 6/, 4614], [/pixel 7 /, 4355], [/pixel 8/, 4575], [/pixel 9/, 4700],
      [/galaxy s2[12]/, 4000], [/galaxy s23/, 3900], [/galaxy s24/, 4000]
    ];
    for (var i = 0; i < db.length; i++) if (db[i][0].test(s)) return db[i][1];
    return null;
  }

  /**
   * Stima della capacità effettiva (mAh) dal contatore di carica:
   * counterMah = carica rimanente reale, level = percentuale dichiarata.
   * Affidabile solo con livello tra 20% e 95% (fuori da lì il gauge è non lineare).
   */
  function counterEstimateFull(counterMah, level) {
    if (!counterMah || level === undefined || level === null) return null;
    if (level < 20 || level > 95) return null;
    return Math.round(counterMah / (level / 100));
  }

  function fmtHours(h) {
    if (h === null || h === undefined || !isFinite(h) || h <= 0) return '—';
    if (h > 72) return '> 3 giorni';
    var hh = Math.floor(h), mm = Math.round((h - hh) * 60);
    if (mm === 60) { hh++; mm = 0; }
    return hh + 'h ' + (mm < 10 ? '0' : '') + mm + 'm';
  }

  /** chiave dispositivo per salvare i campioni del laboratorio */
  function labDeviceKey() {
    var E = Kanga.engine;
    if (E.mode === 'native' && E.state.deviceInfo) return 'native.' + (E.state.deviceInfo.model || 'x');
    if (E.mode === 'desktop') {
      var st = E.state;
      var cur = st.devices.filter(function (d) { return d.serial === st.currentSerial && d.state === 'device'; })[0];
      return 'adb.' + (cur ? (cur.model || cur.serial) : 'x');
    }
    return 'web';
  }

  /* ============================================================
   * 1) BATTERIA 🔋
   * ============================================================ */
  Kanga.registerModule = Kanga.registerModule || function (m) { (Kanga.modules = Kanga.modules || []).push(m); };

  Kanga.registerModule({
    id: 'battery', icon: '🔋', title: 'Batteria',
    short: 'Salute, cicli di ricarica e temperatura',
    weight: 1.0,

    run: function () {
      E = Kanga.engine;
      if (E.mode === 'desktop') return this.runDesktop();
      if (E.mode === 'native') return this.runNative();
      return this.runWeb();
    },

    /* ---------- 🔬 Laboratorio Batteria (pannello extra) ---------- */
    renderExtra: function (root) {
      E = Kanga.engine;
      var STORE = 'kanga.batlab.' + labDeviceKey();
      var SAMPLE_MS = 10000;
      var timer = null;
      var samples = [];
      try { samples = JSON.parse(localStorage.getItem(STORE) || '[]'); } catch (e) { samples = []; }

      var wrap = Kanga.ui.el('div', 'panel');
      wrap.innerHTML =
        '<h3>🔬 Laboratorio batteria — misura la durata reale</h3>' +
        '<p style="color:var(--muted);font-size:13px;margin:0 0 12px">' +
        'La percentuale che vedi è una <b>stima</b> del misuratore: con una batteria degradata sbaglia, ed è per questo che il telefono resta "inchiodato" all\'1%. ' +
        'Il contatore di carica (mAh) invece misura la carica reale presente: avvia il monitoraggio e usa il telefono normalmente — dopo qualche minuto saprai ' +
        '<b>quanto consuma davvero</b>, <b>quanto gli resta</b> e <b>quanti mAh effettivi</b> ha la batteria.</p>' +
        '<div class="actions-row" style="margin:0 0 14px">' +
        '  <button class="btn btn-primary btn-sm" id="labToggle">▶ Avvia monitoraggio</button>' +
        '  <button class="btn btn-sm" id="labClear">🗑 Cancella misure</button>' +
        '  <span style="flex:1"></span>' +
        '  <label style="color:var(--muted);font-size:12.5px">Capacità di progetto:</label>' +
        '  <input id="labDesign" type="number" min="500" max="12000" step="100" style="width:90px;background:var(--bg-3);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:6px 8px" placeholder="mAh">' +
        '  <button class="btn btn-sm" id="labSaveDesign">💾</button>' +
        '</div>' +
        '<dl class="kv" id="labLive">' +
        '  <dt>Stato monitor</dt><dd id="labState">fermo</dd>' +
        '  <dt>Adesso</dt><dd id="labNow">—</dd>' +
        '  <dt>Consumo / ricarica</dt><dd id="labRate">—</dd>' +
        '  <dt>Capacità effettiva rilevata</dt><dd id="labCap">—</dd>' +
        '  <dt>Durata totale stimata</dt><dd id="labTotal">—</dd>' +
        '  <dt>Autonomia residua</dt><dd id="labRemain">—</dd>' +
        '  <dt>Salute (vs progetto)</dt><dd id="labHealth">—</dd>' +
        '</dl>' +
        '<div id="labChart" style="margin-top:10px"></div>' +
        '<details style="margin-top:14px">' +
        '  <summary style="cursor:pointer;font-weight:600;font-size:13.5px">🧪 Perché resta all\'1% e come ricalibrare il misuratore</summary>' +
        '  <div style="color:var(--muted);font-size:13px;line-height:1.6;margin-top:8px">' +
        '    <p><b style="color:var(--text)">Perché succede:</b> il telefono stima la carica dalla tensione della cella. Invecchiando, la batteria perde capacità e la sua curva di scarica cambia: la tensione crolla prima del previsto e il software, per sicurezza, "congela" la barra all\'1% mentre la stima si riassesta. Risultato: 1% che dura un\'eternità (o spegnimenti improvvisi con carica apparentemente alta).</p>' +
        '    <p><b style="color:var(--text)">Ricalibrazione (falla 1–2 volte):</b></p>' +
        '    <ol style="margin:6px 0 10px 18px">' +
        '      <li>Usa il telefono finché <b>non si spegne da solo</b> (non caricarlo prima).</li>' +
        '      <li>Ricarica <b>senza interruzioni</b> fino al 100% con il telefono <b>spento</b> (o comunque senza usarlo).</li>' +
        '      <li>Lascialo ancora 30 minuti in carica dopo il 100%.</li>' +
        '      <li>Riaccendilo: ora il misuratore ha riletto i limiti reali della cella.</li>' +
        '    </ol>' +
        '    <p>Se dopo due ricalibrazioni l\'1% resta lungo e i mAh effettivi (qui sopra) restano molto sotto la capacità di progetto, la batteria è esaurita: nessuna app può ripristinarla — serve la sostituzione.</p>' +
        (E.mode === 'desktop'
          ? '<button class="btn btn-sm btn-danger" id="labResetStats">🧹 Azzera statistiche batteria (ADB)</button> <small style="color:var(--muted)">pulizia dei grafici di sistema, non tocca i dati</small>'
          : '') +
        '  </div>' +
        '</details>';
      root.appendChild(wrap);

      var $ = function (id) { return document.getElementById(id); };
      var designInput = $('labDesign');
      var dbDesign = null;
      if (E.mode === 'native' && E.state.deviceInfo) dbDesign = designCapacity(E.state.deviceInfo.model);
      if (E.mode === 'desktop') {
        var st = E.state;
        var cur = st.devices.filter(function (d) { return d.serial === st.currentSerial && d.state === 'device'; })[0];
        dbDesign = designCapacity(cur && cur.model);
      }
      var saved = null;
      try { saved = parseInt(localStorage.getItem('kanga.batlab.design'), 10); } catch (e) {}
      designInput.value = saved || dbDesign || '';
      designInput.placeholder = dbDesign ? dbDesign + ' (da DB)' : 'mAh';

      $('labSaveDesign').addEventListener('click', function () {
        var v = parseInt(designInput.value, 10);
        if (v > 500 && v < 12000) { localStorage.setItem('kanga.batlab.design', String(v)); Kanga.ui.toast('Capacità di progetto salvata: ' + v + ' mAh', 'ok'); refresh(); }
        else { localStorage.removeItem('kanga.batlab.design'); Kanga.ui.toast('Valore non valido: ripristinato il DB', 'warn'); refresh(); }
      });
      $('labClear').addEventListener('click', function () {
        Kanga.ui.confirm('Cancellare le misure?', 'Rimuove tutti i campioni del laboratorio batteria per questo dispositivo.', 'Cancella').then(function (yes) {
          if (yes) { samples = []; persist(); refresh(); Kanga.ui.toast('Misure cancellate', 'ok'); }
        });
      });
      var resetBtn = $('labResetStats');
      if (resetBtn) resetBtn.addEventListener('click', function () {
        Kanga.ui.confirm('Azzerare le statistiche batteria?', 'Esegue "dumpsys batterystats --reset" sul telefono: pulisce solo i grafici/statistiche di sistema del consumo. I tuoi dati non vengono toccati.', 'Azzera').then(function (yes) {
          if (!yes) return;
          E.shell('dumpsys batterystats --reset').then(function (r) { Kanga.ui.toast(r.ok ? 'Statistiche batteria azzerate' : 'Non riuscito: ' + (r.stderr || r.stdout || ''), r.ok ? 'ok' : 'bad'); });
        });
      });

      function persist() {
        try { localStorage.setItem(STORE, JSON.stringify(samples.slice(-2000))); } catch (e) {}
      }

      function fetchSample() {
        if (E.mode === 'desktop') {
          return E.shell('dumpsys battery').then(function (r) {
            var b = P.battery(r.stdout || '');
            return (b.level === undefined && !b.chargeCounter) ? null : {
              t: Date.now(), level: b.level,
              mah: b.chargeCounter ? b.chargeCounter / 1000 : null,
              temp: b.temperature, charging: b.status === 2 || b.status === 5
            };
          });
        }
        if (E.mode === 'native') {
          return E.native('battery').then(function (b) {
            return (b.level === undefined && b.chargeCounter === undefined) ? null : {
              t: Date.now(), level: b.level,
              mah: b.chargeCounter ? b.chargeCounter / 1000 : null,
              temp: b.temperature, charging: b.status === 2 || /carica/i.test(b.statusLabel || '')
            };
          });
        }
        return E.webBattery().then(function (b) {
          return b ? { t: Date.now(), level: b.level, mah: null, temp: null, charging: b.charging } : null;
        });
      }

      function compute() {
        var last = samples[samples.length - 1];
        var rate = null, chargingNow = last ? last.charging : null;
        var withMah = samples.filter(function (s) { return s.mah !== null && s.mah !== undefined; });
        if (withMah.length >= 2) {
          var a = withMah[0], b = withMah[withMah.length - 1];
          if (b.t - a.t >= 30000) {
            rate = (b.mah - a.mah) * 3600000 / (b.t - a.t);   // mA (positivo = ricarica)
            chargingNow = rate > 20 ? true : rate < -20 ? false : chargingNow;
          }
        }
        // capacità effettiva: ΔmAh / Δlevel × 100 sull'intervallo massimo osservato
        var cap = null;
        if (withMah.length >= 2) {
          var lo = null, hi = null;
          withMah.forEach(function (s) {
            if (s.level === undefined || s.level === null) return;
            if (!lo || s.level < lo.level) lo = s;
            if (!hi || s.level > hi.level) hi = s;
          });
          if (lo && hi && hi.level - lo.level >= 3) cap = Math.round((hi.mah - lo.mah) / (hi.level - lo.level) * 100);
        }
        if (!cap && last && last.level !== undefined && last.mah) cap = counterEstimateFull(last.mah, last.level);
        var design = parseInt(localStorage.getItem('kanga.batlab.design'), 10) || dbDesign || null;
        var health = (cap && design) ? Math.round(cap / design * 100) : null;
        var total = null, remain = null;
        if (cap && rate !== null && rate < -20) { total = cap / (-rate); remain = (last && last.mah) ? last.mah / (-rate) : null; }
        if (cap && rate !== null && rate > 20 && last && last.mah) remain = Math.max(0, (cap - last.mah) / rate);
        return { rate: rate, charging: chargingNow, cap: cap, design: design, health: health, total: total, remain: remain, last: last };
      }

      function chartSvg() {
        var withMah = samples.filter(function (s) { return s.mah !== null && s.mah !== undefined; });
        if (withMah.length < 2) return '';
        var W = 640, H = 120, pad = 10;
        var t0 = withMah[0].t, t1 = withMah[withMah.length - 1].t;
        if (t1 <= t0) t1 = t0 + 1;
        var mMin = Math.min.apply(null, withMah.map(function (s) { return s.mah; }));
        var mMax = Math.max.apply(null, withMah.map(function (s) { return s.mah; }));
        if (mMax - mMin < 10) { mMin -= 50; mMax += 50; }
        function X(t) { return pad + (t - t0) / (t1 - t0) * (W - 2 * pad); }
        function Y(m) { return H - pad - (m - mMin) / (mMax - mMin) * (H - 2 * pad); }
        var pts = withMah.map(function (s) { return X(s.t).toFixed(1) + ',' + Y(s.mah).toFixed(1); }).join(' ');
        var lv = samples.filter(function (s) { return s.level !== undefined && s.level !== null; });
        var lvPts = lv.length >= 2 ? lv.map(function (s) { return X(s.t).toFixed(1) + ',' + (H - pad - s.level / 100 * (H - 2 * pad)).toFixed(1); }).join(' ') : '';
        return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" style="width:100%;height:120px;background:var(--bg-3);border-radius:10px">' +
          (lvPts ? '<polyline points="' + lvPts + '" fill="none" stroke="#58a6ff" stroke-width="1.5" stroke-dasharray="4 3" opacity="0.8"/>' : '') +
          '<polyline points="' + pts + '" fill="none" stroke="#f5a623" stroke-width="2"/>' +
          '</svg>' +
          '<div style="display:flex;gap:14px;font-size:11.5px;color:var(--muted);margin-top:4px;flex-wrap:wrap">' +
          '<span><span style="color:#f5a623">▬</span> carica reale (mAh)</span>' +
          '<span><span style="color:#58a6ff">┄</span> percentuale dichiarata</span>' +
          '<span style="margin-left:auto">' + withMah.length + ' campioni · ' + Math.max(1, Math.round((t1 - t0) / 60000)) + ' min</span></div>';
      }

      function refresh() {
        var c = compute();
        $('labState').textContent = timer ? ('ATTIVO — ogni 10 s · ' + samples.length + ' campioni') : ('fermo — ' + samples.length + ' campioni salvati');
        var last = c.last;
        $('labNow').textContent = last
          ? (last.level !== undefined && last.level !== null ? last.level + '%' : '—') +
            (last.mah ? ' · ' + Math.round(last.mah) + ' mAh reali' : '') +
            (last.temp ? ' · ' + last.temp + ' °C' : '') +
            (last.charging !== undefined && last.charging !== null ? ' · ' + (last.charging ? '⚡ in carica' : 'in uso') : '')
          : '—';
        $('labRate').textContent = c.rate !== null
          ? (c.rate > 0 ? '⚡ ricarica +' : '🔻 consumo ') + Math.abs(Math.round(c.rate)) + ' mA'
          : (E.mode === 'web' ? 'non disponibile (browser)' : 'servono ≥ 2 campioni distanziati ≥ 30 s');
        $('labCap').textContent = c.cap ? '≈ ' + c.cap + ' mAh' : 'ancora insufficiente — lascia misurare (serve un Δ livello ≥ 3%)';
        $('labTotal').textContent = c.total ? fmtHours(c.total) + ' di uso attivo' : '—';
        $('labRemain').textContent = (c.remain !== null && c.remain !== undefined) ? fmtHours(c.remain) + (c.charging ? ' alla piena' : ' residui') : '—';
        $('labHealth').textContent = c.health ? c.health + '% (' + c.cap + ' su ' + c.design + ' mAh)' : (c.design ? '— (servono più misure)' : 'imposta la capacità di progetto →');
        $('labChart').innerHTML = chartSvg();
      }

      $('labToggle').addEventListener('click', function () {
        if (timer) {
          clearInterval(timer); timer = null;
          this.textContent = '▶ Avvia monitoraggio'; this.classList.add('btn-primary');
          refresh(); return;
        }
        var btn = this;
        btn.textContent = '■ Ferma monitoraggio'; btn.classList.remove('btn-primary');
        var tick = function () {
          if (!document.body.contains(btn)) { clearInterval(timer); timer = null; return; } // pagina cambiata: auto-stop
          fetchSample().then(function (s) {
            if (s) { samples.push(s); persist(); }
            refresh();
          }).catch(function () { refresh(); });
        };
        tick();
        timer = setInterval(tick, SAMPLE_MS);
      });

      refresh();
    },

    runDesktop: function () {
      var self = this;
      var sysfsScript =
        'for f in charge_full charge_full_design cycle_count health temp; do ' +
        'echo "$f=$(cat /sys/class/power_supply/battery/$f 2>/dev/null)"; done';
      var modelScript = 'echo "model=$(getprop ro.product.model) $(getprop ro.product.marketname)"';
      return Promise.all([sh('dumpsys battery'), sh(sysfsScript), sh(modelScript), sh('settings get global low_power')]).then(function (r) {
        var b = P.battery(r[0]);
        var s = P.batterySysfs(r[1]);
        var modelStr = ((r[2] || '').replace(/^model=/, '') || '').trim();
        if (b.level === undefined && !s.chargeFull) {
          return { score: null, status: 'info', summary: 'Dati batteria non leggibili dal dispositivo.', findings: [warn('Non è stato possibile leggere "dumpsys battery" né i file sysfs: il produttore potrebbe limitarli.')] };
        }

        var healthPct = null;
        if (s.chargeFull && s.chargeFullDesign) healthPct = Math.round(s.chargeFull / s.chargeFullDesign * 100);
        // stima dal contatore di carica quando il produttore non espone charge_full
        var counterFull = null, counterHealth = null;
        var design = designCapacity(modelStr);
        if (healthPct === null && b.chargeCounter && b.level !== undefined) {
          counterFull = counterEstimateFull(b.chargeCounter / 1000, b.level);
          if (counterFull && design) counterHealth = Math.round(counterFull / design * 100);
          else if (counterFull && s.chargeFullDesign) counterHealth = Math.round(counterFull / (s.chargeFullDesign / 1000) * 100);
        }
        var score = healthPct !== null ? healthPct : counterHealth;
        var findings = [];
        var kv = [
          ['Livello attuale', P.pct(b.level)],
          ['Stato', b.statusLabel || '—'],
          ['Salute (report)', b.healthLabel || '—'],
          ['Capacità residua', healthPct !== null ? healthPct + '% (' + (s.chargeFull / 1000).toFixed(0) + ' / ' + (s.chargeFullDesign / 1000).toFixed(0) + ' mAh)' : 'non esposta dal produttore'],
          ['Cicli di ricarica', s.cycleCount !== undefined ? String(s.cycleCount) : 'non esposti'],
          ['Tecnologia', b.technology || '—'],
          ['Tensione', b.voltageMv ? (b.voltageMv / 1000).toFixed(2) + ' V' : '—'],
          ['Carica reale (contatore)', b.chargeCounter ? (b.chargeCounter / 1000).toFixed(0) + ' mAh' : '—'],
          ['Capacità effettiva stimata', counterFull ? '≈ ' + counterFull + ' mAh' : '—'],
          ['Capacità di progetto', design ? design + ' mAh' + (modelStr ? ' (' + modelStr + ')' : '') : 'sconosciuta — impostala nel Laboratorio']
        ];

        if (healthPct !== null) {
          if (healthPct >= 85) findings.push(ok('Capacità residua ' + healthPct + '%: la batteria è ancora in buona salute.'));
          else if (healthPct >= 75) findings.push(warn('Capacità residua ' + healthPct + '%: degrado iniziale, autonomia ridotta ma accettabile.'));
          else findings.push(bad('Capacità residua solo ' + healthPct + '%: la batteria è degradata — probabile causa di spegnimenti improvvisi anche con carica apparentemente alta. Valuta la sostituzione.'));
        } else if (counterFull) {
          findings.push(info('Stima dal contatore di carica: la batteria contiene in realtà ≈ ' + counterFull + ' mAh a piena carica' + (design ? ' contro i ' + design + ' mAh di progetto' : '') + '.'));
          if (counterHealth !== null) {
            if (counterHealth >= 85) findings.push(ok('Salute effettiva ≈ ' + counterHealth + '%: discreta.'));
            else if (counterHealth >= 70) findings.push(warn('Salute effettiva ≈ ' + counterHealth + '%: autonomia già sensibilmente ridotta.'));
            else findings.push(bad('Salute effettiva ≈ ' + counterHealth + '%: batteria molto degradata — ecco perché la percentuale "impazzisce" (1% eterno o spegnimenti improvvisi). La sostituzione è l\'unica soluzione reale.'));
          }
        } else {
          findings.push(info('Questo dispositivo non espone la capacità residua (dato comune su molti modelli). La salute riportata dal sistema: ' + (b.healthLabel || 'sconosciuta') + '. Usa il Laboratorio batteria per misurarla.'));
        }
        if (s.cycleCount !== undefined && !isNaN(s.cycleCount)) {
          if (s.cycleCount > 1000) findings.push(bad(s.cycleCount + ' cicli di ricarica: oltre la vita tipica (500–1000 cicli) di una batteria Li-ion.'));
          else if (s.cycleCount > 500) findings.push(warn(s.cycleCount + ' cicli di ricarica: metà circa della vita tipica (500–1000 cicli).'));
          else findings.push(ok(s.cycleCount + ' cicli di ricarica: entro la fascia di normale utilizzo.'));
        }
        if (b.temperature !== undefined) {
          if (b.temperature >= 40) findings.push(bad('Batteria a ' + b.temperature + ' °C: troppo calda! Evita carica/uso intenso adesso.'));
          else if (b.temperature >= 36) findings.push(warn('Batteria a ' + b.temperature + ' °C: calda; il caldo accelerà il degrado.'));
          else findings.push(ok('Temperatura batteria: ' + b.temperature + ' °C, normale.'));
        }
        findings.push(info('Perché resta all\'1% o si spegne all\'improvviso? La percentuale è stimata dalla tensione: con poche mAh reali la stima slitta. Il Laboratorio batteria (qui sotto) misura i mAh veri e la durata effettiva.'));
        findings.push(info('Consigli: mantieni la carica tra 20% e 80%, evita caldo e cariche rapide continue; se disponibile attiva la "carica limitata all\'80%" o "proteggi batteria" nelle impostazioni.'));

        var saver = (r[3] || '').trim() === '1';
        kv.push(['Risparmio energetico', saver ? 'attivo' : 'disattivo']);
        var actions = [
          saver
            ? { label: '🔋 Disattiva risparmio energetico', hint: 'Riporta il telefono al consumo normale.', danger: true, run: function () { return sh('settings put global low_power 0').then(function () { Kanga.ui.toast('Risparmio energetico disattivato', 'ok'); }); } }
            : { label: '🔋 Attiva risparmio energetico', hint: 'Limita attività in background e prestazioni per allungare l\'autonomia.', danger: true, run: function () { return sh('settings put global low_power 1').then(function () { Kanga.ui.toast('Risparmio energetico attivato', 'ok'); }); } },
          { label: '📜 Cronologia batteria', hint: 'Eventi di carica/scarica registrati dal sistema (raw).', expert: true, run: function () { return sh('dumpsys batterystats --history | tail -n 150').then(function (t) { Kanga.ui.showRaw('Cronologia batteria (ultimi eventi)', t || '(vuota)'); }); } },
          { label: '🔓 Top wakelock', hint: 'Cosa tiene sveglia il telefono in standby — i famosi "drain" notturni.', expert: true, run: function () { return sh('dumpsys batterystats --charged | grep -iB1 -A3 "Wake lock" | head -n 60').then(function (t) { Kanga.ui.showRaw('Wakelock (per processo)', t || '(nessuno)'); }); } },
          { label: '⏱ Tempo schermo acceso', hint: 'Statistiche di consumo dalla ultima ricarica.', expert: true, run: function () { return sh('dumpsys batterystats --charged | grep -iE "Screen on:|Total run time|Battery time remaining|Capacity:" | head -n 10').then(function (t) { Kanga.ui.showRaw('Statistiche dalla ricarica', t || '(nessun dato)'); }); } }
        ];

        return { score: score, status: statusFromScore(score), summary: score !== null ? 'Salute batteria stimata: ' + score + '%' : 'Analisi batteria (dati parziali)', findings: findings, kv: kv, actions: actions };
      });
    },

    runNative: function () {
      var self = this;
      return Promise.all([
        E.native('battery'),
        E.native('powerSave').catch(function () { return { on: null }; })
      ]).then(function (res) {
        var b = res[0], ps = res[1];
        var healthPct = (b.chargeFull && b.chargeFullDesign) ? Math.round(b.chargeFull / b.chargeFullDesign * 100) : null;
        var modelStr = (E.state.deviceInfo && (E.state.deviceInfo.manufacturer + ' ' + E.state.deviceInfo.model)) || '';
        var design = designCapacity(modelStr) || (b.chargeFullDesign ? Math.round(b.chargeFullDesign / 1000) : null);
        // stima dal contatore di carica
        var counterFull = null, counterHealth = null;
        if (healthPct === null && b.chargeCounter && b.level !== undefined) {
          counterFull = counterEstimateFull(b.chargeCounter / 1000, b.level);
          if (counterFull && design) counterHealth = Math.round(counterFull / design * 100);
        }
        var score = healthPct !== null ? healthPct : counterHealth;
        var findings = [];
        var kv = [
          ['Livello', P.pct(b.level)],
          ['Stato', b.statusLabel || '—'],
          ['Salute (report)', b.healthLabel || '—'],
          ['Capacità residua', healthPct !== null ? healthPct + '%' : 'non esposta'],
          ['Cicli', b.cycleCount !== undefined && b.cycleCount !== null ? String(b.cycleCount) : 'non esposti (API 34+)'],
          ['Temperatura', b.temperature !== undefined && b.temperature !== null ? b.temperature + ' °C' : '—'],
          ['Tecnologia', b.technology || '—'],
          ['Carica reale (contatore)', b.chargeCounter ? (b.chargeCounter / 1000).toFixed(0) + ' mAh' : '—'],
          ['Capacità effettiva stimata', counterFull ? '≈ ' + counterFull + ' mAh' : '—'],
          ['Capacità di progetto', design ? design + ' mAh' + (modelStr ? ' (' + modelStr.trim() + ')' : '') : 'sconosciuta — impostala nel Laboratorio']
        ];
        if (healthPct !== null) {
          if (healthPct >= 85) findings.push(ok('Capacità residua ' + healthPct + '%: buona.'));
          else if (healthPct >= 75) findings.push(warn('Capacità residua ' + healthPct + '%: degrado iniziale.'));
          else findings.push(bad('Capacità residua ' + healthPct + '%: batteria degradata, valuta la sostituzione.'));
        } else if (counterFull) {
          findings.push(info('Stima dal contatore di carica: ≈ ' + counterFull + ' mAh reali a piena carica' + (design ? ' su ' + design + ' mAh di progetto' : '') + '.'));
          if (counterHealth !== null) {
            if (counterHealth >= 85) findings.push(ok('Salute effettiva ≈ ' + counterHealth + '%: discreta.'));
            else if (counterHealth >= 70) findings.push(warn('Salute effettiva ≈ ' + counterHealth + '%: autonomia ridotta.'));
            else findings.push(bad('Salute effettiva ≈ ' + counterHealth + '%: batteria molto degradata — è questo il motivo dell\'1% "infinito" e degli spegnimenti improvvisi. Serve sostituzione.'));
          }
        } else {
          findings.push(info('Il produttore non espone la capacità; salute di sistema: ' + (b.healthLabel || 'sconosciuta') + '. Usa il Laboratorio batteria per misurarla nel tempo.'));
        }
        if (b.cycleCount) {
          if (b.cycleCount > 1000) findings.push(bad(b.cycleCount + ' cicli: oltre la vita tipica.'));
          else if (b.cycleCount > 500) findings.push(warn(b.cycleCount + ' cicli: metà della vita tipica.'));
          else findings.push(ok(b.cycleCount + ' cicli: nella norma.'));
        }
        if (b.temperature !== null && b.temperature !== undefined) {
          if (b.temperature >= 40) findings.push(bad('Batteria a ' + b.temperature + ' °C: troppo calda.'));
          else findings.push(ok('Temperatura: ' + b.temperature + ' °C.'));
        }
        findings.push(info('Per la durata reale: apri il "Laboratorio batteria" qui sotto e avvia il monitoraggio.'));
        kv.push(['Risparmio energetico', ps.on === null ? '—' : (ps.on ? 'attivo' : 'disattivo')]);
        return { score: score, status: statusFromScore(score), summary: score !== null ? 'Salute batteria: ' + score + '%' : 'Analisi batteria', findings: findings, kv: kv };
      });
    },

    runWeb: function () {
      return E.webBattery().then(function (b) {
        if (!b) return { score: null, status: 'info', summary: 'Il browser non espone i dati batteria.', findings: [info('Questa pagina non gira nell\'app Android né nel desktop: per l\'analisi batteria usa l\'app.')] };
        return {
          score: null, status: 'info', summary: 'Batteria al ' + b.level + '%' + (b.charging ? ' (in carica)' : ''),
          findings: [
            info('Il browser fornisce solo livello e stato di carica, non la salute né i cicli.'),
            f(b.level < 20 && !b.charging ? 'warn' : 'ok', 'Livello: ' + b.level + '%' + (b.charging ? ', in carica' : '')),
            info('Consigli anti-degrado: 20–80%, evita il caldo, carica lenta quando puoi.')
          ],
          kv: [['Livello', b.level + '%'], ['In carica', b.charging ? 'sì' : 'no']]
        };
      });
    }
  });

  /* ============================================================
   * 2) PRESTAZIONI ⚡
   * ============================================================ */
  Kanga.registerModule({
    id: 'perf', icon: '⚡', title: 'Prestazioni',
    short: 'CPU, RAM, processi e fluidità',
    weight: 0.8,

    run: function () {
      E = Kanga.engine;
      if (E.mode === 'desktop') return this.runDesktop();
      if (E.mode === 'native') return this.runNative();
      return this.runWeb();
    },

    buildFindings: function (mem, benchMs, anim, top) {
      var findings = [];
      var score = 100;

      if (mem && mem.totalKb) {
        var usedPct = Math.round((1 - (mem.availKb || mem.freeKb) / mem.totalKb) * 100);
        if (usedPct > 88) { findings.push(bad('RAM satura al ' + usedPct + '%: è la causa più comune di lag e app che si ricaricano da zero.')); score -= 30; }
        else if (usedPct > 78) { findings.push(warn('RAM all\' ' + usedPct + '%: sotto pressione, chiudi le app in background.')); score -= 12; }
        else findings.push(ok('RAM utilizzata al ' + usedPct + '% su ' + P.kbHuman(mem.totalKb) + '.'));
      }
      if (benchMs !== null && benchMs !== undefined) {
        if (benchMs > 700) { findings.push(warn('Benchmark CPU lento (' + Math.round(benchMs) + ' ms): il SoC accusa l\'età o è in throttling.')); score -= 15; }
        else if (benchMs > 350) findings.push(info('Benchmark CPU: ' + Math.round(benchMs) + ' ms (nella media).'));
        else findings.push(ok('Benchmark CPU reattivo: ' + Math.round(benchMs) + ' ms.'));
      }
      if (anim !== null && anim !== undefined) {
        if (anim > 1) { findings.push(warn('Animazioni di sistema a ' + anim + '×: ridurle a 0.5× rende il telefono visibilmente più scattante.')); score -= 5; }
        else findings.push(ok('Animazioni di sistema a ' + anim + '×.'));
      }
      if (top && top.length) {
        var heavy = top.filter(function (p) { return p.cpu && parseFloat(p.cpu) > 30; });
        if (heavy.length) findings.push(warn('Processi pesanti adesso: ' + heavy.slice(0, 3).map(function (p) { return p.name + ' (' + p.cpu + '%)'; }).join(', ') + '.'));
      }
      if (score >= 85) findings.push(ok('Nessun collo di bottiglia evidente: il telefono gira bene.'));
      return { score: Math.max(0, Math.min(100, score)), findings: findings };
    },

    runDesktop: function () {
      var self = this;
      return Promise.all([
        sh('cat /proc/meminfo | head -n 4'),
        sh('dumpsys cpuinfo | head -n 25'),
        sh('settings get global window_animation_scale'),
        sh('echo "soc=$(getprop ro.soc.model)$(getprop ro.board.platform)"; echo "uptime=$(cat /proc/uptime)"'),
        sh('cat /proc/meminfo | grep -iE "swap" | head -n 4'),
        sh('top -n 1 | head -n 14')
      ]).then(function (r) {
        var mem = P.meminfo(r[0]);
        var anim = parseFloat(r[2]);
        var cpuHead = r[1].split(/\r?\n/).slice(0, 14).join('\n');
        var benchMs = benchCPU();
        var res = self.buildFindings(mem, benchMs, isNaN(anim) ? null : anim, []);

        // SoC, uptime, swap
        var extra = {};
        (r[3] || '').split(/\r?\n/).forEach(function (l) { var m = l.match(/^(\w+)=(.*)$/); if (m) extra[m[1]] = m[2]; });
        var swapLines = (r[4] || '').split(/\r?\n/).filter(function (l) { return l.trim() && /kB/.test(l); });
        // processi top (toybox: PID USER PR NI VIRT RES SHR S %CPU %MEM TIME+ ARGS)
        var topRows = [];
        (r[5] || '').split(/\r?\n/).forEach(function (l) {
          var p = l.trim().split(/\s+/);
          if (p.length > 11 && /^\d+$/.test(p[0])) topRows.push([p[0], p[1], p[8], p[5] + 'K', p.slice(11).join(' ')]);
        });
        var touches = null;

        var kv = [
          ['RAM totale', P.kbHuman(mem.totalKb)],
          ['RAM disponibile', P.kbHuman(mem.availKb)],
          ['Animazioni', isNaN(anim) ? '—' : anim + '×'],
          ['SoC', extra.soc || '—'],
          ['Acceso da', extra.uptime ? fmtHours(parseFloat(extra.uptime) / 3600) : '—'],
          ['Benchmark JS (questo PC)', Math.round(benchMs) + ' ms'],
          ['Swap / ZRAM', swapLines.length ? swapLines.join(' · ') : 'non attivo', true],
          ['dumpsys cpuinfo', 'vedi "Dati grezzi" sotto', true]
        ];
        return {
          score: res.score, status: statusFromScore(res.score),
          summary: 'Analisi prestazioni completata', findings: res.findings, kv: kv,
          rows: topRows.length ? { cols: ['PID', 'Utente', 'CPU%', 'RES', 'Processo'], data: topRows } : null,
          rowsExpert: true,
          actions: [
            { label: '⚡ Accelerazione 1-click', hint: 'Animazioni a 0.5× + cache di sistema liberata + chiusura app in background. Torna fluido in un attimo.', danger: true, run: function () { return sh('settings put global window_animation_scale 0.5; settings put global transition_animation_scale 0.5; settings put global animator_duration_scale 0.5').then(function () { return sh('pm trim-caches 999G'); }).then(function () { return sh('am kill-all'); }).then(function () { Kanga.ui.toast('Fatto: animazioni 0.5×, cache e background liberati', 'ok'); }); } },
            { label: '⚡ Solo animazioni 0.5×', hint: 'Imposta le 3 scale di animazione a 0.5. Reversibile.', run: function () { return sh('settings put global window_animation_scale 0.5; settings put global transition_animation_scale 0.5; settings put global animator_duration_scale 0.5').then(function () { Kanga.ui.toast('Animazioni ridotte a 0.5×', 'ok'); }); } },
            { label: '📦 Libera RAM (chiudi background)', hint: 'Forza lo stop delle app in background cached. I dati non vengono cancellati.', danger: true, run: function () { return sh('am kill-all').then(function () { Kanga.ui.toast('Processi in background terminati', 'ok'); }); } },
            { label: '🚀 Ricompila app in modalità speed', hint: 'Riottimizza il codice di tutte le app (dexopt). Può richiedere diversi minuti; il telefono resta usabile.', danger: true, expert: true, run: function () { Kanga.ui.toast('Ottimizzazione avviata: lascia il telefono collegato', 'info'); return sh('cmd package compile -m speed --all', 300000).then(function () { Kanga.ui.toast('Ricompilazione completata', 'ok'); }); } },
            { label: '🧵 Dexopt in background', hint: 'Ottimizzazione standard in secondo piano (quella che fa il telefono di notte).', danger: true, expert: true, run: function () { Kanga.ui.toast('Job avviato: terminerà in autonomia', 'info'); return sh('cmd package bg-dexopt-job', 300000).then(function () { Kanga.ui.toast('Ottimizzazione background terminata', 'ok'); }); } },
            { label: '👆 Mostra i tocchi ON/OFF', hint: 'Overlay visivo dei tocchi (come nelle demo). Riesegui per disattivare.', expert: true, run: function () { return sh('settings get global show_touches').then(function (v) { touches = (v || '').trim() === '1'; return sh('settings put global show_touches ' + (touches ? '0' : '1')); }).then(function () { Kanga.ui.toast(touches ? 'Overlay tocchi disattivato' : 'Overlay tocchi attivo', 'ok'); }); } },
            { label: '📊 Frequenze CPU live', hint: 'Frequenza attuale di ogni core del SoC.', expert: true, run: function () { return sh('for c in /sys/devices/system/cpu/cpu[0-9]*; do echo "$c: $(cat $c/cpufreq/scaling_cur_freq 2>/dev/null) kHz"; done | head -n 12').then(function (t) { Kanga.ui.showRaw('Frequenze CPU (kHz)', t || 'non leggibile'); }); } }
          ],
          raw: cpuHead ? 'dumpsys cpuinfo (estratto):\n' + cpuHead : undefined
        };
      });
    },

    runNative: function () {
      var self = this;
      return Promise.all([
        E.native('memory'),
        E.native('deviceInfo').catch(function () { return {}; })
      ]).then(function (res) {
        var m = res[0], d = res[1];
        var mem = { totalKb: Math.round((m.totalMem || 0) / 1024), availKb: Math.round((m.availMem || 0) / 1024) };
        var benchMs = benchCPU();
        var res = self.buildFindings(mem, benchMs, null, []);
        var kv = [
          ['RAM totale', P.human(m.totalMem)],
          ['RAM disponibile', P.human(m.availMem)],
          ['Pressione memoria', m.lowMemory ? 'alta (sistema sotto pressione)' : 'normale'],
          ['Benchmark JS', Math.round(benchMs) + ' ms'],
          ['Memoria app (PSS)', P.human(m.myPss)],
          ['Acceso da', d.uptimeMs ? fmtHours(d.uptimeMs / 3600000) : '—', true]
        ];
        return {
          score: res.score, status: statusFromScore(res.score), summary: 'Analisi prestazioni completata', findings: res.findings, kv: kv,
          actions: [
            { label: '⚡ Pulisci cache e velocizza', hint: 'Libera la cache delle app dal sistema.', run: function () { return E.native('clearMyCache').then(function (r) { Kanga.ui.toast('Liberati ' + P.human(r.freed || 0) + ' di cache', 'ok'); }); } },
            { label: '📊 Dati memoria grezzi', hint: 'Statistiche complete del MemoryInfo.', expert: true, run: function () { Kanga.ui.showRaw('MemoryInfo nativo', JSON.stringify(m, null, 2)); } }
          ]
        };
      });
    },

    runWeb: function () {
      var benchMs = benchCPU();
      var res = this.buildFindings(null, benchMs, null, []);
      return Promise.resolve({
        score: res.score, status: statusFromScore(res.score), summary: 'Benchmark del browser',
        findings: res.findings.concat([info('Modalità browser: misura solo questo dispositivo/computer, non il telefono.')]),
        kv: [['Benchmark JS', Math.round(benchMs) + ' ms'], ['Memoria stimata', (navigator.deviceMemory || '—') + (navigator.deviceMemory ? ' GB' : '')]]
      });
    }
  });

  /* ============================================================
   * 3) SPAZIO 💾
   * ============================================================ */
  Kanga.registerModule({
    id: 'storage', icon: '💾', title: 'Spazio',
    short: 'Archiviazione, cartelle pesanti, cache',
    weight: 0.8,

    run: function () {
      E = Kanga.engine;
      if (E.mode === 'desktop') return this.runDesktop();
      if (E.mode === 'native') return this.runNative();
      return this.runWeb();
    },

    runDesktop: function () {
      var duScript = 'du -k -d 1 /sdcard 2>/dev/null | sort -rn | head -n 16';
      return Promise.all([sh('df -h /data'), sh(duScript), sh('pm list packages -3 | wc -l')]).then(function (r) {
        var rows = P.df(r[0]);
        var dataRow = rows.filter(function (x) { return x.mount === '/data' || x.fs.indexOf('/data') === 0; })[0] || rows[0];
        var big = P.du(r[1]).filter(function (x) { return x.path !== '/sdcard'; });
        var appCount = parseInt(r[2], 10);

        var findings = [];
        var score = 100;
        var usePct = dataRow ? parseInt(dataRow.usePct, 10) : null;

        if (usePct !== null && !isNaN(usePct)) {
          if (usePct >= 95) { findings.push(bad('Memoria al ' + usePct + '%: praticamente piena. Android rallenta e gli aggiornamenti falliscono — liberare spazio è prioritario.')); score = 35; }
          else if (usePct >= 88) { findings.push(warn('Memoria al ' + usePct + '%: oltre l\'85% la scrittura dei file rallenta sensibilmente il telefono.')); score = 65; }
          else findings.push(ok('Memoria utilizzata al ' + usePct + '%: nella norma.'));
        } else findings.push(info('Impossibile leggere l\'occupazione di /data.'));

        if (big.length) {
          var top3 = big.slice(0, 3).map(function (x) { return x.path.replace('/sdcard/', '') + ' (' + P.kbHuman(x.kb) + ')'; });
          findings.push(info('Cartelle più pesanti nella memoria interna: ' + top3.join(', ') + '.'));
        }
        findings.push(info('Sospetti abituali: WhatsApp media (Android/media/com.whatsapp), DCIM/Camera, Download, cartelle .thumbnails e cache Telegram.'));
        if (appCount) findings.push(info(appCount + ' app di terze parti installate.'));

        return {
          score: score, status: statusFromScore(score),
          summary: dataRow ? 'Memoria: ' + dataRow.used + ' usati su ' + dataRow.size + ' (' + dataRow.usePct + ')' : 'Analisi spazio',
          findings: findings,
          rows: big.length ? { cols: ['Cartella', 'Dimensione'], data: big.slice(0, 10).map(function (x) { return [x.path.replace('/sdcard', '~'), P.kbHuman(x.kb)]; }) } : null,
          actions: [
            { label: '🧹 Libera cache di sistema (sicuro)', hint: 'pm trim-caches: elimina solo file temporanei delle app, nessun dato utente.', run: function () { return sh('pm trim-caches 999G').then(function () { Kanga.ui.toast('Cache di sistema liberata', 'ok'); }); } },
            { label: '🧹 Cancella thumbnail e file temporanei', hint: 'Elimina .thumbnails e EmptyFolder su /sdcard.', danger: true, run: function () { return sh('rm -rf /sdcard/DCIM/.thumbnails /sdcard/Pictures/.thumbnails').then(function () { Kanga.ui.toast('Thumbnail eliminate', 'ok'); }); } },
            { label: '🗂 Analisi profonda (2 livelli)', hint: 'du su due livelli di cartelle, ordinata per dimensione.', expert: true, run: function () { return sh('du -k -d 2 /sdcard 2>/dev/null | sort -rn | head -n 60').then(function (t) { Kanga.ui.showRaw('Occupazione /sdcard (KB, 2 livelli)', t || 'vuoto'); }); } },
            { label: '🔧 fstrim manuale', hint: 'Esegue il trim del filesystem (cosa che Android fa di notte in idle). Migliora la velocità di scrittura su eMMC/UFS.', danger: true, expert: true, run: function () { return sh('sm fstrim', 120000).then(function () { Kanga.ui.toast('fstrim eseguito', 'ok'); }); } },
            { label: '📊 Statistiche disco', hint: 'dumpsys diskstats: numeri grezzi di occupazione interna.', expert: true, run: function () { return sh('dumpsys diskstats | head -n 40').then(function (t) { Kanga.ui.showRaw('diskstats', t || 'vuoto'); }); } }
          ]
        };
      });
    },

    runNative: function () {
      var self = this;
      return Promise.all([
        E.native('storage'),
        E.native('traffic').catch(function () { return null; })
      ]).then(function (res) {
        var s = res[0], tr = res[1];
        var findings = [];
        var score = 100;
        var usePct = s.totalBytes ? Math.round((1 - s.availBytes / s.totalBytes) * 100) : null;
        if (usePct !== null) {
          if (usePct >= 95) { findings.push(bad('Memoria al ' + usePct + '%: praticamente piena.')); score = 35; }
          else if (usePct >= 88) { findings.push(warn('Memoria al ' + usePct + '%: oltre l\'85% il telefono rallenta.')); score = 65; }
          else findings.push(ok('Memoria utilizzata al ' + usePct + '% (' + P.human(s.totalBytes - s.availBytes) + ' su ' + P.human(s.totalBytes) + ').'));
        }
        findings.push(info('Per lo spazio per-app serve il permesso "Accesso dati di utilizzo": attivalo da Impostazioni → Accesso utilizzo.'));

        var result = {
          score: score, status: statusFromScore(score),
          summary: usePct !== null ? 'Memoria: ' + usePct + '% utilizzata' : 'Analisi spazio',
          findings: findings,
          kv: [
            ['Memoria totale', P.human(s.totalBytes)],
            ['Disponibile', P.human(s.availBytes)],
            ['Cache di Kanga', P.human(s.myCacheBytes || 0)],
            tr ? ['Dati ricevuti (da accensione)', P.human(tr.rxAll), true] : null,
            tr ? ['Dati inviati (da accensione)', P.human(tr.txAll), true] : null
          ].filter(Boolean),
          actions: [
            { label: '🧹 Pulisci cache di Kanga', run: function () { return E.native('clearMyCache').then(function (r) { Kanga.ui.toast('Liberati ' + P.human(r.freed || 0), 'ok'); }); } },
            { label: '🔑 Autorizza spazio per-app', hint: 'Apre le impostazioni di accesso utilizzo.', run: function () { return E.native('requestUsagePermission').then(function () { Kanga.ui.toast('Concedi l\'accesso a Kanga, poi rilancia l\'analisi', 'info'); }); } }
          ]
        };

        if (s.usagePermission) {
          return E.native('storageApps').then(function (apps) {
            if (apps && apps.list) {
              var l = apps.list;
              if (l.length) findings.push(info('App più ingombranti: ' + l.slice(0, 3).map(function (a) { return a.name + ' (' + P.human(a.total) + ')'; }).join(', ') + '.'));
              result.rows = { cols: ['App', 'Totale', 'Cache'], data: l.slice(0, 10).map(function (a) { return [a.name, P.human(a.total), P.human(a.cache)]; }) };
            }
            return result;
          }).catch(function () { return result; });
        }
        return result;
      });
    },

    runWeb: function () {
      return E.webStorage().then(function (s) {
        if (!s) return { score: null, status: 'info', summary: 'Spazio del browser non misurabile.', findings: [info('Il browser non espone stime di archiviazione in questo contesto.')] };
        var usePct = s.quota ? Math.round(s.usage / s.quota * 100) : null;
        return {
          score: null, status: 'info',
          summary: 'Spazio browser: ' + P.human(s.usage) + (s.quota ? ' di ' + P.human(s.quota) : ''),
          findings: [info('Questa misura riguarda solo lo spazio del browser ( siti web salvati ), non la memoria del telefono. Usa l\'app Android o la modalità desktop per l\'analisi completa.')],
          kv: [['Usato dal browser', P.human(s.usage)], ['Quota', P.human(s.quota)]]
        };
      });
    }
  });

  /* ============================================================
   * 4) SICUREZZA E SUPPORTO 🛡️
   * ============================================================ */
  Kanga.registerModule({
    id: 'security', icon: '🛡️', title: 'Sicurezza',
    short: 'Patch di sicurezza e fine supporto',
    weight: 1.0,

    run: function () {
      E = Kanga.engine;
      if (E.mode === 'desktop') return this.runDesktop();
      if (E.mode === 'native') return this.runNative();
      return this.runWeb();
    },

    evaluate: function (patch, sdk, manufacturer, bootState) {
      var findings = [];
      var score = 100;
      var kv = [
        ['Patch di sicurezza', patch || 'sconosciuta'],
        ['Versione Android', SDK_NAMES[sdk] || (sdk ? 'API ' + sdk : '—')],
        ['Produttore', manufacturer || '—'],
        ['Boot verificato', bootState || '—']
      ];

      var mM = patch ? patch.match(/^(\d{4})-(\d{2})/) : null;
      var months = mM ? monthsSince(parseInt(mM[1], 10), parseInt(mM[2], 10), 1) : null;
      if (months !== null) {
        kv.push(['Ultima patch', months === 0 ? 'questo mese' : months + ' mesi fa']);
        if (months > 12) { findings.push(bad('L\'ultima patch di sicurezza risale a ' + months + ' mesi fa: il telefono è esposto a vulnerabilità note. Se il produttore ha terminato il supporto, valuta un dispositivo aggiornato.')); score = 30; }
        else if (months > 6) { findings.push(warn('Nessuna patch di sicurezza da ' + months + ' mesi: verifica gli aggiornamenti di sistema e Play Protect attivo.')); score = 60; }
        else findings.push(ok('Patch di sicurezza aggiornata (' + months + ' mesi): buono.'));
      } else findings.push(info('Data patch non leggibile: controlla in Impostazioni → Informazioni telefono → Livello patch di sicurezza.'));

      if (sdk) {
        var latest = 36;
        if (latest - sdk >= 4) { findings.push(warn('Versione Android vecchia di ' + (latest - sdk) + ' generazioni: le app nuove richiedono più risorse e alcune non girano più.')); score -= 10; }
        else findings.push(ok('Versione Android: ' + (SDK_NAMES[sdk] || 'API ' + sdk) + '.'));
      }
      if (bootState) {
        if (bootState === 'green') findings.push(ok('Boot verificato: verde (sistema integro).'));
        else if (bootState === 'orange') findings.push(warn('Bootloader sbloccato: più rischi di malware e patch di sicurezza compromesse.'));
        else if (bootState === 'red') findings.push(bad('Boot verificato: ROSSO — verifica fallita, sistema potenzialmente manomesso.'));
      }
      var oem = manufacturer && OEM_PATCH_YEARS[String(manufacturer).toLowerCase()];
      if (oem) findings.push(info('Stima supporto ' + manufacturer + ': ~' + oem + ' anni di patch dalla data di uscita del modello (stima modificabile in modules.js).'));
      findings.push(info('Misure di protezione universali: Play Protect attivo, installazioni da origini sconosciute OFF, VPN su reti pubbliche, browser aggiornato.'));

      score = Math.max(0, Math.min(100, score));
      return { score: score, status: statusFromScore(score), summary: patch ? 'Patch: ' + patch : 'Analisi sicurezza', findings: findings, kv: kv };
    },

    runDesktop: function () {
      var self = this;
      var script =
        'echo "patch=$(getprop ro.build.version.security_patch)"; ' +
        'echo "sdk=$(getprop ro.build.version.sdk)"; ' +
        'echo "man=$(getprop ro.product.manufacturer)"; ' +
        'echo "model=$(getprop ro.product.model)"; ' +
        'echo "boot=$(getprop ro.boot.verifiedbootstate)"; ' +
        'echo "crypto=$(getprop ro.crypto.state)/$(getprop ro.crypto.type)"; ' +
        'echo "selinux=$(getenforce 2>/dev/null)"; ' +
        'echo "verity=$(getprop ro.boot.veritymode)"; ' +
        'echo "adb=$(settings get global adb_enabled)"; ' +
        'echo "devset=$(settings get global development_settings_enabled)"; ' +
        'echo "pdns=$(settings get global private_dns_mode)"; ' +
        'echo "pdnsspec=$(settings get global private_dns_specifier)"; ' +
        'echo "fingerprint=$(getprop ro.build.fingerprint)"; ' +
        'echo "gms=$(dumpsys package com.google.android.gms | grep -m1 versionName)"';
      return sh(script).then(function (out) {
        var v = {};
        out.split(/\r?\n/).forEach(function (l) { var m = l.match(/^(\w+)=(.*)$/); if (m) v[m[1]] = m[2]; });
        if (!v.patch && !v.sdk) {
          return { score: null, status: 'info', summary: 'Proprietà di sistema non leggibili.', findings: [warn('Collega un telefono con debug USB attivo per l\'analisi.')] };
        }
        var res = self.evaluate(v.patch, parseInt(v.sdk, 10) || null, v.man, v.boot);
        res.kv.push(['Modello', (v.man + ' ' + v.model).trim()]);
        res.kv.push(['Crittografia', v.crypto || '—']);
        res.kv.push(['Google Play Services', ((v.gms || '').replace('versionName=', '')).trim() || '—']);
        res.kv.push(['SELinux', v.selinux || '—', true]);
        res.kv.push(['dm-verity', v.verity || '—', true]);
        res.kv.push(['DNS privato', (v.pdns || 'default') + (v.pdnsspec && v.pdnsspec !== 'null' ? ' (' + v.pdnsspec + ')' : ''), true]);
        res.kv.push(['Fingerprint build', v.fingerprint || '—', true]);

        if (/^encrypted/.test(v.crypto || '')) res.findings.push(ok('Crittografia attiva (' + v.crypto.replace('encrypted/', 'FBE / ') + ').'));
        if ((v.adb || '').trim() === '1') res.findings.push(warn('Debug USB attivo: comodo per sviluppo, ma tienilo disattivato nell\'uso quotidiano (chiunque abbia accesso fisico potrebbe connettersi).'));
        if ((v.devset || '').trim() === '1') res.findings.push(info('Opzioni sviluppatore attive.'));

        res.actions = [
          { label: '🔍 Tutte le proprietà (getprop)', hint: 'Elenco completo delle proprietà di sistema del telefono.', expert: true, run: function () { return sh('getprop').then(function (t) { Kanga.ui.showRaw('getprop — proprietà di sistema', t || 'vuoto'); }); } },
          { label: '🛡️ Attiva DNS privato (Cloudflare 1.1.1.1)', hint: 'Cifratura DNS a livello di sistema. Reversibile con l\'azione qui accanto.', danger: true, expert: true, run: function () { return sh('settings put global private_dns_mode hostname; settings put global private_dns_specifier one.one.one.one').then(function () { Kanga.ui.toast('DNS privato: one.one.one.one', 'ok'); }); } },
          { label: '↩️ DNS privato automatico', hint: 'Riporta il DNS privato in modalità automatica (opportunistic).', danger: true, expert: true, run: function () { return sh('settings put global private_dns_mode opportunistic; settings put global private_dns_specifier null').then(function () { Kanga.ui.toast('DNS privato: automatico', 'ok'); }); } },
          { label: '📄 Politiche dispositivo (device policy)', hint: 'dumpsys device_policy: profili aziendali, admin del dispositivo.', expert: true, run: function () { return sh('dpm list-owners 2>/dev/null; dumpsys device_policy | head -n 30').then(function (t) { Kanga.ui.showRaw('Device policy e owners', t || 'nessuno'); }); } }
        ];
        return res;
      });
    },

    runNative: function () {
      var self = this;
      return Promise.all([
        E.native('deviceInfo'),
        E.native('securityFlags').catch(function () { return {}; }),
        E.native('appVersion', { package: 'com.google.android.gms' }).catch(function () { return {}; })
      ]).then(function (r) {
        var d = r[0], sf = r[1], gms = r[2];
        var res = self.evaluate(d.securityPatch, d.sdk, d.manufacturer, d.bootState);
        res.kv.push(['Crittografia', d.crypto || '—']);
        res.kv.push(['Google Play Services', gms.version || '—']);
        if (sf.adb === 1) res.findings.push(warn('Debug USB attivo: disattivalo nell\'uso quotidiano.'));
        if (sf.devSettings === 1) res.findings.push(info('Opzioni sviluppatore attive.'));
        res.kv.push(['Acceso da', d.uptimeMs ? fmtHours(d.uptimeMs / 3600000) : '—', true]);
        return res;
      });
    },

    runWeb: function () {
      return Promise.resolve({
        score: null, status: 'info', summary: 'Analisi disponibile solo su telefono',
        findings: [
          info('La versione di sicurezza si legge solo dal telefono (app Android o desktop + ADB).'),
          ok('Controlla periodicamente: Impostazioni → Sicurezza → Aggiornamento di sistema e Google Play Protect.')
        ]
      });
    }
  });

  /* ============================================================
   * 5) CONNETTIVITÀ 📶
   * ============================================================ */
  Kanga.registerModule({
    id: 'network', icon: '📶', title: 'Connettività',
    short: 'Wi-Fi, segnale cellulare, Bluetooth, ping',
    weight: 0.6,

    run: function () {
      E = Kanga.engine;
      if (E.mode === 'desktop') return this.runDesktop();
      if (E.mode === 'native') return this.runNative();
      return this.runWeb();
    },

    evalWifiRssi: function (rssi, findings) {
      if (rssi === undefined || rssi === null) return;
      if (rssi > -55) findings.push(ok('Segnale Wi-Fi ottimo (' + rssi + ' dBm).'));
      else if (rssi > -70) findings.push(warn('Segnale Wi-Fi discreto (' + rssi + ' dBm): avvicinati al router o riduci ostacoli.'));
      else findings.push(bad('Segnale Wi-Fi debole (' + rssi + ' dBm): connessioni lente e disconnessioni probabili.'));
    },
    evalLevel: function (level, findings) {
      if (level === undefined || level === null) return;
      if (level >= 3) findings.push(ok('Segnale cellulare ottimo (' + level + '/4).'));
      else if (level >= 2) findings.push(warn('Segnale cellulare medio (' + level + '/4).'));
      else findings.push(bad('Segnale cellulare debole (' + level + '/4): probabili chiamate perse e internet lento.'));
    },
    evalPing: function (p, findings) {
      if (!p || !p.sent) { findings.push(info('Test ping non riuscito: il telefono potrebbe essere offline.')); return; }
      if (p.loss > 0) findings.push(bad('Perdita pacchetti ' + p.loss + '%: la rete è instabile (Wi-Fi o antenna difettosa).'));
      else if (p.avgMs !== null) {
        if (p.avgMs > 120) findings.push(warn('Latenza ' + Math.round(p.avgMs) + ' ms: alta, navigazione a scatti.'));
        else findings.push(ok('Latenza media ' + Math.round(p.avgMs) + ' ms, senza perdita di pacchetti.'));
      }
    },

    runDesktop: function () {
      var self = this;
      return Promise.all([
        sh("dumpsys wifi | grep -iE 'Wi-Fi is|SSID:|rssi=|Link speed' | head -n 12"),
        sh("dumpsys telephony.registry | grep -iE 'mSignalStrength|level=' | head -n 8"),
        sh('settings get global bluetooth_on'),
        sh('ping -c 4 -W 2 8.8.8.8'),
        sh('settings get global airplane_mode_on'),
        sh('settings get global mobile_data'),
        sh('settings get global private_dns_mode; settings get global private_dns_specifier')
      ]).then(function (r) {
        var w = P.wifi(r[0]);
        var t = P.telephony(r[1]);
        var bt = (r[2] || '').trim() === '1';
        var pg = P.ping(r[3]);
        var airplane = (r[4] || '').trim() === '1';
        var mobileData = (r[5] || '').trim() !== '0';
        var pdnsParts = (r[6] || '').split(/\r?\n/).map(function (s) { return s.trim(); });
        var findings = [];
        var score = 100;

        if (airplane) findings.push(warn('Modalità aereo ATTIVA: radio spente.'));
        if (w.enabled === false) findings.push(info('Wi-Fi disattivato al momento.'));
        else {
          findings.push(ok('Wi-Fi attivo' + (w.ssid ? ' — rete "' + w.ssid + '"' : '') + (w.linkSpeed ? ' (' + w.linkSpeed + ' Mbps)' : '') + '.'));
        }
        self.evalWifiRssi(w.rssi, findings);
        if (t.level === undefined && !t.service) findings.push(info('Nessuna SIM o segnale cellulare non leggibile.'));
        else self.evalLevel(t.level, findings);
        findings.push(bt ? ok('Bluetooth: attivo.') : info('Bluetooth: spento.'));
        self.evalPing(pg, findings);

        if (w.rssi !== undefined && w.rssi <= -80) score -= 25;
        if (t.level !== undefined && t.level <= 1) score -= 25;
        if (pg.loss > 0) score -= 20;
        if (airplane) score -= 30;

        return {
          score: Math.max(0, score), status: statusFromScore(score),
          summary: 'Analisi rete completata', findings: findings,
          kv: [
            ['Wi-Fi', w.enabled === false ? 'spento' : (w.ssid || 'attivo')],
            ['Potenza Wi-Fi', w.rssi !== undefined ? w.rssi + ' dBm' : '—'],
            ['Velocità link', w.linkSpeed ? w.linkSpeed + ' Mbps' : '—'],
            ['Segnale cellulare', t.level !== undefined ? t.level + '/4' : '—'],
            ['Bluetooth', bt ? 'attivo' : 'spento'],
            ['Ping 8.8.8.8', pg.avgMs !== null ? Math.round(pg.avgMs) + ' ms' : 'n.d.'],
            ['Dati mobili', airplane ? 'n.d. (aereo)' : (mobileData ? 'attivi' : 'disattivati')],
            ['DNS privato', pdnsParts[0] === 'hostname' ? pdnsParts[1] : (pdnsParts[0] || 'automatico'), true],
            ['Modalità aereo', airplane ? 'ATTIVA' : 'off', true]
          ],
          actions: [
            { label: '🔄 Riavvia Wi-Fi', hint: 'Spegne e riattiva il Wi-Fi (disconnette brevemente).', danger: true, run: function () { return sh('svc wifi disable; sleep 2; svc wifi enable').then(function () { Kanga.ui.toast('Wi-Fi riavviato', 'ok'); }); } },
            { label: '🔄 Riavvia Bluetooth', hint: 'Spegne e riattiva il Bluetooth.', danger: true, run: function () { return sh('svc bluetooth disable; sleep 2; svc bluetooth enable').then(function () { Kanga.ui.toast('Bluetooth riavviato', 'ok'); }); } },
            { label: '🌐 Test DNS (ping google.com)', hint: 'Verifica la risoluzione dei nomi: se il ping a 8.8.8.8 va ma questo no, è colpa del DNS.', expert: true, run: function () { return sh('ping -c 3 -W 2 google.com').then(function (t) { var r2 = P.ping(t); Kanga.ui.showRaw('Test DNS — ping google.com', t + '\n\n— sintesi: ' + (r2.sent ? 'risoluzione OK, latenza ' + (r2.avgMs !== null ? Math.round(r2.avgMs) + ' ms' : 'n.d.') + ', perdita ' + r2.loss + '%' : 'DNS non risponde')); }); } },
            { label: '✈️ Modalità aereo ON/OFF', hint: 'Spegne/accende tutte le radio (Wi-Fi, cellulare, Bluetooth).', danger: true, expert: true, run: function () { var to = airplane ? '0' : '1'; return sh('settings put global airplane_mode_on ' + to + '; am broadcast -a android.intent.action.AIRPLANE_MODE --ez state ' + (to === '1' ? 'true' : 'false')).then(function () { Kanga.ui.toast(to === '1' ? 'Modalità aereo attivata' : 'Modalità aereo disattivata', 'ok'); }); } },
            { label: '📶 Dati mobili ON/OFF', hint: 'Disattiva o riattiva la connessione dati cellulare.', danger: true, expert: true, run: function () { return sh('svc data ' + (mobileData ? 'disable' : 'enable')).then(function () { Kanga.ui.toast(mobileData ? 'Dati mobili disattivati' : 'Dati mobili attivati', 'ok'); }); } },
            { label: '🛣️ Tabella di routing', hint: 'ip route: come il telefono instrada il traffico.', expert: true, run: function () { return sh('ip route | head -n 12').then(function (t) { Kanga.ui.showRaw('ip route', t || 'vuoto'); }); } },
            { label: '📡 Interfacce di rete', hint: 'Indirizzi IP delle interfacce attive (wlan0, rmnet…).', expert: true, run: function () { return sh('ip -4 addr show | grep -E "^[0-9]+:|inet " | head -n 16').then(function (t) { Kanga.ui.showRaw('ip addr (IPv4)', t || 'vuoto'); }); } }
          ]
        };
      });
    },

    runNative: function () {
      var self = this;
      return Promise.all([
        E.native('network'),
        E.native('traffic').catch(function () { return null; })
      ]).then(function (res) {
        var n = res[0], tr = res[1];
        var findings = [];
        var score = 100;
        var online = !!n.online;
        findings.push(online ? ok('Connessione internet attiva.') : bad('Il dispositivo risulta offline.'));
        if (!online) score -= 50;
        self.evalWifiRssi(n.wifiRssi, findings);
        self.evalLevel(n.cellLevel, findings);
        self.evalPing(n.ping, findings);
        if (n.wifiRssi !== undefined && n.wifiRssi <= -80) score -= 25;
        if (n.cellLevel !== undefined && n.cellLevel <= 1) score -= 15;
        if (n.ping && n.ping.loss > 0) score -= 20;
        return {
          score: Math.max(0, score), status: statusFromScore(score),
          summary: 'Analisi rete completata', findings: findings,
          kv: [
            ['Online', online ? 'sì' : 'no'],
            ['Wi-Fi RSSI', n.wifiRssi !== undefined && n.wifiRssi !== null ? n.wifiRssi + ' dBm' : '—'],
            ['Link Wi-Fi', n.wifiLink ? n.wifiLink + ' Mbps' : '—'],
            ['Segnale cellulare', n.cellLevel !== undefined && n.cellLevel !== null ? n.cellLevel + '/4' : '—'],
            ['Ping', n.ping && n.ping.avgMs != null ? Math.round(n.ping.avgMs) + ' ms' : 'n.d.'],
            tr ? ['Dati ricevuti (da accensione)', P.human(tr.rxAll), true] : null,
            tr ? ['Dati inviati (da accensione)', P.human(tr.txAll), true] : null,
            n.wifiFreq ? ['Frequenza Wi-Fi', n.wifiFreq + ' MHz (' + (n.wifiFreq > 4900 ? '5 GHz' : '2,4 GHz') + ')', true] : null,
            n.privateDns ? ['DNS privato', n.privateDns, true] : null
          ].filter(Boolean),
          actions: [
            { label: '🌐 Test DNS (ping google.com)', hint: 'Verifica risoluzione nomi e latenza verso internet.', run: function () { return E.native('ping', { host: 'google.com' }).then(function (p) { var msg = p.sent ? 'DNS OK · latenza ' + (p.avgMs != null ? Math.round(p.avgMs) + ' ms' : 'n.d.') + ' · perdita ' + p.loss + '%' : 'DNS/route non risponde'; Kanga.ui.showRaw('Test DNS — ping google.com', JSON.stringify(p, null, 2) + '\n\n' + msg); }); } },
            { label: '📊 Interfacce e traffico', hint: 'Numeri grezzi di rete.', expert: true, run: function () { Kanga.ui.showRaw('Statistiche rete native', JSON.stringify({ network: n, traffic: tr }, null, 2)); } }
          ]
        };
      });
    },

    runWeb: function () {
      var n = E.webNet();
      var findings = [];
      var score = 90;
      findings.push(n.online ? ok('Connessione attiva (' + (n.effectiveType || 'tipo sconosciuto') + ').') : bad('Sei offline.'));
      if (n.downlink) findings.push(info('Larghezza stimata: ' + n.downlink + ' Mbps, RTT ~' + (n.rtt || '?') + ' ms.'));
      findings.push(info('Modalità browser: mostra solo la rete di questo dispositivo.'));
      if (!n.online) score = 20;
      return Promise.resolve({ score: score, status: statusFromScore(score), summary: 'Rete del browser', findings: findings, kv: [['Online', n.online ? 'sì' : 'no'], ['Tipo', n.effectiveType || '—'], ['Downlink', n.downlink ? n.downlink + ' Mbps' : '—']] });
    }
  });

  /* ============================================================
   * 6) HARDWARE 🔩
   * ============================================================ */
  Kanga.registerModule({
    id: 'hardware', icon: '🔩', title: 'Hardware',
    short: 'Display, touch, audio, microfono, sensori',
    weight: 0.5,
    interactive: true,

    run: function () {
      E = Kanga.engine;
      var findings = [];
      var score = null;
      var self = this;

      var testActions = [
        { label: '🖼️ Test pixel morti', hint: 'Schermo pieno di colori: cerca punti anomali.', run: function () { Kanga.hwtest.start('pixel'); } },
        { label: '👆 Test multi-touch', hint: 'Disegna con più dita sullo schermo.', run: function () { Kanga.hwtest.start('touch'); } },
        { label: '🔊 Test altoparlante', hint: 'Toni a sinistra/destra/entrambi.', run: function () { Kanga.hwtest.start('audio'); } },
        { label: '🎙️ Test microfono', hint: 'Registra 3 secondi e osserva il livello.', run: function () { Kanga.hwtest.start('mic'); } }
      ];
      if (E.mode === 'native') {
        testActions.push({ label: '📳 Test vibrazione', hint: 'Il telefono vibra 1 secondo.', run: function () { E.native('vibrate', { ms: 1000 }); } });
      }

      var actions = testActions.slice();
      if (E.mode === 'desktop') {
        actions.push({
          label: '📲 Apri i test sul telefono', hint: 'Apre Chrome sul telefono con i test a schermo intero (via ADB reverse).',
          run: function () {
            return E.invoke('openHwTest', {}).then(function (r) {
              if (r && r.ok) Kanga.ui.toast('Test aperti sul telefono 📱', 'ok');
              else Kanga.ui.toast((r && r.error) || 'Impossibile aprire i test sul telefono', 'bad');
            });
          }
        });
      }

      var finish = function (sensorsList, kv, rows) {
        if (sensorsList !== null) {
          if (sensorsList.length === 0) findings.push(warn('Nessun sensore rilevato: possibile problema hardware o di lettura.'));
          else {
            findings.push(ok(sensorsList.length + ' sensori attivi (accelerometro, giroscopio, prossimità…).'));
            var hasAcc = sensorsList.some(function (s) { return /accel/i.test(s.name || s); });
            if (!hasAcc) findings.push(warn('Accelerometro non trovato: rotazione automatica e contapassi potrebbero non funzionare.'));
          }
        }
        findings.push(info('Usura tipica da controllare: pulsanti (premili durante il test touch), microfono/altoparlante attutiti (pulisci i fori con aria), connettore USB che si allenta (verifica carica stabile), ghost touch (test multi-touch senza toccare).'));
        findings.push(info('Esegui i test interattivi qui sotto per display, touch, audio e microfono.'));
        return { score: score, status: 'info', summary: 'Test interattivi e sensori', findings: findings, kv: kv || [], actions: actions, rows: rows && rows.data && rows.data.length ? rows : null, rowsExpert: true };
      };

      if (E.mode === 'desktop') {
        return Promise.all([
          sh('dumpsys sensorservice | head -n 46'),
          sh('dumpsys drm.drmManager 2>/dev/null | grep -iE "security level|widevine" | head -n 6; dumpsys media.drm 2>/dev/null | grep -iE "security level|widevine" | head -n 6'),
          sh('dumpsys media.camera 2>/dev/null | grep -E "^Camera [0-9]" | head -n 10')
        ]).then(function (r) {
          var list = P.sensors(r[0]);
          var names = list.map(function (s) { return { name: s.name }; });
          var wm = (r[1] || '').match(/security level:\s*(L\d)/i);
          var widevine = wm ? wm[1] : null;
          var cams = (r[2] || '').split(/\r?\n/).filter(function (l) { return l.trim(); });
          var kv = [
            ['Sensori letti', list.length ? String(list.length) : '—'],
            ['Widevine DRM', widevine || '—'],
            ['Telecamere', cams.length ? cams.map(function (c) { return c.split(':').slice(0, 2).join(':').trim(); }).join(' · ') : '—', true]
          ];
          if (widevine === 'L1') findings.push(ok('Widevine L1: streaming in HD/4K supportato (Netflix, Prime…).'));
          else if (widevine === 'L3') findings.push(warn('Widevine L3: i servizi streaming mostrano solo qualità SD.'));
          actions.push({ label: '📷 Apri fotocamera (prova reale)', hint: 'Avvia l\'app fotocamera: scatta una foto per verificare il modulo.', run: function () { return sh('am start -a android.media.action.STILL_IMAGE_CAMERA').then(function () { Kanga.ui.toast('Fotocamera aperta: scatta e rivedi la foto', 'ok'); }); } });
          actions.push({ label: '🎮 Renderer grafico (GPU)', hint: 'Chip GPU attivo riportato da SurfaceFlinger.', expert: true, run: function () { return sh('dumpsys SurfaceFlinger | grep -iE "GLES|OpenGL" | head -n 6').then(function (t) { Kanga.ui.showRaw('GPU', t || 'n.d.'); }); } });
          return finish(names.length ? names : null, kv);
        });
      }
      if (E.mode === 'native') {
        return Promise.all([
          E.native('sensors'),
          E.native('drm').catch(function () { return {}; }),
          E.native('deviceInfo').catch(function () { return {}; })
        ]).then(function (r) {
          var s = r[0], drm = r[1], d = r[2];
          var list = (s.list || []);
          var names = list.map(function (x) { return { name: x.name }; });
          var rows = list.length ? { cols: ['Sensore', 'Produttore', 'Consumo (mA)'], data: list.map(function (x) { return [x.name, x.vendor || '—', String(x.power)]; }) } : null;
          var kv = [
            ['Display', d.widthPx ? d.widthPx + '×' + d.heightPx : '—'],
            ['Frequenza', d.refreshHz ? Math.round(d.refreshHz) + ' Hz' : '—'],
            ['Densità', d.densityDpi ? d.densityDpi + ' dpi' : '—'],
            ['Sensori', String(list.length)],
            ['Widevine DRM', drm.widevine || '—']
          ];
          if (drm.widevine === 'L1') findings.push(ok('Widevine L1: streaming HD/4K supportato.'));
          else if (drm.widevine === 'L3') findings.push(warn('Widevine L3: streaming solo in SD.'));
          actions.push({ label: '📷 Apri fotocamera (prova reale)', hint: 'Avvia l\'app fotocamera: scatta una foto per verificare il modulo.', run: function () { return E.native('openCamera').then(function () { Kanga.ui.toast('Fotocamera aperta: scatta e rivedi la foto', 'ok'); }); } });
          return finish(list.length ? names : null, kv, rows);
        });
      }
      return Promise.resolve(finish(null, [['Modalità', 'browser — test locali']]));
    }
  });

  /* ============================================================
   * 7) TEMPERATURA 🌡️
   * ============================================================ */
  Kanga.registerModule({
    id: 'thermal', icon: '🌡️', title: 'Temperatura',
    short: 'Surriscaldamento e throttling',
    weight: 0.7,

    run: function () {
      E = Kanga.engine;
      if (E.mode === 'desktop') return this.runDesktop();
      if (E.mode === 'native') return this.runNative();
      return Promise.resolve({
        score: null, status: 'info', summary: 'Non disponibile nel browser',
        findings: [info('La temperatura si legge solo dal telefono (app Android o desktop + ADB).')]
      });
    },

    evalTemp: function (tempC, throttling) {
      var findings = [];
      var score = 100;
      if (tempC !== null && tempC !== undefined) {
        if (tempC >= 43) { findings.push(bad('Batteria/telefono a ' + tempC + ' °C: surriscaldamento. Smetti di caricare, togli la cover, chiudi app pesanti.')); score = 30; }
        else if (tempC >= 38) { findings.push(warn('Temperatura ' + tempC + ' °C: alta. Il telefono probabilmente sta già limitando le prestazioni (throttling).')); score = 60; }
        else findings.push(ok('Temperatura: ' + tempC + ' °C, nella norma.'));
      } else findings.push(info('Sensore temperatura non esposto.'));
      if (throttling && /2|3|4|SEVERE|CRITICAL/i.test(String(throttling))) {
        findings.push(bad('Throttling attivo (' + throttling + '): la CPU è ridotta per proteggersi dal caldo.'));
        score -= 25;
      }
      findings.push(info('Cause comuni di surriscaldamento: carica + uso intenso insieme, cover spesse, sole diretto, app in background (mineria, GPS), batteria degradata.'));
      score = Math.max(0, Math.min(100, score));
      return { score: score, status: statusFromScore(score), findings: findings };
    },

    runDesktop: function () {
      var self = this;
      return Promise.all([
        sh('dumpsys battery | grep -i temperature'),
        sh("dumpsys thermalservice 2>/dev/null | grep -iE 'throttling|status' | head -n 8"),
        sh('for z in /sys/class/thermal/thermal_zone*; do echo "$(cat $z/type 2>/dev/null)=$(cat $z/temp 2>/dev/null)"; done | head -n 24')
      ]).then(function (r) {
        var m = (r[0] || '').match(/temperature:\s*(-?\d+)/);
        var tempC = m ? parseInt(m[1], 10) / 10 : null;
        var thLines = P.thermal(r[1]);
        var throttling = thLines.length ? thLines[0] : null;
        var res = self.evalTemp(tempC, throttling);
        var zones = [];
        (r[2] || '').split(/\r?\n/).forEach(function (l) {
          var zm = l.match(/^([^=]+)=(-?\d+)$/);
          if (zm) zones.push([zm[1], (parseFloat(zm[2]) > 1000 ? (parseFloat(zm[2]) / 1000).toFixed(1) + ' °C' : zm[2])]);
        });
        res.summary = tempC !== null ? 'Temperatura batteria: ' + tempC + ' °C' : 'Analisi termica';
        res.kv = [['Batteria', tempC !== null ? tempC + ' °C' : '—']];
        if (zones.length) {
          res.rows = { cols: ['Zona termica', 'Valore'], data: zones.slice(0, 16) };
          res.rowsExpert = true;
        }
        if (thLines.length) res.raw = thLines.join('\n');
        res.actions = [
          { label: '❄️ Raffredda il telefono', hint: 'Chiude le app in background (spesso è loro il calore) e libera la cache.', danger: true, run: function () { return sh('am kill-all').then(function () { return sh('pm trim-caches 999G'); }).then(function () { Kanga.ui.toast('Background chiusi: la temperatura dovrebbe scendere', 'ok'); }); } },
          { label: '📊 Frequenze CPU live', hint: 'Se i core girano al massimo per lungo tempo, è throttling in atto.', expert: true, run: function () { return sh('for c in /sys/devices/system/cpu/cpu[0-9]*; do echo "$c: $(cat $c/cpufreq/scaling_cur_freq 2>/dev/null) kHz ($(cat $c/cpufreq/scaling_max_freq 2>/dev/null) max)"; done | head -n 12').then(function (t) { Kanga.ui.showRaw('Frequenze CPU attuali vs max (kHz)', t || 'non leggibile'); }); } }
        ];
        return res;
      });
    },

    runNative: function () {
      var self = this;
      return E.native('thermal').then(function (t) {
        var res = self.evalTemp(t.batteryTemp, t.status);
        res.summary = t.batteryTemp != null ? 'Temperatura batteria: ' + t.batteryTemp + ' °C' : 'Analisi termica';
        res.kv = [
          ['Batteria', t.batteryTemp != null ? t.batteryTemp + ' °C' : '—'],
          ['Stato termico', t.statusLabel || '—']
        ];
        return res;
      });
    }
  });

})();
