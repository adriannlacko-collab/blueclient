package com.blueclient.hud.modules;

import com.blueclient.hud.BehaviourModule;
import com.blueclient.hud.Category;
import com.blueclient.hud.Setting;
import com.blueclient.ui.Icon;
import java.util.Random;
import java.util.concurrent.ThreadLocalRandom;
import java.util.function.Supplier;
import net.minecraft.class_2338;
import net.minecraft.class_2394;
import net.minecraft.class_2398;
import net.minecraft.class_243;
import net.minecraft.class_2680;
import net.minecraft.class_310;
import net.minecraft.class_638;
import net.minecraft.class_2338.class_2339;

public class ParticlesModule extends BehaviourModule {
   private static ParticlesModule active;
   public static final int CRIT = 1;
   public static final int SHARPNESS = 2;
   public static final int EXPLOSION = 3;
   private static final String[] NAMES = new String[]{
      "Game's own", "White", "Red", "Orange", "Yellow", "Lime", "Green", "Cyan", "Light blue", "Blue", "Purple", "Magenta", "Pink"
   };
   private static final int[] COLOURS = new int[]{
      0, 16383998, 11546150, 16351261, 16701501, 8439583, 6192150, 1481884, 3847130, 3949738, 8991416, 13061821, 15961002
   };
   private final Setting.Range amount = this.add(new Setting.Range("amount", "Hit particles", 0, 400, 100, "%"));
   private final Setting.Choice crit = this.add(new Setting.Choice("crit", "Crit colour", 0, NAMES));
   private final Setting.Choice sharpness = this.add(new Setting.Choice("sharpness", "Sharpness colour", 0, NAMES));
   private final Setting.Range explosion = this.add(new Setting.Range("explosion", "Explosion particles", 0, 400, 100, "%"));
   private final Setting.Bool breaks = this.add(new Setting.Bool("break", "Break particles", true));
   private final Setting.Bool place = this.add(new Setting.Bool("place", "Place particles", false));
   private final Setting.Range others = this.add(new Setting.Range("others", "Other particles", 0, 400, 100, "%"));
   private static boolean placing;
   private static boolean emitting;
   private static int naming;
   private static boolean copying;
   private static final int EVERY = 24;
   private static final int BURST = 3;
   private static final int BLAST_EVERY = 48;
   private static final int BLAST_AT = 12;
   private static final int DUST_AT = 36;
   private final Random random = new Random();
   private int clock;

   public ParticlesModule() {
      super(
         "particles",
         "Custom particles",
         "Hit sparks, explosion smoke, block dust and the rest: how much, and what colour. Off is the game's own",
         Category.VISUAL,
         Icon.ATOM,
         false
      );
      active = this;
   }

   private static boolean governs() {
      return active != null && (active.isEnabled() || active.isPageOpen());
   }

   public static int kind(class_2394 effect) {
      if (effect == class_2398.field_11205) {
         return 1;
      } else if (effect == class_2398.field_11208) {
         return 2;
      } else {
         return effect != class_2398.field_11236 && effect != class_2398.field_11221 ? 0 : 3;
      }
   }

   private static int share(int vanilla, Setting.Range share) {
      int percent = share.get();
      if (percent == 100) {
         return vanilla;
      } else if (percent == 0) {
         return 0;
      } else {
         float exact = vanilla * percent / 100.0F;
         int whole = (int)exact;
         return whole + (ThreadLocalRandom.current().nextFloat() < exact - whole ? 1 : 0);
      }
   }

   public static int count(class_2394 effect, int vanilla) {
      int kind = kind(effect);
      return governs() && kind != 0 ? share(vanilla, kind == 3 ? active.explosion : active.amount) : vanilla;
   }

   public static void emitting(boolean on) {
      emitting = on;
   }

   public static int copies(class_2394 effect) {
      if (governs() && !copying) {
         int kind = kind(effect);
         if (kind == 3) {
            return !emitting && effect != class_2398.field_11221 ? Math.min(1, share(1, active.explosion)) : 1;
         } else {
            return kind != 0 ? 1 : share(1, active.others);
         }
      } else {
         return 1;
      }
   }

   public static boolean keeps() {
      return governs() && naming <= 0 && !copying ? share(1, active.others) > 0 : true;
   }

   public static <T> T named(Supplier<T> make) {
      naming++;

      Object var1;
      try {
         var1 = make.get();
      } finally {
         naming--;
      }

      return (T)var1;
   }

   public static void naming(boolean inside) {
      if (inside) {
         naming++;
      } else {
         naming--;
      }
   }

   public static int again() {
      return governs() && !copying ? Math.max(0, share(1, active.others) - 1) : 0;
   }

   public static void copy(Runnable repeat) {
      copying = true;

      try {
         repeat.run();
      } finally {
         copying = false;
      }
   }

   public static int colour(int kind) {
      if (!governs()) {
         return 0;
      } else {
         Setting.Choice choice = kind == 1 ? active.crit : (kind == 2 ? active.sharpness : null);
         if (choice == null) {
            return 0;
         } else {
            int index = choice.index();
            return index >= 0 && index < COLOURS.length ? COLOURS[index] : 0;
         }
      }
   }

   public static boolean hidesBreak() {
      return !placing && governs() && !active.breaks.get();
   }

   public static void placed(class_638 world, class_2338 pos, class_2680 state) {
      if (governs() && active.place.get()) {
         burst(world, pos, state);
      }
   }

   private static void burst(class_638 world, class_2338 pos, class_2680 state) {
      placing = true;

      try {
         world.method_31595(pos, state);
      } finally {
         placing = false;
      }
   }

   @Override
   public boolean previewsInWorld() {
      return true;
   }

   @Override
   public void tick(class_310 client) {
      if (this.isPageOpen() && client.field_1687 != null && client.field_1724 != null) {
         int tick = this.clock++;
         class_243 eye = client.field_1724.method_33571();
         class_243 look = class_243.method_1030(0.0F, client.field_1724.method_36454());
         if (tick % 48 == 12) {
            class_243 at = eye.method_1019(look.method_1021(12.0)).method_1031(0.0, 1.0, 0.0);
            client.field_1713.method_3056(class_2398.field_11221, at.field_1352, at.field_1351, at.field_1350, 1.0, 0.0, 0.0);
         }

         class_243 right = new class_243(-look.field_1350, 0.0, look.field_1352);
         if (tick % 48 == 36) {
            class_2338 ground = groundAhead(client, eye.method_1019(look.method_1021(3.0)).method_1020(right.method_1021(1.5)));
            if (ground != null) {
               client.field_1687.method_31595(ground, client.field_1687.method_8320(ground));
            }
         }

         if (tick % 24 < 3) {
            class_243 centre = eye.method_1019(look.method_1021(3.0)).method_1023(0.0, 0.4, 0.0);
            this.burst(client, class_2398.field_11205, centre.method_1020(right.method_1021(0.9)));
            this.burst(client, class_2398.field_11208, centre.method_1019(right.method_1021(0.9)));
         }
      } else {
         this.clock = 0;
      }
   }

   private static class_2338 groundAhead(class_310 client, class_243 under) {
      class_2339 pos = class_2338.method_49638(under).method_25503();
      int i = 0;

      while (i < 6) {
         class_2680 state = client.field_1687.method_8320(pos);
         if (state.method_26212(client.field_1687, pos)) {
            return pos.method_10062();
         }

         i++;
         pos.method_10100(0, -1, 0);
      }

      return null;
   }

   private void burst(class_310 client, class_2394 effect, class_243 at) {
      int tries = count(effect, 16);

      for (int i = 0; i < tries; i++) {
         double d = this.random.nextFloat() * 2.0F - 1.0F;
         double e = this.random.nextFloat() * 2.0F - 1.0F;
         double f = this.random.nextFloat() * 2.0F - 1.0F;
         if (!(d * d + e * e + f * f > 1.0)) {
            client.field_1713.method_3056(effect, at.field_1352 + d * 0.3, at.field_1351 + e * 0.4, at.field_1350 + f * 0.3, d, e + 0.2, f);
         }
      }
   }

   public interface Tinted {
      void blueclient$tint(int var1);
   }
}
