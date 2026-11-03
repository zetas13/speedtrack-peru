package pe.speedtrack.app;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.location.Location;
import android.os.SystemClock;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Durable raw observations, not a second GPS/filter implementation.
 * All entry points are synchronized: bridge commands and native broadcasts
 * cannot race pause/finish. Rows are retained until the JS outbox accepts save.
 */
final class TrackingJournal extends SQLiteOpenHelper {
    private JSONObject state;

    TrackingJournal(Context context) throws JSONException {
        super(context, "speedtrack-tracking.db", null, 1);
        try (Cursor c = getReadableDatabase().rawQuery("SELECT payload FROM state WHERE id=1", null)) {
            if (c.moveToFirst()) state = new JSONObject(c.getString(0));
        }
        // A new native process cannot claim the previous service is still alive.
        // Recover only time known to have been observed; never count a reboot.
        if (state != null) {
            state.put("elapsedBase", state.optDouble("lastElapsed", 0));
            state.put("paused", true);
            state.put("watcher", JSONObject.NULL);
            appendBoundary();
        }
    }

    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE state(id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL)");
        db.execSQL("CREATE TABLE observations(seq INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL)");
    }
    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        throw new IllegalStateException("Unsupported tracking journal upgrade");
    }

    private void persist() {
        ContentValues values = new ContentValues();
        values.put("id", 1);
        values.put("payload", state.toString());
        if (getWritableDatabase().insertWithOnConflict("state", null, values, SQLiteDatabase.CONFLICT_REPLACE) < 0)
            throw new IllegalStateException("Could not persist native session");
    }
    private long append(JSONObject value) {
        ContentValues values = new ContentValues();
        values.put("payload", value.toString());
        return getWritableDatabase().insertOrThrow("observations", null, values);
    }
    private double elapsedAt(long monotonic) throws JSONException {
        return state.getDouble("elapsedBase") + (state.getBoolean("paused") ? 0 :
                Math.max(0, monotonic - state.getLong("segmentStart")) / 1000.0);
    }
    private void require(String id) throws JSONException {
        if (state == null || !state.getJSONObject("session").getString("id").equals(id))
            throw new IllegalStateException("Tracking session mismatch");
    }
    private void appendBoundary() throws JSONException {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            append(new JSONObject().put("kind", "break").put("elapsed", state.getDouble("elapsedBase")));
            persist();
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }
    synchronized void begin(JSONObject session) throws JSONException {
        if (state != null) throw new IllegalStateException("An unfinished native activity exists");
        state = new JSONObject().put("session", session).put("paused", true).put("ended", false)
                .put("elapsedBase", 0).put("lastElapsed", 0).put("watcher", JSONObject.NULL);
        persist();
    }
    synchronized void resume(String id, String watcher) throws JSONException {
        require(id);
        if (state.getBoolean("ended")) throw new IllegalStateException("Activity ended");
        if (!state.getBoolean("paused")) throw new IllegalStateException("Already tracking");
        state.put("segmentStart", SystemClock.elapsedRealtime()).put("paused", false).put("watcher", watcher);
        appendBoundary();
    }
    synchronized void attach(String watcher) throws JSONException {
        if (state == null || state.getBoolean("ended")) return;
        if (!state.isNull("watcher") && !watcher.equals(state.optString("watcher")))
            throw new IllegalStateException("Duplicate native watcher");
        state.put("watcher", watcher);
        persist();
    }
    synchronized void pause(String id, boolean ended) throws JSONException {
        require(id);
        double elapsed = elapsedAt(SystemClock.elapsedRealtime());
        state.put("elapsedBase", elapsed).put("lastElapsed", elapsed).put("paused", true);
        if (ended) {
            java.text.SimpleDateFormat format = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US);
            format.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
            state.put("ended", true).put("endTime", format.format(new java.util.Date()));
        }
        appendBoundary();
    }
    synchronized void detached(String id) throws JSONException {
        require(id);
        if (!state.getBoolean("paused")) throw new IllegalStateException("Still tracking");
        state.put("watcher", JSONObject.NULL);
        persist();
    }
    synchronized void record(String watcher, Location location) throws JSONException {
        if (state == null || state.getBoolean("paused") || !watcher.equals(state.optString("watcher"))) return;
        long sampleTime = location.getElapsedRealtimeNanos() / 1_000_000;
        long received = SystemClock.elapsedRealtime();
        // Ignore cached positions from before resume, and timestamp-invalid fixes.
        if (sampleTime < state.getLong("segmentStart") || sampleTime > received + 5000) return;
        JSONObject point = new JSONObject().put("latitude", location.getLatitude()).put("longitude", location.getLongitude())
                .put("timestamp", location.getTime()).put("accuracy", location.hasAccuracy() ? location.getAccuracy() : -1)
                .put("speed", location.hasSpeed() ? location.getSpeed() : JSONObject.NULL);
        JSONObject row = new JSONObject().put("kind", "point").put("point", point)
                .put("elapsed", elapsedAt(sampleTime)).put("receivedAt", System.currentTimeMillis());
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            append(row);
            state.put("lastElapsed", elapsedAt(received));
            persist();
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }
    synchronized JSONObject read(String owner, long after) throws JSONException {
        if (state == null) return new JSONObject().put("state", JSONObject.NULL).put("rows", new JSONArray());
        if (!state.getJSONObject("session").getString("user_id").equals(owner))
            throw new IllegalStateException("Native activity belongs to another account");
        JSONObject snapshot = new JSONObject(state.toString()).put("elapsed", elapsedAt(SystemClock.elapsedRealtime()));
        JSONArray rows = new JSONArray();
        try (Cursor c = getReadableDatabase().rawQuery("SELECT seq,payload FROM observations WHERE seq>? ORDER BY seq LIMIT 500", new String[]{Long.toString(after)})) {
            while (c.moveToNext()) rows.put(new JSONObject(c.getString(1)).put("seq", c.getLong(0)));
        }
        return new JSONObject().put("state", snapshot).put("rows", rows);
    }
    synchronized void navigation(String id, Object navigation) throws JSONException {
        require(id);
        state.getJSONObject("session").put("navigation", navigation);
        persist();
    }
    synchronized void clear(String id) throws JSONException {
        require(id);
        if (!state.getBoolean("ended") || !state.isNull("watcher")) throw new IllegalStateException("Stop before clearing");
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            db.delete("observations", null, null);
            db.delete("state", null, null);
            db.setTransactionSuccessful();
            state = null;
        } finally { db.endTransaction(); }
    }
    synchronized void interrupted() throws JSONException {
        if (state == null) return;
        String id = state.getJSONObject("session").getString("id");
        pause(id, false);
        detached(id);
    }
}
