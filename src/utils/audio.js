import { setAudioModeAsync } from "expo-audio";

let audioModePromise = null;

export async function ensureAudioReady() {
  if (!audioModePromise) {
    audioModePromise = setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
      shouldRouteThroughEarpiece: false,
      shouldPlayInBackground: false,
    }).catch((error) => {
      audioModePromise = null;
      throw error;
    });
  }

  try {
    await audioModePromise;
  } catch {
    // Leave the app usable even if the audio session setup fails once.
  }
}
