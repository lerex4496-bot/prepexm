/**
 * Press feedback, on press-DOWN, with a critically damped spring.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every tappable surface in the app used `scale: 0.995` swapped in on press.
 * That is below the perception threshold — measured against a 400px-wide card
 * it is a two-pixel change — so in practice the app had no press feedback at
 * all. Taps felt dead, and "dead" is the word for it: the moment feedback lags
 * or goes missing, the sense of touching the thing directly falls off a cliff.
 *
 * Apple's rule is that feedback belongs on the press, not the release, and that
 * it should be a spring rather than a style swap: a spring animates from
 * wherever the value currently IS, so a fast double tap or a press-drag-release
 * stays continuous instead of jumping.
 *
 * THE NUMBERS ARE NOT INVENTED
 * ----------------------------
 * `dampingRatio` and `duration` in Reanimated are the same two parameters
 * Apple exposes as damping and response, which is why this translates cleanly
 * from a web/iOS idiom to React Native:
 *
 *   dampingRatio 1.0  critically damped — settles without overshoot. Correct
 *                     for a press, because nothing about a fingertip on glass
 *                     should bounce. Bounce is reserved for motion the user
 *                     themselves threw (a flick, a drag release), and a tap is
 *                     not that.
 *   duration 0.35s    Apple's "response" for a reposition. Not a duration in
 *                     the keyframe sense: the spring has no fixed end, this
 *                     sets how quickly it converges.
 *
 * SCALE 0.97 comes from the same source. It is small enough to read as a press
 * rather than a shrink, and large enough to actually be seen — which 0.995 was
 * not.
 *
 * REDUCED MOTION
 * --------------
 * Reduced motion does not mean no feedback; it means feedback without the
 * vestibular part. With it on, the scale is dropped and the opacity dip stays,
 * so the press is still confirmed. Silently removing all feedback would make
 * the app feel broken to the people who need the setting.
 */

import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';

/** Apple's damping/response pair, as Reanimated spells it. */
export const PRESS_SPRING = { dampingRatio: 1.0, duration: 350 } as const;

/** Momentum-driven motion may overshoot; a press never should. */
export const FLICK_SPRING = { dampingRatio: 0.8, duration: 350 } as const;

export const PRESS_SCALE = 0.97;

export function useReduceMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (alive) setReduced(v);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      alive = false;
      sub?.remove();
    };
  }, []);
  return reduced;
}

/**
 * Shared value that springs to the pressed scale and back.
 *
 * Returned with its handlers rather than as a component so the same feel
 * applies to a card, a button and anything added later — one definition of
 * "what a press feels like" instead of a number copied into each call site.
 */
export function usePressScale(enabled = true): {
  scale: SharedValue<number>;
  onPressIn: () => void;
  onPressOut: () => void;
} {
  const scale = useSharedValue(1);
  const reduced = useReduceMotion();
  // Read through a ref inside the handlers so a change to the accessibility
  // setting takes effect on the next press without re-creating them.
  const off = useRef(false);
  off.current = reduced || !enabled;

  return {
    scale,
    onPressIn: () => {
      scale.value = withSpring(off.current ? 1 : PRESS_SCALE, PRESS_SPRING);
    },
    onPressOut: () => {
      scale.value = withSpring(1, PRESS_SPRING);
    },
  };
}
