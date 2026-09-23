package benchprobe;

import java.io.BufferedWriter;
import java.io.IOException;
import java.lang.reflect.Field;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * The bench's eyes inside the game (tools/bench/README.md).
 *
 * Called at the head of the client's per-frame method (Minecraft.runTick) and
 * of onGameLoadFinished, the moment the first resource load is done and the
 * title screen (or a quick-play world) would open. Prints wall-clock markers
 * to stdout, records every frame's start time from `bench.warmup` seconds
 * after the player is first in the world (a level loaded, no screen open) for
 * `bench.measure` seconds, writes the frame times to `bench.out` and halts
 * the VM. Nothing here allocates per frame.
 */
public final class Probe {
    private static final long WARMUP_NS = (long) (Double.parseDouble(System.getProperty("bench.warmup", "15")) * 1e9);
    private static final long MEASURE_NS = (long) (Double.parseDouble(System.getProperty("bench.measure", "60")) * 1e9);
    private static final String OUT = System.getProperty("bench.out", "bench-frames.txt");
    private static final String LEVEL = System.getProperty("bench.levelField", "level");
    private static final String SCREEN = System.getProperty("bench.screenField", "screen");
    /** Title-screen-only runs: halt once the first load is done. */
    private static final boolean TITLE_ONLY = Boolean.getBoolean("bench.titleOnly");

    private static final long[] FRAMES = new long[4_000_000];
    private static int count;
    private static boolean first = true;
    private static long inWorldAt = -1;
    private static boolean finished;
    private static Field level;
    private static Field[] screen;
    private static boolean fieldsTried;

    private Probe() {}

    private static void mark(String what) {
        System.out.println("BENCHPROBE " + what + " " + System.currentTimeMillis());
        System.out.flush();
    }

    public static void loaded() {
        mark("loaded");
        if (TITLE_ONLY) {
            mark("done");
            Runtime.getRuntime().halt(0);
        }
    }

    public static void frame(Object mc) {
        long now = System.nanoTime();
        if (first) {
            first = false;
            mark("firstframe");
        }
        if (finished) return;
        if (inWorldAt < 0) {
            if (inWorld(mc)) {
                inWorldAt = now;
                mark("inworld");
            }
            return;
        }
        long since = now - inWorldAt;
        if (since < WARMUP_NS) return;
        if (count < FRAMES.length) FRAMES[count++] = now;
        if (since >= WARMUP_NS + MEASURE_NS) finish();
    }

    private static boolean inWorld(Object mc) {
        try {
            if (!fieldsTried) {
                fieldsTried = true;
                level = find(mc.getClass(), LEVEL);
                screen = chain(mc, SCREEN);
            }
            if (level == null || screen == null) return false;
            if (level.get(mc) == null) return false;
            Object at = mc;
            for (Field f : screen) {
                at = f.get(at);
                if (at == null) return f == screen[screen.length - 1];
            }
            return false;
        } catch (ReflectiveOperationException e) {
            return false;
        }
    }

    /** "gui.screen": 26.x keeps the open screen on Minecraft.gui, 1.21.x on Minecraft itself. */
    private static Field[] chain(Object from, String path) throws ReflectiveOperationException {
        String[] names = path.split("\\.");
        Field[] out = new Field[names.length];
        Class<?> type = from.getClass();
        for (int i = 0; i < names.length; i++) {
            out[i] = find(type, names[i]);
            if (out[i] == null) return null;
            type = out[i].getType();
        }
        return out;
    }

    private static Field find(Class<?> type, String name) {
        for (Class<?> c = type; c != null; c = c.getSuperclass()) {
            try {
                Field f = c.getDeclaredField(name);
                f.setAccessible(true);
                return f;
            } catch (NoSuchFieldException ignored) {
                // superclass next
            }
        }
        mark("nofield:" + name);
        return null;
    }

    private static void finish() {
        finished = true;
        mark("measured");
        Path out = Paths.get(OUT);
        try (BufferedWriter w = Files.newBufferedWriter(out)) {
            for (int i = 1; i < count; i++) {
                w.write(Long.toString((FRAMES[i] - FRAMES[i - 1]) / 1000));
                w.write('\n');
            }
        } catch (IOException e) {
            mark("writefailed");
        }
        mark("done");
        Runtime.getRuntime().halt(0);
    }
}
