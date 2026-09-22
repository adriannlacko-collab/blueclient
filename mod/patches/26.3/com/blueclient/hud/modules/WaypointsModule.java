package com.blueclient.hud.modules;

import com.blueclient.BlueClient;
import com.blueclient.Config;
import com.blueclient.Disk;
import com.blueclient.hud.BehaviourModule;
import com.blueclient.hud.Category;
import com.blueclient.hud.Setting;
import com.blueclient.server.ServerWaypoints;
import com.blueclient.ui.Beams;
import com.blueclient.ui.Cameras;
import com.blueclient.ui.Dyes;
import com.blueclient.ui.Frame;
import com.blueclient.ui.Gui;
import com.blueclient.ui.Icon;
import com.blueclient.ui.Layers;
import com.blueclient.ui.Lines;
import com.blueclient.ui.Screens;
import com.blueclient.ui.Sight;
import com.blueclient.ui.Tell;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.mojang.blaze3d.vertex.PoseStack;
import it.unimi.dsi.fastutil.longs.Long2FloatOpenHashMap;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.world.item.DyeColor;
import net.minecraft.world.level.ClipContext;
import net.minecraft.world.level.ClipContext.Block;
import net.minecraft.world.level.ClipContext.Fluid;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;
import net.minecraft.world.phys.HitResult.Type;

public class WaypointsModule extends BehaviourModule {
   public static final String STYLE_BEAM = "beam";
   public static final String STYLE_BLOCK = "block";
   public static final String STYLE_NONE = "none";
   public static final List<String> STYLES = List.of("beam", "block", "none");
   private static final double HIGHLIGHT_RANGE = 128.0;
   private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
   private static final Map<String, List<WaypointsModule.Waypoint>> WORLDS = new LinkedHashMap<>();
   private static boolean loaded;
   private static WaypointsModule active;
   private final Setting.Bool showDistance = this.add(new Setting.Bool("distance", "Show distance", true));
   private final Setting.Bool throughWalls = this.add(new Setting.Bool("walls", "Show through blocks", true));
   private final Setting.Range size = this.add(new Setting.Range("size", "Waypoint size", 0, 200, 100, "%"));
   private final Setting.Choice defaultMark = this.add(new Setting.Choice("default", "New waypoint marker", 1, "Beacon beam", "Block outline", "Label only"));
   private final Setting.Bool deathpoint = this.add(new Setting.Bool("death", "Waypoint on death", true));
   private final Setting.Bool otherDimension = this.add(new Setting.Bool("otherdim", "Show in the other dimension", true));
   private final Setting.Key markKey = this.add(new Setting.Key("markkey", "Mark block key", 5).inControls("waypoint"));
   private boolean wasDead;
   private boolean markWasDown;
   private static final int[] PALETTE = new int[]{3, 14, 5, 4, 2, 1, 9, 10, 6, 11, 13, 0};
   private static Object keyOwner;
   private static String keyCached;
   private static Object dimensionOwner;
   private static String dimensionCached;
   private static final List<WaypointsModule.Waypoint> VISIBLE = new ArrayList<>();
   private static final List<WaypointsModule.Waypoint> TRANSLATED = new ArrayList<>();
   private static final String OVERWORLD = "minecraft:overworld";
   private static final String NETHER = "minecraft:the_nether";
   private static final List<WaypointsModule.Shown> SHOWING = new ArrayList<>();
   private static final List<WaypointsModule.Shown> HOLDERS = new ArrayList<>();
   private static final double PULL = 0.01;
   private static final double PULL_MAX = 0.5;
   private static final double SIGHT_RANGE = 192.0;
   private static final float SHARE = 0.0386F;
   private static final double NEAR = 12.0;
   private static final float FLOOR = 0.45F;
   private static final float SIZE_TAU = 0.06F;
   private static final Long2FloatOpenHashMap SIZE_EASED = new Long2FloatOpenHashMap();
   private static long lastLabelNanos;
   private static final float EDGE = 24.0F;
   private static final float[] AT = new float[2];
   private static final Comparator<WaypointsModule.Shown> FARTHEST_FIRST = (a, b) -> {
      Vec3 eye = Sight.eye();
      return Double.compare(range(b, eye), range(a, eye));
   };

   public static Component styleLabel(String style) {
      return Component.literal("block".equals(style) ? "Block outline" : ("none".equals(style) ? "Label only" : "Beacon beam"));
   }

   public WaypointsModule() {
      super("waypoints", "Waypoints", "Marks the places you saved so you can find them again", Category.GENERAL, Icon.WAYPOINT, true);
      active = this;
   }

   @Override
   public boolean listedInMenus() {
      return false;
   }

   public static WaypointsModule instance() {
      return active;
   }

   public static String defaultStyle() {
      return active == null ? "block" : STYLES.get(active.defaultMark.index());
   }

   @Override
   public void tick(Minecraft client) {
      if (client.player == null) {
         this.wasDead = false;
         this.markWasDown = false;
      } else {
         boolean dead = client.player.isDeadOrDying();
         if (dead && !this.wasDead && this.isEnabled() && this.deathpoint.get()) {
            markDeath(client);
         }

         this.wasDead = dead;
         boolean marking = this.isEnabled() && Screens.current(client) == null && this.markKey.isDown();
         if (marking && !this.markWasDown) {
            markLooking(client);
         }

         this.markWasDown = marking;
      }
   }

   private static void markDeath(Minecraft client) {
      List<WaypointsModule.Waypoint> points = current(client);
      WaypointsModule.Waypoint point = points.stream().filter(p -> "Last death".equals(p.name)).findFirst().orElse(null);
      if (point == null) {
         point = new WaypointsModule.Waypoint();
         point.name = "Last death";
         point.color = Dyes.indexOf(DyeColor.RED);
         point.setStyle("beam");
         points.add(point);
      }

      point.x = client.player.blockPosition().getX();
      point.y = client.player.blockPosition().getY();
      point.z = client.player.blockPosition().getZ();
      point.dimension = dimensionOf(client);
      WaypointsModule.Waypoint kept = point;
      points.removeIf(p -> p != kept && "Last death".equals(p.name));
      saveStore();
   }

   public static WaypointsModule.Waypoint place(Minecraft client, BlockPos pos) {
      return place(client, pos.getX(), pos.getY(), pos.getZ(), dimensionOf(client), null);
   }

   public static WaypointsModule.Waypoint place(Minecraft client, int x, int y, int z, String dimension, String name) {
      List<WaypointsModule.Waypoint> points = current(client);
      WaypointsModule.Waypoint point = new WaypointsModule.Waypoint();
      point.name = name != null && !name.isBlank() ? name.trim() : "Waypoint " + (points.size() + 1);
      point.x = x;
      point.y = y;
      point.z = z;
      point.color = PALETTE[points.size() % PALETTE.length];
      point.dimension = dimension != null && !dimension.isBlank() ? dimension : dimensionOf(client);
      point.setStyle(defaultStyle());
      points.add(point);
      saveStore();
      return point;
   }

   public static String share(WaypointsModule.Waypoint point) {
      String name = point.name == null ? "Waypoint" : point.name.replaceAll("[\\r\\n]", " ").trim();
      if (name.isEmpty()) {
         name = "Waypoint";
      }

      return name + ": " + point.x + " " + point.y + " " + point.z + " (" + dimensionWord(point.dimension) + ")";
   }

   public static String dimensionWord(String id) {
      String var1 = id == null ? "" : id;

      return switch (var1) {
         case "minecraft:overworld" -> "overworld";
         case "minecraft:the_nether" -> "nether";
         case "minecraft:the_end" -> "end";
         default -> id != null && !id.isBlank() ? id.substring(id.indexOf(58) + 1) : "overworld";
      };
   }

   public static String dimensionFromWord(String word, String fallback) {
      if (word == null) {
         return fallback;
      } else {
         String var2 = word.trim().toLowerCase(Locale.ROOT);

         return switch (var2) {
            case "overworld" -> "minecraft:overworld";
            case "nether", "the_nether" -> "minecraft:the_nether";
            case "end", "the_end" -> "minecraft:the_end";
            default -> fallback;
         };
      }
   }

   private static void markLooking(Minecraft client) {
      if (client.player != null && client.level != null) {
         if (client.hitResult instanceof BlockHitResult hit && hit.getType() == Type.BLOCK) {
            BlockPos pos = hit.getBlockPos();
            WaypointsModule.Waypoint point = place(client, pos);
            Tell.bar(
               client.player,
               Component.empty()
                  .append(Component.literal("■ ").withColor(rgb(point.color)))
                  .append(Component.literal(point.name + " · "))
                  .append(Component.literal(pos.getX() + ", " + pos.getY() + ", " + pos.getZ()).withStyle(ChatFormatting.GRAY))
            );
         } else {
            Tell.bar(client.player, Component.literal("Look at a block to mark it").withStyle(ChatFormatting.RED));
         }
      }
   }

   private static Path file() {
      Path own = Config.launcherPath("waypointsFile");
      return own != null ? own : FabricLoader.getInstance().getConfigDir().resolve("blueclient-waypoints.json");
   }

   private static void ensureLoaded() {
      if (!loaded) {
         loaded = true;

         try {
            Path path = file();
            if (!Files.exists(path)) {
               return;
            }

            JsonObject root = (JsonObject)GSON.fromJson(Files.readString(path), JsonObject.class);
            if (root == null) {
               return;
            }

            for (String key : root.keySet()) {
               if (root.get(key) instanceof JsonArray list) {
                  List<WaypointsModule.Waypoint> points = new ArrayList<>();

                  for (JsonElement entry : list) {
                     WaypointsModule.Waypoint point = (WaypointsModule.Waypoint)GSON.fromJson(entry, WaypointsModule.Waypoint.class);
                     if (point != null && point.name != null && point.dimension != null) {
                        point.color = Math.max(0, Math.min(15, point.color));
                        point.setStyle(point.style == null ? (point.highlight ? "block" : "beam") : point.style);
                        points.add(point);
                     }
                  }

                  WORLDS.put(key, points);
               }
            }
         } catch (Exception var9) {
            BlueClient.LOGGER.warn("Could not read blueclient-waypoints.json, starting empty", var9);
         }
      }
   }

   public static void saveStore() {
      try {
         JsonObject root = new JsonObject();
         WORLDS.forEach((key, points) -> {
            if (!points.isEmpty()) {
               root.add(key, GSON.toJsonTree(points));
            }
         });
         Disk.write(file(), GSON.toJson(root));
      } catch (Exception var1) {
         BlueClient.LOGGER.warn("Could not write blueclient-waypoints.json", var1);
      }
   }

   public static String worldKey(Minecraft client) {
      Object owner = client.getCurrentServer() != null ? client.getCurrentServer() : client.getSingleplayerServer();
      if (owner != null && owner == keyOwner && keyCached != null) {
         return keyCached;
      } else {
         String key = worldKeyOf(client);
         keyOwner = owner;
         keyCached = key;
         return key;
      }
   }

   private static String worldKeyOf(Minecraft client) {
      if (client.getCurrentServer() != null) {
         return "server:" + client.getCurrentServer().ip;
      } else {
         return client.getSingleplayerServer() != null ? "world:" + client.getSingleplayerServer().getWorldData().getLevelName() : "unknown";
      }
   }

   public static String worldLabel(Minecraft client) {
      if (client.getCurrentServer() != null) {
         return client.getCurrentServer().ip;
      } else {
         return client.getSingleplayerServer() != null ? client.getSingleplayerServer().getWorldData().getLevelName() : "this world";
      }
   }

   public static List<WaypointsModule.Waypoint> current(Minecraft client) {
      ensureLoaded();
      return WORLDS.computeIfAbsent(worldKey(client), key -> new ArrayList<>());
   }

   public static List<WaypointsModule.Waypoint> visibleHere(Minecraft client) {
      VISIBLE.clear();
      if (client.level == null) {
         return VISIBLE;
      } else {
         int translated = 0;
         List<WaypointsModule.Shown> here = shownHere(client, dimensionOf(client));

         for (int i = 0; i < here.size(); i++) {
            WaypointsModule.Shown shown = here.get(i);
            if (shown.suffix() == null) {
               VISIBLE.add(shown.point());
            } else {
               if (translated == TRANSLATED.size()) {
                  TRANSLATED.add(new WaypointsModule.Waypoint());
               }

               WaypointsModule.Waypoint copy = TRANSLATED.get(translated++);
               copy.name = shown.point().name;
               copy.x = shown.x();
               copy.y = shown.y();
               copy.z = shown.z();
               copy.color = shown.point().color;
               copy.dimension = dimensionOf(client);
               copy.visible = true;
               copy.setStyle("beam");
               VISIBLE.add(copy);
            }
         }

         return VISIBLE;
      }
   }

   private static WaypointsModule.Shown holder() {
      int i = SHOWING.size();
      if (i == HOLDERS.size()) {
         HOLDERS.add(new WaypointsModule.Shown());
      }

      return HOLDERS.get(i);
   }

   private static List<WaypointsModule.Shown> shownHere(Minecraft client, String dimension) {
      ensureLoaded();
      List<WaypointsModule.Waypoint> points = WORLDS.get(worldKey(client));
      if (points == null) {
         points = List.of();
      }

      boolean across = active != null && active.otherDimension.get();
      SHOWING.clear();

      for (int i = 0; i < points.size(); i++) {
         WaypointsModule.Waypoint point = points.get(i);
         if (point.visible) {
            if (dimension.equals(point.dimension)) {
               SHOWING.add(holder().set(point, point.x, point.y, point.z, null));
            } else if (across && "minecraft:the_nether".equals(dimension) && "minecraft:overworld".equals(point.dimension)) {
               SHOWING.add(holder().set(point, Math.floorDiv(point.x, 8), point.y, Math.floorDiv(point.z, 8), " (overworld)"));
            } else if (across && "minecraft:overworld".equals(dimension) && "minecraft:the_nether".equals(point.dimension)) {
               SHOWING.add(holder().set(point, point.x * 8, point.y, point.z * 8, " (nether)"));
            }
         }
      }

      List<WaypointsModule.Waypoint> served = ServerWaypoints.here(dimension);

      for (int ix = 0; ix < served.size(); ix++) {
         WaypointsModule.Waypoint point = served.get(ix);
         SHOWING.add(holder().set(point, point.x, point.y, point.z, null));
      }

      return SHOWING;
   }

   public static String dimensionOf(Minecraft client) {
      if (client.level == null) {
         return "minecraft:overworld";
      } else {
         Object owner = client.level.dimension();
         if (owner == dimensionOwner && dimensionCached != null) {
            return dimensionCached;
         } else {
            String id = client.level.dimension().identifier().toString();
            dimensionOwner = owner;
            dimensionCached = id;
            return id;
         }
      }
   }

   public static String dimensionLabel(String id) {
      return switch (id) {
         case "minecraft:overworld" -> "Overworld";
         case "minecraft:the_nether" -> "The Nether";
         case "minecraft:the_end" -> "The End";
         default -> id;
      };
   }

   public static int rgb(int color) {
      return Dyes.argb(Dyes.byIndex(color)) & 16777215;
   }

   public static String colorName(int color) {
      String[] words = Dyes.byIndex(color).getSerializedName().split("_");
      StringBuilder out = new StringBuilder();

      for (String word : words) {
         if (!out.isEmpty()) {
            out.append(' ');
         }

         out.append(Character.toUpperCase(word.charAt(0))).append(word.substring(1).toLowerCase(Locale.ROOT));
      }

      return out.toString();
   }

   public static boolean wantsMarks() {
      if (active != null && active.isEnabled()) {
         Minecraft client = Minecraft.getInstance();
         if (client.level != null && client.player != null) {
            ensureLoaded();
            List<WaypointsModule.Waypoint> points = WORLDS.get(worldKey(client));
            return points != null && !points.isEmpty() || ServerWaypoints.any();
         } else {
            return false;
         }
      } else {
         return false;
      }
   }

   private static boolean drawable(Frame frame) {
      if (active != null && active.isEnabled()) {
         Minecraft client = Minecraft.getInstance();
         if (frame.world() != null && client.player != null && frame.matrices() != null) {
            ensureLoaded();
            List<WaypointsModule.Waypoint> points = WORLDS.get(worldKey(client));
            return points != null && !points.isEmpty() || ServerWaypoints.any();
         } else {
            return false;
         }
      } else {
         return false;
      }
   }

   public static void renderMarks(Frame frame) {
      if (drawable(frame)) {
         ClientLevel world = frame.world();
         String dimension = dimensionOf(Minecraft.getInstance());
         Vec3 camera = Cameras.eye(frame.camera());
         float tickDelta = frame.tickDelta();
         List<WaypointsModule.Shown> shown = shownHere(Minecraft.getInstance(), dimension);

         for (int i = 0; i < shown.size(); i++) {
            WaypointsModule.Shown here = shown.get(i);
            if (!here.point().marksNothing()) {
               if (here.suffix() == null && here.point().marksBlock()) {
                  highlight(frame, frame.matrices(), camera, here.point());
               } else {
                  beam(frame, frame.matrices(), world, camera, here.x(), here.z(), here.point().color, tickDelta);
               }
            }
         }
      }
   }

   private static void highlight(Frame frame, PoseStack matrices, Vec3 camera, WaypointsModule.Waypoint point) {
      AABB box = point.box;
      if (box == null || box.minX != point.x || box.minY != point.y || box.minZ != point.z) {
         box = new AABB(point.x, point.y, point.z, point.x + 1, point.y + 1, point.z + 1);
         point.box = box;
      }

      double dx = point.x + 0.5 - camera.x;
      double dy = point.y + 0.5 - camera.y;
      double dz = point.z + 0.5 - camera.z;
      double distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (!(distance > 128.0)) {
         int rgb = rgb(point.color);
         float r = (rgb >> 16 & 0xFF) / 255.0F;
         float g = (rgb >> 8 & 0xFF) / 255.0F;
         float b = (rgb & 0xFF) / 255.0F;
         float pull = (float)(1.0 - Math.min(0.01, 0.5 / Math.max(distance, 1.0)));
         matrices.pushPose();
         matrices.scale(pull, pull, pull);
         matrices.translate(-camera.x, -camera.y, -camera.z);
         Lines.box(matrices, frame.consumers().getBuffer(Layers.lines()), box, r, g, b, 1.0F);
         matrices.popPose();
      }
   }

   private static double range(WaypointsModule.Shown shown, Vec3 eye) {
      double dx = shown.x() + 0.5 - eye.x;
      double dy = shown.y() + 1.0 - eye.y;
      double dz = shown.z() + 0.5 - eye.z;
      return dx * dx + dy * dy + dz * dz;
   }

   public static void renderLabels(GuiGraphicsExtractor ctx, Minecraft client) {
      if (wantsMarks() && Sight.valid()) {
         float size = active.size.get() / 100.0F;
         if (!(size <= 0.01F)) {
            Vec3 eye = Sight.eye();
            List<WaypointsModule.Shown> showing = shownHere(client, dimensionOf(client));
            if (!showing.isEmpty()) {
               long now = System.nanoTime();
               float dt = lastLabelNanos == 0L ? 0.0F : (float)(now - lastLabelNanos) / 1.0E9F;
               lastLabelNanos = now;
               float ease = dt <= 0.0F ? 1.0F : (float)(1.0 - Math.exp(-dt / 0.06F));
               if (SIZE_EASED.size() > 512) {
                  SIZE_EASED.clear();
               }

               showing.sort(FARTHEST_FIRST);

               for (int i = 0; i < showing.size(); i++) {
                  label(ctx, client, eye, showing.get(i), size, ease);
               }
            }
         }
      }
   }

   private static void beam(Frame frame, PoseStack matrices, ClientLevel world, Vec3 camera, int x, int z, int color, float tickDelta) {
      matrices.pushPose();
      matrices.translate(x - camera.x, world.getMinY() - camera.y, z - camera.z);
      Beams.render(matrices, frame.consumers(), tickDelta, world.getGameTime(), 0, world.getHeight(), Dyes.argb(Dyes.byIndex(color)));
      matrices.popPose();
   }

   private static void label(GuiGraphicsExtractor ctx, Minecraft client, Vec3 eye, WaypointsModule.Shown shown, float size, float ease) {
      WaypointsModule.Waypoint point = shown.point();
      Vec3 spot = shown.spot();
      int screenW = ctx.guiWidth();
      int screenH = ctx.guiHeight();
      if (Sight.project(spot, screenW, screenH, AT)) {
         if (active.throughWalls.get() || !blocked(client, eye, spot)) {
            double distance = eye.distanceTo(spot);
            float target = (float)Math.min(1.0, Math.max(0.45F, 12.0 / Math.max(distance, 0.01)));
            long sizeKey = BlockPos.asLong(shown.x(), shown.y(), shown.z());
            float held = SIZE_EASED.get(sizeKey);
            float near = Float.isNaN(held) ? target : held + (target - held) * ease;
            SIZE_EASED.put(sizeKey, near);
            Font font = client.font;
            float scale = size * near * screenH * 0.0386F / 9.0F;
            MutableComponent line = line(point, shown.suffix(), active.showDistance.get() ? Math.round(distance) : -1L);
            int width = point.labelWidth;
            if (width < 0 || point.labelFont != font) {
               width = font.width(line);
               point.labelWidth = width;
               point.labelFont = font;
            }

            float reach = (width / 2.0F + 2.0F) * scale;
            if (!(AT[0] + reach < 0.0F) && !(AT[0] - reach > screenW) && !(AT[1] + 24.0F < 0.0F) && !(AT[1] - 24.0F > screenH)) {
               double gui = client.getWindow().getGuiScale();
               float px = (float)(Math.round(AT[0] * gui) / gui);
               float py = (float)(Math.round(AT[1] * gui) / gui);
               Gui.push(ctx);
               Gui.move(ctx, px, py);
               Gui.scale(ctx, scale, scale);
               int x = -width / 2;
               int y = -(9 + 2);
               ctx.fill(x - 2, y - 1, x + width + 2, y + 9, 1711276032);
               ctx.text(font, line, x, y, -1, true);
               Gui.pop(ctx);
            }
         }
      }
   }

   private static MutableComponent line(WaypointsModule.Waypoint point, String suffix, long metres) {
      MutableComponent kept = point.label;
      if (kept != null && point.labelColor == point.color && point.labelName == point.name && point.labelSuffix == suffix && point.labelMetres == metres) {
         return kept;
      } else {
         MutableComponent line = Component.empty().append(Component.literal("■ ").withColor(rgb(point.color))).append(Component.literal(point.name));
         if (suffix != null) {
            line.append(Component.literal(suffix).withStyle(ChatFormatting.GRAY));
         }

         if (metres >= 0L) {
            line.append(Component.literal(" " + metres + "m").withStyle(ChatFormatting.GRAY));
         }

         point.label = line;
         point.labelColor = point.color;
         point.labelName = point.name;
         point.labelSuffix = suffix;
         point.labelMetres = metres;
         point.labelWidth = -1;
         return line;
      }
   }

   private static boolean blocked(Minecraft client, Vec3 eye, Vec3 spot) {
      return eye.distanceToSqr(spot) > 36864.0
         ? false
         : client.level.clip(new ClipContext(eye, spot, Block.VISUAL, Fluid.NONE, client.player)).getType() != Type.MISS;
   }

   static {
      SIZE_EASED.defaultReturnValue(Float.NaN);
   }

   private static final class Shown {
      private WaypointsModule.Waypoint point;
      private int x;
      private int y;
      private int z;
      private String suffix;
      private Vec3 spot;

      WaypointsModule.Shown set(WaypointsModule.Waypoint point, int x, int y, int z, String suffix) {
         if (this.spot == null || this.x != x || this.y != y || this.z != z) {
            this.spot = new Vec3(x + 0.5, y + 1.0, z + 0.5);
         }

         this.point = point;
         this.x = x;
         this.y = y;
         this.z = z;
         this.suffix = suffix;
         return this;
      }

      WaypointsModule.Waypoint point() {
         return this.point;
      }

      int x() {
         return this.x;
      }

      int y() {
         return this.y;
      }

      int z() {
         return this.z;
      }

      String suffix() {
         return this.suffix;
      }

      Vec3 spot() {
         return this.spot;
      }
   }

   public static final class Waypoint {
      public String name = "Waypoint";
      public int x;
      public int y;
      public int z;
      public int color = 3;
      public String dimension = "minecraft:overworld";
      public boolean visible = true;
      public String style = "beam";
      public boolean highlight = false;
      private transient MutableComponent label;
      private transient String labelName;
      private transient int labelColor = -1;
      private transient String labelSuffix;
      private transient long labelMetres = -1L;
      private transient int labelWidth = -1;
      private transient Object labelFont;
      private transient AABB box;

      public boolean marksBlock() {
         return "block".equals(this.style);
      }

      public boolean marksNothing() {
         return "none".equals(this.style);
      }

      public void setStyle(String next) {
         this.style = "block".equals(next) ? "block" : ("none".equals(next) ? "none" : "beam");
         this.highlight = this.marksBlock();
      }
   }
}
