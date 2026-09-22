package com.blueclient.ui;

import java.util.Map;
import java.util.IdentityHashMap;
import net.minecraft.class_265;
import net.minecraft.class_238;
import net.minecraft.class_259;
import net.minecraft.class_310;
import net.minecraft.class_4587;
import net.minecraft.class_4588;
import net.minecraft.class_9848;
import net.minecraft.class_9974;

public final class Lines {
   private static final Map<class_238, class_265> SHAPES = new IdentityHashMap<>();
   private Lines() {
   }

   /**
    * The shape of a box, kept by the box's identity: a block waypoint hands
    * over the same box every frame, and making a VoxelShape from it every
    * frame was a handful of objects per waypoint per frame. Boxes are
    * immutable; the table is emptied when it grows past 256. Render thread only.
    */
   private static class_265 shape(class_238 box) {
      class_265 kept = SHAPES.get(box);
      if (kept == null) {
         if (SHAPES.size() >= 256) {
            SHAPES.clear();
         }

         kept = class_259.method_1078(box);
         SHAPES.put(box, kept);
      }

      return kept;
   }

   public static void box(class_4587 matrices, class_4588 lines, class_238 box, float r, float g, float b, float a) {
      int colour = class_9848.method_61318(a, r, g, b);
      class_9974.method_62296(matrices, lines, shape(box), 0.0, 0.0, 0.0, colour, class_310.method_1551().method_22683().method_75291());
   }
}
