import { buildOmsOrigin, instanceNameFromOrigin, normalizeOmsInstanceName } from '../../shared/oms-origin.ts';
import { type OmsConnectionConfig } from './types.ts';

export function configuredOmsConnections(env: NodeJS.ProcessEnv = process.env): { connections: OmsConnectionConfig[]; errors: string[] } {
  const rawInstanceName = env.OMS_INSTANCE_NAME?.trim();
  const legacyOrigin = env.OMS_ORIGIN?.trim();
  if (!rawInstanceName && !legacyOrigin) return { connections: [], errors: [] };
  try {
    const instanceName = rawInstanceName || instanceNameFromOrigin(legacyOrigin ?? '');
    if (!instanceName) throw new Error('Set OMS_INSTANCE_NAME to a HotWax instance name such as test-maarg.');
    const normalizedInstanceName = normalizeOmsInstanceName(instanceName);
    return {
      connections: [{
        id: env.OMS_CONNECTION_ID?.trim() || 'local-oms',
        label: env.OMS_CONNECTION_LABEL?.trim() || normalizedInstanceName,
        origin: buildOmsOrigin(normalizedInstanceName),
      }],
      errors: [],
    };
  } catch (error) {
    return { connections: [], errors: [error instanceof Error ? error.message : 'OMS configuration is invalid.'] };
  }
}
