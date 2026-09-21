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

/**
 * A catalog entry stores defaults, a run request states an actual job, so the
 * two are held to different standards against the same schema.
 *
 * A stored "Return a cash order" entry cannot name the order it will return;
 * that is chosen per run. Requiring it of the template would force a
 * placeholder order GID into the catalog, which reads like a real target and
 * is worse than the gap it closes.
 *
 * So an entry that declares NO parameters is read as "the operator supplies
 * these per run" and is checked for shape alone, while an entry that declares
 * any parameter is a fixture and is held to the full contract. Either way the
 * run request itself is always checked in full, so nothing reaches a device
 * without the parameters its scenario cannot run without.
 */
const templateSchemas = new WeakMap<object, object>();

function templateSchemaFor(descriptor: ScenarioDescriptor): object {
  const schemaObject = descriptor.parameterSchema as object;
  const cached = templateSchemas.get(schemaObject);
  if (cached) return cached;
  const { required: _required, ...rest } = schemaObject as Record<string, unknown>;
  templateSchemas.set(schemaObject, rest);
  return rest;
}

function isEmptyTemplate(parameters: unknown): boolean {
  return !!parameters && typeof parameters === 'object' && !Array.isArray(parameters) && !Object.keys(parameters as object).length;
}

function validateScenarioParameters(parameters: unknown, descriptor: ScenarioDescriptor, mode: 'template' | 'run'): void {
  const lenient = mode === 'template' && isEmptyTemplate(parameters);
  const validateParameters = ajv.compile(lenient ? templateSchemaFor(descriptor) : descriptor.parameterSchema);
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
  validateScenarioParameters(script.parameters, descriptor, 'template');
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
  validateScenarioParameters(request.parameters, descriptor, 'run');
}
