package com.blueclient.hud.modules;

import com.blueclient.hud.BehaviourModule;
import com.blueclient.hud.Category;
import com.blueclient.hud.Setting;
import com.blueclient.hud.Submersion;
import com.blueclient.ui.Icon;
import net.minecraft.client.Minecraft;

public class NoFogModule extends BehaviourModule {
   private static NoFogModule active;
   private final Setting.Range terrain = this.add(new Setting.Range("terrain", "World fog", 0, 100, 0, "%"));
   private final Setting.Range water = this.add(new Setting.Range("water", "Water fog", 0, 100, 100, "%"));
   private final Setting.Range lava = this.add(new Setting.Range("lava", "Lava fog", 0, 100, 100, "%"));
   private final Setting.Range snow = this.add(new Setting.Range("snow", "Powder snow fog", 0, 100, 100, "%"));

   public NoFogModule() {
      super("nofog", "Fog distance", "How much fog you see, in the world and under water", Category.VISUAL, Icon.EYE, false);
      active = this;
   }

   public static float keepWorld() {
      return active != null && active.isEnabled() ? active.terrain.get() / 100.0F : 1.0F;
   }

   public static float keep(Submersion submersion) {
      if (active != null && active.isEnabled()) {
         Setting.Range slider = switch (submersion) {
            case WATER -> active.water;
            case LAVA -> active.lava;
            case POWDER_SNOW -> active.snow;
            default -> active.terrain;
         };
         return slider.get() / 100.0F;
      } else {
         return 1.0F;
      }
   }

   @Override
   public void tick(Minecraft client) {
   }
}
