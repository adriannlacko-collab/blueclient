package com.blueclient.ui;

import java.util.Map;
import java.util.IdentityHashMap;
import net.minecraft.world.phys.shapes.VoxelShape;
import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.ShapeRenderer;
import net.minecraft.util.ARGB;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.shapes.Shapes;

public final class Lines {
   private static final Map<AABB, VoxelShape> SHAPES = new IdentityHashMap<>();
   private Lines() {
   }

   /**
    * The shape of a box, kept by the box's identity: a block waypoint hands
    * over the same box every frame, and making a VoxelShape from it every
    * frame was a handful of objects per waypoint per frame. Boxes are
    * immutable; the table is emptied when it grows past 256. Render thread only.
    */
   private static VoxelShape shape(AABB box) {
      VoxelShape kept = SHAPES.get(box);
      if (kept == null) {
         if (SHAPES.size() >= 256) {
            SHAPES.clear();
         }

         kept = Shapes.create(box);
         SHAPES.put(box, kept);
      }

      return kept;
   }

   public static void box(PoseStack matrices, VertexConsumer lines, AABB box, float r, float g, float b, float a) {
      int colour = ARGB.colorFromFloat(a, r, g, b);
      ShapeRenderer.renderShape(matrices, lines, shape(box), 0.0, 0.0, 0.0, colour, Minecraft.getInstance().getWindow().getAppropriateLineWidth());
   }
}
