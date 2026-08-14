/**
 * Asking for the camera and photo library, with the student told why first.
 *
 * WHY THIS IS NOT JUST `requestCameraPermissionsAsync()`
 * -----------------------------------------------------
 * Android shows its own permission dialog at most once. After a denial the
 * system prompt never appears again — `request…Async()` returns `granted:
 * false` immediately, with no UI at all. The original code did:
 *
 *     if (!perm.granted) return;
 *
 * so from her side the camera button simply stopped working: no dialog, no
 * message, nothing. She reported it as "it sends me back to the home page",
 * which is what a button that does nothing looks like when you are not a
 * developer.
 *
 * So there are two jobs here, and neither is optional:
 *
 *   1. Explain BEFORE the system prompt, because she only ever gets one. A
 *      request that arrives with no context is the one most likely to be
 *      dismissed, and dismissing it is permanent.
 *   2. Say something AFTER a denial, and offer the only route that still
 *      works — the OS settings page. A silent return strands her.
 *
 * The rationale is shown only when the permission has not already been
 * granted, so granting it once means never seeing the explanation again.
 */

import * as ImagePicker from 'expo-image-picker';
import { Alert, Linking } from 'react-native';

export type MediaKind = 'camera' | 'library';

export type PermissionOutcome =
  /** Go ahead and open the picker. */
  | { ok: true }
  /** She chose "Not now" at the rationale. Say nothing — this was deliberate. */
  | { ok: false; reason: 'declined' }
  /** The OS refused. Tell her, and offer settings. */
  | { ok: false; reason: 'blocked' };

interface Copy {
  title: string;
  body: string;
  allow: string;
  notNow: string;
}

async function getStatus(kind: MediaKind) {
  return kind === 'camera'
    ? ImagePicker.getCameraPermissionsAsync()
    : ImagePicker.getMediaLibraryPermissionsAsync();
}

async function requestStatus(kind: MediaKind) {
  return kind === 'camera'
    ? ImagePicker.requestCameraPermissionsAsync()
    : ImagePicker.requestMediaLibraryPermissionsAsync();
}

/** The rationale sheet. Resolves true if she wants to continue. */
function confirm(copy: Copy): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(copy.title, copy.body, [
      { text: copy.notNow, style: 'cancel', onPress: () => resolve(false) },
      { text: copy.allow, onPress: () => resolve(true) },
    ]);
  });
}

/**
 * Ensure `kind` is usable, explaining first if it is not already granted.
 *
 * Never throws: every path returns an outcome the caller can render.
 */
export async function ensureMediaPermission(
  kind: MediaKind,
  copy: Copy
): Promise<PermissionOutcome> {
  const current = await getStatus(kind);
  if (current.granted) return { ok: true };

  // `canAskAgain === false` means the OS will not show its dialog no matter
  // what we do. Showing a rationale that leads to a prompt that never appears
  // would be a lie, so skip straight to the settings route.
  if (current.canAskAgain === false) return { ok: false, reason: 'blocked' };

  if (!(await confirm(copy))) return { ok: false, reason: 'declined' };

  const next = await requestStatus(kind);
  return next.granted ? { ok: true } : { ok: false, reason: 'blocked' };
}

/**
 * Open StudyMate's own page in Android settings.
 *
 * The only way back once a permission is permanently denied. Swallows failure
 * because there is nothing useful to say if the OS will not open its own
 * settings — the message that offered this is still on screen either way.
 */
export async function openAppSettings(): Promise<void> {
  await Linking.openSettings().catch(() => undefined);
}
