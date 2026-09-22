package com.blueclient;

import com.blueclient.graphics.Graphics;
import com.blueclient.hud.Hud;
import com.blueclient.hud.Module;
import com.blueclient.hud.Setting;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import net.fabricmc.loader.api.FabricLoader;

public final class Config {
   private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
   private static final Map<String, Boolean> ENABLED = new HashMap<>();
   private static final Map<String, Integer> SWITCHED_ON = new HashMap<>();
   private static final List<Setting> SETTINGS = new ArrayList<>();
   private static JsonObject root = new JsonObject();
   private static boolean ready;
   private static final String[] OLD_GRAPHICS = new String[]{"lighting", "shadows", "clouds", "sky", "water", "fog", "wind", "blocks", "camera", "colour"};
   private static final String[] TABPING_KEYS = new String[]{"good", "fair", "poor"};
   private static final String[][] SMALL_ROW_FOLDS = new String[][]{
      {"smallswords", "smalltools"}, {"smallaxes", "smalltools"}, {"smallbows", "smalltools"}, {"smallthrowables", "smallother"}, {"smallfood", "smallother"}
   };
   private static int batching;
   private static boolean missed;

   private Config() {
   }

   private static Path file() {
      return FabricLoader.getInstance().getConfigDir().resolve("blueclient.json");
   }

   public static void load() {
      ENABLED.clear();
      ready = false;

      try {
         Path path = file();
         if (Files.exists(path)) {
            JsonObject parsed = (JsonObject)GSON.fromJson(Files.readString(path), JsonObject.class);
            if (parsed != null) {
               root = parsed;
            }
         }
      } catch (Exception var3) {
         BlueClient.LOGGER.warn("Could not read blueclient.json, starting from defaults", var3);
      }

      try {
         adopt();
      } catch (Exception var2) {
         BlueClient.LOGGER.warn("blueclient.json is not the shape expected, starting from defaults", var2);
         root = new JsonObject();
         ENABLED.clear();
         adopt();
      }

      ready = true;
   }

   private static void adopt() {
      Presets.adopt(root);
      forgetOldGraphicsState();
      foldDirectionIntoCoordinates();
      foldTabPingIntoPing();
      foldZoomDegreesIntoPercent();
      foldBiomeIntoCoordinates();
      foldSmallRowsIntoFive();
      JsonObject modules = block(Presets.active()).getAsJsonObject("modules");
      if (modules != null) {
         for (String key : modules.keySet()) {
            JsonElement value = modules.get(key);
            if (value != null && value.isJsonPrimitive() && value.getAsJsonPrimitive().isBoolean()) {
               ENABLED.put(key, value.getAsBoolean());
            }
         }
      }

      readSwitchedOn(block(Presets.active()));
   }

   private static void readSwitchedOn(JsonObject one) {
      SWITCHED_ON.clear();
      JsonObject order = one.getAsJsonObject("switchedOn");
      if (order != null) {
         for (String key : order.keySet()) {
            JsonElement value = order.get(key);
            if (value.isJsonPrimitive() && value.getAsJsonPrimitive().isNumber()) {
               SWITCHED_ON.put(key, value.getAsInt());
            }
         }
      }
   }

   private static void forgetOldGraphicsState() {
      JsonObject profiles = root.getAsJsonObject("profiles");
      if (profiles != null) {
         for (String profile : profiles.keySet()) {
            JsonObject one = profiles.getAsJsonObject(profile);
            if (one != null) {
               JsonObject modules = one.getAsJsonObject("modules");
               if (modules != null && !modules.has("shaders") && modules.has("lighting")) {
                  for (String id : OLD_GRAPHICS) {
                     modules.remove(id);
                  }
               }
            }
         }
      }
   }

   private static void foldDirectionIntoCoordinates() {
      JsonObject profiles = root.getAsJsonObject("profiles");
      if (profiles != null) {
         for (String profile : profiles.keySet()) {
            JsonObject one = profiles.getAsJsonObject(profile);
            if (one != null) {
               JsonObject modules = one.getAsJsonObject("modules");
               if (modules != null && modules.has("direction") && modules.get("direction").getAsBoolean()) {
                  JsonObject settings = one.getAsJsonObject("settings");
                  if (settings == null) {
                     settings = new JsonObject();
                     one.add("settings", settings);
                  }

                  if (!settings.has("coords.facing")) {
                     settings.addProperty("coords.facing", true);
                  }
               }
            }
         }
      }
   }

   private static void foldTabPingIntoPing() {
      JsonObject profiles = root.getAsJsonObject("profiles");
      if (profiles != null) {
         for (String profile : profiles.keySet()) {
            JsonObject one = profiles.getAsJsonObject(profile);
            if (one != null) {
               JsonObject modules = one.getAsJsonObject("modules");
               if (modules != null && modules.has("tabping")) {
                  JsonObject settings = one.getAsJsonObject("settings");
                  if (settings == null) {
                     settings = new JsonObject();
                     one.add("settings", settings);
                  }

                  for (String name : TABPING_KEYS) {
                     if (!settings.has("ping." + name) && settings.has("tabping." + name)) {
                        settings.add("ping." + name, settings.get("tabping." + name));
                     }
                  }

                  if (modules.get("tabping").getAsBoolean() && !settings.has("ping.tab")) {
                     settings.addProperty("ping.tab", true);
                  }
               }
            }
         }
      }
   }

   private static void foldBiomeIntoCoordinates() {
      JsonObject profiles = root.getAsJsonObject("profiles");
      if (profiles != null) {
         for (String profile : profiles.keySet()) {
            JsonObject one = profiles.getAsJsonObject(profile);
            if (one != null) {
               JsonObject modules = one.getAsJsonObject("modules");
               if (modules != null && modules.has("biome") && modules.get("biome").getAsBoolean()) {
                  JsonObject settings = one.getAsJsonObject("settings");
                  if (settings == null) {
                     settings = new JsonObject();
                     one.add("settings", settings);
                  }

                  if (!settings.has("coords.biome")) {
                     settings.addProperty("coords.biome", true);
                  }
               }
            }
         }
      }
   }

   private static void foldZoomDegreesIntoPercent() {
      JsonObject profiles = root.getAsJsonObject("profiles");
      if (profiles != null) {
         for (String profile : profiles.keySet()) {
            JsonObject one = profiles.getAsJsonObject(profile);
            if (one != null) {
               JsonObject settings = one.getAsJsonObject("settings");
               if (settings != null && !settings.has("zoom.amount") && settings.has("zoom.level") && settings.get("zoom.level").isJsonPrimitive()) {
                  int degrees = Math.max(1, settings.get("zoom.level").getAsInt());
                  int percent = Math.max(100, Math.min(1000, Math.round(7000.0F / degrees)));
                  settings.addProperty("zoom.amount", percent);
               }
            }
         }
      }
   }

   private static void foldSmallRowsIntoFive() {
      JsonObject profiles = root.getAsJsonObject("profiles");
      if (profiles != null) {
         for (String profile : profiles.keySet()) {
            JsonObject one = profiles.getAsJsonObject(profile);
            if (one != null) {
               JsonObject modules = one.getAsJsonObject("modules");
               if (modules != null) {
                  JsonObject settings = one.getAsJsonObject("settings");
                  if (settings == null) {
                     settings = new JsonObject();
                     one.add("settings", settings);
                  }

                  for (String[] fold : SMALL_ROW_FOLDS) {
                     String gone = fold[0];
                     String into = fold[1];
                     if (modules.has(gone)) {
                        boolean wasOn = modules.get(gone).getAsBoolean();
                        JsonElement goneSize = settings.get(gone + ".size");
                        modules.remove(gone);
                        settings.remove(gone + ".size");
                        if (wasOn) {
                           int size = goneSize != null && goneSize.isJsonPrimitive() ? goneSize.getAsInt() : 50;
                           JsonElement intoSize = settings.get(into + ".size");
                           boolean intoOn = modules.has(into) && modules.get(into).getAsBoolean();
                           if (intoOn && intoSize != null && intoSize.isJsonPrimitive()) {
                              size = Math.max(size, intoSize.getAsInt());
                           }

                           modules.addProperty(into, true);
                           settings.addProperty(into + ".size", size);
                        }
                     }
                  }
               }
            }
         }
      }
   }

   private static JsonObject block(String profile) {
      JsonObject profiles = root.getAsJsonObject("profiles");
      if (profiles == null) {
         profiles = new JsonObject();
         root.add("profiles", profiles);
      }

      JsonObject one = profiles.getAsJsonObject(profile);
      if (one == null) {
         one = new JsonObject();
         profiles.add(profile, one);
      }

      return one;
   }

   public static void register(Setting setting) {
      SETTINGS.add(setting);
      JsonObject settings = block(Presets.active()).getAsJsonObject("settings");
      if (settings != null) {
         setting.load(settings.get(setting.key()));
      }
   }

   static void captureInto(String profile) {
      JsonObject one = block(profile);
      List<Module> modules = Hud.modules();
      if (!modules.isEmpty()) {
         JsonObject state = new JsonObject();

         for (Module module : modules) {
            state.addProperty(module.id, module.chosen());
         }

         one.add("modules", state);
         JsonObject order = new JsonObject();

         for (Module module : modules) {
            Integer at = SWITCHED_ON.get(module.id);
            if (at != null && module.chosen() && module.position() != null) {
               order.addProperty(module.id, at);
            }
         }

         one.add("switchedOn", order);
      }

      JsonObject settings = new JsonObject();

      for (Setting setting : SETTINGS) {
         settings.add(setting.key(), setting.save());
      }

      one.add("settings", settings);
   }

   public static void resetToDefaults() {
      batch(() -> {
         ENABLED.clear();
         SWITCHED_ON.clear();
         Hud.modules().forEach(module -> module.syncEnabled());

         for (Setting setting : SETTINGS) {
            setting.reset();
         }

         captureInto(Presets.active());
         save();
      });
   }

   static void applyFrom(String profile) {
      JsonObject one = block(profile);
      ENABLED.clear();
      JsonObject modules = one.getAsJsonObject("modules");
      if (modules != null) {
         for (String key : modules.keySet()) {
            ENABLED.put(key, modules.get(key).getAsBoolean());
         }
      }

      readSwitchedOn(one);
      JsonObject settings = one.getAsJsonObject("settings");

      for (Setting setting : SETTINGS) {
         setting.load(settings == null ? null : settings.get(setting.key()));
      }

      Hud.modules().forEach(module -> module.syncEnabled());
   }

   static void forget(String profile) {
      JsonObject profiles = root.getAsJsonObject("profiles");
      if (profiles != null) {
         profiles.remove(profile);
      }
   }

   static void moveBlock(String from, String to) {
      JsonObject profiles = root.getAsJsonObject("profiles");
      if (profiles != null) {
         JsonObject one = profiles.getAsJsonObject(from);
         profiles.remove(from);
         profiles.add(to, one == null ? new JsonObject() : one);
      }
   }

   static boolean enabledIn(String profile, String id, boolean fallback) {
      JsonObject modules = block(profile).getAsJsonObject("modules");
      return modules != null && modules.has(id) ? modules.get(id).getAsBoolean() : fallback;
   }

   public static void batch(Runnable work) {
      batching++;

      try {
         work.run();
      } finally {
         batching--;
      }

      if (batching == 0 && missed) {
         missed = false;
         save();
      }
   }

   public static void save() {
      if (ready) {
         if (batching > 0) {
            missed = true;
         } else {
            try {
               captureInto(Presets.active());
               root.addProperty("activeProfile", Presets.active());
               Disk.write(file(), GSON.toJson(root));
            } catch (Exception var1) {
               BlueClient.LOGGER.warn("Could not write blueclient.json", var1);
            }

            Graphics.settingsChanged();
         }
      }
   }

   public static String cape() {
      JsonElement cape = root.get("cape");
      return cape != null && cape.isJsonPrimitive() ? cape.getAsString() : "";
   }

   public static String clipsFolder() {
      JsonElement folder = root.get("clipsFolder");
      return folder != null && folder.isJsonPrimitive() ? folder.getAsString() : "";
   }

   public static Path launcherPath(String key) {
      JsonElement value = root.get(key);
      if (value != null && value.isJsonPrimitive()) {
         String text = value.getAsString();
         if (text != null && !text.isBlank()) {
            try {
               return Path.of(text);
            } catch (Exception var4) {
               return null;
            }
         } else {
            return null;
         }
      } else {
         return null;
      }
   }

   public static String launcherText(String key) {
      JsonElement value = root.get(key);
      return value != null && value.isJsonPrimitive() ? value.getAsString() : "";
   }

   public static boolean flag(String key) {
      JsonElement value = root.get(key);
      return value != null && value.isJsonPrimitive() && value.getAsBoolean();
   }

   public static void setFlag(String key, boolean value) {
      root.addProperty(key, value);
      save();
   }

   public static boolean enabled(String id, boolean fallback) {
      return ENABLED.getOrDefault(id, fallback);
   }

   public static void setEnabled(String id, boolean value) {
      ENABLED.put(id, value);
      if (value) {
         int last = 0;

         for (int at : SWITCHED_ON.values()) {
            last = Math.max(last, at);
         }

         SWITCHED_ON.put(id, last + 1);
      } else {
         SWITCHED_ON.remove(id);
      }

      save();
   }

   public static int switchedOn(String id) {
      return SWITCHED_ON.getOrDefault(id, 0);
   }

   public static void forgetSwitchedOn() {
      SWITCHED_ON.clear();
   }
}
