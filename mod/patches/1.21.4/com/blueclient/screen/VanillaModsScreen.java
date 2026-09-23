package com.blueclient.screen;

import com.blueclient.Presets;
import com.blueclient.graphics.Graphics;
import com.blueclient.hud.Category;
import com.blueclient.hud.Hud;
import com.blueclient.hud.Module;
import com.blueclient.hud.modules.ShadersModule;
import com.blueclient.ui.Screens;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import net.minecraft.class_124;
import net.minecraft.class_1792;
import net.minecraft.class_1799;
import net.minecraft.class_1802;
import net.minecraft.class_2561;
import net.minecraft.class_332;
import net.minecraft.class_437;
import net.minecraft.class_5244;

public class VanillaModsScreen extends VanillaScreen {
   private static final int BUTTON_W = 150;
   private static final int GRID_W = 308;
   private static final int TAIL = 52;

   public VanillaModsScreen(class_437 parent) {
      super(parent, class_2561.method_43470("Blue Settings"));
   }

   @Override
   protected String subtitle() {
      if (!this.searching()) {
         return this.hasBar() ? "Choose a category — scroll for more" : "Choose a category to change your BlueClient settings";
      } else {
         int found = this.matching().size();
         return found == 0 ? "Nothing matches \"" + this.query.trim() + "\"" : found + (found == 1 ? " setting matches" : " settings match");
      }
   }

   @Override
   protected String searchHint() {
      return "Search settings...";
   }

   @Override
   protected class_2561 footerLabel() {
      return class_5244.field_24334.method_27661().method_27692(class_124.field_1060);
   }

   @Override
   protected int content(int top) {
      this.blockWidth = 308;
      this.blockLeft = (this.field_22789 - 308) / 2;
      return this.searching() ? this.results(top) : this.categories(top);
   }

   private int categories(int top) {
      List<VanillaModsScreen.Tile> tiles = new ArrayList<>();

      for (Category section : Category.values()) {
         if (section.tile) {
            tiles.add(
               new VanillaModsScreen.Tile(section.label, itemFor(section), () -> Screens.open(this.field_22787, new VanillaCategoryScreen(this, section)))
            );
         }
      }

      tiles.add(new VanillaModsScreen.Tile("Waypoints", class_1802.field_8251, () -> Screens.open(this.field_22787, new WaypointsScreen(this))));
      tiles.add(new VanillaModsScreen.Tile("Layout", class_1802.field_8143, () -> Screens.open(this.field_22787, new HudLayoutScreen(this))));
      tiles.add(new VanillaModsScreen.Tile("Presets", class_1802.field_8674, () -> Screens.open(this.field_22787, new PresetsScreen(this))));
      int offset = this.fitRows(top, (tiles.size() + 1) / 2, 52);
      int first = offset * 2;
      int last = Math.min(tiles.size(), first + this.rows * 2);

      for (int i = first; i < last; i++) {
         VanillaModsScreen.Tile tile = tiles.get(i);
         int slot = i - first;
         this.method_37063(
            new ItemButton(
               this.tileX(i, tiles.size()),
               top + slot / 2 * 24,
               150,
               20,
               class_2561.method_43470(tile.label()),
               button -> tile.open().run(),
               new class_1799(tile.item())
            )
         );
      }

      return top + this.rows * 24;
   }

   private int tileX(int index, int count) {
      boolean alone = index == count - 1 && index % 2 == 0;
      return alone ? this.blockLeft + 79 : this.blockLeft + index % 2 * 158;
   }

   private int results(int top) {
      List<Module> matches = this.matching();
      int offset = this.fitRows(top, matches.size(), 52);
      int last = Math.min(matches.size(), offset + this.rows);

      for (int i = offset; i < last; i++) {
         this.addModuleRow(matches.get(i), this.blockLeft, top + (i - offset) * 24, 308);
      }

      return top + this.rows * 24;
   }

   private List<Module> matching() {
      String needle = this.needle();
      List<Module> out = new ArrayList<>();
      if (needle.isEmpty()) {
         return out;
      } else {
         for (Module module : Hud.modules()) {
            if (module.listedInMenus()
               && (module.category != Category.SHADERS || module == ShadersModule.get())
               && (module.name.toLowerCase(Locale.ROOT).contains(needle) || module.description.toLowerCase(Locale.ROOT).contains(needle))) {
               out.add(module);
            }
         }

         return out;
      }
   }

   private static class_1792 itemFor(Category section) {
      return switch (section) {
         case GENERAL -> class_1802.field_8557;
         case COMBAT -> class_1802.field_8802;
         case VISUAL -> class_1802.field_8449;
         case SHADERS -> class_1802.field_17525;
         case TEXTURES -> class_1802.field_8288;
      };
   }

   @Override
   public void method_25394(class_332 ctx, int mouseX, int mouseY, float delta) {
      super.method_25394(ctx, mouseX, mouseY, delta);
      List<Module> listed = Hud.modules().stream().filter(Module::listedInMenus).toList();
      long on = listed.stream().filter(Module::isEnabled).count();
      String where = Presets.names().size() > 1 ? Presets.active() + " · " : "";
      ctx.method_27534(
         this.field_22793, class_2561.method_43470(where + on + " of " + listed.size() + " modules enabled"), this.field_22789 / 2, this.footerY + 28, -8355712
      );
   }

   @Override
   public void method_25419() {
      Graphics.applyLater();
      super.method_25419();
   }

   private record Tile(String label, class_1792 item, Runnable open) {
   }
}
