/* ============================================================
 * Kanga Toolkit — kanga.js
 * Framework UI: router, dashboard, pagine modulo, check-up,
 * report esportabile, impostazioni, toast e modali.
 * ============================================================ */

window.Kanga = window.Kanga || {};
Kanga.modules = Kanga.modules || [];

(function () {
  'use strict';

  var E = null;                 // engine
  var content = null;
  var lastResults = {};         // id → risultato modulo
  var lastCheckup = null;       // {date, overall, results{}}
  var CHECKUP_KEY = 'kanga.lastCheckup';

  /* ================= util UI ================= */

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function toast(msg, kind) {
    var box = document.getElementById('toasts');
    var t = el('div', 'toast ' + (kind || ''), esc(msg));
    box.appendChild(t);
    setTimeout(function () { t.style.opacity = '0'; t.style.transition = 'opacity .4s'; }, 3600);
    setTimeout(function () { t.remove(); }, 4100);
  }
  Kanga.ui = Kanga.ui || {};
  Kanga.ui.toast = toast;
  Kanga.ui.el = el;

  /** conferma con testo opzionale; resolve(true/false) */
  function confirmDialog(title, body, okLabel) {
    return new Promise(function (resolve) {
      var ov = document.getElementById('modalOverlay');
      document.getElementById('modalTitle').textContent = title;
      document.getElementById('modalBody').innerHTML = body || '';
      document.getElementById('modalOk').textContent = okLabel || 'Conferma';
      ov.classList.remove('hidden');
      function done(v) {
        ov.classList.add('hidden');
        document.getElementById('modalOk').onclick = null;
        document.getElementById('modalCancel').onclick = null;
        resolve(v);
      }
      document.getElementById('modalOk').onclick = function () { done(true); };
      document.getElementById('modalCancel').onclick = function () { done(false); };
    });
  }
  Kanga.ui.confirm = confirmDialog;

  function grade(score) {
    if (score === null || score === undefined) return { letter: '—', color: 'var(--muted)' };
    if (score >= 90) return { letter: 'A', color: 'var(--ok)' };
    if (score >= 75) return { letter: 'B', color: 'var(--ok)' };
    if (score >= 60) return { letter: 'C', color: 'var(--warn)' };
    if (score >= 40) return { letter: 'D', color: 'var(--warn)' };
    return { letter: 'E', color: 'var(--bad)' };
  }

  /* ================= status chips ================= */

  function refreshTopbar() {
    var devChip = document.getElementById('deviceChip');
    var st = E.state;
    devChip.classList.remove('ok', 'err');
    if (E.mode === 'desktop') {
      var ready = st.devices.filter(function (d) { return d.state === 'device'; });
      if (st.adbReady === false) {
        devChip.textContent = 'ADB non trovato — vedi Impostazioni';
        devChip.classList.add('err');
      } else if (ready.length === 0) {
        devChip.textContent = st.devices.length ? 'telefono non autorizzato' : 'nessun telefono collegato';
        devChip.classList.add('err');
      } else {
        var cur = ready.filter(function (d) { return d.serial === st.currentSerial; })[0] || ready[0];
        devChip.textContent = '📱 ' + (cur.model || cur.serial);
        devChip.classList.add('ok');
      }
    } else if (E.mode === 'native') {
      var d = st.deviceInfo || {};
      devChip.textContent = '📱 ' + (d.manufacturer ? d.manufacturer + ' ' : '') + (d.model || 'Android');
      devChip.classList.add('ok');
    } else {
      devChip.textContent = 'nessun accesso al telefono';
    }
  }

  /* ================= router ================= */

  function buildNav() {
    var ul = document.getElementById('navList');
    // rimuovi voci modulo precedenti
    ul.querySelectorAll('li[data-mod]').forEach(function (li) { li.remove(); });
    var ref = ul.querySelector('li a[href="#/settings"]').parentNode;
    Kanga.modules.forEach(function (m) {
      var li = el('li');
      li.setAttribute('data-mod', m.id);
      li.innerHTML = '<a href="#/' + m.id + '"><span>' + m.icon + '</span><span>' + esc(m.title) + '</span></a>';
      ul.insertBefore(li, ref);
    });
    ul.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        document.getElementById('sidebar').classList.remove('open');
      });
    });
  }

  function route() {
    var hash = location.hash || '#/';
    var path = hash.replace(/^#/, '');
    document.querySelectorAll('#navList a').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('href') === path || (path === '/' && a.getAttribute('href') === '#/'));
    });
    if (path === '/' || path === '') renderHome();
    else if (path === '/settings') renderSettings();
    else if (path === '/report') renderReport();
    else {
      var mod = Kanga.modules.filter(function (m) { return m.id === path.slice(1); })[0];
      if (mod) renderModule(mod);
      else renderHome();
    }
    content.scrollTop = 0;
  }

  /* ================= home / dashboard ================= */

  function renderHome() {
    var ring = lastCheckup ? grade(lastCheckup.overall) : null;
    var banner =
      E.mode === 'desktop' ? '<b>Modalità Desktop</b>: collega il telefono via USB con il debug USB attivo per la diagnostica completa via ADB. Nulla viene installato sul telefono.' :
      E.mode === 'native' ? '<b>App Android</b>: hai accesso completo ai sensori e alle statistiche di sistema, direttamente sul telefono.' :
      '<b>Modalità browser</b>: funzionalità ridotte a quelle permesse dal browser. Per l\'analisi completa usa l\'app Android o l\'app desktop.';

    content.innerHTML = '';
    var hero = el('div', 'hero');
    hero.innerHTML =
      (ring ? '<div class="grade-ring" style="--p:' + Math.max(2, lastCheckup.overall) + '"><div class="inner"><div class="score" style="color:' + ring.color + '">' + ring.letter + '</div><div class="lbl">check-up</div></div></div>' : '') +
      '<div style="flex:1;min-width:220px"><h1>Il coltellino svizzero per Android 🦘</h1>' +
      '<p>' + banner + '</p></div>' +
      '<div class="hero-actions">' +
      '  <button class="btn btn-primary" id="btnCheckup">🩺 Check-up completo</button>' +
      '  <button class="btn" id="btnGoReport" ' + (lastCheckup ? '' : 'disabled') + '>📄 Ultimo report</button>' +
      '</div>';
    content.appendChild(hero);

    var grid = el('div', 'cards-grid');
    Kanga.modules.forEach(function (m) {
      var card = el('div', 'card');
      card.innerHTML =
        '<div class="card-top"><span class="card-ico">' + m.icon + '</span><span class="card-title">' + esc(m.title) + '</span></div>' +
        '<div class="card-sub">' + esc(m.short) + '</div>' +
        '<div class="card-foot"><span class="card-status st-none" id="chip-' + m.id + '">da analizzare</span>' +
        '<button class="btn btn-sm" style="margin-left:auto" data-run="' + m.id + '">Analizza</button></div>';
      card.style.cursor = 'pointer';
      card.addEventListener('click', function (ev) {
        if (ev.target.closest('button')) return;
        location.hash = '#/' + m.id;
      });
      grid.appendChild(card);
    });
    content.appendChild(grid);

    document.getElementById('btnCheckup').addEventListener('click', runCheckup);
    var gr = document.getElementById('btnGoReport');
    if (gr && lastCheckup) gr.addEventListener('click', function () { location.hash = '#/report'; });
    grid.querySelectorAll('button[data-run]').forEach(function (b) {
      b.addEventListener('click', function () {
        location.hash = '#/' + b.getAttribute('data-run');
        setTimeout(function () { analyzeCurrent(); }, 60);
      });
    });
    updateModuleChips();
  }

  function updateModuleChips() {
    Kanga.modules.forEach(function (m) {
      var chip = document.getElementById('chip-' + m.id);
      if (!chip) return;
      var r = lastResults[m.id];
      if (!r) { chip.className = 'card-status st-none'; chip.textContent = 'da analizzare'; return; }
      chip.className = 'card-status st-' + r.status;
      chip.textContent = r.score !== null && r.score !== undefined ? r.status.toUpperCase() + ' · ' + Math.round(r.score) : r.summary ? r.summary.slice(0, 26) : 'analizzato';
    });
  }

  /* ================= pagina modulo ================= */

  var currentMod = null;

  function renderModule(mod) {
    currentMod = mod;
    content.innerHTML = '';
    var head = el('div', 'page-head');
    head.innerHTML =
      '<span class="card-ico">' + mod.icon + '</span>' +
      '<div><h1>' + esc(mod.title) + '</h1></div>' +
      '<div class="page-actions"><button class="btn btn-primary" id="btnAnalyze">▶ Analizza</button></div>';
    content.appendChild(head);
    content.appendChild(el('p', 'page-desc', esc(mod.short) + '. ' + (E.mode === 'web' ? 'Funzioni ridotte in modalità browser.' : '')));
    var panel = el('div', 'panel');
    panel.innerHTML = '<div class="loading"><div class="spinner"></div>Pronto per l\'analisi: premi "Analizza".</div>';
    panel.id = 'modPanel';
    content.appendChild(panel);
    // pannello extra opzionale del modulo (es. Laboratorio Batteria)
    if (typeof mod.renderExtra === 'function') {
      try { mod.renderExtra(content); } catch (e) { console.warn('renderExtra', e); }
    }
    document.getElementById('btnAnalyze').addEventListener('click', analyzeCurrent);
  }

  function analyzeCurrent() {
    if (!currentMod) return;
    var panel = document.getElementById('modPanel');
    if (!panel) return;
    panel.innerHTML = '<div class="loading"><div class="spinner"></div>Analisi in corso…</div>';
    var btn = document.getElementById('btnAnalyze');
    if (btn) btn.disabled = true;

    Promise.resolve().then(function () { return currentMod.run(); }).then(function (res) {
      lastResults[currentMod.id] = res;
      renderResult(panel, currentMod, res);
      updateModuleChips();
    }).catch(function (err) {
      panel.innerHTML = '<div class="findings"><li class="f-bad"><span class="f-dot"></span><span>Errore durante l\'analisi: ' + esc(err && err.message || err) + '</span></li></div>';
    }).then(function () { if (btn) btn.disabled = false; });
  }

  function renderResult(panel, mod, res) {
    panel.innerHTML = '';

    // sommario + punteggio
    var top = el('div', '', '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px">' +
      '<span class="card-status st-' + res.status + '" style="font-size:13px">' +
      (res.score !== null && res.score !== undefined ? Math.round(res.score) + '/100 · ' : '') + (res.summary || '') + '</span></div>');
    panel.appendChild(top);

    if (res.kv && res.kv.length) {
      var kvBox = el('div', 'panel');
      kvBox.style.background = 'var(--bg-3)';
      var dl = '<dl class="kv">';
      res.kv.forEach(function (pair) { dl += '<dt>' + esc(pair[0]) + '</dt><dd>' + esc(pair[1]) + '</dd>'; });
      dl += '</dl>';
      kvBox.innerHTML = '<h3>Dati rilevati</h3>' + dl;
      panel.appendChild(kvBox);
    }

    if (res.findings && res.findings.length) {
      var ul = el('ul', 'findings');
      res.findings.forEach(function (f) {
        ul.appendChild(el('li', 'f-' + f.level, '<span class="f-dot"></span><span>' + esc(f.text) + '</span>'));
      });
      panel.appendChild(ul);
    }

    if (res.rows && res.rows.data && res.rows.data.length) {
      var tb = el('div', 'panel');
      var html = '<h3>Dettaglio</h3><table class="tbl"><thead><tr>';
      res.rows.cols.forEach(function (c) { html += '<th>' + esc(c) + '</th>'; });
      html += '</tr></thead><tbody>';
      res.rows.data.forEach(function (row) {
        html += '<tr>';
        row.forEach(function (c, i) { html += '<td' + (i > 0 ? ' class="num"' : '') + '>' + esc(c) + '</td>'; });
        html += '</tr>';
      });
      html += '</tbody></table>';
      tb.innerHTML = html;
      panel.appendChild(tb);
    }

    if (res.raw) {
      var raw = el('div', 'panel');
      raw.innerHTML = '<h3>Dati grezzi</h3><pre class="raw">' + esc(res.raw) + '</pre>';
      panel.appendChild(raw);
    }

    if (res.actions && res.actions.length) {
      var row = el('div', 'actions-row');
      res.actions.forEach(function (a) {
        var b = el('button', 'btn btn-sm' + (a.danger ? ' btn-danger' : ''), esc(a.label));
        b.title = a.hint || '';
        b.addEventListener('click', function () {
          var go = function () {
            b.disabled = true;
            Promise.resolve().then(function () { return a.run(); }).catch(function (e) {
              toast('Azione non riuscita: ' + (e && e.message || e), 'bad');
            }).then(function () { b.disabled = false; });
          };
          if (a.danger) {
            confirmDialog('Confermi?', '<b>' + esc(a.label) + '</b><br><br>' + esc(a.hint || 'Questa azione modifica lo stato del telefono.'), 'Esegui')
              .then(function (yes) { if (yes) go(); });
          } else go();
        });
        row.appendChild(b);
      });
      panel.appendChild(row);
    }
  }

  /* ================= check-up ================= */

  function runCheckup() {
    var overlay = el('div', 'modal-overlay');
    overlay.style.zIndex = '95';
    overlay.innerHTML = '<div class="modal"><h3>🩺 Check-up completo</h3><div class="modal-body" id="checkupBody">Avvio…</div></div>';
    document.body.appendChild(overlay);

    var results = {};
    var i = 0;

    function step() {
      if (i >= Kanga.modules.length) {
        overlay.remove();
        finishCheckup(results);
        return;
      }
      var m = Kanga.modules[i];
      document.getElementById('checkupBody').innerHTML =
        '<div class="loading" style="padding:6px 0"><div class="spinner"></div>' + m.icon + ' ' + esc(m.title) + ' <small style="color:var(--muted)">(' + (i + 1) + '/' + Kanga.modules.length + ')</small></div>';
      Promise.resolve().then(function () { return m.run(); }).then(function (res) {
        results[m.id] = res;
        lastResults[m.id] = res;
        i++;
        step();
      }).catch(function (err) {
        results[m.id] = { score: null, status: 'info', summary: 'errore', findings: [{ level: 'warn', text: 'Analisi non riuscita: ' + (err && err.message || err) }] };
        lastResults[m.id] = results[m.id];
        i++;
        step();
      });
    }

    Promise.resolve().then(function () { return E.init(); }).then(step).catch(step);
  }

  function finishCheckup(results) {
    var sum = 0, wsum = 0;
    Kanga.modules.forEach(function (m) {
      var r = results[m.id];
      if (r && r.score !== null && r.score !== undefined) { sum += r.score * (m.weight || 1); wsum += (m.weight || 1); }
    });
    var overall = wsum ? Math.round(sum / wsum) : null;
    lastCheckup = {
      date: new Date().toISOString(),
      overall: overall,
      mode: E.mode,
      device: describeDevice(),
      results: results
    };
    try { localStorage.setItem(CHECKUP_KEY, JSON.stringify(lastCheckup)); } catch (e) {}
    updateModuleChips();
    location.hash = '#/report';
    toast('Check-up completato — punteggio ' + (overall !== null ? overall + '/100' : 'parziale'), overall !== null && overall >= 75 ? 'ok' : 'warn');
  }

  function describeDevice() {
    if (E.mode === 'native' && E.state.deviceInfo) {
      var d = E.state.deviceInfo;
      return (d.manufacturer ? d.manufacturer + ' ' : '') + d.model + (d.release ? ' (Android ' + d.release + ')' : '');
    }
    if (E.mode === 'desktop') {
      var st = E.state;
      var cur = st.devices.filter(function (x) { return x.serial === st.currentSerial && x.state === 'device'; })[0];
      return cur ? (cur.model || cur.serial) : 'dispositivo ADB';
    }
    return 'Browser';
  }

  /* ================= report ================= */

  function renderReport() {
    if (!lastCheckup) { renderHome(); return; }
    var g = grade(lastCheckup.overall);
    content.innerHTML = '';
    var head = el('div', 'page-head');
    head.innerHTML = '<span class="card-ico">📄</span><div><h1>Report check-up</h1></div>' +
      '<div class="page-actions">' +
      '<button class="btn" id="btnExportMd">⬇ Esporta Markdown</button>' +
      '<button class="btn" id="btnExportJson">⬇ Esporta JSON</button>' +
      (E.mode === 'native' ? '<button class="btn" id="btnShare">📤 Condividi</button>' : '') +
      '</div>';
    content.appendChild(head);
    content.appendChild(el('p', 'page-desc', new Date(lastCheckup.date).toLocaleString('it-IT') + ' · ' + esc(lastCheckup.device || '') + ' · modalità ' + E.modeLabel()));

    var hero = el('div', 'panel report-hero');
    hero.innerHTML =
      '<div class="grade-ring" style="--p:' + Math.max(2, lastCheckup.overall || 0) + '"><div class="inner"><div class="score" style="color:' + g.color + '">' + (lastCheckup.overall !== null ? lastCheckup.overall : '—') + '</div><div class="lbl">punteggio</div></div></div>' +
      '<div style="flex:1;min-width:220px"><h3 style="margin:0 0 6px">Giudizio: ' + g.letter + (lastCheckup.overall >= 75 ? ' — il telefono è in salute' : lastCheckup.overall >= 55 ? ' — attenzione ad alcuni punti' : ' — serve intervento') + '</h3>' +
      '<div style="color:var(--muted);font-size:13px">Punteggio medio ponderato dei moduli analizzati. Le voci "n/d" non hanno potuto essere misurate.</div></div>';
    content.appendChild(hero);

    var grid = el('div', 'report-grid');
    Kanga.modules.forEach(function (m) {
      var r = lastCheckup.results[m.id];
      if (!r) return;
      var item = el('div', 'report-item');
      var scoreTxt = r.score !== null && r.score !== undefined ? Math.round(r.score) + '/100' : 'n/d';
      var lis = (r.findings || []).slice(0, 5).map(function (f) { return '<li>' + esc(f.text) + '</li>'; }).join('');
      item.innerHTML =
        '<div class="ri-top">' + m.icon + ' ' + esc(m.title) + '<span class="card-status st-' + r.status + '">' + scoreTxt + '</span></div>' +
        (lis ? '<ul>' + lis + '</ul>' : '');
      grid.appendChild(item);
    });
    content.appendChild(grid);

    document.getElementById('btnExportMd').addEventListener('click', function () { exportReport('md'); });
    document.getElementById('btnExportJson').addEventListener('click', function () { exportReport('json'); });
    var shBtn = document.getElementById('btnShare');
    if (shBtn) shBtn.addEventListener('click', function () {
      E.native('share', { text: reportMarkdown(), subject: 'Report Kanga Toolkit' });
    });
  }

  function reportMarkdown() {
    if (!lastCheckup) return '';
    var g = grade(lastCheckup.overall);
    var out = '# 🦘 Report Kanga Toolkit\n\n';
    out += '- **Data**: ' + new Date(lastCheckup.date).toLocaleString('it-IT') + '\n';
    out += '- **Dispositivo**: ' + (lastCheckup.device || '—') + '\n';
    out += '- **Punteggio complessivo**: ' + (lastCheckup.overall !== null ? lastCheckup.overall + '/100 (giudizio ' + g.letter + ')' : 'non calcolabile') + '\n';
    Kanga.modules.forEach(function (m) {
      var r = lastCheckup.results[m.id];
      if (!r) return;
      out += '\n## ' + m.icon + ' ' + m.title + ' — ' + (r.score !== null && r.score !== undefined ? Math.round(r.score) + '/100' : 'n/d') + '\n\n';
      (r.findings || []).forEach(function (f) {
        var ico = { ok: '✅', info: 'ℹ️', warn: '⚠️', bad: '❌' }[f.level] || '•';
        out += '- ' + ico + ' ' + f.text + '\n';
      });
    });
    out += '\n---\nGenerato con Kanga Toolkit 🦘 — il coltellino svizzero per Android.\n';
    return out;
  }

  function exportReport(kind) {
    if (!lastCheckup) return;
    var data, mime, name;
    if (kind === 'json') {
      data = JSON.stringify(lastCheckup, null, 2);
      mime = 'application/json';
      name = 'kanga-report-' + new Date().toISOString().slice(0, 10) + '.json';
    } else {
      data = reportMarkdown();
      mime = 'text/markdown';
      name = 'kanga-report-' + new Date().toISOString().slice(0, 10) + '.md';
    }
    try {
      var blob = new Blob([data], { type: mime });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 800);
      toast('Report esportato: ' + name, 'ok');
    } catch (e) {
      toast('Esportazione non riuscita: ' + e.message, 'bad');
    }
  }

  /* ================= impostazioni ================= */

  function renderSettings() {
    content.innerHTML = '';
    var head = el('div', 'page-head');
    head.innerHTML = '<span class="card-ico">⚙️</span><div><h1>Impostazioni</h1></div>';
    content.appendChild(head);

    var p = el('div', 'panel');

    function row(label, sub, actionsHtml) {
      return '<div class="setting-row"><div class="s-label"><b>' + label + '</b><span>' + sub + '</span></div><div style="display:flex;gap:8px;flex-wrap:wrap">' + (actionsHtml || '') + '</div></div>';
    }

    var html = '';

    if (E.mode === 'desktop') {
      html += row('Motori ADB', 'Percorso ADB in uso e strumenti', '<button class="btn btn-sm" id="setAdbPick">📁 Scegli adb…</button><button class="btn btn-sm" id="setAdbFetch" style="margin-left:6px">⬇️ Scarica ADB</button>');
      html += '<div class="setting-row"><div class="s-label"><b>Percorso ADB attuale</b><span id="adbPathLabel">…</span></div></div>';
      html += row('Server ADB', 'Riavvia o ferma il server ADB locale', '<button class="btn btn-sm" id="setAdbRestart">🔄 Riavvia</button><button class="btn btn-sm" id="setAdbKill" style="margin-left:6px">⏹ Ferma</button>');
      html += row('Dispositivi', 'Telefoni collegati e autorizzati', '<button class="btn btn-sm" id="setRefresh">🔄 Aggiorna elenco</button>');
      html += '<div class="setting-row"><div class="s-label"><b>Elenco dispositivi</b><span id="deviceListLabel">…</span></div></div>';
      html += row('Test sul telefono', 'Apre la pagina dei test hardware in Chrome sul telefono (via ADB reverse)', '<button class="btn btn-sm" id="setOpenHw">📲 Apri test sul telefono</button>');
    } else if (E.mode === 'native') {
      html += row('Accesso dati di utilizzo', 'Serve per lo spazio occupato dalle singole app', '<button class="btn btn-sm" id="setUsage">🔑 Apri impostazioni</button>');
      html += row('Permesso microfono', 'Serve per il test microfono; verrà chiesto a schermo', '<button class="btn btn-sm" id="setMic">🎙️ Chiedi ora</button>');
    } else {
      html += row('Modalità browser', 'Per la diagnostica completa installa l\'app Android o usa l\'app desktop con il telefono collegato', '');
    }
    html += row('Check-up salvato', 'Cancella l\'ultimo report memorizzato in locale', '<button class="btn btn-sm btn-danger" id="setClear">🗑 Cancella</button>');
    html += row('Informazioni', 'Kanga Toolkit ' + Kanga.version + ' — un progetto "coltellino svizzero": nessun dato lascia il dispositivo.', '');

    p.innerHTML = html;
    content.appendChild(p);

    if (E.mode === 'desktop') {
      E.invoke('getSettings', {}).then(function (s) {
        var l = document.getElementById('adbPathLabel');
        if (l) l.textContent = s.adbPath || 'non trovato — scaricalo o sceglierlo';
      }).catch(function () {});
      var refresh = function () {
        E.invoke('devices', {}).then(function (r) {
          var l = document.getElementById('deviceListLabel');
          if (!l) return;
          var devs = (r.devices || []);
          l.textContent = devs.length
            ? devs.map(function (d) { return (d.model || d.serial) + (d.state === 'device' ? ' ✓' : ' (' + d.state + ')'); }).join(', ')
            : 'nessuno collegato';
        }).catch(function () {});
      };
      refresh();
      var pick = document.getElementById('setAdbPick');
      if (pick) pick.addEventListener('click', function () {
        E.invoke('pickAdb', {}).then(function (r) { if (r && r.picked) { toast('ADB impostato: ' + r.path, 'ok'); E.init(); refresh(); } }).catch(function () {});
      });
      var fetchBtn = document.getElementById('setAdbFetch');
      if (fetchBtn) fetchBtn.addEventListener('click', function () {
        fetchBtn.disabled = true;
        toast('Download platform-tools in corso…', 'info');
        E.invoke('fetchAdb', {}).then(function (r) {
          fetchBtn.disabled = false;
          if (r && r.ok) { toast('ADB scaricato in ' + r.path, 'ok'); E.init(); refresh(); }
          else toast('Download non riuscito: ' + ((r && r.error) || 'errore'), 'bad');
        }).catch(function (e) { fetchBtn.disabled = false; toast('Download non riuscito', 'bad'); });
      });
      var restart = document.getElementById('setAdbRestart');
      if (restart) restart.addEventListener('click', function () { E.invoke('adbControl', { action: 'restart' }).then(function () { toast('Server ADB riavviato', 'ok'); refresh(); }); });
      var kill = document.getElementById('setAdbKill');
      if (kill) kill.addEventListener('click', function () { E.invoke('adbControl', { action: 'kill' }).then(function () { toast('Server ADB fermato', 'ok'); refresh(); }); });
      var refreshBtn = document.getElementById('setRefresh');
      if (refreshBtn) refreshBtn.addEventListener('click', refresh);
      var openHw = document.getElementById('setOpenHw');
      if (openHw) openHw.addEventListener('click', function () {
        E.invoke('openHwTest', {}).then(function (r) {
          toast(r && r.ok ? 'Test aperti sul telefono 📱' : ((r && r.error) || 'non riuscito'), r && r.ok ? 'ok' : 'bad');
        });
      });
    }

    if (E.mode === 'native') {
      var usage = document.getElementById('setUsage');
      if (usage) usage.addEventListener('click', function () { E.native('requestUsagePermission'); toast('Concedi l\'accesso a "Kanga Toolkit" poi torna qui', 'info'); });
      var mic = document.getElementById('setMic');
      if (mic) mic.addEventListener('click', function () { E.native('requestMicPermission'); });
    }

    var clear = document.getElementById('setClear');
    clear.addEventListener('click', function () {
      confirmDialog('Cancellare il check-up?', 'Rimuove il report salvato in locale (localStorage).', 'Cancella').then(function (yes) {
        if (yes) { localStorage.removeItem(CHECKUP_KEY); lastCheckup = null; toast('Report cancellato', 'ok'); renderSettings(); }
      });
    });
  }

  /* ================= selettore test hardware (#hwtest) ================= */

  /** Mostrato quando la pagina viene aperta come #hwtest (es. "Apri test sul telefono" via ADB). */
  function showHwChooser() {
    var r = document.getElementById('hwtest-root');
    var box = el('div', 'hwtest');
    box.style.background = 'var(--bg)';
    box.innerHTML =
      '<div class="hw-bar" style="position:static;padding:14px">' +
      '  <span class="hw-title" style="color:var(--text);font-size:17px">🧪 Test hardware del telefono</span>' +
      '</div>' +
      '  <div class="hw-grid-buttons" id="hwChooserBtns"></div>' +
      '  <div class="hw-note" style="color:var(--muted)">Scegli un test. A schermo intero: tieni il telefono in orizzontale per il test pixel.</div>';
    r.appendChild(box);
    var btns = box.querySelector('#hwChooserBtns');
    var tests = [
      ['pixel', '🖼️ Pixel morti', 'Colori a schermo intero'],
      ['touch', '👆 Multi-touch', 'Disegna con più dita'],
      ['audio', '🔊 Altoparlante', 'Toni sinistra/destra'],
      ['mic', '🎙️ Microfono', 'Parla per 5 secondi']
    ];
    tests.forEach(function (t) {
      var b = el('button', 'btn', '<b>' + t[1] + '</b><br><small style="color:var(--muted)">' + t[2] + '</small>');
      b.style.height = '86px';
      b.addEventListener('click', function () {
        box.remove();
        Kanga.hwtest.start(t[0]);
      });
      btns.appendChild(b);
    });
  }

  /* ================= avvio ================= */

  function boot() {
    E = Kanga.engine;
    content = document.getElementById('content');
    document.getElementById('verLabel').textContent = 'v' + Kanga.version;

    // menu mobile
    document.getElementById('menuBtn').addEventListener('click', function () {
      document.getElementById('sidebar').classList.toggle('open');
    });

    // check-up salvato
    try {
      var saved = localStorage.getItem(CHECKUP_KEY);
      if (saved) lastCheckup = JSON.parse(saved);
    } catch (e) {}

    E.onChange(refreshTopbar);

    // apertura diretta dei test hardware (es. "Apri test sul telefono" via ADB)
    if ((location.hash || '') === '#hwtest') {
      showHwChooser();
      // se l'utente cambia hash da qui, ricarica pulita e riavvia l'app
      window.addEventListener('hashchange', function () { location.reload(); });
      return;
    }

    E.init().then(function () {
      buildNav();
      refreshTopbar();
      window.addEventListener('hashchange', route);
      route();
      var splash = document.getElementById('bootSplash');
      if (splash) splash.remove();
      if (E.mode === 'desktop' && E.state.adbReady === false) {
        toast('ADB non trovato: vai su Impostazioni per scaricarlo o sceglierlo', 'warn');
      }
    }).catch(function () {
      buildNav();
      refreshTopbar();
      window.addEventListener('hashchange', route);
      route();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  Kanga.framework = {
    get lastCheckup() { return lastCheckup; },
    rerunCheckup: runCheckup
  };
})();
