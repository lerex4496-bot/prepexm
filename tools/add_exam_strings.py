"""One-shot: append exam/papers/result strings to the mobile i18n dictionaries."""
import io
from pathlib import Path

P = Path(__file__).resolve().parents[1] / "apps" / "mobile" / "src" / "i18n" / "strings.ts"

EN = """
  // — exam player —
  'exam.loading': 'Loading paper…',
  'exam.question': 'Q',
  'exam.palette': 'Question palette',
  'exam.clear': 'Clear Response',
  'exam.markNext': 'Mark & Next',
  'exam.saveNext': 'Save & Next',
  'exam.submit': 'Submit',
  'exam.submitTitle': 'Submit this paper?',
  'exam.submitConfirm': 'Submit',
  'exam.keepGoing': 'Keep going',
  'exam.unansweredWarning': '{n} questions are still unanswered.',
  'exam.toggleLanguage': 'Switch language',
  'exam.bonusNotice': 'The board accepted all options for this question.',
  'exam.state.answered': 'Answered',
  'exam.state.notAnswered': 'Not answered',
  'exam.state.marked': 'Marked',
  'exam.state.answeredMarked': 'Answered & marked',
  'exam.state.notVisited': 'Not visited',

  // — papers —
  'papers.title': 'Question papers',
  'papers.official': 'Papers',
  'papers.mocks': 'Mocks',
  'papers.start': 'Start paper',
  'papers.resume': 'Resume attempt',
  'papers.questions': '{n} questions',
  'papers.minutes': '{n} min',
  'papers.bestScore': 'Best {score}/{max}',
  'papers.notAttempted': 'Not attempted yet',
  'papers.empty': 'No approved papers yet',
  'papers.emptyBody': 'Papers appear here once they are approved in Content Review.',
  'papers.devBundle': 'Development bundle — incomplete paper',
  'papers.mocksSoon': 'AI-generated mock papers arrive in a later slice.',

  // — result & review —
  'result.title': 'Result',
  'result.score': 'Score',
  'result.correct': 'Correct',
  'result.incorrect': 'Incorrect',
  'result.unattempted': 'Unattempted',
  'result.bonus': 'Bonus awarded',
  'result.time': 'Time taken',
  'result.reviewAll': 'Review all questions',
  'result.reviewMistakes': 'Review mistakes only',
  'result.done': 'Done',
  'result.savedOffline': 'Saved on this device',
  'review.yourAnswer': 'Your answer',
  'review.correctAnswer': 'Correct answer',
  'review.whyWrong': 'Why the other options are wrong',
  'review.noExplanation': 'No explanation yet for this question.',
  'review.howWrong': 'How did you get this wrong?',
  'review.mistake.conceptual': 'Conceptual',
  'review.mistake.calculation': 'Calculation',
  'review.mistake.misread': 'Misread the question',
  'review.mistake.silly': 'Silly mistake',
  'review.mistake.confused': 'Confused two concepts',
  'review.mistake.memory': 'Could not recall',
  'review.mistake.time_pressure': 'Time pressure',
"""

HI = """
  'exam.loading': 'प्रश्नपत्र खुल रहा है…',
  'exam.question': 'प्र',
  'exam.palette': 'प्रश्न सूची',
  'exam.clear': 'उत्तर हटाएँ',
  'exam.markNext': 'चिह्नित कर आगे',
  'exam.saveNext': 'सुरक्षित कर आगे',
  'exam.submit': 'जमा करें',
  'exam.submitTitle': 'यह प्रश्नपत्र जमा करें?',
  'exam.submitConfirm': 'जमा करें',
  'exam.keepGoing': 'जारी रखें',
  'exam.unansweredWarning': '{n} प्रश्न अभी बाक़ी हैं।',
  'exam.toggleLanguage': 'भाषा बदलें',
  'exam.bonusNotice': 'इस प्रश्न के सभी विकल्प बोर्ड ने स्वीकार किए हैं।',
  'exam.state.answered': 'उत्तर दिया',
  'exam.state.notAnswered': 'उत्तर नहीं दिया',
  'exam.state.marked': 'चिह्नित',
  'exam.state.answeredMarked': 'उत्तर + चिह्नित',
  'exam.state.notVisited': 'देखा नहीं',

  'papers.title': 'प्रश्नपत्र',
  'papers.official': 'प्रश्नपत्र',
  'papers.mocks': 'मॉक',
  'papers.start': 'प्रश्नपत्र शुरू करें',
  'papers.resume': 'जारी रखें',
  'papers.questions': '{n} प्रश्न',
  'papers.minutes': '{n} मिनट',
  'papers.bestScore': 'सर्वोत्तम {score}/{max}',
  'papers.notAttempted': 'अभी तक नहीं दिया',
  'papers.empty': 'अभी कोई स्वीकृत प्रश्नपत्र नहीं',
  'papers.emptyBody': 'सामग्री समीक्षा में स्वीकृत होने पर प्रश्नपत्र यहाँ दिखेंगे।',
  'papers.devBundle': 'विकास बंडल — अधूरा प्रश्नपत्र',
  'papers.mocksSoon': 'AI मॉक प्रश्नपत्र आगे के चरण में।',

  'result.title': 'परिणाम',
  'result.score': 'अंक',
  'result.correct': 'सही',
  'result.incorrect': 'ग़लत',
  'result.unattempted': 'नहीं किया',
  'result.bonus': 'बोनस अंक',
  'result.time': 'लगा समय',
  'result.reviewAll': 'सभी प्रश्न देखें',
  'result.reviewMistakes': 'केवल ग़लतियाँ देखें',
  'result.done': 'पूरा',
  'result.savedOffline': 'इसी फ़ोन में सुरक्षित',
  'review.yourAnswer': 'आपका उत्तर',
  'review.correctAnswer': 'सही उत्तर',
  'review.whyWrong': 'बाक़ी विकल्प क्यों ग़लत हैं',
  'review.noExplanation': 'इस प्रश्न की व्याख्या अभी नहीं है।',
  'review.howWrong': 'यह ग़लत कैसे हुआ?',
  'review.mistake.conceptual': 'अवधारणा',
  'review.mistake.calculation': 'गणना',
  'review.mistake.misread': 'प्रश्न ग़लत पढ़ा',
  'review.mistake.silly': 'छोटी चूक',
  'review.mistake.confused': 'दो अवधारणाएँ मिलाईं',
  'review.mistake.memory': 'याद नहीं आया',
  'review.mistake.time_pressure': 'समय का दबाव',
"""

GU = """
  'exam.loading': 'પ્રશ્નપત્ર ખૂલી રહ્યું છે…',
  'exam.question': 'પ્ર',
  'exam.palette': 'પ્રશ્ન યાદી',
  'exam.clear': 'જવાબ હટાવો',
  'exam.markNext': 'ચિહ્નિત કરી આગળ',
  'exam.saveNext': 'સાચવી આગળ',
  'exam.submit': 'જમા કરો',
  'exam.submitTitle': 'આ પ્રશ્નપત્ર જમા કરવું?',
  'exam.submitConfirm': 'જમા કરો',
  'exam.keepGoing': 'ચાલુ રાખો',
  'exam.unansweredWarning': '{n} પ્રશ્નો હજી બાકી છે.',
  'exam.toggleLanguage': 'ભાષા બદલો',
  'exam.bonusNotice': 'આ પ્રશ્નના બધા વિકલ્પો બોર્ડે સ્વીકાર્યા છે.',
  'exam.state.answered': 'જવાબ આપ્યો',
  'exam.state.notAnswered': 'જવાબ નથી આપ્યો',
  'exam.state.marked': 'ચિહ્નિત',
  'exam.state.answeredMarked': 'જવાબ + ચિહ્નિત',
  'exam.state.notVisited': 'જોયું નથી',

  'papers.title': 'પ્રશ્નપત્રો',
  'papers.official': 'પ્રશ્નપત્રો',
  'papers.mocks': 'મોક',
  'papers.start': 'પ્રશ્નપત્ર શરૂ કરો',
  'papers.resume': 'ચાલુ રાખો',
  'papers.questions': '{n} પ્રશ્નો',
  'papers.minutes': '{n} મિનિટ',
  'papers.bestScore': 'શ્રેષ્ઠ {score}/{max}',
  'papers.notAttempted': 'હજી આપ્યું નથી',
  'papers.empty': 'હજી કોઈ મંજૂર પ્રશ્નપત્ર નથી',
  'papers.emptyBody': 'સામગ્રી સમીક્ષામાં મંજૂર થયા પછી પ્રશ્નપત્રો અહીં દેખાશે.',
  'papers.devBundle': 'વિકાસ બંડલ — અધૂરું પ્રશ્નપત્ર',
  'papers.mocksSoon': 'AI મોક પ્રશ્નપત્રો આગળના તબક્કામાં.',

  'result.title': 'પરિણામ',
  'result.score': 'ગુણ',
  'result.correct': 'સાચા',
  'result.incorrect': 'ખોટા',
  'result.unattempted': 'નથી કર્યા',
  'result.bonus': 'બોનસ ગુણ',
  'result.time': 'લાગેલો સમય',
  'result.reviewAll': 'બધા પ્રશ્નો જુઓ',
  'result.reviewMistakes': 'ફક્ત ભૂલો જુઓ',
  'result.done': 'પૂર્ણ',
  'result.savedOffline': 'આ ફોનમાં સાચવેલું',
  'review.yourAnswer': 'તમારો જવાબ',
  'review.correctAnswer': 'સાચો જવાબ',
  'review.whyWrong': 'બાકીના વિકલ્પો કેમ ખોટા છે',
  'review.noExplanation': 'આ પ્રશ્નની સમજૂતી હજી નથી.',
  'review.howWrong': 'આ ખોટું કેવી રીતે થયું?',
  'review.mistake.conceptual': 'ખ્યાલ',
  'review.mistake.calculation': 'ગણતરી',
  'review.mistake.misread': 'પ્રશ્ન ખોટો વાંચ્યો',
  'review.mistake.silly': 'નાની ભૂલ',
  'review.mistake.confused': 'બે ખ્યાલો ભેળવ્યા',
  'review.mistake.memory': 'યાદ ન આવ્યું',
  'review.mistake.time_pressure': 'સમયનું દબાણ',
"""

ANCHORS = [
    ("  'soon.progress': 'Mastery, mistakes and performance land in the next slice.',\n};", EN),
    ("  'soon.progress': 'महारत, ग़लतियाँ और प्रदर्शन अगले चरण में।',\n};", HI),
    ("  'soon.progress': 'નિપુણતા, ભૂલો અને દેખાવ આગળના તબક્કામાં.',\n};", GU),
]


def main() -> int:
    s = io.open(P, encoding="utf-8").read()
    if "'exam.saveNext'" in s:
        print("already added; nothing to do")
        return 0
    for anchor, block in ANCHORS:
        if anchor not in s:
            print(f"! anchor not found: {anchor[:50]!r}")
            return 1
        s = s.replace(anchor, anchor[:-2] + block + "};")
    io.open(P, "w", encoding="utf-8").write(s)
    print(f"added exam strings to {s.count(chr(39) + 'exam.saveNext' + chr(39))} dictionaries")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
