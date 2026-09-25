package com.blueclient.screen;

import com.blueclient.hud.modules.HotkeysModule;
import com.blueclient.ui.Widgets;
import com.blueclient.ui.input.BlueButton;
import com.blueclient.ui.input.Inputs;
import com.mojang.blaze3d.platform.InputConstants;
import java.util.List;
import net.minecraft.ChatFormatting;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.components.Tooltip;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.CommonComponents;
import net.minecraft.network.chat.Component;

/** One hotkey: its name, its key, and the chat lines or commands it sends. */
public class HotkeyEditScreen extends VanillaScreen {
   private static final int GRID_W = 308;
   private static final int HALF = 150;
   private static final int SMALL_W = 20;
   /** The add button, the footer and the line under it. */
   private static final int TAIL = 56;
   private static final int ESCAPE = 41;
   private final HotkeysModule.Hotkey hotkey;
   private HotkeyEditScreen.KeyButton listening;
   /** The line being typed in, which keeps the cursor when the page is built again, or -1. */
   private int focusLine = -1;

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
            : "Each press sends these in order — start a line with / for a command";
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
         Widgets.cycling(VanillaScreen::onOff, this.hotkey.enabled, List.of(Boolean.TRUE, Boolean.FALSE))
            .create(x, y, GRID_W, 20, Component.literal("Enabled"), (button, value) -> {
               this.hotkey.enabled = value;
               HotkeysModule module = HotkeysModule.instance();
               if (!value && module != null) {
                  module.cancel(this.hotkey);
               }
            })
      );
      y += 28;
      List<String> lines = this.hotkey.lines;
      this.addRenderableWidget(
         Widgets.heading(x, y, GRID_W, 12, Component.literal(lines.isEmpty() ? "Nothing to send yet — add a line below" : "Sent in order"), this.font, -6250336)
      );
      y += 14;
      int offset = this.fitRows(y, lines.size(), TAIL);

      // scroll a line just added into view
      while (this.focusLine >= offset + this.rows && this.mouseScrolled(0.0, 0.0, 0.0, -1.0)) {
         offset = this.fitRows(y, lines.size(), TAIL);
      }

      int last = Math.min(lines.size(), offset + this.rows);

      for (int i = offset; i < last; i++) {
         this.addLineRow(i, x, y + (i - offset) * 24);
      }

      y += (lines.isEmpty() ? 0 : Math.min(this.rows, lines.size())) * 24;
      Button add = Button.builder(Component.literal("+ Chat line or command"), button -> {
         this.hotkey.lines.add("");
         this.focusLine = this.hotkey.lines.size() - 1;
         this.scheduleRebuild();
      }).bounds(x, y, GRID_W, 20).build();
      add.setTooltip(Tooltip.create(Component.literal("Something to say in chat, or a command when it starts with /")));
      this.addRenderableWidget(add);
      return y + 24;
   }

   private void addLineRow(int index, int x, int y) {
      List<String> lines = this.hotkey.lines;
      int boxW = this.blockWidth - (SMALL_W + 2) * 2;
      EditBox text = new EditBox(this.font, x, y, boxW, 20, Component.literal("Line " + (index + 1)));
      text.setMaxLength(HotkeysModule.MAX_LINE);
      text.setValue(lines.get(index));
      text.setHint(Component.literal("hello, or /spawn").withStyle(ChatFormatting.DARK_GRAY));
      text.setResponder(value -> {
         if (index < this.hotkey.lines.size()) {
            this.hotkey.lines.set(index, value);
            this.focusLine = index;
         }
      });
      this.addRenderableWidget(text);
      if (index == this.focusLine) {
         this.setFocused(text);
      }

      Button up = Button.builder(Component.literal("↑"), button -> {
         if (index > 0 && index < lines.size()) {
            lines.set(index, lines.set(index - 1, lines.get(index)));
            this.focusLine = -1;
            HotkeysModule.saveStore();
            this.scheduleRebuild();
         }
      }).bounds(x + boxW + 2, y, SMALL_W, 20).build();
      up.active = index > 0;
      up.setTooltip(Tooltip.create(Component.literal("Move up")));
      this.addRenderableWidget(up);
      Button remove = Button.builder(Component.literal("X").withStyle(ChatFormatting.RED), button -> {
         HotkeysModule module = HotkeysModule.instance();
         if (module != null) {
            module.cancel(this.hotkey);
         }

         if (index < lines.size()) {
            lines.remove(index);
         }

         this.focusLine = -1;

         HotkeysModule.saveStore();
         this.scheduleRebuild();
      }).bounds(x + boxW + 2 + SMALL_W + 2, y, SMALL_W, 20).build();
      remove.setTooltip(Tooltip.create(Component.literal("Remove")));
      this.addRenderableWidget(remove);
   }

   private void save() {
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
      this.hotkey.lines.removeIf(String::isBlank);
      this.save();
      super.onClose();
   }

   private class KeyButton extends BlueButton {
      KeyButton(int x, int y, int w) {
         super(x, y, w, 20, Component.empty(), button -> {});
         this.setTooltip(Tooltip.create(Component.literal("The key that sends this hotkey. Click, then press a key or a mouse button; Esc clears it")));
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
