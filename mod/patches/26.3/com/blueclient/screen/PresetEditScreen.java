package com.blueclient.screen;

import com.blueclient.Presets;
import com.blueclient.hud.Hud;
import com.blueclient.hud.Module;
import net.minecraft.ChatFormatting;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.CommonComponents;
import net.minecraft.network.chat.Component;

public class PresetEditScreen extends VanillaScreen {
   private static final int WIDTH = 200;
   private static final int LABEL_H = 12;
   private final String original;
   private EditBox field;
   private int nameLabelY;
   private int holdsY;

   public PresetEditScreen(Screen parent, String name) {
      super(parent, Component.literal("Preset"));
      this.original = name;
   }

   @Override
   protected String subtitle() {
      return Presets.isActive(this.original) ? "The preset you are using" : "Saved — switch to it from the Presets list";
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
      return CommonComponents.GUI_DONE.copy().withStyle(ChatFormatting.GREEN);
   }

   @Override
   protected int content(int top) {
      this.blockWidth = 200;
      this.blockLeft = (this.width - 200) / 2;
      this.nameLabelY = top;
      int y = top + 12;
      this.field = new EditBox(this.font, this.blockLeft, y, 200, 20, Component.literal("Name"));
      this.field.setMaxLength(24);
      this.field.setValue(this.original);
      this.addRenderableWidget(this.field);
      this.setFocused(this.field);
      this.field.moveCursorToStart(false);
      this.field.setHighlightPos(this.field.getValue().length());
      y += 36;
      this.holdsY = y;
      return y + 12;
   }

   @Override
   public void extractRenderState(GuiGraphicsExtractor ctx, int mouseX, int mouseY, float delta) {
      super.extractRenderState(ctx, mouseX, mouseY, delta);
      ctx.text(this.font, Component.literal("Name"), this.blockLeft, this.nameLabelY, -6250336);
      int listed = (int)Hud.modules().stream().filter(Module::listedInMenus).count();
      ctx.centeredText(
         this.font,
         Component.literal("Holds " + Presets.enabledCount(this.original) + " of " + listed + " modules, their options and the layout"),
         this.width / 2,
         this.holdsY,
         -8355712
      );
   }

   @Override
   public void onClose() {
      Presets.rename(this.original, this.field == null ? this.original : this.field.getValue());
      super.onClose();
   }
}
