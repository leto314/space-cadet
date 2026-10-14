// Daily content must not unlock by changing the phone's clock, so the date comes from a server.
// Until Space Cadet has its own backend, the time is read from public time endpoints (first one that answers
// wins); swap TIME_SOURCES for the backend's own clock endpoint when it exists.
const TIME_SOURCES = [
  { url: "https://www.cloudflare.com/cdn-cgi/trace", parse: (text) => Number(/ts=([\d.]+)/.exec(text)?.[1]) * 1000 },
  { url: "https://worldtimeapi.org/api/timezone/Etc/UTC", parse: (text) => Number(JSON.parse(text).unixtime) * 1000 },
];
const TIMEOUT_MS = 5000;

let offsetMs = null;

function fetchWithTimeout(url) {
  return Promise.race([
    fetch(url, { cache: "no-store" }).then((response) => response.text()),
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS)),
  ]);
}

// Resolves to true once the offset between the phone's clock and server time is known.
export async function syncTrustedTime() {
  for (const source of TIME_SOURCES) {
    try {
      const sentAt = Date.now();
      const serverMs = source.parse(await fetchWithTimeout(source.url));
      if (!Number.isFinite(serverMs) || serverMs <= 0) continue;
      const roundTrip = Date.now() - sentAt;
      offsetMs = serverMs + roundTrip / 2 - Date.now();
      return true;
    } catch {
      // try the next source
    }
  }
  return false;
}

// Server time in UTC milliseconds, or null if it has never been synced.
export function trustedNow() {
  return offsetMs === null ? null : Date.now() + offsetMs;
}
