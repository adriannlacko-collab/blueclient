package com.blueclient.ui;

import com.blueclient.hud.modules.NoFogModule;
import com.blueclient.hud.Submersion;
import net.minecraft.client.Camera;
import net.minecraft.world.level.material.FogType;

public final class Fogs {
   private Fogs() {
   }

   /**
    * What the camera is in, for the Fog distance module. Every fog setup asks;
    * while the module is off the answer is not used (keep() is 1 whatever it
    * is), so the camera's fluid lookup is skipped and NONE returned.
    */
   public static Submersion where(Camera camera) {
      if (camera == null || !NoFogModule.on()) {
         return Submersion.NONE;
      } else {
         FogType type = camera.getFluidInCamera();
         if (type == null) {
            return Submersion.NONE;
         } else {
            return switch (type) {
               case WATER -> Submersion.WATER;
               case LAVA -> Submersion.LAVA;
               case POWDER_SNOW -> Submersion.POWDER_SNOW;
               default -> Submersion.NONE;
            };
         }
      }
   }
}
