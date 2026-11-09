# Kanga Toolkit — App Android (Kotlin)

App Android nativa che esegue la **stessa UI** della cartella `core/` dentro una
WebView, estendendola con un bridge JavaScript (`KangaNative`) verso le API di
sistema: batteria, memoria, storage per-app, sensori, termico, rete, vibrazione,
microfono.

## Compilare

### Android Studio (consigliato)
1. **Open** → seleziona la cartella `android/` di questo progetto.
2. Attendi la sincronizzazione Gradle: il task `copyCoreAssets` copia
   automaticamente `../core` negli asset dell'APK.
3. **Run ▶️** su dispositivo o emulatore (minimo Android 8.0 / API 26).

### Riga di comando
```bash
cd android
./gradlew assembleDebug   # i wrapper Gradle sono già inclusi
# APK → app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Se i pacchetti SDK mancassero su una nuova macchina:
```bat
scripts\install-sdk-packages.bat            # installa platform-tools, android-35, build-tools
```

> **Stato su questo PC (nov 2026): build verificata** — APK debug 3,3 MB compilato con
> JDK 17 (Microsoft OpenJDK), Gradle 8.9 e SDK in `%LOCALAPPDATA%\Android\Sdk`,
> installato e avviato su uno Xiaomi Redmi (Android 14) via ADB.
> Su MIUI serve "Installazione tramite USB" nelle opzioni sviluppatore.

> Serve JDK 17 (incluso in Android Studio). Per l'installazione diretta via
> `adb install` abilita "Origini sconosciute" se richiesto.

## Permessi

| Permesso | Quando serve | Note |
|---|---|---|
| `INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE` | modulo Connettività | normali |
| `VIBRATE` | test vibrazione | normale |
| `RECORD_AUDIO` | test microfono | runtime, richiesto in-app |
| `PACKAGE_USAGE_STATS` | spazio per-app | speciale: Impostazioni → Accesso dati di utilizzo |
| `QUERY_ALL_PACKAGES` | elenco app per lo storage | strumento personale/sideload; Play Store potrebbe richiedare motivazione |

## Architettura del bridge

```
JS (core/)                          Kotlin
─────────────────────────────       ─────────────────────────────
KangaNative.run(cmd, payload, id) → @JavascriptInterface run()
                                    executor → handle(cmd)
window.__kangaNativeResult(id,  ←   evaluateJavascript(...)
  ok, json)
```

Comandi disponibili: `ping`, `deviceInfo`, `battery`, `memory`, `storage`,
`storageApps`, `thermal`, `sensors`, `network`, `vibrate`, `micTest`,
`clearMyCache`, `requestUsagePermission`, `requestMicPermission`, `share`.

Tutti i dati restano sul dispositivo: nessuna chiamata di rete oltre al ping
di test verso 8.8.8.8.
