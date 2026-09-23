package com.blueclient.screen;

import com.blueclient.hud.Hud;
import com.blueclient.hud.Module;
import com.blueclient.ui.Fonts;
import com.blueclient.ui.Sounds;
import com.blueclient.ui.input.Inputs;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.ChatFormatting;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.CommonComponents;
import net.minecraft.network.chat.Component;
import net.minecraft.sounds.SoundEvent;
import net.minecraft.sounds.SoundEvents;

public class HudLayoutScreen extends VanillaScreen {
   private static final int SNAP = 4;
   private static final int STICK = 3;
   private static final int HANDLE = 6;
   private static final int NUDGE_FAR = 10;
   private static final int INSET = 4;
   private static final int FRAME = -4209460;
   private static final int FRAME_ACTIVE = -1;
   private static final int PLATE = -1873784752;
   private static final int PLATE_TEXT = -2039584;
   private static final int ROW = 9;
   private static final int GUIDE = -1;
   private static final int GUIDE_SHADOW = -12632257;
   private Module picked;
   private Module dragging;
   private Module resizing;
   private int grabX;
   private int grabY;
   private float grabScale;
   private int grabSpan;
   private int guideX = -1;
   private int guideY = -1;
   private int heldX = -1;
   private int heldY = -1;
   private boolean frozen;
   private boolean unsaved;

   public HudLayoutScreen(Screen parent) {
      super(parent, Component.literal("Layout"));
   }

   @Override
   protected String subtitle() {
      return "Drag to move  ·  arrows nudge  ·  corner resizes  ·  Ctrl or Shift: free";
   }

   @Override
   protected String searchHint() {
      return "";
   }

   @Override
   protected boolean hasSearch() {
      return false;
   }

   @Override
   protected Component footerLabel() {
      return CommonComponents.GUI_BACK.copy().withStyle(ChatFormatting.RED);
   }

   @Override
   protected int content(int top) {
      this.blockWidth = 200;
      this.blockLeft = (this.width - this.blockWidth) / 2;
      this.addRenderableWidget(Button.builder(Component.literal("Reset to default").withStyle(ChatFormatting.YELLOW), button -> {
         Hud.resetLayout();
         this.picked = null;
         this.frozen = false;
         this.rebuildWidgets();
      }).bounds(this.blockLeft, this.height - 52, this.blockWidth, 20).build());
      return this.height - 32;
   }

   @Override
   public void extractBackground(GuiGraphicsExtractor ctx, int mouseX, int mouseY, float delta) {
      if (this.minecraft == null || this.minecraft.level == null) {
         super.extractBackground(ctx, mouseX, mouseY, delta);
      }
   }

   @Override
   public void extractRenderState(GuiGraphicsExtractor ctx, int mouseX, int mouseY, float delta) {
      Hud.stackDefaults(this.minecraft, this.width, this.height);
      super.extractRenderState(ctx, mouseX, mouseY, delta);
      List<Module> modules = this.placeable();
      Module hovered = this.idle() ? this.at(modules, mouseX, mouseY) : null;
      boolean live = this.minecraft != null && this.minecraft.level != null;

      for (Module module : modules) {
         int w = this.boxWidth(module);
         int h = this.boxHeight(module);
         int x = this.placedX(module, w);
         int y = this.placedY(module, h);
         if (!live || !module.isVisible(this.minecraft)) {
            this.ghost(ctx, module, x, y, w, h);
         }

         boolean held = module == this.dragging || module == this.resizing;
         if (held || module == hovered || module == this.picked) {
            this.frame(ctx, x, y, this.grabWidth(module), this.grabHeight(module), held || module == this.picked);
         }
      }

      this.guides(ctx);
      this.readout(ctx);
   }

   private void frame(GuiGraphicsExtractor ctx, int x, int y, int w, int h, boolean held) {
      int colour = held ? -1 : -4209460;
      int x0 = x - 2;
      int y0 = y - 2;
      int x1 = x + w + 2;
      int y1 = y + h + 2;
      ctx.fill(x0, y0, x1, y0 + 1, colour);
      ctx.fill(x0, y1 - 1, x1, y1, colour);
      ctx.fill(x0, y0, x0 + 1, y1, colour);
      ctx.fill(x1 - 1, y0, x1, y1, colour);
      ctx.fill(x1 - 6, y1 - 6, x1, y1, colour);
      ctx.fill(x1 - 6 + 2, y1 - 2, x1 - 1, y1 - 1, -14012874);
      ctx.fill(x1 - 2, y1 - 6 + 2, x1 - 1, y1 - 1, -14012874);
   }

   private void ghost(GuiGraphicsExtractor ctx, Module module, int x, int y, int w, int h) {
      ctx.fill(x, y, x + w, y + h, -1873784752);
      ctx.text(this.font, module.name, x + 1, y + 1, -2039584, false);
   }

   private void guides(GuiGraphicsExtractor ctx) {
      if (this.guideX >= 0) {
         ctx.fill(this.guideX + 1, 1, this.guideX + 2, this.height, -12632257);
         ctx.fill(this.guideX, 0, this.guideX + 1, this.height, -1);
      }

      if (this.guideY >= 0) {
         ctx.fill(1, this.guideY + 1, this.width, this.guideY + 2, -12632257);
         ctx.fill(0, this.guideY, this.width, this.guideY + 1, -1);
      }
   }

   private void readout(GuiGraphicsExtractor ctx) {
      if (this.resizing != null && this.resizing.scale() != null) {
         Component text = Fonts.ui(Math.round(this.resizing.scale().get() * 100.0F) + "%");
         int w = this.grabWidth(this.resizing);
         int cx = this.placedX(this.resizing, this.boxWidth(this.resizing)) + w / 2;
         int y = this.placedY(this.resizing, this.boxHeight(this.resizing)) + this.grabHeight(this.resizing) + 5;
         int x = Math.max(2, Math.min(this.width - this.font.width(text) - 2, cx - this.font.width(text) / 2));
         ctx.text(this.font, text, x, Math.min(this.height - 10, y), -1);
      }
   }

   private List<Module> placeable() {
      List<Module> out = new ArrayList<>();

      for (Module module : Hud.modules()) {
         if (module.isEnabled() && module.position() != null) {
            out.add(module);
         }
      }

      return out;
   }

   private Module at(List<Module> modules, int mouseX, int mouseY) {
      for (int i = modules.size() - 1; i >= 0; i--) {
         Module module = modules.get(i);
         if (inside(
            mouseX,
            mouseY,
            this.placedX(module, this.boxWidth(module)),
            this.placedY(module, this.boxHeight(module)),
            this.grabWidth(module),
            this.grabHeight(module)
         )) {
            return module;
         }
      }

      return null;
   }

   private boolean idle() {
      return this.dragging == null && this.resizing == null;
   }

   private int boxWidth(Module module) {
      return module.isVisible(this.minecraft) ? module.scaledWidth(this.minecraft) : this.font.width(module.name) + 2;
   }

   private int boxHeight(Module module) {
      return module.isVisible(this.minecraft) ? module.scaledHeight(this.minecraft) : 9;
   }

   private int placedX(Module module, int w) {
      int[] stacked = Hud.stackedAt(module);
      if (stacked != null) {
         return stacked[0];
      } else {
         int[] home = this.vanillaHome(module);
         return home != null ? home[0] : module.position().screenX(this.width, w);
      }
   }

   private int placedY(Module module, int h) {
      int[] stacked = Hud.stackedAt(module);
      if (stacked != null) {
         return stacked[1];
      } else {
         int[] home = this.vanillaHome(module);
         return home != null ? home[1] : module.position().screenY(this.height, h);
      }
   }

   private int[] vanillaHome(Module module) {
      return module.position().isDefault() ? module.vanillaPlace(this.minecraft) : null;
   }

   private int grabWidth(Module module) {
      return Math.max(this.boxWidth(module), 10);
   }

   private int grabHeight(Module module) {
      return Math.max(this.boxHeight(module), 9);
   }

   private void place(Module module, int x, int y, int w, int h) {
      module.position().moveTo(this.width - w <= 0 ? 0.0F : (float)x / (this.width - w), this.height - h <= 0 ? 0.0F : (float)y / (this.height - h));
   }

   private void freeze() {
      if (!this.frozen) {
         this.frozen = true;

         for (Module module : this.placeable()) {
            if (Hud.stackedAt(module) != null && !Hud.followsArmour(module)) {
               int w = this.boxWidth(module);
               int h = this.boxHeight(module);
               this.place(module, this.placedX(module, w), this.placedY(module, h), w, h);
            }
         }
      }
   }

   @Override
   protected boolean onClick(double mouseX, double mouseY, int button) {
      if (super.onClick(mouseX, mouseY, button)) {
         return true;
      } else if (button != 0) {
         return false;
      } else {
         List<Module> modules = this.placeable();

         for (int i = modules.size() - 1; i >= 0; i--) {
            Module module = modules.get(i);
            int w = this.boxWidth(module);
            int h = this.boxHeight(module);
            int x = this.placedX(module, w);
            int y = this.placedY(module, h);
            if (inside((int)mouseX, (int)mouseY, x + this.grabWidth(module) + 2 - 6, y + this.grabHeight(module) + 2 - 6, 6, 6) && module.scale() != null) {
               this.picked = module;
               this.resizing = module;
               this.grabScale = module.scale().get();
               this.grabSpan = Math.max(16, Math.max(this.grabWidth(module), this.grabHeight(module)));
               this.grabX = (int)mouseX;
               this.grabY = (int)mouseY;
               return true;
            }

            if (inside((int)mouseX, (int)mouseY, x, y, this.grabWidth(module), this.grabHeight(module))) {
               this.freeze();
               this.picked = module;
               this.dragging = module;
               this.grabX = (int)mouseX - this.placedX(module, w);
               this.grabY = (int)mouseY - this.placedY(module, h);
               return true;
            }
         }

         this.picked = null;
         return false;
      }
   }

   @Override
   protected boolean onDrag(double mouseX, double mouseY, int button, double dx, double dy) {
      boolean free = Inputs.ctrlHeld() || Inputs.shiftHeld() || Inputs.altHeld();
      if (this.resizing != null) {
         int moved = (int)Math.max(mouseX - this.grabX, mouseY - this.grabY);
         float next = this.grabScale * (1.0F + (float)moved / this.grabSpan);
         this.resizing.scale().set(free ? next : Math.round(next * 20.0F) / 20.0F);
         return true;
      } else if (this.dragging == null) {
         return super.onDrag(mouseX, mouseY, button, dx, dy);
      } else {
         int w = this.boxWidth(this.dragging);
         int h = this.boxHeight(this.dragging);
         int x = (int)mouseX - this.grabX;
         int y = (int)mouseY - this.grabY;
         this.guideX = -1;
         this.guideY = -1;
         if (!free) {
            x = this.snap(x, w, true);
            y = this.snap(y, h, false);
         }

         if (this.guideX >= 0 && this.guideX != this.heldX || this.guideY >= 0 && this.guideY != this.heldY) {
            Sounds.ui(this.minecraft, (SoundEvent)SoundEvents.UI_BUTTON_CLICK.value(), 1.7F, 0.25F);
         }

         this.heldX = this.guideX;
         this.heldY = this.guideY;
         this.place(this.dragging, x, y, w, h);
         return true;
      }
   }

   private int snap(int value, int size, boolean horizontal) {
      int screen = horizontal ? this.width : this.height;
      int holding = horizontal ? this.heldX : this.heldY;
      int[] anchors = new int[]{0, size / 2, size};
      int bestValue = value;
      int bestLine = -1;
      int bestGap = 5;

      for (Module other : this.placeable()) {
         if (other != this.dragging) {
            int ow = this.boxWidth(other);
            int oh = this.boxHeight(other);
            int at = horizontal ? this.placedX(other, ow) : this.placedY(other, oh);
            int span = horizontal ? ow : oh;

            for (int line : new int[]{at, at + span / 2, at + span}) {
               for (int anchor : anchors) {
                  int gap = Math.abs(value + anchor - line) - (line == holding ? 3 : 0);
                  if (gap < bestGap) {
                     bestGap = gap;
                     bestValue = line - anchor;
                     bestLine = line;
                  }
               }
            }
         }
      }

      for (int line : new int[]{0, 4, screen / 2, screen - 4, screen}) {
         for (int anchorx : anchors) {
            int gap = Math.abs(value + anchorx - line) - (line == holding ? 3 : 0);
            if (gap < bestGap) {
               bestGap = gap;
               bestValue = line - anchorx;
               bestLine = line;
            }
         }
      }

      if (bestGap > 4) {
         return value;
      } else {
         if (horizontal) {
            this.guideX = bestLine;
         } else {
            this.guideY = bestLine;
         }

         return bestValue;
      }
   }

   @Override
   protected boolean onRelease(double mouseX, double mouseY, int button) {
      if (this.dragging != null) {
         this.dragging.position().commit();
         this.dragging = null;
         this.guideX = -1;
         this.guideY = -1;
         this.heldX = -1;
         this.heldY = -1;
         return true;
      } else if (this.resizing != null) {
         this.resizing.scale().commit();
         this.resizing = null;
         return true;
      } else {
         return super.onRelease(mouseX, mouseY, button);
      }
   }

   @Override
   protected boolean onKey(int keyCode, int scanCode, int modifiers) {
      if (keyCode == 344) {
         this.onClose();
         return true;
      } else if (keyCode == 256 && this.picked != null) {
         this.picked = null;
         return true;
      } else {
         if (this.picked != null) {
            int step = Inputs.shiftHeld() ? 10 : 1;
            switch (keyCode) {
               case 262:
                  this.nudge(step, 0);
                  return true;
               case 263:
                  this.nudge(-step, 0);
                  return true;
               case 264:
                  this.nudge(0, step);
                  return true;
               case 265:
                  this.nudge(0, -step);
                  return true;
            }
         }

         return super.onKey(keyCode, scanCode, modifiers);
      }
   }

   private void nudge(int dx, int dy) {
      this.freeze();
      int w = this.boxWidth(this.picked);
      int h = this.boxHeight(this.picked);
      this.place(this.picked, this.placedX(this.picked, w) + dx, this.placedY(this.picked, h) + dy, w, h);
      this.unsaved = true;
   }

   @Override
   protected boolean onKeyUp(int keyCode, int scanCode, int modifiers) {
      this.save();
      return super.onKeyUp(keyCode, scanCode, modifiers);
   }

   @Override
   public void onClose() {
      this.save();
      super.onClose();
   }

   private void save() {
      if (this.unsaved && this.picked != null) {
         this.picked.position().commit();
         this.unsaved = false;
      } else {
         this.unsaved = false;
      }
   }

   private static boolean inside(int mx, int my, int x, int y, int w, int h) {
      return mx >= x && mx < x + w && my >= y && my < y + h;
   }
}
