import { useEffect, useState } from "react";

import { missionDay } from "./random";
import { syncTrustedTime, trustedNow } from "./trustedTime";

// Today's Paris day from server time (never the phone's clock). Development builds fall back to the device clock
// so the web preview works offline. Returns { day, clockState: "syncing" | "verified" | "unverified" | "offline", retry }.
export function useTrustedDay() {
  const [day, setDay] = useState(null);
  const [clockState, setClockState] = useState("syncing");

  async function resolve() {
    setClockState("syncing");
    if (await syncTrustedTime()) { setDay(missionDay(trustedNow())); setClockState("verified"); return; }
    if (__DEV__) { setDay(missionDay(Date.now())); setClockState("unverified"); return; }
    setClockState("offline");
  }
  useEffect(() => { void resolve(); }, []);

  return { day, clockState, retry: resolve };
}
