package com.blueclient.ui;

import com.blueclient.hud.Submersion;
import net.minecraft.client.Camera;
import net.minecraft.world.level.material.FogType;

public final class Fogs {
   private Fogs() {
   }

   public static Submersion where(Camera camera) {
      if (camera == null) {
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
