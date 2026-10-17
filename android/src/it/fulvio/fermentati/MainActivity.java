package it.fulvio.fermentati;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.security.NetworkSecurityPolicy;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ProgressBar;

/**
 * Fermentati: apre la webapp del PC di casa (Docker :8954) a schermo intero.
 * - primo avvio: pagina locale per l'indirizzo (salvato in SharedPreferences)
 * - server spento: pagina d'errore locale con Riprova / Cambia indirizzo
 * - indirizzo modificabile dopo: pressione lunga su un punto vuoto dell'app
 * HTTP in chiaro solo verso gli host di rete locale (res/xml/network_security_config.xml).
 */
public class MainActivity extends Activity {
    static final String PREFS = "fermentati";
    static final String KEY_ADDR = "address";
    static final String DEFAULT_ADDR = "192.168.1.58:8954";
    static final String ASSET = "file:///android_asset/";
    static final int BG = 0xFF090E0B;
    static final long TIMEOUT_MS = 12000;

    WebView web;
    PullLayout pull;
    SharedPreferences prefs;
    final Handler ui = new Handler(Looper.getMainLooper());
    volatile boolean onLocalPage = true;
    boolean serverLoading = false;
    boolean errorShown = false;
    final Runnable timeout = () -> {
        if (serverLoading && web.getProgress() < 40) {
            web.stopLoading();
            showError("Il server non risponde.");
        }
    };

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Window w = getWindow();
        w.setStatusBarColor(BG);
        w.setNavigationBarColor(BG);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);

        web = new WebView(this);
        web.setBackgroundColor(BG);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setAllowFileAccess(false);           // gli asset si leggono comunque
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        web.addJavascriptInterface(new Bridge(), "Fermentati");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new Client());
        web.setOnLongClickListener(v -> {
            if (onLocalPage) return false;
            WebView.HitTestResult r = web.getHitTestResult();
            if (r != null && r.getType() == WebView.HitTestResult.UNKNOWN_TYPE) {
                askChangeAddress();
                return true;
            }
            return false;
        });

        pull = new PullLayout(this, web);
        pull.setBackgroundColor(BG);
        setContentView(pull);

        if (state != null) {
            web.restoreState(state);
        } else if (prefs.getString(KEY_ADDR, null) == null) {
            showSetup();
        } else {
            openServer();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    String address() { return prefs.getString(KEY_ADDR, DEFAULT_ADDR); }

    String serverUrl() { return "http://" + address() + "/"; }

    void openServer() {
        errorShown = false;
        serverLoading = true;
        ui.removeCallbacks(timeout);
        ui.postDelayed(timeout, TIMEOUT_MS);
        web.loadUrl(serverUrl());
    }

    void showSetup() {
        serverLoading = false;
        ui.removeCallbacks(timeout);
        web.loadUrl(ASSET + "setup.html");
    }

    void showError(String why) {
        if (errorShown) return;
        errorShown = true;
        serverLoading = false;
        ui.removeCallbacks(timeout);
        pull.done();
        web.loadUrl(ASSET + "error.html?why=" + Uri.encode(why) + "&addr=" + Uri.encode(address()));
    }

    void askChangeAddress() {
        new AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog_Alert)
                .setTitle("Indirizzo del server")
                .setMessage("Ora: " + address() + "\nVuoi cambiarlo?")
                .setPositiveButton("Cambia", (d, i) -> showSetup())
                .setNegativeButton("Annulla", null)
                .show();
    }

    static String normalize(String a) {
        if (a == null) return "";
        a = a.trim().replaceFirst("(?i)^https?://", "");
        int slash = a.indexOf('/');
        if (slash >= 0) a = a.substring(0, slash);
        if (a.isEmpty()) return "";
        if (!a.matches("^[A-Za-z0-9.\\-]+(:\\d{1,5})?$")) return "";
        if (!a.contains(":")) a = a + ":8954";
        return a;
    }

    static boolean cleartextAllowed(String addr) {
        String host = addr.contains(":") ? addr.substring(0, addr.indexOf(':')) : addr;
        return NetworkSecurityPolicy.getInstance().isCleartextTrafficPermitted(host);
    }

    @Override
    public void onBackPressed() {
        if (onLocalPage) {
            if (prefs.getString(KEY_ADDR, null) != null && web.getUrl() != null && web.getUrl().contains("setup.html")) {
                openServer();
            } else {
                super.onBackPressed();
            }
            return;
        }
        // prima chiude un pannello aperto nella webapp, poi torna indietro, poi esce
        web.evaluateJavascript(
                "(function(){var d=document.querySelector('dialog[open]');if(d){d.close();return true}return false})()",
                v -> {
                    if ("true".equals(v)) return;
                    if (web.canGoBack()) web.goBack();
                    else finish();
                });
    }

    /** Ponte JavaScript: attivo solo sulle pagine locali (setup / errore). */
    class Bridge {
        @JavascriptInterface
        public String getAddress() { return onLocalPage ? address() : ""; }

        @JavascriptInterface
        public String defaultAddress() { return DEFAULT_ADDR; }

        @JavascriptInterface
        public String check(String a) {
            if (!onLocalPage) return "";
            String n = normalize(a);
            if (n.isEmpty()) return "invalid";
            return cleartextAllowed(n) ? "ok:" + n : "notlocal:" + n;
        }

        @JavascriptInterface
        public void saveAndOpen(String a) {
            if (!onLocalPage) return;
            String n = normalize(a);
            if (n.isEmpty() || !cleartextAllowed(n)) return;
            prefs.edit().putString(KEY_ADDR, n).apply();
            ui.post(MainActivity.this::openServer);
        }

        /** Prova /api/health in background; risponde con window.onPing(true|false). */
        @JavascriptInterface
        public void ping(String a) {
            if (!onLocalPage) return;
            final String n = normalize(a);
            new Thread(() -> {
                boolean ok = false;
                if (!n.isEmpty() && cleartextAllowed(n)) {
                    java.net.HttpURLConnection c = null;
                    try {
                        c = (java.net.HttpURLConnection) new java.net.URL("http://" + n + "/api/health").openConnection();
                        c.setConnectTimeout(4000);
                        c.setReadTimeout(4000);
                        ok = c.getResponseCode() == 200;
                    } catch (Exception ignored) {
                    } finally {
                        if (c != null) c.disconnect();
                    }
                }
                final boolean res = ok;
                ui.post(() -> { if (onLocalPage) web.evaluateJavascript("window.onPing&&onPing(" + res + ")", null); });
            }).start();
        }

        @JavascriptInterface
        public void retry() { if (onLocalPage) ui.post(MainActivity.this::openServer); }

        @JavascriptInterface
        public void changeAddress() { if (onLocalPage) ui.post(MainActivity.this::showSetup); }
    }

    class Client extends WebViewClient {
        @Override
        public void onPageStarted(WebView v, String url, android.graphics.Bitmap icon) {
            onLocalPage = url != null && url.startsWith(ASSET);
        }

        @Override
        public void onPageFinished(WebView v, String url) {
            pull.done();
            if (url != null && !url.startsWith(ASSET)) {
                serverLoading = false;
                ui.removeCallbacks(timeout);
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
            Uri u = req.getUrl();
            String scheme = u.getScheme() == null ? "" : u.getScheme();
            if (scheme.equals("file")) return !u.toString().startsWith(ASSET);
            if (scheme.equals("http") && u.getHost() != null
                    && NetworkSecurityPolicy.getInstance().isCleartextTrafficPermitted(u.getHost())) return false;
            if (scheme.equals("https")) return false;
            return true;   // tutto il resto (http esterno, intent, ecc.) bloccato
        }

        @Override
        public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError err) {
            if (req.isForMainFrame() && !req.getUrl().toString().startsWith(ASSET)) {
                String d = String.valueOf(err.getDescription());
                showError(d.contains("CLEARTEXT") ? "Indirizzo non in rete locale." : "Il server non risponde.");
            }
        }

        @Override
        public void onReceivedHttpError(WebView v, WebResourceRequest req, WebResourceResponse resp) {
            if (req.isForMainFrame() && resp.getStatusCode() >= 500) showError("Il server ha un problema (" + resp.getStatusCode() + ").");
        }
    }

    /** Trascina in giu' dall'alto per ricaricare (senza librerie AndroidX). */
    class PullLayout extends FrameLayout {
        final WebView child;
        final FrameLayout badge;
        final int slop, max, trigger;
        float startY, dy;
        boolean pulling, refreshing;
        volatile boolean allowed;

        PullLayout(Activity a, WebView w) {
            super(a);
            child = w;
            addView(w, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
            float dp = getResources().getDisplayMetrics().density;
            slop = ViewConfiguration.get(a).getScaledTouchSlop();
            max = (int) (110 * dp);
            trigger = (int) (72 * dp);
            badge = new FrameLayout(a);
            GradientDrawable bg = new GradientDrawable();
            bg.setShape(GradientDrawable.OVAL);
            bg.setColor(0xFF16211B);
            bg.setStroke((int) (1.5f * dp), 0x668BE36B);
            badge.setBackground(bg);
            badge.setElevation(6 * dp);
            ProgressBar pb = new ProgressBar(a, null, android.R.attr.progressBarStyleSmall);
            pb.setIndeterminateTintList(android.content.res.ColorStateList.valueOf(0xFF8BE36B));
            int pad = (int) (9 * dp);
            badge.setPadding(pad, pad, pad, pad);
            badge.addView(pb, new LayoutParams((int) (26 * dp), (int) (26 * dp)));
            LayoutParams lp = new LayoutParams((int) (44 * dp), (int) (44 * dp), Gravity.TOP | Gravity.CENTER_HORIZONTAL);
            addView(badge, lp);
            badge.setTranslationY(-60 * dp);
            badge.setAlpha(0f);
        }

        void done() {
            refreshing = false;
            badge.animate().translationY(-60 * getResources().getDisplayMetrics().density).alpha(0f).setDuration(220).start();
        }

        @Override
        public boolean onInterceptTouchEvent(MotionEvent e) {
            if (refreshing) return false;
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    startY = e.getY();
                    pulling = false;
                    allowed = false;
                    if (onLocalPage) return false;
                    child.evaluateJavascript(
                            "(!document.querySelector('dialog[open]') && (window.scrollY||document.documentElement.scrollTop||0)<=0)",
                            v -> allowed = "true".equals(v));
                    return false;
                case MotionEvent.ACTION_MOVE:
                    if (allowed && child.getScrollY() == 0 && e.getY() - startY > slop * 2) {
                        pulling = true;
                        return true;
                    }
                    return false;
                default:
                    return false;
            }
        }

        @Override
        public boolean onTouchEvent(MotionEvent e) {
            if (!pulling) return super.onTouchEvent(e);
            float dp = getResources().getDisplayMetrics().density;
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_MOVE:
                    dy = Math.min(max, (e.getY() - startY) * 0.5f);
                    badge.setTranslationY(-44 * dp + dy);
                    badge.setAlpha(Math.min(1f, dy / trigger));
                    badge.setRotation(dy * 2);
                    return true;
                case MotionEvent.ACTION_UP:
                case MotionEvent.ACTION_CANCEL:
                    pulling = false;
                    if (dy >= trigger) {
                        refreshing = true;
                        badge.animate().translationY(16 * dp).alpha(1f).setDuration(150).start();
                        if (errorShown || onLocalPage) openServer(); else child.reload();
                    } else {
                        done();
                    }
                    dy = 0;
                    return true;
                default:
                    return true;
            }
        }
    }
}
