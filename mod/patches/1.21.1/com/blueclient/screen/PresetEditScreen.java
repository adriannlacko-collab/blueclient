package com.blueclient.screen;

import com.blueclient.Presets;
import com.blueclient.hud.Hud;
import com.blueclient.hud.Module;
import net.minecraft.class_124;
import net.minecraft.class_2561;
import net.minecraft.class_332;
import net.minecraft.class_342;
import net.minecraft.class_437;
import net.minecraft.class_5244;

public class PresetEditScreen extends VanillaScreen {
   private static final int WIDTH = 200;
   private static final int LABEL_H = 12;
   private final String original;
   private class_342 field;
   private int nameLabelY;
   private int holdsY;

   public PresetEditScreen(class_437 parent, String name) {
      super(parent, class_2561.method_43470("Preset"));
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
   protected class_2561 footerLabel() {
      return class_5244.field_24334.method_27661().method_27692(class_124.field_1060);
   }

   @Override
   protected int content(int top) {
      this.blockWidth = 200;
      this.blockLeft = (this.field_22789 - 200) / 2;
      this.nameLabelY = top;
      int y = top + 12;
      this.field = new class_342(this.field_22793, this.blockLeft, y, 200, 20, class_2561.method_43470("Name"));
      this.field.method_1880(24);
      this.field.method_1852(this.original);
      this.method_37063(this.field);
      this.method_25395(this.field);
      this.field.method_1870(false);
      this.field.method_1884(this.field.method_1882().length());
      y += 36;
      this.holdsY = y;
      return y + 12;
   }

   @Override
   public void method_25394(class_332 ctx, int mouseX, int mouseY, float delta) {
      super.method_25394(ctx, mouseX, mouseY, delta);
      ctx.method_27535(this.field_22793, class_2561.method_43470("Name"), this.blockLeft, this.nameLabelY, -6250336);
      int listed = (int)Hud.modules().stream().filter(Module::listedInMenus).count();
      ctx.method_27534(
         this.field_22793,
         class_2561.method_43470("Holds " + Presets.enabledCount(this.original) + " of " + listed + " modules, their options and the layout"),
         this.field_22789 / 2,
         this.holdsY,
         -8355712
      );
   }

   @Override
   public void method_25419() {
      Presets.rename(this.original, this.field == null ? this.original : this.field.method_1882());
      super.method_25419();
   }
}
