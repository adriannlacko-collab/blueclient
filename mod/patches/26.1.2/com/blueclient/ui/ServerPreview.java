package com.blueclient.ui;

import com.mojang.blaze3d.platform.NativeImage;
import java.net.UnknownHostException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import net.fabricmc.fabric.api.client.screen.v1.ScreenEvents;
import net.fabricmc.fabric.api.client.screen.v1.ScreenEvents.AfterInit;
import net.minecraft.ChatFormatting;
import net.minecraft.SharedConstants;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.components.events.GuiEventListener;
import net.minecraft.client.gui.screens.DirectJoinServerScreen;
import net.minecraft.client.gui.screens.FaviconTexture;
import net.minecraft.client.gui.screens.ManageServerScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.multiplayer.ServerStatusPinger;
import net.minecraft.client.multiplayer.ServerData.State;
import net.minecraft.client.multiplayer.ServerData.Type;
import net.minecraft.client.multiplayer.resolver.ServerAddress;
import net.minecraft.network.chat.CommonComponents;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.contents.TranslatableContents;
import net.minecraft.resources.Identifier;
import net.minecraft.util.FormattedCharSequence;
import net.minecraft.util.Util;

/**
 * The server an address points at, drawn under the Server Address box of Add
 * Server / Edit Server and Direct Connection the way the server list draws it:
 * icon, name, MOTD, player count and ping bars. It shows up once the host has
 * a dot in it (a domain or an IP) and is pinged when the typing has stopped
 * for a moment. The buttons under the box move down to make room when they
 * are in the way; on a window too short for that, nothing is shown.
 */
public final class ServerPreview {
   private static final int ROW_W = 305;
   private static final int ICON = 32;
   /** Address box to the row. */
   private static final int GAP = 6;
   /** The row to the first button under it, and between buttons moved down. */
   private static final int BUTTON_GAP = 6;
   /** How long the address has to stay the same before it is pinged. */
   private static final long SETTLE_MS = 500L;
   private static final int WHITE = -1;
   private static final int GREY = -8355712;
   private static final Identifier[] PING = sprites("ping_", 5);
   private static final Identifier[] PINGING = sprites("pinging_", 5);
   private static final Identifier UNREACHABLE = sprite("unreachable");
   private static final Identifier INCOMPATIBLE = sprite("incompatible");
   private static final Component PINGING_TEXT = Component.translatable("multiplayer.status.pinging").withStyle(ChatFormatting.DARK_GRAY);
   private static final Component DEFAULT_NAME = Component.translatable("selectServer.defaultName");
   private static final ExecutorService PINGERS = Executors.newSingleThreadExecutor(task -> {
      Thread thread = new Thread(task, "BlueClient server preview");
      thread.setDaemon(true);
      return thread;
   });
   private static final ServerStatusPinger pinger = new ServerStatusPinger();
   private static boolean installed;
   /** The address box's text at the last tick, trimmed; null before the first. */
   private static String address;
   /** The row for it, or null when it has no dot yet. */
   private static ServerData server;
   private static boolean asked;
   private static long settleAt;
   private static FaviconTexture icon;
   private static byte[] shownIcon;

   private ServerPreview() {
   }

   public static void install() {
      if (installed) {
         return;
      }

      installed = true;
      ScreenEvents.AFTER_INIT.register((AfterInit)(client, screen, width, height) -> {
         if (screen instanceof ManageServerScreen || screen instanceof DirectJoinServerScreen) {
            attach(client, screen, width, height);
         }
      });
   }

   private static void attach(Minecraft client, Screen screen, int width, int height) {
      EditBox name = null;
      EditBox box = null;

      for (GuiEventListener child : screen.children()) {
         if (child instanceof EditBox edit) {
            name = box;
            box = edit;
         }
      }

      if (box == null) {
         return;
      }

      EditBox addressBox = box;
      EditBox nameBox = screen instanceof ManageServerScreen ? name : null;
      int top = box.getY() + box.getHeight() + GAP;
      if (!makeRoom(screen, box, top + ICON + BUTTON_GAP, height)) {
         return;
      }

      int x = width / 2 - ROW_W / 2;
      ScreenEvents.afterTick(screen).register(s -> tick(client, addressBox.getValue()));
      ScreenHooks.afterDraw(screen, (s, ctx, mouseX, mouseY, delta) -> draw(client, ctx, nameBox, x, top));
      ScreenEvents.remove(screen).register(s -> forget());
   }

   /**
    * Moves the widgets under the address box to {@code from}, one under the
    * other, {@link #BUTTON_GAP} apart. False, and nothing moved, when
    * the last of them would then leave the screen.
    */
   private static boolean makeRoom(Screen screen, EditBox box, int from, int height) {
      int boxBottom = box.getY() + box.getHeight();
      List<AbstractWidget> below = new ArrayList<>();

      for (GuiEventListener child : screen.children()) {
         if (child instanceof AbstractWidget widget && widget != box && widget.getY() >= boxBottom) {
            below.add(widget);
         }
      }

      below.sort(Comparator.comparingInt(AbstractWidget::getY));
      int[] ys = new int[below.size()];
      int next = from;
      int lastOld = Integer.MIN_VALUE;
      int lastNew = 0;
      int rowBottom = from;

      for (int i = 0; i < below.size(); i++) {
         AbstractWidget widget = below.get(i);
         if (widget.getY() != lastOld) {
            lastOld = widget.getY();
            // Every row goes right under the one before, up as well as down, so
            // the gap under the preview is the same on Add Server and Direct
            // Connection (whose Join button sits far lower in vanilla).
            lastNew = next;
         }

         ys[i] = lastNew;
         rowBottom = Math.max(rowBottom, lastNew + widget.getHeight());
         next = rowBottom + BUTTON_GAP;
         if (rowBottom > height) {
            return false;
         }
      }

      for (int i = 0; i < below.size(); i++) {
         below.get(i).setY(ys[i]);
      }

      return true;
   }

   private static void tick(Minecraft client, String value) {
      String typed = value.trim();
      if (!typed.equals(address)) {
         boolean first = address == null;
         address = typed;
         pinger.removeAll();
         clearIcon();
         server = null;
         asked = false;
         if (shows(typed)) {
            server = new ServerData(typed, typed, Type.OTHER);
            server.setState(State.PINGING);
            server.motd = PINGING_TEXT;
            server.status = CommonComponents.EMPTY;
            settleAt = first ? 0L : Util.getMillis() + SETTLE_MS;
         }
      }

      if (server != null && !asked && Util.getMillis() >= settleAt) {
         asked = true;
         ping(client, server);
      }

      pinger.tick();
   }

   /** A host with a dot that is neither its first nor its last character, and an address the game would accept. */
   private static boolean shows(String typed) {
      if (typed.isEmpty() || !ServerAddress.isValidAddress(typed)) {
         return false;
      } else {
         String host = ServerAddress.parseString(typed).getHost();
         int dot = host.indexOf('.');
         return dot > 0 && !host.endsWith(".");
      }
   }

   private static void ping(Minecraft client, ServerData data) {
      PINGERS.submit(() -> {
         try {
            Pings.add(pinger, client, data, () -> {}, () -> data.setState(data.protocol == SharedConstants.getProtocolVersion() ? State.SUCCESSFUL : State.INCOMPATIBLE));
         } catch (UnknownHostException var3) {
            data.setState(State.UNREACHABLE);
            data.motd = Component.translatable("multiplayer.status.cannot_resolve").withStyle(ChatFormatting.DARK_RED);
         } catch (Exception var4) {
            data.setState(State.UNREACHABLE);
            data.motd = Component.translatable("multiplayer.status.cannot_connect").withStyle(ChatFormatting.DARK_RED);
         }
      });
   }

   private static void forget() {
      pinger.removeAll();
      clearIcon();
      address = null;
      server = null;
      asked = false;
   }

   private static void draw(Minecraft client, GuiGraphicsExtractor ctx, EditBox nameBox, int x, int y) {
      ServerData data = server;
      if (data == null) {
         return;
      }

      Font font = client.font;
      int right = x + ROW_W;
      Component name;
      if (nameBox == null) {
         name = Component.literal(data.ip);
      } else {
         String typedName = nameBox.getValue();
         name = typedName.isEmpty() ? DEFAULT_NAME : Component.literal(typedName);
      }

      ctx.text(font, name, x + ICON + 3, y + 1, WHITE);
      Component motd = data.motd != null ? data.motd : CommonComponents.EMPTY;
      List<FormattedCharSequence> lines = font.split(motd, ROW_W - ICON - 2);

      for (int i = 0; i < Math.min(lines.size(), 2); i++) {
         ctx.text(font, lines.get(i), x + ICON + 3, y + 12 + 9 * i, GREY);
      }

      Blit.draw(ctx, favicon(client, data), x, y, 0.0F, 0.0F, ICON, ICON, ICON, ICON, ICON, ICON);
      int barsX = right - 15;
      Blit.sprite(ctx, statusIcon(data), barsX, y, 10, 8);
      Component count = data.state() == State.INCOMPATIBLE && data.version != null ? data.version.copy().withStyle(ChatFormatting.RED) : data.status;
      if (count != null) {
         ctx.text(font, count, barsX - font.width(count) - 5, y + 1, GREY);
      }
   }

   private static Identifier statusIcon(ServerData data) {
      switch (data.state()) {
         case INCOMPATIBLE:
            return INCOMPATIBLE;
         case UNREACHABLE:
            return UNREACHABLE;
         case SUCCESSFUL:
            long ping = data.ping;
            return ping < 150L ? PING[4] : (ping < 300L ? PING[3] : (ping < 600L ? PING[2] : (ping < 1000L ? PING[1] : PING[0])));
         default:
            // The pinger gives up without changing the state (a refused connection, an unknown host): the list keeps
            // animating then, but the MOTD already says "Can't connect to server", so the row shows the X instead.
            if (failed(data.motd)) {
               return UNREACHABLE;
            } else {
               int frame = (int)(Util.getMillis() / 100L & 7L);
               return PINGING[frame > 4 ? 8 - frame : frame];
            }
      }
   }

   private static boolean failed(Component motd) {
      return motd != null
         && motd.getContents() instanceof TranslatableContents key
         && (key.getKey().equals("multiplayer.status.cannot_connect") || key.getKey().equals("multiplayer.status.cannot_resolve"));
   }

   private static Identifier favicon(Minecraft client, ServerData data) {
      if (icon == null) {
         icon = FaviconTexture.forServer(client.getTextureManager(), "blueclient/preview");
      }

      byte[] bytes = data.getIconBytes();
      if (!Arrays.equals(bytes, shownIcon)) {
         shownIcon = bytes;
         if (bytes == null) {
            icon.clear();
         } else {
            try {
               icon.upload(NativeImage.read(bytes));
            } catch (Throwable var4) {
               icon.clear();
            }
         }
      }

      return icon.textureLocation();
   }

   private static void clearIcon() {
      shownIcon = null;
      if (icon != null) {
         icon.clear();
      }
   }

   private static Identifier sprite(String name) {
      return Identifier.fromNamespaceAndPath("minecraft", "server_list/" + name);
   }

   private static Identifier[] sprites(String stem, int count) {
      Identifier[] out = new Identifier[count];

      for (int i = 0; i < count; i++) {
         out[i] = sprite(stem + (i + 1));
      }

      return out;
   }
}
