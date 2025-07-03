// utils/notify.ts

/**
 * Plays a short sine-wave melody in real time.
 * Uses one oscillator per note and resumes the context immediately.
 */
export function playTune(): void {
  try {
    // create/resume audio context
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioCtx();
    if (ctx.state === "suspended") {
      ctx.resume();
    }

    // a simple melody: C4, C4, G4, G4, A4, A4, G4 (durations in seconds)
    const melody: Array<{ freq: number; dur: number }> = [
      { freq: 261.63, dur: 0.3 }, // C4
      { freq: 261.63, dur: 0.3 }, // C4
      { freq: 392.0, dur: 0.3 },  // G4
      { freq: 392.0, dur: 0.3 },  // G4
      { freq: 440.0, dur: 0.3 },  // A4
      { freq: 440.0, dur: 0.3 },  // A4
      { freq: 392.0, dur: 0.6 },  // G4 (long)
    ];

    let offset = 0;
    for (const { freq, dur } of melody) {
      // create per-note oscillator & gain
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";

      // set gain (volume)
      gain.gain.setValueAtTime(0.2, ctx.currentTime + offset);

      // connect graph
      osc.connect(gain).connect(ctx.destination);

      // schedule note
      osc.frequency.setValueAtTime(freq, ctx.currentTime + offset);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + dur);

      offset += dur;
    }
  } catch {
    // silent fail if unsupported
  }
}

/**
 * Sends a browser notification if allowed,
 * otherwise requests permission first.
 */
export async function sendNotification(
  title: string,
  body: string
): Promise<void> {
  const API = (globalThis as any).Notification as typeof Notification | undefined;
  if (!API) return;

  if (API.permission === "granted") {
    new API(title, { body });
  } else if (API.permission !== "denied") {
    const perm = await API.requestPermission();
    if (perm === "granted") {
      new API(title, { body });
    }
  }
}
