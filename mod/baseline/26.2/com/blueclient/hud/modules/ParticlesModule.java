package com.blueclient.hud.modules;

import com.blueclient.hud.BehaviourModule;
import com.blueclient.hud.Category;
import com.blueclient.hud.Setting;
import com.blueclient.ui.Icon;
import java.util.Random;
import java.util.concurrent.ThreadLocalRandom;
import java.util.function.Supplier;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.core.BlockPos;
import net.minecraft.core.BlockPos.MutableBlockPos;
import net.minecraft.core.particles.ParticleOptions;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.Vec3;

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

   public static int kind(ParticleOptions effect) {
      if (effect == ParticleTypes.CRIT) {
         return 1;
      } else if (effect == ParticleTypes.ENCHANTED_HIT) {
         return 2;
      } else {
         return effect != ParticleTypes.EXPLOSION && effect != ParticleTypes.EXPLOSION_EMITTER ? 0 : 3;
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

   public static int count(ParticleOptions effect, int vanilla) {
      int kind = kind(effect);
      return governs() && kind != 0 ? share(vanilla, kind == 3 ? active.explosion : active.amount) : vanilla;
   }

   public static void emitting(boolean on) {
      emitting = on;
   }

   public static int copies(ParticleOptions effect) {
      if (governs() && !copying) {
         int kind = kind(effect);
         if (kind == 3) {
            return !emitting && effect != ParticleTypes.EXPLOSION_EMITTER ? Math.min(1, share(1, active.explosion)) : 1;
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

   public static void placed(ClientLevel world, BlockPos pos, BlockState state) {
      if (governs() && active.place.get()) {
         burst(world, pos, state);
      }
   }

   private static void burst(ClientLevel world, BlockPos pos, BlockState state) {
      placing = true;

      try {
         world.addDestroyBlockEffect(pos, state);
      } finally {
         placing = false;
      }
   }

   @Override
   public boolean previewsInWorld() {
      return true;
   }

   @Override
   public void tick(Minecraft client) {
      if (this.isPageOpen() && client.level != null && client.player != null) {
         int tick = this.clock++;
         Vec3 eye = client.player.getEyePosition();
         Vec3 look = Vec3.directionFromRotation(0.0F, client.player.getYRot());
         if (tick % 48 == 12) {
            Vec3 at = eye.add(look.scale(12.0)).add(0.0, 1.0, 0.0);
            client.particleEngine.createParticle(ParticleTypes.EXPLOSION_EMITTER, at.x, at.y, at.z, 1.0, 0.0, 0.0);
         }

         Vec3 right = new Vec3(-look.z, 0.0, look.x);
         if (tick % 48 == 36) {
            BlockPos ground = groundAhead(client, eye.add(look.scale(3.0)).subtract(right.scale(1.5)));
            if (ground != null) {
               client.level.addDestroyBlockEffect(ground, client.level.getBlockState(ground));
            }
         }

         if (tick % 24 < 3) {
            Vec3 centre = eye.add(look.scale(3.0)).subtract(0.0, 0.4, 0.0);
            this.burst(client, ParticleTypes.CRIT, centre.subtract(right.scale(0.9)));
            this.burst(client, ParticleTypes.ENCHANTED_HIT, centre.add(right.scale(0.9)));
         }
      } else {
         this.clock = 0;
      }
   }

   private static BlockPos groundAhead(Minecraft client, Vec3 under) {
      MutableBlockPos pos = BlockPos.containing(under).mutable();
      int i = 0;

      while (i < 6) {
         BlockState state = client.level.getBlockState(pos);
         if (state.isRedstoneConductor(client.level, pos)) {
            return pos.immutable();
         }

         i++;
         pos.move(0, -1, 0);
      }

      return null;
   }

   private void burst(Minecraft client, ParticleOptions effect, Vec3 at) {
      int tries = count(effect, 16);

      for (int i = 0; i < tries; i++) {
         double d = this.random.nextFloat() * 2.0F - 1.0F;
         double e = this.random.nextFloat() * 2.0F - 1.0F;
         double f = this.random.nextFloat() * 2.0F - 1.0F;
         if (!(d * d + e * e + f * f > 1.0)) {
            client.particleEngine.createParticle(effect, at.x + d * 0.3, at.y + e * 0.4, at.z + f * 0.3, d, e + 0.2, f);
         }
      }
   }

   public interface Tinted {
      void blueclient$tint(int var1);
   }
}
