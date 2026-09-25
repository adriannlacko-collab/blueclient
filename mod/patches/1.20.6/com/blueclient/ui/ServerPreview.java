package com.blueclient.ui;

import java.net.UnknownHostException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import net.fabricmc.fabric.api.client.screen.v1.ScreenEvents.AfterInit;
import net.fabricmc.fabric.api.client.screen.v1.ScreenEvents;
import net.minecraft.class_1011;
import net.minecraft.class_124;
import net.minecraft.class_155;
import net.minecraft.class_156;
import net.minecraft.class_2561;
import net.minecraft.class_2588;
import net.minecraft.class_2960;
import net.minecraft.class_310;
import net.minecraft.class_327;
import net.minecraft.class_332;
import net.minecraft.class_339;
import net.minecraft.class_342;
import net.minecraft.class_364;
import net.minecraft.class_420;
import net.minecraft.class_422;
import net.minecraft.class_437;
import net.minecraft.class_5244;
import net.minecraft.class_5481;
import net.minecraft.class_639;
import net.minecraft.class_642.class_8678;
import net.minecraft.class_642.class_9083;
import net.minecraft.class_642;
import net.minecraft.class_644;
import net.minecraft.class_8573;

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
   private static final class_2960[] PING = sprites("ping_", 5);
   private static final class_2960[] PINGING = sprites("pinging_", 5);
   private static final class_2960 UNREACHABLE = sprite("unreachable");
   private static final class_2960 INCOMPATIBLE = sprite("incompatible");
   private static final class_2561 PINGING_TEXT = class_2561.method_43471("multiplayer.field_3753.pinging").method_27692(class_124.field_1063);
   private static final class_2561 DEFAULT_NAME = class_2561.method_43471("selectServer.defaultName");
   private static final ExecutorService PINGERS = Executors.newSingleThreadExecutor(task -> {
      Thread thread = new Thread(task, "BlueClient server preview");
      thread.setDaemon(true);
      return thread;
   });
   private static final class_644 pinger = new class_644();
   private static boolean installed;
   /** The address box's text at the last tick, trimmed; null before the first. */
   private static String address;
   /** The row for it, or null when it has no dot yet. */
   private static class_642 server;
   private static boolean asked;
   private static long settleAt;
   private static class_8573 icon;
   private static byte[] shownIcon;

   private ServerPreview() {
   }

   public static void install() {
      if (installed) {
         return;
      }

      installed = true;
      ScreenEvents.AFTER_INIT.register((AfterInit)(client, screen, width, height) -> {
         if (screen instanceof class_422 || screen instanceof class_420) {
            attach(client, screen, width, height);
         }
      });
   }

   private static void attach(class_310 client, class_437 screen, int width, int height) {
      class_342 name = null;
      class_342 box = null;

      for (class_364 child : screen.method_25396()) {
         if (child instanceof class_342 edit) {
            name = box;
            box = edit;
         }
      }

      if (box == null) {
         return;
      }

      class_342 addressBox = box;
      class_342 nameBox = screen instanceof class_422 ? name : null;
      int top = box.method_46427() + box.method_25364() + GAP;
      if (!makeRoom(screen, box, top + ICON + BUTTON_GAP, height)) {
         return;
      }

      int x = width / 2 - ROW_W / 2;
      ScreenEvents.afterTick(screen).register(s -> tick(client, addressBox.method_1882()));
      ScreenHooks.afterDraw(screen, (s, ctx, mouseX, mouseY, delta) -> draw(client, ctx, nameBox, x, top));
      ScreenEvents.remove(screen).register(s -> forget());
   }

   /**
    * Moves the widgets under the address box to {@code from}, one under the
    * other, {@link #BUTTON_GAP} apart. False, and nothing moved, when
    * the last of them would then leave the screen.
    */
   private static boolean makeRoom(class_437 screen, class_342 box, int from, int height) {
      int boxBottom = box.method_46427() + box.method_25364();
      List<class_339> below = new ArrayList<>();

      for (class_364 child : screen.method_25396()) {
         if (child instanceof class_339 widget && widget != box && widget.method_46427() >= boxBottom) {
            below.add(widget);
         }
      }

      below.sort(Comparator.comparingInt(class_339::method_46427));
      int[] ys = new int[below.size()];
      int next = from;
      int lastOld = Integer.MIN_VALUE;
      int lastNew = 0;
      int rowBottom = from;

      for (int i = 0; i < below.size(); i++) {
         class_339 widget = below.get(i);
         if (widget.method_46427() != lastOld) {
            lastOld = widget.method_46427();
            // Every row goes right under the one before, up as well as down, so
            // the gap under the preview is the same on Add Server and Direct
            // Connection (whose Join button sits far lower in vanilla).
            lastNew = next;
         }

         ys[i] = lastNew;
         rowBottom = Math.max(rowBottom, lastNew + widget.method_25364());
         next = rowBottom + BUTTON_GAP;
         if (rowBottom > height) {
            return false;
         }
      }

      for (int i = 0; i < below.size(); i++) {
         below.get(i).method_46419(ys[i]);
      }

      return true;
   }

   private static void tick(class_310 client, String value) {
      String typed = value.trim();
      if (!typed.equals(address)) {
         boolean first = address == null;
         address = typed;
         pinger.method_3004();
         clearIcon();
         server = null;
         asked = false;
         if (shows(typed)) {
            server = new class_642(typed, typed, class_8678.field_45611);
            server.method_55824(class_9083.field_47881);
            server.field_3757 = PINGING_TEXT;
            server.field_3753 = class_5244.field_39003;
            settleAt = first ? 0L : class_156.method_658() + SETTLE_MS;
         }
      }

      if (server != null && !asked && class_156.method_658() >= settleAt) {
         asked = true;
         ping(client, server);
      }

      pinger.method_3000();
   }

   /** A host with a dot that is neither its first nor its last character, and an address the game would accept. */
   private static boolean shows(String typed) {
      if (typed.isEmpty() || !class_639.method_36224(typed)) {
         return false;
      } else {
         String host = class_639.method_2950(typed).method_2952();
         int dot = host.indexOf('.');
         return dot > 0 && !host.endsWith(".");
      }
   }

   private static void ping(class_310 client, class_642 data) {
      PINGERS.submit(() -> {
         try {
            Pings.add(pinger, client, data, () -> {}, () -> data.method_55824(data.field_3756 == class_155.method_31372() ? class_9083.field_47884 : class_9083.field_47883));
         } catch (UnknownHostException var3) {
            data.method_55824(class_9083.field_47882);
            data.field_3757 = class_2561.method_43471("multiplayer.field_3753.cannot_resolve").method_27692(class_124.field_1079);
         } catch (Exception var4) {
            data.method_55824(class_9083.field_47882);
            data.field_3757 = class_2561.method_43471("multiplayer.field_3753.cannot_connect").method_27692(class_124.field_1079);
         }
      });
   }

   private static void forget() {
      pinger.method_3004();
      clearIcon();
      address = null;
      server = null;
      asked = false;
   }

   private static void draw(class_310 client, class_332 ctx, class_342 nameBox, int x, int y) {
      class_642 data = server;
      if (data == null) {
         return;
      }

      class_327 font = client.field_1772;
      int right = x + ROW_W;
      class_2561 name;
      if (nameBox == null) {
         name = class_2561.method_43470(data.field_3761);
      } else {
         String typedName = nameBox.method_1882();
         name = typedName.isEmpty() ? DEFAULT_NAME : class_2561.method_43470(typedName);
      }

      ctx.method_27535(font, name, x + ICON + 3, y + 1, WHITE);
      class_2561 motd = data.field_3757 != null ? data.field_3757 : class_5244.field_39003;
      List<class_5481> lines = font.method_1728(motd, ROW_W - ICON - 2);

      for (int i = 0; i < Math.min(lines.size(), 2); i++) {
         ctx.method_35720(font, lines.get(i), x + ICON + 3, y + 12 + 9 * i, GREY);
      }

      Blit.draw(ctx, favicon(client, data), x, y, 0.0F, 0.0F, ICON, ICON, ICON, ICON, ICON, ICON);
      int barsX = right - 15;
      Blit.sprite(ctx, statusIcon(data), barsX, y, 10, 8);
      class_2561 count = data.method_55825() == class_9083.field_47883 && data.field_3760 != null ? data.field_3760.method_27661().method_27692(class_124.field_1061) : data.field_3753;
      if (count != null) {
         ctx.method_27535(font, count, barsX - font.method_27525(count) - 5, y + 1, GREY);
      }
   }

   private static class_2960 statusIcon(class_642 data) {
      switch (data.method_55825()) {
         case field_47883:
            return INCOMPATIBLE;
         case field_47882:
            return UNREACHABLE;
         case field_47884:
            long ping = data.field_3758;
            return ping < 150L ? PING[4] : (ping < 300L ? PING[3] : (ping < 600L ? PING[2] : (ping < 1000L ? PING[1] : PING[0])));
         default:
            // The pinger gives up without changing the state (a refused connection, an unknown host): the list keeps
            // animating then, but the MOTD already says "Can't connect to server", so the row shows the X instead.
            if (failed(data.field_3757)) {
               return UNREACHABLE;
            } else {
               int frame = (int)(class_156.method_658() / 100L & 7L);
               return PINGING[frame > 4 ? 8 - frame : frame];
            }
      }
   }

   private static boolean failed(class_2561 motd) {
      return motd != null
         && motd.method_10851() instanceof class_2588 key
         && (key.method_11022().equals("multiplayer.field_3753.cannot_connect") || key.method_11022().equals("multiplayer.field_3753.cannot_resolve"));
   }

   private static class_2960 favicon(class_310 client, class_642 data) {
      if (icon == null) {
         icon = class_8573.method_52202(client.method_1531(), "blueclient/preview");
      }

      byte[] bytes = data.method_49306();
      if (!Arrays.equals(bytes, shownIcon)) {
         shownIcon = bytes;
         if (bytes == null) {
            icon.method_52198();
         } else {
            try {
               icon.method_52199(class_1011.method_49277(bytes));
            } catch (Throwable var4) {
               icon.method_52198();
            }
         }
      }

      return icon.method_52201();
   }

   private static void clearIcon() {
      shownIcon = null;
      if (icon != null) {
         icon.method_52198();
      }
   }

   private static class_2960 sprite(String name) {
      return class_2960.method_43902("minecraft", "server_list/" + name);
   }

   private static class_2960[] sprites(String stem, int count) {
      class_2960[] out = new class_2960[count];

      for (int i = 0; i < count; i++) {
         out[i] = sprite(stem + (i + 1));
      }

      return out;
   }
}
