import * as Haptics from "expo-haptics";

let hapticsEnabled = true;

export function setHapticsEnabled(enabled) {
  hapticsEnabled = Boolean(enabled);
}

export function areHapticsEnabled() {
  return hapticsEnabled;
}

export async function triggerSelectionHaptic() {
  if (!hapticsEnabled) return;

  try {
    await Haptics.selectionAsync();
  } catch {
    // Ignore haptics errors so gameplay still works everywhere.
  }
}

export async function triggerSuccessHaptic() {
  if (!hapticsEnabled) return;

  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {
    // Ignore haptics errors so gameplay still works everywhere.
  }
}

export async function triggerErrorHaptic() {
  if (!hapticsEnabled) return;

  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  } catch {
    // Ignore haptics errors so gameplay still works everywhere.
  }
}

// A firmer tap than the selection tick, for alerts that must be felt (e.g. "something is about to move").
export async function triggerImpactHaptic() {
  if (!hapticsEnabled) return;

  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  } catch {
    // Ignore haptics errors so gameplay still works everywhere.
  }
}
