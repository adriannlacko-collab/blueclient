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
import com.blueclient.ui.input.Inputs;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;
import com.google.gson.JsonPrimitive;
import com.google.gson.reflect.TypeToken;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.class_124;
import net.minecraft.class_2561;
import net.minecraft.class_304;
import net.minecraft.class_310;
import net.minecraft.class_315;
import net.minecraft.class_3675;
import net.minecraft.class_437;
import net.minecraft.class_634;
import net.minecraft.class_746;

/**
 * Hotkeys: a key that sends a chat line or a command, presses one of the
 * game's own keys, waits, or plays back movement recorded with the recorder
 * below — once per press, looped until pressed again, or for as long as the
 * key is held. Everything a hotkey does goes through the game's own inputs
 * (its key mappings, its chat and command sending), exactly as if the player
 * had pressed the keys or typed the line; nothing is sent that the player
 * could not have sent by hand.
 *
 * The hotkeys live in config/blueclient-hotkeys.json, beside blueclient.json.
 */
public class HotkeysModule extends BehaviourModule {
   public static final String ONCE = "once";
   public static final String LOOP = "loop";
   public static final String HOLD = "hold";
   public static final List<String> MODES = List.of(ONCE, LOOP, HOLD);
   public static final String CHAT = "chat";
   public static final String PRESS = "key";
   public static final String WAIT = "wait";
   public static final String MOVES = "moves";
   /** Ten minutes of recording at 20 ticks a second. */
   private static final int MAX_RECORDING = 12000;
   /** keySprint's bit in a recorded frame (see moveKeys). */
   private static final int SPRINT_BIT = 1 << 6;
   /** Chat lines and zero-length waits a run may get through in one tick. */
   private static final int INSTANT_PER_TICK = 16;
   /** The key the game reports for "nothing bound". */
   private static final int UNBOUND = -1;
   /**
    * Whether the game lets two key mappings share a key (1.21.9 and later).
    * Before that a key has one mapping, and a hotkey's own would take the key
    * from whatever Controls has on it.
    */
   private static final boolean SHARED_KEYS = false;
   private static int serial;
   private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
   private static final List<HotkeysModule.Hotkey> HOTKEYS = new ArrayList<>();
   private static boolean loaded;
   private static HotkeysModule active;
   private static HotkeysModule.Recording recording;
   private final Setting.Key stopKey = this.add(new Setting.Key("stopkey", "Stop all hotkeys", UNBOUND));
   private final Setting.Bool notify = this.add(new Setting.Bool("notify", "Say when one starts and stops", true));
   private final Setting.Bool stopOnHurt = this.add(new Setting.Bool("hurt", "Stop them all when you take damage", true));
   private final Setting.Range chatGap = this.add(new Setting.Range("chatgap", "Gap between chat lines", 0, 3000, 1000, " ms"));
   private final List<HotkeysModule.Run> runs = new ArrayList<>();
   private Set<class_304> held = new HashSet<>();
   private Set<class_304> wanted = new HashSet<>();
   private final List<class_304> clicks = new ArrayList<>();
   private boolean stopWasDown;
   private boolean stopLatched;
   private float lastHealth = -1.0F;
   private long lastChat;
   private class_746 lastPlayer;
   private int ticks;
   private float yawNow;
   private float pitchNow;
   private float yawDone;
   private float pitchDone;
   private long tickNanos;

   public HotkeysModule() {
      super(
         "hotkeys",
         "Hotkeys",
         "Put a chat line, a command, any key or recorded movement on a key of its own — once, looped or while held",
         Category.GENERAL,
         Icon.KEYS,
         true
      );
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
         active.stop(class_310.method_1551(), hotkey, false);
      }

      hotkey.setKey(unbound());
      all().remove(hotkey);
      saveStore();
   }

   // --------------------------------------------------------------- the keys

   public static class_3675.class_306 unbound() {
      return class_3675.field_16237;
   }

   static Setting.Key keyNamed(String name) {
      Setting.Key key = new Setting.Key("key", "Key", UNBOUND);
      key.load(new JsonPrimitive(name == null || name.isEmpty() ? unbound().method_1441() : name));
      return key;
   }

   /** The game's own key mappings, in the order the Controls screen lists them. */
   public static List<class_304> mappings(class_310 client) {
      return client == null || client.field_1690 == null ? List.of() : List.of(client.field_1690.field_1839);
   }

   public static class_304 mapping(class_310 client, String name) {
      if (name != null) {
         for (class_304 mapping : mappings(client)) {
            if (name.equals(mapping.method_1431())) {
               return mapping;
            }
         }
      }

      return null;
   }

   public static class_2561 mappingName(class_304 mapping) {
      return class_2561.method_43471(mapping.method_1431());
   }

   public static class_2561 mappingName(String name) {
      return name == null ? class_2561.method_43470("Nothing") : class_2561.method_43471(name);
   }

   /** The first of the game's key mappings bound to this key, or null. */
   public static class_304 boundTo(class_310 client, class_3675.class_306 key) {
      if (key != null && !key.equals(unbound())) {
         for (class_304 mapping : mappings(client)) {
            if (key.equals(Keys.bound(mapping))) {
               return mapping;
            }
         }
      }

      return null;
   }

   /** What the recorder watches and plays back, one bit each. */
   private static class_304[] moveKeys(class_315 options) {
      return new class_304[]{
         options.field_1894, options.field_1881, options.field_1913, options.field_1849, options.field_1903, options.field_1832, options.field_1867, options.field_1886, options.field_1904
      };
   }

   private static class_304[] hotbarKeys(class_315 options) {
      return options.field_1852;
   }

   private static int slot(class_746 player) {
      return player.method_31548().method_67532();
   }

   private static void select(class_746 player, int slot) {
      player.method_31548().method_61496(slot);
   }

   private static boolean physicallyDown(class_3675.class_306 key) {
      if (key == null || key.equals(unbound())) {
         return false;
      } else if (key.method_1442() == class_3675.class_307.field_1672) {
         return Inputs.mouseDown(key.method_1444());
      } else {
         return key.method_1442() == Keys.keyboard() && Inputs.keyDown(key.method_1444());
      }
   }

   /**
    * Sets a key mapping down or up. A toggle mapping (sneak or sprint on
    * "Toggle") ignores "up" and flips on "down", so it takes a second press
    * when the first did not land.
    */
   private static void setState(class_304 mapping, boolean down) {
      if (mapping.method_1434() != down) {
         mapping.method_23481(down);
         if (mapping.method_1434() != down) {
            mapping.method_23481(!down);
         }
      }
   }

   private static void click(class_304 mapping) {
      class_3675.class_306 key = Keys.bound(mapping);
      if (key != null && !key.equals(unbound())) {
         class_304.method_1420(key);
      }
   }

   // ------------------------------------------------------------------ ticks

   @Override
   public boolean wantsFrame() {
      return true;
   }

   @Override
   public void tick(class_310 client) {
      class_746 player = client.field_1724;
      if (player != this.lastPlayer) {
         this.lastPlayer = player;
         this.runs.clear();
         this.held.clear();
         this.lastHealth = -1.0F;
         this.yawNow = this.pitchNow = this.yawDone = this.pitchDone = 0.0F;
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
         this.flushLook(client);
         if (recording != null) {
            drainClicks();
            this.record(client, player);
         } else if (!this.isEnabled()) {
            drainClicks();
            this.stopAll(client, false);
         } else {
            boolean menu = Screens.current(client) != null;
            boolean stopDown = !menu && (this.stopLatched || this.stopKey.isDown());
            this.stopLatched = false;
            if (stopDown && !this.stopWasDown && !this.runs.isEmpty()) {
               this.stopAll(client, true);
            }

            this.stopWasDown = stopDown;
            float health = player.method_6032();
            if (this.stopOnHurt.get() && this.lastHealth >= 0.0F && health < this.lastHealth && !this.runs.isEmpty()) {
               this.stopAll(client, false);
               this.say(player, class_2561.method_43470("■ Hotkeys stopped — you took damage").method_27692(class_124.field_1061));
            }

            this.lastHealth = health;

            for (HotkeysModule.Hotkey hotkey : all()) {
               int clicks = hotkey.clicks();
               boolean live = !menu && hotkey.enabled;
               boolean held = live && (hotkey.trigger().method_1434() || hotkey.bound().isDown());
               // a key held down repeats its clicks: only a click after the key was up is a press
               boolean tapped = live && (clicks > 0 && !hotkey.wasDown || hotkey.latched || held && !hotkey.wasDown);
               hotkey.latched = false;
               if (tapped) {
                  this.pressed(client, hotkey);
               } else if (!held && hotkey.wasDown && HOLD.equals(hotkey.mode)) {
                  this.stop(client, hotkey, true);
               }

               // a tap shorter than a tick still ends a "While held" run on the next one
               hotkey.wasDown = held || tapped;
            }

            if (menu) {
               this.releaseKeys();
            } else {
               this.advance(client, player);
            }
         }
      }
   }

   private static void drainClicks() {
      for (HotkeysModule.Hotkey hotkey : all()) {
         hotkey.clicks();
         hotkey.wasDown = false;
      }
   }

   private void pressed(class_310 client, HotkeysModule.Hotkey hotkey) {
      if (this.running(hotkey)) {
         this.stop(client, hotkey, true);
      } else {
         this.start(client, hotkey);
      }
   }

   public boolean running(HotkeysModule.Hotkey hotkey) {
      for (HotkeysModule.Run run : this.runs) {
         if (run.hotkey == hotkey) {
            return true;
         }
      }

      return false;
   }

   public int runningCount() {
      return this.runs.size();
   }

   public void start(class_310 client, HotkeysModule.Hotkey hotkey) {
      if (client.field_1724 != null && this.isEnabled() && recording == null && !this.running(hotkey)) {
         if (hotkey.steps.isEmpty()) {
            this.say(client.field_1724, class_2561.method_43470(hotkey.name + " has no actions yet").method_27692(class_124.field_1061));
         } else {
            this.runs.add(new HotkeysModule.Run(hotkey));
            if (!ONCE.equals(hotkey.mode) || hotkey.lasts()) {
               this.say(client.field_1724, class_2561.method_43470("▶ " + hotkey.name).method_27692(class_124.field_1060));
            }
         }
      }
   }

   public void stop(class_310 client, HotkeysModule.Hotkey hotkey, boolean tell) {
      if (this.runs.removeIf(run -> run.hotkey == hotkey)) {
         this.releaseKeys();
         if (tell && client != null && client.field_1724 != null) {
            this.say(client.field_1724, class_2561.method_43470("■ " + hotkey.name + " stopped").method_27692(class_124.field_1080));
         }
      }
   }

   public void stopAll(class_310 client, boolean tell) {
      if (!this.runs.isEmpty()) {
         this.runs.clear();
         this.releaseKeys();
         if (tell && client != null && client.field_1724 != null) {
            this.say(client.field_1724, class_2561.method_43470("■ All hotkeys stopped").method_27692(class_124.field_1080));
         }
      }
   }

   private void say(class_746 player, class_2561 text) {
      if (this.notify.get()) {
         Tell.bar(player, text);
      }
   }

   private void advance(class_310 client, class_746 player) {
      this.wanted.clear();
      this.clicks.clear();
      this.runs.removeIf(run -> {
         boolean more = run.advance(client, player, this);
         if (!more && run.hotkey.lasts()) {
            this.say(player, class_2561.method_43470("■ " + run.hotkey.name + " done").method_27692(class_124.field_1080));
         }

         return !more;
      });

      for (class_304 mapping : this.held) {
         if (!this.wanted.contains(mapping)) {
            this.letGo(mapping);
         }
      }

      for (class_304 mapping : this.wanted) {
         setState(mapping, true);
      }

      for (class_304 mapping : this.clicks) {
         click(mapping);
      }

      Set<class_304> was = this.held;
      this.held = this.wanted;
      this.wanted = was;
   }

   /** Lets go of every key a hotkey is holding, keeping any the player holds by hand. */
   private void releaseKeys() {
      for (class_304 mapping : this.held) {
         this.letGo(mapping);
      }

      this.held.clear();
   }

   private void letGo(class_304 mapping) {
      setState(mapping, physicallyDown(Keys.bound(mapping)));
   }

   private boolean chatReady() {
      return System.currentTimeMillis() - this.lastChat >= this.chatGap.get();
   }

   private void send(class_310 client, String text) {
      class_634 connection = client.method_1562();
      String line = text == null ? "" : text.trim();
      if (connection != null && !line.isEmpty()) {
         if (line.startsWith("/")) {
            String command = line.substring(1).trim();
            if (!command.isEmpty()) {
               connection.method_45730(command);
            }
         } else {
            connection.method_45729(line);
         }

         this.lastChat = System.currentTimeMillis();
      }
   }

   // ------------------------------------------------------------------ look

   private void turn(float yaw, float pitch) {
      this.yawNow += yaw;
      this.pitchNow += pitch;
   }

   /** Whatever of last tick's turn the frames did not get to, then a fresh tick. */
   private void flushLook(class_310 client) {
      if (client.field_1724 != null) {
         this.look(client.field_1724, this.yawNow - this.yawDone, this.pitchNow - this.pitchDone);
      }

      this.yawNow = this.pitchNow = this.yawDone = this.pitchDone = 0.0F;
      this.tickNanos = System.nanoTime();
   }

   /**
    * Every frame: notes a hotkey pressed since the last tick, so a quick tap
    * between two ticks still counts when the game runs slowly; and spreads a
    * recorded turn over the frames of its tick, so it plays back as smoothly as
    * it was made.
    */
   @Override
   public void frame(class_310 client) {
      if (recording == null && this.isEnabled() && Screens.current(client) == null) {
         if (!this.stopWasDown && this.stopKey.isDown()) {
            this.stopLatched = true;
         }

         for (HotkeysModule.Hotkey hotkey : all()) {
            if (hotkey.enabled && !hotkey.wasDown && hotkey.bound().isDown()) {
               hotkey.latched = true;
            }
         }
      }

      if ((this.yawNow != 0.0F || this.pitchNow != 0.0F) && client.field_1724 != null) {
         float t = Math.min(1.0F, (float)(System.nanoTime() - this.tickNanos) / 5.0E7F);
         float yaw = this.yawNow * t;
         float pitch = this.pitchNow * t;
         this.look(client.field_1724, yaw - this.yawDone, pitch - this.pitchDone);
         this.yawDone = yaw;
         this.pitchDone = pitch;
      }
   }

   private void look(class_746 player, float yaw, float pitch) {
      if (yaw != 0.0F || pitch != 0.0F) {
         player.method_5872(yaw / 0.15, pitch / 0.15);
      }
   }

   // ------------------------------------------------------------- recording

   public static boolean recording() {
      return recording != null;
   }

   /**
    * Starts recording once the menu is closed. The recording ends when any
    * screen opens (Esc) and becomes a Movement action of the hotkey — in place
    * of {@code replacing} when that is given — and then {@code back} opens again.
    */
   public static void startRecording(class_310 client, HotkeysModule.Hotkey hotkey, HotkeysModule.Step replacing, class_437 back) {
      if (active != null) {
         active.stopAll(client, false);
      }

      recording = new HotkeysModule.Recording(hotkey, replacing, back);
      Screens.open(client, null);
   }

   private void record(class_310 client, class_746 player) {
      HotkeysModule.Recording rec = recording;
      if (Screens.current(client) != null) {
         if (rec.started) {
            this.finishRecording(client, player, rec);
         }
      } else {
         float yaw = player.method_36454();
         float pitch = player.method_36455();
         if (!rec.started) {
            rec.started = true;
            rec.lastYaw = yaw;
            rec.lastPitch = pitch;
         }

         class_304[] keys = moveKeys(client.field_1690);
         int mask = 0;

         for (int i = 0; i < keys.length; i++) {
            if (keys[i].method_1434()) {
               mask |= 1 << i;
            }
         }

         int slot = slot(player);
         rec.frames.add(new HotkeysModule.Frame(mask, slot, wrap(yaw - rec.lastYaw), pitch - rec.lastPitch));
         rec.lastYaw = yaw;
         rec.lastPitch = pitch;
         if (rec.frames.size() % 10 == 1) {
            Tell.bar(
               player,
               class_2561.method_43470("● Recording ")
                  .method_27692(class_124.field_1061)
                  .method_10852(class_2561.method_43470(seconds(rec.frames.size())).method_27692(class_124.field_1068))
                  .method_10852(class_2561.method_43470(" — press Esc to stop").method_27692(class_124.field_1080))
            );
         }

         if (rec.frames.size() >= MAX_RECORDING) {
            this.finishRecording(client, player, rec);
         }
      }
   }

   private void finishRecording(class_310 client, class_746 player, HotkeysModule.Recording rec) {
      recording = null;
      List<HotkeysModule.Frame> frames = rec.frames;
      int first = 0;

      while (first < frames.size() && frames.get(first).idle()) {
         first++;
      }

      int last = frames.size();

      while (last > first && frames.get(last - 1).idle()) {
         last--;
      }

      if (last <= first) {
         Tell.bar(player, class_2561.method_43470("Nothing was recorded").method_27692(class_124.field_1061));
      } else {
         List<HotkeysModule.Frame> kept = new ArrayList<>(frames.subList(first, last));
         HotkeysModule.Step step = rec.replacing != null && rec.hotkey.steps.contains(rec.replacing) ? rec.replacing : new HotkeysModule.Step();
         step.type = MOVES;
         step.setFrames(kept);
         if (!rec.hotkey.steps.contains(step)) {
            rec.hotkey.steps.add(step);
         }

         saveStore();
         Tell.bar(player, class_2561.method_43470("■ Recorded " + seconds(kept.size()) + " of movement").method_27692(class_124.field_1060));
      }

      if (rec.back != null) {
         Screens.open(client, rec.back);
      }
   }

   private static float wrap(float degrees) {
      float d = degrees % 360.0F;
      if (d >= 180.0F) {
         d -= 360.0F;
      }

      if (d < -180.0F) {
         d += 360.0F;
      }

      return d;
   }

   public static String seconds(int ticks) {
      String text = String.format(Locale.ROOT, "%.2f", ticks / 20.0F);
      text = text.replaceAll("0+$", "").replaceAll("\\.$", "");
      return text + " s";
   }

   // ----------------------------------------------------------------- model

   public static final class Hotkey {
      public String name = "Hotkey";
      public String key = "";
      public boolean enabled = true;
      public String mode = ONCE;
      /** How many times a loop runs; 0 is until the key is pressed again. */
      public int loops = 0;
      /** Ticks between one pass through the actions and the next. */
      public int gap = 0;
      public List<HotkeysModule.Step> steps = new ArrayList<>();
      transient boolean wasDown;
      transient boolean latched;
      private transient Setting.Key bound;
      private transient class_304 trigger;

      void clean() {
         if (this.name == null || this.name.isBlank()) {
            this.name = "Hotkey";
         }

         if (!MODES.contains(this.mode)) {
            this.mode = ONCE;
         }

         this.loops = Math.max(0, this.loops);
         this.gap = Math.max(0, this.gap);
         if (this.steps == null) {
            this.steps = new ArrayList<>();
         }

         this.steps.removeIf(step -> step == null || !step.clean());
      }

      public Setting.Key bound() {
         if (this.bound == null) {
            this.bound = keyNamed(this.key);
         }

         return this.bound;
      }

      public void setKey(class_3675.class_306 next) {
         this.key = next == null || next.equals(unbound()) ? "" : next.method_1441();
         this.bound = null;
         this.syncTrigger();
      }

      /**
       * A key mapping of the hotkey's own, kept out of Controls and options.txt,
       * so the game's key events reach the hotkey: a tap too quick for a tick to
       * see down still counts, as it does for the game's own keys.
       */
      class_304 trigger() {
         if (this.trigger == null) {
            this.trigger = new class_304("key.blueclient.hotkey." + ++serial, Keys.keyboard(), UNBOUND, Keys.CATEGORY);
            this.syncTrigger();
         }

         return this.trigger;
      }

      void syncTrigger() {
         if (this.trigger != null) {
            class_3675.class_306 want = this.bound().get();
            if (!SHARED_KEYS && boundTo(class_310.method_1551(), want) != null) {
               want = unbound();
            }

            if (!want.equals(Keys.bound(this.trigger))) {
               this.trigger.method_1422(want);
               class_304.method_1426();
            }
         }
      }

      int clicks() {
         int clicks = 0;

         while (this.trigger().method_1436()) {
            clicks++;
         }

         return clicks;
      }

      public class_2561 keyLabel() {
         return this.bound().isUnbound() ? class_2561.method_43470("No key").method_27692(class_124.field_1080) : this.bound().display();
      }

      /** Whether a run takes longer than the tick it starts on (worth saying it started and stopped). */
      public boolean lasts() {
         if (!ONCE.equals(this.mode)) {
            return true;
         } else {
            for (HotkeysModule.Step step : this.steps) {
               if (step.ticks() > 1) {
                  return true;
               }
            }

            return false;
         }
      }

      public static class_2561 modeLabel(String mode) {
         return class_2561.method_43470(LOOP.equals(mode) ? "Loop" : (HOLD.equals(mode) ? "While held" : "Once"));
      }

      public String modeNote() {
         if (LOOP.equals(this.mode)) {
            return this.loops > 0
               ? "Loop: runs " + this.loops + " times, or until you press the key again"
               : "Loop: press the key to start, press it again to stop";
         } else {
            return HOLD.equals(this.mode) ? "While held: repeats for as long as you hold the key" : "Once: runs its actions one time per press";
         }
      }
   }

   public static final class Step {
      public String type = CHAT;
      /** A chat line, or a command when it starts with "/". */
      public String text = "";
      /** The key mapping a key press presses (its name, as in options.txt). */
      public String mapping = "key.jump";
      /** How long a key is held or a wait lasts. */
      public int length = 1;
      /** Whether a recording turns the camera the way it was turned. */
      public boolean look = true;
      /** A recording: "mask,slot,yaw,pitch[,repeat]" per tick, ";" between. */
      public String frames = "";
      private transient List<HotkeysModule.Frame> decoded;

      public static HotkeysModule.Step of(String type) {
         HotkeysModule.Step step = new HotkeysModule.Step();
         step.type = type;
         step.length = WAIT.equals(type) ? 20 : 1;
         return step;
      }

      boolean clean() {
         if (this.type == null) {
            return false;
         } else {
            if (this.text == null) {
               this.text = "";
            }

            if (this.frames == null) {
               this.frames = "";
            }

            this.length = Math.max(PRESS.equals(this.type) ? 1 : 0, this.length);
            return switch (this.type) {
               case CHAT -> !this.text.isBlank();
               case PRESS -> this.mapping != null;
               case WAIT -> true;
               case MOVES -> !this.decode().isEmpty();
               default -> false;
            };
         }
      }

      public int ticks() {
         return MOVES.equals(this.type) ? this.decode().size() : (CHAT.equals(this.type) ? 0 : this.length);
      }

      public class_2561 label() {
         return switch (this.type) {
            case CHAT -> this.text.trim().startsWith("/")
               ? class_2561.method_43470("Command: ").method_10852(class_2561.method_43470(this.text.trim()).method_27692(class_124.field_1075))
               : class_2561.method_43470("Say: ").method_10852(class_2561.method_43470(this.text.trim()).method_27692(class_124.field_1068));
            case PRESS -> class_2561.method_43470("Press: ")
               .method_10852(mappingName(this.mapping).method_27661().method_27692(class_124.field_1054))
               .method_10852(class_2561.method_43470(this.length > 1 ? " for " + seconds(this.length) : "").method_27692(class_124.field_1080));
            case WAIT -> class_2561.method_43470("Wait ").method_10852(class_2561.method_43470(seconds(this.length)).method_27692(class_124.field_1080));
            default -> class_2561.method_43470("Movement: ")
               .method_10852(class_2561.method_43470(seconds(this.decode().size())).method_27692(class_124.field_1076))
               .method_10852(class_2561.method_43470(this.look ? " with camera" : "").method_27692(class_124.field_1080));
         };
      }

      List<HotkeysModule.Frame> decode() {
         if (this.decoded == null) {
            List<HotkeysModule.Frame> out = new ArrayList<>();
            String all = this.frames == null ? "" : this.frames;

            for (String part : all.split(";")) {
               String[] bits = part.split(",");
               if (bits.length >= 4) {
                  try {
                     HotkeysModule.Frame frame = new HotkeysModule.Frame(
                        Integer.parseInt(bits[0].trim()),
                        Math.max(0, Math.min(8, Integer.parseInt(bits[1].trim()))),
                        Float.parseFloat(bits[2].trim()),
                        Float.parseFloat(bits[3].trim())
                     );
                     int repeat = bits.length >= 5 ? Math.max(1, Math.min(MAX_RECORDING, Integer.parseInt(bits[4].trim()))) : 1;

                     for (int i = 0; i < repeat && out.size() < MAX_RECORDING; i++) {
                        out.add(frame);
                     }
                  } catch (NumberFormatException ignored) {
                  }
               }
            }

            this.decoded = out;
         }

         return this.decoded;
      }

      void setFrames(List<HotkeysModule.Frame> list) {
         List<String> out = new ArrayList<>();
         int i = 0;

         while (i < list.size()) {
            HotkeysModule.Frame frame = list.get(i);
            int repeat = 1;

            while (i + repeat < list.size() && list.get(i + repeat).sameAs(frame)) {
               repeat++;
            }

            out.add(frame.mask + "," + frame.slot + "," + round(frame.yaw) + "," + round(frame.pitch) + (repeat > 1 ? "," + repeat : ""));
            i += repeat;
         }

         this.frames = String.join(";", out);
         this.decoded = null;
      }

      private static String round(float value) {
         String text = String.format(Locale.ROOT, "%.3f", value);
         text = text.replaceAll("0+$", "").replaceAll("\\.$", "");
         return text.equals("-0") ? "0" : text;
      }
   }

   record Frame(int mask, int slot, float yaw, float pitch) {
      /** Nothing pressed and no turn; sprint alone does not count, as Toggle Sprint holds it down all the time. */
      boolean idle() {
         return (this.mask & ~SPRINT_BIT) == 0 && this.yaw == 0.0F && this.pitch == 0.0F;
      }

      boolean sameAs(HotkeysModule.Frame other) {
         return this.mask == other.mask && this.slot == other.slot && this.yaw == other.yaw && this.pitch == other.pitch;
      }
   }

   private static final class Recording {
      final HotkeysModule.Hotkey hotkey;
      final HotkeysModule.Step replacing;
      final class_437 back;
      final List<HotkeysModule.Frame> frames = new ArrayList<>();
      boolean started;
      float lastYaw;
      float lastPitch;

      Recording(HotkeysModule.Hotkey hotkey, HotkeysModule.Step replacing, class_437 back) {
         this.hotkey = hotkey;
         this.replacing = replacing;
         this.back = back;
      }
   }

   /** One hotkey being played: which action, how far into it, how many passes done. */
   private static final class Run {
      final HotkeysModule.Hotkey hotkey;
      int step;
      int at;
      int passes;
      int gap;
      int lastMask;
      int lastSlot = -1;

      Run(HotkeysModule.Hotkey hotkey) {
         this.hotkey = hotkey;
      }

      private void next() {
         this.step++;
         this.at = 0;
         this.lastMask = 0;
         this.lastSlot = -1;
      }

      /** One tick of this run; false once it is over. */
      boolean advance(class_310 client, class_746 player, HotkeysModule module) {
         List<HotkeysModule.Step> steps = this.hotkey.steps;

         for (int instant = 0; instant < INSTANT_PER_TICK; instant++) {
            if (this.gap > 0) {
               this.gap--;
               return true;
            }

            if (this.step >= steps.size()) {
               this.passes++;
               boolean again = switch (this.hotkey.mode) {
                  case LOOP -> this.hotkey.loops <= 0 || this.passes < this.hotkey.loops;
                  case HOLD -> true;
                  default -> false;
               };
               if (!again || steps.isEmpty()) {
                  return false;
               }

               this.step = 0;
               this.at = 0;
               this.lastMask = 0;
               this.lastSlot = -1;
               this.gap = Math.max(1, this.hotkey.gap);
               continue;
            }

            HotkeysModule.Step step = steps.get(this.step);
            switch (step.type) {
               case CHAT:
                  if (!module.chatReady()) {
                     return true;
                  }

                  module.send(client, step.text);
                  this.next();
                  break;
               case PRESS:
                  class_304 mapping = mapping(client, step.mapping);
                  if (mapping == null) {
                     this.next();
                     break;
                  }

                  if (this.at == 0) {
                     module.clicks.add(mapping);
                  }

                  module.wanted.add(mapping);
                  if (++this.at >= Math.max(1, step.length)) {
                     this.next();
                  }

                  return true;
               case WAIT:
                  if (this.at >= step.length) {
                     this.next();
                     break;
                  }

                  if (++this.at >= step.length) {
                     this.next();
                  }

                  return true;
               case MOVES:
                  List<HotkeysModule.Frame> frames = step.decode();
                  if (this.at >= frames.size()) {
                     this.next();
                     break;
                  }

                  HotkeysModule.Frame frame = frames.get(this.at++);
                  class_304[] keys = moveKeys(client.field_1690);

                  for (int i = 0; i < keys.length; i++) {
                     if ((frame.mask() & 1 << i) != 0) {
                        module.wanted.add(keys[i]);
                        if ((this.lastMask & 1 << i) == 0) {
                           module.clicks.add(keys[i]);
                        }
                     }
                  }

                  this.lastMask = frame.mask();
                  if (frame.slot() != this.lastSlot) {
                     if (frame.slot() != slot(player)) {
                        select(player, frame.slot());
                     }

                     this.lastSlot = frame.slot();
                  }

                  if (step.look) {
                     module.turn(frame.yaw(), frame.pitch());
                  }

                  if (this.at >= frames.size()) {
                     this.next();
                  }

                  return true;
               default:
                  this.next();
            }
         }

         return true;
      }
   }
}
