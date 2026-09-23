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
import net.minecraft.ChatFormatting;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.CommonComponents;
import net.minecraft.network.chat.Component;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;

public class VanillaModsScreen extends VanillaScreen {
   private static final int BUTTON_W = 150;
   private static final int GRID_W = 308;
   private static final int TAIL = 52;

   public VanillaModsScreen(Screen parent) {
      super(parent, Component.literal("Blue Settings"));
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
   protected Component footerLabel() {
      return CommonComponents.GUI_DONE.copy().withStyle(ChatFormatting.GREEN);
   }

   @Override
   protected int content(int top) {
      this.blockWidth = 308;
      this.blockLeft = (this.width - 308) / 2;
      return this.searching() ? this.results(top) : this.categories(top);
   }

   private int categories(int top) {
      List<VanillaModsScreen.Tile> tiles = new ArrayList<>();

      for (Category section : Category.values()) {
         if (section.tile) {
            tiles.add(new VanillaModsScreen.Tile(section.label, itemFor(section), () -> Screens.open(this.minecraft, new VanillaCategoryScreen(this, section))));
         }
      }

      tiles.add(new VanillaModsScreen.Tile("Waypoints", Items.COMPASS, () -> Screens.open(this.minecraft, new WaypointsScreen(this))));
      tiles.add(new VanillaModsScreen.Tile("Layout", Items.ITEM_FRAME, () -> Screens.open(this.minecraft, new HudLayoutScreen(this))));
      tiles.add(new VanillaModsScreen.Tile("Presets", Items.WRITABLE_BOOK, () -> Screens.open(this.minecraft, new PresetsScreen(this))));
      int offset = this.fitRows(top, (tiles.size() + 1) / 2, 52);
      int first = offset * 2;
      int last = Math.min(tiles.size(), first + this.rows * 2);

      for (int i = first; i < last; i++) {
         VanillaModsScreen.Tile tile = tiles.get(i);
         int slot = i - first;
         this.addRenderableWidget(
            new ItemButton(
               this.tileX(i, tiles.size()),
               top + slot / 2 * 24,
               150,
               20,
               Component.literal(tile.label()),
               button -> tile.open().run(),
               new ItemStack(tile.item())
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

   private static Item itemFor(Category section) {
      return switch (section) {
         case GENERAL -> Items.CLOCK;
         case COMBAT -> Items.DIAMOND_SWORD;
         case VISUAL -> Items.ENDER_EYE;
         case SHADERS -> Items.SUNFLOWER;
         case TEXTURES -> Items.TOTEM_OF_UNDYING;
      };
   }

   @Override
   public void extractRenderState(GuiGraphicsExtractor ctx, int mouseX, int mouseY, float delta) {
      super.extractRenderState(ctx, mouseX, mouseY, delta);
      List<Module> listed = Hud.modules().stream().filter(Module::listedInMenus).toList();
      long on = listed.stream().filter(Module::isEnabled).count();
      String where = Presets.names().size() > 1 ? Presets.active() + " · " : "";
      ctx.centeredText(this.font, Component.literal(where + on + " of " + listed.size() + " modules enabled"), this.width / 2, this.footerY + 28, -8355712);
   }

   @Override
   public void onClose() {
      Graphics.applyLater();
      super.onClose();
   }

   private record Tile(String label, Item item, Runnable open) {
   }
}
