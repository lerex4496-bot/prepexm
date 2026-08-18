/**
 * Guards the bug that made every button in the app invisible.
 *
 * Button renders through Animated.createAnimatedComponent(Pressable), and an
 * animated component cannot resolve a `({ pressed }) => [...]` style. Reanimated
 * does not warn about it — it drops the WHOLE array, so the base styles, the
 * variant surface, minHeight and borderRadius all disappear. The control stays
 * mounted and stays tappable; it just draws nothing.
 *
 * That shipped. Onboarding reached the phone with no visible Continue button,
 * and because the button was still THERE the screenshots looked like a layout
 * with a missing element rather than a broken style.
 *
 * A rendering test would be the thorough version and needs a native Reanimated
 * mock; this reads the source instead, which is enough to catch the exact
 * mistake and costs nothing to run.
 */
// Declared rather than imported from @types/node: tsconfig pins `types` to
// ["jest"], and pulling in the whole Node type surface for one file read would
// change what every other file in the app is allowed to reference.
declare const require: (m: string) => { readFileSync(p: string, enc: string): string };
declare const process: { cwd(): string };

function source(file: string): string {
  return require('fs').readFileSync(`${process.cwd()}/src/ui/${file}`, 'utf8');
}

describe('animated components never receive a style function', () => {
  it('Button passes an array, not a callback', () => {
    const code = source('Button.tsx');
    expect(code).toMatch(/<AnimatedPressable/);
    // The failure mode exactly: a style prop opening with a destructured
    // `pressed` callback on the animated component.
    expect(code).not.toMatch(/style=\{\(\s*\{\s*pressed/);
    expect(code).toMatch(/style=\{\[/);
  });

  it('Card keeps its Animated.View INSIDE a plain Pressable', () => {
    // The other safe shape: a normal Pressable may take a style function,
    // provided the animated view is nested rather than being the Pressable.
    const code = source('Surface.tsx');
    expect(code).toMatch(/<Animated\.View style=\{animated\}>/);
  });
});
