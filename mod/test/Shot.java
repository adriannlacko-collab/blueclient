import java.awt.Rectangle;
import java.awt.Robot;
import java.awt.Toolkit;
import java.awt.event.KeyEvent;
import java.awt.image.BufferedImage;
import java.io.File;
import javax.imageio.ImageIO;

/**
 * Screenshot of the X display the game runs on (java.awt.Robot through XTest),
 * optionally after pressing keys: `java Shot.java out.png [key ...]` where a
 * key is F1..F12, ESC, TAB or a single letter, `hold:KEY:ms` a key held that
 * long, `click:x,y` a left click and `wait:ms` a pause. Run with DISPLAY set.
 */
public class Shot {
   public static void main(String[] args) throws Exception {
      Robot robot = new Robot();
      for (int i = 1; i < args.length; i++) {
         if (args[i].startsWith("click:")) {
            String[] at = args[i].substring(6).split(",");
            robot.mouseMove(Integer.parseInt(at[0]), Integer.parseInt(at[1]));
            robot.delay(150);
            robot.mousePress(java.awt.event.InputEvent.BUTTON1_DOWN_MASK);
            robot.delay(80);
            robot.mouseRelease(java.awt.event.InputEvent.BUTTON1_DOWN_MASK);
            robot.delay(400);
            continue;
         }
         if (args[i].startsWith("hold:")) {
            String[] key = args[i].substring(5).split(":");
            int code = code(key[0]);
            robot.keyPress(code);
            robot.delay(Integer.parseInt(key[1]));
            robot.keyRelease(code);
            robot.delay(400);
            continue;
         }
         if (args[i].startsWith("wait:")) {
            robot.delay(Integer.parseInt(args[i].substring(5)));
            continue;
         }
         int code = code(args[i]);
         robot.keyPress(code);
         robot.delay(80);
         robot.keyRelease(code);
         robot.delay(400);
      }
      Rectangle screen = new Rectangle(Toolkit.getDefaultToolkit().getScreenSize());
      BufferedImage image = robot.createScreenCapture(screen);
      ImageIO.write(image, "png", new File(args[0]));
      System.out.println("wrote " + args[0] + " " + screen.width + "x" + screen.height);
   }

   private static int code(String key) {
      switch (key.toUpperCase()) {
         case "ESC": return KeyEvent.VK_ESCAPE;
         case "TAB": return KeyEvent.VK_TAB;
         case "RSHIFT": return KeyEvent.VK_SHIFT;
         default:
            if (key.toUpperCase().startsWith("F")) {
               return KeyEvent.VK_F1 + Integer.parseInt(key.substring(1)) - 1;
            }
            return KeyEvent.getExtendedKeyCodeForChar(key.charAt(0));
      }
   }
}
