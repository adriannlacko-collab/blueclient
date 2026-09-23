package com.blueclient.screen;

import com.blueclient.graphics.Graphics;
import com.blueclient.hud.Module;
import com.blueclient.hud.modules.HotkeysModule;
import com.blueclient.hud.modules.MusicModule;
import com.blueclient.ui.Blit;
import com.blueclient.ui.Icon;
import com.blueclient.ui.Ids;
import com.blueclient.ui.Screens;
import com.blueclient.ui.input.BlueScreen;
import java.util.Locale;
import net.minecraft.ChatFormatting;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.components.Tooltip;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import net.minecraft.util.Mth;

public abstract class VanillaScreen extends BlueScreen {
   protected static final int BUTTON_H = 20;
   protected static final int ROW_H = 24;
   protected static final int GAP = 8;
   protected static final int TITLE_Y = 22;
   protected static final int SUBTITLE_Y = 50;
   protected static final int SEARCH_H = 18;
   protected static final int SEARCH_Y = 68;
   protected final Screen parent;
   protected String query = "";
   private EditBox search;
   private boolean rebuild;
   private boolean keepFocus;
   protected int blockLeft;
   protected int blockWidth;
   protected int footerY;
   private Button apply;
   protected static final int GEAR_W = 20;
   protected static final int GEAR_GAP = 2;
   protected int listTop;
   protected int rows;
   protected int totalRows;
   private int offset;
   private String scrolledFor = "";
   private boolean grabbing;
   private double grabScroll;
   private static final Identifier THUMB = Ids.mc("widget/scroller");
   private static final Identifier LANE = Ids.mc("widget/scroller_background");
   private static final int BAR_W = 6;
   private static final int BAR_GAP = 10;
   private static final int THUMB_MIN = 32;
   private static final int THUMB_INSET = 8;

   protected VanillaScreen(Screen parent, Component title) {
      super(title);
      this.parent = parent;
   }

   protected abstract String subtitle();

   protected abstract String searchHint();

   protected abstract int content(int var1);

   protected abstract Component footerLabel();

   protected boolean hasSearch() {
      return true;
   }

   protected boolean hasApplyRow() {
      return false;
   }

   protected int applyRowHeight() {
      return this.hasApplyRow() && Graphics.available() ? 24 : 0;
   }

   protected void init() {
      this.rows = 1;
      this.totalRows = 1;
      int top = this.hasSearch() ? 94 : 68;
      int bottom = this.content(top);
      if (this.hasApplyRow()) {
         bottom = this.addApplyRow(this.blockLeft, bottom, this.blockWidth);
      }

      if (this.hasSearch()) {
         this.addSearch();
      }

      this.footerY = bottom + 4;
      this.addRenderableWidget(Button.builder(this.footerLabel(), button -> this.onClose()).bounds(this.blockLeft, this.footerY, this.blockWidth, 20).build());
   }

   private void addSearch() {
      this.search = new EditBox(this.font, this.blockLeft, 68, this.blockWidth, 18, Component.literal(this.searchHint()));
      this.search.setHint(Component.literal(this.searchHint()).withStyle(ChatFormatting.DARK_GRAY));
      this.search.setMaxLength(32);
      this.search.setValue(this.query);
      this.search.setResponder(text -> {
         if (!text.equals(this.query)) {
            this.query = text;
            this.rebuild = true;
            this.keepFocus = true;
         }
      });
      this.addRenderableWidget(this.search);
      this.setFocused(this.search);
      if (this.keepFocus) {
         this.search.moveCursorToEnd(false);
         this.keepFocus = false;
      }
   }

   protected void addModuleRow(Module module, int x, int y, int pairWidth) {
      int toggleW = pairWidth - 20 - 2;
      Button toggle = Button.builder(label(module), button -> {
         module.toggle();
         button.setMessage(label(module));
      }).bounds(x, y, toggleW, 20).build();
      toggle.active = !module.isHeldOff();
      toggle.setTooltip(Tooltip.create(Component.literal(module.isHeldOff() ? module.heldOffNote() : module.description)));
      this.addRenderableWidget(toggle);
      boolean configurable = !module.visibleSettings().isEmpty();
      Button gear = new IconButton(x + toggleW + 2, y, 20, 20, Component.empty(), button -> Screens.open(this.minecraft, this.pageFor(module)), Icon.GEAR);
      gear.active = configurable;
      if (configurable) {
         gear.setTooltip(Tooltip.create(Component.literal("Options")));
      }

      this.addRenderableWidget(gear);
   }

   private Screen pageFor(Module module) {
      if (module instanceof HotkeysModule) {
         return new HotkeysScreen(this);
      } else {
         return (Screen)(module instanceof MusicModule ? new MusicScreen(this) : new VanillaOptionsScreen(this, module));
      }
   }

   private int addApplyRow(int x, int y, int w) {
      if (!Graphics.available()) {
         return y;
      } else {
         Graphics.refresh();
         this.apply = Button.builder(Component.empty(), button -> Graphics.applyLater()).bounds(x, y, w, 20).build();
         this.apply
            .setTooltip(
               Tooltip.create(
                  Component.literal(
                     "Shaders take a few seconds to compile, and the game pauses while they do. Change everything you want first, then apply once."
                  )
               )
            );
         this.refreshApply();
         this.addRenderableWidget(this.apply);
         return y + 24;
      }
   }

   private void refreshApply() {
      if (this.apply != null) {
         if (Graphics.applying()) {
            this.apply.active = false;
            this.apply.setMessage(Component.literal("Applying..."));
            Graphics.noticeShown();
         } else if (Graphics.foreignPack()) {
            this.apply.active = false;
            this.apply.setMessage(Component.literal("Another Iris pack is selected"));
         } else {
            boolean pending = Graphics.pending();
            this.apply.active = pending;
            this.apply.setMessage(pending ? Component.literal("Apply changes").withStyle(ChatFormatting.YELLOW) : Component.literal("Apply changes"));
         }
      }
   }

   protected int fitRows(int top, int total, int reserve) {
      return this.fitRows(top, total, reserve, false);
   }

   protected int fitRows(int top, int total, int reserve, boolean fixedDepth) {
      this.listTop = top;
      this.totalRows = Math.max(1, total);
      int room = Math.max(2, (this.height - top - reserve) / 24);
      this.rows = fixedDepth ? room : Math.min(this.totalRows, room);
      if (!this.query.equals(this.scrolledFor)) {
         this.scrolledFor = this.query;
         this.offset = 0;
      }

      this.offset = Math.max(0, Math.min(this.offset, Math.max(0, this.totalRows - this.rows)));
      return this.offset;
   }

   protected boolean hasBar() {
      return this.totalRows > this.rows;
   }

   private void scrollBy(int lines) {
      int max = Math.max(0, this.totalRows - this.rows);
      int next = Math.max(0, Math.min(this.offset + lines, max));
      if (next != this.offset) {
         this.offset = next;
         this.scheduleRebuild();
      }
   }

   private int barX() {
      return Math.min(this.blockLeft + this.blockWidth + 10, this.width - 6);
   }

   private int barHeight() {
      return this.rows * 24 - 4;
   }

   private int thumbHeight() {
      int bar = this.barHeight();
      int content = this.totalRows * 24;
      return Mth.clamp(bar * bar / Math.max(1, content), 32, bar - 8);
   }

   private int thumbAt() {
      int travel = this.barHeight() - this.thumbHeight();
      int max = Math.max(0, this.totalRows - this.rows) * 24;
      if (max <= 0) {
         return 0;
      } else {
         double scroll = this.grabbing ? this.grabScroll : this.offset * 24;
         return (int)(scroll * travel / max);
      }
   }

   private void dragBy(double mouseY, double deltaY) {
      int bar = this.barHeight();
      int max = Math.max(0, this.totalRows - this.rows) * 24;
      if (mouseY < this.listTop) {
         this.grabScroll = 0.0;
      } else if (mouseY > this.listTop + bar) {
         this.grabScroll = max;
      } else {
         double perPixel = Math.max(1.0, (double)max / (bar - this.thumbHeight()));
         this.grabScroll = Math.max(0.0, Math.min(this.grabScroll + deltaY * perPixel, (double)max));
      }

      int next = (int)Math.round(this.grabScroll / 24.0);
      if (next != this.offset) {
         this.offset = next;
         this.scheduleRebuild();
      }
   }

   private boolean onBar(double mouseX, double mouseY) {
      return this.hasBar() && mouseX >= this.barX() && mouseX <= this.barX() + 6 && mouseY >= this.listTop && mouseY < this.listTop + this.barHeight();
   }

   public boolean mouseScrolled(double mouseX, double mouseY, double horizontal, double vertical) {
      if (this.hasBar() && vertical != 0.0) {
         this.scrollBy(vertical > 0.0 ? -1 : 1);
         return true;
      } else {
         return super.mouseScrolled(mouseX, mouseY, horizontal, vertical);
      }
   }

   @Override
   protected boolean onClick(double mouseX, double mouseY, int button) {
      if (button == 0 && this.onBar(mouseX, mouseY)) {
         this.grabbing = true;
         this.grabScroll = this.offset * 24;
         return true;
      } else {
         return super.onClick(mouseX, mouseY, button);
      }
   }

   @Override
   protected boolean onDrag(double mouseX, double mouseY, int button, double deltaX, double deltaY) {
      if (this.grabbing && button == 0) {
         this.dragBy(mouseY, deltaY);
         return true;
      } else {
         return super.onDrag(mouseX, mouseY, button, deltaX, deltaY);
      }
   }

   @Override
   protected boolean onRelease(double mouseX, double mouseY, int button) {
      if (this.grabbing && button == 0) {
         this.grabbing = false;
         return true;
      } else {
         return super.onRelease(mouseX, mouseY, button);
      }
   }

   private boolean scrolled(int keyCode) {
      if (!this.hasBar()) {
         return false;
      } else {
         switch (keyCode) {
            case 75:
               this.scrollBy(-this.rows);
               break;
            case 76:
            case 77:
            case 79:
            case 80:
            default:
               return false;
            case 78:
               this.scrollBy(this.rows);
               break;
            case 81:
               this.scrollBy(1);
               break;
            case 82:
               this.scrollBy(-1);
         }

         return true;
      }
   }

   private void drawBar(GuiGraphicsExtractor ctx) {
      if (this.hasBar()) {
         int x = this.barX();
         Blit.sprite(ctx, LANE, x, this.listTop, 6, this.barHeight());
         Blit.sprite(ctx, THUMB, x, this.listTop + this.thumbAt(), 6, this.thumbHeight());
      }
   }

   protected static Component onOff(boolean on) {
      return Component.literal(on ? "ON" : "OFF").withStyle(on ? ChatFormatting.GREEN : ChatFormatting.RED);
   }

   protected static Component label(Module module) {
      boolean on = module.isEnabled();
      return Component.literal(module.name + ": ").append(Component.literal(on ? "ON" : "OFF").withStyle(on ? ChatFormatting.GREEN : ChatFormatting.RED));
   }

   protected String needle() {
      return this.query.trim().toLowerCase(Locale.ROOT);
   }

   protected boolean searching() {
      return !this.needle().isEmpty();
   }

   protected void scheduleRebuild() {
      this.rebuild = true;
   }

   public void tick() {
      super.tick();
      if (this.rebuild) {
         this.rebuild = false;
         this.rebuildWidgets();
      }
   }

   public void extractBackground(GuiGraphicsExtractor ctx, int mouseX, int mouseY, float delta) {
      super.extractBackground(ctx, mouseX, mouseY, delta);
      ctx.fill(0, 0, this.width, this.height, 1073741824);
   }

   public void extractRenderState(GuiGraphicsExtractor ctx, int mouseX, int mouseY, float delta) {
      this.refreshApply();
      super.extractRenderState(ctx, mouseX, mouseY, delta);
      ctx.centeredText(this.font, this.title, this.width / 2, 22, -1);
      if (Graphics.applying()) {
         ctx.centeredText(
            this.font, Component.literal("Applying shaders — the game pauses for a moment").withStyle(ChatFormatting.YELLOW), this.width / 2, 50, -1
         );
         Graphics.noticeShown();
      } else {
         ctx.centeredText(this.font, Component.literal(this.subtitle()), this.width / 2, 50, -6250336);
      }

      if (this.search != null && this.search.isFocused() && this.search.getValue().isEmpty()) {
         ctx.text(this.font, Component.literal(this.searchHint()), this.search.getX() + 4, 73, -8355712);
      }

      this.drawBar(ctx);
   }

   @Override
   protected boolean onKey(int keyCode, int scanCode, int modifiers) {
      if (this.scrolled(keyCode)) {
         return true;
      } else {
         boolean typing = this.getFocused() instanceof EditBox field && !field.getValue().isEmpty();
         if (keyCode == 229 && !typing) {
            this.onClose();
            return true;
         } else if (keyCode == 41 && !this.query.isEmpty()) {
            this.query = "";
            this.rebuild = true;
            return true;
         } else {
            return super.onKey(keyCode, scanCode, modifiers);
         }
      }
   }

   public void onClose() {
      Screens.open(this.minecraft, this.parent);
   }

   public boolean isPauseScreen() {
      return false;
   }
}
