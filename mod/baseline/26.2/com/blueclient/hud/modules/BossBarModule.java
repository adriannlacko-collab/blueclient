package com.blueclient.hud.modules;

import com.blueclient.hud.Anchor;
import com.blueclient.hud.Category;
import com.blueclient.hud.Module;
import com.blueclient.mixin.BossBarHudAccessor;
import com.blueclient.ui.Huds;
import com.blueclient.ui.Icon;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;

public class BossBarModule extends Module {
   private static final int BAR_W = 182;
   private static final int FIRST_BAR_Y = 12;
   private static final int NAME_LIFT = 9;
   private static final int BAR_H = 5;
   private static BossBarModule active;

   public BossBarModule() {
      super("bossbar", "Boss bar", "The bar servers put across the top, and where it sits", Category.VISUAL, Icon.COMBAT, Anchor.TOP_LEFT, true);
      active = this;
   }

   public static BossBarModule get() {
      return active;
   }

   public int drawnBars(Minecraft client) {
      if (client.gui == null) {
         return 0;
      } else {
         int held = ((BossBarHudAccessor)Huds.bossBar(client)).blueclient$bars().size();
         if (held == 0) {
            return 0;
         } else {
            int limit = client.getWindow().getGuiScaledHeight() / 3;
            int pitch = 10 + 9;
            int drawn = 0;
            int y = 12;

            for (int i = 0; i < held; i++) {
               drawn++;
               y += pitch;
               if (y >= limit) {
                  break;
               }
            }

            return drawn;
         }
      }
   }

   @Override
   public boolean isVisible(Minecraft client) {
      return this.drawnBars(client) > 0;
   }

   @Override
   public int width(Minecraft client) {
      return 182;
   }

   @Override
   public int height(Minecraft client) {
      int bars = this.drawnBars(client);
      if (bars == 0) {
         return 0;
      } else {
         int pitch = 10 + 9;
         return (bars - 1) * pitch + 5 + 9;
      }
   }

   @Override
   public int[] vanillaPlace(Minecraft client) {
      return this.drawnBars(client) == 0 ? null : new int[]{client.getWindow().getGuiScaledWidth() / 2 - 91, 3};
   }

   @Override
   public void render(GuiGraphicsExtractor ctx, Minecraft client, int x, int y) {
   }
}
