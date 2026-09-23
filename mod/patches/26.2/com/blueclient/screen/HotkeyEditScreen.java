package com.blueclient.screen;

import com.blueclient.hud.modules.HotkeysModule;
import com.blueclient.ui.Screens;
import com.blueclient.ui.Widgets;
import com.blueclient.ui.input.BlueButton;
import com.blueclient.ui.input.Inputs;
import com.mojang.blaze3d.platform.InputConstants;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.ChatFormatting;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.CycleButton;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.components.Tooltip;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.CommonComponents;
import net.minecraft.network.chat.Component;

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

   public HotkeyEditScreen(Screen parent, HotkeysModule.Hotkey hotkey) {
      super(parent, Component.literal("Edit Hotkey"));
      this.hotkey = hotkey;
   }

   @Override
   protected String subtitle() {
      if (this.listening != null) {
         return "Press the key for this hotkey — Esc clears it";
      } else {
         KeyMapping clash = HotkeysModule.boundTo(this.minecraft, this.hotkey.bound().get());
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
   protected Component footerLabel() {
      return CommonComponents.GUI_DONE.copy().withStyle(ChatFormatting.GREEN);
   }

   @Override
   protected int content(int top) {
      this.blockWidth = GRID_W;
      this.blockLeft = (this.width - GRID_W) / 2;
      int x = this.blockLeft;
      int right = x + HALF + 8;
      int y = top;
      EditBox name = new EditBox(this.font, x, y, HALF, 20, Component.literal("Name"));
      name.setMaxLength(32);
      name.setValue(this.hotkey.name);
      name.setHint(Component.literal("Name").withStyle(ChatFormatting.DARK_GRAY));
      name.setTooltip(Tooltip.create(Component.literal("Name")));
      name.setResponder(text -> {
         if (!text.isBlank()) {
            this.hotkey.name = text.trim();
         }
      });
      this.addRenderableWidget(name);
      this.addRenderableWidget(new HotkeyEditScreen.KeyButton(right, y, GRID_W - HALF - 8));
      y += 24;
      this.addRenderableWidget(
         Widgets.cycling(HotkeysModule.Hotkey::modeLabel, this.hotkey.mode, HotkeysModule.MODES)
            .create(x, y, HALF, 20, Component.literal("Mode"), (button, value) -> {
               this.hotkey.mode = value;
               this.scheduleRebuild();
            })
      );
      this.addRenderableWidget(
         Widgets.cycling(VanillaScreen::onOff, this.hotkey.enabled, List.of(Boolean.TRUE, Boolean.FALSE))
            .create(right, y, GRID_W - HALF - 8, 20, Component.literal("Enabled"), (button, value) -> {
               this.hotkey.enabled = value;
               HotkeysModule module = HotkeysModule.instance();
               if (!value && module != null) {
                  module.stop(this.minecraft, this.hotkey, false);
               }
            })
      );
      y += 24;
      boolean once = HotkeysModule.ONCE.equals(this.hotkey.mode);
      CycleButton<Integer> loops = Widgets.cycling(HotkeyEditScreen::loopsLabel, this.hotkey.loops, withValue(LOOPS, this.hotkey.loops))
         .create(x, y, HALF, 20, Component.literal("Runs"), (button, value) -> this.hotkey.loops = value);
      loops.active = HotkeysModule.LOOP.equals(this.hotkey.mode);
      loops.setTooltip(Tooltip.create(Component.literal("How many times a loop runs before it stops by itself")));
      this.addRenderableWidget(loops);
      CycleButton<Integer> gap = Widgets.cycling(HotkeyEditScreen::gapLabel, this.hotkey.gap, withValue(GAPS, this.hotkey.gap))
         .create(right, y, GRID_W - HALF - 8, 20, Component.literal("Pause"), (button, value) -> this.hotkey.gap = value);
      gap.active = !once;
      gap.setTooltip(Tooltip.create(Component.literal("The pause between one run through the actions and the next")));
      this.addRenderableWidget(gap);
      y += 28;
      this.addRenderableWidget(
         Widgets.heading(x, y, GRID_W, 12, Component.literal(this.hotkey.steps.isEmpty() ? "No actions yet — add one below" : "Actions, in order"), this.font, -6250336)
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
      Button record = Button.builder(Component.literal("● ").withStyle(ChatFormatting.RED).append(Component.literal("Record movement").withStyle(ChatFormatting.WHITE)), button -> {
            this.saveName();
            HotkeysModule.startRecording(this.minecraft, this.hotkey, null, this);
         })
         .bounds(x, y, GRID_W, 20)
         .build();
      record.active = this.minecraft != null && this.minecraft.player != null;
      record.setTooltip(
         Tooltip.create(
            Component.literal(
               "Closes this menu and records walking, jumping, sneaking, sprinting, clicks, hotbar and camera until you press Esc — then it is an action of this hotkey"
            )
         )
      );
      this.addRenderableWidget(record);
      return y + 24;
   }

   private void addStepRow(int index, int x, int y) {
      HotkeysModule.Step step = this.hotkey.steps.get(index);
      int labelW = this.blockWidth - (SMALL_W + 2) * 2;
      Button label = Button.builder(Component.empty().append(Component.literal((index + 1) + ". ").withStyle(ChatFormatting.GRAY)).append(step.label()), button -> Screens.open(
            this.minecraft, new HotkeyStepScreen(this, this.hotkey, step, false)
         ))
         .bounds(x, y, labelW, 20)
         .build();
      label.setTooltip(Tooltip.create(Component.literal("Edit")));
      this.addRenderableWidget(label);
      Button up = Button.builder(Component.literal("↑"), button -> {
         List<HotkeysModule.Step> steps = this.hotkey.steps;
         int at = steps.indexOf(step);
         if (at > 0) {
            steps.set(at, steps.get(at - 1));
            steps.set(at - 1, step);
            HotkeysModule.saveStore();
            this.scheduleRebuild();
         }
      }).bounds(x + labelW + 2, y, SMALL_W, 20).build();
      up.active = index > 0;
      up.setTooltip(Tooltip.create(Component.literal("Move up")));
      this.addRenderableWidget(up);
      Button remove = Button.builder(Component.literal("X").withStyle(ChatFormatting.RED), button -> {
         HotkeysModule module = HotkeysModule.instance();
         if (module != null) {
            module.stop(this.minecraft, this.hotkey, false);
         }

         this.hotkey.steps.remove(step);
         HotkeysModule.saveStore();
         this.scheduleRebuild();
      }).bounds(x + labelW + 2 + SMALL_W + 2, y, SMALL_W, 20).build();
      remove.setTooltip(Tooltip.create(Component.literal("Remove")));
      this.addRenderableWidget(remove);
   }

   private void addStepButton(String text, String type, int x, int y, int w, String about) {
      Button button = Button.builder(Component.literal(text), press -> {
         this.saveName();
         Screens.open(this.minecraft, new HotkeyStepScreen(this, this.hotkey, HotkeysModule.Step.of(type), true));
      }).bounds(x, y, w, 20).build();
      button.setTooltip(Tooltip.create(Component.literal(about)));
      this.addRenderableWidget(button);
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

   private static Component loopsLabel(int loops) {
      return Component.literal(loops <= 0 ? "Until pressed again" : loops + " times");
   }

   private static Component gapLabel(int ticks) {
      return Component.literal(ticks <= 0 ? "None" : HotkeysModule.seconds(ticks));
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
   public void onClose() {
      this.saveName();
      super.onClose();
   }

   private class KeyButton extends BlueButton {
      KeyButton(int x, int y, int w) {
         super(x, y, w, 20, Component.empty(), button -> {});
         this.setTooltip(Tooltip.create(Component.literal("The key that runs this hotkey. Click, then press a key or a mouse button; Esc clears it")));
         this.refresh();
      }

      @Override
      protected void pressed() {
         HotkeyEditScreen.this.listening = this;
         this.refresh();
      }

      void take(InputConstants.Key key) {
         HotkeyEditScreen.this.hotkey.setKey(key);
         HotkeyEditScreen.this.listening = null;
         HotkeysModule.saveStore();
         this.refresh();
      }

      void refresh() {
         if (HotkeyEditScreen.this.listening == this) {
            this.setMessage(Component.literal("> ").append(Component.literal("Press a key").withStyle(ChatFormatting.YELLOW)).append(Component.literal(" <")));
         } else {
            this.setMessage(Component.literal("Key: ").append(HotkeyEditScreen.this.hotkey.keyLabel()));
         }
      }
   }
}
