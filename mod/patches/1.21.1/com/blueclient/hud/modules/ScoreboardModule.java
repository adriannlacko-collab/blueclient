package com.blueclient.hud.modules;

import com.blueclient.hud.Anchor;
import com.blueclient.hud.Category;
import com.blueclient.hud.Module;
import com.blueclient.ui.Icon;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import net.minecraft.class_1937;
import net.minecraft.class_2561;
import net.minecraft.class_266;
import net.minecraft.class_268;
import net.minecraft.class_269;
import net.minecraft.class_310;
import net.minecraft.class_327;
import net.minecraft.class_332;
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

   public ScoreboardModule() {
      super("scoreboard", "Scoreboard", "The server's sidebar, and where it sits", Category.VISUAL, Icon.SERVER, Anchor.TOP_RIGHT, true);
      active = this;
   }

   public static ScoreboardModule get() {
      return active;
   }

   public void nowDrawing(class_266 objective) {
      this.drawing = objective;
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
      return this.objective() != null;
   }

   private boolean measure(class_310 client) {
      class_266 objective = this.objective();
      if (objective == null) {
         return false;
      } else {
         class_1937 level = client.field_1687;
         if (!this.measuredStale && objective == this.measured && level == this.measuredIn) {
            return true;
         } else {
            class_327 font = client.field_1772;
            int widest = font.method_27525(objective.method_1114());
            int rows = 0;
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
               if (seen.size() > 15) {
                  seen.sort(SIDEBAR_ORDER);
               }

               for (int i = 0; i < seen.size() && i < 15; i++) {
                  class_9011 entry = seen.get(i);
                  {
                     rows++;
                     class_268 team = board.method_1164(entry.comp_2127());
                     class_2561 name = class_268.method_1142(team, entry.method_55387());
                     int score = font.method_27525(entry.method_55386(format));
                     widest = Math.max(widest, font.method_27525(name) + (score > 0 ? gap + score : 0));
                  }
               }
            }

            this.rowsSeen.clear();
            this.widest = widest;
            this.rows = rows;
            this.measured = objective;
            this.measuredIn = level;
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
      return this.measure(client) ? this.rows * 9 + 10 : 0;
   }

   @Override
   public int[] vanillaPlace(class_310 client) {
      if (!this.measure(client)) {
         return null;
      } else {
         int screenW = client.method_22683().method_4486();
         int screenH = client.method_22683().method_4502();
         this.home[0] = screenW - (this.widest + 4) - 5 + 4;
         this.home[1] = screenH / 2 + this.rows * 9 / 3 - this.rows * 9 - 10;
         return this.home;
      }
   }

   @Override
   public void render(class_332 ctx, class_310 client, int x, int y) {
   }
}
