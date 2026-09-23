package com.blueclient.skins;

import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents.Disconnect;
import com.blueclient.BlueClient;
import com.blueclient.Config;
import com.blueclient.ui.Pixels;
import com.blueclient.ui.Profiles;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpResponse.BodyHandlers;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.class_1011;
import net.minecraft.class_1043;
import net.minecraft.class_2960;
import net.minecraft.class_310;
import net.minecraft.class_634;
import net.minecraft.class_640;

public final class OwnSkins {
   private static final String INDEX = "https://blueclient-skins.blueclient-relay.workers.dev";
   private static final Duration TIMEOUT = Duration.ofSeconds(10L);
   private static final long KEEP_MS = 600000L;
   private static final int ASK_AT_MOST = 40;
   private static final int MAX_BYTES = 24576;
   private static final Map<UUID, OwnSkins.Answer> known = new ConcurrentHashMap<>();
   private static final Map<String, class_2960> textures = new ConcurrentHashMap<>();
   private static final Map<class_2960, OwnSkins.Skin> WIDE = new ConcurrentHashMap<>();
   private static final Map<class_2960, OwnSkins.Skin> SLIM = new ConcurrentHashMap<>();
   private static final Set<String> loading = ConcurrentHashMap.newKeySet();
   private static final ExecutorService WORK = Executors.newSingleThreadExecutor(task -> {
      Thread thread = new Thread(task, "BlueClient own skins");
      thread.setDaemon(true);
      return thread;
   });
   private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(TIMEOUT).build();
   private static volatile OwnSkins.Skin mine;
   private static volatile boolean mineRead;

   private OwnSkins() {
   }

   static {
      ClientPlayConnectionEvents.DISCONNECT.register((Disconnect)(handler, client) -> client.execute(OwnSkins::forget));
   }

   /**
    * One Skin per texture: {@link #forPlayer} is asked for every player the
    * game draws and every row of the player list, every frame, and used to
    * make a new record each time.
    */
   private static OwnSkins.Skin skin(class_2960 texture, boolean slim) {
      Map<class_2960, OwnSkins.Skin> table = slim ? SLIM : WIDE;
      OwnSkins.Skin kept = table.get(texture);
      if (kept == null) {
         kept = new OwnSkins.Skin(texture, slim);
         table.put(texture, kept);
      }

      return kept;
   }

   /**
    * Leaving a server lets go of the other players' skin textures, which were
    * registered with the texture manager and never released: every distinct
    * skin seen stayed on the GPU for the whole session. The answers go too, so
    * the next server's players are asked about afresh (their files are kept
    * on disk, so nothing is downloaded twice). Your own skin stays.
    */
   private static void forget() {
      class_310 client = class_310.method_1551();
      for (class_2960 id : textures.values()) {
         client.method_1531().method_4615(id);
      }

      textures.clear();
      WIDE.clear();
      SLIM.clear();
      known.clear();
   }

   private static OwnSkins.Skin mine() {
      if (mineRead) {
         return mine;
      } else {
         mineRead = true;
         Path file = Config.launcherPath("ownSkin");
         if (file == null) {
            return null;
         } else {
            boolean slim = "slim".equals(Config.launcherText("ownSkinModel"));
            WORK.execute(() -> {
               try {
                  byte[] bytes = Files.readAllBytes(file);
                  register("mine", bytes, slim, skin -> mine = skin);
               } catch (IOException var3) {
                  BlueClient.LOGGER.warn("Own skin: could not read {}", file, var3);
               }
            });
            return null;
         }
      }
   }

   public static OwnSkins.Skin forPlayer(UUID uuid) {
      if (uuid == null) {
         return null;
      } else {
         class_310 client = class_310.method_1551();
         if (client.field_1724 != null && uuid.equals(client.field_1724.method_5667())) {
            return mine();
         } else {
            OwnSkins.Answer answer = known.get(uuid);
            if (answer != null && answer.hash != null) {
               class_2960 texture = textures.get(answer.hash);
               return texture == null ? null : skin(texture, answer.slim);
            } else {
               return null;
            }
         }
      }
   }

   public static List<UUID> toAsk(class_310 client) {
      List<UUID> out = new ArrayList<>();
      class_634 handler = client.method_1562();
      if (handler != null && client.field_1724 != null) {
         long now = System.currentTimeMillis();
         UUID me = client.field_1724.method_5667();

         for (class_640 entry : handler.method_2880()) {
            UUID id = Profiles.id(entry.method_2966());
            if (id != null && !id.equals(me)) {
               OwnSkins.Answer answer = known.get(id);
               if (answer == null || now - answer.at >= 600000L) {
                  out.add(id);
                  if (out.size() >= 40) {
                     break;
                  }
               }
            }
         }

         return out;
      } else {
         return out;
      }
   }

   public static void ask(List<UUID> uuids) {
      if (!uuids.isEmpty()) {
         WORK.execute(
            () -> {
               StringBuilder ids = new StringBuilder();

               for (UUID id : uuids) {
                  if (ids.length() > 0) {
                     ids.append(',');
                  }

                  ids.append(id);
               }

               JsonObject skins = null;

               try {
                  HttpResponse<String> response = HTTP.send(
                     HttpRequest.newBuilder(URI.create("https://blueclient-skins.blueclient-relay.workers.dev/own?ids=" + ids))
                        .timeout(TIMEOUT)
                        .header("User-Agent", userAgent())
                        .GET()
                        .build(),
                     BodyHandlers.ofString()
                  );
                  if (response.statusCode() == 200) {
                     JsonElement body = JsonParser.parseString(response.body());
                     if (body.isJsonObject() && body.getAsJsonObject().get("skins") instanceof JsonObject found) {
                        skins = found;
                     }
                  }
               } catch (Exception var11) {
                  return;
               }

               long now = System.currentTimeMillis();

               for (UUID id : uuids) {
                  String hash = null;
                  boolean slim = false;
                  JsonElement value = skins == null ? null : skins.get(id.toString());
                  if (value != null && value.isJsonObject()) {
                     JsonObject entry = value.getAsJsonObject();
                     hash = entry.has("v") && entry.get("v").isJsonPrimitive() ? entry.get("v").getAsString() : null;
                     slim = entry.has("m") && "slim".equals(entry.get("m").getAsString());
                     if (hash != null && !hash.matches("[0-9a-f]{8,64}")) {
                        hash = null;
                     }
                  }

                  known.put(id, new OwnSkins.Answer(hash, slim, now));
                  if (hash != null && !textures.containsKey(hash) && loading.add(hash)) {
                     fetch(id, hash, slim);
                  }
               }
            }
         );
      }
   }

   private static void fetch(UUID uuid, String hash, boolean slim) {
      Path kept = folder().resolve(uuid + "-" + hash + ".png");
      byte[] bytes = null;

      try {
         if (Files.isRegularFile(kept)) {
            bytes = Files.readAllBytes(kept);
         }
      } catch (IOException var9) {
         bytes = null;
      }

      if (bytes == null) {
         try {
            HttpResponse<byte[]> response = HTTP.send(
               HttpRequest.newBuilder(URI.create("https://blueclient-skins.blueclient-relay.workers.dev/own/" + uuid + "?v=" + hash))
                  .timeout(TIMEOUT)
                  .header("User-Agent", userAgent())
                  .GET()
                  .build(),
               BodyHandlers.ofByteArray()
            );
            if (response.statusCode() == 200 && response.body().length > 0 && response.body().length <= 24576) {
               bytes = response.body();

               try {
                  Files.createDirectories(kept.getParent());
                  Files.write(kept, bytes);
               } catch (IOException var7) {
               }
            }
         } catch (Exception var8) {
            bytes = null;
         }
      }

      if (bytes == null) {
         loading.remove(hash);
      } else {
         register(hash, bytes, slim, skin -> textures.put(hash, skin.texture()));
      }
   }

   private static void register(String key, byte[] bytes, boolean slim, Consumer<OwnSkins.Skin> done) {
      int[] pixels;
      try {
         class_1011 image = class_1011.method_4309(new ByteArrayInputStream(bytes));

         label72: {
            try {
               int w = image.method_4307();
               int h = image.method_4323();
               if (w == 64 && (h == 64 || h == 32)) {
                  pixels = new int[4096];

                  for (int y = 0; y < h; y++) {
                     for (int x = 0; x < w; x++) {
                        pixels[y * 64 + x] = Pixels.get(image, x, y);
                     }
                  }

                  if (h == 32) {
                     legacy(pixels);
                  }
                  break label72;
               }

               BlueClient.LOGGER.warn("Own skin {}: {}x{} is not a skin sheet", new Object[]{key, w, h});
               loading.remove(key);
            } catch (Throwable var11) {
               if (image != null) {
                  try {
                     image.close();
                  } catch (Throwable var10) {
                     var11.addSuppressed(var10);
                  }
               }

               throw var11;
            }

            if (image != null) {
               image.close();
            }

            return;
         }

         if (image != null) {
            image.close();
         }
      } catch (IOException var12) {
         BlueClient.LOGGER.warn("Own skin {}: not a PNG", key);
         loading.remove(key);
         return;
      }

      class_310 client = class_310.method_1551();
      client.execute(() -> {
         class_1043 texture = Pixels.texture("blueclient own skin " + key, 64, 64);
         class_1011 image = texture.method_4525();

         for (int yx = 0; yx < 64; yx++) {
            for (int xx = 0; xx < 64; xx++) {
               Pixels.set(image, xx, yx, pixels[yx * 64 + xx]);
            }
         }

         texture.method_4524();
         class_2960 id = class_2960.method_43902("blueclient", "skins/own/" + key.toLowerCase(Locale.ROOT));
         client.method_1531().method_4616(id, texture);
         done.accept(new OwnSkins.Skin(id, slim));
         loading.remove(key);
      });
   }

   private static void legacy(int[] p) {
      copy(p, 4, 16, 16, 32, 4, 4);
      copy(p, 8, 16, 16, 32, 4, 4);
      copy(p, 0, 20, 24, 32, 4, 12);
      copy(p, 4, 20, 16, 32, 4, 12);
      copy(p, 8, 20, 8, 32, 4, 12);
      copy(p, 12, 20, 16, 32, 4, 12);
      copy(p, 44, 16, -8, 32, 4, 4);
      copy(p, 48, 16, -8, 32, 4, 4);
      copy(p, 40, 20, 0, 32, 4, 12);
      copy(p, 44, 20, -8, 32, 4, 12);
      copy(p, 48, 20, -16, 32, 4, 12);
      copy(p, 52, 20, -8, 32, 4, 12);
   }

   private static void copy(int[] p, int x, int y, int dx, int dy, int w, int h) {
      for (int j = 0; j < h; j++) {
         for (int i = 0; i < w; i++) {
            p[(y + dy + j) * 64 + x + dx + (w - 1 - i)] = p[(y + j) * 64 + x + i];
         }
      }
   }

   private static Path folder() {
      return FabricLoader.getInstance().getGameDir().resolve("blueclient").resolve("skins");
   }

   private static String userAgent() {
      String version = FabricLoader.getInstance()
         .getModContainer("blueclient")
         .map(container -> container.getMetadata().getVersion().getFriendlyString())
         .orElse("dev");
      return "BlueClient/" + version + " (blueclient.net)";
   }

   private record Answer(String hash, boolean slim, long at) {
   }

   public record Skin(class_2960 texture, boolean slim) {
   }
}
