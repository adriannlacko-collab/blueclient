package com.blueclient;

import com.blueclient.hud.Hud;
import com.blueclient.hud.Module;
import com.google.gson.JsonObject;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public final class Presets {
   private static final String DEFAULT = "Default";
   public static final int MAX_NAME = 24;
   private static final List<String> NAMES = new ArrayList<>();
   private static String active = "Default";

   private Presets() {
   }

   public static List<String> names() {
      return NAMES;
   }

   public static String active() {
      return active;
   }

   public static boolean isActive(String name) {
      return active.equals(name);
   }

   static void adopt(JsonObject root) {
      NAMES.clear();
      JsonObject stored = root.getAsJsonObject("profiles");
      if (stored != null) {
         for (String name : stored.keySet()) {
            NAMES.add(name);
         }
      }

      if (NAMES.isEmpty()) {
         NAMES.add("Default");
      }

      String wanted = root.has("activeProfile") ? root.get("activeProfile").getAsString() : "Default";
      active = NAMES.contains(wanted) ? wanted : NAMES.get(0);
   }

   public static void switchTo(String name) {
      if (NAMES.contains(name) && !name.equals(active)) {
         Config.captureInto(active);
         active = name;
         Config.applyFrom(name);
         Config.save();
      }
   }

   public static String createFromCurrent() {
      String name = unique("New Preset", null);
      Config.captureInto(active);
      NAMES.add(name);
      active = name;
      Config.captureInto(name);
      Config.save();
      return name;
   }

   public static String rename(String from, String to) {
      if (!NAMES.contains(from)) {
         return from;
      } else {
         String wanted = to == null ? "" : to.trim();
         if (wanted.length() > 24) {
            wanted = wanted.substring(0, 24).trim();
         }

         if (!wanted.isEmpty() && !wanted.equals(from)) {
            String name = unique(wanted, from);
            if (from.equals(active)) {
               Config.captureInto(from);
            }

            NAMES.set(NAMES.indexOf(from), name);
            Config.moveBlock(from, name);
            if (from.equals(active)) {
               active = name;
            }

            Config.save();
            return name;
         } else {
            return from;
         }
      }
   }

   public static void delete(String name) {
      if (NAMES.size() > 1 && NAMES.contains(name)) {
         NAMES.remove(name);
         Config.forget(name);
         if (active.equals(name)) {
            active = NAMES.get(0);
            Config.applyFrom(active);
         }

         Config.save();
      }
   }

   public static int enabledCount(String name) {
      boolean live = name.equals(active);
      int on = 0;

      for (Module module : Hud.modules()) {
         if (module.listedInMenus()) {
            boolean enabled = live ? module.isEnabled() : Config.enabledIn(name, module.id, module.defaultOn());
            if (enabled) {
               on++;
            }
         }
      }

      return on;
   }

   private static String unique(String base, String ignoring) {
      String name = base;

      for (int i = 2; taken(name, ignoring); i++) {
         String suffix = " " + i;
         String head = base.length() + suffix.length() > 24 ? base.substring(0, 24 - suffix.length()).trim() : base;
         name = head + suffix;
      }

      return name;
   }

   private static boolean taken(String name, String ignoring) {
      for (String existing : NAMES) {
         if (!existing.equals(ignoring) && existing.toLowerCase(Locale.ROOT).equals(name.toLowerCase(Locale.ROOT))) {
            return true;
         }
      }

      return false;
   }
}
