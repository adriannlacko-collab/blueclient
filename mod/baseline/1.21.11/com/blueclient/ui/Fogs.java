package com.blueclient.ui;

import com.blueclient.hud.Submersion;
import net.minecraft.class_4184;
import net.minecraft.class_5636;

public final class Fogs {
   private Fogs() {
   }

   public static Submersion where(class_4184 camera) {
      if (camera == null) {
         return Submersion.NONE;
      } else {
         class_5636 type = camera.method_19334();
         if (type == null) {
            return Submersion.NONE;
         } else {
            return switch (type) {
               case field_27886 -> Submersion.WATER;
               case field_27885 -> Submersion.LAVA;
               case field_27887 -> Submersion.POWDER_SNOW;
               default -> Submersion.NONE;
            };
         }
      }
   }
}
