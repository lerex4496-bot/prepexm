/**
 * The height of the bottom tab bar, in one place.
 *
 * React Navigation exposes this as `useBottomTabBarHeight`, but
 * `@react-navigation/bottom-tabs` is not a direct dependency here — it arrives
 * under expo-router — and reaching into a transitive package for a layout
 * constant breaks silently the next time expo-router reorganises.
 *
 * It matters outside the tab bar because a screen with a text input has to know
 * how much of the bottom of the window is already spoken for. Expo SDK 57 ships
 * edge-to-edge, and an edge-to-edge window does not resize when the keyboard
 * opens, so KeyboardAvoidingView has to be told where the usable area really
 * ends. Get it wrong and the composer sits under the keys: exactly the bug
 * where the send button could not be reached at all.
 *
 * Must stay in step with `tabBarStyle.height` in app/(tabs)/_layout.tsx.
 */
export const TAB_BAR_HEIGHT = 68;
