import { describe, expect, it } from 'vitest';
import {
  defaultAfterChange,
  effectiveDefault,
  moveItem,
  removeItem,
  updateItem,
} from '@/domain/list-mutations';

interface Item {
  id: string;
  name: string;
  size: number;
}

const a: Item = { id: 'a', name: 'A', size: 1 };
const b: Item = { id: 'b', name: 'B', size: 2 };
const c: Item = { id: 'c', name: 'C', size: 3 };
const ids = (items: readonly Item[] | null) => items?.map((item) => item.id) ?? null;

describe('updateItem', () => {
  it('changes only the named fields of the named item', () => {
    expect(updateItem([a, b, c], 'b', { name: 'Bee' })).toEqual([a, { ...b, name: 'Bee' }, c]);
  });

  it('answers null for an id that is not in the list', () => {
    expect(updateItem([a], 'x', { name: 'X' })).toBeNull();
  });
});

describe('removeItem', () => {
  it('removes the named item and keeps the order of the rest', () => {
    expect(ids(removeItem([a, b, c], 'b'))).toEqual(['a', 'c']);
  });

  it('answers null for an id that is not in the list', () => {
    expect(removeItem([a, b], 'x')).toBeNull();
  });
});

describe('moveItem', () => {
  it('swaps an item with its neighbour', () => {
    expect(ids(moveItem([a, b, c], 'b', 'up'))).toEqual(['b', 'a', 'c']);
    expect(ids(moveItem([a, b, c], 'b', 'down'))).toEqual(['a', 'c', 'b']);
  });

  it('leaves an item at either end where it is', () => {
    expect(ids(moveItem([a, b, c], 'a', 'up'))).toEqual(['a', 'b', 'c']);
    expect(ids(moveItem([a, b, c], 'c', 'down'))).toEqual(['a', 'b', 'c']);
  });

  it('does not change the list it was given', () => {
    const items = [a, b];
    moveItem(items, 'b', 'up');
    expect(ids(items)).toEqual(['a', 'b']);
  });

  it('answers null for an id that is not in the list', () => {
    expect(moveItem([a], 'x', 'down')).toBeNull();
  });
});

describe('effectiveDefault', () => {
  it('is the selected item while it exists', () => {
    expect(effectiveDefault([a, b], 'b')).toBe(b);
  });

  it('falls back to the first item when nothing, or something gone, is selected', () => {
    expect(effectiveDefault([a, b], null)).toBe(a);
    expect(effectiveDefault([a, b], 'gone')).toBe(a);
  });

  it('is nothing for an empty list', () => {
    expect(effectiveDefault([], 'a')).toBeNull();
  });
});

describe('defaultAfterChange', () => {
  it('keeps the default through additions, edits and moves', () => {
    expect(defaultAfterChange([a, b], 'b', [a, b, c])).toEqual({ id: 'b', fellBack: false });
    expect(defaultAfterChange([a, b], 'b', [b, a])).toEqual({ id: 'b', fellBack: false });
  });

  it('pins an implicit default, so reordering does not change it', () => {
    // Nothing selected: the first item is the default, until another moves above it.
    expect(defaultAfterChange([a, b], null, [b, a])).toEqual({ id: 'a', fellBack: false });
  });

  it('makes the first item added the default', () => {
    expect(defaultAfterChange([], null, [a])).toEqual({ id: 'a', fellBack: false });
  });

  it('falls back to the first remaining item when the default is removed, and says so', () => {
    expect(defaultAfterChange([a, b, c], 'b', [a, c])).toEqual({ id: 'a', fellBack: true });
    expect(defaultAfterChange([a, b], null, [b])).toEqual({ id: 'b', fellBack: true });
  });

  it('leaves no default when the last item is removed', () => {
    expect(defaultAfterChange([a], 'a', [])).toEqual({ id: null, fellBack: true });
  });

  it('does not report a fallback when another item is removed', () => {
    expect(defaultAfterChange([a, b, c], 'a', [a, c])).toEqual({ id: 'a', fellBack: false });
  });
});
