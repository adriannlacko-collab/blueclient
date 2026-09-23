package com.blueclient.hud;

import com.blueclient.Config;
import com.blueclient.graphics.Graphics;
import com.blueclient.hud.modules.AirModule;
import com.blueclient.hud.modules.ArmourModule;
import com.blueclient.hud.modules.BadgeModule;
import com.blueclient.hud.modules.BlockOutlineModule;
import com.blueclient.hud.modules.BlocksModule;
import com.blueclient.hud.modules.BossBarModule;
import com.blueclient.hud.modules.CameraModule;
import com.blueclient.hud.modules.ChatModule;
import com.blueclient.hud.modules.ClippingModule;
import com.blueclient.hud.modules.ClockModule;
import com.blueclient.hud.modules.CloudsModule;
import com.blueclient.hud.modules.ColourModule;
import com.blueclient.hud.modules.ColourSaturationModule;
import com.blueclient.hud.modules.CoordinatesModule;
import com.blueclient.hud.modules.CpsModule;
import com.blueclient.hud.modules.CrosshairModule;
import com.blueclient.hud.modules.DayModule;
import com.blueclient.hud.modules.DetailModule;
import com.blueclient.hud.modules.DropProtectionModule;
import com.blueclient.hud.modules.DynamicLightsModule;
import com.blueclient.hud.modules.EffectsModule;
import com.blueclient.hud.modules.FpsModule;
import com.blueclient.hud.modules.FreelookModule;
import com.blueclient.hud.modules.FullbrightModule;
import com.blueclient.hud.modules.HealthIndicatorsModule;
import com.blueclient.hud.modules.HurtCamModule;
import com.blueclient.hud.modules.KeystrokesModule;
import com.blueclient.hud.modules.LightModule;
import com.blueclient.hud.modules.LightingModule;
import com.blueclient.hud.modules.LowFireModule;
import com.blueclient.hud.modules.MinimapModule;
import com.blueclient.hud.modules.MusicModule;
import com.blueclient.hud.modules.NoFogModule;
import com.blueclient.hud.modules.ParticlesModule;
import com.blueclient.hud.modules.PingModule;
import com.blueclient.hud.modules.SaturationModule;
import com.blueclient.hud.modules.ScoreboardModule;
import com.blueclient.hud.modules.ShadersModule;
import com.blueclient.hud.modules.ShadowsModule;
import com.blueclient.hud.modules.ShieldModule;
import com.blueclient.hud.modules.ShulkerPreviewModule;
import com.blueclient.hud.modules.SkyModule;
import com.blueclient.hud.modules.SmallItemsModule;
import com.blueclient.hud.modules.SmallTotemModule;
import com.blueclient.hud.modules.SprintModule;
import com.blueclient.hud.modules.TargetModule;
import com.blueclient.hud.modules.TimeModule;
import com.blueclient.hud.modules.TotemModule;
import com.blueclient.hud.modules.WaterModule;
import com.blueclient.hud.modules.WaypointsModule;
import com.blueclient.hud.modules.WeatherModule;
import com.blueclient.hud.modules.WindModule;
import com.blueclient.hud.modules.ZoomModule;
import com.blueclient.ui.DebugText;
import com.blueclient.ui.Gui;
import com.blueclient.ui.Huds;
import com.blueclient.ui.MenuHint;
import com.blueclient.ui.Screens;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import net.minecraft.class_1747;
import net.minecraft.class_1802;
import net.minecraft.class_310;
import net.minecraft.class_332;
import net.minecraft.class_3489;

public final class Hud {
   private static final float MARGIN = 0.012F;
   private static final float STEP = 0.045F;
   private static final List<Module> MODULES = new ArrayList<>();
   private static final List<Module> FRAME_WANTERS = new ArrayList<>();
   private static final List<Module> VISIBLE = new ArrayList<>();
   private static Module crosshair;
   private static int frame;
   private static final int EDGE = 4;
   private static final int STACK_GAP = 2;
   private static int stackingFrame;
   private static final List<Module> STACKABLE = new ArrayList<>();
   private static final int[] USED = new int[Anchor.values().length];
   private static int[] boxes = new int[64];
   private static int boxCount;

   static int frameToken() {
      return frame;
   }

   private Hud() {
   }

   public static void register() {
      MODULES.clear();
      MODULES.add(new FpsModule());
      MODULES.add(new PingModule());
      MODULES.add(new CoordinatesModule());
      MODULES.add(new ClockModule());
      MODULES.add(new DayModule());
      MODULES.add(new MinimapModule());
      MODULES.add(new ShulkerPreviewModule());
      MODULES.add(new CrosshairModule());
      MODULES.add(new CpsModule());
      MODULES.add(new KeystrokesModule());
      MODULES.add(new TargetModule());
      MODULES.add(new ArmourModule());
      MODULES.add(new TotemModule());
      MODULES.add(new EffectsModule());
      MODULES.add(new SaturationModule());
      MODULES.add(new ChatModule());
      MODULES.add(new ScoreboardModule());
      MODULES.add(new BossBarModule());
      MODULES.add(new WaypointsModule());
      MODULES.add(new SprintModule());
      MODULES.add(new ClippingModule());
      MODULES.add(new BadgeModule());
      MODULES.add(new MusicModule());
      MODULES.add(new HurtCamModule());
      MODULES.add(new ShieldModule());
      MODULES.add(new LowFireModule());
      MODULES.add(new ZoomModule());
      MODULES.add(new FreelookModule());
      MODULES.add(new HealthIndicatorsModule());
      MODULES.add(new LightModule());
      MODULES.add(new FullbrightModule());
      MODULES.add(new NoFogModule());
      MODULES.add(new TimeModule());
      MODULES.add(new WeatherModule());
      MODULES.add(new DynamicLightsModule());
      MODULES.add(new DropProtectionModule());
      MODULES.add(new ParticlesModule());
      MODULES.add(new BlockOutlineModule());
      MODULES.add(new ColourSaturationModule());
      MODULES.add(new DetailModule());
      MODULES.add(
         new SmallItemsModule(
            "smalltools",
            "Small tools",
            "Every weapon and tool — swords, axes, bows, pickaxes, shovels, hoes and the rest — smaller in your hand",
            () -> class_1802.field_8802,
            stack -> stack.method_31573(class_3489.field_42611)
               || stack.method_31574(class_1802.field_49814)
               || stack.method_31574(class_1802.field_8547)
               || stack.method_31573(class_3489.field_42612)
               || stack.method_31574(class_1802.field_8102)
               || stack.method_31574(class_1802.field_8399)
               || stack.method_31573(class_3489.field_42614)
               || stack.method_31573(class_3489.field_42615)
               || stack.method_31573(class_3489.field_42613)
               || stack.method_31574(class_1802.field_8868)
               || stack.method_31574(class_1802.field_8378)
               || stack.method_31574(class_1802.field_42716)
               || stack.method_31574(class_1802.field_8884)
         )
      );
      MODULES.add(new SmallTotemModule());
      MODULES.add(new SmallItemsModule.Shield());
      MODULES.add(
         new SmallItemsModule(
            "smallblocks", "Small blocks", "Any block, smaller in your hand", () -> class_1802.field_20412, stack -> stack.method_7909() instanceof class_1747
         )
      );
      MODULES.add(
         new SmallItemsModule(
            "smallother",
            "Small other items",
            "Everything the rows above do not name — food, potions, pearls and the rest — smaller in your hand",
            () -> class_1802.field_8705,
            stack -> true
         )
      );
      MODULES.add(new ShadersModule());
      MODULES.add(new LightingModule());
      MODULES.add(new ShadowsModule());
      MODULES.add(new CloudsModule());
      MODULES.add(new SkyModule());
      MODULES.add(new WaterModule());
      MODULES.add(new AirModule());
      MODULES.add(new WindModule());
      MODULES.add(new BlocksModule());
      MODULES.add(new CameraModule());
      MODULES.add(new ColourModule());
      crosshair = null;
      FRAME_WANTERS.clear();

      for (Module module : MODULES) {
         if (module.id.equals("crosshair")) {
            crosshair = module;
         }

         if (module.wantsFrame()) {
            FRAME_WANTERS.add(module);
         }
      }

      layOutDefaults();
   }

   private static void layOutDefaults() {
      int[] used = new int[Anchor.values().length];

      for (Module module : MODULES) {
         Position position = module.position();
         if (position != null) {
            Anchor anchor = module.anchor();
            int index = used[anchor.ordinal()]++;
            float offset = 0.012F + index * 0.045F;
            switch (anchor) {
               case TOP_LEFT:
                  position.defaultTo(0.012F, offset);
                  break;
               case TOP_RIGHT:
                  position.defaultTo(0.988F, offset);
                  break;
               case BOTTOM_LEFT:
                  position.defaultTo(0.012F, 1.0F - offset);
                  break;
               case BOTTOM_RIGHT:
                  position.defaultTo(0.988F, 1.0F - offset);
                  break;
               default:
                  position.defaultTo(0.5F, 0.5F);
            }

            switch (anchor) {
               case TOP_LEFT:
               case BOTTOM_LEFT:
                  position.adoptFanSlot(0.012F, 0.012F, 0.045F);
                  break;
               case TOP_RIGHT:
               case BOTTOM_RIGHT:
                  position.adoptFanSlot(0.988F, 0.012F, 0.045F);
            }
         }
      }
   }

   public static void resetLayout() {
      for (Module module : MODULES) {
         if (module.position() != null) {
            module.position().reset();
         }

         if (module.scale() != null) {
            module.scale().reset();
         }
      }

      Config.forgetSwitchedOn();

      for (Module module : MODULES) {
         module.switchedOn = Config.switchedOn(module.id);
      }

      Config.save();
   }

   public static List<Module> modules() {
      return MODULES;
   }

   public static List<Module> inCategory(Category category) {
      List<Module> out = new ArrayList<>();

      for (Module module : MODULES) {
         if (module.category == category && module.listedInMenus()) {
            out.add(module);
         }
      }

      return out;
   }

   public static List<Module> onScreen(class_310 client) {
      VISIBLE.clear();

      for (int i = 0; i < MODULES.size(); i++) {
         Module module = MODULES.get(i);
         if (module.isEnabled() && module.isVisible(client)) {
            VISIBLE.add(module);
         }
      }

      return VISIBLE;
   }

   public static void tick(class_310 client) {
      MusicModule music = MusicModule.get();
      if (music != null) {
         music.tick(client);
      }

      if (client.field_1724 != null) {
         for (Module module : MODULES) {
            if (module != music) {
               module.tick(client);
            }
         }
      }
   }

   public static void render(class_332 ctx, class_310 client) {
      frame++;
      if (client.field_1724 != null) {
         for (int i = 0; i < FRAME_WANTERS.size(); i++) {
            FRAME_WANTERS.get(i).frame(client);
         }

         if (Graphics.applying() && Screens.current(client) == null) {
            applyingNotice(ctx, client);
         }

         if (!Huds.hidden(client)) {
            WaypointsModule.renderLabels(ctx, client);
            if (Screens.current(client) == null) {
               MenuHint.render(ctx, client);
            }

            int screenW = ctx.method_51421();
            int screenH = ctx.method_51443();
            stackDefaults(client, screenW, screenH);
            List<Module> showing = VISIBLE;

            for (int i = 0; i < showing.size(); i++) {
               Module module = showing.get(i);
               if (module.anchor() == Anchor.CENTER && module != crosshair) {
                  module.render(ctx, client, x(module, client, screenW), y(module, client, screenH));
               }
            }

            if (!DebugText.showing(client)) {
               for (int ix = 0; ix < showing.size(); ix++) {
                  Module module = showing.get(ix);
                  if (module.anchor() != Anchor.CENTER) {
                     draw(ctx, module, client, screenW, screenH);
                  }
               }
            }
         }
      }
   }

   private static void applyingNotice(class_332 ctx, class_310 client) {
      String text = "Applying shaders...";
      int w = client.field_1772.method_1727(text);
      int x = (ctx.method_51421() - w) / 2;
      int y = 6;
      ctx.method_25294(x - 2, y - 1, x + w + 2, y + 9, -1873784752);
      ctx.method_51433(client.field_1772, text, x, y, -2039584, false);
      Graphics.noticeShown();
   }

   public static boolean replacesCrosshair() {
      return crosshair != null && crosshair.isEnabled();
   }

   public static void renderCrosshair(class_332 ctx, class_310 client) {
      Module module = crosshair;
      if (module != null && module.isEnabled() && client.field_1724 != null) {
         module.render(ctx, client, x(module, client, ctx.method_51421()), y(module, client, ctx.method_51443()));
      }
   }

   public static int crosshairIndicatorDrop(class_332 ctx, class_310 client) {
      Module module = crosshair;
      if (module != null && module.isEnabled()) {
         int screenH = ctx.method_51443();
         int box = module.scaledHeight(client);
         int bottom = (screenH - box) / 2 + box - 1;
         int vanillaBottom = (screenH - 15) / 2 + 11;
         return Math.max(0, bottom - vanillaBottom);
      } else {
         return 0;
      }
   }

   private static int[] stackedOf(Module module) {
      return module.stackFrame == stackingFrame ? module.stackAt : null;
   }

   private static void stack(Module module, int px, int py) {
      module.stackAt[0] = px;
      module.stackAt[1] = py;
      module.stackFrame = stackingFrame;
   }

   public static void stackDefaults(class_310 client, int screenW, int screenH) {
      stackingFrame++;
      STACKABLE.clear();
      boxCount = 0;
      Arrays.fill(USED, 0);
      Module armour = null;
      Module totems = null;
      Module keystrokes = null;
      Module cps = null;
      List<Module> showing = onScreen(client);

      for (int i = 0; i < showing.size(); i++) {
         Module module = showing.get(i);
         Anchor anchor = module.anchor();
         Position position = module.position();
         if (anchor != Anchor.CENTER && position != null) {
            int w = module.scaledWidth(client);
            int h = module.scaledHeight(client);
            if (!position.isDefault()) {
               keepOut(position.screenX(screenW, w), position.screenY(screenH, h), w, h);
            } else {
               int[] home = module.vanillaPlace(client);
               if (home != null) {
                  keepOut(home[0], home[1], w, h);
               } else {
                  int at = module.switchedOn;
                  int slot = STACKABLE.size();

                  while (slot > 0 && STACKABLE.get(slot - 1).switchedOn > at) {
                     slot--;
                  }

                  STACKABLE.add(slot, module);
                  if (module.id.equals("armour")) {
                     armour = module;
                  }

                  if (module.id.equals("totems")) {
                     totems = module;
                  }

                  if (module.id.equals("keystrokes")) {
                     keystrokes = module;
                  }

                  if (module.id.equals("cps")) {
                     cps = module;
                  }
               }
            }
         }
      }

      boolean paired = armour != null && totems != null;
      boolean clicksBeside = keystrokes != null && cps != null;

      for (int ix = 0; ix < STACKABLE.size(); ix++) {
         Module module = STACKABLE.get(ix);
         if ((!paired || module != totems) && (!clicksBeside || module != cps)) {
            Anchor anchor = module.anchor();
            int w = module.scaledWidth(client);
            int h = module.scaledHeight(client);
            int slot = anchor.ordinal();
            boolean left = anchor == Anchor.TOP_LEFT || anchor == Anchor.BOTTOM_LEFT;
            boolean fromTop = anchor == Anchor.TOP_LEFT || anchor == Anchor.TOP_RIGHT;
            int px = left ? 4 : screenW - 4 - w;
            int py = fromTop ? 4 + USED[slot] : screenH - 4 - USED[slot] - h;
            if (module == armour) {
               py = screenH - h;
            }

            int bx = px;
            int bw = w;
            int bh = h;
            if (paired && module == armour) {
               int side = totems.scaledWidth(client);
               bx = px - 2 - side;
               bw = w + 2 + side;
               bh = Math.max(h, totems.scaledHeight(client));
            } else if (clicksBeside && module == keystrokes) {
               bw = w + 4 + cps.scaledWidth(client);
               bh = Math.max(h, cps.scaledHeight(client));
            }

            int by = clearOf(bx, py + h - bh, bw, bh, fromTop, screenH);
            py = by + bh - h;
            keepOut(bx, by, bw, bh);
            USED[slot] = fromTop ? by + bh + 2 - 4 : screenH - 4 - by + 2;
            stack(module, px, py);
         }
      }

      if (paired) {
         int[] at = armour.stackAt;
         stack(totems, at[0] - 2 - totems.scaledWidth(client), at[1] + armour.scaledHeight(client) - totems.scaledHeight(client));
      }

      if (clicksBeside && stackedOf(keystrokes) != null) {
         int[] at = keystrokes.stackAt;
         stack(cps, at[0] + keystrokes.scaledWidth(client) + 4, at[1] + keystrokes.scaledHeight(client) - cps.scaledHeight(client));
      }
   }

   private static void keepOut(int x, int y, int w, int h) {
      if (w > 0 && h > 0) {
         if (boxCount * 4 == boxes.length) {
            boxes = Arrays.copyOf(boxes, boxes.length * 2);
         }

         int at = boxCount++ * 4;
         boxes[at] = x;
         boxes[at + 1] = y;
         boxes[at + 2] = w;
         boxes[at + 3] = h;
      }
   }

   private static int clearOf(int x, int y, int w, int h, boolean fromTop, int screenH) {
      boolean moved = true;

      while (moved) {
         moved = false;

         for (int i = 0; i < boxCount; i++) {
            int bx = boxes[i * 4];
            int by = boxes[i * 4 + 1];
            int bw = boxes[i * 4 + 2];
            int bh = boxes[i * 4 + 3];
            if (x < bx + bw && x + w > bx && y < by + bh && y + h > by) {
               y = fromTop ? by + bh + 2 : by - h - 2;
               moved = true;
            }
         }
      }

      return Math.max(0, Math.min(screenH - h, y));
   }

   public static int[] stackedAt(Module module) {
      return stackedOf(module);
   }

   public static void draw(class_332 ctx, Module module, class_310 client, int screenW, int screenH) {
      float factor = module.scale() == null ? 1.0F : module.scale().get();
      int px = x(module, client, screenW);
      int py = y(module, client, screenH);
      if (factor == 1.0F) {
         module.render(ctx, client, px, py);
      } else {
         Gui.push(ctx);
         Gui.move(ctx, px, py);
         Gui.scale(ctx, factor, factor);
         module.render(ctx, client, 0, 0);
         Gui.pop(ctx);
      }
   }

   public static int x(Module module, class_310 client, int screenW) {
      int[] stacked = stackedOf(module);
      if (stacked != null) {
         return stacked[0];
      } else {
         Position position = module.position();
         int w = module.scaledWidth(client);
         if (position == null) {
            return (screenW - w) / 2;
         } else {
            if (position.isDefault()) {
               int[] home = module.vanillaPlace(client);
               if (home != null) {
                  return home[0];
               }
            }

            return position.screenX(screenW, w);
         }
      }
   }

   public static int y(Module module, class_310 client, int screenH) {
      int[] stacked = stackedOf(module);
      if (stacked != null) {
         return stacked[1];
      } else {
         Position position = module.position();
         int h = module.scaledHeight(client);
         if (position == null) {
            return (screenH - h) / 2;
         } else {
            if (position.isDefault()) {
               int[] home = module.vanillaPlace(client);
               if (home != null) {
                  return home[1];
               }
            }

            return position.screenY(screenH, h);
         }
      }
   }
}
