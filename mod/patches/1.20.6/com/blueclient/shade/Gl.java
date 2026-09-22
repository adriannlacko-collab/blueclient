package com.blueclient.shade;

import com.blueclient.BlueClient;
import it.unimi.dsi.fastutil.ints.Int2ObjectOpenHashMap;
import it.unimi.dsi.fastutil.objects.Object2IntOpenHashMap;
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
      GL13C.glActiveTexture(33984 + unit);
      GL33C.glBindSampler(unit, 0);
      GL11C.glBindTexture(3553, texture);
      GL20C.glUniform1i(uniform(program, name), unit);
   }

   public static void sampler3D(int program, String name, int unit, int texture) {
      GL13C.glActiveTexture(33984 + unit);
      GL33C.glBindSampler(unit, 0);
      GL11C.glBindTexture(32879, texture);
      GL20C.glUniform1i(uniform(program, name), unit);
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
      public long elapsed = -1L;

      public void begin() {
         if (this.supported) {
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

   public static final class Saved {
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

      public Saved(int units, boolean volumes) {
         this.units = units;
         this.volumes = volumes;
         this.boundTexture = new int[units];
         this.boundVolume = new int[units];
         this.boundSampler = new int[units];
      }

      public void save() {
         this.held = false;
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

         for (int unit = 0; unit < this.units; unit++) {
            GL13C.glActiveTexture(33984 + unit);
            this.boundTexture[unit] = GL11C.glGetInteger(32873);
            if (this.volumes) {
               this.boundVolume[unit] = GL11C.glGetInteger(32874);
            }

            this.boundSampler[unit] = GL11C.glGetInteger(35097);
         }

         this.held = true;
      }

      public void restore() {
         if (this.held) {
            this.held = false;

            for (int unit = 0; unit < this.units; unit++) {
               GL13C.glActiveTexture(33984 + unit);
               GL11C.glBindTexture(3553, this.boundTexture[unit]);
               if (this.volumes) {
                  GL11C.glBindTexture(32879, this.boundVolume[unit]);
               }

               GL33C.glBindSampler(unit, this.boundSampler[unit]);
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
      }

      private static void toggle(int cap, boolean on) {
         if (on) {
            GL11C.glEnable(cap);
         } else {
            GL11C.glDisable(cap);
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
