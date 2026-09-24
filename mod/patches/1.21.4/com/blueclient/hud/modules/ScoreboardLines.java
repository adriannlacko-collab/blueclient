package com.blueclient.hud.modules;

import com.blueclient.BlueClient;
import com.blueclient.Disk;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;
import com.google.gson.reflect.TypeToken;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import net.fabricmc.loader.api.FabricLoader;

/**
 * The sidebar lines switched off on the Scoreboard page, per server and per board (the
 * objective's name), in config/blueclient-scoreboard.json. A line is known by its score
 * holder's name, not its text: servers keep the holder and change the text (a timer, a coin
 * count), so a line stays off while what it says changes.
 */
public final class ScoreboardLines {
   private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
   private static final Map<String, Map<String, ScoreboardLines.Board>> SERVERS = new LinkedHashMap<>();
   private static boolean loaded;
   private static int generation;

   private ScoreboardLines() {
   }

   public static final class Board {
      public List<String> hidden = new ArrayList<>();
      public boolean hideTitle;
      public boolean hideNumbers;

      public boolean customised() {
         return this.hideTitle || this.hideNumbers || !this.hidden.isEmpty();
      }

      public boolean hides(String owner) {
         return this.hidden.contains(owner);
      }

      public void toggle(String owner) {
         if (!this.hidden.remove(owner)) {
            this.hidden.add(owner);
         }
      }

      void clean() {
         if (this.hidden == null) {
            this.hidden = new ArrayList<>();
         }

         this.hidden.removeIf(owner -> owner == null);
      }
   }

   /** Bumped on every change, so a board measured before it is measured again. */
   public static int generation() {
      return generation;
   }

   /** This board's settings on this server, or null when nothing on it was ever switched off. */
   public static ScoreboardLines.Board find(String server, String board) {
      ensureLoaded();
      Map<String, ScoreboardLines.Board> boards = SERVERS.get(server);
      return boards == null ? null : boards.get(board);
   }

   /** This board's settings on this server, made if there are none yet; call {@link #changed} after changing them. */
   public static ScoreboardLines.Board edit(String server, String board) {
      ensureLoaded();
      return SERVERS.computeIfAbsent(server, key -> new LinkedHashMap<>()).computeIfAbsent(board, key -> new ScoreboardLines.Board());
   }

   /** Forgets everything switched off on this board: it is the server's own again. */
   public static void reset(String server, String board) {
      ensureLoaded();
      Map<String, ScoreboardLines.Board> boards = SERVERS.get(server);
      if (boards != null && boards.remove(board) != null) {
         if (boards.isEmpty()) {
            SERVERS.remove(server);
         }

         generation++;
         save();
      }
   }

   public static void changed(String server, String board) {
      ScoreboardLines.Board settings = find(server, board);
      if (settings != null && !settings.customised()) {
         reset(server, board);
      } else {
         generation++;
         save();
      }
   }

   private static Path file() {
      return FabricLoader.getInstance().getConfigDir().resolve("blueclient-scoreboard.json");
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
            if (root == null || !root.has("servers")) {
               return;
            }

            Map<String, Map<String, ScoreboardLines.Board>> read = GSON.fromJson(
               root.get("servers"), new TypeToken<Map<String, Map<String, ScoreboardLines.Board>>>() {}.getType()
            );
            if (read != null) {
               for (Map.Entry<String, Map<String, ScoreboardLines.Board>> server : read.entrySet()) {
                  if (server.getKey() != null && server.getValue() != null) {
                     for (Map.Entry<String, ScoreboardLines.Board> board : server.getValue().entrySet()) {
                        if (board.getKey() != null && board.getValue() != null) {
                           board.getValue().clean();
                           if (board.getValue().customised()) {
                              SERVERS.computeIfAbsent(server.getKey(), key -> new LinkedHashMap<>()).put(board.getKey(), board.getValue());
                           }
                        }
                     }
                  }
               }
            }
         } catch (Exception e) {
            BlueClient.LOGGER.warn("Could not read blueclient-scoreboard.json, showing every line", e);
         }
      }
   }

   private static void save() {
      try {
         JsonObject root = new JsonObject();
         root.add("servers", GSON.toJsonTree(SERVERS));
         Disk.write(file(), GSON.toJson(root));
      } catch (Exception e) {
         BlueClient.LOGGER.warn("Could not write blueclient-scoreboard.json", e);
      }
   }
}
