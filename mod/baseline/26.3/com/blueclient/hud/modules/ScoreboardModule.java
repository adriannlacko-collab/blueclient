package com.blueclient.hud.modules;

import com.blueclient.hud.Anchor;
import com.blueclient.hud.Category;
import com.blueclient.hud.Module;
import com.blueclient.ui.Icon;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.numbers.NumberFormat;
import net.minecraft.network.chat.numbers.StyledFormat;
import net.minecraft.world.level.Level;
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

   public ScoreboardModule() {
      super("scoreboard", "Scoreboard", "The server's sidebar, and where it sits", Category.VISUAL, Icon.SERVER, Anchor.TOP_RIGHT, true);
      active = this;
   }

   public static ScoreboardModule get() {
      return active;
   }

   public void nowDrawing(Objective objective) {
      this.drawing = objective;
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
      return this.objective() != null;
   }

   private boolean measure(Minecraft client) {
      Objective objective = this.objective();
      if (objective == null) {
         return false;
      } else {
         Level level = client.level;
         if (!this.measuredStale && objective == this.measured && level == this.measuredIn) {
            return true;
         } else {
            Font font = client.font;
            int widest = font.width(objective.getDisplayName());
            int rows = 0;
            if (level != null) {
               Scoreboard board = level.getScoreboard();
               NumberFormat format = objective.numberFormatOrDefault(StyledFormat.SIDEBAR_DEFAULT);
               int gap = font.width(": ");

               for (PlayerScoreEntry entry : board.listPlayerScores(objective)) {
                  if (!entry.isHidden()) {
                     if (rows >= 15) {
                        break;
                     }

                     rows++;
                     PlayerTeam team = board.getPlayersTeam(entry.owner());
                     Component name = PlayerTeam.formatNameForTeam(team, entry.ownerName());
                     int score = font.width(entry.formatValue(format));
                     widest = Math.max(widest, font.width(name) + (score > 0 ? gap + score : 0));
                  }
               }
            }

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
   public int width(Minecraft client) {
      return this.measure(client) ? this.widest + 4 : 0;
   }

   @Override
   public int height(Minecraft client) {
      return this.measure(client) ? this.rows * 9 + 10 : 0;
   }

   @Override
   public int[] vanillaPlace(Minecraft client) {
      if (!this.measure(client)) {
         return null;
      } else {
         int screenW = client.getWindow().getGuiScaledWidth();
         int screenH = client.getWindow().getGuiScaledHeight();
         this.home[0] = screenW - (this.widest + 4) - 5 + 4;
         this.home[1] = screenH / 2 - this.rows * 9 / 2 - 10;
         return this.home;
      }
   }

   @Override
   public void render(GuiGraphicsExtractor ctx, Minecraft client, int x, int y) {
   }
}
