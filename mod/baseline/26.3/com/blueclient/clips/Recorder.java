package com.blueclient.clips;

import com.blueclient.BlueClient;
import com.blueclient.shade.Gl;
import com.blueclient.shade.Source;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BooleanSupplier;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import org.lwjgl.opengl.GL11C;
import org.lwjgl.opengl.GL15C;
import org.lwjgl.opengl.GL20C;
import org.lwjgl.opengl.GL30C;
import org.lwjgl.opengl.GL32C;

final class Recorder {
   private static final int QUEUE_MILLIS = 125;
   private static final int SPARE = 4;
   static final int AUDIO_KBPS = 128;
   private static final AtomicInteger EARS = new AtomicInteger();
   private static final int RING = 3;
   private final Path exe;
   private final String encoder;
   final int width;
   final int height;
   final int fps;
   final int seconds;
   private final boolean speakers;
   private final boolean mic;
   private final boolean sound;
   private final long cap;
   private final boolean packed;
   private final int kbps;
   private final int frameBytes;
   private final Path dir;
   private final ExecutorService work;
   private final long born = System.nanoTime();
   private final long frameNanos;
   private final int maxRepeats;
   private final int pool;
   private volatile Process helper;
   private volatile boolean earsOpen;
   private volatile boolean listening;
   private volatile boolean micHeard;
   private volatile Process process;
   private volatile OutputStream stdin;
   private volatile boolean up;
   private volatile boolean dead;
   private volatile boolean stopping;
   private volatile boolean held;
   private final BlockingQueue<Recorder.Job> queue;
   private final ArrayDeque<ByteBuffer> spare = new ArrayDeque<>();
   private int made;
   private volatile int dropped;
   private static int program;
   private static boolean programTried;
   private static boolean packedOk;
   private int fbo;
   private int texture;
   private final int rows;
   private final int[] pbo = new int[3];
   private final long[] fence = new long[3];
   private final int[] pendingRepeats = new int[3];
   private int head;
   private int pending;
   private final Gl.Borrowed source = new Gl.Borrowed();
   private final Gl.Saved saved = new Gl.Saved(1, false);
   private int packBuffer;
   private boolean packBufferHeld;
   private long startNanos = -1L;
   private long lastSlot = -1L;

   Recorder(
      Path exe,
      String encoder,
      int width,
      int height,
      int fps,
      int seconds,
      boolean speakers,
      boolean mic,
      long cap,
      boolean packed,
      Path dir,
      ExecutorService work
   ) {
      this.exe = exe;
      this.encoder = encoder;
      this.width = width;
      this.height = height;
      this.fps = fps;
      this.seconds = seconds;
      this.speakers = speakers;
      this.mic = mic;
      this.sound = speakers || mic;
      this.cap = cap;
      this.packed = packed;
      this.rows = packed ? height + height / 2 : height;
      this.frameBytes = packed ? width * this.rows : width * height * 4;
      this.kbps = bitrate(width, height, fps, seconds, this.sound, cap);
      this.dir = dir;
      this.work = work;
      this.frameNanos = 1000000000L / fps;
      this.maxRepeats = fps * 3;
      int queued = Math.max(4, fps * 125 / 1000);
      this.queue = new ArrayBlockingQueue<>(queued);
      this.pool = queued + 2;
      work.execute(this::launch);
   }

   static int bitrate(int width, int height, int fps, int seconds, boolean sound, long cap) {
      double perThousand = fps >= 120 ? 22.0 : (fps >= 60 ? 13.0 : 8.0);
      int best = (int)((long)width * height / 1000.0 * perThousand);
      int kbps = best;
      if (cap > 0L) {
         long budgetBits = cap * 95L / 100L * 8L;
         int fitted = (int)(budgetBits / Math.max(1, seconds) / 1000L);
         if (sound) {
            fitted -= 140;
         }

         kbps = Math.min(best, fitted);
      }

      return Math.max(1500, kbps / 50 * 50);
   }

   boolean fits(int w, int h, int rate, int secs, boolean withSpeakers, boolean withMic, long sizeCap) {
      return this.width == w
         && this.height == h
         && this.fps == rate
         && this.seconds == secs
         && this.speakers == withSpeakers
         && this.mic == withMic
         && this.cap == sizeCap;
   }

   boolean hearing() {
      return this.listening;
   }

   boolean micHeard() {
      return this.micHeard;
   }

   boolean alive() {
      return !this.dead;
   }

   boolean running() {
      return this.up && !this.dead;
   }

   int dropped() {
      return this.dropped;
   }

   long ageNanos() {
      return System.nanoTime() - this.born;
   }

   private void launch() {
      try {
         clear(this.dir);
         Files.createDirectories(this.dir);
         String ears = this.sound ? this.openEars() : null;
         List<String> cmd = new ArrayList<>(
            List.of(
               this.exe.toString(),
               "-hide_banner",
               "-loglevel",
               "warning",
               "-nostdin",
               "-f",
               "rawvideo",
               "-pix_fmt",
               this.packed ? "nv12" : "rgba",
               "-video_size",
               this.width + "x" + this.height,
               "-framerate",
               String.valueOf(this.fps)
            )
         );
         cmd.addAll(Ffmpeg.colourTags());
         cmd.addAll(List.of("-i", "pipe:0"));
         if (ears == null) {
            cmd.add("-an");
         } else {
            cmd.addAll(List.of("-thread_queue_size", "512", "-probesize", "32", "-analyzeduration", "0", "-f", "wav", "-i", ears));
         }

         cmd.addAll(Ffmpeg.encoderArgs(this.encoder, this.kbps, this.fps));
         if (ears != null) {
            cmd.addAll(List.of("-c:a", "aac", "-b:a", "128k", "-ac", "2", "-ar", "48000"));
         }

         cmd.addAll(
            List.of("-f", "segment", "-segment_time", "1", "-segment_format", "mp4", "-reset_timestamps", "1", this.dir.resolve("seg%08d.mp4").toString())
         );
         Process started = new ProcessBuilder(cmd).redirectErrorStream(true).redirectOutput(this.dir.resolve("ffmpeg.log").toFile()).start();
         if (this.stopping) {
            started.destroyForcibly();
            return;
         }

         this.process = started;
         this.stdin = started.getOutputStream();
         Ffmpeg.lower(started);
         BlueClient.LOGGER
            .info(
               "Clipping: recording {}x{} at {} fps, {} kb/s, {}{}",
               new Object[]{
                  this.width,
                  this.height,
                  this.fps,
                  this.kbps,
                  this.packed ? "packed on the card" : "RGBA read back",
                  this.cap > 0L ? ", to fit " + this.cap / 1000000L + " MB" : ""
               }
            );
         if (ears != null && !this.await(() -> this.listening, 3000L)) {
            BlueClient.LOGGER.info("Clipping: the sound did not arrive in time; recording the picture alone");
         }

         this.up = true;
         Thread writer = new Thread(this::write, "BlueClient clip writer");
         writer.setDaemon(true);
         writer.start();
      } catch (IOException var5) {
         BlueClient.LOGGER.warn("Clipping: the encoder would not start", var5);
         this.dead = true;
      }
   }

   private String openEars() {
      Path helperExe = Audio.ensure();
      if (helperExe == null) {
         return null;
      } else {
         String name = "blueclient-clip-" + ProcessHandle.current().pid() + "-" + EARS.incrementAndGet();

         try {
            Process started = Audio.start(helperExe, name, this.speakers, this.mic);
            this.helper = started;
            Thread listener = new Thread(() -> {
               String line;
               try (BufferedReader lines = new BufferedReader(new InputStreamReader(started.getInputStream(), StandardCharsets.UTF_8))) {
                  while ((line = lines.readLine()) != null) {
                     if (line.startsWith("ready")) {
                        this.earsOpen = true;
                     } else if (line.startsWith("connected")) {
                        this.listening = true;
                     } else if (line.startsWith("mic on")) {
                        this.micHeard = true;
                     } else if (line.startsWith("mic off")) {
                        this.micHeard = false;
                     }
                  }
               } catch (IOException var7) {
               }

               this.listening = false;
               this.micHeard = false;
            }, "BlueClient clip sound");
            listener.setDaemon(true);
            listener.start();
            if (!this.await(() -> this.earsOpen, 4000L)) {
               BlueClient.LOGGER.warn("Clipping: the sound helper did not open its pipe");
               this.stopEars();
               return null;
            } else {
               return "\\\\.\\pipe\\" + name;
            }
         } catch (IOException var5) {
            BlueClient.LOGGER.warn("Clipping: could not start the sound helper: {}", var5.toString());
            this.stopEars();
            return null;
         }
      }
   }

   private void stopEars() {
      Process ears = this.helper;
      this.helper = null;
      this.listening = false;
      this.micHeard = false;
      this.earsOpen = false;
      if (ears != null) {
         ears.destroy();
      }
   }

   private boolean await(BooleanSupplier done, long millis) {
      long until = System.nanoTime() + millis * 1000000L;

      while (System.nanoTime() < until) {
         if (done.getAsBoolean()) {
            return true;
         }

         if (this.stopping) {
            return false;
         }

         try {
            Thread.sleep(10L);
         } catch (InterruptedException var7) {
            Thread.currentThread().interrupt();
            return false;
         }
      }

      return done.getAsBoolean();
   }

   private void write() {
      byte[] bytes = new byte[this.frameBytes];
      long lastSweep = System.nanoTime();

      try {
         while (!this.stopping) {
            Recorder.Job job = this.queue.poll(200L, TimeUnit.MILLISECONDS);
            if (job != null) {
               ByteBuffer pixels = job.pixels();
               pixels.clear();
               pixels.get(bytes);
               this.release(pixels);
               OutputStream out = this.stdin;

               for (int i = 0; i < job.repeats(); i++) {
                  out.write(bytes);
               }
            }

            long now = System.nanoTime();
            if (now - lastSweep > 1000000000L) {
               lastSweep = now;
               this.sweep();
            }
         }
      } catch (InterruptedException | IOException var8) {
         if (!this.stopping) {
            BlueClient.LOGGER.warn("Clipping: the encoder stopped: {}", var8.toString());
            this.dead = true;
         }
      }
   }

   private ByteBuffer take() {
      synchronized (this.spare) {
         ByteBuffer ready = this.spare.poll();
         if (ready != null) {
            return ready;
         } else if (this.made < this.pool) {
            this.made++;
            return ByteBuffer.allocateDirect(this.frameBytes);
         } else {
            return null;
         }
      }
   }

   private void release(ByteBuffer pixels) {
      synchronized (this.spare) {
         this.spare.push(pixels);
      }
   }

   static boolean canPack() {
      if (programTried) {
         return packedOk;
      } else {
         programTried = true;

         try {
            String vertex = Source.load("screen.vsh");
            String fragment = Source.load("nv12.fsh");
            if (vertex == null || fragment == null) {
               return false;
            }

            program = Gl.program("clips/nv12", vertex, fragment);
            if (program == 0) {
               return false;
            }

            int boundTexture = GL11C.glGetInteger(32873);
            int drawFbo = GL11C.glGetInteger(36006);
            int readFbo = GL11C.glGetInteger(36010);
            int probeTexture = GL11C.glGenTextures();
            GL11C.glBindTexture(3553, probeTexture);
            GL11C.glTexImage2D(3553, 0, 33321, 4, 6, 0, 6403, 5121, (ByteBuffer)null);
            GL11C.glBindTexture(3553, boundTexture);
            int probeFbo = GL30C.glGenFramebuffers();
            GL30C.glBindFramebuffer(36160, probeFbo);
            GL30C.glFramebufferTexture2D(36160, 36064, 3553, probeTexture, 0);
            int status = GL30C.glCheckFramebufferStatus(36160);
            GL30C.glBindFramebuffer(36009, drawFbo);
            GL30C.glBindFramebuffer(36008, readFbo);
            GL30C.glDeleteFramebuffers(probeFbo);
            GL11C.glDeleteTextures(probeTexture);
            packedOk = status == 36053;
            if (!packedOk) {
               BlueClient.LOGGER.info("Clipping: this card cannot draw into a one-channel texture ({}); reading RGBA back", status);
               Gl.delete(program);
               program = 0;
            }
         } catch (Throwable var8) {
            BlueClient.LOGGER.info("Clipping: the pack pass is not available here; reading RGBA back", var8);
            packedOk = false;
         }

         return packedOk;
      }
   }

   void capture(int sourceTexture, int sourceW, int sourceH) {
      if (!this.dead) {
         long now = System.nanoTime();
         if (this.startNanos < 0L) {
            this.startNanos = now;
         }

         long slot = (now - this.startNanos) / this.frameNanos;
         if (slot != this.lastSlot) {
            if (this.up) {
               Process running = this.process;
               if (running != null && !running.isAlive()) {
                  this.dead = true;
               } else {
                  try {
                     this.collect();
                     if (this.pending < 3) {
                        this.takeFrame(sourceTexture, sourceW, sourceH, slot);
                     }
                  } finally {
                     if (this.packBufferHeld) {
                        this.packBufferHeld = false;
                        GL15C.glBindBuffer(35051, this.packBuffer);
                     }
                  }
               }
            }
         }
      }
   }

   private void holdPackBuffer() {
      if (!this.packBufferHeld) {
         this.packBuffer = GL11C.glGetInteger(35053);
         this.packBufferHeld = true;
      }
   }

   private void takeFrame(int sourceTexture, int sourceW, int sourceH, long slot) {
      this.holdPackBuffer();
      this.saved.save();
      int rowLength = GL11C.glGetInteger(3330);
      int skipPixels = GL11C.glGetInteger(3332);
      int skipRows = GL11C.glGetInteger(3331);
      int alignment = GL11C.glGetInteger(3333);
      GL11C.glPixelStorei(3330, 0);
      GL11C.glPixelStorei(3332, 0);
      GL11C.glPixelStorei(3331, 0);
      GL11C.glPixelStorei(3333, 1);

      try {
         this.ensureGl();
         int repeats = this.lastSlot < 0L ? 1 : (int)Math.min((long)this.maxRepeats, slot - this.lastSlot);
         this.lastSlot = slot;
         if (this.packed) {
            this.pack(sourceTexture, sourceW, sourceH);
         } else {
            this.blit(sourceTexture, sourceW, sourceH);
         }

         int at = (this.head + this.pending) % 3;
         GL30C.glBindFramebuffer(36008, this.fbo);
         GL15C.glBindBuffer(35051, this.pbo[at]);
         GL11C.glReadPixels(0, 0, this.width, this.rows, this.packed ? 6403 : 6408, 5121, 0L);
         this.fence[at] = GL32C.glFenceSync(37143, 0);
         this.pendingRepeats[at] = repeats;
         this.pending++;
      } finally {
         GL11C.glPixelStorei(3330, rowLength);
         GL11C.glPixelStorei(3332, skipPixels);
         GL11C.glPixelStorei(3331, skipRows);
         GL11C.glPixelStorei(3333, alignment);
         this.saved.restore();
      }
   }

   private void pack(int sourceTexture, int sourceW, int sourceH) {
      Gl.plain();
      GL30C.glBindFramebuffer(36160, this.fbo);
      GL11C.glViewport(0, 0, this.width, this.rows);
      GL20C.glUseProgram(program);
      Gl.sampler(program, "Scene", 0, sourceTexture);
      Gl.set(program, "Size", this.width, this.height);
      Gl.set(program, "Source", sourceW, sourceH);
      Gl.fullscreen();
   }

   private void blit(int sourceTexture, int sourceW, int sourceH) {
      GL11C.glDisable(3089);
      GL30C.glBindFramebuffer(36008, this.source.around(sourceTexture));
      GL30C.glBindFramebuffer(36009, this.fbo);
      GL30C.glBlitFramebuffer(0, 0, sourceW, sourceH, 0, this.height, this.width, 0, 16384, 9729);
   }

   private void collect() {
      while (this.pending > 0) {
         int at = this.head;
         int state = GL32C.glClientWaitSync(this.fence[at], 0, 0L);
         if (state != 37146 && state != 37148 && state != 37149) {
            return;
         }

         GL32C.glDeleteSync(this.fence[at]);
         this.fence[at] = 0L;
         ByteBuffer pixels = this.take();
         if (pixels != null) {
            this.holdPackBuffer();
            GL15C.glBindBuffer(35051, this.pbo[at]);
            pixels.clear();
            GL15C.glGetBufferSubData(35051, 0L, pixels);
            if (!this.queue.offer(new Recorder.Job(pixels, this.pendingRepeats[at]))) {
               this.release(pixels);
               this.dropped++;
            }
         } else {
            this.dropped++;
         }

         this.pendingRepeats[at] = 0;
         this.head = (this.head + 1) % 3;
         this.pending--;
      }
   }

   private void ensureGl() {
      if (this.fbo == 0) {
         int boundTexture = GL11C.glGetInteger(32873);
         this.texture = GL11C.glGenTextures();
         GL11C.glBindTexture(3553, this.texture);
         if (this.packed) {
            GL11C.glTexImage2D(3553, 0, 33321, this.width, this.rows, 0, 6403, 5121, (ByteBuffer)null);
         } else {
            GL11C.glTexImage2D(3553, 0, 32856, this.width, this.height, 0, 6408, 5121, (ByteBuffer)null);
         }

         GL11C.glTexParameteri(3553, 10241, 9729);
         GL11C.glTexParameteri(3553, 10240, 9729);
         GL11C.glBindTexture(3553, boundTexture);
         this.fbo = GL30C.glGenFramebuffers();
         GL30C.glBindFramebuffer(36160, this.fbo);
         GL30C.glFramebufferTexture2D(36160, 36064, 3553, this.texture, 0);

         for (int i = 0; i < 3; i++) {
            this.pbo[i] = GL15C.glGenBuffers();
            GL15C.glBindBuffer(35051, this.pbo[i]);
            GL15C.glBufferData(35051, this.frameBytes, 35041);
         }
      }
   }

   private void freeGl() {
      if (this.fbo != 0) {
         GL30C.glDeleteFramebuffers(this.fbo);
      }

      if (this.texture != 0) {
         GL11C.glDeleteTextures(this.texture);
      }

      for (int i = 0; i < 3; i++) {
         if (this.fence[i] != 0L) {
            GL32C.glDeleteSync(this.fence[i]);
         }

         this.fence[i] = 0L;
         if (this.pbo[i] != 0) {
            GL15C.glDeleteBuffers(this.pbo[i]);
         }

         this.pbo[i] = 0;
         this.pendingRepeats[i] = 0;
      }

      this.head = this.pending = 0;
      this.fbo = this.texture = 0;
      this.source.free();
   }

   List<Path> snapshot(int wanted) {
      List<Path> all = this.segments();
      if (all.size() < 2) {
         return List.of();
      } else {
         all.remove(all.size() - 1);
         int from = Math.max(0, all.size() - wanted);
         return new ArrayList<>(all.subList(from, all.size()));
      }
   }

   void hold(boolean on) {
      this.held = on;
   }

   private List<Path> segments() {
      try {
         List var2;
         try (Stream<Path> files = Files.list(this.dir)) {
            var2 = files.filter(p -> {
               String name = p.getFileName().toString();
               return name.startsWith("seg") && name.endsWith(".mp4");
            }).sorted(Comparator.comparing(p -> p.getFileName().toString())).collect(Collectors.toCollection(ArrayList::new));
         }

         return var2;
      } catch (IOException var6) {
         return new ArrayList<>();
      }
   }

   private void sweep() {
      if (!this.held) {
         List<Path> all = this.segments();
         int keep = this.seconds + 4;

         for (int i = 0; i < all.size() - keep; i++) {
            try {
               Files.deleteIfExists(all.get(i));
            } catch (IOException var5) {
            }
         }
      }
   }

   static void clear(Path dir) {
      if (Files.isDirectory(dir)) {
         try (Stream<Path> files = Files.list(dir)) {
            files.forEach(p -> {
               try {
                  Files.deleteIfExists(p);
               } catch (IOException var2) {
               }
            });
         } catch (IOException var6) {
         }
      }
   }

   void stop() {
      this.stopping = true;
      this.freeGl();
      this.stopEars();
      this.work.execute(() -> {
         try {
            OutputStream out = this.stdin;
            if (out != null) {
               out.close();
            }
         } catch (IOException var4) {
         }

         Process running = this.process;
         if (running != null) {
            try {
               if (!running.waitFor(2L, TimeUnit.SECONDS)) {
                  running.destroyForcibly();
               }
            } catch (InterruptedException var3) {
               running.destroyForcibly();
            }
         }

         clear(this.dir);
      });
   }

   private record Job(ByteBuffer pixels, int repeats) {
   }
}
