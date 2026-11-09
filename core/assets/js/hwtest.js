/* ============================================================
 * Kanga Toolkit — hwtest.js
 * Test hardware a schermo intero: pixel morti, multi-touch,
 * altoparlante, microfono. Funziona su telefono (app o browser
 * aperto via ADB reverse) e su desktop.
 * ============================================================ */

window.Kanga = window.Kanga || {};

Kanga.hwtest = (function () {
  'use strict';

  var root = null;   // contenitore #hwtest-root

  function ensureRoot() {
    if (!root) root = document.getElementById('hwtest-root');
    return root;
  }

  function close() {
    var r = ensureRoot();
    r.innerHTML = '';
    document.body.style.overflow = '';
    if (audioCtx) { try { audioCtx.close(); } catch (e) {} audioCtx = null; }
    if (micStream) { micStream.getTracks().forEach(function (t) { t.stop(); }); micStream = null; }
  }

  function baseBar(title, note) {
    var r = ensureRoot();
    r.innerHTML =
      '<div class="hwtest" id="hwtestFull">' +
      '  <div class="hw-bar">' +
      '    <button class="btn btn-sm" id="hwClose">✕ Chiudi</button>' +
      '    <span class="hw-title">' + title + '</span>' +
      '  </div>' +
      '  <div class="hw-stage" id="hwStage"></div>' +
      '  <div class="hw-note" id="hwNote">' + (note || '') + '</div>' +
      '</div>';
    document.getElementById('hwClose').addEventListener('click', close);
    return document.getElementById('hwStage');
  }

  /* ---------------- 1) PIXEL MORTI ---------------- */
  function pixelTest() {
    var stage = baseBar('Test pixel — tocca per cambiare colore',
      'Osserva lo schermo da vicino: punti o linee che non cambiano colore = pixel bloccati/morti');
    var colors = ['#ff0000', '#00ff00', '#0000ff', '#ffffff', '#000000', '#ffff00', '#00ffff', '#ff00ff', '#808080'];
    var i = 0;
    var canvas = document.createElement('canvas');
    canvas.id = 'pixelCanvas';
    stage.appendChild(canvas);
    var ctx = canvas.getContext('2d');

    function draw() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    draw();
    window.addEventListener('resize', draw);
    canvas.addEventListener('click', function () { i++; draw(); });
    canvas.addEventListener('touchstart', function (e) { i++; draw(); e.preventDefault(); }, { passive: false });
  }

  /* ---------------- 2) MULTI-TOUCH ---------------- */
  function touchTest() {
    var stage = baseBar('Test multi-touch — disegna con le dita',
      'Linee che seguono ogni dito = touch OK. Tratti che si interrompono o compaiono da soli (ghost touch) = problema.');
    var canvas = document.createElement('canvas');
    canvas.className = 'touch-canvas';
    stage.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    var last = {};
    var count = 0;

    function pos(e) {
      var r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    function start(e) {
      e.preventDefault();
      var ps = [];
      for (var i = 0; i < e.touches.length; i++) ps.push(e.touches[i].identifier + ':' + pos(e.touches[i]).x + ',' + pos(e.touches[i]).y);
      document.getElementById('hwNote').textContent = 'Dita rilevate: ' + e.touches.length + (count < e.touches.length ? '' : '');
      count = Math.max(count, e.touches.length);
      for (var j = 0; j < e.changedTouches.length; j++) {
        var t = e.changedTouches[j];
        last[t.identifier] = pos(t);
      }
    }
    function move(e) {
      e.preventDefault();
      for (var j = 0; j < e.changedTouches.length; j++) {
        var t = e.changedTouches[j];
        var p = pos(t);
        var l = last[t.identifier] || p;
        // colore diverso per dita consecutive
        ctx.strokeStyle = 'hsl(' + ((t.identifier * 77) % 360) + ',90%,60%)';
        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(l.x, l.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        last[t.identifier] = p;
      }
    }
    function end(e) {
      for (var j = 0; j < e.changedTouches.length; j++) delete last[e.changedTouches[j].identifier];
    }
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end);
    canvas.addEventListener('touchcancel', end);
    // mouse per desktop
    var mdown = false;
    canvas.addEventListener('mousedown', function (e) { mdown = true; last['m'] = pos(e); });
    canvas.addEventListener('mousemove', function (e) {
      if (!mdown) return;
      var p = pos(e);
      var l = last['m'] || p;
      ctx.strokeStyle = '#f5a623';
      ctx.lineWidth = 6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(l.x, l.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      last['m'] = p;
    });
    window.addEventListener('mouseup', function () { mdown = false; });
  }

  /* ---------------- 3) ALTOPARLANTE ---------------- */
  var audioCtx = null;

  function tone(freq, ms, pan) {
    return new Promise(function (resolve) {
      var ctx = audioCtx;
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      var panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.value = 0.0001;
      osc.connect(gain);
      if (panner) { panner.pan.value = pan || 0; gain.connect(panner); panner.connect(ctx.destination); }
      else gain.connect(ctx.destination);
      var t = ctx.currentTime;
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.03);
      gain.gain.setValueAtTime(0.25, t + ms / 1000 - 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
      osc.start(t);
      osc.stop(t + ms / 1000 + 0.05);
      osc.onended = resolve;
    });
  }

  function audioTest() {
    var stage = baseBar('Test altoparlante', 'Alza il volume. Toni: sinistra → destra → entrambi.');
    var wrap = document.createElement('div');
    wrap.className = 'mic-meter';
    wrap.style.color = '#fff';
    wrap.innerHTML =
      '<h3 style="margin:0 0 14px">Ascolta…</h3>' +
      '<div id="audioStatus" style="font-size:15px;min-height:24px;margin-bottom:10px"></div>' +
      '<button class="btn btn-primary" id="audioReplay">▶️ Ripeti</button>';
    stage.appendChild(wrap);

    function playSeq() {
      try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) {
        document.getElementById('audioStatus').textContent = 'Audio non disponibile in questo contesto.';
        return;
      }
      var st = document.getElementById('audioStatus');
      st.textContent = '🔊 Canale SINISTRO…';
      tone(440, 900, -1).then(function () {
        st.textContent = '🔊 Canale DESTRO…';
        return tone(440, 900, 1);
      }).then(function () {
        st.textContent = '🔊 ENTRAMBI (100 → 8000 Hz sweep)…';
        return tone(100, 500, 0).then(function () { return tone(1200, 500, 0); }).then(function () { return tone(6000, 600, 0); });
      }).then(function () {
        st.textContent = '✅ Fatto. Hai sentito tutto? Volume alto = altoparlante OK; suono attutito = fori da pulire.';
      });
    }
    document.getElementById('audioReplay').addEventListener('click', playSeq);
    playSeq();
  }

  /* ---------------- 4) MICROFONO ---------------- */
  var micStream = null;

  function micTest() {
    var stage = baseBar('Test microfono — parla per 5 secondi', 'La barra deve muoversi mentre parli. Ferma = microfono rotto/ostruito.');
    var wrap = document.createElement('div');
    wrap.className = 'mic-meter';
    wrap.style.color = '#fff';
    wrap.innerHTML =
      '<h3 style="margin:0 0 14px">🎙️ Parla ora</h3>' +
      '<div class="bar"><i id="micBar" style="width:0%"></i></div>' +
      '<div id="micStatus" style="font-size:14px;margin-top:10px;min-height:22px">Richiesta permesso microfono…</div>' +
      '<div id="micResult" style="font-size:20px;font-weight:800;margin-top:10px;min-height:28px"></div>';
    stage.appendChild(wrap);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      document.getElementById('micStatus').textContent = 'API microfono non disponibile qui (usa l\'app Android o un server locale).';
      return;
    }

    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      micStream = stream;
      document.getElementById('micStatus').textContent = 'In ascolto…';
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var src = ctx.createMediaStreamSource(stream);
      var an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      var buf = new Float32Array(an.fftSize);
      var maxLevel = 0;
      var t0 = performance.now();

      function loop() {
        an.getFloatTimeDomainData(buf);
        var peak = 0;
        for (var i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
        maxLevel = Math.max(maxLevel, peak);
        var el = document.getElementById('micBar');
        if (!el) { // test chiuso
          try { ctx.close(); } catch (e) {}
          return;
        }
        el.style.width = Math.min(100, peak * 160) + '%';
        var secs = (performance.now() - t0) / 1000;
        var res = document.getElementById('micResult');
        if (secs > 5) {
          src.disconnect();
          stream.getTracks().forEach(function (t) { t.stop(); });
          try { ctx.close(); } catch (e) {}
          el.style.width = '0%';
          if (maxLevel > 0.25) { res.textContent = '✅ Microfono OK (picco ' + Math.round(maxLevel * 100) + '%)'; res.style.color = '#3fb950'; }
          else if (maxLevel > 0.02) { res.textContent = '⚠️ Segnale debole (' + Math.round(maxLevel * 100) + '%): pulisci il foro microfono'; res.style.color = '#d29922'; }
          else { res.textContent = '❌ Nessun segnale: microfono guasto o permesso negato'; res.style.color = '#f85149'; }
          document.getElementById('micStatus').textContent = 'Test completato.';
          return;
        }
        document.getElementById('micStatus').textContent = 'In ascolto… ' + (5 - secs).toFixed(1) + 's (picco ' + Math.round(maxLevel * 100) + '%)';
        requestAnimationFrame(loop);
      }
      loop();
    }).catch(function (err) {
      var s = document.getElementById('micStatus');
      if (s) s.textContent = 'Permesso microfono negato o non disponibile: ' + (err && err.name || '') + '. Nell\'app Android concedi il permesso quando richiesto.';
    });
  }

  /* ---------------- API pubblica ---------------- */
  return {
    start: function (which) {
      if (which === 'pixel') pixelTest();
      else if (which === 'touch') touchTest();
      else if (which === 'audio') audioTest();
      else if (which === 'mic') micTest();
    },
    close: close
  };
})();
