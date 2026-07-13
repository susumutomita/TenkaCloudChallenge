const TCU_KEYS = new Set([
  'dependencyOrder',
  'resumeFromCheckpoint',
  'maxRetries',
  'auditCorrelation',
]);
const ECU_KEYS = new Set([
  'signatureMode',
  'versionPolicy',
  'dependencyCheck',
  'rollbackOnHealthFailure',
]);
export const MAX_TCU_RETRIES = 5;

function validateObject(value, label, allowedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`invalid_${label}_policy`);
  }
  const keys = Object.keys(value);
  if (keys.length === 0) throw new Error(`empty_${label}_policy`);
  const unknown = keys.find((key) => !allowedKeys.has(key));
  if (unknown) throw new Error(`unknown_${label}_control:${unknown}`);
}

export function validateTcuPolicyPatch(patch) {
  validateObject(patch, 'tcu', TCU_KEYS);
  for (const key of [
    'dependencyOrder',
    'resumeFromCheckpoint',
    'auditCorrelation',
  ]) {
    if (patch[key] !== undefined && typeof patch[key] !== 'boolean') {
      throw new Error(`invalid_${key}`);
    }
  }
  if (
    patch.maxRetries !== undefined &&
    (!Number.isInteger(patch.maxRetries) ||
      patch.maxRetries < 0 ||
      patch.maxRetries > MAX_TCU_RETRIES)
  ) {
    throw new Error('invalid_max_retries');
  }
}

export function validateEcuPolicyPatch(patch) {
  validateObject(patch, 'ecu', ECU_KEYS);
  if (
    patch.signatureMode !== undefined &&
    !['hash-only', 'ed25519'].includes(patch.signatureMode)
  ) {
    throw new Error('invalid_signature_mode');
  }
  if (
    patch.versionPolicy !== undefined &&
    !['allow-any', 'monotonic'].includes(patch.versionPolicy)
  ) {
    throw new Error('invalid_version_policy');
  }
  for (const key of ['dependencyCheck', 'rollbackOnHealthFailure']) {
    if (patch[key] !== undefined && typeof patch[key] !== 'boolean') {
      throw new Error(`invalid_${key}`);
    }
  }
}

export function validateConfigPatch(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('invalid_config');
  }
  const keys = Object.keys(body);
  if (
    keys.length === 0 ||
    !keys.some((key) => key === 'tcu' || key === 'ecu')
  ) {
    throw new Error('tcu_or_ecu_patch_required');
  }
  const unknown = keys.find((key) => key !== 'tcu' && key !== 'ecu');
  if (unknown) throw new Error(`unknown_config_plane:${unknown}`);
  if (body.tcu !== undefined) validateTcuPolicyPatch(body.tcu);
  if (body.ecu !== undefined) validateEcuPolicyPatch(body.ecu);
}
