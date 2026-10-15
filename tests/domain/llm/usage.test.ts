import { describe, expect, it } from 'vitest';
import { turnUsage } from '@/domain/llm/usage';

const estimate = { input: 1_200, output: 300 };

describe('turnUsage', () => {
  it('shows what the service reported', () => {
    expect(
      turnUsage({ promptTokens: 321, completionTokens: 45, totalTokens: 366 }, estimate),
    ).toEqual({ source: 'service', input: 321, output: 45, total: 366 });
  });

  it('falls back to the estimate when the service reported nothing', () => {
    expect(turnUsage(null, estimate)).toEqual({ source: 'estimate', input: 1_200, output: 300 });
    expect(
      turnUsage({ promptTokens: null, completionTokens: null, totalTokens: null }, estimate),
    ).toEqual({ source: 'estimate', input: 1_200, output: 300 });
  });

  it('never fills a figure the service left out with an estimate', () => {
    expect(
      turnUsage({ promptTokens: null, completionTokens: 45, totalTokens: null }, estimate),
    ).toEqual({ source: 'service', input: null, output: 45, total: null });
  });
});
