# /// script
# requires-python = ">=3.10"
# dependencies = ["fonttools[woff]==4.60.1"]
# ///
"""Builds the Apple app's Allo fonts from the web app's and Android's copies:
    uv run apps/apple/scripts/allo-fonts.py

Apple's text APIs can't turn on an OpenType feature while keeping Dynamic
Type, so ss01 (the single-story "a" the web, docs, extension and Android set)
joins calt, which every text system applies by default. The family is renamed
"Allo Teak" so the variable roman and the drawn obliques are one family that
can't clash with an installed Allo. SIL OFL 1.1 allows both; the license stays
in each font's name table.
"""

import shutil
from pathlib import Path

from fontTools.ttLib import TTFont

REPO = Path(__file__).resolve().parents[3]
OUT = REPO / "apps/apple/Packages/TeakKit/Sources/TeakUI/Resources/Fonts"
WEB = REPO / "apps/web/src/styles/fonts"
SOURCES = {
    "AlloTeak.ttf": REPO / "apps/android/core/designsystem/src/main/res/font/allo.ttf",
    "AlloTeak-Oblique.otf": WEB / "Allo-Oblique.woff2",
    "AlloTeak-MediumOblique.otf": WEB / "Allo-MediumOblique.woff2",
    "AlloTeak-SemiBoldOblique.otf": WEB / "Allo-SemiBoldOblique.woff2",
    "AlloTeak-BoldOblique.otf": WEB / "Allo-BoldOblique.woff2",
}
FAMILY = "Allo Teak"


def turn_on_ss01(font: TTFont) -> None:
    features = font["GSUB"].table.FeatureList.FeatureRecord
    ss01 = {i for r in features if r.FeatureTag == "ss01" for i in r.Feature.LookupListIndex}
    calt = [r.Feature for r in features if r.FeatureTag == "calt"]
    assert ss01 and calt, "Allo has lost ss01 or calt"
    for feature in calt:
        # Lookups run in list order, so ss01 keeps its place after calt's own.
        feature.LookupListIndex = sorted(set(feature.LookupListIndex) | ss01)
        feature.LookupCount = len(feature.LookupListIndex)


def rename(font: TTFont) -> None:
    names = font["name"]
    for record in names.names:
        text = record.toUnicode()
        if record.nameID in (1, 3, 4, 16, 21):
            text = text.replace("Allo Variable Friendly", FAMILY, 1)
            if not text.startswith(FAMILY):
                text = text.replace("Allo", FAMILY, 1)
        elif record.nameID == 6 or record.nameID > 255:
            text = text.replace("AlloVariableFriendly", "AlloTeak", 1).replace("Allo-", "AlloTeak-", 1)
        else:
            continue
        record.string = text


OUT.mkdir(parents=True, exist_ok=True)
shutil.copy(WEB / "Allo-OFL.txt", OUT / "Allo-OFL.txt")
for name, source in SOURCES.items():
    font = TTFont(source, recalcTimestamp=False)
    font.flavor = None
    turn_on_ss01(font)
    rename(font)
    font.save(OUT / name)
    print(f"{name} ({font['name'].getDebugName(6)})")
