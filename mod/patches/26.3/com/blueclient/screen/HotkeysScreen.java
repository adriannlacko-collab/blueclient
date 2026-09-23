package com.blueclient.screen;

import com.blueclient.hud.modules.HotkeysModule;
import com.blueclient.ui.Icon;
import com.blueclient.ui.Screens;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import net.minecraft.ChatFormatting;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.Tooltip;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.CommonComponents;
import net.minecraft.network.chat.Component;

/** The hotkeys, laid out like the Waypoints page: a row each, then Add Hotkey and Settings. */
public class HotkeysScreen extends VanillaScreen {
   private static final int GRID_W = 308;
   private static final int SMALL_W = 20;
   private static final int TAIL = 80;

   public HotkeysScreen(Screen parent) {
      super(parent, Component.literal("Hotkeys"));
   }

   @Override
   protected String subtitle() {
      HotkeysModule module = HotkeysModule.instance();
      if (module != null && module.isHeldOff()) {
         return module.heldOffNote();
      } else if (module != null && !module.isEnabled()) {
         return "Hotkeys is off — switch it on in Settings";
      } else if (this.searching()) {
         int found = this.shown().size();
         return found == 0 ? "No hotkey matches \"" + this.query.trim() + "\"" : found + (found == 1 ? " hotkey matches" : " hotkeys match");
      } else {
         int count = HotkeysModule.all().size();
         if (count == 0) {
            return "No hotkeys yet — add one and give it a key";
         } else {
            int running = module == null ? 0 : module.runningCount();
            return count + (count == 1 ? " hotkey" : " hotkeys") + (running > 0 ? " — " + running + " running" : "") + (this.hasBar() ? " — scroll for more" : "");
         }
      }
   }

   @Override
   protected String searchHint() {
      return "Search hotkeys...";
   }

   @Override
   protected Component footerLabel() {
      return CommonComponents.GUI_BACK.copy().withStyle(ChatFormatting.RED);
   }

   @Override
   protected int content(int top) {
      this.blockWidth = GRID_W;
      this.blockLeft = (this.width - GRID_W) / 2;
      List<HotkeysModule.Hotkey> hotkeys = this.shown();
      int offset = this.fitRows(top, hotkeys.size(), TAIL);
      int last = Math.min(hotkeys.size(), offset + this.rows);

      for (int i = offset; i < last; i++) {
         this.addRow(hotkeys.get(i), this.blockLeft, top + (i - offset) * 24);
      }

      int y = top + (hotkeys.isEmpty() ? 0 : Math.min(this.rows, hotkeys.size())) * 24;
      int half = 150;
      Button add = Button.builder(Component.literal("Add Hotkey"), button -> this.addHotkey()).bounds(this.blockLeft, y, half, 20).build();
      add.setTooltip(Tooltip.create(Component.literal("A new hotkey: pick its key, then add chat lines, commands, key presses or a recording")));
      this.addRenderableWidget(add);
      Button settings = Button.builder(
            Component.literal("Settings"), button -> Screens.open(this.minecraft, new VanillaOptionsScreen(this, HotkeysModule.instance(), true))
         )
         .bounds(this.blockLeft + half + 8, y, GRID_W - half - 8, 20)
         .build();
      settings.setTooltip(Tooltip.create(Component.literal("The Hotkeys switch, a stop-all key, stopping on damage and the gap between chat lines")));
      this.addRenderableWidget(settings);
      return y + 24;
   }

   private void addRow(HotkeysModule.Hotkey hotkey, int x, int y) {
      HotkeysModule module = HotkeysModule.instance();
      int toggleW = this.blockWidth - (SMALL_W + 2) * 3;
      Button toggle = Button.builder(this.rowLabel(hotkey), button -> {
         hotkey.enabled = !hotkey.enabled;
         if (!hotkey.enabled && module != null) {
            module.stop(this.minecraft, hotkey, false);
         }

         HotkeysModule.saveStore();
         button.setMessage(this.rowLabel(hotkey));
      }).bounds(x, y, toggleW, 20).build();
      toggle.setTooltip(Tooltip.create(this.summary(hotkey)));
      this.addRenderableWidget(toggle);
      boolean running = module != null && module.running(hotkey);
      Button run = Button.builder(Component.literal(running ? "■" : "▶").withStyle(running ? ChatFormatting.RED : ChatFormatting.GREEN), button -> {
         if (module != null) {
            if (module.running(hotkey)) {
               module.stop(this.minecraft, hotkey, false);
               this.scheduleRebuild();
            } else {
               Screens.open(this.minecraft, null);
               module.start(this.minecraft, hotkey);
            }
         }
      }).bounds(x + toggleW + 2, y, SMALL_W, 20).build();
      run.active = running
         || module != null && module.isEnabled() && !hotkey.steps.isEmpty() && this.minecraft != null && this.minecraft.player != null;
      run.setTooltip(Tooltip.create(Component.literal(running ? "Stop" : "Close this menu and run it now")));
      this.addRenderableWidget(run);
      Button gear = new IconButton(
         x + toggleW + 2 + SMALL_W + 2, y, SMALL_W, 20, Component.empty(), button -> Screens.open(this.minecraft, new HotkeyEditScreen(this, hotkey)), Icon.GEAR
      );
      gear.setTooltip(Tooltip.create(Component.literal("Edit")));
      this.addRenderableWidget(gear);
      Button remove = Button.builder(Component.literal("X").withStyle(ChatFormatting.RED), button -> {
         HotkeysModule.remove(hotkey);
         this.scheduleRebuild();
      }).bounds(x + toggleW + (SMALL_W + 2) * 2, y, SMALL_W, 20).build();
      remove.setTooltip(Tooltip.create(Component.literal("Remove")));
      this.addRenderableWidget(remove);
   }

   private Component rowLabel(HotkeysModule.Hotkey hotkey) {
      return Component.empty()
         .append(Component.literal(hotkey.name))
         .append(Component.literal(" [").withStyle(ChatFormatting.DARK_GRAY))
         .append(hotkey.keyLabel().copy().withStyle(ChatFormatting.GRAY))
         .append(Component.literal("]: ").withStyle(ChatFormatting.DARK_GRAY))
         .append(onOff(hotkey.enabled));
   }

   private Component summary(HotkeysModule.Hotkey hotkey) {
      int count = hotkey.steps.size();
      String actions = count == 0 ? "no actions yet" : count + (count == 1 ? " action" : " actions");
      return Component.literal(hotkey.modeNote() + " — " + actions);
   }

   private void addHotkey() {
      Screens.open(this.minecraft, new HotkeyEditScreen(this, HotkeysModule.create()));
   }

   private List<HotkeysModule.Hotkey> shown() {
      List<HotkeysModule.Hotkey> all = HotkeysModule.all();
      String needle = this.needle();
      if (needle.isEmpty()) {
         return all;
      } else {
         List<HotkeysModule.Hotkey> out = new ArrayList<>();

         for (HotkeysModule.Hotkey hotkey : all) {
            if (hotkey.name.toLowerCase(Locale.ROOT).contains(needle)) {
               out.add(hotkey);
            }
         }

         return out;
      }
   }
}
