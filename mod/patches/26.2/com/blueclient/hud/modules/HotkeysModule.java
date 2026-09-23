package com.blueclient.hud.modules;

import com.blueclient.BlueClient;
import com.blueclient.Disk;
import com.blueclient.hud.BehaviourModule;
import com.blueclient.hud.Category;
import com.blueclient.hud.Setting;
import com.blueclient.ui.Icon;
import com.blueclient.ui.Keys;
import com.blueclient.ui.Screens;
import com.blueclient.ui.Tell;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;
import com.google.gson.JsonPrimitive;
import com.google.gson.reflect.TypeToken;
import com.mojang.blaze3d.platform.InputConstants;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.ChatFormatting;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;

/**
 * Hotkeys: a key that sends chat lines or commands, in order, one press at a
 * time. They go through the game's own chat and command sending, exactly as
 * if the player had typed them.
 *
 * The hotkeys live in config/blueclient-hotkeys.json, beside blueclient.json.
 */
public class HotkeysModule extends BehaviourModule {
   /** The longest line the game lets you send. */
   public static final int MAX_LINE = 256;
   /** The key the game reports for "nothing bound". */
   private static final int UNBOUND = -1;
   /**
    * Whether the game lets two key mappings share a key (1.21.9 and later).
    * Before that a key has one mapping, and a hotkey's own would take the key
    * from whatever Controls has on it.
    */
   private static final boolean SHARED_KEYS = true;
   private static int serial;
   private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
   private static final List<HotkeysModule.Hotkey> HOTKEYS = new ArrayList<>();
   private static boolean loaded;
   private static HotkeysModule active;
   private final Setting.Range chatGap = this.add(new Setting.Range("chatgap", "Gap between chat lines", 0, 3000, 1000, " ms"));
   /** Hotkeys pressed whose lines are still going out, first pressed first. */
   private final List<HotkeysModule.Sending> queue = new ArrayList<>();
   private long lastChat;
   private LocalPlayer lastPlayer;
   private int ticks;

   public HotkeysModule() {
      super("hotkeys", "Hotkeys", "Put chat lines or commands on keys of their own", Category.GENERAL, Icon.KEYS, true);
      active = this;
   }

   public static HotkeysModule instance() {
      return active;
   }

   // ------------------------------------------------------------------ store

   public static List<HotkeysModule.Hotkey> all() {
      ensureLoaded();
      return HOTKEYS;
   }

   private static Path file() {
      return FabricLoader.getInstance().getConfigDir().resolve("blueclient-hotkeys.json");
   }

   private static void ensureLoaded() {
      if (!loaded) {
         loaded = true;

         try {
            Path path = file();
            if (!Files.exists(path)) {
               return;
            }

            JsonObject root = GSON.fromJson(Files.readString(path), JsonObject.class);
            if (root == null || !root.has("hotkeys")) {
               return;
            }

            List<HotkeysModule.Hotkey> read = GSON.fromJson(root.get("hotkeys"), new TypeToken<List<HotkeysModule.Hotkey>>() {}.getType());
            if (read != null) {
               for (HotkeysModule.Hotkey hotkey : read) {
                  if (hotkey != null) {
                     hotkey.clean();
                     HOTKEYS.add(hotkey);
                  }
               }
            }
         } catch (Exception e) {
            BlueClient.LOGGER.warn("Could not read blueclient-hotkeys.json, starting empty", e);
         }
      }
   }

   public static void saveStore() {
      try {
         JsonObject root = new JsonObject();
         root.add("hotkeys", GSON.toJsonTree(all()));
         Disk.write(file(), GSON.toJson(root));
      } catch (Exception e) {
         BlueClient.LOGGER.warn("Could not write blueclient-hotkeys.json", e);
      }
   }

   public static HotkeysModule.Hotkey create() {
      HotkeysModule.Hotkey hotkey = new HotkeysModule.Hotkey();
      hotkey.name = "Hotkey " + (all().size() + 1);
      HOTKEYS.add(hotkey);
      saveStore();
      return hotkey;
   }

   public static void remove(HotkeysModule.Hotkey hotkey) {
      if (active != null) {
         active.cancel(hotkey);
      }

      hotkey.setKey(unbound());
      all().remove(hotkey);
      saveStore();
   }

   // --------------------------------------------------------------- the keys

   public static InputConstants.Key unbound() {
      return InputConstants.UNKNOWN;
   }

   static Setting.Key keyNamed(String name) {
      Setting.Key key = new Setting.Key("key", "Key", UNBOUND);
      key.load(new JsonPrimitive(name == null || name.isEmpty() ? unbound().getName() : name));
      return key;
   }

   public static Component mappingName(KeyMapping mapping) {
      return Component.translatable(mapping.getName());
   }

   /** The first of the game's key mappings bound to this key, or null. */
   public static KeyMapping boundTo(Minecraft client, InputConstants.Key key) {
      if (key != null && !key.equals(unbound()) && client != null && client.options != null) {
         for (KeyMapping mapping : client.options.keyMappings) {
            if (key.equals(Keys.bound(mapping))) {
               return mapping;
            }
         }
      }

      return null;
   }

   // ------------------------------------------------------------------ ticks

   @Override
   public boolean wantsFrame() {
      return true;
   }

   @Override
   public void tick(Minecraft client) {
      LocalPlayer player = client.player;
      if (player != this.lastPlayer) {
         this.lastPlayer = player;
         this.queue.clear();
         for (HotkeysModule.Hotkey hotkey : all()) {
            hotkey.wasDown = false;
         }
      }

      if (!SHARED_KEYS && ++this.ticks % 20 == 0) {
         for (HotkeysModule.Hotkey hotkey : all()) {
            hotkey.syncTrigger();
         }
      }

      if (player != null) {
         if (!this.isEnabled()) {
            for (HotkeysModule.Hotkey hotkey : all()) {
               hotkey.clicks();
               hotkey.wasDown = false;
            }

            this.queue.clear();
         } else {
            boolean menu = Screens.current(client) != null;

            for (HotkeysModule.Hotkey hotkey : all()) {
               int clicks = hotkey.clicks();
               boolean live = !menu && hotkey.enabled;
               boolean held = live && (hotkey.trigger().isDown() || hotkey.bound().isDown());
               // a key held down repeats its clicks: only a click after the key was up is a press
               boolean tapped = live && (clicks > 0 && !hotkey.wasDown || hotkey.latched || held && !hotkey.wasDown);
               hotkey.latched = false;
               if (tapped) {
                  this.send(client, hotkey);
               }

               hotkey.wasDown = held || tapped;
            }

            this.sendNext(client);
         }
      }
   }

   /**
    * Every frame: notes a hotkey pressed since the last tick, so a quick tap
    * between two ticks still counts when the game runs slowly.
    */
   @Override
   public void frame(Minecraft client) {
      if (this.isEnabled() && Screens.current(client) == null) {
         for (HotkeysModule.Hotkey hotkey : all()) {
            if (hotkey.enabled && !hotkey.wasDown && hotkey.bound().isDown()) {
               hotkey.latched = true;
            }
         }
      }
   }

   /** Queues a hotkey's lines; they go out one at a time, the chat gap apart. */
   public void send(Minecraft client, HotkeysModule.Hotkey hotkey) {
      if (client.player != null && this.isEnabled() && !this.sending(hotkey)) {
         if (hotkey.lines.isEmpty()) {
            Tell.bar(client.player, Component.literal(hotkey.name + " has nothing to send yet").withStyle(ChatFormatting.RED));
         } else {
            this.queue.add(new HotkeysModule.Sending(hotkey));
         }
      }
   }

   public boolean sending(HotkeysModule.Hotkey hotkey) {
      for (HotkeysModule.Sending sending : this.queue) {
         if (sending.hotkey == hotkey) {
            return true;
         }
      }

      return false;
   }

   public void cancel(HotkeysModule.Hotkey hotkey) {
      this.queue.removeIf(sending -> sending.hotkey == hotkey);
   }

   private void sendNext(Minecraft client) {
      if (!this.queue.isEmpty() && System.currentTimeMillis() - this.lastChat >= this.chatGap.get()) {
         HotkeysModule.Sending sending = this.queue.get(0);
         List<String> lines = sending.hotkey.lines;
         if (sending.next < lines.size()) {
            this.sendLine(client, lines.get(sending.next++));
         }

         if (sending.next >= lines.size()) {
            this.queue.remove(0);
         }
      }
   }

   private void sendLine(Minecraft client, String text) {
      ClientPacketListener connection = client.getConnection();
      String line = text == null ? "" : text.trim();
      if (connection != null && !line.isEmpty()) {
         if (line.startsWith("/")) {
            String command = line.substring(1).trim();
            if (!command.isEmpty()) {
               connection.sendCommand(command);
            }
         } else {
            connection.sendChat(line);
         }

         this.lastChat = System.currentTimeMillis();
      }
   }

   // ----------------------------------------------------------------- model

   public static final class Hotkey {
      public String name = "Hotkey";
      public String key = "";
      public boolean enabled = true;
      /** Sent in order on each press; a line that starts with "/" is a command. */
      public List<String> lines = new ArrayList<>();
      transient boolean wasDown;
      transient boolean latched;
      private transient Setting.Key bound;
      private transient KeyMapping trigger;

      void clean() {
         if (this.name == null || this.name.isBlank()) {
            this.name = "Hotkey";
         }

         if (this.lines == null) {
            this.lines = new ArrayList<>();
         }

         this.lines.removeIf(line -> line == null || line.isBlank());
      }

      public Setting.Key bound() {
         if (this.bound == null) {
            this.bound = keyNamed(this.key);
         }

         return this.bound;
      }

      public void setKey(InputConstants.Key next) {
         this.key = next == null || next.equals(unbound()) ? "" : next.getName();
         this.bound = null;
         this.syncTrigger();
      }

      /**
       * A key mapping of the hotkey's own, kept out of Controls and options.txt,
       * so the game's key events reach the hotkey: a tap too quick for a tick to
       * see down still counts, as it does for the game's own keys.
       */
      KeyMapping trigger() {
         if (this.trigger == null) {
            this.trigger = new KeyMapping("key.blueclient.hotkey." + ++serial, Keys.keyboard(), UNBOUND, Keys.CATEGORY);
            this.syncTrigger();
         }

         return this.trigger;
      }

      void syncTrigger() {
         if (this.trigger != null) {
            InputConstants.Key want = this.bound().get();
            if (!SHARED_KEYS && boundTo(Minecraft.getInstance(), want) != null) {
               want = unbound();
            }

            if (!want.equals(Keys.bound(this.trigger))) {
               this.trigger.setKey(want);
               KeyMapping.resetMapping();
            }
         }
      }

      int clicks() {
         int clicks = 0;

         while (this.trigger().consumeClick()) {
            clicks++;
         }

         return clicks;
      }

      public Component keyLabel() {
         return this.bound().isUnbound() ? Component.literal("No key").withStyle(ChatFormatting.GRAY) : this.bound().display();
      }

      /** What a press sends, a line each. */
      public Component summary() {
         if (this.lines.isEmpty()) {
            return Component.literal("Nothing to send yet");
         } else {
            MutableComponent out = Component.empty();

            for (int i = 0; i < this.lines.size(); i++) {
               out.append(Component.literal(i == 0 ? "" : "\n")).append(lineLabel(this.lines.get(i)));
            }

            return out;
         }
      }
   }

   public static Component lineLabel(String line) {
      String text = line == null ? "" : line.trim();
      return text.startsWith("/")
         ? Component.literal("Command: ").append(Component.literal(text).withStyle(ChatFormatting.AQUA))
         : Component.literal("Say: ").append(Component.literal(text).withStyle(ChatFormatting.WHITE));
   }

   /** A pressed hotkey whose lines are still going out. */
   private static final class Sending {
      final HotkeysModule.Hotkey hotkey;
      int next;

      Sending(HotkeysModule.Hotkey hotkey) {
         this.hotkey = hotkey;
      }
   }
}
