package com.blueclient.screen;

import com.blueclient.hud.modules.ScoreboardLines;
import com.blueclient.hud.modules.ScoreboardModule;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.ChatFormatting;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.Tooltip;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.CommonComponents;
import net.minecraft.network.chat.Component;
import net.minecraft.world.scores.Objective;

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
   private Component boardTitle;
   private List<ScoreboardModule.Line> lines = new ArrayList<>();
   private final List<Button> lineButtons = new ArrayList<>();
   private final List<ScoreboardModule.Line> buttonLines = new ArrayList<>();
   private int ticks;

   public ScoreboardLinesScreen(Screen parent) {
      super(parent, Component.literal("Scoreboard"));
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
   protected Component footerLabel() {
      return CommonComponents.GUI_BACK.copy().withStyle(ChatFormatting.RED);
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
      Objective objective = module == null ? null : module.showing(this.minecraft);
      String server = ScoreboardModule.server(this.minecraft);
      String board = objective == null ? null : objective.getName();
      List<ScoreboardModule.Line> lines = module == null ? new ArrayList<>() : module.lines(this.minecraft, objective);
      boolean moved = !server.equals(this.server) || !(board == null ? this.board == null : board.equals(this.board)) || lines.size() != this.lines.size();

      for (int i = 0; !moved && i < lines.size(); i++) {
         moved = !lines.get(i).owner.equals(this.lines.get(i).owner);
      }

      this.server = server;
      this.board = board;
      this.boardTitle = objective == null ? null : objective.getDisplayName();
      this.lines = lines;
      return moved;
   }

   @Override
   protected int content(int top) {
      this.blockWidth = GRID_W;
      this.blockLeft = (this.width - GRID_W) / 2;
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
      Button numbers = Button.builder(this.numbersLabel(settings), button -> {
         ScoreboardLines.Board edit = ScoreboardLines.edit(this.server, this.board);
         edit.hideNumbers = !edit.hideNumbers;
         ScoreboardLines.changed(this.server, this.board);
         button.setMessage(this.numbersLabel(ScoreboardLines.find(this.server, this.board)));
      }).bounds(this.blockLeft, y, third, 20).build();
      numbers.setTooltip(Tooltip.create(Component.literal("The numbers on the right of each line")));
      numbers.active = this.board != null;
      this.addRenderableWidget(numbers);
      Button showAll = Button.builder(Component.literal("Show all"), button -> {
         ScoreboardLines.reset(this.server, this.board);
         this.scheduleRebuild();
      }).bounds(this.blockLeft + third + 8, y, third, 20).build();
      showAll.setTooltip(Tooltip.create(Component.literal("Every line, the title and the numbers back on, as the server sends them")));
      showAll.active = settings != null && settings.customised();
      this.addRenderableWidget(showAll);
      ScoreboardModule module = ScoreboardModule.get();
      Button power = Button.builder(this.powerLabel(), button -> {
         if (module != null) {
            module.toggle();
            this.scheduleRebuild();
         }
      }).bounds(this.blockLeft + (third + 8) * 2, y, GRID_W - (third + 8) * 2, 20).build();
      power.setTooltip(Tooltip.create(Component.literal("Off hides the whole sidebar. Move or resize it in Layout (F9)")));
      power.active = module != null && !module.isHeldOff();
      this.addRenderableWidget(power);
      return y + 24;
   }

   private void addTitleRow(int y) {
      ScoreboardLines.Board settings = ScoreboardLines.find(this.server, this.board);
      boolean shown = settings == null || !settings.hideTitle;
      Button toggle = Button.builder(this.rowLabel(Component.literal("Title: ").withStyle(ChatFormatting.GRAY).append(this.boardTitle), shown), button -> {
         ScoreboardLines.Board edit = ScoreboardLines.edit(this.server, this.board);
         edit.hideTitle = !edit.hideTitle;
         ScoreboardLines.changed(this.server, this.board);
         this.scheduleRebuild();
      }).bounds(this.blockLeft, y, GRID_W, 20).build();
      toggle.setTooltip(Tooltip.create(Component.literal("The board's name, above its lines")));
      this.addRenderableWidget(toggle);
   }

   private void addLineRow(ScoreboardModule.Line line, int y) {
      Button toggle = Button.builder(this.lineLabel(line), button -> {
         ScoreboardLines.edit(this.server, this.board).toggle(line.owner);
         ScoreboardLines.changed(this.server, this.board);
         this.scheduleRebuild();
      }).bounds(this.blockLeft, y, GRID_W, 20).build();
      this.addRenderableWidget(toggle);
      this.lineButtons.add(toggle);
      this.buttonLines.add(line);
   }

   private Component lineLabel(ScoreboardModule.Line line) {
      Component text = line.text.getString().isBlank()
         ? Component.literal("(empty line)").withStyle(ChatFormatting.DARK_GRAY)
         : line.text;
      return this.rowLabel(text, line.shown);
   }

   private Component rowLabel(Component text, boolean shown) {
      return Component.empty().append(text).append(Component.literal(": ").withStyle(ChatFormatting.DARK_GRAY)).append(onOff(shown));
   }

   private Component powerLabel() {
      ScoreboardModule module = ScoreboardModule.get();
      return Component.literal("Board: ").append(onOff(module != null && module.isEnabled()));
   }

   private Component numbersLabel(ScoreboardLines.Board settings) {
      return Component.literal("Numbers: ").append(onOff(settings == null || !settings.hideNumbers));
   }

   @Override
   public void tick() {
      super.tick();
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
                     this.lineButtons.get(i).setMessage(this.lineLabel(line));
                     break;
                  }
               }
            }
         }
      }
   }
}
