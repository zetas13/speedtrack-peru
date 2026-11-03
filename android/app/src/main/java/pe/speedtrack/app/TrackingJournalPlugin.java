package pe.speedtrack.app;

import android.Manifest;
import android.app.ActivityManager;
import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.location.Location;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import androidx.lifecycle.Lifecycle;
import androidx.localbroadcastmanager.content.LocalBroadcastManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import org.json.JSONObject;

/** Narrow adapter for the pinned community plugin's native location broadcast.
 * The upstream plugin owns the foreground service, notification and sensor.
 * This receiver writes BEFORE relying on any WebView callback or JS timer.
 */
@CapacitorPlugin(name = "TrackingJournal", permissions = {
    @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
})
public class TrackingJournalPlugin extends Plugin {
    static final String SERVICE = "com.equimaps.capacitor_background_geolocation.BackgroundGeolocationService";
    static final String BROADCAST = "com.equimaps.capacitor_background_geolocation.broadcast";
    private TrackingJournal journal;
    private String failure;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            if (journal == null) return;
            Location location = intent.getParcelableExtra("location");
            String watcher = intent.getStringExtra("id");
            if (watcher == null) return;
            try {
                if (intent.getBooleanExtra("watcherAdded", false)) { journal.attach(watcher); return; }
                if (location == null) return;
                journal.record(watcher, location);
                notifyListeners("available", new JSObject());
            } catch (Exception error) {
                // Never print raw coordinates or session data.
                failure = "Native GPS storage failed";
                notifyListeners("storageError", new JSObject());
            }
        }
    };
    @Override public void load() {
        try {
            journal = new TrackingJournal(getContext());
            LocalBroadcastManager.getInstance(getContext()).registerReceiver(receiver, new IntentFilter(BROADCAST));
        } catch (Exception error) { failure = "Native GPS storage unavailable"; }
    }
    private void visible() {
        if (!getActivity().getLifecycle().getCurrentState().isAtLeast(Lifecycle.State.RESUMED))
            throw new IllegalStateException("Start tracking from the visible app");
    }
    private void safe(PluginCall call, Action action) {
        try {
            if (journal == null) throw new IllegalStateException("Native GPS storage unavailable");
            action.run();
        } catch (Exception error) { call.reject("Tracking operation failed", "TRACKING_FAILED"); }
    }
    private interface Action { void run() throws Exception; }

    @PluginMethod public void notificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED)
            requestPermissionForAlias("notifications", call, "notificationResult");
        else notificationResult(call);
    }
    @PermissionCallback private void notificationResult(PluginCall call) {
        NotificationManager manager = (NotificationManager)getContext().getSystemService(Context.NOTIFICATION_SERVICE);
        boolean granted = (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED)
                && manager.areNotificationsEnabled();
        if (Build.VERSION.SDK_INT >= 26) {
            android.app.NotificationChannel channel = manager.getNotificationChannel("com.equimaps.capacitor_background_geolocation");
            if (channel != null && channel.getImportance() == NotificationManager.IMPORTANCE_NONE) granted = false;
        }
        call.resolve(new JSObject().put("granted", granted));
    }
    @PluginMethod public void begin(PluginCall call) {
        safe(call, () -> { visible(); journal.begin(call.getObject("session")); call.resolve(); });
    }
    @PluginMethod public void activate(PluginCall call) { confirmService(call, 50); }
    private void confirmService(PluginCall call, int remaining) {
        safe(call, () -> {
            visible();
            ActivityManager manager = (ActivityManager)getContext().getSystemService(Context.ACTIVITY_SERVICE);
            boolean foreground = false;
            for (ActivityManager.RunningServiceInfo service : manager.getRunningServices(Integer.MAX_VALUE))
                if (SERVICE.equals(service.service.getClassName()) && service.foreground) foreground = true;
            if (foreground) {
                journal.resume(call.getString("id"), call.getString("watcher"));
                call.resolve();
            } else if (remaining > 0) handler.postDelayed(() -> confirmService(call, remaining - 1), 100);
            else call.reject("Location foreground service did not start", "SERVICE_UNAVAILABLE");
        });
    }
    @PluginMethod public void read(PluginCall call) {
        // Capacitor getLong ignores JSON Integer values (ordinary cursors < 2^31).
        safe(call, () -> call.resolve(JSObject.fromJSONObject(journal.read(call.getString("owner"), call.getData().optLong("after", 0L))
                .put("storageError", failure != null))));
    }
    @PluginMethod public void pause(PluginCall call) {
        safe(call, () -> { journal.pause(call.getString("id"), call.getBoolean("ended", false)); call.resolve(); });
    }
    @PluginMethod public void detached(PluginCall call) {
        safe(call, () -> { journal.detached(call.getString("id")); call.resolve(); });
    }
    @PluginMethod public void navigation(PluginCall call) {
        safe(call, () -> { journal.navigation(call.getString("id"), call.getObject("navigation", null) == null ? JSONObject.NULL : call.getObject("navigation")); call.resolve(); });
    }
    @PluginMethod public void clear(PluginCall call) {
        safe(call, () -> { journal.clear(call.getString("id")); call.resolve(); });
    }
    @Override protected void handleOnDestroy() {
        LocalBroadcastManager.getInstance(getContext()).unregisterReceiver(receiver);
        handler.removeCallbacksAndMessages(null);
        if (journal != null) {
            try { journal.interrupted(); } catch (Exception ignored) { /* retained for recovery */ }
            journal.close();
        }
        super.handleOnDestroy();
    }
}
