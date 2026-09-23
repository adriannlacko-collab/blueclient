package com.blueclient.screen;

import com.blueclient.hud.modules.HotkeysModule;
import com.blueclient.ui.Icon;
import com.blueclient.ui.Screens;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import net.minecraft.class_124;
import net.minecraft.class_2561;
import net.minecraft.class_4185;
import net.minecraft.class_437;
import net.minecraft.class_5244;
import net.minecraft.class_7919;

/** The hotkeys, laid out like the Waypoints page: a row each, then Add Hotkey and Settings. */
public class HotkeysScreen extends VanillaScreen {
   private static final int GRID_W = 308;
   private static final int SMALL_W = 20;
   private static final int TAIL = 80;

   public HotkeysScreen(class_437 parent) {
      super(parent, class_2561.method_43470("Hotkeys"));
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
   protected class_2561 footerLabel() {
      return class_5244.field_24339.method_27661().method_27692(class_124.field_1061);
   }

   @Override
   protected int content(int top) {
      this.blockWidth = GRID_W;
      this.blockLeft = (this.field_22789 - GRID_W) / 2;
      List<HotkeysModule.Hotkey> hotkeys = this.shown();
      int offset = this.fitRows(top, hotkeys.size(), TAIL);
      int last = Math.min(hotkeys.size(), offset + this.rows);

      for (int i = offset; i < last; i++) {
         this.addRow(hotkeys.get(i), this.blockLeft, top + (i - offset) * 24);
      }

      int y = top + (hotkeys.isEmpty() ? 0 : Math.min(this.rows, hotkeys.size())) * 24;
      int half = 150;
      class_4185 add = class_4185.method_46430(class_2561.method_43470("Add Hotkey"), button -> this.addHotkey()).method_46434(this.blockLeft, y, half, 20).method_46431();
      add.method_47400(class_7919.method_47407(class_2561.method_43470("A new hotkey: pick its key, then add chat lines, commands, key presses or a recording")));
      this.method_37063(add);
      class_4185 settings = class_4185.method_46430(
            class_2561.method_43470("Settings"), button -> Screens.open(this.field_22787, new VanillaOptionsScreen(this, HotkeysModule.instance(), true))
         )
         .method_46434(this.blockLeft + half + 8, y, GRID_W - half - 8, 20)
         .method_46431();
      settings.method_47400(class_7919.method_47407(class_2561.method_43470("The Hotkeys switch, a stop-all key, stopping on damage and the gap between chat lines")));
      this.method_37063(settings);
      return y + 24;
   }

   private void addRow(HotkeysModule.Hotkey hotkey, int x, int y) {
      HotkeysModule module = HotkeysModule.instance();
      int toggleW = this.blockWidth - (SMALL_W + 2) * 3;
      class_4185 toggle = class_4185.method_46430(this.rowLabel(hotkey), button -> {
         hotkey.enabled = !hotkey.enabled;
         if (!hotkey.enabled && module != null) {
            module.stop(this.field_22787, hotkey, false);
         }

         HotkeysModule.saveStore();
         button.method_25355(this.rowLabel(hotkey));
      }).method_46434(x, y, toggleW, 20).method_46431();
      toggle.method_47400(class_7919.method_47407(this.summary(hotkey)));
      this.method_37063(toggle);
      boolean running = module != null && module.running(hotkey);
      class_4185 run = class_4185.method_46430(class_2561.method_43470(running ? "■" : "▶").method_27692(running ? class_124.field_1061 : class_124.field_1060), button -> {
         if (module != null) {
            if (module.running(hotkey)) {
               module.stop(this.field_22787, hotkey, false);
               this.scheduleRebuild();
            } else {
               Screens.open(this.field_22787, null);
               module.start(this.field_22787, hotkey);
            }
         }
      }).method_46434(x + toggleW + 2, y, SMALL_W, 20).method_46431();
      run.field_22763 = running
         || module != null && module.isEnabled() && !hotkey.steps.isEmpty() && this.field_22787 != null && this.field_22787.field_1724 != null;
      run.method_47400(class_7919.method_47407(class_2561.method_43470(running ? "Stop" : "Close this menu and run it now")));
      this.method_37063(run);
      class_4185 gear = new IconButton(
         x + toggleW + 2 + SMALL_W + 2, y, SMALL_W, 20, class_2561.method_43473(), button -> Screens.open(this.field_22787, new HotkeyEditScreen(this, hotkey)), Icon.GEAR
      );
      gear.method_47400(class_7919.method_47407(class_2561.method_43470("Edit")));
      this.method_37063(gear);
      class_4185 remove = class_4185.method_46430(class_2561.method_43470("X").method_27692(class_124.field_1061), button -> {
         HotkeysModule.remove(hotkey);
         this.scheduleRebuild();
      }).method_46434(x + toggleW + (SMALL_W + 2) * 2, y, SMALL_W, 20).method_46431();
      remove.method_47400(class_7919.method_47407(class_2561.method_43470("Remove")));
      this.method_37063(remove);
   }

   private class_2561 rowLabel(HotkeysModule.Hotkey hotkey) {
      return class_2561.method_43473()
         .method_10852(class_2561.method_43470(hotkey.name))
         .method_10852(class_2561.method_43470(" [").method_27692(class_124.field_1063))
         .method_10852(hotkey.keyLabel().method_27661().method_27692(class_124.field_1080))
         .method_10852(class_2561.method_43470("]: ").method_27692(class_124.field_1063))
         .method_10852(onOff(hotkey.enabled));
   }

   private class_2561 summary(HotkeysModule.Hotkey hotkey) {
      int count = hotkey.steps.size();
      String actions = count == 0 ? "no actions yet" : count + (count == 1 ? " action" : " actions");
      return class_2561.method_43470(hotkey.modeNote() + " — " + actions);
   }

   private void addHotkey() {
      Screens.open(this.field_22787, new HotkeyEditScreen(this, HotkeysModule.create()));
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
