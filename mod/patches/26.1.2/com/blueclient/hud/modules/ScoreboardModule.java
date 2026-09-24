package com.blueclient.hud.modules;

import com.blueclient.hud.Anchor;
import com.blueclient.hud.Category;
import com.blueclient.hud.Module;
import com.blueclient.ui.Icon;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.numbers.NumberFormat;
import net.minecraft.network.chat.numbers.StyledFormat;
import net.minecraft.world.level.Level;
import net.minecraft.world.scores.DisplaySlot;
import net.minecraft.world.scores.Objective;
import net.minecraft.world.scores.PlayerScoreEntry;
import net.minecraft.world.scores.PlayerTeam;
import net.minecraft.world.scores.Scoreboard;

public class ScoreboardModule extends Module {
   private static final int MAX_ROWS = 15;
   private static final int PADDING = 4;
   private static final int TITLE = 10;
   private static final int EDGE = 5;
   private static ScoreboardModule active;
   private Objective drawing;
   private Objective lastFrame;
   private Objective measured;
   private Level measuredIn;
   private boolean measuredStale = true;
   private int widest;
   private int rows;
   private final int[] home = new int[2];
   private final List<PlayerScoreEntry> rowsSeen = new ArrayList<>();
   private static final Comparator<PlayerScoreEntry> SIDEBAR_ORDER = Comparator.comparingInt(PlayerScoreEntry::value)
      .reversed()
      .thenComparing(PlayerScoreEntry::owner, String.CASE_INSENSITIVE_ORDER);
   // A board with lines switched off on the Scoreboard page is drawn by render() rather than
   // by the game: what it draws, as of the last measure.
   private ScoreboardLines.Board custom;
   private int measuredFor = -1;
   private boolean titleShown = true;
   private int top = 10;
   private Component title;
   private int titleWidth;
   private final List<Component> names = new ArrayList<>();
   private final List<Component> scores = new ArrayList<>();
   private final int[] scoreWidths = new int[15];
   private boolean vetoVanilla;

   public ScoreboardModule() {
      super("scoreboard", "Scoreboard", "The server's sidebar, and where it sits", Category.VISUAL, Icon.SERVER, Anchor.TOP_RIGHT, true);
      active = this;
   }

   public static ScoreboardModule get() {
      return active;
   }

   public void nowDrawing(Objective objective) {
      this.drawing = objective;
      // ScoreboardMixin asks isEnabled() right after this and cancels the game's own sidebar
      // when it is false: that is how a board this module draws itself replaces it.
      this.vetoVanilla = super.isEnabled() && this.measure(Minecraft.getInstance()) && this.custom != null;
   }

   @Override
   public boolean isEnabled() {
      if (this.vetoVanilla) {
         this.vetoVanilla = false;
         return false;
      } else {
         return super.isEnabled();
      }
   }

   /** Whether the board on screen has lines switched off, so this module draws it and not the game. */
   public boolean drawsItself(Minecraft client) {
      return this.measure(client) && this.custom != null;
   }

   @Override
   public void tick(Minecraft client) {
      this.measuredStale = true;
   }

   @Override
   public void frame(Minecraft client) {
      this.lastFrame = this.drawing;
      this.drawing = null;
   }

   @Override
   public boolean wantsFrame() {
      return true;
   }

   private Objective objective() {
      return this.drawing != null ? this.drawing : this.lastFrame;
   }

   @Override
   public boolean isVisible(Minecraft client) {
      return this.measure(client) && (this.titleShown || this.rows > 0);
   }

   private boolean measure(Minecraft client) {
      Objective objective = this.objective();
      if (objective == null) {
         return false;
      } else {
         Level level = client.level;
         int generation = ScoreboardLines.generation();
         if (!this.measuredStale && objective == this.measured && level == this.measuredIn && generation == this.measuredFor) {
            return true;
         } else {
            Font font = client.font;
            ScoreboardLines.Board custom = ScoreboardLines.find(server(client), objective.getName());
            if (custom != null && !custom.customised()) {
               custom = null;
            }

            boolean titleShown = custom == null || !custom.hideTitle;
            boolean numbers = custom == null || !custom.hideNumbers;
            Component title = objective.getDisplayName();
            int titleWidth = font.width(title);
            int widest = titleShown ? titleWidth : 0;
            int rows = 0;
            this.names.clear();
            this.scores.clear();
            if (level != null) {
               Scoreboard board = level.getScoreboard();
               NumberFormat format = objective.numberFormatOrDefault(StyledFormat.SIDEBAR_DEFAULT);
               int gap = font.width(": ");

               List<PlayerScoreEntry> seen = this.rowsSeen;
               seen.clear();

               for (PlayerScoreEntry entry : board.listPlayerScores(objective)) {
                  if (!entry.isHidden()) {
                     seen.add(entry);
                  }
               }

               // The game draws the first fifteen by its own order (highest score
               // first, then name), so a board with more lines than that must be
               // measured on those same fifteen, not on the first fifteen found.
               // A board drawn here is drawn in that order, so it is always sorted.
               if (seen.size() > 15 || custom != null) {
                  seen.sort(SIDEBAR_ORDER);
               }

               for (int i = 0; i < seen.size() && i < 15; i++) {
                  PlayerScoreEntry entry = seen.get(i);
                  if (custom == null || !custom.hides(entry.owner())) {
                     PlayerTeam team = board.getPlayersTeam(entry.owner());
                     Component name = PlayerTeam.formatNameForTeam(team, entry.ownerName());
                     Component value = numbers ? entry.formatValue(format) : null;
                     int score = value == null ? 0 : font.width(value);
                     widest = Math.max(widest, font.width(name) + (score > 0 ? gap + score : 0));
                     if (custom != null) {
                        this.names.add(name);
                        this.scores.add(value);
                        this.scoreWidths[rows] = score;
                     }

                     rows++;
                  }
               }
            }

            this.rowsSeen.clear();
            this.custom = custom;
            this.titleShown = titleShown;
            this.top = titleShown ? 10 : 1;
            this.title = title;
            this.titleWidth = titleWidth;
            this.widest = widest;
            this.rows = rows;
            this.measured = objective;
            this.measuredIn = level;
            this.measuredFor = generation;
            this.measuredStale = false;
            return true;
         }
      }
   }

   @Override
   public int width(Minecraft client) {
      return this.measure(client) ? this.widest + 4 : 0;
   }

   @Override
   public int height(Minecraft client) {
      return this.measure(client) ? this.rows * 9 + this.top : 0;
   }

   @Override
   public int[] vanillaPlace(Minecraft client) {
      if (!this.measure(client)) {
         return null;
      } else {
         int screenW = client.getWindow().getGuiScaledWidth();
         int screenH = client.getWindow().getGuiScaledHeight();
         this.home[0] = screenW - (this.widest + 4) - 5 + 4;
         this.home[1] = screenH / 2 + this.rows * 9 / 3 - this.rows * 9 - this.top;
         return this.home;
      }
   }

   @Override
   public void render(GuiGraphicsExtractor ctx, Minecraft client, int x, int y) {
      // Only a board with lines switched off is drawn here, the way the game draws its own
      // (Hud.displayScoreboardSidebar); any other is the game's, moved by ScoreboardMixin.
      if (this.measure(client) && this.custom != null) {
         Font font = client.font;
         int left = x + 2;
         int right = x + this.widest + 4;
         int bottom = y + this.rows * 9 + this.top;
         if (this.titleShown) {
            ctx.fill(x, y, right, y + 9, client.options.getBackgroundColor(0.4F));
            ctx.text(font, this.title, left + this.widest / 2 - this.titleWidth / 2, y + 1, -1, false);
         }

         ctx.fill(x, y + this.top - 1, right, bottom, client.options.getBackgroundColor(0.3F));

         for (int i = 0; i < this.rows; i++) {
            int rowY = y + this.top + i * 9;
            ctx.text(font, this.names.get(i), left, rowY, -1, false);
            Component value = this.scores.get(i);
            if (value != null) {
               ctx.text(font, value, right - this.scoreWidths[i], rowY, -1, false);
            }
         }
      }
   }

   // ------------------------------------------------------------ the Scoreboard page

   /** One line of the board on screen, switched off or not. */
   public static final class Line {
      public final String owner;
      public final Component text;
      public final boolean shown;

      Line(String owner, Component text, boolean shown) {
         this.owner = owner;
         this.text = text;
         this.shown = shown;
      }
   }

   /** Where lines are switched off: the server's address as typed, or "singleplayer". */
   public static String server(Minecraft client) {
      ServerData server = client.getCurrentServer();
      if (server != null && server.ip != null && !server.ip.isBlank()) {
         return server.ip.trim().toLowerCase(Locale.ROOT);
      } else {
         return client.hasSingleplayerServer() ? "singleplayer" : "other";
      }
   }

   /** The board on screen now: the one the game last drew, else the sidebar's. */
   public Objective showing(Minecraft client) {
      Objective objective = this.objective();
      if (objective == null && client.level != null) {
         objective = client.level.getScoreboard().getDisplayObjective(DisplaySlot.SIDEBAR);
      }

      return objective;
   }

   /** The board's lines as the game lists them (at most fifteen), those switched off included. */
   public List<ScoreboardModule.Line> lines(Minecraft client, Objective objective) {
      List<ScoreboardModule.Line> out = new ArrayList<>();
      if (objective != null && client.level != null) {
         Scoreboard board = client.level.getScoreboard();
         ScoreboardLines.Board custom = ScoreboardLines.find(server(client), objective.getName());
         List<PlayerScoreEntry> seen = new ArrayList<>();

         for (PlayerScoreEntry entry : board.listPlayerScores(objective)) {
            if (!entry.isHidden()) {
               seen.add(entry);
            }
         }

         seen.sort(SIDEBAR_ORDER);

         for (int i = 0; i < seen.size() && i < 15; i++) {
            PlayerScoreEntry entry = seen.get(i);
            PlayerTeam team = board.getPlayersTeam(entry.owner());
            Component name = PlayerTeam.formatNameForTeam(team, entry.ownerName());
            out.add(new ScoreboardModule.Line(entry.owner(), name, custom == null || !custom.hides(entry.owner())));
         }
      }

      return out;
   }
}
