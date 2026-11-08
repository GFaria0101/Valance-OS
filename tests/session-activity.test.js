import test from 'node:test';
import assert from 'node:assert/strict';
import {createSessionActivity, SESSION_IDLE_MS, sessionActivityKey} from '../src/session-activity.js';

class FakeClock {
  time = 1_700_000_000_000;
  nextId = 1;
  timers = new Map();
  now = () => this.time;
  setTimeout = (callback, delay) => {
    const id = this.nextId++;
    this.timers.set(id, {at: this.time + delay, callback});
    return id;
  };
  clearTimeout = id => this.timers.delete(id);
  advance(milliseconds) {
    const end = this.time + milliseconds;
    let callbacks = 0;
    while (true) {
      const next = [...this.timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      assert(++callbacks < 20_000, 'timer loop must make progress');
      this.time = Math.max(this.time, next[1].at);
      this.timers.delete(next[0]);
      next[1].callback();
    }
    this.time = end;
  }
  suspend(milliseconds) { this.time += milliseconds; }
}

class FakeTarget {
  listeners = new Map();
  hidden = false;
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  dispatch(type, properties = {}) {
    for (const callback of [...(this.listeners.get(type) ?? [])]) callback({type, ...properties});
  }
  get listenerCount() { return [...this.listeners.values()].reduce((total, callbacks) => total + callbacks.size, 0); }
}

class StorageHub {
  records = new Map();
  clients = [];
  writes = [];
  deliverEvents = true;
  connect(windowTarget) {
    const storage = {
      getItem: key => this.records.get(key) ?? null,
      setItem: (key, value) => {
        const oldValue = this.records.get(key) ?? null;
        this.records.set(key, value);
        this.writes.push({key, value});
        if (value === oldValue || !this.deliverEvents) return;
        for (const client of this.clients) {
          if (client.storage !== storage) client.windowTarget.dispatch('storage', {key, oldValue, newValue: value, storageArea: client.storage});
        }
      },
    };
    this.clients.push({windowTarget, storage});
    return storage;
  }
  record(userId = 'user-a', sessionId = 'session-a') {
    return JSON.parse(this.records.get(sessionActivityKey(userId, sessionId)) ?? 'null');
  }
}

function harness({clock = new FakeClock(), hub = new StorageHub(), storage: suppliedStorage, onHeartbeat} = {}) {
  const windowTarget = new FakeTarget();
  const documentTarget = new FakeTarget();
  const storage = suppliedStorage ?? hub.connect(windowTarget);
  const heartbeats = [];
  const expirations = [];
  const controller = createSessionActivity({
    now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    storage, windowTarget, documentTarget,
    onHeartbeat(active, identity) {
      heartbeats.push({active, identity, time: clock.time});
      return onHeartbeat?.(active, identity);
    },
    onExpired: identity => expirations.push({...identity, time: clock.time}),
  });
  const start = (options = {}) => controller.start({userId: 'user-a', sessionId: 'session-a', ...options});
  const input = (type = 'pointerdown', properties = {}) => documentTarget.dispatch(type, {isTrusted: true, ...properties});
  return {clock, hub, storage, windowTarget, documentTarget, heartbeats, expirations, controller, start, input};
}

test('idle expiration is inclusive at 3,600,000ms and heartbeats never extend it', () => {
  const h = harness();
  const initial = h.clock.time;
  assert.equal(h.start(), true);
  assert.equal(h.heartbeats[0].active, false);
  h.clock.advance(SESSION_IDLE_MS - 1);
  assert.equal(h.controller.check(), true);
  assert.equal(h.hub.record().lastActivity, initial);
  assert(h.heartbeats.every(heartbeat => heartbeat.active === false));
  h.clock.advance(1);
  assert.equal(h.controller.check(), false);
  assert.deepEqual(h.expirations, [{userId: 'user-a', sessionId: 'session-a', reason: 'idle', time: initial + SESSION_IDLE_MS}]);
  assert(!h.heartbeats.some(heartbeat => heartbeat.time === initial + SESSION_IDLE_MS));
  assert.equal(h.hub.record().expired, true);
  assert.equal(h.start({freshLogin: true}), false);
  h.controller.expire();
  assert.equal(h.expirations.length, 1);
  assert.equal(h.clock.timers.size, 0);
  assert.equal(h.documentTarget.listenerCount + h.windowTarget.listenerCount, 0);
});

test('each supported trusted input extends the deadline; synthetic and unrelated events do not', () => {
  for (const type of ['pointerdown', 'keydown', 'scroll', 'pointermove', 'touchstart']) {
    const h = harness();
    h.start();
    h.clock.advance(SESSION_IDLE_MS - 1);
    const activityAt = h.clock.time;
    h.input(type);
    assert.equal(h.hub.record().lastActivity, activityAt, type);
    h.clock.advance(SESSION_IDLE_MS - 1);
    assert.equal(h.controller.check(), true, type);
    h.clock.advance(1);
    assert.equal(h.controller.check(), false, type);
  }
  const h = harness();
  const initial = h.clock.time;
  h.start();
  h.clock.advance(1000);
  for (const type of ['pointerdown', 'keydown', 'scroll', 'pointermove', 'touchstart']) h.input(type, {isTrusted: false});
  assert.equal(h.controller.noteActivity({type: 'TOKEN_REFRESHED', isTrusted: true}), false);
  assert.equal(h.controller.noteActivity({type: 'click', isTrusted: true}), false);
  assert.equal(h.controller.noteActivity(), false);
  assert.equal(h.hub.record().lastActivity, initial);
  assert.deepEqual(h.heartbeats.map(heartbeat => heartbeat.active), [false]);
});

test('reload, stop/start, token refresh and repeated start preserve the persisted deadline', () => {
  const clock = new FakeClock();
  const hub = new StorageHub();
  const first = harness({clock, hub});
  const initial = clock.time;
  first.start();
  clock.advance(600_000);
  assert.equal(first.start({freshLogin: true, lastActivityAt: clock.time}), true);
  assert.equal(first.heartbeats.length, 21);
  assert.equal(hub.record().lastActivity, initial);
  first.controller.stop();
  clock.advance(600_000);
  const reloaded = harness({clock, hub});
  assert.equal(reloaded.start({lastActivityAt: clock.time}), true);
  assert.equal(hub.record().lastActivity, initial);
  clock.advance(SESSION_IDLE_MS - 1_200_000);
  assert.equal(reloaded.controller.check(), false);
  assert.equal(reloaded.expirations.length, 1);
  assert.equal(first.expirations.length, 0);
});

test('server bootstrap seeds an absent record and refuses an already expired seed before a heartbeat', () => {
  const live = harness();
  const lastActivityAt = live.clock.time - SESSION_IDLE_MS + 1;
  assert.equal(live.start({lastActivityAt}), true);
  assert.equal(live.hub.record().lastActivity, lastActivityAt);
  live.clock.advance(1);
  assert.equal(live.controller.check(), false);
  const expired = harness();
  assert.equal(expired.start({lastActivityAt: expired.clock.time - SESSION_IDLE_MS}), false);
  assert.equal(expired.heartbeats.length, 0);
  assert.equal(expired.expirations.length, 1);
  const future = harness();
  future.start({lastActivityAt: future.clock.time + SESSION_IDLE_MS});
  assert.equal(future.hub.record().lastActivity, future.clock.time);
});

test('new authenticated session IDs start independently while expired IDs remain expired', () => {
  const h = harness();
  h.start();
  h.clock.advance(SESSION_IDLE_MS);
  assert.equal(h.start({sessionId: 'session-new', freshLogin: true}), true);
  assert.equal(h.hub.record('user-a', 'session-new').lastActivity, h.clock.time);
  assert.equal(h.hub.record().expired, true);
  assert.equal(h.heartbeats.at(-1).identity.sessionId, 'session-new');
  h.controller.stop();
  assert.equal(h.start(), false);
  assert.equal(h.expirations.length, 1, 'expiration side effects run once per identity per controller');
});

test('suspended browser checks expiration before its first input, focus or visibility wake', () => {
  for (const wake of ['pointerdown', 'focus', 'visibilitychange', 'pageshow']) {
    const h = harness();
    const initial = h.clock.time;
    h.start();
    h.clock.suspend(SESSION_IDLE_MS);
    if (wake === 'pointerdown') h.input();
    else if (wake === 'visibilitychange') h.documentTarget.dispatch(wake);
    else h.windowTarget.dispatch(wake);
    assert.equal(h.expirations.length, 1, wake);
    assert.equal(h.hub.record().lastActivity, initial, wake);
    assert.equal(h.heartbeats.length, 1, wake);
    assert.equal(h.controller.check(), false, wake);
  }
});

test('same-session activity in another tab prevents expiration and preserves the actual timestamp', () => {
  const clock = new FakeClock();
  const hub = new StorageHub();
  const a = harness({clock, hub});
  const b = harness({clock, hub});
  const initial = clock.time;
  a.start();
  b.start();
  clock.advance(SESSION_IDLE_MS - 1000);
  b.input('keydown');
  const activityAt = clock.time;
  clock.advance(1000);
  assert.equal(a.controller.check(), true);
  assert.equal(a.expirations.length, 0);
  assert.equal(hub.record().lastActivity, activityAt);
  assert(!a.heartbeats.some(heartbeat => heartbeat.active));
  clock.advance(SESSION_IDLE_MS - 1000);
  assert.equal(a.controller.check(), false);
  assert.equal(b.controller.check(), false);
  assert.equal(a.expirations.length, 1);
  assert.equal(b.expirations.length, 1);
  assert.equal(hub.record().lastActivity, initial + SESSION_IDLE_MS - 1000);
});

test('wake reads shared storage even if storage events and timers were suspended', () => {
  const clock = new FakeClock();
  const hub = new StorageHub();
  const a = harness({clock, hub});
  const b = harness({clock, hub});
  a.start();
  b.start();
  hub.deliverEvents = false;
  clock.suspend(SESSION_IDLE_MS - 1);
  b.input('touchstart');
  clock.suspend(2);
  a.windowTarget.dispatch('focus');
  assert.equal(a.controller.check(), true);
  assert.equal(a.expirations.length, 0);
  assert.equal(a.heartbeats.at(-1).active, false);
  assert.equal(hub.record().lastActivity, clock.time - 2);
});

test('session keys isolate devices and users; a shared expiration ends only the same identity', () => {
  const clock = new FakeClock();
  const hub = new StorageHub();
  const original = harness({clock, hub});
  const sibling = harness({clock, hub});
  const device = harness({clock, hub});
  const otherUser = harness({clock, hub});
  original.start();
  sibling.start();
  device.start({sessionId: 'device-b'});
  otherUser.start({userId: 'user-b'});
  clock.advance(SESSION_IDLE_MS - 1000);
  device.input();
  otherUser.input();
  clock.advance(1000);
  assert.equal(original.controller.check(), false);
  assert.equal(sibling.controller.check(), false);
  assert.equal(device.controller.check(), true);
  assert.equal(otherUser.controller.check(), true);
  assert.equal(device.expirations.length + otherUser.expirations.length, 0);
  assert.notEqual(sessionActivityKey('a:b', 'c'), sessionActivityKey('a', 'b:c'));
});

test('frequent inputs throttle heartbeat and storage work, preserving the last real input time', () => {
  const h = harness();
  h.start();
  const initial = h.clock.time;
  for (let index = 0; index < 100; index++) {
    h.clock.advance(10);
    h.input('pointermove');
  }
  assert.deepEqual(h.heartbeats.map(heartbeat => heartbeat.active), [false, true]);
  assert(h.hub.writes.length <= 2);
  h.clock.advance(1000);
  assert.equal(h.hub.record().lastActivity, initial + 1000);
  h.clock.advance(13_010);
  const active = h.heartbeats.filter(heartbeat => heartbeat.active);
  assert.deepEqual(active.map(heartbeat => heartbeat.time), [initial + 10, initial + 15_010]);
  assert.equal(h.hub.record().lastActivity, initial + 1000, 'a pending heartbeat is not a new input');
  h.clock.advance(30_000);
  assert.equal(h.heartbeats.at(-1).active, false);
  assert.equal(h.hub.record().lastActivity, initial + 1000);
});

test('visibility, focus, network checks and rejected heartbeat promises never count as activity', async () => {
  const h = harness({onHeartbeat: () => Promise.reject(new Error('offline'))});
  const initial = h.clock.time;
  h.start();
  for (let index = 0; index < 6; index++) {
    h.clock.advance(SESSION_IDLE_MS / 6 - 1);
    h.windowTarget.dispatch('focus');
    h.documentTarget.hidden = true;
    h.documentTarget.dispatch('visibilitychange');
    h.documentTarget.hidden = false;
    h.documentTarget.dispatch('visibilitychange');
    assert.equal(h.controller.check(), true);
    assert.equal(h.start(), true, 'auth refresh/reconnect can start without renewing');
  }
  assert.equal(h.hub.record().lastActivity, initial);
  h.clock.advance(6);
  assert.equal(h.controller.check(), false);
  assert(h.heartbeats.every(heartbeat => !heartbeat.active));
  await Promise.resolve();
});

test('server expiration is terminal and callback runs only once even with late input or checks', () => {
  const h = harness();
  h.start();
  h.input();
  h.controller.expire('server');
  h.input();
  h.controller.expire('server');
  h.controller.check();
  h.clock.advance(SESSION_IDLE_MS);
  assert.equal(h.expirations.length, 1);
  assert.equal(h.expirations[0].reason, 'server');
  assert.equal(h.heartbeats.length, 2);
  assert.equal(h.hub.record().expired, true);
});

test('stop flushes only the last trusted input and releases all timers and listeners', () => {
  const h = harness();
  h.start();
  h.clock.advance(50);
  h.input();
  const activityAt = h.clock.time;
  h.clock.suspend(100);
  h.controller.stop();
  assert.equal(h.hub.record().lastActivity, activityAt);
  assert.equal(h.clock.timers.size, 0);
  assert.equal(h.windowTarget.listenerCount + h.documentTarget.listenerCount, 0);
  assert.equal(h.controller.check(), false);
  assert.equal(h.expirations.length, 0);
});

test('storage failures leave the one-hour in-memory deadline enforced', () => {
  const storage = {getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }};
  const h = harness({storage});
  assert.equal(h.start(), true);
  h.clock.advance(SESSION_IDLE_MS);
  assert.equal(h.controller.check(), false);
  assert.equal(h.expirations.length, 1);
});

test('queued stale storage events cannot move activity backwards or revive a tombstone', () => {
  const h = harness();
  h.start();
  const initial = h.clock.time;
  h.clock.advance(1000);
  h.input();
  h.windowTarget.dispatch('storage', {
    key: sessionActivityKey('user-a', 'session-a'),
    storageArea: h.storage,
    newValue: JSON.stringify({version: 1, lastActivity: initial, expired: false}),
  });
  assert.equal(h.hub.record().lastActivity, initial + 1000);
  h.windowTarget.dispatch('storage', {
    key: sessionActivityKey('user-a', 'session-a'),
    storageArea: h.storage,
    newValue: JSON.stringify({version: 1, lastActivity: initial, expired: true}),
  });
  assert.equal(h.controller.check(), false);
  assert.equal(h.hub.record().lastActivity, initial + 1000);
  assert.equal(h.expirations.length, 1);
});
