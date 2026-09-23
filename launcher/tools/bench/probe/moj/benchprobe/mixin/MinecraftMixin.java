package benchprobe.mixin;

import benchprobe.Probe;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** 26.x: the game ships unobfuscated, so Mojang's own names at runtime. */
@Mixin(targets = "net.minecraft.client.Minecraft", remap = false)
public abstract class MinecraftMixin {
    @Inject(method = "runTick", at = @At("HEAD"), remap = false)
    private void benchprobe$frame(CallbackInfo ci) {
        Probe.frame(this);
    }

    @Inject(method = "onGameLoadFinished", at = @At("HEAD"), remap = false)
    private void benchprobe$loaded(CallbackInfo ci) {
        Probe.loaded();
    }
}
