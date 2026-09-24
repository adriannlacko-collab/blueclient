package com.blueclient.screen;

import com.blueclient.hud.modules.ScoreboardLines;
import com.blueclient.hud.modules.ScoreboardModule;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.class_124;
import net.minecraft.class_2561;
import net.minecraft.class_266;
import net.minecraft.class_4185;
import net.minecraft.class_437;
import net.minecraft.class_5244;
import net.minecraft.class_7919;

/**
 * The Scoreboard module's page: the sidebar on screen now, a row per line, each switched on or
 * off for this server; then the numbers on the right, Show all, and the module's own switch.
 */
public class ScoreboardLinesScreen extends VanillaScreen {
   private static final int GRID_W = 308;
   private static final int TAIL = 56;
   private static final int REFRESH_TICKS = 10;
   private String server;
   private String board;
   private class_2561 boardTitle;
   private List<ScoreboardModule.Line> lines = new ArrayList<>();
   private final List<class_4185> lineButtons = new ArrayList<>();
   private final List<ScoreboardModule.Line> buttonLines = new ArrayList<>();
   private int ticks;

   public ScoreboardLinesScreen(class_437 parent) {
      super(parent, class_2561.method_43470("Scoreboard"));
   }

   @Override
   protected boolean hasSearch() {
      return false;
   }

   @Override
   protected String searchHint() {
      return "";
   }

   @Override
   protected class_2561 footerLabel() {
      return class_5244.field_24339.method_27661().method_27692(class_124.field_1061);
   }

   @Override
   protected String subtitle() {
      ScoreboardModule module = ScoreboardModule.get();
      if (module != null && module.isHeldOff()) {
         return module.heldOffNote();
      } else if (module != null && !module.isEnabled()) {
         return "Scoreboard is off — nothing is drawn until it is on";
      } else if (this.board == null) {
         return "No scoreboard on screen — join a server that shows one";
      } else {
         int off = 0;

         for (ScoreboardModule.Line line : this.lines) {
            if (!line.shown) {
               off++;
            }
         }

         String where = this.server.equals("singleplayer") ? "in singleplayer" : "on " + this.server;
         String scroll = this.hasBar() ? " — scroll for more" : "";
         return off == 0
            ? "Click a line to hide it " + where + scroll
            : off + (off == 1 ? " line" : " lines") + " hidden " + where + scroll;
      }
   }

   /** Reads the board on screen again; true when its lines are not the ones the rows were made for. */
   private boolean refresh() {
      ScoreboardModule module = ScoreboardModule.get();
      class_266 objective = module == null ? null : module.showing(this.field_22787);
      String server = ScoreboardModule.server(this.field_22787);
      String board = objective == null ? null : objective.method_1113();
      List<ScoreboardModule.Line> lines = module == null ? new ArrayList<>() : module.lines(this.field_22787, objective);
      boolean moved = !server.equals(this.server) || !(board == null ? this.board == null : board.equals(this.board)) || lines.size() != this.lines.size();

      for (int i = 0; !moved && i < lines.size(); i++) {
         moved = !lines.get(i).owner.equals(this.lines.get(i).owner);
      }

      this.server = server;
      this.board = board;
      this.boardTitle = objective == null ? null : objective.method_1114();
      this.lines = lines;
      return moved;
   }

   @Override
   protected int content(int top) {
      this.blockWidth = GRID_W;
      this.blockLeft = (this.field_22789 - GRID_W) / 2;
      this.refresh();
      this.lineButtons.clear();
      this.buttonLines.clear();
      int y = top;
      if (this.board != null) {
         int total = this.lines.size() + 1;
         int offset = this.fitRows(top, total, TAIL);
         int last = Math.min(total, offset + this.rows);

         for (int i = offset; i < last; i++) {
            int rowY = top + (i - offset) * 24;
            if (i == 0) {
               this.addTitleRow(rowY);
            } else {
               this.addLineRow(this.lines.get(i - 1), rowY);
            }
         }

         y = top + Math.min(this.rows, total) * 24;
      }

      ScoreboardLines.Board settings = this.board == null ? null : ScoreboardLines.find(this.server, this.board);
      int third = (GRID_W - 16) / 3;
      class_4185 numbers = class_4185.method_46430(this.numbersLabel(settings), button -> {
         ScoreboardLines.Board edit = ScoreboardLines.edit(this.server, this.board);
         edit.hideNumbers = !edit.hideNumbers;
         ScoreboardLines.changed(this.server, this.board);
         button.method_25355(this.numbersLabel(ScoreboardLines.find(this.server, this.board)));
      }).method_46434(this.blockLeft, y, third, 20).method_46431();
      numbers.method_47400(class_7919.method_47407(class_2561.method_43470("The numbers on the right of each line")));
      numbers.field_22763 = this.board != null;
      this.method_37063(numbers);
      class_4185 showAll = class_4185.method_46430(class_2561.method_43470("Show all"), button -> {
         ScoreboardLines.reset(this.server, this.board);
         this.scheduleRebuild();
      }).method_46434(this.blockLeft + third + 8, y, third, 20).method_46431();
      showAll.method_47400(class_7919.method_47407(class_2561.method_43470("Every line, the title and the numbers back on, as the server sends them")));
      showAll.field_22763 = settings != null && settings.customised();
      this.method_37063(showAll);
      ScoreboardModule module = ScoreboardModule.get();
      class_4185 power = class_4185.method_46430(this.powerLabel(), button -> {
         if (module != null) {
            module.toggle();
            this.scheduleRebuild();
         }
      }).method_46434(this.blockLeft + (third + 8) * 2, y, GRID_W - (third + 8) * 2, 20).method_46431();
      power.method_47400(class_7919.method_47407(class_2561.method_43470("Off hides the whole sidebar. Move or resize it in Layout (F9)")));
      power.field_22763 = module != null && !module.isHeldOff();
      this.method_37063(power);
      return y + 24;
   }

   private void addTitleRow(int y) {
      ScoreboardLines.Board settings = ScoreboardLines.find(this.server, this.board);
      boolean shown = settings == null || !settings.hideTitle;
      class_4185 toggle = class_4185.method_46430(this.rowLabel(class_2561.method_43470("Title: ").method_27692(class_124.field_1080).method_10852(this.boardTitle), shown), button -> {
         ScoreboardLines.Board edit = ScoreboardLines.edit(this.server, this.board);
         edit.hideTitle = !edit.hideTitle;
         ScoreboardLines.changed(this.server, this.board);
         this.scheduleRebuild();
      }).method_46434(this.blockLeft, y, GRID_W, 20).method_46431();
      toggle.method_47400(class_7919.method_47407(class_2561.method_43470("The board's name, above its lines")));
      this.method_37063(toggle);
   }

   private void addLineRow(ScoreboardModule.Line line, int y) {
      class_4185 toggle = class_4185.method_46430(this.lineLabel(line), button -> {
         ScoreboardLines.edit(this.server, this.board).toggle(line.owner);
         ScoreboardLines.changed(this.server, this.board);
         this.scheduleRebuild();
      }).method_46434(this.blockLeft, y, GRID_W, 20).method_46431();
      this.method_37063(toggle);
      this.lineButtons.add(toggle);
      this.buttonLines.add(line);
   }

   private class_2561 lineLabel(ScoreboardModule.Line line) {
      class_2561 text = line.text.getString().isBlank()
         ? class_2561.method_43470("(empty line)").method_27692(class_124.field_1063)
         : line.text;
      return this.rowLabel(text, line.shown);
   }

   private class_2561 rowLabel(class_2561 text, boolean shown) {
      return class_2561.method_43473().method_10852(text).method_10852(class_2561.method_43470(": ").method_27692(class_124.field_1063)).method_10852(onOff(shown));
   }

   private class_2561 powerLabel() {
      ScoreboardModule module = ScoreboardModule.get();
      return class_2561.method_43470("Board: ").method_10852(onOff(module != null && module.isEnabled()));
   }

   private class_2561 numbersLabel(ScoreboardLines.Board settings) {
      return class_2561.method_43470("Numbers: ").method_10852(onOff(settings == null || !settings.hideNumbers));
   }

   @Override
   public void method_25393() {
      super.method_25393();
      // Lines change while the page is open (timers, coins): relabel the rows every half
      // second, and lay the page out again when the lines themselves are not the same.
      if (++this.ticks % REFRESH_TICKS == 0) {
         if (this.refresh()) {
            this.scheduleRebuild();
         } else {
            for (int i = 0; i < this.lineButtons.size(); i++) {
               String owner = this.buttonLines.get(i).owner;

               for (ScoreboardModule.Line line : this.lines) {
                  if (line.owner.equals(owner)) {
                     this.lineButtons.get(i).method_25355(this.lineLabel(line));
                     break;
                  }
               }
            }
         }
      }
   }
}
