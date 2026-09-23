package com.blueclient.ui;

import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.ShapeRenderer;
import net.minecraft.util.ARGB;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.shapes.Shapes;

public final class Lines {
   private Lines() {
   }

   public static void box(PoseStack matrices, VertexConsumer lines, AABB box, float r, float g, float b, float a) {
      int colour = ARGB.colorFromFloat(a, r, g, b);
      ShapeRenderer.renderShape(matrices, lines, Shapes.create(box), 0.0, 0.0, 0.0, colour, Minecraft.getInstance().getWindow().getAppropriateLineWidth());
   }
}
