package com.blueclient.screen;

import com.blueclient.hud.modules.HotkeysModule;
import com.blueclient.ui.Widgets;
import com.blueclient.ui.input.BlueButton;
import com.blueclient.ui.input.Inputs;
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

/** One hotkey: its name, its key, and the chat lines or commands it sends. */
public class HotkeyEditScreen extends VanillaScreen {
   private static final int GRID_W = 308;
   private static final int HALF = 150;
   private static final int SMALL_W = 20;
   /** The add button, the footer and the line under it. */
   private static final int TAIL = 56;
   private static final int ESCAPE = 256;
   private final HotkeysModule.Hotkey hotkey;
   private HotkeyEditScreen.KeyButton listening;
   /** The line being typed in, which keeps the cursor when the page is built again, or -1. */
   private int focusLine = -1;

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
         Widgets.cycling(VanillaScreen::onOff, this.hotkey.enabled, List.of(Boolean.TRUE, Boolean.FALSE))
            .method_32617(x, y, GRID_W, 20, class_2561.method_43470("Enabled"), (button, value) -> {
               this.hotkey.enabled = value;
               HotkeysModule module = HotkeysModule.instance();
               if (!value && module != null) {
                  module.cancel(this.hotkey);
               }
            })
      );
      y += 28;
      List<String> lines = this.hotkey.lines;
      this.method_37063(
         Widgets.heading(x, y, GRID_W, 12, class_2561.method_43470(lines.isEmpty() ? "Nothing to send yet — add a line below" : "Sent in order"), this.field_22793, -6250336)
      );
      y += 14;
      int offset = this.fitRows(y, lines.size(), TAIL);

      // scroll a line just added into view
      while (this.focusLine >= offset + this.rows && this.method_25401(0.0, 0.0, 0.0, -1.0)) {
         offset = this.fitRows(y, lines.size(), TAIL);
      }

      int last = Math.min(lines.size(), offset + this.rows);

      for (int i = offset; i < last; i++) {
         this.addLineRow(i, x, y + (i - offset) * 24);
      }

      y += (lines.isEmpty() ? 0 : Math.min(this.rows, lines.size())) * 24;
      class_4185 add = class_4185.method_46430(class_2561.method_43470("+ Chat line or command"), button -> {
         this.hotkey.lines.add("");
         this.focusLine = this.hotkey.lines.size() - 1;
         this.scheduleRebuild();
      }).method_46434(x, y, GRID_W, 20).method_46431();
      add.method_47400(class_7919.method_47407(class_2561.method_43470("Something to say in chat, or a command when it starts with /")));
      this.method_37063(add);
      return y + 24;
   }

   private void addLineRow(int index, int x, int y) {
      List<String> lines = this.hotkey.lines;
      int boxW = this.blockWidth - (SMALL_W + 2) * 2;
      class_342 text = new class_342(this.field_22793, x, y, boxW, 20, class_2561.method_43470("Line " + (index + 1)));
      text.method_1880(HotkeysModule.MAX_LINE);
      text.method_1852(lines.get(index));
      text.method_47404(class_2561.method_43470("hello, or /spawn").method_27692(class_124.field_1063));
      text.method_1863(value -> {
         if (index < this.hotkey.lines.size()) {
            this.hotkey.lines.set(index, value);
            this.focusLine = index;
         }
      });
      this.method_37063(text);
      if (index == this.focusLine) {
         this.method_25395(text);
      }

      class_4185 up = class_4185.method_46430(class_2561.method_43470("↑"), button -> {
         if (index > 0 && index < lines.size()) {
            lines.set(index, lines.set(index - 1, lines.get(index)));
            this.focusLine = -1;
            HotkeysModule.saveStore();
            this.scheduleRebuild();
         }
      }).method_46434(x + boxW + 2, y, SMALL_W, 20).method_46431();
      up.field_22763 = index > 0;
      up.method_47400(class_7919.method_47407(class_2561.method_43470("Move up")));
      this.method_37063(up);
      class_4185 remove = class_4185.method_46430(class_2561.method_43470("X").method_27692(class_124.field_1061), button -> {
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
      }).method_46434(x + boxW + 2 + SMALL_W + 2, y, SMALL_W, 20).method_46431();
      remove.method_47400(class_7919.method_47407(class_2561.method_43470("Remove")));
      this.method_37063(remove);
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
   public void method_25419() {
      this.hotkey.lines.removeIf(String::isBlank);
      this.save();
      super.method_25419();
   }

   private class KeyButton extends BlueButton {
      KeyButton(int x, int y, int w) {
         super(x, y, w, 20, class_2561.method_43473(), button -> {});
         this.method_47400(class_7919.method_47407(class_2561.method_43470("The key that sends this hotkey. Click, then press a key or a mouse button; Esc clears it")));
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
