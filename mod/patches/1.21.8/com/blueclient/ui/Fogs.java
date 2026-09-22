package com.blueclient.ui;

import com.blueclient.hud.modules.NoFogModule;
import com.blueclient.hud.Submersion;
import net.minecraft.class_4184;
import net.minecraft.class_5636;

public final class Fogs {
   private Fogs() {
   }

   /**
    * What the camera is in, for the Fog distance module. Every fog setup asks;
    * while the module is off the answer is not used (keep() is 1 whatever it
    * is), so the camera's fluid lookup is skipped and NONE returned.
    */
   public static Submersion where(class_4184 camera) {
      if (camera == null || !NoFogModule.on()) {
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
