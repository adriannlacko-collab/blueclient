package com.blueclient.shade;

import com.blueclient.BlueClient;
import it.unimi.dsi.fastutil.ints.Int2ObjectOpenHashMap;
import it.unimi.dsi.fastutil.objects.Object2IntOpenHashMap;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.ByteBuffer;
import org.lwjgl.opengl.GL;
import org.lwjgl.opengl.GL11C;
import org.lwjgl.opengl.GL13C;
import org.lwjgl.opengl.GL14C;
import org.lwjgl.opengl.GL15C;
import org.lwjgl.opengl.GL20C;
import org.lwjgl.opengl.GL30C;
import org.lwjgl.opengl.GL33C;

public final class Gl {
   private static int quadVao;
   private static int unitBase = -1;
   private static final int UNKNOWN = Integer.MIN_VALUE;
   private static final Int2ObjectOpenHashMap<Object2IntOpenHashMap<String>> UNIFORMS = new Int2ObjectOpenHashMap<>();

   private Gl() {
   }

   public static int program(String name, String vertex, String fragment) {
      int vs = 0;
      int fs = 0;
      int program = 0;

      byte failed;
      try {
         vs = stage(name + ".vsh", 35633, vertex);
         if (vs == 0) {
            return 0;
         }

         fs = stage(name + ".fsh", 35632, fragment);
         if (fs == 0) {
            return 0;
         }

         program = GL20C.glCreateProgram();
         UNIFORMS.remove(program);
         GL20C.glAttachShader(program, vs);
         GL20C.glAttachShader(program, fs);
         GL20C.glLinkProgram(program);
         if (GL20C.glGetProgrami(program, 35714) != 0) {
            return program;
         }

         BlueClient.LOGGER.warn("could not link " + name + ": " + GL20C.glGetProgramInfoLog(program));
         GL20C.glDeleteProgram(program);
         failed = 0;
      } catch (Throwable var11) {
         BlueClient.LOGGER.warn("could not build " + name, var11);
         if (program != 0) {
            GL20C.glDeleteProgram(program);
         }

         return 0;
      } finally {
         if (vs != 0) {
            GL20C.glDeleteShader(vs);
         }

         if (fs != 0) {
            GL20C.glDeleteShader(fs);
         }
      }

      return failed;
   }

   private static int stage(String name, int type, String source) {
      int id = GL20C.glCreateShader(type);
      GL20C.glShaderSource(id, source);
      GL20C.glCompileShader(id);
      if (GL20C.glGetShaderi(id, 35713) == 0) {
         BlueClient.LOGGER.warn("could not compile " + name + ": " + GL20C.glGetShaderInfoLog(id));
         GL20C.glDeleteShader(id);
         return 0;
      } else {
         return id;
      }
   }

   public static void delete(int program) {
      if (program != 0) {
         UNIFORMS.remove(program);
         GL20C.glDeleteProgram(program);
      }
   }

   /**
    * Where a uniform lives in a program, asked of the driver once per program
    * and name rather than on every set. Every pass sets a dozen or more
    * uniforms a frame, and each glGetUniformLocation is a string handed to the
    * driver and looked up there; a linked program's locations never change,
    * and a program id is forgotten here when {@link #delete} frees it (and
    * again when {@link #program} is handed a recycled id).
    */
   public static int uniform(int program, String name) {
      if (program == 0) {
         return GL20C.glGetUniformLocation(program, name);
      } else {
         Object2IntOpenHashMap<String> known = UNIFORMS.get(program);
         if (known == null) {
            known = new Object2IntOpenHashMap<>();
            known.defaultReturnValue(UNKNOWN);
            UNIFORMS.put(program, known);
         }

         int at = known.getInt(name);
         if (at == UNKNOWN) {
            at = GL20C.glGetUniformLocation(program, name);
            known.put(name, at);
         }

         return at;
      }
   }

   public static void set(int program, String name, float a) {
      GL20C.glUniform1f(uniform(program, name), a);
   }

   public static void set(int program, String name, float a, float b) {
      GL20C.glUniform2f(uniform(program, name), a, b);
   }

   public static void set(int program, String name, float a, float b, float c) {
      GL20C.glUniform3f(uniform(program, name), a, b, c);
   }

   public static void set(int program, String name, float a, float b, float c, float d) {
      GL20C.glUniform4f(uniform(program, name), a, b, c, d);
   }

   public static void set(int program, String name, int a) {
      GL20C.glUniform1i(uniform(program, name), a);
   }

   public static void matrix(int program, String name, float[] sixteen) {
      GL20C.glUniformMatrix4fv(uniform(program, name), false, sixteen);
   }

   public static void sampler(int program, String name, int unit, int texture) {
      int at = unitBase() + unit;
      GL13C.glActiveTexture(33984 + at);
      GL33C.glBindSampler(at, 0);
      GL11C.glBindTexture(3553, texture);
      GL20C.glUniform1i(uniform(program, name), at);
   }

   public static void sampler3D(int program, String name, int unit, int texture) {
      int at = unitBase() + unit;
      GL13C.glActiveTexture(33984 + at);
      GL33C.glBindSampler(at, 0);
      GL11C.glBindTexture(32879, texture);
      GL20C.glUniform1i(uniform(program, name), at);
   }

   /**
    * The first of the texture units the passes here use: the last few the
    * driver offers (units 188-191 on a typical desktop GPU), which neither the
    * game (units 0-11 or so) nor a shader pack reaches. The game's own texture
    * bindings are then never touched, so nothing has to be read back and put
    * back afterwards; a unit past these is selected as scratch while a pass
    * runs, so textures the pass creates are bound there too. Asked of the
    * driver once. 0 (the old behaviour: units 0-2, saved and restored) only on
    * a driver with fewer than 16 units, which OpenGL 3.2 does not allow.
    */
   static int unitBase() {
      if (unitBase < 0) {
         // 1.12.0 moved the passes to the last units and then restored the GL
         // state from the game's own record; on real drivers that left the
         // screen glitching a few seconds into a world. Back to units 0-2 and
         // reading the state back from the driver, as 1.11 did.
         unitBase = 0;
      }

      return unitBase;
   }

   static int scratchUnit() {
      return unitBase() + 3;
   }

   public static void fullscreen() {
      if (quadVao == 0) {
         quadVao = GL30C.glGenVertexArrays();
      }

      GL30C.glBindVertexArray(quadVao);
      GL11C.glDrawArrays(4, 0, 3);
   }

   public static void into(Gl.Target target) {
      GL30C.glBindFramebuffer(36160, target.fbo);
      GL11C.glViewport(0, 0, target.width, target.height);
   }

   public static void plain() {
      GL11C.glDisable(3042);
      GL11C.glDisable(2929);
      GL11C.glDisable(2884);
      GL11C.glDisable(3089);
      GL11C.glDepthMask(false);
      GL14C.glBlendEquation(32774);
   }

   public static void clearErrors() {
      for (int guard = 0; guard < 16; guard++) {
         if (GL11C.glGetError() == 0) {
            return;
         }
      }
   }

   public static boolean errored() {
      return GL11C.glGetError() != 0;
   }

   public static final class Borrowed {
      private int fbo;
      private int attached;

      public int around(int texture) {
         if (this.fbo == 0) {
            this.fbo = GL30C.glGenFramebuffers();
         }

         if (this.attached != texture) {
            GL30C.glBindFramebuffer(36160, this.fbo);
            GL30C.glFramebufferTexture2D(36160, 36064, 3553, texture, 0);
            this.attached = texture;
         }

         return this.fbo;
      }

      public void free() {
         if (this.fbo != 0) {
            GL30C.glDeleteFramebuffers(this.fbo);
         }

         this.fbo = 0;
         this.attached = 0;
      }
   }

   public static final class Clock {
      private final int[] query = new int[2];
      private final boolean[] running = new boolean[2];
      private int turn;
      private boolean supported = true;
      private boolean started;
      private int frames;
      public long elapsed = -1L;

      /**
       * Times one frame in sixteen. Reading a query back (even asking whether it
       * is ready) is a round trip to the driver; on a driver that runs GL on its
       * own thread it waits for that thread, so it is not done every frame.
       * {@link #elapsed} keeps the last reading in between.
       */
      public void begin() {
         if (this.supported && (this.frames++ & 15) == 0) {
            if (!GL.getCapabilities().OpenGL33) {
               this.supported = false;
            } else {
               if (this.query[this.turn] == 0) {
                  this.query[this.turn] = GL15C.glGenQueries();
               }

               if (this.running[this.turn] && GL15C.glGetQueryObjecti(this.query[this.turn], 34919) != 0) {
                  this.elapsed = GL33C.glGetQueryObjecti64(this.query[this.turn], 34918);
                  this.running[this.turn] = false;
               }

               if (!this.running[this.turn]) {
                  GL15C.glBeginQuery(35007, this.query[this.turn]);
                  this.started = true;
               }
            }
         }
      }

      public void end() {
         if (this.started) {
            GL15C.glEndQuery(35007);
            this.running[this.turn] = true;
            this.turn ^= 1;
            this.started = false;
         }
      }

      public void free() {
         for (int i = 0; i < 2; i++) {
            if (this.query[i] != 0) {
               GL15C.glDeleteQueries(this.query[i]);
            }

            this.query[i] = 0;
            this.running[i] = false;
         }

         this.elapsed = -1L;
         this.started = false;
      }
   }

   /**
    * The GL state a pass changes, put back afterwards.
    *
    * It used to be read with ~20 glGet/glIsEnabled calls before every pass. A
    * driver that runs GL on a thread of its own (NVIDIA's "threaded
    * optimization", Mesa's glthread) has to stop and drain that thread to
    * answer each one, every frame. The game keeps its own copy of most of this
    * state (its GlStateManager), and the rest it sets again itself before it
    * next draws, so the pass now restores from that copy ({@link Game}) and
    * reads nothing back.
    *
    * That is only trusted once it has been seen to be right: the first passes
    * at each call site, and one pass in every {@link #RECHECK} after that, still
    * read the state back, restore from the game's copy, and compare. Any
    * difference (a mod that keeps its own GL state, a version whose state
    * tracking is not what {@link Game} expects) is logged once and that call
    * site goes back to reading and restoring the driver's state as before.
    */
   public static final class Saved {
      private static final int PROVE = 8;
      private static final int RECHECK = 1024;
      int program;
      int vao;
      int drawFbo;
      int readFbo;
      int activeUnit;
      final int[] viewport = new int[4];
      boolean blend;
      boolean depthTest;
      boolean cull;
      boolean scissor;
      boolean depthMask;
      final int[] boundTexture;
      final int[] boundVolume;
      final int[] boundSampler;
      private final int units;
      private final boolean volumes;
      private boolean held;
      private boolean fromGame;
      private boolean checking;
      private int proven;
      private int sinceCheck;
      private boolean distrusted;
      private String where;

      public Saved(int units, boolean volumes) {
         this.units = units;
         this.volumes = volumes;
         this.boundTexture = new int[units];
         this.boundVolume = new int[units];
         this.boundSampler = new int[units];
      }

      private boolean sharedUnits() {
         return Gl.unitBase() == 0;
      }

      public void save() {
         this.held = false;
         boolean usable = !this.distrusted && !this.sharedUnits() && Gl.Game.ready();
         if (usable && this.proven >= PROVE && ++this.sinceCheck < RECHECK) {
            this.fromGame = true;
            this.checking = false;
            this.held = true;
            GL13C.glActiveTexture(33984 + Gl.scratchUnit());
            return;
         }

         this.fromGame = false;
         this.checking = usable;
         this.sinceCheck = 0;
         this.read();
         this.held = true;
         if (!this.sharedUnits()) {
            GL13C.glActiveTexture(33984 + Gl.scratchUnit());
         }
      }

      private void read() {
         this.program = GL11C.glGetInteger(35725);
         this.vao = GL11C.glGetInteger(34229);
         this.drawFbo = GL11C.glGetInteger(36006);
         this.readFbo = GL11C.glGetInteger(36010);
         this.activeUnit = GL11C.glGetInteger(34016);
         GL11C.glGetIntegerv(2978, this.viewport);
         this.blend = GL11C.glIsEnabled(3042);
         this.depthTest = GL11C.glIsEnabled(2929);
         this.cull = GL11C.glIsEnabled(2884);
         this.scissor = GL11C.glIsEnabled(3089);
         this.depthMask = GL11C.glGetBoolean(2930);
         if (this.sharedUnits()) {
            for (int unit = 0; unit < this.units; unit++) {
               GL13C.glActiveTexture(33984 + unit);
               this.boundTexture[unit] = GL11C.glGetInteger(32873);
               if (this.volumes) {
                  this.boundVolume[unit] = GL11C.glGetInteger(32874);
               }

               this.boundSampler[unit] = GL11C.glGetInteger(35097);
            }
         }
      }

      public void restore() {
         if (this.held) {
            this.held = false;
            if (this.fromGame) {
               Gl.Game.restore();
            } else {
               if (this.checking) {
                  this.check();
               }

               this.putBack();
            }
         }
      }

      /** Restore from the game's copy, then compare what the driver now holds with what it held before the pass. */
      private void check() {
         String differs;
         try {
            Gl.Game.restore();
            differs = this.differences();
         } catch (Throwable var3) {
            differs = "the game's state could not be read (" + var3 + ")";
         }

         if (this.where == null) {
            StackTraceElement[] stack = new Throwable().getStackTrace();
            this.where = stack.length > 2 ? stack[2].getClassName() : "a pass";
         }

         if (differs == null) {
            if (++this.proven == PROVE) {
               BlueClient.LOGGER.info("GL state for {} is now restored from the game's own copy, without reading it back", this.where);
            }
         } else {
            this.distrusted = true;

            BlueClient.LOGGER.info(
               "GL state for {} will keep being read back from the driver: the game's own copy did not match ({})", this.where, differs
            );
         }
      }

      private String differences() {
         StringBuilder out = new StringBuilder();
         int[] now = new int[4];
         mismatch(out, "draw framebuffer", this.drawFbo, GL11C.glGetInteger(36006));
         mismatch(out, "read framebuffer", this.readFbo, GL11C.glGetInteger(36010));
         mismatch(out, "active texture", this.activeUnit, GL11C.glGetInteger(34016));
         if (Gl.Game.tracksViewport()) {
            GL11C.glGetIntegerv(2978, now);
            if (now[0] != this.viewport[0] || now[1] != this.viewport[1] || now[2] != this.viewport[2] || now[3] != this.viewport[3]) {
               out.append("viewport; ");
            }
         }

         mismatch(out, "blend", this.blend ? 1 : 0, GL11C.glIsEnabled(3042) ? 1 : 0);
         mismatch(out, "depth test", this.depthTest ? 1 : 0, GL11C.glIsEnabled(2929) ? 1 : 0);
         mismatch(out, "cull", this.cull ? 1 : 0, GL11C.glIsEnabled(2884) ? 1 : 0);
         mismatch(out, "scissor", this.scissor ? 1 : 0, GL11C.glIsEnabled(3089) ? 1 : 0);
         mismatch(out, "depth mask", this.depthMask ? 1 : 0, GL11C.glGetBoolean(2930) ? 1 : 0);
         return out.length() == 0 ? null : out.toString();
      }

      private static void mismatch(StringBuilder out, String what, int before, int after) {
         if (before != after) {
            out.append(what).append(' ').append(before).append(" -> ").append(after).append("; ");
         }
      }

      private void putBack() {
         if (this.sharedUnits()) {
            for (int unit = 0; unit < this.units; unit++) {
               GL13C.glActiveTexture(33984 + unit);
               GL11C.glBindTexture(3553, this.boundTexture[unit]);
               if (this.volumes) {
                  GL11C.glBindTexture(32879, this.boundVolume[unit]);
               }

               GL33C.glBindSampler(unit, this.boundSampler[unit]);
            }
         }

         GL13C.glActiveTexture(this.activeUnit);
         GL20C.glUseProgram(this.program);
         GL30C.glBindVertexArray(this.vao);
         GL30C.glBindFramebuffer(36009, this.drawFbo);
         GL30C.glBindFramebuffer(36008, this.readFbo);
         GL11C.glViewport(this.viewport[0], this.viewport[1], this.viewport[2], this.viewport[3]);
         toggle(3042, this.blend);
         toggle(2929, this.depthTest);
         toggle(2884, this.cull);
         toggle(3089, this.scissor);
         GL11C.glDepthMask(this.depthMask);
      }

      private static void toggle(int cap, boolean on) {
         if (on) {
            GL11C.glEnable(cap);
         } else {
            GL11C.glDisable(cap);
         }
      }
   }

   /**
    * The game's own record of the GL state (GlStateManager and friends), read
    * reflectively so one class serves every Minecraft this mod is built for:
    * the class and field names are tried as Mojang spells them (26.x) and as
    * intermediary does (1.20.6-1.21.11, where they are stable).
    *
    * <ul>
    * <li>Capabilities (blend, depth test, cull, scissor) and the active
    * texture unit: GlStateManager in every version. 26.x keeps blend per draw
    * buffer ({@code BLEND_ENABLE}).</li>
    * <li>Framebuffers: GlStateManager's {@code readFbo/writeFbo} (1.21.5+) or
    * {@code READ_FRAMEBUFFER/DRAW_FRAMEBUFFER} (1.21.2-1.21.4). 1.20.5-1.21.1
    * keep none, and there the main render target is what is bound around the
    * passes; the check above proves it or turns this off.</li>
    * <li>Viewport: {@code GlStateManager.Viewport} up to 1.21.4. From 1.21.5 on
    * every render pass sets its own viewport, so nothing is restored.</li>
    * <li>Program and vertex array: from 1.21.5 on every render pass rebinds
    * both (its pipeline cache is cleared when the pass is created). Before
    * that the game remembers the last program (1.20.5-1.21.1:
    * {@code ShaderInstance.lastProgramId}) and the last immediate vertex
    * buffer ({@code BufferUploader}); both are unbound here and those
    * memories cleared, so the game binds its own again.</li>
    * </ul>
    */
   static final class Game {
      private static boolean tried;
      private static boolean ok;
      private static Field bool;
      private static boolean[] blendEnable;
      private static Object blendMode;
      private static Object depthMode;
      private static Object cullMode;
      private static Object scissorMode;
      private static Field activeTexture;
      private static Field readFbo;
      private static Field writeFbo;
      private static Object readFramebuffer;
      private static Object drawFramebuffer;
      private static Field framebufferBinding;
      private static Method mainTarget;
      private static Field frameBufferId;
      private static Object viewport;
      private static Field viewX;
      private static Field viewY;
      private static Field viewW;
      private static Field viewH;
      private static Field lastProgramId;
      private static Field lastAppliedShader;
      private static Method invalidateUploader;

      private Game() {
      }

      static boolean ready() {
         if (!tried) {
            tried = true;

            String missing;
            try {
               missing = find();
            } catch (Throwable var1) {
               missing = var1.toString();
            }

            ok = missing == null;
            if (!ok) {
               BlueClient.LOGGER.info("GL state will be read back from the driver: the game's own copy was not found ({})", missing);
            }
         }

         return ok;
      }

      static boolean tracksViewport() {
         return viewport != null;
      }

      private static Class<?> type(String... names) {
         ClassLoader loader = Gl.class.getClassLoader();

         for (String name : names) {
            try {
               return Class.forName(name, false, loader);
            } catch (Throwable var6) {
            }
         }

         return null;
      }

      private static Field field(Class<?> owner, String... names) {
         for (String name : names) {
            try {
               Field found = owner.getDeclaredField(name);
               found.setAccessible(true);
               return found;
            } catch (Throwable var7) {
            }
         }

         return null;
      }

      private static Method method(Class<?> owner, String... names) {
         for (String name : names) {
            try {
               Method found = owner.getDeclaredMethod(name);
               found.setAccessible(true);
               return found;
            } catch (Throwable var7) {
            }
         }

         return null;
      }

      private static Object value(Class<?> owner, String... names) throws ReflectiveOperationException {
         Field found = field(owner, names);
         return found == null ? null : found.get(null);
      }

      private static Object child(Object parent, String... names) throws ReflectiveOperationException {
         if (parent == null) {
            return null;
         } else {
            Field found = field(parent.getClass(), names);
            return found == null ? null : found.get(parent);
         }
      }

      private static String find() throws ReflectiveOperationException {
         Class<?> state = type(
            "com.mojang.renderpearl.backend.opengl.GlStateManager", "com.mojang.blaze3d.opengl.GlStateManager", "com.mojang.blaze3d.platform.GlStateManager"
         );
         if (state == null) {
            return "GlStateManager";
         } else {
            Object blendEnabled = value(state, "BLEND_ENABLE");
            if (blendEnabled instanceof boolean[] perBuffer) {
               blendEnable = perBuffer;
            } else {
               // one BlendState, or (26.2) one per draw buffer, all toggling GL_BLEND itself
               Object blend = value(state, "BLEND");
               if (blend instanceof Object[] perBuffer) {
                  blend = perBuffer.length > 0 ? perBuffer[0] : null;
               }

               blendMode = child(blend, "mode", "field_5045");
            }

            depthMode = child(value(state, "DEPTH"), "mode", "field_5074");
            cullMode = child(value(state, "CULL"), "enable", "field_5072");
            scissorMode = child(value(state, "SCISSOR"), "mode", "field_26840");
            activeTexture = field(state, "activeTexture");
            if (depthMode != null && cullMode != null && scissorMode != null && activeTexture != null && (blendEnable != null || blendMode != null)) {
               bool = field(depthMode.getClass(), "enabled", "field_5051");
               if (bool == null || bool.getType() != boolean.class || activeTexture.getType() != int.class) {
                  return "BooleanState.enabled";
               } else {
                  readFbo = field(state, "readFbo");
                  writeFbo = field(state, "writeFbo");
                  if (readFbo == null || writeFbo == null) {
                     readFbo = null;
                     writeFbo = null;
                     readFramebuffer = value(state, "READ_FRAMEBUFFER");
                     drawFramebuffer = value(state, "DRAW_FRAMEBUFFER");
                     if (readFramebuffer != null && drawFramebuffer != null) {
                        framebufferBinding = field(readFramebuffer.getClass(), "binding", "field_52509");
                     }

                     if (framebufferBinding == null) {
                        Class<?> minecraft = type("net.minecraft.client.Minecraft", "net.minecraft.class_310");
                        Class<?> target = type("com.mojang.blaze3d.pipeline.RenderTarget", "net.minecraft.class_276");
                        Method instance = minecraft == null ? null : method(minecraft, "getInstance", "method_1551");
                        Method main = minecraft == null ? null : method(minecraft, "getMainRenderTarget", "method_1522");
                        frameBufferId = target == null ? null : field(target, "frameBufferId", "field_1476");
                        if (instance == null || main == null || frameBufferId == null) {
                           return "the main render target";
                        }

                        mainTarget = main;
                        mainClient = instance;
                     }
                  }

                  Class<?> view = type(state.getName() + "$Viewport", state.getName() + "$class_1040");
                  if (view != null) {
                     viewport = value(view, "INSTANCE", "field_5169");
                     viewX = field(view, "x", "field_5172");
                     viewY = field(view, "y", "field_5171");
                     viewW = field(view, "width", "field_5170");
                     viewH = field(view, "height", "field_5168");
                     if (viewport == null || viewX == null || viewY == null || viewW == null || viewH == null) {
                        return "GlStateManager.Viewport";
                     }
                  }

                  // 1.20.5-1.21.1 (the versions without a framebuffer record) remember the
                  // last program; later versions bind theirs on every draw or pass.
                  Class<?> shader = type("net.minecraft.client.renderer.ShaderInstance", "net.minecraft.class_5944");
                  if (shader != null) {
                     lastProgramId = field(shader, "lastProgramId", "field_29486");
                     lastAppliedShader = field(shader, "lastAppliedShader", "field_29485");
                     if (lastProgramId == null || lastAppliedShader == null) {
                        lastProgramId = null;
                        lastAppliedShader = null;
                     }
                  }

                  if (mainTarget != null && lastProgramId == null) {
                     return "ShaderInstance.lastProgramId";
                  }

                  Class<?> uploader = type("com.mojang.blaze3d.vertex.BufferUploader", "net.minecraft.class_286");
                  if (uploader != null) {
                     invalidateUploader = method(uploader, "invalidate", "method_43436");
                  }

                  return null;
               }
            } else {
               return "the blend, depth, cull and scissor state";
            }
         }
      }

      private static Method mainClient;

      private static boolean on(Object mode) throws IllegalAccessException {
         return bool.getBoolean(mode);
      }

      /** Put the driver back where the game believes it is, and make the game rebind what it does not track. */
      static void restore() {
         try {
            GL13C.glActiveTexture(33984 + activeTexture.getInt(null));
            GL20C.glUseProgram(0);
            if (lastProgramId != null) {
               lastProgramId.setInt(null, -1);
               lastAppliedShader.set(null, null);
            }

            GL30C.glBindVertexArray(0);
            if (invalidateUploader != null) {
               invalidateUploader.invoke(null);
            }

            if (readFbo != null) {
               GL30C.glBindFramebuffer(36008, readFbo.getInt(null));
               GL30C.glBindFramebuffer(36009, writeFbo.getInt(null));
            } else if (framebufferBinding != null) {
               GL30C.glBindFramebuffer(36008, framebufferBinding.getInt(readFramebuffer));
               GL30C.glBindFramebuffer(36009, framebufferBinding.getInt(drawFramebuffer));
            } else {
               GL30C.glBindFramebuffer(36160, frameBufferId.getInt(mainTarget.invoke(mainClient.invoke(null))));
            }

            if (viewport != null) {
               GL11C.glViewport(viewX.getInt(viewport), viewY.getInt(viewport), viewW.getInt(viewport), viewH.getInt(viewport));
            }

            if (blendEnable != null) {
               for (int i = 0; i < blendEnable.length; i++) {
                  if (blendEnable[i]) {
                     GL30C.glEnablei(3042, i);
                  } else {
                     GL30C.glDisablei(3042, i);
                  }
               }
            } else {
               Saved.toggle(3042, on(blendMode));
            }

            Saved.toggle(2929, on(depthMode));
            Saved.toggle(2884, on(cullMode));
            Saved.toggle(3089, on(scissorMode));
         } catch (ReflectiveOperationException var1) {
            throw new IllegalStateException(var1);
         }
      }
   }

   /**
    * The pixel-pack buffer binding and PACK_* pixel store the clip recorder
    * changes for each frame it reads back, and puts back afterwards. Read with
    * five glGets per captured frame before; now read on the first frames and
    * once in {@link #RECHECK} after that, and trusted in between once the same
    * values have been seen {@link #PROVE} times in a row (the game leaves them
    * alone). A change turns the shortcut off for the session.
    */
   public static final class Packing {
      private static final int PROVE = 8;
      private static final int RECHECK = 1024;
      private final int[] seen = new int[5];
      private final int[] now = new int[5];
      private int proven;
      private int sinceCheck;
      private boolean distrusted;

      /** {buffer, row length, skip pixels, skip rows, alignment}: what to restore. */
      public int[] read() {
         if (!this.distrusted && this.proven >= PROVE && ++this.sinceCheck < RECHECK) {
            return this.seen;
         } else {
            this.sinceCheck = 0;
            this.now[0] = GL11C.glGetInteger(35053);
            this.now[1] = GL11C.glGetInteger(3330);
            this.now[2] = GL11C.glGetInteger(3332);
            this.now[3] = GL11C.glGetInteger(3331);
            this.now[4] = GL11C.glGetInteger(3333);
            if (!this.distrusted) {
               if (this.proven == 0 || java.util.Arrays.equals(this.now, this.seen)) {
                  System.arraycopy(this.now, 0, this.seen, 0, 5);
                  this.proven++;
               } else {
                  this.distrusted = true;
                  BlueClient.LOGGER.info("Clipping: the pixel-pack state changes between frames, so it keeps being read back");
               }
            }

            return this.now;
         }
      }
   }

   public static final class Target {
      public int fbo;
      public int colour;
      public int depth;
      public int width;
      public int height;
      private final boolean wantsDepth;

      public Target(boolean wantsDepth) {
         this.wantsDepth = wantsDepth;
      }

      public boolean size(int w, int h) {
         if (w <= 0 || h <= 0) {
            return false;
         } else if (this.fbo != 0 && this.width == w && this.height == h) {
            return true;
         } else {
            this.free();
            this.width = w;
            this.height = h;
            this.colour = GL11C.glGenTextures();
            GL11C.glBindTexture(3553, this.colour);
            GL11C.glTexImage2D(3553, 0, 34842, w, h, 0, 6408, 5126, (ByteBuffer)null);
            GL11C.glTexParameteri(3553, 10241, 9729);
            GL11C.glTexParameteri(3553, 10240, 9729);
            GL11C.glTexParameteri(3553, 10242, 33071);
            GL11C.glTexParameteri(3553, 10243, 33071);
            if (this.wantsDepth) {
               this.depth = GL11C.glGenTextures();
               GL11C.glBindTexture(3553, this.depth);
               GL11C.glTexImage2D(3553, 0, 36012, w, h, 0, 6402, 5126, (ByteBuffer)null);
               GL11C.glTexParameteri(3553, 10241, 9728);
               GL11C.glTexParameteri(3553, 10240, 9728);
               GL11C.glTexParameteri(3553, 10242, 33071);
               GL11C.glTexParameteri(3553, 10243, 33071);
            }

            this.fbo = GL30C.glGenFramebuffers();
            GL30C.glBindFramebuffer(36160, this.fbo);
            GL30C.glFramebufferTexture2D(36160, 36064, 3553, this.colour, 0);
            if (this.wantsDepth) {
               GL30C.glFramebufferTexture2D(36160, 36096, 3553, this.depth, 0);
            }

            int state = GL30C.glCheckFramebufferStatus(36160);
            if (state != 36053) {
               BlueClient.LOGGER.warn("framebuffer " + w + "x" + h + " came back incomplete: " + state);
               this.free();
               return false;
            } else {
               return true;
            }
         }
      }

      public void free() {
         if (this.fbo != 0) {
            GL30C.glDeleteFramebuffers(this.fbo);
         }

         if (this.colour != 0) {
            GL11C.glDeleteTextures(this.colour);
         }

         if (this.depth != 0) {
            GL11C.glDeleteTextures(this.depth);
         }

         this.fbo = this.colour = this.depth = 0;
         this.width = this.height = 0;
      }
   }
}
