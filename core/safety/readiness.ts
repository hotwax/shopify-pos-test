import type { MutationReadiness } from '../../shared/contracts.ts';
import { loadApprovedTargets } from './policy.ts';

/**
 * Reports the current fail-closed mutation gates. A reviewed policy is only
 * one prerequisite; the native POS identity and transaction selector
 * contracts must be independently verified before any irreversible tap is
 * exposed.
 */
export async function readMutationReadiness(root: string): Promise<MutationReadiness> {
  let policyTargetCount = 0;
  const reasons: string[] = [];
  try {
    policyTargetCount = (await loadApprovedTargets(root)).length;
    if (!policyTargetCount) reasons.push('No reviewed test-store allowlist is configured.');
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : 'The reviewed test-store allowlist could not be read.');
  }
  reasons.push('A live native POS context proof for the current shop and location has not been verified.');
  reasons.push('Native mutation selectors and post-action readback have not been verified for this POS build.');
  return { enabled: false, policyTargetCount, reasons };
}
