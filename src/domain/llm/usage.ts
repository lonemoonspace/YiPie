import type { TurnUsage } from '@/contract/snapshot';
import type { Usage } from './stream';

/** Our estimate of a request (`estimateMessages`) and of its answer (`estimateTokens`). */
export interface UsageEstimate {
  input: number;
  output: number;
}

/**
 * What to show for one answer (docs/development-plan.md §1.1 goal 5, §4.4
 * decision 5): the service's figures whenever it reported any, otherwise our
 * estimate. The two are never mixed: a figure the service left out is not
 * filled in with an estimate, so nothing estimated passes for real.
 */
export function turnUsage(reported: Usage | null, estimate: UsageEstimate): TurnUsage {
  if (
    reported !== null &&
    (reported.promptTokens !== null ||
      reported.completionTokens !== null ||
      reported.totalTokens !== null)
  ) {
    return {
      source: 'service',
      input: reported.promptTokens,
      output: reported.completionTokens,
      total: reported.totalTokens,
    };
  }
  return { source: 'estimate', input: estimate.input, output: estimate.output };
}
