import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import type { ExamCode } from '@/theme/colors';

export type Lang = 'en' | 'hi' | 'gu';
export type PrepLevel = 'starting' | 'revising' | 'nearly';
export type ThemePref = 'system' | 'light' | 'dark';

/**
 * Which CTET paper she is actually sitting.
 *
 * CTET is two separate exams under one name. Paper 1 qualifies for Classes I–V,
 * Paper 2 for Classes VI–VIII, and Paper 2 splits again by elective: Mathematics
 * and Science, or Social Studies. A candidate sits ONE of these.
 *
 * Matches `papers.paper_type` in the content bundle exactly, so it can be used
 * as a query filter without translation.
 */
export type PaperType = 'CTET_P1' | 'CTET_P2_MATHSCI' | 'CTET_P2_SOCSCI';

/** Listed in the order they appear on the CBSE notification. */
export const PAPER_TYPES: PaperType[] = ['CTET_P1', 'CTET_P2_MATHSCI', 'CTET_P2_SOCSCI'];

export interface Profile {
  onboarded: boolean;
  name: string | null;
  exam: ExamCode | null;
  /**
   * Null means "show everything", which is the right default for a profile
   * created before this field existed and for NEET, where no such split exists.
   *
   * Without it a Social Studies candidate was shown Paper 1 and the Maths and
   * Science paper alongside her own — two thirds of the practice list being
   * questions she will never be asked, and a daily plan built from them.
   */
  paperType: PaperType | null;
  /**
   * The language of EXAM CONTENT — question stems, options, explanations.
   *
   * Navigation is deliberately NOT covered by this. The app chrome is always
   * English (see UI_LANG in i18n/useT.ts): she is preparing in Hindi but the
   * words "Practice", "Settings" and "Submit" are the ones she already reads on
   * every other app, and translating them made the app harder to move around,
   * not easier. Content is the part that must be in her language.
   */
  contentLang: Lang;
  /** Session she is sitting for, e.g. 'CTET-2027-02'. Drives urgency. */
  target: string | null;
  level: PrepLevel | null;
  /** Minutes per day she said she has. Drives plan length. */
  dailyMinutes: number | null;
  diagnosticDone: boolean;
  theme: ThemePref;
  reducedMotion: boolean;
  /**
   * Where the tutor API lives. The tutor is the only networked feature, so
   * this is configurable rather than compiled in — a dev laptop's IP changes,
   * and a hosted deployment shouldn't need an app rebuild.
   */
  apiBaseUrl: string | null;
}

const EMPTY: Profile = {
  onboarded: false,
  name: null,
  exam: null,
  paperType: null,
  contentLang: 'en',
  target: null,
  level: null,
  dailyMinutes: null,
  diagnosticDone: false,
  theme: 'system',
  reducedMotion: false,
  apiBaseUrl: null,
};

const KEY = 'studymate.profile.v1';

interface ProfileStore {
  profile: Profile;
  hydrated: boolean;
  set: (patch: Partial<Profile>) => void;
  reset: () => void;
  hydrate: () => Promise<void>;
}

/**
 * Slice 1 persists the profile to AsyncStorage. The content database
 * (expo-sqlite, via the frozen content contract) arrives in Slice 2 when there
 * is real parsed content to hold — there is nothing to gain from standing up
 * SQLite for eight scalar fields.
 */
export const useProfile = create<ProfileStore>((set, get) => ({
  profile: EMPTY,
  hydrated: false,

  set: (patch) => {
    const next = { ...get().profile, ...patch };
    set({ profile: next });
    void AsyncStorage.setItem(KEY, JSON.stringify(next));
  },

  reset: () => {
    set({ profile: EMPTY });
    void AsyncStorage.removeItem(KEY);
  },

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw) {
        const stored = JSON.parse(raw) as Partial<Profile> & { lang?: Lang };
        // `lang` was one field driving both chrome and content. Carry a
        // pre-split profile over rather than silently resetting her to English
        // — she chose Hindi once and should not have to choose again.
        if (stored.lang && !stored.contentLang) stored.contentLang = stored.lang;
        delete stored.lang;
        set({ profile: { ...EMPTY, ...stored } });
      }
    } catch {
      // A corrupt profile must never brick the app — fall back to empty and
      // let her re-onboard.
    } finally {
      set({ hydrated: true });
    }
  },
}));
