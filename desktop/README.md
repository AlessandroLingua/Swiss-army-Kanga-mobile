# Kanga Toolkit — App Desktop (Electron)

App desktop per **Windows, macOS e Linux** che trasforma il PC in una postazione di
diagnostica Android: collega il telefono via USB e analizza batteria, prestazioni,
spazio, sicurezza, rete e temperatura **senza installare nulla sul telefono** (solo ADB).

## Avvio rapido

```bash
npm install        # installa Electron (richiede Node.js 18+)
npm start          # avvia Kanga Toolkit
```

## ADB

L'app usa ADB (Android Debug Bridge). In ordine di priorità cerca il binario in:

1. percorso scelto manualmente (Impostazioni → "Scegli adb…")
2. variabile d'ambiente `ADB_PATH`
3. `desktop/bin/platform-tools/` (scaricabile dall'app o con `npm run fetch-adb`)
4. Android SDK / PATH di sistema

Per scaricare i platform-tools ufficiali di Google:
```bash
npm run fetch-adb     # → bin/platform-tools/adb(.exe)
```

Sul telefono: **Opzioni sviluppatore → Debug USB** attivo, poi accettare
il messaggio "Consenti debug USB" al primo collegamento.

## Comandi

| Comando | Descrizione |
|---|---|
| `npm start` | avvia l'app in sviluppo |
| `npm run fetch-adb` | scarica ADB in `bin/platform-tools` |
| `npm run dist` | crea gli installer (NSIS `.exe`, `.dmg`, `.AppImage`) in `dist/` |

`npm run dist` include la UI tramite `extraResources` (copia `../core` in `resources/app-ui` dentro il pacchetto).

> Nota build su Windows: in `build.win` è impostato `"signAndEditExecutable": false`
> perché l'estrazione di winCodeSign (link simbolici macOS) fallisce senza privilegi
> amministrativi. L'icona sull'exe la mette comunque NSIS. Se GitHub è lento, esportare
> `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`.

## Struttura

```
desktop/
├── main.js               processo principale: finestra, IPC, server test HW
├── preload.js            ponte sicuro renderer ↔ main
├── lib/adb.js            ricerca/esecuzione ADB + parsing dispositivi
├── scripts/fetch-adb.js  download platform-tools (zero dipendenze)
└── build/                icone (icon.ico, icon.png, PNG sorgenti)
```

## Come funziona la diagnostica

Tutti i dati arrivano da comandi ADB pubblici e non distruttivi:
`dumpsys battery|cpuinfo|wifi|thermalservice|sensorservice`, `getprop`,
`cat /proc/meminfo`, `df`, `du`, `settings`, `pm list`, `ping`.
Le azioni che modificano lo stato del telefono (es. `pm trim-caches`,
`svc wifi restart`) richiedono sempre conferma esplicita nella UI.

Il trucco "Apri test sul telefono": l'app avvia un mini-server HTTP locale,
fa `adb reverse` (il telefono vede la porta del PC su `127.0.0.1`) e apre
Chrome sul telefono alla pagina dei test hardware a schermo intero.
