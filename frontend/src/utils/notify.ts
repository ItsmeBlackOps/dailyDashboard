export function playBeep(): void {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 440;
    osc.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 1);
  } catch {
    // ignore errors
  }
}

export async function sendNotification(title: string, body: string): Promise<void> {
  const NotificationAPI = (globalThis as any).Notification;
  if (!NotificationAPI) return;
  if (NotificationAPI.permission === 'granted') {
    new NotificationAPI(title, { body });
  } else if (NotificationAPI.permission !== 'denied') {
    const perm = await NotificationAPI.requestPermission();
    if (perm === 'granted') {
      new NotificationAPI(title, { body });
    }
  }
}
