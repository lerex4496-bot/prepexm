"""One-shot: append tutor strings to the i18n dictionaries."""
import io
from pathlib import Path

P = Path(__file__).resolve().parents[1] / "apps" / "mobile" / "src" / "i18n" / "strings.ts"

EN = """
  // — contextual tutor —
  'tutor.title': 'Ask about this',
  'tutor.didntUnderstand': "Didn't understand this?",
  'tutor.context': 'About',
  'tutor.action.simple': 'Explain in simple words',
  'tutor.action.example': 'Give a classroom example',
  'tutor.action.why': 'Why is this the answer?',
  'tutor.action.related': 'What else should I know?',
  'tutor.thinking': 'Reading your NCERT books…',
  'tutor.askAnother': 'Ask something else',
  'tutor.unavailable': 'Tutor unavailable',
  'tutor.offlineNote': 'The tutor needs a connection. Everything else — papers, practice and your mistakes — works offline.',
  'tutor.fromNcert': 'From your NCERT books',
  'tutor.citationsOnly': 'Here is where to read it',
  'tutor.noMatch': 'Nothing in the NCERT books matched this closely enough to answer from.',
  'settings.api': 'Tutor server',
  'settings.apiHint': 'Address of the StudyMate API. Only the tutor uses it.',
  'settings.apiCheck': 'Check',
  'settings.apiReachable': 'Reachable',
  'settings.apiUnreachable': 'Not reachable',
"""

HI = """
  'tutor.title': 'इस बारे में पूछें',
  'tutor.didntUnderstand': 'समझ नहीं आया?',
  'tutor.context': 'विषय',
  'tutor.action.simple': 'आसान शब्दों में समझाएँ',
  'tutor.action.example': 'कक्षा का उदाहरण दें',
  'tutor.action.why': 'यही उत्तर क्यों है?',
  'tutor.action.related': 'और क्या जानना चाहिए?',
  'tutor.thinking': 'आपकी NCERT किताबें पढ़ी जा रही हैं…',
  'tutor.askAnother': 'कुछ और पूछें',
  'tutor.unavailable': 'ट्यूटर उपलब्ध नहीं',
  'tutor.offlineNote': 'ट्यूटर के लिए इंटरनेट चाहिए। बाक़ी सब — प्रश्नपत्र, अभ्यास और ग़लतियाँ — बिना इंटरनेट चलते हैं।',
  'tutor.fromNcert': 'आपकी NCERT किताबों से',
  'tutor.citationsOnly': 'यह कहाँ पढ़ें',
  'tutor.noMatch': 'NCERT किताबों में इससे मिलता-जुलता कुछ नहीं मिला।',
  'settings.api': 'ट्यूटर सर्वर',
  'settings.apiHint': 'StudyMate API का पता। इसका उपयोग केवल ट्यूटर करता है।',
  'settings.apiCheck': 'जाँचें',
  'settings.apiReachable': 'पहुँच में',
  'settings.apiUnreachable': 'पहुँच में नहीं',
"""

GU = """
  'tutor.title': 'આ વિશે પૂછો',
  'tutor.didntUnderstand': 'સમજાયું નહીં?',
  'tutor.context': 'વિષય',
  'tutor.action.simple': 'સરળ શબ્દોમાં સમજાવો',
  'tutor.action.example': 'વર્ગખંડનું ઉદાહરણ આપો',
  'tutor.action.why': 'આ જ જવાબ કેમ છે?',
  'tutor.action.related': 'બીજું શું જાણવું જોઈએ?',
  'tutor.thinking': 'તમારી NCERT ચોપડીઓ વંચાઈ રહી છે…',
  'tutor.askAnother': 'બીજું કંઈ પૂછો',
  'tutor.unavailable': 'ટ્યુટર ઉપલબ્ધ નથી',
  'tutor.offlineNote': 'ટ્યુટર માટે ઇન્ટરનેટ જોઈએ. બાકી બધું — પ્રશ્નપત્રો, અભ્યાસ અને ભૂલો — ઇન્ટરનેટ વગર ચાલે છે.',
  'tutor.fromNcert': 'તમારી NCERT ચોપડીઓમાંથી',
  'tutor.citationsOnly': 'આ ક્યાં વાંચવું',
  'tutor.noMatch': 'NCERT ચોપડીઓમાં આને મળતું કંઈ મળ્યું નથી.',
  'settings.api': 'ટ્યુટર સર્વર',
  'settings.apiHint': 'StudyMate API નું સરનામું. તેનો ઉપયોગ ફક્ત ટ્યુટર કરે છે.',
  'settings.apiCheck': 'તપાસો',
  'settings.apiReachable': 'પહોંચમાં',
  'settings.apiUnreachable': 'પહોંચમાં નથી',
"""

ANCHORS = [
    ("  'today.wrongCount': '{n} wrong so far',\n};", EN),
    ("  'today.wrongCount': 'अब तक {n} ग़लत',\n};", HI),
    ("  'today.wrongCount': 'અત્યાર સુધી {n} ખોટા',\n};", GU),
]


def main() -> int:
    s = io.open(P, encoding="utf-8").read()
    if "'tutor.title'" in s:
        print("already added; nothing to do")
        return 0
    for anchor, block in ANCHORS:
        if anchor not in s:
            print(f"! anchor not found: {anchor[:46]!r}")
            return 1
        s = s.replace(anchor, anchor[:-2] + block + "};")
    io.open(P, "w", encoding="utf-8").write(s)
    print("added tutor strings to 3 dictionaries")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
