import { describe, expect, it } from 'vitest';
import { isGrouped, optionValue, pickOf } from '@/features/panel/model-menu';

const choice = (id: string, models: string[]) => ({ id, name: id, model: models[0] ?? id, models });

describe('the model menu', () => {
  it('lists configurations by name until one offers several model names', () => {
    expect(isGrouped([choice('a', ['x']), choice('b', ['y'])])).toBe(false);
    expect(isGrouped([choice('a', ['x']), choice('b', ['y', 'z'])])).toBe(true);
  });

  it('reads back the pick each option stands for', () => {
    expect(pickOf(optionValue('a'), false)).toEqual({ id: 'a' });
    expect(pickOf(optionValue('a', 'gpt-4o:latest'), true)).toEqual({
      id: 'a',
      model: 'gpt-4o:latest',
    });
  });

  it('ignores a value it did not write', () => {
    expect(pickOf('', false)).toBeNull();
    expect(pickOf('a', true)).toBeNull();
    expect(pickOf('["a"]', true)).toBeNull();
  });
});
