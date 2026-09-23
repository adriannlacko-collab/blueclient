package benchprobe.mixin;

import benchprobe.Probe;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * 1.21.x: the game runs under intermediary names. class_310 is Minecraft,
 * method_1523 runTick(boolean), method_51736 onGameLoadFinished (checked
 * against intermediary-1.21.11-v2 and Mojang's client.txt); field_1687 is
 * `level`, field_1755 `screen` (passed as -Dbench.levelField/screenField).
 */
@Mixin(targets = "net.minecraft.class_310", remap = false)
public abstract class MinecraftMixin {
    @Inject(method = "method_1523", at = @At("HEAD"), remap = false)
    private void benchprobe$frame(CallbackInfo ci) {
        Probe.frame(this);
    }

    @Inject(method = "method_51736", at = @At("HEAD"), remap = false)
    private void benchprobe$loaded(CallbackInfo ci) {
        Probe.loaded();
    }
}
