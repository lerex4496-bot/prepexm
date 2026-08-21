import React, { useMemo } from 'react';
import { ScrollView, Text as RNText, View, type TextStyle } from 'react-native';

import { dominantScript, splitScriptRuns } from '@/i18n/script';
import { useTheme } from '@/theme/ThemeProvider';
import { fontFamily, resolveType, type TypeVariant, type Weight } from '@/theme/typography';
import { parseInline, parseMarkdown, type Block, type Run } from './parse';

/**
 * Render the tutor's answers as the formatted text they were written as.
 *
 * WHY THIS IS NOT `react-native-markdown-display`
 * ----------------------------------------------
 * Every off-the-shelf renderer draws with a plain `<Text>`, and a plain
 * `<Text>` is exactly what this app's typography exists to avoid: it picks one
 * font family for the whole string, so a Hindi answer with an English term in
 * it loses the Devanagari face on one run or the Latin face on the other, and
 * it applies a Latin line height that clips matras. Answers here are routinely
 * mixed-script. So the inline layer below does what `@/ui/Text` does — split
 * into script runs, one family each — and adds weight on top of it.
 *
 * WHAT THE STYLING IS FOR
 * -----------------------
 * She is revising from this on a phone, at night, in a hurry. Headings and
 * bold are load-bearing: they are how she finds the definition again on the
 * second read. So bold uses a heavier FACE rather than a colour, headings get
 * real space above them, and the accent colour is spent on two things only —
 * citation markers and the rule under a section heading — because a page where
 * six things are coloured has nothing emphasised at all.
 */
export function Markdown({
  text,
  variant = 'body',
  tone = 'default',
}: {
  text: string;
  /** Body metrics to build on. `option` is the smaller exam-content scale. */
  variant?: Extract<TypeVariant, 'body' | 'option' | 'caption'>;
  tone?: 'default' | 'secondary';
}) {
  const { colors, spacing } = useTheme();
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  const color = tone === 'secondary' ? colors.inkSecondary : colors.ink;

  return (
    <View style={{ gap: spacing.sm }}>
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} variant={variant} color={color} first={i === 0} />
      ))}
    </View>
  );
}

function BlockView({
  block,
  variant,
  color,
  first,
}: {
  block: Block;
  variant: Extract<TypeVariant, 'body' | 'option' | 'caption'>;
  color: string;
  first: boolean;
}) {
  const { colors, spacing, radius } = useTheme();

  switch (block.kind) {
    case 'heading': {
      // A heading needs more space ABOVE it than below: the gap is what says
      // "the previous section ended", and without it a bold line reads as part
      // of the paragraph before it.
      const headingVariant: TypeVariant = block.level === 1 ? 'h2' : block.level === 2 ? 'h3' : 'bodyStrong';
      return (
        <View style={{ marginTop: first ? 0 : spacing.md, gap: 4 }}>
          <Line text={block.text} variant={headingVariant} color={colors.ink} />
          {block.level <= 2 ? (
            <View style={{ height: 2, width: 28, borderRadius: 2, backgroundColor: colors.accent }} />
          ) : null}
        </View>
      );
    }

    case 'paragraph':
      return <Line text={block.text} variant={variant} color={color} />;

    case 'quote':
      // The one place a fill is used. A definition worth memorising should be
      // findable by scrolling past it, not only by reading it.
      return (
        <View
          style={{
            borderLeftWidth: 3,
            borderLeftColor: colors.accent,
            backgroundColor: colors.surfaceSunken,
            borderRadius: radius.sm,
            paddingVertical: spacing.sm,
            paddingHorizontal: spacing.md,
          }}
        >
          <Line text={block.text} variant={variant} color={colors.inkSecondary} />
        </View>
      );

    case 'code':
      return (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{
            backgroundColor: colors.surfaceSunken,
            borderRadius: radius.sm,
            borderWidth: 1,
            borderColor: colors.hairline,
          }}
          contentContainerStyle={{ padding: spacing.sm }}
        >
          <RNText style={{ fontFamily: MONO, fontSize: 13, lineHeight: 19, color: colors.ink }}>
            {block.text}
          </RNText>
        </ScrollView>
      );

    case 'rule':
      return <View style={{ height: 1, backgroundColor: colors.hairline, marginVertical: spacing.xs }} />;

    case 'list':
      return (
        <View style={{ gap: 6 }}>
          {block.items.map((item, i) => (
            <View
              key={i}
              style={{ flexDirection: 'row', gap: spacing.sm, paddingLeft: item.depth * spacing.md }}
            >
              {/* The marker is fixed-width so wrapped text lines up under the
                  first word rather than under the number. */}
              <View style={{ minWidth: block.ordered ? 22 : 12 }}>
                <Line text={item.marker} variant={variant} color={colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Line text={item.text} variant={variant} color={color} />
              </View>
            </View>
          ))}
        </View>
      );

    case 'table':
      return <Table block={block} variant={variant} color={color} />;
  }
}

/**
 * A table scrolls sideways rather than squeezing its columns.
 *
 * Three columns of Devanagari inside a chat bubble on a 360dp screen is one
 * word per line otherwise, which is not a table any more.
 */
function Table({
  block,
  variant,
  color,
}: {
  block: Extract<Block, { kind: 'table' }>;
  variant: Extract<TypeVariant, 'body' | 'option' | 'caption'>;
  color: string;
}) {
  const { colors, spacing, radius } = useTheme();
  const cellWidth = Math.max(96, Math.round(300 / Math.max(1, block.header.length)));

  const row = (cells: string[], header: boolean, key: number): React.ReactElement => (
    <View
      key={key}
      style={{
        flexDirection: 'row',
        borderTopWidth: header ? 0 : 1,
        borderTopColor: colors.hairline,
        backgroundColor: header ? colors.surfaceSunken : undefined,
      }}
    >
      {block.header.map((_, c) => (
        <View key={c} style={{ width: cellWidth, padding: spacing.sm }}>
          <Line
            text={cells[c] ?? ''}
            variant={header ? 'bodyStrong' : variant}
            color={header ? colors.ink : color}
          />
        </View>
      ))}
    </View>
  );

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={{ borderWidth: 1, borderColor: colors.hairline, borderRadius: radius.sm, overflow: 'hidden' }}>
        {row(block.header, true, -1)}
        {block.rows.map((r, i) => row(r, false, i))}
      </View>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------

/**
 * Android has no bundled monospace family name that is safe to assume beyond
 * this one, and the app ships no mono face of its own — code in an answer is
 * rare enough not to justify another 200 kB in the APK.
 */
const MONO = 'monospace';

/** Heavier faces for emphasis, per base variant. */
const BOLD_WEIGHT: Weight = 'semibold';

/**
 * One paragraph: correct metrics for its dominant script, then styled runs
 * inside it, each split again by script so families never get substituted.
 */
function Line({
  text,
  variant,
  color,
}: {
  text: string;
  variant: TypeVariant;
  color: string;
}) {
  const { colors } = useTheme();
  const runs = useMemo(() => parseInline(text), [text]);

  const script = dominantScript(text);
  const resolved = resolveType(variant, script);
  const base: TextStyle = {
    fontSize: resolved.fontSize,
    lineHeight: resolved.lineHeight,
    letterSpacing: resolved.letterSpacing,
    color,
    fontFamily: fontFamily(script, resolved.weight),
  };

  return (
    <RNText style={base}>
      {runs.map((run, i) => (
        <RunText key={i} run={run} weight={resolved.weight} color={color} accent={colors.accent} />
      ))}
    </RNText>
  );
}

function RunText({
  run,
  weight,
  color,
  accent,
}: {
  run: Run;
  weight: Weight;
  color: string;
  accent: string;
}) {
  if ('cite' in run) {
    // Citation markers carry the accent so the eye can find "where did this
    // come from" without reading the sentence again.
    return <RNText style={{ color: accent, fontFamily: fontFamily('latn', 'semibold') }}>{run.text}</RNText>;
  }

  if (run.code) {
    return <RNText style={{ fontFamily: MONO, color }}>{run.text}</RNText>;
  }

  const runWeight: Weight = run.bold ? BOLD_WEIGHT : weight;
  const style: TextStyle = {
    color,
    ...(run.italic ? { fontStyle: 'italic' } : null),
    ...(run.strike ? { textDecorationLine: 'line-through' } : null),
  };

  // Same rule as @/ui/Text: one family per script run, or the OS silently
  // substitutes a system font for whichever script the family does not cover.
  const parts = splitScriptRuns(run.text);
  return (
    <RNText style={style}>
      {parts.map((part, i) => (
        <RNText key={i} style={{ fontFamily: fontFamily(part.script, runWeight) }}>
          {part.text}
        </RNText>
      ))}
    </RNText>
  );
}
