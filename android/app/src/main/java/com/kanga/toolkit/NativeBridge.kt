package com.kanga.toolkit

import android.Manifest
import android.annotation.SuppressLint
import android.app.AppOpsManager
import android.content.Context
import android.content.Intent
import android.hardware.Sensor
import android.hardware.SensorManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaDrm
import android.media.MediaRecorder
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.TrafficStats
import android.net.wifi.WifiManager
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.Process
import android.os.StatFs
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.provider.Settings
import android.telephony.TelephonyManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors

/**
 * Ponte JavaScript ↔ Kotlin per la diagnostica nativa.
 * La UI (core/) chiama: KangaNative.run("comando", "{json}", callbackId)
 * e riceve il risultato tramite window.__kangaNativeResult(...).
 */
@Suppress("DEPRECATION")
class NativeBridge(private val activity: MainActivity, private val webView: WebView) {

    private val executor = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private val ctx: Context = activity.applicationContext

    @JavascriptInterface
    fun run(cmd: String, payloadJson: String, cbId: String) {
        executor.execute {
            var ok: Boolean
            var result: JSONObject
            try {
                val payload = if (payloadJson.isBlank()) JSONObject() else JSONObject(payloadJson)
                result = handle(cmd, payload)
                ok = true
            } catch (e: SecurityException) {
                ok = false
                result = JSONObject().put("error", "Permesso mancante: ${e.message}")
            } catch (e: Exception) {
                ok = false
                result = JSONObject().put("error", e.message ?: e.toString())
            }
            val cbJson = result.toString().replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n")
            val js = "window.__kangaNativeResult('$cbId', $ok, '$cbJson');"
            main.post { webView.evaluateJavascript(js, null) }
        }
    }

    /* ==================== dispatch ==================== */

    private fun handle(cmd: String, p: JSONObject): JSONObject = when (cmd) {
        "ping" -> JSONObject().put("pong", true)
        "deviceInfo" -> deviceInfo()
        "battery" -> battery()
        "memory" -> memory()
        "storage" -> storage()
        "storageApps" -> storageApps()
        "thermal" -> thermal()
        "sensors" -> sensors()
        "network" -> network()
        "vibrate" -> vibrate(p.optInt("ms", 800))
        "micTest" -> micTest(p.optInt("ms", 2500))
        "clearMyCache" -> clearMyCache()
        "requestUsagePermission" -> { openUsageSettings(); JSONObject().put("ok", true) }
        "requestMicPermission" -> { activity.requestMicPermissionFromBridge(); JSONObject().put("ok", true) }
        "share" -> share(p.optString("text", ""), p.optString("subject", "Report Kanga Toolkit"))
        "drm" -> drmInfo()
        "traffic" -> traffic()
        "powerSave" -> powerSave()
        "securityFlags" -> securityFlags()
        "appVersion" -> appVersion(p.optString("package"))
        "openCamera" -> { openCamera(); JSONObject().put("ok", true) }
        "pingHost" -> ping(p.optString("host", "8.8.8.8"))
        else -> throw IllegalArgumentException("comando sconosciuto: $cmd")
    }

    /* ==================== handler ==================== */

    private fun deviceInfo(): JSONObject {
        val dm = ctx.resources.displayMetrics
        var refresh = 60f
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            activity.display?.let { refresh = it.refreshRate }
        } else {
            @Suppress("DEPRECATION")
            refresh = activity.windowManager.defaultDisplay.refreshRate
        }
        return JSONObject()
            .put("model", Build.MODEL)
            .put("device", Build.DEVICE)
            .put("manufacturer", Build.MANUFACTURER)
            .put("brand", Build.BRAND)
            .put("release", Build.VERSION.RELEASE)
            .put("sdk", Build.VERSION.SDK_INT)
            .put("securityPatch", Build.VERSION.SECURITY_PATCH ?: "")
            .put("widthPx", dm.widthPixels)
            .put("heightPx", dm.heightPixels)
            .put("densityDpi", dm.densityDpi)
            .put("refreshHz", refresh.toDouble())
            .put("uptimeMs", SystemClock.elapsedRealtime())
    }

    private fun batteryIntent(): android.content.Intent? {
        return ctx.registerReceiver(null, android.content.IntentFilter(Intent.ACTION_BATTERY_CHANGED))
    }

    private fun battery(): JSONObject {
        val it = batteryIntent()
        val bm = ctx.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
        val out = JSONObject()
        if (it != null) {
            val level = it.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
            val scale = it.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
            if (level >= 0 && scale > 0) out.put("level", level * 100 / scale)
            val status = it.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
            val statusLabel = when (status) {
                BatteryManager.BATTERY_STATUS_CHARGING -> "In carica"
                BatteryManager.BATTERY_STATUS_DISCHARGING -> "In scarica"
                BatteryManager.BATTERY_STATUS_FULL -> "Carica completa"
                BatteryManager.BATTERY_STATUS_NOT_CHARGING -> "Non in carica"
                else -> "Sconosciuto"
            }
            out.put("statusLabel", statusLabel)
            val health = it.getIntExtra(BatteryManager.EXTRA_HEALTH, -1)
            val healthLabel = when (health) {
                BatteryManager.BATTERY_HEALTH_GOOD -> "Buona"
                BatteryManager.BATTERY_HEALTH_OVERHEAT -> "Surriscaldata"
                BatteryManager.BATTERY_HEALTH_DEAD -> "Guasta"
                BatteryManager.BATTERY_HEALTH_OVER_VOLTAGE -> "Sovratensione"
                BatteryManager.BATTERY_HEALTH_COLD -> "Troppo fredda"
                else -> "Sconosciuta"
            }
            out.put("health", health).put("healthLabel", healthLabel)
            val temp = it.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, -1)
            if (temp > 0) out.put("temperature", temp / 10.0)
            val volt = it.getIntExtra(BatteryManager.EXTRA_VOLTAGE, -1)
            if (volt > 0) out.put("voltageMv", volt)
            out.put("technology", it.getStringExtra(BatteryManager.EXTRA_TECHNOLOGY) ?: "")
            // cicli di ricarica: extra pubblico da Android 14 (API 34)
            if (Build.VERSION.SDK_INT >= 34) {
                val cycles = it.getIntExtra(BatteryManager.EXTRA_CYCLE_COUNT, -1)
                if (cycles >= 0) out.put("cycleCount", cycles)
            }
        }
        // contatore di carica attuale dal BatteryManager (µAh)
        try {
            val counter = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CHARGE_COUNTER)
            if (counter > 0) out.put("chargeCounter", counter)
        } catch (e: Exception) { /* non disponibile */ }
        // capacità attuale e di progetto: sysfs (se leggibile dal produttore)
        try {
            val full = readOneLine("/sys/class/power_supply/battery/charge_full")
            if (full != null) out.put("chargeFull", full.toLong())
        } catch (e: Exception) { /* non esposto */ }
        try {
            val design = readOneLine("/sys/class/power_supply/battery/charge_full_design")
            if (design != null) out.put("chargeFullDesign", design.toLong())
        } catch (e: Exception) { /* non esposto */ }
        return out
    }

    private fun readOneLine(path: String): String? {
        return try {
            File(path).bufferedReader().use { it.readLine()?.trim() }
        } catch (e: Exception) { null }
    }

    private fun memory(): JSONObject {
        val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as android.app.ActivityManager
        val mi = android.app.ActivityManager.MemoryInfo()
        am.getMemoryInfo(mi)
        var myPss = 0L
        try {
            val dmi = am.getProcessMemoryInfo(intArrayOf(Process.myPid()))?.firstOrNull()
            if (dmi != null) myPss = dmi.totalPss * 1024L
        } catch (e: Exception) { /* opzionale */ }
        return JSONObject()
            .put("totalMem", mi.totalMem)
            .put("availMem", mi.availMem)
            .put("threshold", mi.threshold)
            .put("lowMemory", mi.lowMemory)
            .put("myPss", myPss)
    }

    private fun storageVolumeFile(): File = Environment.getExternalStorageDirectory()

    private fun storage(): JSONObject {
        val f = storageVolumeFile()
        val stat = StatFs(f.absolutePath)
        val total = stat.totalBytes
        val avail = stat.availableBytes
        var myCache = 0L
        ctx.cacheDir?.let { myCache += dirSize(it) }
        ctx.externalCacheDir?.let { myCache += dirSize(it) }
        return JSONObject()
            .put("totalBytes", total)
            .put("availBytes", avail)
            .put("myCacheBytes", myCache)
            .put("usagePermission", hasUsagePermission())
    }

    @SuppressLint("QueryPermissionsNeeded") // QUERY_ALL_PACKAGES nel manifest: strumento personale
    private fun storageApps(): JSONObject {
        if (!hasUsagePermission()) return JSONObject().put("error", "Permesso 'Accesso dati di utilizzo' non concesso")
        val ssm = ctx.getSystemService(Context.STORAGE_STATS_SERVICE) as android.app.usage.StorageStatsManager
        val pm = ctx.packageManager
        val vol = android.os.storage.StorageManager.UUID_DEFAULT // archivio principale
        val user = android.os.Process.myUserHandle()
        val list = mutableListOf<Triple<String, Long, Long>>() // nome, totale, cache
        for (pkg in pm.getInstalledPackages(0)) {
            try {
                val stats = ssm.queryStatsForPackage(vol, pkg.packageName, user)
                val total = stats.appBytes + stats.dataBytes
                val cache = stats.cacheBytes
                if (total > 5L * 1024 * 1024) { // solo app > 5 MB
                    val name = pm.getApplicationLabel(pkg.applicationInfo ?: continue).toString()
                    list.add(Triple(name, total, cache))
                }
            } catch (e: Exception) { /* salta pacchetti inaccessibili */ }
        }
        list.sortByDescending { it.second }
        val arr = JSONArray()
        list.take(15).forEach {
            arr.put(JSONObject().put("name", it.first).put("total", it.second).put("cache", it.third))
        }
        return JSONObject().put("list", arr)
    }

    private fun dirSize(dir: File?): Long {
        if (dir == null || !dir.exists()) return 0
        var size = 0L
        dir.walkTopDown().forEach { f -> if (f.isFile) size += f.length() }
        return size
    }

    private fun hasUsagePermission(): Boolean {
        return try {
            val appOps = ctx.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
            @Suppress("DEPRECATION") // checkOpNoThrow: compatibile da API 21
            val mode = appOps.checkOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(), ctx.packageName
            )
            mode == AppOpsManager.MODE_ALLOWED
        } catch (e: Exception) { false }
    }

    private fun openUsageSettings() {
        main.post {
            try {
                activity.startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
            } catch (e: Exception) { /* non disponibile */ }
        }
    }

    private fun thermal(): JSONObject {
        val out = JSONObject()
        val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val st = pm.currentThermalStatus
            val label = when (st) {
                PowerManager.THERMAL_STATUS_NONE -> "Normale"
                PowerManager.THERMAL_STATUS_LIGHT -> "Leggero"
                PowerManager.THERMAL_STATUS_MODERATE -> "Moderato"
                PowerManager.THERMAL_STATUS_SEVERE -> "Severo"
                PowerManager.THERMAL_STATUS_CRITICAL -> "Critico"
                PowerManager.THERMAL_STATUS_EMERGENCY -> "Emergenza"
                PowerManager.THERMAL_STATUS_SHUTDOWN -> "Spegnimento imminente"
                else -> "Sconosciuto"
            }
            out.put("status", st).put("statusLabel", label)
        }
        batteryIntent()?.let {
            val temp = it.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, -1)
            if (temp > 0) out.put("batteryTemp", temp / 10.0)
        }
        return out
    }

    private fun sensors(): JSONObject {
        val sm = ctx.getSystemService(Context.SENSOR_SERVICE) as SensorManager
        val arr = JSONArray()
        sm.getSensorList(Sensor.TYPE_ALL).forEach { s ->
            arr.put(JSONObject()
                .put("name", s.name)
                .put("type", s.stringType)
                .put("vendor", s.vendor)
                .put("power", s.power.toDouble())
                .put("resolution", s.resolution.toDouble()))
        }
        return JSONObject().put("list", arr)
    }

    private fun network(): JSONObject {
        val out = JSONObject()
        val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val caps = cm.getNetworkCapabilities(cm.activeNetwork)
        out.put("online", caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET))

        try {
            val wm = ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            val info = wm.connectionInfo
            if (info != null && info.ipAddress != 0) {
                out.put("wifiRssi", info.rssi)
                out.put("wifiLink", info.linkSpeed)
                out.put("wifiFreq", info.frequency)
                if (!info.ssid.isNullOrBlank() && info.ssid != "<unknown ssid>") {
                    out.put("wifiSsid", info.ssid.removePrefix("\"").removeSuffix("\""))
                }
            }
        } catch (e: Exception) { /* posizione/servizio non disponibile */ }

        try {
            val tm = ctx.getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
            tm.signalStrength?.let { out.put("cellLevel", it.level) } // 0..4
        } catch (e: Exception) { /* SIM/permessi assenti */ }

        try {
            val bm = ctx.getSystemService(Context.BLUETOOTH_SERVICE) as android.bluetooth.BluetoothManager
            out.put("bluetoothOn", bm.adapter?.isEnabled == true)
        } catch (e: Exception) { /* permesso non concesso su API 31+ */ }

        try {
            val mode = Settings.Global.getString(ctx.contentResolver, "private_dns_mode")
            val spec = Settings.Global.getString(ctx.contentResolver, "private_dns_specifier")
            if (!mode.isNullOrBlank()) out.put("privateDns", if (spec.isNullOrBlank()) mode else "$mode ($spec)")
        } catch (e: Exception) { /* non leggibile */ }

        out.put("ping", ping("8.8.8.8"))
        return out
    }

    private fun drmInfo(): JSONObject {
        return try {
            // UUID Widevine: edef8ba9-79d6-4ace-a3c8-27dcd51d21ed
            val widevine = java.util.UUID.fromString("edef8ba9-79d6-4ace-a3c8-27dcd51d21ed")
            val drm = MediaDrm(widevine)
            val level = drm.getPropertyString("securityLevel")
            val version = try { drm.getPropertyString("systemId") ?: "" } catch (e: Exception) { "" }
            drm.close()
            JSONObject().put("widevine", level ?: "").put("version", version)
        } catch (e: Exception) {
            JSONObject().put("widevine", "").put("error", e.message ?: "drm non disponibile")
        }
    }

    private fun traffic(): JSONObject {
        return JSONObject()
            .put("rxAll", TrafficStats.getTotalRxBytes())
            .put("txAll", TrafficStats.getTotalTxBytes())
            .put("rxMobile", TrafficStats.getMobileRxBytes())
            .put("txMobile", TrafficStats.getMobileTxBytes())
    }

    private fun powerSave(): JSONObject {
        val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
        return JSONObject().put("on", pm.isPowerSaveMode)
    }

    private fun securityFlags(): JSONObject {
        val out = JSONObject()
        try { out.put("adb", Settings.Global.getInt(ctx.contentResolver, "adb_enabled", 0)) } catch (e: Exception) { out.put("adb", -1) }
        try { out.put("devSettings", Settings.Global.getInt(ctx.contentResolver, "development_settings_enabled", 0)) } catch (e: Exception) { out.put("devSettings", -1) }
        return out
    }

    private fun appVersion(pkg: String): JSONObject {
        return if (pkg.isBlank()) JSONObject().put("error", "package mancante")
        else try {
            val pi = ctx.packageManager.getPackageInfo(pkg, 0)
            JSONObject().put("version", pi.versionName ?: "?").put("firstInstall", pi.firstInstallTime)
        } catch (e: Exception) { JSONObject().put("error", "app non trovata") }
    }

    private fun openCamera() {
        main.post {
            try {
                activity.startActivity(Intent(android.provider.MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA))
            } catch (e: Exception) { /* nessuna app fotocamera */ }
        }
    }

    private fun ping(host: String): JSONObject {
        return try {
            val p = Runtime.getRuntime().exec(arrayOf("/system/bin/ping", "-c", "4", "-W", "2", host))
            val text = p.inputStream.bufferedReader().readText() + p.errorStream.bufferedReader().readText()
            p.waitFor()
            val m = Regex("(\\d+) packets transmitted,\\s*(\\d+) (received|received,)").find(text)
            val avg = Regex("(?:rtt|round-trip)[^=]*=\\s*[\\d.]+/([\\d.]+)").find(text)
            val sent = m?.groupValues?.get(1)?.toIntOrNull() ?: 0
            val recv = m?.groupValues?.get(2)?.toIntOrNull() ?: 0
            JSONObject()
                .put("sent", sent)
                .put("recv", recv)
                .put("loss", if (sent > 0) (sent - recv) * 100 / sent else 100)
                .put("avgMs", avg?.groupValues?.get(1)?.toDoubleOrNull() ?: JSONObject.NULL)
        } catch (e: Exception) {
            JSONObject().put("sent", 0).put("recv", 0).put("loss", 100).put("avgMs", JSONObject.NULL)
        }
    }

    private fun vibrate(ms: Int): JSONObject {
        val vib = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val vm = ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as android.os.VibratorManager
            vm.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            ctx.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
        if (vib.hasVibrator()) {
            vib.vibrate(VibrationEffect.createOneShot(ms.toLong(), VibrationEffect.DEFAULT_AMPLITUDE))
            return JSONObject().put("ok", true)
        }
        return JSONObject().put("ok", false).put("error", "Nessun motore vibrazione")
    }

    /** Registra dal microfono per ms millisecondi e restituisce il picco (0..1). */
    private fun micTest(ms: Int): JSONObject {
        if (ctx.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            activity.requestMicPermissionFromBridge()
            return JSONObject().put("error", "Permesso microfono mancante: concedilo e riprova")
        }
        val rate = 16000
        val minBuf = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        if (minBuf <= 0) return JSONObject().put("error", "Microfono non disponibile")
        val rec = AudioRecord(MediaRecorder.AudioSource.MIC, rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, minBuf * 2)
        return try {
            rec.startRecording()
            val buf = ShortArray(1024)
            var peak = 0.0
            val t0 = System.currentTimeMillis()
            while (System.currentTimeMillis() - t0 < ms) {
                val n = rec.read(buf, 0, buf.size)
                for (i in 0 until n) {
                    val v = kotlin.math.abs(buf[i].toDouble()) / 32768.0
                    if (v > peak) peak = v
                }
            }
            rec.stop()
            JSONObject().put("ok", true).put("peak", peak).put("verdict",
                if (peak > 0.25) "ok" else if (peak > 0.02) "debole" else "muto")
        } finally {
            rec.release()
        }
    }

    private fun clearMyCache(): JSONObject {
        var freed = 0L
        ctx.cacheDir?.let { freed += dirSize(it); it.deleteRecursively() }
        ctx.externalCacheDir?.let { freed += dirSize(it); it.deleteRecursively() }
        return JSONObject().put("freed", freed)
    }

    private fun share(text: String, subject: String): JSONObject {
        main.post {
            val i = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_TEXT, text)
                putExtra(Intent.EXTRA_SUBJECT, subject)
            }
            try {
                activity.startActivity(Intent.createChooser(i, "Condividi report"))
            } catch (e: Exception) { /* nessuna app */ }
        }
        return JSONObject().put("ok", true)
    }
}
