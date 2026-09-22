package com.blueclient.ui;

import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;
import java.util.ArrayList;
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
         recorder.reset(context.submitNodeCollector(), pose);
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

      void reset(SubmitNodeCollector collector, PoseStack pose) {
         this.collector = collector;
         this.pose = pose;
         this.layers.clear();
      }

      @Override
      public VertexConsumer getBuffer(RenderType layer) {
         return this.layers.computeIfAbsent(layer, key -> {
            Frames.Recording recording = new Frames.Recording();
            this.collector.submitCustomGeometry(this.pose, key, (p, consumer) -> recording.replay(consumer));
            return recording;
         });
      }
   }

   private static final class Recording implements VertexConsumer {
      private final List<Consumer<VertexConsumer>> calls = new ArrayList<>();

      void replay(VertexConsumer into) {
         for (Consumer<VertexConsumer> call : this.calls) {
            call.accept(into);
         }
      }

      public VertexConsumer addVertex(float x, float y, float z) {
         this.calls.add(c -> c.addVertex(x, y, z));
         return this;
      }

      public VertexConsumer setColor(int r, int g, int b, int a) {
         this.calls.add(c -> c.setColor(r, g, b, a));
         return this;
      }

      public VertexConsumer setColor(int argb) {
         this.calls.add(c -> c.setColor(argb));
         return this;
      }

      public VertexConsumer setUv(float u, float v) {
         this.calls.add(c -> c.setUv(u, v));
         return this;
      }

      public VertexConsumer setUv1(int u, int v) {
         this.calls.add(c -> c.setUv1(u, v));
         return this;
      }

      public VertexConsumer setUv2(int u, int v) {
         this.calls.add(c -> c.setUv2(u, v));
         return this;
      }

      public VertexConsumer setNormal(float x, float y, float z) {
         this.calls.add(c -> c.setNormal(x, y, z));
         return this;
      }

      public VertexConsumer setLineWidth(float width) {
         this.calls.add(c -> c.setLineWidth(width));
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
