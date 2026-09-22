package com.blueclient.ui;

import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;
import com.mojang.blaze3d.vertex.PoseStack.Pose;
import net.minecraft.client.Minecraft;
import net.minecraft.util.ARGB;
import net.minecraft.world.phys.AABB;
import org.joml.Vector3f;

public final class Lines {
   private Lines() {
   }

   public static void box(PoseStack matrices, VertexConsumer lines, AABB box, float r, float g, float b, float a) {
      int colour = ARGB.colorFromFloat(a, r, g, b);
      float width = Minecraft.getInstance().getWindow().getAppropriateLineWidth();
      Pose pose = matrices.last();
      float x0 = (float)box.minX;
      float y0 = (float)box.minY;
      float z0 = (float)box.minZ;
      float x1 = (float)box.maxX;
      float y1 = (float)box.maxY;
      float z1 = (float)box.maxZ;

      for (float y : new float[]{y0, y1}) {
         for (float z : new float[]{z0, z1}) {
            edge(lines, pose, colour, width, x0, y, z, x1, y, z);
         }
      }

      for (float x : new float[]{x0, x1}) {
         for (float z : new float[]{z0, z1}) {
            edge(lines, pose, colour, width, x, y0, z, x, y1, z);
         }
      }

      for (float x : new float[]{x0, x1}) {
         for (float y : new float[]{y0, y1}) {
            edge(lines, pose, colour, width, x, y, z0, x, y, z1);
         }
      }
   }

   private static void edge(VertexConsumer lines, Pose pose, int colour, float width, float ax, float ay, float az, float bx, float by, float bz) {
      Vector3f along = new Vector3f(bx - ax, by - ay, bz - az).normalize();
      lines.addVertex(pose, ax, ay, az).setColor(colour).setNormal(pose, along).setLineWidth(width);
      lines.addVertex(pose, bx, by, bz).setColor(colour).setNormal(pose, along).setLineWidth(width);
   }
}
