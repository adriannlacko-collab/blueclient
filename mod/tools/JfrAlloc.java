import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import jdk.jfr.consumer.RecordedEvent;
import jdk.jfr.consumer.RecordedFrame;
import jdk.jfr.consumer.RecordedStackTrace;
import jdk.jfr.consumer.RecordedThread;
import jdk.jfr.consumer.RecordingFile;

/**
 * Render-thread allocation from a recording made by test/run_game.py --jfr, streamed
 * (the recordings hold one event per 16 KB allocated, too many to print as JSON).
 *
 *   java mod/tools/JfrAlloc.java alloc.jfr
 *
 * Prints JSON: the render thread's exact allocation rate (jdk.ThreadAllocationStatistics
 * at the start and end), and the new-TLAB / outside-TLAB events on the render thread
 * weighted by size and summed by the innermost com.blueclient frame on the stack (or by
 * the top frame when there is none).
 */
public class JfrAlloc {
   static final String RENDER = "Render thread";

   public static void main(String[] args) throws Exception {
      Path file = Path.of(args[0]);
      long firstAllocated = -1, lastAllocated = -1;
      Instant firstAt = null, lastAt = null;
      long total = 0, blue = 0;
      Map<String, Long> ours = new HashMap<>();
      Map<String, Long> other = new HashMap<>();
      Map<String, Long> elsewhere = new HashMap<>();
      try (RecordingFile recording = new RecordingFile(file)) {
         while (recording.hasMoreEvents()) {
            RecordedEvent e = recording.readEvent();
            String type = e.getEventType().getName();
            if (type.equals("jdk.ThreadAllocationStatistics")) {
               RecordedThread t = e.getThread("thread");
               if (t != null && RENDER.equals(t.getJavaName())) {
                  long allocated = e.getLong("allocated");
                  Instant at = e.getStartTime();
                  if (firstAt == null || at.isBefore(firstAt)) { firstAt = at; firstAllocated = allocated; }
                  if (lastAt == null || at.isAfter(lastAt)) { lastAt = at; lastAllocated = allocated; }
               }
            } else if (type.equals("jdk.ObjectAllocationInNewTLAB") || type.equals("jdk.ObjectAllocationOutsideTLAB")) {
               RecordedThread t = e.getThread();
               long weight = type.endsWith("InNewTLAB") ? e.getLong("tlabSize") : e.getLong("allocationSize");
               RecordedStackTrace stack = e.getStackTrace();
               if (t == null || !RENDER.equals(t.getJavaName())) {
                  // other threads: only what BlueClient's own frames allocate (network, disk, workers)
                  if (stack != null) {
                     for (RecordedFrame f : stack.getFrames()) {
                        if (f.getMethod() != null && f.getMethod().getType().getName().startsWith("com.blueclient")) {
                           elsewhere.merge((t == null ? "?" : t.getJavaName()) + " / " + name(f), weight, Long::sum);
                           break;
                        }
                     }
                  }
                  continue;
               }
               total += weight;
               List<RecordedFrame> frames = stack == null ? List.of() : stack.getFrames();
               RecordedFrame mine = null;
               for (RecordedFrame f : frames) {
                  if (f.getMethod() != null && f.getMethod().getType().getName().startsWith("com.blueclient")) { mine = f; break; }
               }
               if (mine != null) {
                  blue += weight;
                  ours.merge(name(mine), weight, Long::sum);
               } else if (!frames.isEmpty()) {
                  other.merge(name(frames.get(0)), weight, Long::sum);
               }
            }
         }
      }
      double seconds = firstAt == null ? 0 : (lastAt.toEpochMilli() - firstAt.toEpochMilli()) / 1000.0;
      StringBuilder out = new StringBuilder("{\n");
      out.append("  \"recording\": \"").append(file).append("\",\n");
      out.append("  \"render_seconds\": ").append(seconds).append(",\n");
      out.append("  \"render_alloc_mb_per_s\": ").append(seconds > 0 ? (lastAllocated - firstAllocated) / 1e6 / seconds : 0).append(",\n");
      out.append("  \"attributed_mb\": ").append(total / 1e6).append(",\n");
      out.append("  \"blueclient_mb\": ").append(blue / 1e6).append(",\n");
      out.append("  \"blueclient_share\": ").append(total > 0 ? (double) blue / total : 0).append(",\n");
      out.append("  \"blueclient_mb_per_s\": ").append(seconds > 0 ? blue / 1e6 / seconds : 0).append(",\n");
      out.append("  \"top_blueclient\": ").append(top(ours, 25)).append(",\n");
      out.append("  \"top_other\": ").append(top(other, 12)).append(",\n");
      out.append("  \"blueclient_other_threads\": ").append(top(elsewhere, 10)).append("\n}");
      System.out.println(out);
   }

   static String name(RecordedFrame f) {
      return f.getMethod().getType().getName() + "." + f.getMethod().getName() + ":" + f.getLineNumber();
   }

   static String top(Map<String, Long> table, int n) {
      List<Map.Entry<String, Long>> rows = new ArrayList<>(table.entrySet());
      rows.sort((a, b) -> Long.compare(b.getValue(), a.getValue()));
      StringBuilder out = new StringBuilder("[");
      for (int i = 0; i < Math.min(n, rows.size()); i++) {
         if (i > 0) out.append(",");
         out.append("\n    [\"").append(rows.get(i).getKey().replace("\"", "'")).append("\", ")
            .append(Math.round(rows.get(i).getValue() / 1e3) / 1e3).append("]");
      }
      return out.append("\n  ]").toString();
   }
}
