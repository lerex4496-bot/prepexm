/**
 * Exam session state.
 *
 * PERFORMANCE BUDGET (enforced here, not aspirational):
 *  1. The whole paper is loaded into memory before the timer starts. Zero
 *     database reads happen mid-test.
 *  2. The timer lives in its own store slice and its own component, so a tick
 *     never re-renders the question surface. This is why `remainingS` is NOT
 *     part of this store.
 *  3. Responses are persisted on every interaction, so process death costs
 *     nothing.
 *  4. No network calls exist in this path at all.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { loadPaperQuestions, getPaper, type LoadedQuestion, type PaperRow } from '@/db/content';
import {
  checkpointAttempt,
  createAttempt,
  elapsedMs,
  findResumable,
  loadResponses,
  pauseAttempt,
  resumeAttempt,
  saveResponse,
} from '@/db/local';
import { paletteState, type PaletteState } from './scoring';

export interface Response {
  chosen: string | null;
  marked: boolean;
  visited: boolean;
  timeMs: number;
}

export interface ExamSession {
  loading: boolean;
  paper: PaperRow | null;
  questions: LoadedQuestion[];
  attemptId: string | null;
  index: number;
  responses: Map<string, Response>;
  /** Seconds elapsed when the attempt was resumed, so the timer stays honest. */
  elapsedAtStartS: number;
  resumed: boolean;
  /** True while the clock is stopped. The question surface stays mounted. */
  paused: boolean;
}

export function useExam(paperId: string) {
  const [state, setState] = useState<ExamSession>({
    loading: true,
    paper: null,
    questions: [],
    attemptId: null,
    index: 0,
    responses: new Map(),
    elapsedAtStartS: 0,
    resumed: false,
    paused: false,
  });

  // Time-on-question is measured from when the question was shown. Kept in a
  // ref so accumulating it never triggers a render.
  const shownAt = useRef<number>(Date.now());

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [paper, questions] = await Promise.all([
        getPaper(paperId),
        loadPaperQuestions(paperId),
      ]);
      if (cancelled) return;

      const existing = await findResumable(paperId);
      const attemptId = existing?.id ?? (await createAttempt(paperId));
      const rows = existing ? await loadResponses(attemptId) : [];

      const responses = new Map<string, Response>(
        rows.map((r) => [
          r.question_id,
          { chosen: r.chosen, marked: !!r.marked, visited: !!r.visited, timeMs: r.time_ms },
        ])
      );

      // Resume where she left off: the first unanswered question.
      let index = 0;
      if (existing) {
        const firstUnanswered = questions.findIndex((q) => !responses.get(q.id)?.chosen);
        index = firstUnanswered >= 0 ? firstUnanswered : 0;
      }

      // Sum of ACTIVE spans, never wall-clock. An attempt paused on Monday and
      // resumed on Tuesday must show the minutes she actually spent, not 24h.
      const elapsed = existing ? Math.floor(elapsedMs(existing) / 1000) : 0;

      // Opening the player is an intent to sit the exam, so a paused attempt
      // resumes here. The pause button is the only thing that stops the clock.
      if (existing) await resumeAttempt(attemptId);

      if (cancelled) return;
      shownAt.current = Date.now();
      setState({
        loading: false,
        paper,
        questions,
        attemptId,
        index,
        responses,
        elapsedAtStartS: elapsed,
        resumed: !!existing,
        paused: false,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [paperId]);

  const current = state.questions[state.index];

  /** Fold accumulated time into the question we are leaving. */
  const flushTime = useCallback(
    (questionId: string) => {
      const delta = Date.now() - shownAt.current;
      shownAt.current = Date.now();
      if (delta <= 0 || !state.attemptId) return 0;
      void saveResponse(state.attemptId, questionId, { addMs: delta, visited: true });
      return delta;
    },
    [state.attemptId]
  );

  const patch = useCallback(
    (questionId: string, next: Partial<Response>, addMs = 0) => {
      setState((s) => {
        const responses = new Map(s.responses);
        const prev = responses.get(questionId) ?? {
          chosen: null,
          marked: false,
          visited: true,
          timeMs: 0,
        };
        responses.set(questionId, { ...prev, ...next, timeMs: prev.timeMs + addMs, visited: true });
        return { ...s, responses };
      });
    },
    []
  );

  const select = useCallback(
    (label: string) => {
      if (!current || !state.attemptId) return;
      patch(current.id, { chosen: label });
      // Written immediately — the submit screen must never be the first time
      // her answers touch storage.
      void saveResponse(state.attemptId, current.id, { chosen: label, visited: true });
    },
    [current, state.attemptId, patch]
  );

  const clearResponse = useCallback(() => {
    if (!current || !state.attemptId) return;
    patch(current.id, { chosen: null });
    void saveResponse(state.attemptId, current.id, { chosen: null, visited: true });
  }, [current, state.attemptId, patch]);

  const go = useCallback(
    (nextIndex: number) => {
      setState((s) => {
        if (nextIndex < 0 || nextIndex >= s.questions.length) return s;
        const leaving = s.questions[s.index];
        if (leaving) flushTime(leaving.id);
        const responses = new Map(s.responses);
        const target = s.questions[nextIndex];
        const prev = responses.get(target.id) ?? {
          chosen: null,
          marked: false,
          visited: false,
          timeMs: 0,
        };
        responses.set(target.id, { ...prev, visited: true });
        if (s.attemptId) void saveResponse(s.attemptId, target.id, { visited: true });
        return { ...s, index: nextIndex, responses };
      });
    },
    [flushTime]
  );

  const saveAndNext = useCallback(() => go(state.index + 1), [go, state.index]);

  const markAndNext = useCallback(() => {
    if (!current || !state.attemptId) return;
    const nowMarked = !state.responses.get(current.id)?.marked;
    patch(current.id, { marked: nowMarked });
    void saveResponse(state.attemptId, current.id, { marked: nowMarked, visited: true });
    go(state.index + 1);
  }, [current, state.attemptId, state.responses, state.index, patch, go]);

  const counts = useMemo(() => {
    const c: Record<PaletteState, number> = {
      notVisited: 0,
      notAnswered: 0,
      answered: 0,
      marked: 0,
      answeredMarked: 0,
    };
    for (const q of state.questions) c[paletteState(state.responses.get(q.id))] += 1;
    return c;
  }, [state.questions, state.responses]);

  /** Section tabs come from the paper's own parts, not a hardcoded list. */
  const sections = useMemo(() => {
    const out: { part: string; label: string; from: number; to: number }[] = [];
    state.questions.forEach((q, i) => {
      const part = q.part ?? '—';
      const last = out[out.length - 1];
      if (last && last.part === part) last.to = i;
      else out.push({ part, label: q.subject ?? `Part ${part}`, from: i, to: i });
    });
    return out;
  }, [state.questions]);

  /**
   * Stop the clock and close the active span.
   *
   * The component tree is NOT unmounted — she stays on the question, her
   * selection stays selected, and resuming is a state flip rather than a
   * reload. Time on the current question is flushed first so a pause does not
   * quietly donate the last few seconds to whatever she opens next.
   */
  const pause = useCallback(async () => {
    if (!state.attemptId || state.paused) return;
    if (current) flushTime(current.id);
    await pauseAttempt(state.attemptId);
    setState((s) => ({ ...s, paused: true }));
  }, [state.attemptId, state.paused, current, flushTime]);

  const resume = useCallback(async () => {
    if (!state.attemptId || !state.paused) return;
    await resumeAttempt(state.attemptId);
    shownAt.current = Date.now();
    setState((s) => ({ ...s, paused: false }));
  }, [state.attemptId, state.paused]);

  /**
   * Checkpoint the open span periodically, and close it when the app leaves
   * the foreground.
   *
   * Backgrounding auto-pauses. Android can kill a backgrounded process without
   * warning, and if the span were still open the recovered elapsed time would
   * include every hour the app sat killed — the exact failure the span model
   * exists to prevent. Coming back to the foreground does NOT auto-resume:
   * being handed the phone back is not the same as being ready to continue, so
   * she taps Resume.
   */
  useEffect(() => {
    if (!state.attemptId || state.paused) return;
    const attemptId = state.attemptId;

    const tick = setInterval(() => void checkpointAttempt(attemptId), 15_000);
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') {
        if (current) flushTime(current.id);
        void pauseAttempt(attemptId);
        setState((s) => ({ ...s, paused: true }));
      }
    });

    return () => {
      clearInterval(tick);
      sub.remove();
    };
  }, [state.attemptId, state.paused, current, flushTime]);

  return {
    ...state,
    current,
    counts,
    sections,
    pause,
    resume,
    select,
    clearResponse,
    saveAndNext,
    markAndNext,
    go,
    flushTime,
  };
}
