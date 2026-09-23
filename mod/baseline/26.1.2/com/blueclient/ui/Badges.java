package com.blueclient.ui;

import com.blueclient.capes.Capes;
import com.blueclient.hud.modules.BadgeModule;
import java.util.UUID;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.PlayerInfo;
import net.minecraft.network.chat.Component;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;

public final class Badges {
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
      return (Component)(name != null && on(uuid) ? Component.empty().append(glyph()).append(name) : name);
   }

   public static Component inTab(PlayerInfo entry, Component name) {
      return entry != null && BadgeModule.inTab() ? mark(name, Profiles.id(entry.getProfile())) : name;
   }

   public static Component overHead(Entity entity, Component name) {
      return entity instanceof Player && BadgeModule.overHeads() ? mark(name, entity.getUUID()) : name;
   }
}
