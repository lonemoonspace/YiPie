import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MoveInput, RemoveInput, SetDefaultInput, updateInput } from '@/contract/mutations';

describe('list change inputs', () => {
  it('name one item by id', () => {
    expect(RemoveInput.parse({ id: 'a' })).toEqual({ id: 'a' });
    expect(SetDefaultInput.safeParse({ id: '' }).success).toBe(false);
  });

  it('move one step up or down, nothing else', () => {
    expect(MoveInput.parse({ id: 'a', direction: 'up' })).toEqual({ id: 'a', direction: 'up' });
    expect(MoveInput.safeParse({ id: 'a', direction: 'top' }).success).toBe(false);
    expect(MoveInput.safeParse({ id: 'a', to: 0 }).success).toBe(false);
  });

  it('carry an update as an id plus the patch, and nothing more', () => {
    const UpdateName = updateInput(z.strictObject({ name: z.string().optional() }));
    expect(UpdateName.parse({ id: 'a', patch: { name: 'x' } })).toEqual({
      id: 'a',
      patch: { name: 'x' },
    });
    expect(UpdateName.safeParse({ id: 'a', patch: {}, items: [] }).success).toBe(false);
  });
});
