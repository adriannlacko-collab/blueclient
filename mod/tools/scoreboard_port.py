#!/usr/bin/env python3
"""Write the Scoreboard lines sources for every version from the 26.3 ones.

    python3 mod/tools/scoreboard_port.py

Switching sidebar lines off (the Scoreboard module's page) is written once, for
26.3, in three files: the patched ScoreboardModule and the new ScoreboardLines
and ScoreboardLinesScreen. This script derives the other nine:

* 26.1.2 and 26.2 use the same names and the same drawing calls: copied as is.
* 1.20.6-1.21.11 are compiled against the intermediary-named game, so every
  Minecraft name the three files use is renamed. The table below was looked up
  with tools/inter.py (Mojang's client mappings joined with Fabric
  intermediary) on 1.20.6 and 1.21.11, where it is the same; javac against
  each version's jar checks every name when the build runs.

The two hand edits that go with it (VanillaScreen: the gear opens the page;
Hud: the board stays under the debug screen) are made in each version's file
like any other patch.
"""

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hotkeys_port import sorted_imports, split_comments  # noqa: E402

PATCHES = Path(__file__).resolve().parent.parent / "patches"
FILES = [
    "com/blueclient/hud/modules/ScoreboardModule.java",
    "com/blueclient/hud/modules/ScoreboardLines.java",
    "com/blueclient/screen/ScoreboardLinesScreen.java",
]
SAME_NAMES = ["26.1.2", "26.2"]
INTERMEDIARY = ["1.20.6", "1.21.1", "1.21.4", "1.21.5", "1.21.8", "1.21.10", "1.21.11"]

IMPORTS = {
    "net.minecraft.ChatFormatting": "net.minecraft.class_124",
    "net.minecraft.client.Minecraft": "net.minecraft.class_310",
    "net.minecraft.client.gui.Font": "net.minecraft.class_327",
    "net.minecraft.client.gui.GuiGraphicsExtractor": "net.minecraft.class_332",
    "net.minecraft.client.gui.components.Button": "net.minecraft.class_4185",
    "net.minecraft.client.gui.components.Tooltip": "net.minecraft.class_7919",
    "net.minecraft.client.gui.screens.Screen": "net.minecraft.class_437",
    "net.minecraft.client.multiplayer.ServerData": "net.minecraft.class_642",
    "net.minecraft.network.chat.CommonComponents": "net.minecraft.class_5244",
    "net.minecraft.network.chat.Component": "net.minecraft.class_2561",
    "net.minecraft.network.chat.numbers.NumberFormat": "net.minecraft.class_9022",
    "net.minecraft.network.chat.numbers.StyledFormat": "net.minecraft.class_9025",
    "net.minecraft.world.level.Level": "net.minecraft.class_1937",
    "net.minecraft.world.scores.DisplaySlot": "net.minecraft.class_8646",
    "net.minecraft.world.scores.Objective": "net.minecraft.class_266",
    "net.minecraft.world.scores.PlayerScoreEntry": "net.minecraft.class_9011",
    "net.minecraft.world.scores.PlayerTeam": "net.minecraft.class_268",
    "net.minecraft.world.scores.Scoreboard": "net.minecraft.class_269",
}

# (pattern, replacement), applied in order to code (comments are left alone).
RENAMES = [
    # static members, before the class names change
    (r"\bComponent\.literal\(", "Component.method_43470("),
    (r"\bComponent\.empty\(\)", "Component.method_43473()"),
    (r"\bTooltip\.create\(", "Tooltip.method_47407("),
    (r"\bButton\.builder\(", "Button.method_46430("),
    (r"\bMinecraft\.getInstance\(\)", "Minecraft.method_1551()"),
    (r"\bCommonComponents\.GUI_BACK\b", "CommonComponents.field_24339"),
    (r"\bChatFormatting\.RED\b", "ChatFormatting.field_1061"),
    (r"\bChatFormatting\.GRAY\b", "ChatFormatting.field_1080"),
    (r"\bChatFormatting\.DARK_GRAY\b", "ChatFormatting.field_1063"),
    (r"\bStyledFormat\.SIDEBAR_DEFAULT\b", "StyledFormat.field_47567"),
    (r"\bDisplaySlot\.SIDEBAR\b", "DisplaySlot.field_45157"),
    (r"\bPlayerTeam\.formatNameForTeam\(", "PlayerTeam.method_1142("),
    (r"\bPlayerScoreEntry::value\b", "PlayerScoreEntry::comp_2128"),
    (r"\bPlayerScoreEntry::owner\b", "PlayerScoreEntry::comp_2127"),
    # Component / MutableComponent
    (r"\.withStyle\(", ".method_27692("),
    (r"\.append\(", ".method_10852("),
    (r"\.copy\(\)", ".method_27661()"),
    # widgets, Screen
    (r"\.bounds\(", ".method_46434("),
    (r"\.build\(\)", ".method_46431()"),
    (r"\.setMessage\(", ".method_25355("),
    (r"\.setTooltip\(", ".method_47400("),
    (r"\.active\b", ".field_22763"),
    (r"\bthis\.minecraft\b", "this.field_22787"),
    (r"\bthis\.width\b", "this.field_22789"),
    (r"\bthis\.addRenderableWidget\(", "this.method_37063("),
    (r"\bpublic void tick\(\)", "public void method_25393()"),
    (r"\bsuper\.tick\(\)", "super.method_25393()"),
    # Minecraft, Options, the window, the server
    (r"\bclient\.level\b", "client.field_1687"),
    (r"\bclient\.font\b", "client.field_1772"),
    (r"\bclient\.options\b", "client.field_1690"),
    (r"\.getBackgroundColor\(", ".method_19345("),
    (r"\.getWindow\(\)", ".method_22683()"),
    (r"\.getGuiScaledWidth\(\)", ".method_4486()"),
    (r"\.getGuiScaledHeight\(\)", ".method_4502()"),
    (r"\.getCurrentServer\(\)", ".method_1558()"),
    (r"\.hasSingleplayerServer\(\)", ".method_1496()"),
    (r"\bserver\.ip\b", "server.field_3761"),
    # the scoreboard
    (r"\.getScoreboard\(\)", ".method_8428()"),
    (r"\.getDisplayObjective\(", ".method_1189("),
    (r"\.listPlayerScores\(", ".method_1184("),
    (r"\.getPlayersTeam\(", ".method_1164("),
    (r"\.numberFormatOrDefault\(", ".method_55380("),
    (r"\bobjective\.getName\(\)", "objective.method_1113()"),
    (r"\.getDisplayName\(\)", ".method_1114()"),
    (r"\bentry\.isHidden\(\)", "entry.method_55385()"),
    (r"\bentry\.owner\(\)", "entry.comp_2127()"),
    (r"\bentry\.ownerName\(\)", "entry.method_55387()"),
    (r"\bentry\.formatValue\(", "entry.method_55386("),
    # drawing
    (r"\bfont\.width\(\": \"\)", "font.method_1727(\": \")"),
    (r"\bfont\.width\(", "font.method_27525("),
    (r"\bctx\.fill\(", "ctx.method_25294("),
    (r"\bctx\.text\(", "ctx.method_51439("),
]


def to_intermediary(text):
    for named, inter in IMPORTS.items():
        text = text.replace(f"import {named};", f"import {inter};")
    chunks = []
    for code, chunk in split_comments(text):
        if code:
            for pattern, repl in RENAMES:
                chunk = re.sub(pattern, repl, chunk)
            # class names outside string literals: the page says "Scoreboard"
            parts = re.split(r'("(?:\\.|[^"\\])*")', chunk)
            for i in range(0, len(parts), 2):
                for named, inter in IMPORTS.items():
                    parts[i] = re.sub(r"\b" + named.rsplit(".", 1)[1] + r"\b(?!\.java)", inter.rsplit(".", 1)[1], parts[i])
            chunk = "".join(parts)
        chunks.append(chunk)
    text = "".join(chunks)
    return "\n".join(sorted_imports(text.split("\n")))


def main():
    for rel in FILES:
        source = (PATCHES / "26.3" / rel).read_text()
        for mc in SAME_NAMES + INTERMEDIARY:
            text = to_intermediary(source) if mc in INTERMEDIARY else source
            out = PATCHES / mc / rel
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(text)
            print(f"wrote {out.relative_to(PATCHES)}")


if __name__ == "__main__":
    main()
