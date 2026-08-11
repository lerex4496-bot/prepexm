import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { Text } from '@/ui';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Isolated countdown.
 *
 * This is a SEPARATE component holding its own state on purpose: it re-renders
 * once a second, and if that state lived in the exam store every tick would
 * re-render the question stem and all four options. On a mid-range Android
 * device that is a visible stutter once a second, for three hours.
 *
 * Nothing else may read this state.
 */
export function ExamTimer({
  durationS,
  elapsedAtStartS,
  paused = false,
  onExpire,
}: {
  durationS: number;
  elapsedAtStartS: number;
  /** While true the clock is frozen and no expiry can fire. */
  paused?: boolean;
  onExpire: () => void;
}) {
  const { colors } = useTheme();
  const startedAt = useRef(Date.now() - elapsedAtStartS * 1000);
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, durationS - elapsedAtStartS)
  );
  const fired = useRef(false);

  // Resuming rebases the origin so the paused interval is not counted. Without
  // this the component would keep measuring against its original start and a
  // ten-minute pause would silently cost ten minutes of exam time.
  useEffect(() => {
    if (paused) return;
    startedAt.current = Date.now() - (durationS - remaining) * 1000;
    // `remaining` is intentionally not a dependency: this must run when the
    // pause state flips, not on every tick, or the origin would never advance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, durationS]);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt.current) / 1000);
      const left = Math.max(0, durationS - elapsed);
      setRemaining(left);
      if (left === 0 && !fired.current) {
        fired.current = true;
        onExpire();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [durationS, onExpire, paused]);

  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = remaining % 60;
  const pad = (n: number) => String(n).padStart(2, '0');

  const low = !paused && remaining < 300; // last five minutes

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <Text variant="caption" color={low ? colors.error : colors.inkMuted}>
        {paused ? '⏸' : '⏱'}
      </Text>
      {/* tabular figures: the width must not jitter as the digits change */}
      <Text variant="numeric" color={low ? colors.error : colors.ink}>
        {pad(h)}:{pad(m)}:{pad(s)}
      </Text>
    </View>
  );
}
