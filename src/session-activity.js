export const SESSION_IDLE_MS = 60 * 60 * 1000;
export const SESSION_HEARTBEAT_MS = 30 * 1000;
const ACTIVE_HEARTBEAT_MS = 15 * 1000;
const ACTIVITY_WRITE_MS = 1000;
const INPUT_EVENTS = ['pointerdown', 'keydown', 'scroll', 'pointermove', 'touchstart'];

export function sessionActivityKey(userId, sessionId) {
  return `valance:session-activity:v1:${encodeURIComponent(userId)}:${encodeURIComponent(sessionId)}`;
}

function browserStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}

function parseRecord(value) {
  try {
    const record = JSON.parse(value);
    if (record?.version !== 1 || !Number.isFinite(record.lastActivity) || record.lastActivity < 0) return null;
    return {lastActivity: record.lastActivity, expired: record.expired === true};
  } catch { return null; }
}

/**
 * The caller supplies the authenticated user ID and Supabase auth session_id.
 * A fresh login has a new session ID; freshLogin never revives an expired ID.
 * Bootstrap with touch_app_session(false) before exposing the app, then pass
 * its last_activity_at as lastActivityAt (epoch milliseconds). This seeds a
 * missing local record without giving a restored session another hour.
 *
 * Only trusted input updates lastActivity. check(), start(), focus, visibility,
 * timers and heartbeat responses never do. Call check() before protected RPCs,
 * and expire('server') on APP_SESSION_EXPIRED. stop() releases listeners/timers
 * without erasing the deadline. Callbacks receive identity metadata so an old
 * asynchronous response can be ignored after switching sessions.
 */
export function createSessionActivity({
  onExpired = () => {},
  onHeartbeat = () => {},
  now = () => Date.now(),
  storage = browserStorage(),
  windowTarget = globalThis.window,
  documentTarget = globalThis.document,
  setTimeout: setTimer = (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: clearTimer = timer => globalThis.clearTimeout(timer),
  idleMs = SESSION_IDLE_MS,
  heartbeatMs = SESSION_HEARTBEAT_MS,
  activeHeartbeatMs = ACTIVE_HEARTBEAT_MS,
  activityWriteMs = ACTIVITY_WRITE_MS,
} = {}) {
  let session = null;
  let timer = null;
  let listening = false;
  const notified = new Set();
  const listenerOptions = {capture: true, passive: true};

  function readRecord(key) {
    try { return parseRecord(storage?.getItem(key)); } catch { return null; }
  }

  function writeRecord(current) {
    try {
      storage?.setItem(current.key, JSON.stringify({
        version: 1, lastActivity: current.lastActivity, expired: current.expired,
      }));
    } catch { /* A denied storage API must not disable the in-memory deadline. */ }
    current.lastWriteAt = now();
    current.pendingWrite = false;
  }

  function mergeRecord(current, record) {
    if (!record) return;
    current.lastActivity = Math.max(current.lastActivity, record.lastActivity);
    if (record.expired) current.expired = true;
  }

  function clearScheduled() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  function unlisten() {
    if (!listening) return;
    for (const type of INPUT_EVENTS) documentTarget?.removeEventListener(type, noteActivity, listenerOptions);
    documentTarget?.removeEventListener('visibilitychange', onVisibility);
    windowTarget?.removeEventListener('focus', onWake);
    windowTarget?.removeEventListener('pageshow', onWake);
    windowTarget?.removeEventListener('pagehide', onPageHide);
    windowTarget?.removeEventListener('storage', onStorage);
    listening = false;
  }

  function listen() {
    if (listening) return;
    for (const type of INPUT_EVENTS) documentTarget?.addEventListener(type, noteActivity, listenerOptions);
    documentTarget?.addEventListener('visibilitychange', onVisibility);
    windowTarget?.addEventListener('focus', onWake);
    windowTarget?.addEventListener('pageshow', onWake);
    windowTarget?.addEventListener('pagehide', onPageHide);
    windowTarget?.addEventListener('storage', onStorage);
    listening = true;
  }

  function finishExpiration(reason) {
    const current = session;
    if (!current) return false;
    if (current.finished) return false;
    current.finished = true;
    mergeRecord(current, readRecord(current.key));
    current.expired = true;
    current.pendingActive = false;
    writeRecord(current);
    clearScheduled();
    unlisten();
    if (!notified.has(current.key)) {
      notified.add(current.key);
      onExpired({userId: current.userId, sessionId: current.sessionId, reason});
    }
    return false;
  }

  function check() {
    const current = session;
    if (!current) return false;
    mergeRecord(current, readRecord(current.key));
    if (current.expired || now() >= current.lastActivity + idleMs) return finishExpiration('idle');
    return true;
  }

  function schedule() {
    clearScheduled();
    const current = session;
    if (!current || current.expired) return;
    const deadlines = [current.lastActivity + idleMs, current.lastHeartbeatAt + heartbeatMs];
    if (current.pendingActive) deadlines.push(current.lastActiveHeartbeatAt + activeHeartbeatMs);
    if (current.pendingWrite) deadlines.push(current.lastWriteAt + activityWriteMs);
    timer = setTimer(tick, Math.max(0, Math.min(...deadlines) - now()));
  }

  function emitHeartbeat(active) {
    if (!check()) return false;
    const current = session;
    current.lastHeartbeatAt = now();
    if (active) {
      current.pendingActive = false;
      current.lastActiveHeartbeatAt = current.lastHeartbeatAt;
    }
    // Transport failures cannot count as activity or restart a deadline.
    // The callback owns error reporting and server-expiration handling.
    try {
      const result = onHeartbeat(active, {userId: current.userId, sessionId: current.sessionId});
      if (result?.catch) result.catch(() => {});
    } catch { /* Keep the idle timer running if the transport throws. */ }
    return true;
  }

  function tick() {
    timer = null;
    if (!check()) return;
    const current = session;
    const time = now();
    if (current.pendingWrite && time >= current.lastWriteAt + activityWriteMs) writeRecord(current);
    if (current.pendingActive && time >= current.lastActiveHeartbeatAt + activeHeartbeatMs) emitHeartbeat(true);
    else if (time >= current.lastHeartbeatAt + heartbeatMs) emitHeartbeat(current.pendingActive);
    schedule();
  }

  function noteActivity(event) {
    // A first input after a suspended browser must not revive an idle session.
    if (!check()) return false;
    if (event?.isTrusted !== true || !INPUT_EVENTS.includes(event.type)) return false;
    const current = session;
    current.lastActivity = Math.max(current.lastActivity, now());
    current.pendingActive = true;
    current.pendingWrite = true;
    if (now() >= current.lastWriteAt + activityWriteMs) writeRecord(current);
    if (now() >= current.lastActiveHeartbeatAt + activeHeartbeatMs) emitHeartbeat(true);
    schedule();
    return true;
  }

  function onWake() {
    if (!check()) return;
    // Resuming is a liveness check, never a user interaction.
    if (now() >= session.lastHeartbeatAt + heartbeatMs) emitHeartbeat(session.pendingActive);
    schedule();
  }

  function flush() {
    if (!check()) return;
    if (session.pendingWrite) writeRecord(session);
  }

  function onVisibility() {
    if (documentTarget?.hidden) flush();
    else onWake();
  }

  function onPageHide() { flush(); }

  function onStorage(event) {
    if (!session || (event.key !== session.key && event.key !== null)) return;
    if (event.storageArea && storage && event.storageArea !== storage) return;
    // A queued event can be older than the current localStorage value. Preserve
    // both timestamps and honor an expiration tombstone from either source.
    mergeRecord(session, parseRecord(event.newValue));
    if (!check()) return;
    schedule();
  }

  function stop() {
    // Persist the timestamp of the last real input, never the stop time.
    if (session && !session.expired && session.pendingWrite) {
      mergeRecord(session, readRecord(session.key));
      writeRecord(session);
    }
    clearScheduled();
    unlisten();
    session = null;
  }

  function start({userId, sessionId, freshLogin = false, lastActivityAt} = {}) {
    if (typeof userId !== 'string' || !userId || typeof sessionId !== 'string' || !sessionId) {
      throw new TypeError('userId and sessionId are required');
    }
    const key = sessionActivityKey(userId, sessionId);
    if (session?.key === key) {
      if (!check()) return false;
      schedule();
      return true;
    }
    stop();
    const time = now();
    const record = readRecord(key);
    const serverSeed = Number.isFinite(lastActivityAt) && lastActivityAt >= 0 ? Math.min(time, lastActivityAt) : time;
    session = {
      userId, sessionId, key,
      // freshLogin documents the caller's auth transition; identity, rather
      // than this flag, decides whether the persisted deadline can be reused.
      freshLogin: Boolean(freshLogin),
      lastActivity: record?.lastActivity ?? serverSeed,
      expired: record?.expired ?? false,
      finished: false,
      lastWriteAt: time,
      pendingWrite: false,
      pendingActive: false,
      lastHeartbeatAt: time,
      lastActiveHeartbeatAt: -Infinity,
    };
    if (!check()) return false;
    if (!record) writeRecord(session);
    listen();
    emitHeartbeat(false);
    schedule();
    return true;
  }

  function expire(reason = 'server') { return finishExpiration(reason); }

  return {start, stop, check, noteActivity, expire};
}
