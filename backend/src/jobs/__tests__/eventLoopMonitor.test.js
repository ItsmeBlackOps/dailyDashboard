import {
  startEventLoopMonitor,
  stopEventLoopMonitor,
  getEventLoopSnapshot,
  _sampleNow,
} from '../eventLoopMonitor.js';

describe('eventLoopMonitor', () => {
  afterEach(() => stopEventLoopMonitor());

  it('captures a snapshot with the expected shape and uses the activeRequests fn', () => {
    let calls = 0;
    startEventLoopMonitor({ activeRequestsFn: () => { calls += 1; return 7; } });

    const snap = _sampleNow();

    expect(snap).toBeTruthy();
    expect(snap.type).toBe('eventLoop');
    expect(snap.createdAt).toBeInstanceOf(Date);
    expect(typeof snap.loopLagMeanMs).toBe('number');
    expect(typeof snap.loopLagP99Ms).toBe('number');
    expect(typeof snap.loopLagMaxMs).toBe('number');
    expect(typeof snap.eluUtilization).toBe('number');
    expect(typeof snap.heapUsedMb).toBe('number');
    expect(snap.activeRequests).toBe(7);
    expect(calls).toBeGreaterThan(0);

    const { latest, recent } = getEventLoopSnapshot();
    expect(latest).toEqual(snap);
    expect(recent.length).toBeGreaterThan(0);
  });

  it('is idempotent on start and safe on repeated stop', () => {
    startEventLoopMonitor();
    startEventLoopMonitor(); // second call is a no-op, must not throw
    stopEventLoopMonitor();
    stopEventLoopMonitor(); // already stopped, must not throw
    // _sampleNow is a no-op once stopped (no histogram)
    expect(_sampleNow()).toBeDefined();
  });
});
