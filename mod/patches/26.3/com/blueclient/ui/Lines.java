package com.blueclient.ui;

import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;
import com.mojang.blaze3d.vertex.PoseStack.Pose;
import net.minecraft.client.Minecraft;
import net.minecraft.util.ARGB;
import net.minecraft.world.phys.AABB;
import org.joml.Vector3f;

/**
 * The twelve edges of a box as lines. Same vertices, in the same order, with
 * the same values as before; it used to allocate six float[] loop arrays, a
 * Vector3f per edge for its direction, and (through VertexConsumer's default
 * methods) two more per vertex for the transformed position and normal, i.e.
 * about 66 objects a box, per box, per frame (a block waypoint, or every
 * marked block of the light-level overlay). The three edge directions are
 * the unit axes, so their transformed normals are worked out once per box;
 * positions are transformed into one reused vector. Render thread only.
 */
public final class Lines {
   private static final Vector3f AT = new Vector3f();
   private static final Vector3f ALONG_X = new Vector3f();
   private static final Vector3f ALONG_Y = new Vector3f();
   private static final Vector3f ALONG_Z = new Vector3f();

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
      Vector3f alongX = direction(pose, x1 - x0, 0.0F, 0.0F, ALONG_X);
      Vector3f alongY = direction(pose, 0.0F, y1 - y0, 0.0F, ALONG_Y);
      Vector3f alongZ = direction(pose, 0.0F, 0.0F, z1 - z0, ALONG_Z);
      edge(lines, pose, colour, width, x0, y0, z0, x1, y0, z0, alongX);
      edge(lines, pose, colour, width, x0, y0, z1, x1, y0, z1, alongX);
      edge(lines, pose, colour, width, x0, y1, z0, x1, y1, z0, alongX);
      edge(lines, pose, colour, width, x0, y1, z1, x1, y1, z1, alongX);
      edge(lines, pose, colour, width, x0, y0, z0, x0, y1, z0, alongY);
      edge(lines, pose, colour, width, x0, y0, z1, x0, y1, z1, alongY);
      edge(lines, pose, colour, width, x1, y0, z0, x1, y1, z0, alongY);
      edge(lines, pose, colour, width, x1, y0, z1, x1, y1, z1, alongY);
      edge(lines, pose, colour, width, x0, y0, z0, x0, y0, z1, alongZ);
      edge(lines, pose, colour, width, x0, y1, z0, x0, y1, z1, alongZ);
      edge(lines, pose, colour, width, x1, y0, z0, x1, y0, z1, alongZ);
      edge(lines, pose, colour, width, x1, y1, z0, x1, y1, z1, alongZ);
   }

   /** What setNormal(pose, normalize(edge)) hands the buffer: the normalised edge through the pose's normal matrix. */
   private static Vector3f direction(Pose pose, float dx, float dy, float dz, Vector3f into) {
      into.set(dx, dy, dz).normalize();
      return pose.transformNormal(into.x(), into.y(), into.z(), into);
   }

   private static void edge(
      VertexConsumer lines, Pose pose, int colour, float width, float ax, float ay, float az, float bx, float by, float bz, Vector3f along
   ) {
      Vector3f at = pose.pose().transformPosition(ax, ay, az, AT);
      lines.addVertex(at.x(), at.y(), at.z()).setColor(colour).setNormal(along.x(), along.y(), along.z()).setLineWidth(width);
      at = pose.pose().transformPosition(bx, by, bz, AT);
      lines.addVertex(at.x(), at.y(), at.z()).setColor(colour).setNormal(along.x(), along.y(), along.z()).setLineWidth(width);
   }
}
