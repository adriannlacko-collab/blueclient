package com.blueclient.ui;

import com.blueclient.capes.Capes;
import com.blueclient.hud.modules.BadgeModule;
import java.util.UUID;
import net.minecraft.class_1297;
import net.minecraft.class_1657;
import net.minecraft.class_2561;
import net.minecraft.class_310;
import net.minecraft.class_640;

public final class Badges {
   private static final class_2561 GLYPH = class_2561.method_43470("\ue000").method_10862(Fonts.BADGE);

   private Badges() {
   }

   private static class_2561 glyph() {
      return GLYPH;
   }

   public static boolean on(UUID uuid) {
      if (uuid == null) {
         return false;
      } else {
         class_310 client = class_310.method_1551();
         return client.field_1724 != null && uuid.equals(client.field_1724.method_5667()) ? true : Capes.onBlueClient(uuid);
      }
   }

   private static class_2561 mark(class_2561 name, UUID uuid) {
      return (class_2561)(name != null && on(uuid) ? class_2561.method_43473().method_10852(glyph()).method_10852(name) : name);
   }

   public static class_2561 inTab(class_640 entry, class_2561 name) {
      return entry != null && BadgeModule.inTab() ? mark(name, Profiles.id(entry.method_2966())) : name;
   }

   public static class_2561 overHead(class_1297 entity, class_2561 name) {
      return entity instanceof class_1657 && BadgeModule.overHeads() ? mark(name, entity.method_5667()) : name;
   }
}
