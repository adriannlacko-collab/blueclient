package com.blueclient.ui;

import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import net.fabricmc.fabric.api.client.rendering.v1.level.LevelExtractionContext;
import net.fabricmc.fabric.api.client.rendering.v1.level.LevelExtractionEvents;
import net.fabricmc.fabric.api.client.rendering.v1.level.LevelRenderContext;
import net.fabricmc.fabric.api.client.rendering.v1.level.LevelRenderEvents;
import net.fabricmc.fabric.api.client.rendering.v1.level.LevelRenderEvents.CollectSubmits;
import net.minecraft.client.Camera;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.renderer.SubmitNodeCollector;
import net.minecraft.client.renderer.rendertype.RenderType;
import net.minecraft.client.renderer.state.level.CameraRenderState;
import org.joml.Matrix4fc;

public final class Frames {
   private static ClientLevel world;
   private static Camera camera;
   private static Matrix4fc projection;
   private static Matrix4fc view;
   private static float tickDelta;
   private static boolean listening;
   private static Frame last;
   private static final Frames.Router ROUTER = new Frames.Router();
   private static final List<Frames.Recorder> RECORDERS = new ArrayList<>();
   private static int used;
   private static int generation;

   private Frames() {
   }

   public static void afterTranslucent(BooleanSupplier wants, Consumer<Frame> handler) {
      listen();
      LevelRenderEvents.COLLECT_SUBMITS.register((CollectSubmits)context -> {
         if (wants.getAsBoolean()) {
            handler.accept(of(context));
         }
      });
   }

   public static void end(BooleanSupplier wants, Consumer<Frame> handler) {
      listen();
      LevelRenderEvents.COLLECT_SUBMITS.register((CollectSubmits)context -> {
         if (wants.getAsBoolean()) {
            handler.accept(of(context));
         }
      });
   }

   private static void listen() {
      if (!listening) {
         listening = true;
         LevelExtractionEvents.END_EXTRACTION.register(Frames::extract);
      }
   }

   private static void extract(LevelExtractionContext context) {
      world = context.level();
      camera = context.camera();
      CameraRenderState state = context.levelState().cameraRenderState;
      projection = state.projectionMatrix;
      view = state.viewRotationMatrix;
      tickDelta = context.deltaTracker().getGameTimeDeltaPartialTick(false);
      last = null;
      used = 0;
      generation++;
   }

   private static Frame of(LevelRenderContext context) {
      if (context == null) {
         return null;
      } else {
         PoseStack pose = context.poseStack();
         if (used == RECORDERS.size()) {
            RECORDERS.add(new Frames.Recorder());
         }

         Frames.Recorder recorder = RECORDERS.get(used++);
         recorder.reset(context.submitNodeCollector(), pose, generation);
         ROUTER.current = recorder;
         Frame frame = last;
         if (frame != null && frame.matrices() == pose) {
            return frame;
         } else {
            frame = new Frame(world, camera, pose, ROUTER, projection, view, tickDelta);
            last = frame;
            return frame;
         }
      }
   }

   private static final class Recorder implements Frame.Buffers {
      private SubmitNodeCollector collector;
      private PoseStack pose;
      private final Map<RenderType, Frames.Recording> layers = new HashMap<>();
      private final Map<RenderType, Frames.Recording> evenFrames = new HashMap<>();
      private final Map<RenderType, Frames.Recording> oddFrames = new HashMap<>();
      private Map<RenderType, Frames.Recording> spare = this.evenFrames;

      void reset(SubmitNodeCollector collector, PoseStack pose, int generation) {
         this.collector = collector;
         this.pose = pose;
         this.layers.clear();
         this.spare = (generation & 1) == 0 ? this.evenFrames : this.oddFrames;
      }

      @Override
      public VertexConsumer getBuffer(RenderType layer) {
         Frames.Recording recording = this.layers.get(layer);
         if (recording == null) {
            // A recording is replayed by the collector later in the frame it was
            // made in, so the one made two frames ago is free to be written again.
            // Alternating two sets keeps even a replay that ran a frame late safe.
            recording = this.spare.get(layer);
            if (recording == null) {
               recording = new Frames.Recording();
               this.spare.put(layer, recording);
            }

            recording.clear();
            this.layers.put(layer, recording);
            Frames.Recording replaying = recording;
            this.collector.submitCustomGeometry(this.pose, layer, (p, consumer) -> replaying.replay(consumer));
         }

         return recording;
      }
   }

   /**
    * The vertices a module hands over, kept to be replayed into the real
    * buffer when the collector draws. It used to keep one capturing lambda per
    * call (six or seven a vertex: a beam cost ~200 objects a frame, the light
    * level overlay tens of thousands); it now keeps the calls as numbers in one
    * reused int array, replayed in the same order with the same values.
    */
   private static final class Recording implements VertexConsumer {
      private static final int VERTEX = 0;
      private static final int COLOR_RGBA = 1;
      private static final int COLOR = 2;
      private static final int UV = 3;
      private static final int UV1 = 4;
      private static final int UV2 = 5;
      private static final int NORMAL = 6;
      private static final int LINE_WIDTH = 7;
      private int[] data = new int[256];
      private int size;

      void clear() {
         this.size = 0;
      }

      private int[] room(int needed) {
         int[] d = this.data;
         if (this.size + needed > d.length) {
            d = Arrays.copyOf(d, Math.max(d.length * 2, this.size + needed));
            this.data = d;
         }

         return d;
      }

      private static float f(int bits) {
         return Float.intBitsToFloat(bits);
      }

      private static int bits(float value) {
         return Float.floatToRawIntBits(value);
      }

      void replay(VertexConsumer into) {
         int[] d = this.data;
         int n = this.size;
         int i = 0;

         while (i < n) {
            switch (d[i]) {
               case VERTEX:
                  into.addVertex(f(d[i + 1]), f(d[i + 2]), f(d[i + 3]));
                  i += 4;
                  break;
               case COLOR_RGBA:
                  into.setColor(d[i + 1], d[i + 2], d[i + 3], d[i + 4]);
                  i += 5;
                  break;
               case COLOR:
                  into.setColor(d[i + 1]);
                  i += 2;
                  break;
               case UV:
                  into.setUv(f(d[i + 1]), f(d[i + 2]));
                  i += 3;
                  break;
               case UV1:
                  into.setUv1(d[i + 1], d[i + 2]);
                  i += 3;
                  break;
               case UV2:
                  into.setUv2(d[i + 1], d[i + 2]);
                  i += 3;
                  break;
               case NORMAL:
                  into.setNormal(f(d[i + 1]), f(d[i + 2]), f(d[i + 3]));
                  i += 4;
                  break;
               case LINE_WIDTH:
                  into.setLineWidth(f(d[i + 1]));
                  i += 2;
                  break;
               default:
                  throw new IllegalStateException("bad recorded vertex call " + d[i]);
            }
         }
      }

      public VertexConsumer addVertex(float x, float y, float z) {
         int[] d = this.room(4);
         int at = this.size;
         d[at] = VERTEX;
         d[at + 1] = bits(x);
         d[at + 2] = bits(y);
         d[at + 3] = bits(z);
         this.size = at + 4;
         return this;
      }

      public VertexConsumer setColor(int r, int g, int b, int a) {
         int[] d = this.room(5);
         int at = this.size;
         d[at] = COLOR_RGBA;
         d[at + 1] = r;
         d[at + 2] = g;
         d[at + 3] = b;
         d[at + 4] = a;
         this.size = at + 5;
         return this;
      }

      public VertexConsumer setColor(int argb) {
         int[] d = this.room(2);
         int at = this.size;
         d[at] = COLOR;
         d[at + 1] = argb;
         this.size = at + 2;
         return this;
      }

      public VertexConsumer setUv(float u, float v) {
         return this.pair(UV, bits(u), bits(v));
      }

      public VertexConsumer setUv1(int u, int v) {
         return this.pair(UV1, u, v);
      }

      public VertexConsumer setUv2(int u, int v) {
         return this.pair(UV2, u, v);
      }

      private VertexConsumer pair(int op, int a, int b) {
         int[] d = this.room(3);
         int at = this.size;
         d[at] = op;
         d[at + 1] = a;
         d[at + 2] = b;
         this.size = at + 3;
         return this;
      }

      public VertexConsumer setNormal(float x, float y, float z) {
         int[] d = this.room(4);
         int at = this.size;
         d[at] = NORMAL;
         d[at + 1] = bits(x);
         d[at + 2] = bits(y);
         d[at + 3] = bits(z);
         this.size = at + 4;
         return this;
      }

      public VertexConsumer setLineWidth(float width) {
         int[] d = this.room(2);
         int at = this.size;
         d[at] = LINE_WIDTH;
         d[at + 1] = bits(width);
         this.size = at + 2;
         return this;
      }
   }

   private static final class Router implements Frame.Buffers {
      private Frames.Recorder current;

      @Override
      public VertexConsumer getBuffer(RenderType layer) {
         return this.current.getBuffer(layer);
      }
   }
}
