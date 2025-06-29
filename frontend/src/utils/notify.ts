// utils/notify.ts

/**
 * URL of your notification sound file (place it in public/sounds/)
 */
const SOUND_URL = "notification.mp3";

let audioInstance: HTMLAudioElement | null = null;

/**
 * Lazily initialize the Audio element for playback.
 */
function initAudio() {
  if (!audioInstance) {
    audioInstance = new Audio(SOUND_URL);
    audioInstance.volume = 0.8;
    audioInstance.preload = "auto";
  }
}

/**
 * Play the notification sound.
 * Falls back quietly if playback isn’t supported or fails.
 */
export function playBeep(): void {
  try {
    initAudio();
    if (!audioInstance) return;
    // rewind to start each time
    audioInstance.currentTime = 0;
    audioInstance.play().catch(() => {
      // ignore any user-gesture / autoplay restrictions
    });
  } catch {
    // completely swallow errors
  }
}

/**
 * Show a system notification (via the Notification API).
 * Will request permission if needed.
 */
export async function sendNotification(
  title: string,
  body: string
): Promise<void> {
  if (!("Notification" in window)) {
    // Browser doesn’t support it
    return;
  }

  if (Notification.permission === "granted") {
    new Notification(title, { body });
  } else if (Notification.permission !== "denied") {
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      new Notification(title, { body });
    }
  }
}

/**
 * Convenience function: play the beep AND show the system notification.
 */
export async function notify(title: string, body: string): Promise<void> {
  playBeep();
  await sendNotification(title, body);
}
