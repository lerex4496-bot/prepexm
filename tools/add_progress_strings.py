"""One-shot: append Progress / Mistake Notebook strings to the i18n dictionaries."""
import io
from pathlib import Path

P = Path(__file__).resolve().parents[1] / "apps" / "mobile" / "src" / "i18n" / "strings.ts"

EN = """
  // — progress & mistake notebook —
  'progress.performance': 'Performance',
  'progress.latest': 'Latest attempt',
  'progress.best': 'Best so far',
  'progress.attempts': '{n} attempts',
  'progress.mistakes': 'Mistake notebook',
  'progress.repeatedly': 'These are the things you repeatedly get wrong.',
  'progress.untagged': 'Not tagged',
  'progress.markFixed': 'Mark fixed',
  'progress.noMistakes': 'No open mistakes',
  'progress.noMistakesBody': 'Anything you miss in a paper collects here, grouped by where it keeps happening.',
  'progress.emptyTitle': 'Nothing to show yet',
  'progress.emptyBody': 'Sit a paper and your performance and mistakes appear here.',
"""

HI = """
  'progress.performance': 'प्रदर्शन',
  'progress.latest': 'पिछला प्रयास',
  'progress.best': 'अब तक सर्वोत्तम',
  'progress.attempts': '{n} प्रयास',
  'progress.mistakes': 'ग़लतियों की कॉपी',
  'progress.repeatedly': 'ये वे बातें हैं जो बार-बार ग़लत होती हैं।',
  'progress.untagged': 'चिह्नित नहीं',
  'progress.markFixed': 'ठीक हुआ',
  'progress.noMistakes': 'कोई खुली ग़लती नहीं',
  'progress.noMistakesBody': 'प्रश्नपत्र में छूटा हर सवाल यहाँ जमा होता है, उसी क्षेत्र के अनुसार।',
  'progress.emptyTitle': 'अभी दिखाने को कुछ नहीं',
  'progress.emptyBody': 'एक प्रश्नपत्र दीजिए, फिर प्रदर्शन और ग़लतियाँ यहाँ दिखेंगी।',
"""

GU = """
  'progress.performance': 'દેખાવ',
  'progress.latest': 'છેલ્લો પ્રયાસ',
  'progress.best': 'અત્યાર સુધીનું શ્રેષ્ઠ',
  'progress.attempts': '{n} પ્રયાસો',
  'progress.mistakes': 'ભૂલોની નોંધપોથી',
  'progress.repeatedly': 'આ એવી બાબતો છે જે વારંવાર ખોટી થાય છે.',
  'progress.untagged': 'ચિહ્નિત નથી',
  'progress.markFixed': 'સુધરી ગયું',
  'progress.noMistakes': 'કોઈ ખુલ્લી ભૂલ નથી',
  'progress.noMistakesBody': 'પ્રશ્નપત્રમાં ચૂકેલો દરેક પ્રશ્ન અહીં જમા થાય છે, ક્ષેત્ર પ્રમાણે.',
  'progress.emptyTitle': 'હજી બતાવવા જેવું કંઈ નથી',
  'progress.emptyBody': 'એક પ્રશ્નપત્ર આપો, પછી દેખાવ અને ભૂલો અહીં દેખાશે.',
"""

ANCHORS = [
    ("  'review.mistake.time_pressure': 'Time pressure',\n};", EN),
    ("  'review.mistake.time_pressure': 'समय का दबाव',\n};", HI),
    ("  'review.mistake.time_pressure': 'સમયનું દબાણ',\n};", GU),
]


def main() -> int:
    s = io.open(P, encoding="utf-8").read()
    if "'progress.mistakes'" in s:
        print("already added; nothing to do")
        return 0
    for anchor, block in ANCHORS:
        if anchor not in s:
            print(f"! anchor not found: {anchor[:46]!r}")
            return 1
        s = s.replace(anchor, anchor[:-2] + block + "};")
    io.open(P, "w", encoding="utf-8").write(s)
    print("added progress strings to 3 dictionaries")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
