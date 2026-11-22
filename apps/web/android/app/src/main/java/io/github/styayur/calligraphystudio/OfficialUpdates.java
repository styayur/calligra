package io.github.styayur.calligraphystudio;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "OfficialUpdates")
public class OfficialUpdates extends Plugin {
    private static final String REPOSITORY = "https://github.com/styayur/calligra";
    private static final String LATEST = "https://api.github.com/repos/styayur/calligra/releases/latest";
    private static final String SIGNER = "a65f5079bbcc7762fca3a8877dee0cf11edd7a490c8ab3069ed4ee918666d0cb";
    private static final int MAX_JSON = 1024 * 1024;
    private static final long MAX_APK = 256L * 1024 * 1024;
    private static final Pattern VERSION = Pattern.compile("(0|[1-9][0-9]{0,8})\\.(0|[1-9][0-9]{0,8})\\.(0|[1-9][0-9]{0,8})");
    private static final Pattern SHA256 = Pattern.compile("[0-9a-f]{64}");
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private Offer offer;
    private File verifiedApk;

    @FunctionalInterface
    private interface Operation {
        JSObject run() throws Exception;
    }
    private record Offer(String version, long versionCode, String url, long size, String checksum, String notes) {}

    @PluginMethod
    public void checkUpdate(PluginCall call) {
        run(call, this::check, "CHECK_FAILED");
    }

    @PluginMethod
    public void downloadUpdate(PluginCall call) {
        run(call, this::download, "DOWNLOAD_FAILED");
    }

    @PluginMethod
    public void openInstaller(PluginCall call) {
        run(call, () -> {
            if (offer == null || verifiedApk == null) throw new IOException("No verified APK");
            verifyPackage(verifiedApk, offer);
            if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
                start(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.fromParts("package", getContext().getPackageName(), null)));
                return new JSObject().put("permissions", true);
            }
            Uri file = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".updateprovider", verifiedApk);
            Intent intent = new Intent(Intent.ACTION_INSTALL_PACKAGE)
                    .setData(file)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            start(intent);
            return new JSObject().put("permissions", false);
        }, "INSTALL_FAILED");
    }

    private void start(Intent intent) {
        getActivity().startActivity(intent);
    }

    private void run(PluginCall call, Operation operation, String code) {
        io.execute(() -> {
            try { call.resolve(operation.run()); }
            catch (Exception error) {
                android.util.Log.w("CalligraUpdates", code + " (" + error.getClass().getSimpleName() + ")");
                call.reject("Calligra update operation did not complete", code);
            }
        });
    }

    private JSObject check() throws Exception {
        clearDownload();
        offer = null;
        PackageInfo installed = installedPackage();
        JSONObject latest = readJson(LATEST, true);
        String tag = latest.getString("tag_name");
        if (latest.getBoolean("draft") || latest.getBoolean("prerelease") || !tag.startsWith("v")) {
            throw new IOException("Unexpected release channel");
        }
        String version = tag.substring(1);
        if (compareVersions(version, installed.versionName) <= 0) return new JSObject().put("available", false);
        if (!SIGNER.equals(certificate(installed))) throw new IOException("Unsupported installed signer");

        String base = REPOSITORY + "/releases/download/" + tag + "/";
        JSONArray assets = latest.getJSONArray("assets");
        JSONObject manifestAsset = exactAsset(assets, "release-manifest.json", base);
        String name = "CalligraphyStudio-Android-" + version + ".apk";
        JSONObject asset = exactAsset(assets, name, base);
        if (manifestAsset.getLong("size") < 1 || manifestAsset.getLong("size") > MAX_JSON) throw new IOException("Manifest size");
        JSONObject manifest = readJson(base + "release-manifest.json", false);
        JSONObject signing = manifest.getJSONObject("signing").getJSONObject("android");
        long code = signing.getLong("version_code");
        if (manifest.getInt("schema_version") != 1 || manifest.getBoolean("local_rc") ||
                !manifest.getString("version").equals(version) || !signing.getBoolean("production_ready") ||
                !signing.getString("version").equals(version) || !signing.getString("package_id").equals(installed.packageName) ||
                !signing.getString("certificate_sha256").equals(SIGNER) || code < 1 || code > Integer.MAX_VALUE) {
            throw new IOException("Unapproved release metadata");
        }
        if (code <= versionCode(installed)) return new JSObject().put("available", false);
        JSONObject apk = findAsset(manifest.getJSONArray("assets"), name);
        long size = asset.getLong("size");
        String checksum = apk.getString("sha256");
        if (!apk.getString("platform").equals("android") || size < 1 || size > MAX_APK ||
                apk.getLong("size") != size || !SHA256.matcher(checksum).matches() ||
                (!asset.isNull("digest") && !asset.getString("digest").equals("sha256:" + checksum))) {
            throw new IOException("Unapproved APK metadata");
        }
        String body = latest.optString("body", "");
        offer = new Offer(version, code, base + name, size, checksum, body.substring(0, Math.min(body.length(), 12000)));
        return new JSObject().put("available", true).put("version", version).put("versionCode", code)
                .put("size", size).put("notes", offer.notes()).put("source", REPOSITORY + "/releases/tag/" + tag);
    }

    private JSObject download() throws Exception {
        if (offer == null) throw new IOException("Check for updates first");
        clearDownload();
        File directory = new File(getContext().getCacheDir(), "calligra-updates");
        if (!directory.isDirectory() && !directory.mkdir()) throw new IOException("Cannot create APK cache");
        File file = File.createTempFile("verified-", ".apk", directory);
        HttpURLConnection connection = null;
        try {
            connection = open(offer.url(), false);
            String length = connection.getHeaderField("Content-Length");
            if (length != null && Long.parseLong(length) != offer.size()) {
                throw new IOException("Unexpected response length");
            }
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            try (InputStream input = connection.getInputStream(); OutputStream output = new FileOutputStream(file)) {
                if (boundedCopy(input, output, offer.size(), digest) != offer.size()) throw new IOException("Truncated download");
            }
            if (!offer.checksum().equals(hex(digest.digest()))) throw new IOException("APK checksum mismatch");
            verifyPackage(file, offer);
            verifiedApk = file;
            return new JSObject().put("verified", true);
        } finally {
            if (connection != null) connection.disconnect();
            if (verifiedApk == null && !file.delete()) file.deleteOnExit();
        }
    }

    private void clearDownload() throws IOException {
        if (verifiedApk == null) return;
        if (verifiedApk.exists() && !verifiedApk.delete()) throw new IOException("Cannot remove previous download");
        verifiedApk = null;
    }

    private void verifyPackage(File file, Offer update) throws Exception {
        PackageInfo installed = installedPackage();
        PackageInfo archive = getContext().getPackageManager().getPackageArchiveInfo(file.getAbsolutePath(), signerFlags());
        if (archive == null || !archive.packageName.equals(installed.packageName) || !update.version().equals(archive.versionName) ||
                versionCode(archive) != update.versionCode() || versionCode(archive) <= versionCode(installed) ||
                !SIGNER.equals(certificate(archive)) || !SIGNER.equals(certificate(installed))) throw new IOException("Invalid APK identity");
    }

    private PackageInfo installedPackage() throws PackageManager.NameNotFoundException {
        return getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), signerFlags());
    }

    @SuppressWarnings("deprecation")
    private static int signerFlags() {
        return Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
    }

    @SuppressWarnings("deprecation")
    private static long versionCode(PackageInfo info) {
        return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
    }

    @SuppressWarnings("deprecation")
    private static String certificate(PackageInfo info) throws Exception {
        Signature[] signatures = Build.VERSION.SDK_INT >= 28 ?
                (info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners()) : info.signatures;
        if (signatures == null || signatures.length != 1) throw new IOException("Unexpected APK signer count");
        return hex(MessageDigest.getInstance("SHA-256").digest(signatures[0].toByteArray()));
    }

    static String hex(byte[] digest) {
        StringBuilder result = new StringBuilder(digest.length * 2);
        for (byte value : digest) result.append(String.format(Locale.ROOT, "%02x", value & 0xff));
        return result.toString();
    }

    static int compareVersions(String left, String right) {
        if (left == null || right == null || !VERSION.matcher(left).matches() || !VERSION.matcher(right).matches()) {
            throw new IllegalArgumentException("Only stable numeric semantic versions are supported");
        }
        String[] a = left.split("\\.");
        String[] b = right.split("\\.");
        for (int index = 0; index < 3; index++) {
            int comparison = Integer.compare(Integer.parseInt(a[index]), Integer.parseInt(b[index]));
            if (comparison != 0) return comparison;
        }
        return 0;
    }

    private static JSONObject exactAsset(JSONArray items, String name, String base) throws Exception {
        JSONObject asset = findAsset(items, name);
        if (!asset.getString("state").equals("uploaded") || !asset.getString("browser_download_url").equals(base + name)) {
            throw new IOException("Invalid official asset URL");
        }
        return asset;
    }

    private static JSONObject findAsset(JSONArray items, String name) throws Exception {
        JSONObject found = null;
        for (int index = 0; index < items.length(); index++) {
            JSONObject asset = items.getJSONObject(index);
            if (name.equals(asset.getString("name"))) {
                if (found != null) throw new IOException("Duplicate asset name");
                found = asset;
            }
        }
        if (found == null) throw new IOException("Official Android release asset unavailable");
        return found;
    }

    private static JSONObject readJson(String url, boolean githubApi) throws Exception {
        HttpURLConnection connection = open(url, githubApi);
        try (InputStream input = connection.getInputStream(); ByteArrayOutputStream buffer = new ByteArrayOutputStream()) {
            boundedCopy(input, buffer, MAX_JSON, null);
            return new JSONObject(new String(buffer.toByteArray(), StandardCharsets.UTF_8));
        } finally {
            connection.disconnect();
        }
    }

    static long boundedCopy(InputStream input, OutputStream output, long max, MessageDigest digest) throws IOException {
        byte[] buffer = new byte[32768];
        long total = 0;
        for (int length; (length = input.read(buffer)) != -1;) {
            if (Thread.currentThread().isInterrupted()) throw new IOException("Update cancelled");
            total += length;
            if (total > max) throw new IOException("Download exceeds its size limit");
            output.write(buffer, 0, length);
            if (digest != null) digest.update(buffer, 0, length);
        }
        return total;
    }

    static boolean trustedHost(URL url, boolean githubApi) {
        if (!url.getProtocol().equals("https") || url.getUserInfo() != null || url.getPort() != -1) return false;
        String host = url.getHost().toLowerCase(Locale.ROOT);
        if (githubApi) return host.equals("api.github.com");
        return host.equals("github.com") || host.equals("release-assets.githubusercontent.com") ||
                host.equals("objects.githubusercontent.com");
    }

    private static HttpURLConnection open(String source, boolean githubApi) throws IOException {
        URL url = new URL(source);
        for (int redirects = 0; redirects < 5; redirects++) {
            if (!trustedHost(url, githubApi)) throw new IOException("Untrusted GitHub redirect");
            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(30000);
            connection.setRequestProperty("User-Agent", "Calligra Android");
            if (githubApi) connection.setRequestProperty("Accept", "application/vnd.github+json");
            try {
                int status = connection.getResponseCode();
                if (status == 200) return connection;
                if (status >= 300 && status < 400 && connection.getHeaderField("Location") != null) {
                    url = new URL(url, connection.getHeaderField("Location"));
                } else {
                    throw new IOException("GitHub HTTP " + status);
                }
            } catch (IOException error) {
                connection.disconnect();
                throw error;
            }
            connection.disconnect();
        }
        throw new IOException("Too many GitHub redirects");
    }

    @Override
    protected void handleOnDestroy() {
        io.shutdownNow();
    }
}
