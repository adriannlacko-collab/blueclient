package com.blueclient.capes;

import com.blueclient.BlueClient;
import com.blueclient.ui.Pixels;
import com.mojang.blaze3d.platform.NativeImage;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Map.Entry;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.texture.DynamicTexture;
import net.minecraft.resources.Identifier;
import net.minecraft.server.packs.resources.Resource;

public final class CapeFrames {
   public static final int FRAMES = 30;
   public static final int FRAME_MS = 200;
   private static final int W = 384;
   private static final int H = 192;
   private static final int CAPE_W = 132;
   private static final int CAPE_H = 102;
   private static final int FACE_X = 6;
   private static final int FACE_Y = 6;
   private static final int FACE_W = 60;
   private static final int FACE_H = 96;
   private static final int STARS_X = 282;
   private static final Map<String, Identifier[]> SHIPPED = new ConcurrentHashMap<>();
   private static final int KEEP = 8;
   private static final Map<String, CapeFrames.Cooked> cooked = new LinkedHashMap<>(16, 0.75F, true);
   private static final ExecutorService KITCHEN = Executors.newSingleThreadExecutor(r -> {
      Thread thread = new Thread(r, "blueclient-capes");
      thread.setDaemon(true);
      return thread;
   });
   private static Capes.Colours wordOf;
   private static String word;

   private CapeFrames() {
   }

   public static int now() {
      return (int)(System.currentTimeMillis() / 200L % 30L);
   }

   public static Identifier shipped(String id, int n) {
      Identifier[] ids = SHIPPED.get(id);
      if (ids == null) {
         ids = new Identifier[30];
         SHIPPED.put(id, ids);
      }

      Identifier at = ids[n];
      if (at == null) {
         at = Identifier.fromNamespaceAndPath("blueclient", "textures/capes/" + id + "/" + (n < 10 ? "0" + n : String.valueOf(n)) + ".png");
         ids[n] = at;
      }

      return at;
   }

   public static Identifier cooked(Capes.Colours colours) {
      String key;
      if (colours == wordOf) {
         key = word;
      } else {
         key = colours.word();
         wordOf = colours;
         word = key;
      }

      List<CapeFrames.Cooked> gone = null;
      CapeFrames.Cooked set;
      synchronized (cooked) {
         set = cooked.get(key);
         if (set == null) {
            set = new CapeFrames.Cooked();
            cooked.put(key, set);

            while (cooked.size() > 8) {
               Iterator<Entry<String, CapeFrames.Cooked>> oldest = cooked.entrySet().iterator();
               CapeFrames.Cooked old = oldest.next().getValue();
               oldest.remove();
               old.dropped = true;
               if (gone == null) {
                  gone = new ArrayList<>();
               }

               gone.add(old);
            }

            cook(key, colours, set);
         }
      }

      if (gone != null) {
         for (CapeFrames.Cooked old : gone) {
            forget(old);
         }
      }

      return set.ready ? set.ids[now()] : null;
   }

   private static void cook(String key, Capes.Colours colours, CapeFrames.Cooked set) {
      KITCHEN.execute(() -> {
         int[][] frames = new int[30][];

         try {
            int[] letter = pixels(Identifier.fromNamespaceAndPath("blueclient", "textures/capes/yours/b.png"));

            for (int n = 0; n < 30; n++) {
               frames[n] = cookFrame(pixels(shipped("yours", n)), letter, colours);
            }
         } catch (Exception var6) {
            BlueClient.LOGGER.warn("Capes: could not cook {}: {}", key, var6.toString());
            return;
         }

         Minecraft client = Minecraft.getInstance();
         client.execute(() -> upload(client, key, set, frames, 0));
      });
   }

   private static void upload(Minecraft client, String key, CapeFrames.Cooked set, int[][] frames, int n) {
      if (set.dropped) {
         forget(set);
      } else {
         DynamicTexture texture = Pixels.texture("blueclient cape " + key + " " + n, 384, 192);
         NativeImage image = texture.getPixels();
         int[] pixels = frames[n];

         for (int y = 0; y < 192; y++) {
            for (int x = 0; x < 384; x++) {
               Pixels.set(image, x, y, pixels[y * 384 + x]);
            }
         }

         texture.upload();
         Identifier id = Identifier.fromNamespaceAndPath("blueclient", "capes/yours/" + key.substring("yours:".length()) + "/" + n);
         client.getTextureManager().register(id, texture);
         set.ids[n] = id;
         if (n + 1 < 30) {
            client.execute(() -> upload(client, key, set, frames, n + 1));
         } else {
            set.ready = true;
         }
      }
   }

   private static void forget(CapeFrames.Cooked set) {
      Minecraft client = Minecraft.getInstance();
      client.execute(() -> {
         for (int n = 0; n < 30; n++) {
            if (set.ids[n] != null) {
               client.getTextureManager().release(set.ids[n]);
            }

            set.ids[n] = null;
         }
      });
   }

   private static int[] pixels(Identifier id) throws Exception {
      Resource resource = Minecraft.getInstance().getResourceManager().getResourceOrThrow(id);

      int[] var11;
      try (InputStream in = resource.open()) {
         NativeImage image = NativeImage.read(in);

         try {
            if (image.getWidth() != 384 || image.getHeight() != 192) {
               throw new IllegalStateException(id + " is " + image.getWidth() + "x" + image.getHeight());
            }

            int[] out = new int[73728];

            for (int y = 0; y < 192; y++) {
               for (int x = 0; x < 384; x++) {
                  out[y * 384 + x] = Pixels.get(image, x, y);
               }
            }

            var11 = out;
         } catch (Throwable var9) {
            if (image != null) {
               try {
                  image.close();
               } catch (Throwable var8) {
                  var9.addSuppressed(var8);
               }
            }

            throw var9;
         }

         if (image != null) {
            image.close();
         }
      }

      return var11;
   }

   private static int[] cookFrame(int[] recipe, int[] letter, Capes.Colours colours) {
      float[] top = rgb(colours.top());
      float[] bottom = rgb(colours.bottom());
      float[] spark = rgb(colours.spark());
      int[] out = new int[73728];

      for (int y = 0; y < 192; y++) {
         for (int x = 0; x < 384; x++) {
            int i = y * 384 + x;
            if (x < 132 && y < 102) {
               boolean face = x >= 6 && x < 66 && y >= 6 && y < 102;
               int star = face ? recipe[y * 384 + x - 6 + 282] >> 16 & 0xFF : 0;
               int b = face && colours.letter() ? letter[i] : 0;
               out[i] = cook(recipe[i], star, b, top, bottom, spark);
            }
         }
      }

      return out;
   }

   static int cook(int recipe, int star, int letter, float[] top, float[] bottom, float[] spark) {
      float t = (recipe >> 16 & 0xFF) / 255.0F;
      float shade = (recipe >> 8 & 0xFF) / 200.0F;
      float light = (recipe & 0xFF) / 255.0F;
      float s = star / 255.0F;
      float shadow = (letter >> 16 & 0xFF) / 255.0F;
      float lit = (letter >> 8 & 0xFF) / 255.0F;
      float main = (letter & 0xFF) / 255.0F;
      int r = channel(top[0], bottom[0], spark[0], t, shade, light, s, shadow, lit, main);
      int g = channel(top[1], bottom[1], spark[1], t, shade, light, s, shadow, lit, main);
      int b = channel(top[2], bottom[2], spark[2], t, shade, light, s, shadow, lit, main);
      return 0xFF000000 | r << 16 | g << 8 | b;
   }

   private static int channel(float a, float b, float sp, float t, float shade, float light, float s, float shadow, float lit, float main) {
      float v = (a + (b - a) * t) * shade;
      v += (1.0F - v) * light;
      v = 1.0F - (1.0F - v) * (1.0F - sp * s);
      v *= 1.0F - 0.28F * shadow;
      v += (1.0F - v) * 0.16F * lit;
      v += (1.0F - v) * 0.1F * main;
      return Math.max(0, Math.min(255, Math.round(v * 255.0F)));
   }

   private static float[] rgb(int colour) {
      return new float[]{(colour >> 16 & 0xFF) / 255.0F, (colour >> 8 & 0xFF) / 255.0F, (colour & 0xFF) / 255.0F};
   }

   private static final class Cooked {
      final Identifier[] ids = new Identifier[30];
      volatile boolean ready;
      volatile boolean dropped;
   }
}
