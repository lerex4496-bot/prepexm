import type { ExamCode } from '@/theme/colors';
import type { Lang } from '@/store/profile';

/**
 * App copy.
 *
 * ON THE MISSING HINDI AND GUJARATI DICTIONARIES
 * ----------------------------------------------
 * This file used to carry three full dictionaries. It was destroyed by a bad
 * write during a scripted edit and there was no commit to restore from, so the
 * English copy below was reconstructed from every call site in the app and the
 * other two are intentionally empty.
 *
 * That is survivable rather than merely tolerable, because of the B1 decision:
 * app chrome is ALWAYS English (see UI_LANG in useT.ts). `translate()` is only
 * ever called with 'en', so the other dictionaries were already dead code by
 * the time they were lost. Exam CONTENT — stems, options, explanations,
 * passages — is unaffected: it lives in the content database, not here.
 *
 * If chrome translation is ever revived, add the dictionaries back here and the
 * fallback chain below will pick them up with no other change.
 */

type Dict = Record<string, string>;

const en: Dict = {
  // ── common ────────────────────────────────────────────────────────────────
  'common.back': 'Back',
  'common.next': 'Next',
  'common.done': 'Done',
  'common.cancel': 'Cancel',
  'common.min': 'min',
  'common.minutes': 'minutes',

  // ── tabs ──────────────────────────────────────────────────────────────────
  'tab.today': 'Today',
  'tab.learn': 'Learn',
  'tab.practice': 'Practice',
  'tab.progress': 'Progress',
  'tab.ask': 'Ask',

  // ── onboarding ────────────────────────────────────────────────────────────
  'ob.welcome.title': 'Let’s get you ready.',
  'ob.welcome.body':
    'A few questions so the plan fits your days, not someone else’s. It takes a minute.',
  'ob.welcome.cta': 'Start',
  'ob.exam.title': 'Which exam are you preparing for?',
  'ob.exam.body': 'Everything after this — papers, plan, practice — follows from this answer.',
  'ob.exam.ctet': 'CTET',
  'ob.exam.neet': 'NEET',
  'ob.lang.title': 'Which language do you study in?',
  'ob.lang.body': 'You can change this any time, even mid-question. Menus stay in English.',
  'ob.target.title': 'Which sitting are you aiming for?',
  'ob.target.body': 'This sets the pace. You can move it later if plans change.',
  'ob.level.title': 'Where are you right now?',
  'ob.level.starting': 'Just starting',
  'ob.level.startingHint': 'Beginning the syllabus',
  'ob.level.revising': 'Revising',
  'ob.level.revisingHint': 'Been through most of it once',
  'ob.level.nearly': 'Nearly ready',
  'ob.level.nearlyHint': 'Polishing and timing',
  'ob.time.title': 'How long can you study most days?',
  'ob.time.body': 'Be honest rather than ambitious — the plan is built to fit.',
  'ob.diag.title': 'A short check?',
  'ob.diag.body':
    'Ten questions, about five minutes. It tells the plan where to start. You can skip it.',
  'ob.diag.start': 'Take the check',
  'ob.diag.skip': 'Skip for now',
  'ob.done.title': 'You’re set.',

  // ── today ─────────────────────────────────────────────────────────────────
  'today.morning': 'Good morning',
  'today.afternoon': 'Good afternoon',
  'today.evening': 'Good evening',
  'today.planTitle': 'Today',
  'today.loading': 'Loading your plan…',
  'today.loadFailed': 'Could not load your plan',
  'today.summary': '{count} things · about {minutes} min',
  'today.start': 'Start',
  'today.allDone': 'That’s today done.',
  'today.allDoneBody': 'Nothing left on the plan. Rest, or practise anyway if you want to.',
  'today.practiceAnyway': 'Practise anyway',
  'today.readiness': 'Readiness',
  'today.readinessLocked': 'Sit a full paper to unlock this',
  'today.attention': 'Needs attention',
  'today.wrongCount': '{n} wrong',
  'today.kind.learn': 'Learn',
  'today.kind.practice': 'Practise',
  'today.kind.recall': 'Recall',
  'today.kind.fix': 'Fix',

  // Why an item is on the plan. Rendered under it, in her words.
  'why.MISSED_TWICE': 'You’ve missed this {count} times',
  'why.RECENT_MISTAKE': 'From your recent mistakes',
  'why.HIGH_WEIGHTAGE': '{pct}% of your mistakes are here',
  'why.NEVER_SEEN': 'You haven’t seen this yet',
  'why.DUE_TODAY': 'Due for review after {days} days',

  // ── learn ─────────────────────────────────────────────────────────────────
  'learn.subtitle': 'Everything in your papers, by section',
  'learn.part': 'Part {n}',
  'learn.other': 'Other',

  // ── practice / papers ─────────────────────────────────────────────────────
  'papers.title': 'Previous papers',
  'papers.official': 'Official papers',
  'papers.mocks': 'Mock papers',
  'papers.mocksSoon': 'Practice sets and mocks are coming.',
  'papers.empty': 'No papers yet',
  'papers.neetSoon': 'NEET papers aren’t ready yet',
  'papers.neetSoonBody':
    'This build ships CTET papers only. NEET question papers are still being '
    + 'prepared — switch to CTET in Settings to use the app meanwhile.',
  'papers.emptyBody': 'Approved papers appear here once content has been reviewed.',
  'papers.questions': '{n} questions',
  'papers.minutes': '{n} min',
  'papers.notAttempted': 'Not attempted yet',
  'papers.bestScore': 'Best {score}/{max}',
  'papers.resume': 'Resume',
  'papers.usedMin': '{n} min used',
  'papers.attempts': '{n} attempts',
  'papers.devBundle': 'Development bundle — some papers are incomplete',
  'badge.official': 'OFFICIAL',
  'badge.mock': 'MOCK',

  // ── mock tests ────────────────────────────────────────────────────────────
  // Every question in a mock came off a real CTET paper with the board's own
  // answer key behind it. Only the selection and order are new, and the copy
  // says so — she should never have to wonder whether a question is invented.
  'mock.intro':
    'A full 150-question paper under the real clock, built from questions that appeared on past CTET papers — same sections, same marks, new order.',
  'mock.start': 'Start a new mock test',
  'mock.title': 'Mock test',
  'mock.previous': 'Your mock tests',
  'mock.focused': 'Shorter practice',
  'mock.priority': 'Most-asked topics',
  'mock.priorityBody':
    'Drawn from the topics that appeared in all {n} of your past papers. Measured from the real papers, not predicted.',
  'mock.weak': 'Your weak areas',
  'mock.weakBody': '{n} questions you have got wrong before, the repeat offenders first.',
  'mock.section.sst': 'Social Studies only',
  'mock.section.cdp': 'Child Development only',
  'mock.section.lang1': 'Language I only',
  'mock.section.lang2': 'Language II only',
  'mock.sectionBody': '{n} questions · {min} minutes — the real pace, in one sitting.',
  'mock.byTopic': 'Practise one topic',
  'mock.hideTopics': 'Hide topics',
  'mock.inSittings': 'in {n} of {of} papers',
  'mock.short':
    'This mock is short of {n} questions in {subject} — there aren’t enough approved questions yet.',

  // ── exam player ───────────────────────────────────────────────────────────
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
  'exam.pause': 'Pause',
  'exam.paused': 'Paused',
  'exam.pausedBody':
    'The clock is stopped. Your answers are saved. Close the app if you like — this attempt will be waiting.',
  'exam.resume': 'Resume',
  'exam.exitPaused': 'Leave for now',
  'exam.bonusNotice': 'The board accepted all options for this question.',
  'exam.state.answered': 'Answered',
  'exam.state.notAnswered': 'Not answered',
  'exam.state.marked': 'Marked',
  'exam.state.answeredMarked': 'Answered & marked',
  'exam.state.notVisited': 'Not visited',

  // ── passages ──────────────────────────────────────────────────────────────
  'passage.label': 'Reading passage',
  'passage.show': 'Show',
  'passage.hide': 'Hide',
  'passage.englishOnly': 'Shown in English — this passage has no translation in the paper.',

  // ── result ────────────────────────────────────────────────────────────────
  'result.title': 'Result',
  'result.score': 'Score',
  'result.correct': 'Correct',
  'result.incorrect': 'Incorrect',
  'result.unattempted': 'Unattempted',
  'result.bonus': 'Bonus',
  'result.time': 'Time',
  'result.done': 'Done',
  'result.reviewAll': 'Review all questions',
  'result.reviewMistakes': 'Review mistakes',
  'result.savedOffline': 'Saved on this device',

  // ── review / mistakes ─────────────────────────────────────────────────────
  'review.noExplanation': 'No explanation yet.',
  'review.explainNow': 'Explain this question',
  'review.explaining': 'Working it out…',
  'review.generatedNow': 'Generated just now from the official answer key.',
  'review.explainFailed': 'Could not generate an explanation.',
  'review.whyWrong': 'Why was this wrong?',
  'coach.method': 'How to read it',
  'review.howWrong': 'What happened?',
  'review.mistake.conceptual': 'Didn’t know the concept',
  'review.mistake.calculation': 'Calculation slip',
  'review.mistake.misread': 'Misread the question',
  'review.mistake.silly': 'Silly mistake',
  'review.mistake.confused': 'Confused two options',
  'review.mistake.memory': 'Couldn’t recall',
  'review.mistake.time_pressure': 'Ran out of time',
  'review.mistake.untagged': 'Not tagged',
  'review.mistake.null': 'Not tagged',

  // ── quick practice ────────────────────────────────────────────────────────
  'quick.fromMistakes': 'From your mistakes',
  'quick.mixed': 'Mixed practice',
  'quick.nothing': 'Nothing to practise here yet.',

  // ── history ───────────────────────────────────────────────────────────────
  'history.title': 'Attempt history',
  'history.empty': 'No finished attempts yet',
  'history.emptyBody':
    'Attempts appear here once you submit them. Pausing keeps an attempt open — it is not history until it is submitted.',
  'history.retake': 'Start a new attempt',
  'history.inProgress': 'In progress',
  'history.paused': 'Paused · {n} min used',
  'history.took': 'took {n} min',
  'history.best': 'Best',

  // ── progress ──────────────────────────────────────────────────────────────
  'progress.performance': 'Performance',
  'progress.latest': 'Latest',
  'progress.best': 'Best',
  'progress.attempts': '{n} attempts',
  'progress.mistakes': 'Mistake notebook',
  'progress.repeatedly': 'You keep getting these wrong',
  'progress.noMistakes': 'No mistakes recorded',
  'progress.noMistakesBody': 'Sit a paper or practise, and anything you get wrong lands here.',
  'progress.markFixed': 'Mark as fixed',
  'progress.untagged': 'Untagged',
  'progress.emptyTitle': 'Nothing to show yet',
  'progress.emptyBody': 'Your scores and weak areas appear here after your first attempt.',

  // ── tutor sheet ───────────────────────────────────────────────────────────
  'tutor.title': 'Tutor',
  'tutor.context': 'About this question',
  'tutor.thinking': 'Looking through your books…',
  'tutor.fromNcert': 'From your NCERT books',
  'tutor.citationsOnly': 'Here are the pages to read.',
  'tutor.noMatch': 'Your books don’t cover this one.',
  'tutor.unavailable': 'Tutor unavailable right now.',
  'tutor.offlineNote': 'Everything else works offline. Only the tutor needs a connection.',
  'tutor.didntUnderstand': 'I didn’t understand',
  'tutor.askAnother': 'Ask something else',
  'tutor.action.simple': 'In simple words',
  'tutor.action.example': 'Give an example',
  'tutor.action.why': 'Why this answer?',
  'tutor.action.related': 'What else should I know?',

  // ── ask (chat) ────────────────────────────────────────────────────────────
  'ask.grounding':
    'Answers come from your NCERT books, with the page shown. If they don’t cover it, it says so.',
  'ask.emptyBody':
    'Ask in whichever language you think in — Hindi, Gujarati, English, or a mix. Each message is read on its own.',
  'ask.placeholder': 'mujhe photosynthesis samjhao…',
  'ask.send': 'Send',
  'ask.thinking': 'Looking through your books…',
  'ask.sources': '{n} sources',
  'ask.hideSources': 'Hide sources',
  'ask.noAnswer': 'Your books don’t cover this one.',
  'ask.failed': 'Could not reach the tutor.',
  'ask.camera': 'Photograph a question',
  'ask.attach': 'Add your notes (PDF)',
  'ask.photoSent': 'Photo of a question',
  'ask.docSent': 'Adding {name}…',
  'ask.docAdded':
    'Added “{name}” ({pages} pages). It will be searched alongside your textbooks, and cited as your notes.',
  'ask.noSources':
    'Answered without your textbooks — no sources to show. Check anything important.',
  'ask.unverified': 'FROM THE WEB · not verified against any textbook',

  // Permission consent. Android shows its own dialog at most once per install:
  // after a denial the system prompt never appears again, so the app has to
  // explain itself BEFORE asking, and has to say what happened after a refusal
  // rather than leaving a button that silently does nothing.
  'perm.cameraTitle': 'Use the camera?',
  'perm.cameraBody':
    'StudyMate needs the camera so you can photograph a question instead of typing it out. The photo is read for its text and is not stored anywhere.',
  'perm.libraryTitle': 'Open your photos?',
  'perm.libraryBody':
    'StudyMate needs access to your photos so you can send a picture of a question. Only the picture you choose is read.',
  'perm.allow': 'Continue',
  'perm.notNow': 'Not now',
  'perm.cameraDenied':
    'The camera is blocked for StudyMate, so the photo could not be taken. You can turn it on in Settings — or just type your question here.',
  'perm.libraryDenied':
    'Photo access is blocked for StudyMate, so your gallery could not be opened. You can turn it on in Settings — or just type your question here.',
  'perm.openSettings': 'Open settings',

  // ── which CTET paper ──────────────────────────────────────────────────────
  // CTET is two exams under one name, and Paper 2 splits again by elective. A
  // candidate sits exactly one of these, so showing all three made two thirds
  // of the practice list questions she will never be asked.
  'paper.title': 'Which paper are you sitting?',
  'paper.body': 'CTET Paper 1 and Paper 2 are separate exams. Pick yours and the app only shows that one.',
  'paper.CTET_P1': 'Paper 1',
  'paper.CTET_P1.desc': 'Classes 1–5 · Maths and EVS',
  'paper.CTET_P2_MATHSCI': 'Paper 2 · Maths & Science',
  'paper.CTET_P2_MATHSCI.desc': 'Classes 6–8 · Mathematics and Science elective',
  'paper.CTET_P2_SOCSCI': 'Paper 2 · Social Studies',
  'paper.CTET_P2_SOCSCI.desc': 'Classes 6–8 · Social Studies / Social Science elective',
  'paper.all': 'All papers',
  'settings.bundleHolds': 'Bundle holds',
  'settings.bundleVisible': 'Visible to you',
  'settings.paper': 'Your paper',
  'settings.paperHint':
    'Practice, Today and Learn show only this paper. Your past attempts and mistakes are never hidden by it.',

  // ── chat sessions ─────────────────────────────────────────────────────────
  'chat.sessions': 'Your chats',
  'chat.new': 'New chat',
  'chat.untitled': 'New chat',
  'chat.rename': 'Rename',
  'chat.renameTitle': 'Rename this chat',
  'chat.delete': 'Delete',
  'chat.deleteConfirm': 'Delete this chat? The messages in it are gone for good.',
  'chat.deleteAll': 'Delete all chats',
  'chat.deleteAllConfirm': 'Delete every chat? This cannot be undone.',
  'chat.empty': 'No chats yet',
  'chat.emptyBody': 'Ask something and it will be saved here, so you can come back to it before the exam.',
  'chat.save': 'Save',
  'chat.cancel': 'Cancel',
  'chat.close': 'Close',
  'chat.actions': 'More',
  'chat.justNow': 'just now',
  'chat.minutesAgo': '{n}m ago',
  'chat.hoursAgo': '{n}h ago',
  'chat.daysAgo': '{n}d ago',


  // ── account / backup ──────────────────────────────────────────────────────
  'account.title': 'Backup & restore',
  'account.intro':
    'Optional. Your work is already safe when the app updates — this is for getting it back if the app is reinstalled or you change phone.',
  'account.onThisPhone': 'On this phone',
  'account.localCounts': '{attempts} attempts · {mistakes} mistakes',
  'account.updateSafe': 'Updating the app never touches this. It stays until the app is uninstalled.',
  // ── backup to a file ──────────────────────────────────────────────────────
  // Works with no account and no server: she picks the folder, so the copy can
  // live in Drive or WhatsApp where a lost phone cannot take it.
  'backup.fileHint':
    'Save a copy you keep — to Drive, WhatsApp, anywhere. It survives uninstalling the app or changing phone. No account needed.',
  'backup.save': 'Save my progress',
  'backup.restore': 'Restore from file',
  'backup.savedTitle': 'Saved',
  'backup.savedBody': '{attempts} attempts saved as {name}. Keep it somewhere you will find it.',
  'backup.restoredTitle': 'Restored',
  'backup.restoredBody': '{attempts} attempts are back.',
  'backup.failedTitle': 'Could not do that',
  'backup.failedBody': 'Something went wrong. Nothing on your phone was changed.',
  'backup.wouldLoseTitle': 'This backup is older than your phone',
  'backup.wouldLoseBody':
    'Your phone has {phoneAttempts} attempts; this file has {fileAttempts}. Restoring replaces what is on the phone, so the newer work would be lost.',
  'backup.restoreAnyway': 'Restore anyway',

  'account.signInTitle': 'Sign in, or make an account',
  'account.username': 'Username',
  'account.password': 'Password',
  'account.passwordRule': 'At least 8 characters. No email or phone number is asked for.',
  'account.signIn': 'Sign in',
  'account.createInstead': 'Create a new account instead',
  'account.signedIn': 'Signed in.',
  'account.created': 'Account created.',
  'account.signedInAs': 'Signed in as {name}',
  'account.backupTitle': 'Saved backup',
  'account.backupCounts': '{attempts} attempts · {mistakes} mistakes · saved {when}',
  'account.noBackup': 'Nothing backed up yet.',
  'account.backUp': 'Back up now',
  'account.backedUp': 'Backed up.',
  'account.restore': 'Restore from backup',
  'account.restoreTitle': 'Replace what is on this phone?',
  'account.restoreBody':
    'This phone has {local} attempts. The backup has {backup}. Restoring replaces what is here — it does not merge.',
  'account.restoreConfirm': 'Replace',
  'account.restored': 'Restored.',
  'account.overwriteTitle': 'Your backup has more than this phone',
  'account.overwriteBody':
    'The backup has {stored} attempts; this phone has {incoming}. Backing up now would replace the bigger one. Restore instead, unless you meant to start over.',
  'account.overwriteConfirm': 'Overwrite anyway',
  'account.signOut': 'Sign out',
  'account.signOutSafe': 'Signing out leaves everything on this phone exactly as it is.',
  'account.working': 'Working…',
  'account.failed': 'That didn’t work.',
  'settings.account': 'Backup & restore',
  'settings.accountHint': 'Optional. Keeps your progress if the app is reinstalled or you change phone.',

  // ── settings ──────────────────────────────────────────────────────────────
  'settings.title': 'Settings',
  'settings.language': 'Study language',
  'settings.languageHint': 'Questions, options and explanations. Menus stay in English.',
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
  'settings.resetBody':
    'This clears your profile and starts onboarding again. Your attempts and mistakes stay on the device.',
  'settings.api': 'Tutor server',
  'settings.apiHint': 'Address of the StudyMate API. Only the tutor uses it.',
  'settings.apiCheck': 'Check',
  'settings.apiReachable': 'Reachable',
  'settings.apiUnreachable': 'Not reachable',
};

/**
 * Hindi and Gujarati chrome. Empty by design — see the file header.
 * `translate()` falls back to English for any key missing here, so adding
 * entries is safe and incremental.
 */
const hi: Dict = {};
const gu: Dict = {};

const dictionaries: Record<Lang, Dict> = { en, hi, gu };

export const LANGUAGE_LABEL: Record<Lang, string> = {
  en: 'English',
  hi: 'हिंदी',
  gu: 'ગુજરાતી',
};

/**
 * The languages each exam is actually sat in.
 *
 * CTET papers are printed in English and Hindi. NEET is conducted in 13
 * languages; Gujarati is offered and is the medium the NEET student studies in,
 * so it belongs here rather than being reachable only through a general
 * language list.
 */
export const EXAM_LANGUAGES: Record<ExamCode, Lang[]> = {
  CTET: ['hi', 'en'],
  NEET: ['gu', 'en', 'hi'],
};

const PARAM_RE = /\{(\w+)\}/g;

export function translate(
  lang: Lang,
  key: string,
  params?: Record<string, string | number>
): string {
  // Fall back to English, then to the key itself. Showing the key is ugly but
  // debuggable; showing an empty string hides the omission until someone
  // notices a blank button.
  const raw = dictionaries[lang]?.[key] ?? en[key] ?? key;
  if (!params) return raw;
  return raw.replace(PARAM_RE, (whole, name: string) =>
    name in params ? String(params[name]) : whole
  );
}
