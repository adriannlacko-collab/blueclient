package com.blueclient.screen;

import com.blueclient.hud.modules.HotkeysModule;
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
import net.minecraft.class_7919;

/** One action of a hotkey. A new one joins the hotkey when Done is pressed with something in it. */
public class HotkeyStepScreen extends VanillaScreen {
   private static final int WIDTH = 240;
   private static final int ESCAPE = 256;
   private static final List<Integer> HOLDS = List.of(1, 5, 10, 20, 40, 60, 100, 200, 400, 1200);
   private static final List<Integer> WAITS = List.of(1, 2, 5, 10, 20, 30, 40, 60, 100, 200, 400, 600, 1200, 2400, 6000);
   private final HotkeysModule.Hotkey hotkey;
   private final HotkeysModule.Step step;
   private final boolean fresh;
   private boolean listening;

   public HotkeyStepScreen(class_437 parent, HotkeysModule.Hotkey hotkey, HotkeysModule.Step step, boolean fresh) {
      super(parent, class_2561.method_43470(title(step)));
      this.hotkey = hotkey;
      this.step = step;
      this.fresh = fresh;
   }

   private static String title(HotkeysModule.Step step) {
      return switch (step.type) {
         case HotkeysModule.CHAT -> "Chat or Command";
         case HotkeysModule.PRESS -> "Key Press";
         case HotkeysModule.WAIT -> "Wait";
         default -> "Recorded Movement";
      };
   }

   @Override
   protected String subtitle() {
      return switch (this.step.type) {
         case HotkeysModule.CHAT -> "Sent as you would type it — start with / for a command";
         case HotkeysModule.PRESS -> this.listening ? "Press the key of the action you want — Esc to cancel" : "Pressed as if you pressed it yourself";
         case HotkeysModule.WAIT -> "Nothing happens for this long, then the next action runs";
         default -> HotkeysModule.seconds(this.step.ticks()) + " of walking, jumping, clicks, hotbar and camera";
      };
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
      this.blockWidth = WIDTH;
      this.blockLeft = (this.field_22789 - WIDTH) / 2;
      int x = this.blockLeft;
      int y = top;
      switch (this.step.type) {
         case HotkeysModule.CHAT:
            class_342 text = new class_342(this.field_22793, x, y, WIDTH, 20, class_2561.method_43470("Message"));
            text.method_1880(256);
            text.method_1852(this.step.text);
            text.method_47404(class_2561.method_43470("hello, or /spawn").method_27692(class_124.field_1063));
            text.method_1863(value -> this.step.text = value);
            this.method_37063(text);
            this.method_25395(text);
            y += 24;
            break;
         case HotkeysModule.PRESS:
            List<String> names = new ArrayList<>();

            for (class_304 mapping : HotkeysModule.mappings(this.field_22787)) {
               names.add(mapping.method_1431());
            }

            if (!names.contains(this.step.mapping)) {
               names.add(0, this.step.mapping);
            }

            this.method_37063(
               Widgets.cycling(HotkeysModule::mappingName, this.step.mapping, names)
                  .method_32617(x, y, WIDTH, 20, class_2561.method_43470("Action"), (button, value) -> this.step.mapping = value)
            );
            y += 24;
            class_4185 pick = new HotkeyStepScreen.PickButton(x, y);
            this.method_37063(pick);
            y += 24;
            this.method_37063(
               Widgets.cycling(HotkeyStepScreen::holdLabel, this.step.length, withValue(HOLDS, this.step.length))
                  .method_32617(x, y, WIDTH, 20, class_2561.method_43470("Hold"), (button, value) -> this.step.length = value)
            );
            y += 24;
            break;
         case HotkeysModule.WAIT:
            this.method_37063(
               Widgets.cycling(HotkeyStepScreen::waitLabel, this.step.length, withValue(WAITS, this.step.length))
                  .method_32617(x, y, WIDTH, 20, class_2561.method_43470("Wait"), (button, value) -> this.step.length = value)
            );
            y += 24;
            break;
         default:
            this.method_37063(
               Widgets.cycling(VanillaScreen::onOff, this.step.look, List.of(Boolean.TRUE, Boolean.FALSE))
                  .method_32617(x, y, WIDTH, 20, class_2561.method_43470("Turn the camera"), (button, value) -> this.step.look = value)
            );
            y += 24;
            class_4185 again = class_4185.method_46430(class_2561.method_43470("● ").method_27692(class_124.field_1061).method_10852(class_2561.method_43470("Record again").method_27692(class_124.field_1068)), button -> HotkeysModule.startRecording(this.field_22787, this.hotkey, this.step, this.parent))
               .method_46434(x, y, WIDTH, 20)
               .method_46431();
            again.field_22763 = this.field_22787 != null && this.field_22787.field_1724 != null;
            again.method_47400(class_7919.method_47407(class_2561.method_43470("Closes this menu and records over this movement until you press Esc")));
            this.method_37063(again);
            y += 24;
      }

      return y;
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

   private static class_2561 holdLabel(int ticks) {
      return class_2561.method_43470(ticks <= 1 ? "Tap" : HotkeysModule.seconds(ticks));
   }

   private static class_2561 waitLabel(int ticks) {
      return class_2561.method_43470(HotkeysModule.seconds(ticks));
   }

   @Override
   protected boolean onKey(int keyCode, int scanCode, int modifiers) {
      if (!this.listening) {
         return super.onKey(keyCode, scanCode, modifiers);
      } else {
         this.pick(keyCode == ESCAPE ? null : Inputs.keyOf(keyCode, scanCode));
         return true;
      }
   }

   @Override
   protected boolean onClick(double mouseX, double mouseY, int button) {
      if (this.listening) {
         this.pick(Inputs.mouseOf(button));
         return true;
      } else {
         return super.onClick(mouseX, mouseY, button);
      }
   }

   private void pick(class_3675.class_306 key) {
      this.listening = false;
      class_304 mapping = key == null ? null : HotkeysModule.boundTo(this.field_22787, key);
      if (mapping != null) {
         this.step.mapping = mapping.method_1431();
      }

      this.scheduleRebuild();
   }

   @Override
   public void method_25419() {
      boolean keep = !HotkeysModule.CHAT.equals(this.step.type) || !this.step.text.isBlank();
      if (this.fresh && keep && !this.hotkey.steps.contains(this.step)) {
         this.hotkey.steps.add(this.step);
      } else if (!keep) {
         this.hotkey.steps.remove(this.step);
      }

      HotkeysModule.saveStore();
      super.method_25419();
   }

   private class PickButton extends BlueButton {
      PickButton(int x, int y) {
         super(x, y, HotkeyStepScreen.WIDTH, 20, class_2561.method_43473(), button -> {});
         this.method_25355(
            HotkeyStepScreen.this.listening
               ? class_2561.method_43470("> ").method_10852(class_2561.method_43470("Press its key").method_27692(class_124.field_1054)).method_10852(class_2561.method_43470(" <"))
               : class_2561.method_43470("Pick by pressing its key")
         );
         this.method_47400(class_7919.method_47407(class_2561.method_43470("Press the key you use for it in Controls, and the action it does is picked")));
      }

      @Override
      protected void pressed() {
         HotkeyStepScreen.this.listening = true;
         HotkeyStepScreen.this.scheduleRebuild();
      }
   }
}
