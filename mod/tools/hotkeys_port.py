#!/usr/bin/env python3
"""Write the Hotkeys sources for every version from the 26.3 ones.

    python3 mod/tools/hotkeys_port.py

The Hotkeys module is new code, not a decompiled class, so it is written once,
for 26.3 (Mojang's names), and this script derives the other nine:

* 26.1.2 and 26.2 read keys through GLFW, not SDL: Escape is 256 rather than
  41, and "no key" is -1 rather than 0.
* 1.20.6-1.21.11 are compiled against the intermediary-named game
  (`class_2561.method_43470` for `Component.literal`), so every Minecraft name
  the four files use is renamed. The table below was looked up in Mojang's
  client mappings joined with Fabric's intermediary for each of those
  versions, and is the same for all seven; javac against each version's jar
  checks every name when the build runs.
* up to 1.21.4 the selected hotbar slot is the field `Inventory.selected`,
  from 1.21.5 `getSelectedSlot()` / `setSelectedSlot(int)`;
* before 1.21.9 a key has one KeyMapping (see SHARED_KEYS in HotkeysModule).

Only these four files are handled; anything else under patches/ is edited by
hand, per version, as before.
"""

import re
from pathlib import Path

PATCHES = Path(__file__).resolve().parent.parent / "patches"
FILES = [
    "com/blueclient/hud/modules/HotkeysModule.java",
    "com/blueclient/screen/HotkeysScreen.java",
    "com/blueclient/screen/HotkeyEditScreen.java",
    "com/blueclient/screen/HotkeyStepScreen.java",
]
GLFW = ["26.1.2", "26.2"]
INTERMEDIARY = ["1.20.6", "1.21.1", "1.21.4", "1.21.5", "1.21.8", "1.21.10", "1.21.11"]
SELECTED_FIELD = {"1.20.6", "1.21.1", "1.21.4"}
ONE_MAPPING_PER_KEY = {"1.20.6", "1.21.1", "1.21.4", "1.21.5", "1.21.8"}

IMPORTS = {
    "com.mojang.blaze3d.platform.InputConstants": "net.minecraft.class_3675",
    "net.minecraft.ChatFormatting": "net.minecraft.class_124",
    "net.minecraft.client.KeyMapping": "net.minecraft.class_304",
    "net.minecraft.client.Minecraft": "net.minecraft.class_310",
    "net.minecraft.client.Options": "net.minecraft.class_315",
    "net.minecraft.client.gui.components.Button": "net.minecraft.class_4185",
    "net.minecraft.client.gui.components.CycleButton": "net.minecraft.class_5676",
    "net.minecraft.client.gui.components.EditBox": "net.minecraft.class_342",
    "net.minecraft.client.gui.components.Tooltip": "net.minecraft.class_7919",
    "net.minecraft.client.gui.screens.Screen": "net.minecraft.class_437",
    "net.minecraft.client.multiplayer.ClientPacketListener": "net.minecraft.class_634",
    "net.minecraft.client.player.LocalPlayer": "net.minecraft.class_746",
    "net.minecraft.network.chat.CommonComponents": "net.minecraft.class_5244",
    "net.minecraft.network.chat.Component": "net.minecraft.class_2561",
}

# (pattern, replacement), applied in order to code (comments are left alone).
RENAMES = [
    # static members, before the class names change
    (r"\bComponent\.literal\(", "Component.method_43470("),
    (r"\bComponent\.translatable\(", "Component.method_43471("),
    (r"\bComponent\.empty\(\)", "Component.method_43473()"),
    (r"\bTooltip\.create\(", "Tooltip.method_47407("),
    (r"\bButton\.builder\(", "Button.method_46430("),
    (r"\bMinecraft\.getInstance\(\)", "Minecraft.method_1551()"),
    (r"\bKeyMapping\.click\(", "KeyMapping.method_1420("),
    (r"\bKeyMapping\.resetMapping\(\)", "KeyMapping.method_1426()"),
    (r"\bInputConstants\.UNKNOWN\b", "InputConstants.field_16237"),
    (r"\bInputConstants\.Type\.MOUSE\b", "InputConstants.class_307.field_1672"),
    (r"\bInputConstants\.Key\b", "InputConstants.class_306"),
    (r"\bCommonComponents\.GUI_DONE\b", "CommonComponents.field_24334"),
    (r"\bCommonComponents\.GUI_BACK\b", "CommonComponents.field_24339"),
    (r"\bChatFormatting\.RED\b", "ChatFormatting.field_1061"),
    (r"\bChatFormatting\.GRAY\b", "ChatFormatting.field_1080"),
    (r"\bChatFormatting\.GREEN\b", "ChatFormatting.field_1060"),
    (r"\bChatFormatting\.WHITE\b", "ChatFormatting.field_1068"),
    (r"\bChatFormatting\.YELLOW\b", "ChatFormatting.field_1054"),
    (r"\bChatFormatting\.DARK_GRAY\b", "ChatFormatting.field_1063"),
    (r"\bChatFormatting\.AQUA\b", "ChatFormatting.field_1075"),
    (r"\bChatFormatting\.LIGHT_PURPLE\b", "ChatFormatting.field_1076"),
    # Component / MutableComponent
    (r"\.withStyle\(", ".method_27692("),
    (r"\.append\(", ".method_10852("),
    (r"\.copy\(\)", ".method_27661()"),
    # widgets
    (r"\.bounds\(", ".method_46434("),
    (r"\.build\(\)", ".method_46431()"),
    (r"\.setMessage\(", ".method_25355("),
    (r"\.setTooltip\(", ".method_47400("),
    (r"\.active\b", ".field_22763"),
    (r"\.setMaxLength\(", ".method_1880("),
    (r"\.setValue\(", ".method_1852("),
    (r"\.setHint\(", ".method_47404("),
    (r"\.setResponder\(", ".method_1863("),
    (r"\.create\((?!\))", ".method_32617("),
    # Screen
    (r"\bthis\.minecraft\b", "this.field_22787"),
    (r"\bthis\.font\b", "this.field_22793"),
    (r"\bthis\.width\b", "this.field_22789"),
    (r"\bthis\.addRenderableWidget\(", "this.method_37063("),
    (r"\bthis\.setFocused\(", "this.method_25395("),
    (r"\bpublic void onClose\(\)", "public void method_25419()"),
    (r"\bsuper\.onClose\(\)", "super.method_25419()"),
    # Minecraft, Options
    (r"\.player\b", ".field_1724"),
    (r"\.options\b", ".field_1690"),
    (r"\.getConnection\(\)", ".method_1562()"),
    (r"\.keyMappings\b", ".field_1839"),
    (r"\.keyUp\b", ".field_1894"),
    (r"\.keyDown\b(?!\()", ".field_1881"),
    (r"\.keyLeft\b", ".field_1913"),
    (r"\.keyRight\b", ".field_1849"),
    (r"\.keyJump\b", ".field_1903"),
    (r"\.keyShift\b", ".field_1832"),
    (r"\.keySprint\b", ".field_1867"),
    (r"\.keyAttack\b", ".field_1886"),
    (r"\.keyUse\b", ".field_1904"),
    (r"\.keyHotbarSlots\b", ".field_1852"),
    # KeyMapping (the Setting.Key calls of the same names are BlueClient's own)
    (r"\bmapping\.getName\(\)", "mapping.method_1431()"),
    (r"(?<!bound\(\))(?<!stopKey)\.isDown\(\)", ".method_1434()"),
    (r"\.setDown\(", ".method_23481("),
    (r"\.consumeClick\(\)", ".method_1436()"),
    (r"\btrigger\.setKey\(", "trigger.method_1422("),
    # InputConstants.Key
    (r"\.getName\(\)", ".method_1441()"),
    (r"\bkey\.getType\(\)", "key.method_1442()"),
    (r"\bkey\.getValue\(\)", "key.method_1444()"),
    # the player, the connection
    (r"\.getHealth\(\)", ".method_6032()"),
    (r"\.getInventory\(\)", ".method_31548()"),
    (r"\.getYRot\(\)", ".method_36454()"),
    (r"\.getXRot\(\)", ".method_36455()"),
    (r"\bplayer\.turn\(", "player.method_5872("),
    (r"\.getSelectedSlot\(\)", ".method_67532()"),
    (r"\.setSelectedSlot\(", ".method_61496("),
    (r"\.sendCommand\(", ".method_45730("),
    (r"\.sendChat\(", ".method_45729("),
]


def split_comments(text):
    """[(is_code, chunk)]: // and /* */ comments apart from the code (strings are code)."""
    out, i, start, n = [], 0, 0, len(text)
    while i < n:
        c = text[i]
        if c == '"':
            i += 1
            while i < n and text[i] != '"':
                i += 2 if text[i] == "\\" else 1
            i += 1
        elif text.startswith("//", i) or text.startswith("/*", i):
            out.append((True, text[start:i]))
            end = text.find("\n", i) if text.startswith("//", i) else text.find("*/", i) + 2
            out.append((False, text[i:end]))
            i = start = end
        else:
            i += 1
    out.append((True, text[start:]))
    return out


def to_intermediary(text, mc):
    if mc in SELECTED_FIELD:
        text = text.replace("player.getInventory().getSelectedSlot()", "player.getInventory().selected")
        text = text.replace("player.getInventory().setSelectedSlot(slot);", "player.getInventory().selected = slot;")
        text = text.replace(".getInventory().selected", ".method_31548().field_7545")
    if mc in ONE_MAPPING_PER_KEY:
        text = text.replace("private static final boolean SHARED_KEYS = true;", "private static final boolean SHARED_KEYS = false;")
    for named, inter in IMPORTS.items():
        text = text.replace(f"import {named};", f"import {inter};")
    chunks = []
    for code, chunk in split_comments(text):
        if code:
            for pattern, repl in RENAMES:
                chunk = re.sub(pattern, repl, chunk)
            for named, inter in IMPORTS.items():
                chunk = re.sub(r"\b" + named.rsplit(".", 1)[1] + r"\b(?!\.java)", inter.rsplit(".", 1)[1], chunk)
        chunks.append(chunk)
    text = "".join(chunks)
    return "\n".join(sorted_imports(text.split("\n")))


def sorted_imports(lines):
    at = [i for i, line in enumerate(lines) if line.startswith("import ")]
    if at:
        block = sorted(lines[at[0]: at[-1] + 1], key=lambda l: (l == "", l))
        lines[at[0]: at[-1] + 1] = [l for l in block if l]
    return lines


def main():
    for rel in FILES:
        source = (PATCHES / "26.3" / rel).read_text()
        for mc in GLFW + INTERMEDIARY:
            text = source.replace("private static final int ESCAPE = 41;", "private static final int ESCAPE = 256;")
            text = text.replace("private static final int UNBOUND = 0;", "private static final int UNBOUND = -1;")
            if mc in INTERMEDIARY:
                text = to_intermediary(text, mc)
            out = PATCHES / mc / rel
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(text)
            print(f"wrote {out.relative_to(PATCHES)}")


if __name__ == "__main__":
    main()
