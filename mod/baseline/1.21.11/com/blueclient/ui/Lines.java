package com.blueclient.ui;

import net.minecraft.class_238;
import net.minecraft.class_259;
import net.minecraft.class_310;
import net.minecraft.class_4587;
import net.minecraft.class_4588;
import net.minecraft.class_9848;
import net.minecraft.class_9974;

public final class Lines {
   private Lines() {
   }

   public static void box(class_4587 matrices, class_4588 lines, class_238 box, float r, float g, float b, float a) {
      int colour = class_9848.method_61318(a, r, g, b);
      class_9974.method_62296(matrices, lines, class_259.method_1078(box), 0.0, 0.0, 0.0, colour, class_310.method_1551().method_22683().method_75291());
   }
}
