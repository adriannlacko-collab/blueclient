package com.blueclient.ui.input;

import com.mojang.blaze3d.platform.InputConstants;
import com.mojang.blaze3d.platform.InputConstants.Key;
import com.mojang.blaze3d.platform.InputConstants.Type;
import net.minecraft.client.Minecraft;
import net.minecraft.client.MouseHandler;
import net.minecraft.client.gui.components.tabs.TabNavigationBar;
import net.minecraft.client.input.KeyEvent;

public final class Inputs {
   private Inputs() {
   }

   public static boolean keyDown(int key) {
      return InputConstants.isKeyDown(key);
   }

   public static boolean mouseDown(int button) {
      Minecraft client = Minecraft.getInstance();
      if (client == null) {
         return false;
      } else {
         MouseHandler mouse = client.mouseHandler;
         if (button == 1) {
            return mouse.isLeftPressed();
         } else if (button == 3) {
            return mouse.isRightPressed();
         } else {
            return button == 2 ? mouse.isMiddlePressed() : false;
         }
      }
   }

   public static boolean shiftHeld() {
      return keyDown(225) || keyDown(229);
   }

   public static boolean ctrlHeld() {
      return keyDown(224) || keyDown(228);
   }

   public static boolean altHeld() {
      return keyDown(226) || keyDown(230);
   }

   public static Key keyOf(int key, int scan) {
      return InputConstants.getKey(new KeyEvent(key, scan, 0));
   }

   public static Key mouseOf(int button) {
      return Type.MOUSE.getOrCreate(button);
   }

   public static boolean switchTab(TabNavigationBar bar, int key, int scan, int mods) {
      return bar.keyPressed(new KeyEvent(key, scan, mods));
   }
}
