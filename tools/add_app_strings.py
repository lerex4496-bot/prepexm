"""One-shot: append settings / learn / quick-practice strings to the i18n dictionaries."""
import io
from pathlib import Path

P = Path(__file__).resolve().parents[1] / "apps" / "mobile" / "src" / "i18n" / "strings.ts"

EN = """
  // — settings, learn, quick practice —
  'settings.title': 'Settings',
  'settings.language': 'Study language',
  'settings.theme': 'Appearance',
  'settings.theme.system': 'System',
  'settings.theme.light': 'Light',
  'settings.theme.dark': 'Dark',
  'settings.dailyTime': 'Minutes per day',
  'settings.motion': 'Motion',
  'settings.reduceMotion': 'Reduce motion',
  'settings.content': 'Content',
  'settings.bundleBuilt': 'Bundle built',
  'settings.bundleGate': 'Gate',
  'settings.reset': 'Reset app',
  'settings.resetConfirm': 'Reset everything?',
  'settings.resetBody': 'This clears your profile and starts onboarding again. Your attempts and mistakes stay on the device.',

  'learn.subtitle': 'Browse by section and practise anything.',
  'learn.part': 'Part',
  'learn.other': 'Other',

  'quick.fromMistakes': 'From your mistakes',
  'quick.mixed': 'Mixed practice',
  'quick.nothing': 'Nothing to practise here yet',

  'today.allDone': "Today's plan is done",
  'today.allDoneBody': 'Nothing is overdue. Practise more if you have time.',
  'today.practiceAnyway': 'Practise anyway',
  'today.wrongCount': '{n} wrong so far',
"""

HI = """
  'settings.title': 'सेटिंग्स',
  'settings.language': 'पढ़ाई की भाषा',
  'settings.theme': 'रंग-रूप',
  'settings.theme.system': 'सिस्टम',
  'settings.theme.light': 'हल्का',
  'settings.theme.dark': 'गहरा',
  'settings.dailyTime': 'रोज़ के मिनट',
  'settings.motion': 'एनिमेशन',
  'settings.reduceMotion': 'एनिमेशन कम करें',
  'settings.content': 'सामग्री',
  'settings.bundleBuilt': 'बंडल बना',
  'settings.bundleGate': 'द्वार',
  'settings.reset': 'ऐप रीसेट करें',
  'settings.resetConfirm': 'सब कुछ रीसेट करें?',
  'settings.resetBody': 'इससे प्रोफ़ाइल मिटेगी और शुरुआत फिर से होगी। आपके प्रयास और ग़लतियाँ फ़ोन में रहेंगी।',

  'learn.subtitle': 'भाग के अनुसार देखें और अभ्यास करें।',
  'learn.part': 'भाग',
  'learn.other': 'अन्य',

  'quick.fromMistakes': 'आपकी ग़लतियों से',
  'quick.mixed': 'मिला-जुला अभ्यास',
  'quick.nothing': 'यहाँ अभ्यास के लिए अभी कुछ नहीं',

  'today.allDone': 'आज की योजना पूरी',
  'today.allDoneBody': 'कुछ बाक़ी नहीं है। समय हो तो और अभ्यास करें।',
  'today.practiceAnyway': 'फिर भी अभ्यास करें',
  'today.wrongCount': 'अब तक {n} ग़लत',
"""

GU = """
  'settings.title': 'સેટિંગ્સ',
  'settings.language': 'અભ્યાસની ભાષા',
  'settings.theme': 'દેખાવ',
  'settings.theme.system': 'સિસ્ટમ',
  'settings.theme.light': 'આછું',
  'settings.theme.dark': 'ઘેરું',
  'settings.dailyTime': 'રોજની મિનિટ',
  'settings.motion': 'એનિમેશન',
  'settings.reduceMotion': 'એનિમેશન ઘટાડો',
  'settings.content': 'સામગ્રી',
  'settings.bundleBuilt': 'બંડલ બન્યું',
  'settings.bundleGate': 'દ્વાર',
  'settings.reset': 'એપ રીસેટ કરો',
  'settings.resetConfirm': 'બધું રીસેટ કરવું?',
  'settings.resetBody': 'આનાથી પ્રોફાઇલ ભૂંસાશે અને શરૂઆત ફરીથી થશે. તમારા પ્રયાસો અને ભૂલો ફોનમાં રહેશે.',

  'learn.subtitle': 'ભાગ પ્રમાણે જુઓ અને અભ્યાસ કરો.',
  'learn.part': 'ભાગ',
  'learn.other': 'અન્ય',

  'quick.fromMistakes': 'તમારી ભૂલોમાંથી',
  'quick.mixed': 'મિશ્ર અભ્યાસ',
  'quick.nothing': 'અહીં અભ્યાસ માટે હજી કંઈ નથી',

  'today.allDone': 'આજની યોજના પૂર્ણ',
  'today.allDoneBody': 'કંઈ બાકી નથી. સમય હોય તો વધુ અભ્યાસ કરો.',
  'today.practiceAnyway': 'તોય અભ્યાસ કરો',
  'today.wrongCount': 'અત્યાર સુધી {n} ખોટા',
"""

ANCHORS = [
    ("  'progress.emptyBody': 'Sit a paper and your performance and mistakes appear here.',\n};", EN),
    ("  'progress.emptyBody': 'एक प्रश्नपत्र दीजिए, फिर प्रदर्शन और ग़लतियाँ यहाँ दिखेंगी।',\n};", HI),
    ("  'progress.emptyBody': 'એક પ્રશ્નપત્ર આપો, પછી દેખાવ અને ભૂલો અહીં દેખાશે.',\n};", GU),
]


def main() -> int:
    s = io.open(P, encoding="utf-8").read()
    if "'settings.title'" in s:
        print("already added; nothing to do")
        return 0
    for anchor, block in ANCHORS:
        if anchor not in s:
            print(f"! anchor not found: {anchor[:50]!r}")
            return 1
        s = s.replace(anchor, anchor[:-2] + block + "};")
    io.open(P, "w", encoding="utf-8").write(s)
    print("added app strings to 3 dictionaries")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
