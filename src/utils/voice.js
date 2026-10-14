import * as Speech from "expo-speech";
import { createAudioPlayer } from "expo-audio";

import { ensureAudioReady } from "./audio";

// Shared text-to-speech service. It fixes the two ways the first word of an instruction got clipped on iOS:
// 1. `Speech.stop()` immediately followed by `Speech.speak()` swallows the start of the new utterance, so a
//    speak always waits STOP_GAP_MS after a stop (and nothing is stopped when nothing is playing).
// 2. After a silence the audio route (especially Bluetooth) goes to sleep and takes a moment to wake up, eating
//    the first syllable. While a voice session is open, a silent clip loops to keep the route awake.
// Utterances are queued, so two callers never talk over each other.
const STOP_GAP_MS = 140;
const DEFAULTS = { language: "en-US", pitch: 1, rate: 0.92 };

const queue = [];
let current = null;
let token = 0;
let lastStopAt = 0;
let pendingTimer = null;
let keepAlive = null;

export async function startVoiceSession() {
  await ensureAudioReady();
  if (keepAlive) return;
  try {
    keepAlive = createAudioPlayer(require("../assets/sounds/silence.wav"));
    keepAlive.loop = true;
    keepAlive.play();
  } catch {
    keepAlive = null;
  }
}

export function endVoiceSession() {
  stopSpeaking();
  if (!keepAlive) return;
  try { keepAlive.pause(); keepAlive.remove(); } catch { /* already released */ }
  keepAlive = null;
}

export function stopSpeaking() {
  queue.length = 0;
  clearTimeout(pendingTimer);
  pendingTimer = null;
  if (current) {
    token += 1;
    current = null;
    Speech.stop();
    lastStopAt = Date.now();
  }
}

// Queued: plays after anything already speaking or waiting.
export function speak(text, options = {}) {
  queue.push({ text, options });
  pump();
}

// Interrupting: drops whatever is queued or playing, then speaks.
export function say(text, options = {}) {
  stopSpeaking();
  speak(text, options);
}

export function isSpeaking() {
  return Boolean(current) || queue.length > 0;
}

function pump() {
  if (current || !queue.length) return;
  const wait = lastStopAt + STOP_GAP_MS - Date.now();
  if (wait > 0) {
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => { pendingTimer = null; pump(); }, wait);
    return;
  }
  const { text, options } = queue.shift();
  const utterance = ++token;
  current = utterance;
  // Callbacks from an utterance that was stopped meanwhile must not touch the queue of the next one.
  const finish = (callback) => (...args) => {
    if (current === utterance) current = null;
    callback?.(...args);
    if (token === utterance) pump();
  };
  void ensureAudioReady().then(() => {
    if (current !== utterance) return;
    Speech.speak(text, { ...DEFAULTS, ...options, onDone: finish(options.onDone), onStopped: finish(options.onStopped), onError: finish(options.onError) });
  });
}
