package com.blueclient.screen;

import com.blueclient.hud.modules.HotkeysModule;
import com.blueclient.ui.Screens;
import com.blueclient.ui.Widgets;
import com.blueclient.ui.input.BlueButton;
import com.blueclient.ui.input.Inputs;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.class_124;
import net.minecraft.class_2561;
import net.minecraft.class_304;
import net.minecraft.class_342;
import net.minecraft.class_3675;
import net.minecraft.class_4185;
import net.minecraft.class_437;
import net.minecraft.class_5244;
import net.minecraft.class_5676;
import net.minecraft.class_7919;

/** One hotkey: its name, key, how it runs, and its list of actions. */
public class HotkeyEditScreen extends VanillaScreen {
   private static final int GRID_W = 308;
   private static final int HALF = 150;
   private static final int SMALL_W = 20;
   /** Two rows of add buttons, the footer and the line under it. */
   private static final int TAIL = 80;
   private static final int ESCAPE = 256;
   private static final List<Integer> LOOPS = List.of(0, 2, 3, 5, 10, 20, 50, 100);
   private static final List<Integer> GAPS = List.of(0, 5, 10, 20, 40, 60, 100, 200, 600, 1200);
   private final HotkeysModule.Hotkey hotkey;
   private HotkeyEditScreen.KeyButton listening;

   public HotkeyEditScreen(class_437 parent, HotkeysModule.Hotkey hotkey) {
      super(parent, class_2561.method_43470("Edit Hotkey"));
      this.hotkey = hotkey;
   }

   @Override
   protected String subtitle() {
      if (this.listening != null) {
         return "Press the key for this hotkey — Esc clears it";
      } else {
         class_304 clash = HotkeysModule.boundTo(this.field_22787, this.hotkey.bound().get());
         return clash != null
            ? "Heads up: this key also does \"" + HotkeysModule.mappingName(clash).getString() + "\" in Controls"
            : this.hotkey.modeNote();
      }
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
      this.blockWidth = GRID_W;
      this.blockLeft = (this.field_22789 - GRID_W) / 2;
      int x = this.blockLeft;
      int right = x + HALF + 8;
      int y = top;
      class_342 name = new class_342(this.field_22793, x, y, HALF, 20, class_2561.method_43470("Name"));
      name.method_1880(32);
      name.method_1852(this.hotkey.name);
      name.method_47404(class_2561.method_43470("Name").method_27692(class_124.field_1063));
      name.method_47400(class_7919.method_47407(class_2561.method_43470("Name")));
      name.method_1863(text -> {
         if (!text.isBlank()) {
            this.hotkey.name = text.trim();
         }
      });
      this.method_37063(name);
      this.method_37063(new HotkeyEditScreen.KeyButton(right, y, GRID_W - HALF - 8));
      y += 24;
      this.method_37063(
         Widgets.cycling(HotkeysModule.Hotkey::modeLabel, this.hotkey.mode, HotkeysModule.MODES)
            .method_32617(x, y, HALF, 20, class_2561.method_43470("Mode"), (button, value) -> {
               this.hotkey.mode = value;
               this.scheduleRebuild();
            })
      );
      this.method_37063(
         Widgets.cycling(VanillaScreen::onOff, this.hotkey.enabled, List.of(Boolean.TRUE, Boolean.FALSE))
            .method_32617(right, y, GRID_W - HALF - 8, 20, class_2561.method_43470("Enabled"), (button, value) -> {
               this.hotkey.enabled = value;
               HotkeysModule module = HotkeysModule.instance();
               if (!value && module != null) {
                  module.stop(this.field_22787, this.hotkey, false);
               }
            })
      );
      y += 24;
      boolean once = HotkeysModule.ONCE.equals(this.hotkey.mode);
      class_5676<Integer> loops = Widgets.cycling(HotkeyEditScreen::loopsLabel, this.hotkey.loops, withValue(LOOPS, this.hotkey.loops))
         .method_32617(x, y, HALF, 20, class_2561.method_43470("Runs"), (button, value) -> this.hotkey.loops = value);
      loops.field_22763 = HotkeysModule.LOOP.equals(this.hotkey.mode);
      loops.method_47400(class_7919.method_47407(class_2561.method_43470("How many times a loop runs before it stops by itself")));
      this.method_37063(loops);
      class_5676<Integer> gap = Widgets.cycling(HotkeyEditScreen::gapLabel, this.hotkey.gap, withValue(GAPS, this.hotkey.gap))
         .method_32617(right, y, GRID_W - HALF - 8, 20, class_2561.method_43470("Pause"), (button, value) -> this.hotkey.gap = value);
      gap.field_22763 = !once;
      gap.method_47400(class_7919.method_47407(class_2561.method_43470("The pause between one run through the actions and the next")));
      this.method_37063(gap);
      y += 28;
      this.method_37063(
         Widgets.heading(x, y, GRID_W, 12, class_2561.method_43470(this.hotkey.steps.isEmpty() ? "No actions yet — add one below" : "Actions, in order"), this.field_22793, -6250336)
      );
      y += 14;
      List<HotkeysModule.Step> steps = this.hotkey.steps;
      int offset = this.fitRows(y, steps.size(), TAIL);
      int last = Math.min(steps.size(), offset + this.rows);

      for (int i = offset; i < last; i++) {
         this.addStepRow(i, x, y + (i - offset) * 24);
      }

      y += (steps.isEmpty() ? 0 : Math.min(this.rows, steps.size())) * 24;
      int third = (GRID_W - 8) / 3;
      this.addStepButton("+ Chat / command", HotkeysModule.CHAT, x, y, third, "Say something in chat, or run a command when it starts with /");
      this.addStepButton("+ Key press", HotkeysModule.PRESS, x + third + 4, y, third, "Press or hold one of the game's keys: jump, attack, use, drop, a hotbar slot...");
      this.addStepButton("+ Wait", HotkeysModule.WAIT, x + (third + 4) * 2, y, GRID_W - (third + 4) * 2, "Wait a moment before the next action");
      y += 24;
      class_4185 record = class_4185.method_46430(class_2561.method_43470("● ").method_27692(class_124.field_1061).method_10852(class_2561.method_43470("Record movement").method_27692(class_124.field_1068)), button -> {
            this.saveName();
            HotkeysModule.startRecording(this.field_22787, this.hotkey, null, this);
         })
         .method_46434(x, y, GRID_W, 20)
         .method_46431();
      record.field_22763 = this.field_22787 != null && this.field_22787.field_1724 != null;
      record.method_47400(
         class_7919.method_47407(
            class_2561.method_43470(
               "Closes this menu and records walking, jumping, sneaking, sprinting, clicks, hotbar and camera until you press Esc — then it is an action of this hotkey"
            )
         )
      );
      this.method_37063(record);
      return y + 24;
   }

   private void addStepRow(int index, int x, int y) {
      HotkeysModule.Step step = this.hotkey.steps.get(index);
      int labelW = this.blockWidth - (SMALL_W + 2) * 2;
      class_4185 label = class_4185.method_46430(class_2561.method_43473().method_10852(class_2561.method_43470((index + 1) + ". ").method_27692(class_124.field_1080)).method_10852(step.label()), button -> Screens.open(
            this.field_22787, new HotkeyStepScreen(this, this.hotkey, step, false)
         ))
         .method_46434(x, y, labelW, 20)
         .method_46431();
      label.method_47400(class_7919.method_47407(class_2561.method_43470("Edit")));
      this.method_37063(label);
      class_4185 up = class_4185.method_46430(class_2561.method_43470("↑"), button -> {
         List<HotkeysModule.Step> steps = this.hotkey.steps;
         int at = steps.indexOf(step);
         if (at > 0) {
            steps.set(at, steps.get(at - 1));
            steps.set(at - 1, step);
            HotkeysModule.saveStore();
            this.scheduleRebuild();
         }
      }).method_46434(x + labelW + 2, y, SMALL_W, 20).method_46431();
      up.field_22763 = index > 0;
      up.method_47400(class_7919.method_47407(class_2561.method_43470("Move up")));
      this.method_37063(up);
      class_4185 remove = class_4185.method_46430(class_2561.method_43470("X").method_27692(class_124.field_1061), button -> {
         HotkeysModule module = HotkeysModule.instance();
         if (module != null) {
            module.stop(this.field_22787, this.hotkey, false);
         }

         this.hotkey.steps.remove(step);
         HotkeysModule.saveStore();
         this.scheduleRebuild();
      }).method_46434(x + labelW + 2 + SMALL_W + 2, y, SMALL_W, 20).method_46431();
      remove.method_47400(class_7919.method_47407(class_2561.method_43470("Remove")));
      this.method_37063(remove);
   }

   private void addStepButton(String text, String type, int x, int y, int w, String about) {
      class_4185 button = class_4185.method_46430(class_2561.method_43470(text), press -> {
         this.saveName();
         Screens.open(this.field_22787, new HotkeyStepScreen(this, this.hotkey, HotkeysModule.Step.of(type), true));
      }).method_46434(x, y, w, 20).method_46431();
      button.method_47400(class_7919.method_47407(class_2561.method_43470(about)));
      this.method_37063(button);
   }

   private static List<Integer> withValue(List<Integer> values, int value) {
      if (values.contains(value)) {
         return values;
      } else {
         List<Integer> out = new ArrayList<>(values);
         out.add(value);
         out.sort(Integer::compare);
         return out;
      }
   }

   private static class_2561 loopsLabel(int loops) {
      return class_2561.method_43470(loops <= 0 ? "Until pressed again" : loops + " times");
   }

   private static class_2561 gapLabel(int ticks) {
      return class_2561.method_43470(ticks <= 0 ? "None" : HotkeysModule.seconds(ticks));
   }

   private void saveName() {
      if (this.hotkey.name.isBlank()) {
         this.hotkey.name = "Hotkey";
      }

      HotkeysModule.saveStore();
   }

   @Override
   protected boolean onKey(int keyCode, int scanCode, int modifiers) {
      if (this.listening == null) {
         return super.onKey(keyCode, scanCode, modifiers);
      } else {
         this.listening.take(keyCode == ESCAPE ? HotkeysModule.unbound() : Inputs.keyOf(keyCode, scanCode));
         return true;
      }
   }

   @Override
   protected boolean onClick(double mouseX, double mouseY, int button) {
      if (this.listening != null) {
         this.listening.take(Inputs.mouseOf(button));
         return true;
      } else {
         return super.onClick(mouseX, mouseY, button);
      }
   }

   @Override
   public void method_25419() {
      this.saveName();
      super.method_25419();
   }

   private class KeyButton extends BlueButton {
      KeyButton(int x, int y, int w) {
         super(x, y, w, 20, class_2561.method_43473(), button -> {});
         this.method_47400(class_7919.method_47407(class_2561.method_43470("The key that runs this hotkey. Click, then press a key or a mouse button; Esc clears it")));
         this.refresh();
      }

      @Override
      protected void pressed() {
         HotkeyEditScreen.this.listening = this;
         this.refresh();
      }

      void take(class_3675.class_306 key) {
         HotkeyEditScreen.this.hotkey.setKey(key);
         HotkeyEditScreen.this.listening = null;
         HotkeysModule.saveStore();
         this.refresh();
      }

      void refresh() {
         if (HotkeyEditScreen.this.listening == this) {
            this.method_25355(class_2561.method_43470("> ").method_10852(class_2561.method_43470("Press a key").method_27692(class_124.field_1054)).method_10852(class_2561.method_43470(" <")));
         } else {
            this.method_25355(class_2561.method_43470("Key: ").method_10852(HotkeyEditScreen.this.hotkey.keyLabel()));
         }
      }
   }
}
