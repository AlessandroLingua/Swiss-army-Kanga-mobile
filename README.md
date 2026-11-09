# 🦘 Kanga Toolkit

**Il coltellino svizzero per Android** — una suite diagnostica completa che gira su **Windows, macOS e Linux** (app desktop) e **sul telefono** (app Android nativa), con la stessa interfaccia.

Collega il telefono, premi **Check-up completo** e ottieni un report con punteggio su tutte le patologie tipiche di uno smartphone che invecchia — più gli strumenti per intervenire.

| Area | Cosa fa |
|---|---|
| 🔋 **Batteria** | Salute e capacità effettiva (mAh reali dal contatore di carica), cicli, temperatura, consigli anti-degrado. Con il **Laboratorio Batteria**: monitoraggio live, consumo in mA, autonomia residua reale e procedura guidata di ricalibrazione del misuratore. |
| ⚡ **Prestazioni** | RAM, CPU, processi pesanti, benchmark di fluidità; azioni concrete (animazioni 0,5×, chiusura background). |
| 💾 **Spazio** | Occupazione della memoria, cartelle più pesanti, pulizia cache sicura, spazio per-app (su telefono). |
| 🛡️ **Sicurezza** | Data dell'ultima patch di sicurezza, età del sistema, stato del boot verificato, stima del supporto del produttore. |
| 📶 **Connettività** | Potenza Wi-Fi (dBm), segnale cellulare, Bluetooth, ping reale; riavvio radio (con conferma). |
| 🔩 **Hardware** | Test interattivi a schermo intero: pixel morti, multi-touch, altoparlante, microfono, vibrazione. |
| 🌡️ **Temperatura** | Temperatura batteria, stato di throttling, zone termiche del SoC. |

Ogni modulo produce un **punteggio 0–100**; il check-up genera un **report esportabile** (Markdown/JSON, condivisibile dal telefono).

---

## 🏗️ Architettura

Un'unica interfaccia ([`core/`](core/), HTML/CSS/JS puro, zero dipendenze) che sceglie a runtime il motore disponibile:

```
                 ┌──────────────────────────────┐
                 │       core/  (UI + logica)   │
                 │   Kanga.engine.mode = …      │
                 └──────┬───────────┬───────┬───┘
                        │           │       │
      window.kangaDesktop   window.KangaNative   API del browser
          (Electron)           (app Android)      (fallback)
                        │           │       │
              ┌─────────▼───┐ ┌─────▼─────┐ ┌▼──────────┐
              │ IPC → spawn │ │  Kotlin   │ │  Web      │
              │    ADB      │ │  bridge   │ │ (limiti   │
              │             │ │  nativo   │ │  browser) │
              └─────────────┘ └───────────┘ └───────────┘
```

- **Desktop**: il telefono si collega via USB (debug USB attivo) e viene letto **solo con comandi ADB pubblici e non distruttivi** (`dumpsys`, `getprop`, `df`, `du`, `settings`…). Nulla viene installato sul telefono.
- **Android**: una WebView carica `core/` e un bridge Kotlin (`KangaNative`) espone le API di sistema (batteria, memoria, storage per-app, sensori, termico, rete, vibrazione, microfono).
- **Browser**: fallback con le API permesse (benchmark, spazio del browser, rete) — utile per provare la UI senza installare nulla.
- Ogni modulo degrada con grazia: dichiara cosa può fare in ciascuna modalità e lo dice chiaramente a schermo.
- I moduli possono montare pannelli propri nella pagina (`renderExtra`) — è così che nasce il Laboratorio Batteria.

```
Swiss-army-Kanga-mobile/
├── core/                  UI e logica condivisa (la "mente")
│   ├── index.html
│   └── assets/
│       ├── css/kanga.css
│       └── js/            engine, parsers, modules, hwtest, framework UI
├── desktop/               App Electron (Win / macOS / Linux)
│   ├── main.js            finestra, IPC, mini-server per i test sul telefono
│   ├── preload.js         ponte sicuro renderer ↔ main
│   ├── lib/adb.js         ricerca/esecuzione ADB, polling dispositivi
│   └── scripts/           fetch-adb (download platform-tools), prepare-build
└── android/               App Android nativa (Kotlin)
    ├── app/src/main/java/com/kanga/toolkit/
    │   ├── MainActivity.kt    WebView + permessi
    │   └── NativeBridge.kt    15 comandi nativi per il bridge JS
    └── scripts/install-sdk-packages.bat   (setup SDK su nuove macchine)
```

---

## 🖥️ Desktop — Windows / macOS / Linux

### Prerequisiti
- **Node.js 18+** (<https://nodejs.org>; su Windows: `winget install OpenJS.NodeJS.LTS`)
- **ADB**: non serve installarlo a mano — vedi sotto.

### Avvio
```bash
cd desktop
npm install
npm start
```

> **npm 11+**: se dopo `npm install` Electron non parte ("failed to install correctly"),
> il nuovo blocco script di npm ha saltato il postinstall: esegui
> `npm approve-scripts electron` e, se la cartella `node_modules/electron/dist`
> resta incompleta, rilancia `node node_modules/electron/install.js`.

### ADB
L'app cerca il binario in ordine: percorso scelto in **Impostazioni** → variabile `ADB_PATH` → `desktop/bin/platform-tools/` (scaricabile **dall'app** o con `npm run fetch-adb`) → Android SDK / PATH di sistema.

### Collegare il telefono
1. **Opzioni sviluppatore**: tappa 7 volte su "Numero build" (Impostazioni → Info telefono).
2. Attiva **Debug USB**.
3. Collega via USB e conferma "Consenti debug USB" sul telefono.
4. La barra in alto mostra il telefono: tutti i moduli si attivano.

**Su Xiaomi/MIUI**: per l'installazione di APK via ADB serve anche "Installazione tramite USB" nelle opzioni sviluppatore.

### Creare gli installer
```bash
cd desktop
npm run dist      # .exe (NSIS) / .dmg / .AppImage → desktop/dist/
```
La build copia automaticamente `core/` dentro il pacchetto (script `predist`).

### Il trucco "Apri test sul telefono"
I test hardware a schermo intero girano meglio sul telefono: l'app avvia un mini-server
HTTP locale, fa `adb reverse` (il telefono vede la porta del PC) e apre Chrome sul
telefono alla pagina dei test — senza installare alcunché.

---

## 📱 Android

### Android Studio (consigliato)
1. **Open** → cartella [`android/`](android/).
2. Sync Gradle: il task `copyCoreAssets` copia da solo `../core` negli asset dell'APK.
3. **Run ▶️** (minimo Android 8.0 / API 26).

### Riga di comando
```bash
cd android
./gradlew assembleDebug          # wrapper Gradle incluso
adb install -r app/build/outputs/apk/debug/app-debug.apk
```
Se l'SDK non è configurato su una nuova macchina:
```bash
scripts/install-sdk-packages.bat        # platform-tools, android-35, build-tools 35.0.0
```
(e assicurati che `local.properties` punti al tuo SDK, oppure aprilo una volta in Android Studio).

### Permessi
| Permesso | Quando serve | Note |
|---|---|---|
| `RECORD_AUDIO` | test microfono | runtime, richiesto in-app |
| `PACKAGE_USAGE_STATS` | spazio per-app | speciale: Impostazioni → Accesso dati di utilizzo |
| `QUERY_ALL_PACKAGES` | elenco app | strumento personale/sideload |
| `VIBRATE`, rete, Wi-Fi | test e diagnostica | normali |

---

## 🔬 Laboratorio Batteria (in dettaglio)

Il sintomo classico — *percentuale che resta ferma all'1% per un'eternità, o telefono che muore col 30%* — nasce dal **misuratore**: stima la carica dalla tensione e, con una cella degradata, sbaglia. Il Laboratorio (modulo Batteria) misura invece i **mAh reali** dal contatore di carica:

- **Monitoraggio live** (campioni ogni 10 s, salvati in locale): livello, mAh reali, temperatura
- **Consumo/ricarica in mA** e **autonomia residua** vera, indipendente dalla percentuale
- **Capacità effettiva** = ΔmAh / Δlivello, confronto con la capacità di progetto (DB integrato per i modelli comuni + inserimento manuale) → **salute %**
- **Grafico** carica reale vs percentuale dichiarata
- **Guida alla ricalibrazione** in 4 passi + azione "Azzera statistiche batteria" (`dumpsys batterystats --reset`, solo desktop)

> Onestà: la ricalibrazione rimette in sesto la barra, ma i mAh persi non tornano.
> Con salute < 60–70% la soluzione reale è la sostituzione; il Laboratorio ti dà
> i numeri per deciderlo e per verificare la batteria nuova.

---

## 🔒 Privacy e sicurezza

- **Nessun dato lascia il dispositivo**: l'unica comunicazione di rete è il ping di test verso 8.8.8.8 (e il mini-server locale per i test via ADB).
- I comandi ADB usati sono **di lettura**, tranne poche azioni esplicite (`pm trim-caches`, scale animazioni, riavvio radio) sempre **confermate dall'utente** e reversibili.
- Il comando distruttivo `pm clear` (cancellazione dati app) è volutamente **escluso**.

## ⚠️ Limiti noti

- I dati disponibili dipendono dal produttore: molti device (es. Xiaomi) non espongono sysfs batteria, capacità di progetto o cicli — l'app lo dichiara invece di inventare numeri.
- La tabella del supporto OEM è una **stima** modificabile in `core/assets/js/modules.js` (`OEM_PATCH_YEARS`); il DB delle capacità è in `designCapacity()`.
- Le stime di capacità/autonomia sono indicativi: migliorano con periodi di misurazione più lunghi (Δ livello ≥ 3%).

## ✅ Stato del progetto

Verificato su: **Windows 10/11** (app desktop, Electron 33), **POCO F4 GT / Android 14** (app Android via ADB e APK), build Gradle 8.9 + JDK 17.

Fatto: 7 moduli diagnostici · check-up con report esportabile · test hardware fullscreen · Laboratorio Batteria · download ADB integrato · build desktop e Android.

### Roadmap
- [ ] ADB over Wi-Fi (diagnostica senza cavo)
- [ ] Cronologia dei check-up con grafici di degrado nel tempo
- [ ] Esportazione report in PDF
- [ ] Test tasti fisici via input events
- [ ] Suggerimenti di sostituzione batteria per modello (costo/difficoltà)

## 📄 Licenza

MIT — vedi [`desktop/package.json`](desktop/package.json). Il progetto è fornito senza garanzie: usa le azioni avanzate con consapevolezza.
