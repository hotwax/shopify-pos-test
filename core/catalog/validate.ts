import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import * as formatsModule from 'ajv-formats';
import schema from '../../shared/script.schema.json' with { type: 'json' };
import type { ScenarioDescriptor, ScriptDefinition } from '../../shared/contracts.ts';

const addFormats = (formatsModule as unknown as { default: (instance: Ajv2020) => Ajv2020 }).default;
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateBase = ajv.compile(schema);

function formatErrors(validate: ValidateFunction): string {
  return (validate.errors ?? []).map(error => `${error.instancePath || '/'} ${error.message ?? 'invalid'}`).join('; ');
}

export function validateScript(input: unknown, registry: ScenarioDescriptor[]): ScriptDefinition {
  if (!validateBase(input)) throw new Error(`Invalid script definition: ${formatErrors(validateBase)}`);
  const script = input as unknown as ScriptDefinition;
  const descriptor = registry.find(candidate => candidate.id === script.scenario);
  if (!descriptor) throw new Error(`Unknown scenario: ${script.scenario}`);
  if (script.scenarioVersion !== descriptor.version) {
    throw new Error(`Unsupported scenario version for ${script.scenario}`);
  }
  if (!descriptor.supportedAssertionModes.includes(script.assertionMode)) {
    throw new Error(`Assertion mode is not supported by ${script.scenario}`);
  }
  const validateParameters = ajv.compile(descriptor.parameterSchema);
  if (!validateParameters(script.parameters)) {
    throw new Error(`Invalid parameters for ${script.scenario}: ${formatErrors(validateParameters)}`);
  }
  return structuredClone(script);
}
