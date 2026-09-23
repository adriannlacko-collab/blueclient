package com.blueclient.screen;

import com.blueclient.hud.modules.HotkeysModule;
import com.blueclient.ui.Widgets;
import com.blueclient.ui.input.BlueButton;
import com.blueclient.ui.input.Inputs;
import com.mojang.blaze3d.platform.InputConstants;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.ChatFormatting;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.components.Tooltip;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.CommonComponents;
import net.minecraft.network.chat.Component;

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

   public HotkeyStepScreen(Screen parent, HotkeysModule.Hotkey hotkey, HotkeysModule.Step step, boolean fresh) {
      super(parent, Component.literal(title(step)));
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
   protected Component footerLabel() {
      return CommonComponents.GUI_DONE.copy().withStyle(ChatFormatting.GREEN);
   }

   @Override
   protected int content(int top) {
      this.blockWidth = WIDTH;
      this.blockLeft = (this.width - WIDTH) / 2;
      int x = this.blockLeft;
      int y = top;
      switch (this.step.type) {
         case HotkeysModule.CHAT:
            EditBox text = new EditBox(this.font, x, y, WIDTH, 20, Component.literal("Message"));
            text.setMaxLength(256);
            text.setValue(this.step.text);
            text.setHint(Component.literal("hello, or /spawn").withStyle(ChatFormatting.DARK_GRAY));
            text.setResponder(value -> this.step.text = value);
            this.addRenderableWidget(text);
            this.setFocused(text);
            y += 24;
            break;
         case HotkeysModule.PRESS:
            List<String> names = new ArrayList<>();

            for (KeyMapping mapping : HotkeysModule.mappings(this.minecraft)) {
               names.add(mapping.getName());
            }

            if (!names.contains(this.step.mapping)) {
               names.add(0, this.step.mapping);
            }

            this.addRenderableWidget(
               Widgets.cycling(HotkeysModule::mappingName, this.step.mapping, names)
                  .create(x, y, WIDTH, 20, Component.literal("Action"), (button, value) -> this.step.mapping = value)
            );
            y += 24;
            Button pick = new HotkeyStepScreen.PickButton(x, y);
            this.addRenderableWidget(pick);
            y += 24;
            this.addRenderableWidget(
               Widgets.cycling(HotkeyStepScreen::holdLabel, this.step.length, withValue(HOLDS, this.step.length))
                  .create(x, y, WIDTH, 20, Component.literal("Hold"), (button, value) -> this.step.length = value)
            );
            y += 24;
            break;
         case HotkeysModule.WAIT:
            this.addRenderableWidget(
               Widgets.cycling(HotkeyStepScreen::waitLabel, this.step.length, withValue(WAITS, this.step.length))
                  .create(x, y, WIDTH, 20, Component.literal("Wait"), (button, value) -> this.step.length = value)
            );
            y += 24;
            break;
         default:
            this.addRenderableWidget(
               Widgets.cycling(VanillaScreen::onOff, this.step.look, List.of(Boolean.TRUE, Boolean.FALSE))
                  .create(x, y, WIDTH, 20, Component.literal("Turn the camera"), (button, value) -> this.step.look = value)
            );
            y += 24;
            Button again = Button.builder(Component.literal("● ").withStyle(ChatFormatting.RED).append(Component.literal("Record again").withStyle(ChatFormatting.WHITE)), button -> HotkeysModule.startRecording(this.minecraft, this.hotkey, this.step, this.parent))
               .bounds(x, y, WIDTH, 20)
               .build();
            again.active = this.minecraft != null && this.minecraft.player != null;
            again.setTooltip(Tooltip.create(Component.literal("Closes this menu and records over this movement until you press Esc")));
            this.addRenderableWidget(again);
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

   private static Component holdLabel(int ticks) {
      return Component.literal(ticks <= 1 ? "Tap" : HotkeysModule.seconds(ticks));
   }

   private static Component waitLabel(int ticks) {
      return Component.literal(HotkeysModule.seconds(ticks));
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

   private void pick(InputConstants.Key key) {
      this.listening = false;
      KeyMapping mapping = key == null ? null : HotkeysModule.boundTo(this.minecraft, key);
      if (mapping != null) {
         this.step.mapping = mapping.getName();
      }

      this.scheduleRebuild();
   }

   @Override
   public void onClose() {
      boolean keep = !HotkeysModule.CHAT.equals(this.step.type) || !this.step.text.isBlank();
      if (this.fresh && keep && !this.hotkey.steps.contains(this.step)) {
         this.hotkey.steps.add(this.step);
      } else if (!keep) {
         this.hotkey.steps.remove(this.step);
      }

      HotkeysModule.saveStore();
      super.onClose();
   }

   private class PickButton extends BlueButton {
      PickButton(int x, int y) {
         super(x, y, HotkeyStepScreen.WIDTH, 20, Component.empty(), button -> {});
         this.setMessage(
            HotkeyStepScreen.this.listening
               ? Component.literal("> ").append(Component.literal("Press its key").withStyle(ChatFormatting.YELLOW)).append(Component.literal(" <"))
               : Component.literal("Pick by pressing its key")
         );
         this.setTooltip(Tooltip.create(Component.literal("Press the key you use for it in Controls, and the action it does is picked")));
      }

      @Override
      protected void pressed() {
         HotkeyStepScreen.this.listening = true;
         HotkeyStepScreen.this.scheduleRebuild();
      }
   }
}
