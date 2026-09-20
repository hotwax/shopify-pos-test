import { canonicalOrigin, type OmsConnectionConfig } from './types.ts';

export function configuredOmsConnections(env: NodeJS.ProcessEnv = process.env): { connections: OmsConnectionConfig[]; errors: string[] } {
  const rawOrigin = env.OMS_ORIGIN?.trim();
  if (!rawOrigin) return { connections: [], errors: ['Set OMS_ORIGIN in the local .env before connecting an OMS.'] };
  try {
    return {
      connections: [{
        id: env.OMS_CONNECTION_ID?.trim() || 'local-oms',
        label: env.OMS_CONNECTION_LABEL?.trim() || 'Configured OMS',
        origin: canonicalOrigin(rawOrigin),
      }],
      errors: [],
    };
  } catch (error) {
    return { connections: [], errors: [error instanceof Error ? error.message : 'OMS configuration is invalid.'] };
  }
}
