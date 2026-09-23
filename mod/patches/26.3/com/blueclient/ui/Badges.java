package com.blueclient.ui;

import java.util.Map;
import java.util.HashMap;
import com.blueclient.capes.Capes;
import com.blueclient.hud.modules.BadgeModule;
import java.util.UUID;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.PlayerInfo;
import net.minecraft.network.chat.Component;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;

public final class Badges {
   private static final Map<UUID, Component[]> BADGED = new HashMap<>();
   private static final Component GLYPH = Component.literal("\ue000").setStyle(Fonts.BADGE);

   private Badges() {
   }

   private static Component glyph() {
      return GLYPH;
   }

   public static boolean on(UUID uuid) {
      if (uuid == null) {
         return false;
      } else {
         Minecraft client = Minecraft.getInstance();
         return client.player != null && uuid.equals(client.player.getUUID()) ? true : Capes.onBlueClient(uuid);
      }
   }

   private static Component mark(Component name, UUID uuid) {
      if (name != null && on(uuid)) {
         // One badged name kept per player: it used to be built again (three
         // objects and a list) for every BlueClient player on screen, every
         // frame, and for every row of the player list while it is open.
         Component[] kept = BADGED.get(uuid);
         if (kept != null && (kept[0] == name || kept[0].equals(name))) {
            return kept[1];
         } else {
            Component badged = Component.empty().append(glyph()).append(name);
            if (BADGED.size() >= 512) {
               BADGED.clear();
            }

            BADGED.put(uuid, new Component[]{name, badged});
            return badged;
         }
      } else {
         return name;
      }
   }

   public static Component inTab(PlayerInfo entry, Component name) {
      return entry != null && BadgeModule.inTab() ? mark(name, Profiles.id(entry.getProfile())) : name;
   }

   public static Component overHead(Entity entity, Component name) {
      return entity instanceof Player && BadgeModule.overHeads() ? mark(name, entity.getUUID()) : name;
   }
}
