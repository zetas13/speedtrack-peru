package pe.speedtrack.app;

import static org.junit.Assert.*;
import android.content.Context;
import android.location.Location;
import android.os.SystemClock;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.SQLiteMode;
import org.robolectric.shadows.ShadowSystemClock;
import java.time.Duration;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35)
@SQLiteMode(SQLiteMode.Mode.LEGACY)
public class TrackingJournalTest {
    private Context context;
    private TrackingJournal journal;
    @Before public void setup() throws Exception {
        context = RuntimeEnvironment.getApplication();
        context.deleteDatabase("speedtrack-tracking.db");
        journal = new TrackingJournal(context);
        journal.begin(new JSONObject().put("id", "test-session").put("user_id", "owner"));
        journal.resume("test-session", "watch-1");
    }
    @After public void cleanup() { if (journal != null) journal.close(); context.deleteDatabase("speedtrack-tracking.db"); }
    private void advance(int seconds) { ShadowSystemClock.advanceBy(Duration.ofSeconds(seconds)); }
    private Location location() {
        Location p = new Location("gps");
        p.setLatitude(-12.12); p.setLongitude(-77.03); p.setAccuracy(5);
        p.setTime(System.currentTimeMillis());
        p.setElapsedRealtimeNanos(SystemClock.elapsedRealtimeNanos());
        return p;
    }
    private JSONObject state() throws Exception { return journal.read("owner", 0).getJSONObject("state"); }
    private JSONArray rows() throws Exception { return journal.read("owner", 0).getJSONArray("rows"); }

    @Test public void capturesWithNoJavascriptAndRetainsRowsUntilSaveAcknowledged() throws Exception {
        for (int i = 0; i < 30; i++) { advance(1); journal.record("watch-1", location()); }
        assertEquals(31, rows().length()); // initial boundary + observations
        assertEquals(30, state().getDouble("elapsed"), 0.01);
        journal.pause("test-session", true);
        journal.detached("test-session");
        int count = rows().length();
        advance(10); journal.record("watch-1", location());
        assertEquals(count, rows().length());
        assertEquals(30, state().getDouble("elapsed"), 0.01);
        assertTrue(state().getBoolean("ended"));
        journal.clear("test-session");
        assertTrue(journal.read("owner", 0).isNull("state"));
    }
    @Test public void pauseResumeExcludesPauseTimeAndRejectsOldWatcherAndCachedFix() throws Exception {
        advance(3); journal.record("watch-1", location());
        Location old = location();
        journal.pause("test-session", false);
        advance(60);
        assertEquals(3, state().getDouble("elapsed"), 0.01);
        journal.detached("test-session");
        journal.resume("test-session", "watch-2");
        int count = rows().length();
        journal.record("watch-1", location());
        journal.record("watch-2", old);
        assertEquals(count, rows().length());
        advance(2); journal.record("watch-2", location());
        assertEquals(5, state().getDouble("elapsed"), 0.01);
    }
    @Test public void processRecreationRecoversPersistedSamplesPausedWithoutInventingDowntime() throws Exception {
        advance(5); journal.record("watch-1", location());
        journal.close();
        advance(120);
        journal = new TrackingJournal(context);
        assertTrue(state().getBoolean("paused"));
        assertTrue(state().isNull("watcher"));
        assertEquals(5, state().getDouble("elapsed"), 0.01);
        assertEquals(3, rows().length());
        assertEquals(5, rows().getJSONObject(1).getDouble("elapsed"), 0.01);
    }
    @Test public void pagingAndOwnerIsolationDoNotEraseOrExposeSamples() throws Exception {
        for (int i = 0; i < 550; i++) { advance(1); journal.record("watch-1", location()); }
        JSONArray first = rows();
        assertEquals(500, first.length());
        long cursor = first.getJSONObject(499).getLong("seq");
        assertEquals(51, journal.read("owner", cursor).getJSONArray("rows").length());
        assertThrows(IllegalStateException.class, () -> journal.read("other-owner", 0));
        assertThrows(IllegalStateException.class, () -> journal.clear("test-session"));
        assertThrows(IllegalStateException.class, () -> journal.begin(new JSONObject()));
    }
    @Test public void watcherOwnershipIsDurableBeforeJavascriptActivation() throws Exception {
        journal.pause("test-session", false);
        journal.detached("test-session");
        journal.attach("pending-watcher");
        assertEquals("pending-watcher", state().getString("watcher"));
        assertTrue(state().getBoolean("paused"));
        int count = rows().length();
        advance(1); journal.record("pending-watcher", location());
        assertEquals(count, rows().length());
        assertThrows(IllegalStateException.class, () -> journal.attach("duplicate"));
    }
}
