package com.blueclient.hud.modules;

import com.blueclient.hud.Anchor;
import com.blueclient.hud.Category;
import com.blueclient.hud.Module;
import com.blueclient.ui.Icon;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import net.minecraft.class_1937;
import net.minecraft.class_2561;
import net.minecraft.class_266;
import net.minecraft.class_268;
import net.minecraft.class_269;
import net.minecraft.class_310;
import net.minecraft.class_327;
import net.minecraft.class_332;
import net.minecraft.class_642;
import net.minecraft.class_8646;
import net.minecraft.class_9011;
import net.minecraft.class_9022;
import net.minecraft.class_9025;

public class ScoreboardModule extends Module {
   private static final int MAX_ROWS = 15;
   private static final int PADDING = 4;
   private static final int TITLE = 10;
   private static final int EDGE = 5;
   private static ScoreboardModule active;
   private class_266 drawing;
   private class_266 lastFrame;
   private class_266 measured;
   private class_1937 measuredIn;
   private boolean measuredStale = true;
   private int widest;
   private int rows;
   private final int[] home = new int[2];
   private final List<class_9011> rowsSeen = new ArrayList<>();
   private static final Comparator<class_9011> SIDEBAR_ORDER = Comparator.comparingInt(class_9011::comp_2128)
      .reversed()
      .thenComparing(class_9011::comp_2127, String.CASE_INSENSITIVE_ORDER);
   // A board with lines switched off on the Scoreboard page is drawn by render() rather than
   // by the game: what it draws, as of the last measure.
   private ScoreboardLines.Board custom;
   private int measuredFor = -1;
   private boolean titleShown = true;
   private int top = 10;
   private class_2561 title;
   private int titleWidth;
   private final List<class_2561> names = new ArrayList<>();
   private final List<class_2561> scores = new ArrayList<>();
   private final int[] scoreWidths = new int[15];
   private boolean vetoVanilla;

   public ScoreboardModule() {
      super("scoreboard", "Scoreboard", "The server's sidebar, and where it sits", Category.VISUAL, Icon.SERVER, Anchor.TOP_RIGHT, true);
      active = this;
   }

   public static ScoreboardModule get() {
      return active;
   }

   public void nowDrawing(class_266 objective) {
      this.drawing = objective;
      // ScoreboardMixin asks isEnabled() right after this and cancels the game's own sidebar
      // when it is false: that is how a board this module draws itself replaces it.
      this.vetoVanilla = super.isEnabled() && this.measure(class_310.method_1551()) && this.custom != null;
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
   public boolean drawsItself(class_310 client) {
      return this.measure(client) && this.custom != null;
   }

   @Override
   public void tick(class_310 client) {
      this.measuredStale = true;
   }

   @Override
   public void frame(class_310 client) {
      this.lastFrame = this.drawing;
      this.drawing = null;
   }

   @Override
   public boolean wantsFrame() {
      return true;
   }

   private class_266 objective() {
      return this.drawing != null ? this.drawing : this.lastFrame;
   }

   @Override
   public boolean isVisible(class_310 client) {
      return this.measure(client) && (this.titleShown || this.rows > 0);
   }

   private boolean measure(class_310 client) {
      class_266 objective = this.objective();
      if (objective == null) {
         return false;
      } else {
         class_1937 level = client.field_1687;
         int generation = ScoreboardLines.generation();
         if (!this.measuredStale && objective == this.measured && level == this.measuredIn && generation == this.measuredFor) {
            return true;
         } else {
            class_327 font = client.field_1772;
            ScoreboardLines.Board custom = ScoreboardLines.find(server(client), objective.method_1113());
            if (custom != null && !custom.customised()) {
               custom = null;
            }

            boolean titleShown = custom == null || !custom.hideTitle;
            boolean numbers = custom == null || !custom.hideNumbers;
            class_2561 title = objective.method_1114();
            int titleWidth = font.method_27525(title);
            int widest = titleShown ? titleWidth : 0;
            int rows = 0;
            this.names.clear();
            this.scores.clear();
            if (level != null) {
               class_269 board = level.method_8428();
               class_9022 format = objective.method_55380(class_9025.field_47567);
               int gap = font.method_1727(": ");

               List<class_9011> seen = this.rowsSeen;
               seen.clear();

               for (class_9011 entry : board.method_1184(objective)) {
                  if (!entry.method_55385()) {
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
                  class_9011 entry = seen.get(i);
                  if (custom == null || !custom.hides(entry.comp_2127())) {
                     class_268 team = board.method_1164(entry.comp_2127());
                     class_2561 name = class_268.method_1142(team, entry.method_55387());
                     class_2561 value = numbers ? entry.method_55386(format) : null;
                     int score = value == null ? 0 : font.method_27525(value);
                     widest = Math.max(widest, font.method_27525(name) + (score > 0 ? gap + score : 0));
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
   public int width(class_310 client) {
      return this.measure(client) ? this.widest + 4 : 0;
   }

   @Override
   public int height(class_310 client) {
      return this.measure(client) ? this.rows * 9 + this.top : 0;
   }

   @Override
   public int[] vanillaPlace(class_310 client) {
      if (!this.measure(client)) {
         return null;
      } else {
         int screenW = client.method_22683().method_4486();
         int screenH = client.method_22683().method_4502();
         this.home[0] = screenW - (this.widest + 4) - 5 + 4;
         this.home[1] = screenH / 2 + this.rows * 9 / 3 - this.rows * 9 - this.top;
         return this.home;
      }
   }

   @Override
   public void render(class_332 ctx, class_310 client, int x, int y) {
      // Only a board with lines switched off is drawn here, the way the game draws its own
      // (Hud.displayScoreboardSidebar); any other is the game's, moved by ScoreboardMixin.
      if (this.measure(client) && this.custom != null) {
         class_327 font = client.field_1772;
         int left = x + 2;
         int right = x + this.widest + 4;
         int bottom = y + this.rows * 9 + this.top;
         if (this.titleShown) {
            ctx.method_25294(x, y, right, y + 9, client.field_1690.method_19345(0.4F));
            ctx.method_51439(font, this.title, left + this.widest / 2 - this.titleWidth / 2, y + 1, -1, false);
         }

         ctx.method_25294(x, y + this.top - 1, right, bottom, client.field_1690.method_19345(0.3F));

         for (int i = 0; i < this.rows; i++) {
            int rowY = y + this.top + i * 9;
            ctx.method_51439(font, this.names.get(i), left, rowY, -1, false);
            class_2561 value = this.scores.get(i);
            if (value != null) {
               ctx.method_51439(font, value, right - this.scoreWidths[i], rowY, -1, false);
            }
         }
      }
   }

   // ------------------------------------------------------------ the Scoreboard page

   /** One line of the board on screen, switched off or not. */
   public static final class Line {
      public final String owner;
      public final class_2561 text;
      public final boolean shown;

      Line(String owner, class_2561 text, boolean shown) {
         this.owner = owner;
         this.text = text;
         this.shown = shown;
      }
   }

   /** Where lines are switched off: the server's address as typed, or "singleplayer". */
   public static String server(class_310 client) {
      class_642 server = client.method_1558();
      if (server != null && server.field_3761 != null && !server.field_3761.isBlank()) {
         return server.field_3761.trim().toLowerCase(Locale.ROOT);
      } else {
         return client.method_1496() ? "singleplayer" : "other";
      }
   }

   /** The board on screen now: the one the game last drew, else the sidebar's. */
   public class_266 showing(class_310 client) {
      class_266 objective = this.objective();
      if (objective == null && client.field_1687 != null) {
         objective = client.field_1687.method_8428().method_1189(class_8646.field_45157);
      }

      return objective;
   }

   /** The board's lines as the game lists them (at most fifteen), those switched off included. */
   public List<ScoreboardModule.Line> lines(class_310 client, class_266 objective) {
      List<ScoreboardModule.Line> out = new ArrayList<>();
      if (objective != null && client.field_1687 != null) {
         class_269 board = client.field_1687.method_8428();
         ScoreboardLines.Board custom = ScoreboardLines.find(server(client), objective.method_1113());
         List<class_9011> seen = new ArrayList<>();

         for (class_9011 entry : board.method_1184(objective)) {
            if (!entry.method_55385()) {
               seen.add(entry);
            }
         }

         seen.sort(SIDEBAR_ORDER);

         for (int i = 0; i < seen.size() && i < 15; i++) {
            class_9011 entry = seen.get(i);
            class_268 team = board.method_1164(entry.comp_2127());
            class_2561 name = class_268.method_1142(team, entry.method_55387());
            out.add(new ScoreboardModule.Line(entry.comp_2127(), name, custom == null || !custom.hides(entry.comp_2127())));
         }
      }

      return out;
   }
}
