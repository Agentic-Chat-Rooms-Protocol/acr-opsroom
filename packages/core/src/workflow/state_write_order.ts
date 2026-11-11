/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Provenance: Lifted from `google/adk-js` (commit `8dad457`, v2.4.0)
 * `core/src/sessions/state_write_order.ts`.
 */

/**
 * Write ordering for session state, so that a state delta committed late cannot
 * roll a key back to an older value.
 *
 * Stamps live in WeakMaps keyed by object identity, so nothing is added to the
 * state or the delta themselves: they never serialize, never reach a session
 * backend, and cost nothing once the objects are collected.
 */

/** Monotonic write counter, shared by every state writer in the process. */
let writeClock = 0;

/** For each state object, the stamp of the newest write to each of its keys. */
const stateStamps = new WeakMap<object, Map<string, number>>();

/** For each delta object, the stamp of the write that produced each entry. */
const deltaStamps = new WeakMap<object, Map<string, number>>();

function stampsFor(
  registry: WeakMap<object, Map<string, number>>,
  target: object
): Map<string, number> {
  let stamps = registry.get(target);
  if (!stamps) {
    stamps = new Map();
    registry.set(target, stamps);
  }
  return stamps;
}

/**
 * Records a direct write of `key` into `state`, and — when the same write is
 * being recorded in `delta` for later commit — stamps it there too, so the
 * commit can tell whether it has since been superseded.
 */
export function recordStateWrite(
  state: object,
  delta: object | undefined,
  key: string
): void {
  const stamp = ++writeClock;
  stampsFor(stateStamps, state).set(key, stamp);
  if (delta && delta !== state) {
    stampsFor(deltaStamps, delta).set(key, stamp);
  }
}

/**
 * Copies the stamp `delta` holds for `key` onto `state`, for a writer that
 * mirrors one logical write into more than one state object.
 */
export function adoptDeltaStamp(
  state: object,
  delta: object,
  key: string
): void {
  const stamp = deltaStamps.get(delta)?.get(key);
  if (stamp !== undefined) {
    stampsFor(stateStamps, state).set(key, stamp);
  }
}

/**
 * Whether committing `key` from `delta` into `state` should go ahead, recording
 * the write when it should.
 *
 * Returns false only when the delta entry is stamped and a newer write to that
 * key has already landed — the rollback this module exists to prevent.
 */
export function shouldApplyDeltaWrite(
  state: object,
  delta: object,
  key: string
): boolean {
  const written = deltaStamps.get(delta)?.get(key);
  const current = stateStamps.get(state)?.get(key);
  if (written !== undefined && current !== undefined && current > written) {
    return false;
  }
  stampsFor(stateStamps, state).set(key, written ?? ++writeClock);
  return true;
}

/**
 * Carries the stamp for one key from one delta object to another.
 */
export function carryDeltaStamp(from: object, to: object, key: string): void {
  const stamp = deltaStamps.get(from)?.get(key);
  if (stamp !== undefined) {
    stampsFor(deltaStamps, to).set(key, stamp);
  }
}

/** {@link carryDeltaStamp} for every key `from` carries a stamp for. */
export function carryDeltaStamps(from: object, to: object): void {
  const stamps = deltaStamps.get(from);
  if (!stamps) {
    return;
  }
  const carried = stampsFor(deltaStamps, to);
  for (const [key, stamp] of stamps) {
    carried.set(key, stamp);
  }
}
