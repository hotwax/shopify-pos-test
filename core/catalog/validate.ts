import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import * as formatsModule from 'ajv-formats';
import schema from '../../shared/script.schema.json' with { type: 'json' };
import type { RunRequest, ScenarioDescriptor, ScriptDefinition } from '../../shared/contracts.ts';

const addFormats = (formatsModule as unknown as { default: (instance: Ajv2020) => Ajv2020 }).default;
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateBase = ajv.compile(schema);

function formatErrors(validate: ValidateFunction): string {
  return (validate.errors ?? []).map(error => `${error.instancePath || '/'} ${error.message ?? 'invalid'}`).join('; ');
}

function descriptorFor(script: ScriptDefinition, registry: ScenarioDescriptor[]): ScenarioDescriptor {
  const descriptor = registry.find(candidate => candidate.id === script.scenario);
  if (!descriptor) throw new Error(`Unknown scenario: ${script.scenario}`);
  if (script.scenarioVersion !== descriptor.version) {
    throw new Error(`Unsupported scenario version for ${script.scenario}`);
  }
  return descriptor;
}

function validateScenarioParameters(parameters: unknown, descriptor: ScenarioDescriptor): void {
  const validateParameters = ajv.compile(descriptor.parameterSchema);
  if (!validateParameters(parameters)) {
    throw new Error(`Invalid parameters for ${descriptor.id}: ${formatErrors(validateParameters)}`);
  }
}

export function validateScript(input: unknown, registry: ScenarioDescriptor[]): ScriptDefinition {
  if (!validateBase(input)) throw new Error(`Invalid script definition: ${formatErrors(validateBase)}`);
  const script = input as unknown as ScriptDefinition;
  const descriptor = descriptorFor(script, registry);
  if (!descriptor.supportedAssertionModes.includes(script.assertionMode)) {
    throw new Error(`Assertion mode is not supported by ${script.scenario}`);
  }
  validateScenarioParameters(script.parameters, descriptor);
  return structuredClone({ ...script, effect: descriptor.effect });
}

/**
 * Validates a run request against the trusted catalog entry that will own the
 * native worker. The browser may choose values, but it cannot change the
 * scenario implementation or its parameter contract.
 */
export function validateRunRequestAgainstCatalog(request: RunRequest, scripts: ScriptDefinition[], registry: ScenarioDescriptor[]): void {
  const script = scripts.find(candidate => candidate.id === request.scriptId);
  if (!script) throw new Error(`The selected catalog script is unavailable: ${request.scriptId}`);
  const descriptor = descriptorFor(script, registry);
  if (!descriptor.supportedAssertionModes.includes(request.assertionMode)) {
    throw new Error(`Assertion mode is not supported by ${script.id}.`);
  }
  validateScenarioParameters(request.parameters, descriptor);
}
