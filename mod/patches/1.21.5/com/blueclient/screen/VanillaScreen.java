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
import net.minecraft.class_124;
import net.minecraft.class_2561;
import net.minecraft.class_2960;
import net.minecraft.class_332;
import net.minecraft.class_342;
import net.minecraft.class_3532;
import net.minecraft.class_4185;
import net.minecraft.class_437;
import net.minecraft.class_7919;

public abstract class VanillaScreen extends BlueScreen {
   protected static final int BUTTON_H = 20;
   protected static final int ROW_H = 24;
   protected static final int GAP = 8;
   protected static final int TITLE_Y = 22;
   protected static final int SUBTITLE_Y = 50;
   protected static final int SEARCH_H = 18;
   protected static final int SEARCH_Y = 68;
   protected final class_437 parent;
   protected String query = "";
   private class_342 search;
   private boolean rebuild;
   private boolean keepFocus;
   protected int blockLeft;
   protected int blockWidth;
   protected int footerY;
   private class_4185 apply;
   protected static final int GEAR_W = 20;
   protected static final int GEAR_GAP = 2;
   protected int listTop;
   protected int rows;
   protected int totalRows;
   private int offset;
   private String scrolledFor = "";
   private boolean grabbing;
   private double grabScroll;
   private static final class_2960 THUMB = Ids.mc("widget/scroller");
   private static final class_2960 LANE = Ids.mc("widget/scroller_background");
   private static final int BAR_W = 6;
   private static final int BAR_GAP = 10;
   private static final int THUMB_MIN = 32;
   private static final int THUMB_INSET = 8;

   protected VanillaScreen(class_437 parent, class_2561 title) {
      super(title);
      this.parent = parent;
   }

   protected abstract String subtitle();

   protected abstract String searchHint();

   protected abstract int content(int var1);

   protected abstract class_2561 footerLabel();

   protected boolean hasSearch() {
      return true;
   }

   protected boolean hasApplyRow() {
      return false;
   }

   protected int applyRowHeight() {
      return this.hasApplyRow() && Graphics.available() ? 24 : 0;
   }

   protected void method_25426() {
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
      this.method_37063(
         class_4185.method_46430(this.footerLabel(), button -> this.method_25419())
            .method_46434(this.blockLeft, this.footerY, this.blockWidth, 20)
            .method_46431()
      );
   }

   private void addSearch() {
      this.search = new class_342(this.field_22793, this.blockLeft, 68, this.blockWidth, 18, class_2561.method_43470(this.searchHint()));
      this.search.method_47404(class_2561.method_43470(this.searchHint()).method_27692(class_124.field_1063));
      this.search.method_1880(32);
      this.search.method_1852(this.query);
      this.search.method_1863(text -> {
         if (!text.equals(this.query)) {
            this.query = text;
            this.rebuild = true;
            this.keepFocus = true;
         }
      });
      this.method_37063(this.search);
      this.method_25395(this.search);
      if (this.keepFocus) {
         this.search.method_1872(false);
         this.keepFocus = false;
      }
   }

   protected void addModuleRow(Module module, int x, int y, int pairWidth) {
      int toggleW = pairWidth - 20 - 2;
      class_4185 toggle = class_4185.method_46430(label(module), button -> {
         module.toggle();
         button.method_25355(label(module));
      }).method_46434(x, y, toggleW, 20).method_46431();
      toggle.field_22763 = !module.isHeldOff();
      toggle.method_47400(class_7919.method_47407(class_2561.method_43470(module.isHeldOff() ? module.heldOffNote() : module.description)));
      this.method_37063(toggle);
      boolean configurable = !module.visibleSettings().isEmpty();
      class_4185 gear = new IconButton(
         x + toggleW + 2, y, 20, 20, class_2561.method_43473(), button -> Screens.open(this.field_22787, this.pageFor(module)), Icon.GEAR
      );
      gear.field_22763 = configurable;
      if (configurable) {
         gear.method_47400(class_7919.method_47407(class_2561.method_43470("Options")));
      }

      this.method_37063(gear);
   }

   private class_437 pageFor(Module module) {
      if (module instanceof HotkeysModule) {
         return new HotkeysScreen(this);
      } else {
         return (class_437)(module instanceof MusicModule ? new MusicScreen(this) : new VanillaOptionsScreen(this, module));
      }
   }

   private int addApplyRow(int x, int y, int w) {
      if (!Graphics.available()) {
         return y;
      } else {
         Graphics.refresh();
         this.apply = class_4185.method_46430(class_2561.method_43473(), button -> Graphics.applyLater()).method_46434(x, y, w, 20).method_46431();
         this.apply
            .method_47400(
               class_7919.method_47407(
                  class_2561.method_43470(
                     "Shaders take a few seconds to compile, and the game pauses while they do. Change everything you want first, then apply once."
                  )
               )
            );
         this.refreshApply();
         this.method_37063(this.apply);
         return y + 24;
      }
   }

   private void refreshApply() {
      if (this.apply != null) {
         if (Graphics.applying()) {
            this.apply.field_22763 = false;
            this.apply.method_25355(class_2561.method_43470("Applying..."));
            Graphics.noticeShown();
         } else if (Graphics.foreignPack()) {
            this.apply.field_22763 = false;
            this.apply.method_25355(class_2561.method_43470("Another Iris pack is selected"));
         } else {
            boolean pending = Graphics.pending();
            this.apply.field_22763 = pending;
            this.apply
               .method_25355(pending ? class_2561.method_43470("Apply changes").method_27692(class_124.field_1054) : class_2561.method_43470("Apply changes"));
         }
      }
   }

   protected int fitRows(int top, int total, int reserve) {
      return this.fitRows(top, total, reserve, false);
   }

   protected int fitRows(int top, int total, int reserve, boolean fixedDepth) {
      this.listTop = top;
      this.totalRows = Math.max(1, total);
      int room = Math.max(2, (this.field_22790 - top - reserve) / 24);
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
      return Math.min(this.blockLeft + this.blockWidth + 10, this.field_22789 - 6);
   }

   private int barHeight() {
      return this.rows * 24 - 4;
   }

   private int thumbHeight() {
      int bar = this.barHeight();
      int content = this.totalRows * 24;
      return class_3532.method_15340(bar * bar / Math.max(1, content), 32, bar - 8);
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

   public boolean method_25401(double mouseX, double mouseY, double horizontal, double vertical) {
      if (this.hasBar() && vertical != 0.0) {
         this.scrollBy(vertical > 0.0 ? -1 : 1);
         return true;
      } else {
         return super.method_25401(mouseX, mouseY, horizontal, vertical);
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
            case 264:
               this.scrollBy(1);
               break;
            case 265:
               this.scrollBy(-1);
               break;
            case 266:
               this.scrollBy(-this.rows);
               break;
            case 267:
               this.scrollBy(this.rows);
               break;
            default:
               return false;
         }

         return true;
      }
   }

   private void drawBar(class_332 ctx) {
      if (this.hasBar()) {
         int x = this.barX();
         Blit.sprite(ctx, LANE, x, this.listTop, 6, this.barHeight());
         Blit.sprite(ctx, THUMB, x, this.listTop + this.thumbAt(), 6, this.thumbHeight());
      }
   }

   protected static class_2561 onOff(boolean on) {
      return class_2561.method_43470(on ? "ON" : "OFF").method_27692(on ? class_124.field_1060 : class_124.field_1061);
   }

   protected static class_2561 label(Module module) {
      boolean on = module.isEnabled();
      return class_2561.method_43470(module.name + ": ")
         .method_10852(class_2561.method_43470(on ? "ON" : "OFF").method_27692(on ? class_124.field_1060 : class_124.field_1061));
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

   public void method_25393() {
      super.method_25393();
      if (this.rebuild) {
         this.rebuild = false;
         this.method_41843();
      }
   }

   public void method_25420(class_332 ctx, int mouseX, int mouseY, float delta) {
      super.method_25420(ctx, mouseX, mouseY, delta);
      ctx.method_25294(0, 0, this.field_22789, this.field_22790, 1073741824);
   }

   public void method_25394(class_332 ctx, int mouseX, int mouseY, float delta) {
      this.refreshApply();
      super.method_25394(ctx, mouseX, mouseY, delta);
      ctx.method_27534(this.field_22793, this.field_22785, this.field_22789 / 2, 22, -1);
      if (Graphics.applying()) {
         ctx.method_27534(
            this.field_22793,
            class_2561.method_43470("Applying shaders — the game pauses for a moment").method_27692(class_124.field_1054),
            this.field_22789 / 2,
            50,
            -1
         );
         Graphics.noticeShown();
      } else {
         ctx.method_27534(this.field_22793, class_2561.method_43470(this.subtitle()), this.field_22789 / 2, 50, -6250336);
      }

      if (this.search != null && this.search.method_25370() && this.search.method_1882().isEmpty()) {
         ctx.method_27535(this.field_22793, class_2561.method_43470(this.searchHint()), this.search.method_46426() + 4, 73, -8355712);
      }

      this.drawBar(ctx);
   }

   @Override
   protected boolean onKey(int keyCode, int scanCode, int modifiers) {
      if (this.scrolled(keyCode)) {
         return true;
      } else {
         boolean typing = this.method_25399() instanceof class_342 field && !field.method_1882().isEmpty();
         if (keyCode == 344 && !typing) {
            this.method_25419();
            return true;
         } else if (keyCode == 256 && !this.query.isEmpty()) {
            this.query = "";
            this.rebuild = true;
            return true;
         } else {
            return super.onKey(keyCode, scanCode, modifiers);
         }
      }
   }

   public void method_25419() {
      Screens.open(this.field_22787, this.parent);
   }

   public boolean method_25421() {
      return false;
   }
}
