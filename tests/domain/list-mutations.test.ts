import { describe, expect, it } from 'vitest';
import {
  moveItem,
  removeItem,
  resolveDefault,
  settleDefault,
  updateItem,
} from '@/domain/list-mutations';

const a = { id: 'a', name: 'A' };
const b = { id: 'b', name: 'B' };
const c = { id: 'c', name: 'C' };

describe('resolveDefault', () => {
  it('is the stored default while it is in the list', () => {
    expect(resolveDefault([a, b, c], 'b')).toBe(b);
  });

  it('falls back to the first item for a missing or stale id, and to none for an empty list', () => {
    expect(resolveDefault([a, b], null)).toBe(a);
    expect(resolveDefault([a, b], 'gone')).toBe(a);
    expect(resolveDefault([], 'a')).toBeNull();
  });
});

describe('settleDefault', () => {
  it('keeps the default through changes that leave it in the list', () => {
    expect(settleDefault([a, b, c], [c, b, a], 'b')).toEqual({ defaultId: 'b', fallback: null });
  });

  it('makes the first item of a new list the default, without a notice', () => {
    expect(settleDefault([], [a], null)).toEqual({ defaultId: 'a', fallback: null });
  });

  it('falls back to the first item when the default is removed, and says so', () => {
    expect(settleDefault([a, b, c], [a, c], 'b')).toEqual({
      defaultId: 'a',
      fallback: { from: b, to: a },
    });
  });

  it('has no default after the last item is removed, and says so', () => {
    expect(settleDefault([a], [], 'a')).toEqual({
      defaultId: null,
      fallback: { from: a, to: null },
    });
  });

  it('keeps the item in effect, not the stale stored id, when the list is reordered', () => {
    // "gone" is stale, so a was in effect: a keeps the role after b moves up.
    expect(settleDefault([a, b], [b, a], 'gone')).toEqual({ defaultId: 'a', fallback: null });
  });

  it('treats removing the item in effect for a stale id as removing the default', () => {
    expect(settleDefault([a, b], [b], 'gone')).toEqual({
      defaultId: 'b',
      fallback: { from: a, to: b },
    });
  });
});

describe('list changes', () => {
  it('update changes only the named item, and reports a missing one', () => {
    expect(updateItem([a, b], 'b', (item) => ({ ...item, name: 'B2' }))).toEqual([
      a,
      { id: 'b', name: 'B2' },
    ]);
    expect(updateItem([a, b], 'x', (item) => item)).toBeNull();
  });

  it('remove drops only the named item, and reports a missing one', () => {
    expect(removeItem([a, b, c], 'b')).toEqual([a, c]);
    expect(removeItem([a], 'x')).toBeNull();
  });

  it('move puts the item at the position, clamping out-of-range positions', () => {
    expect(moveItem([a, b, c], 'c', 0)).toEqual([c, a, b]);
    expect(moveItem([a, b, c], 'a', 1)).toEqual([b, a, c]);
    expect(moveItem([a, b, c], 'a', 99)).toEqual([b, c, a]);
    expect(moveItem([a, b, c], 'b', 1)).toEqual([a, b, c]);
    expect(moveItem([a, b], 'x', 0)).toBeNull();
  });
});
