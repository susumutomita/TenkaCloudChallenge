import { createHash, sign, verify } from 'node:crypto';

export const BROKEN_ECU_POLICY = Object.freeze({
  signatureMode: 'hash-only',
  versionPolicy: 'allow-any',
  dependencyCheck: false,
  rollbackOnHealthFailure: false,
});

export const HARDENED_ECU_POLICY = Object.freeze({
  signatureMode: 'ed25519',
  versionPolicy: 'monotonic',
  dependencyCheck: true,
  rollbackOnHealthFailure: true,
});

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortValue(value[key])])
  );
}

export function canonicalManifest(manifest) {
  return JSON.stringify(sortValue(manifest));
}

export function hashPayload(payload) {
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

export function createSignedPackage(privateKey, manifest, payload) {
  const finalizedManifest = { ...manifest, payloadHash: hashPayload(payload) };
  const signature = sign(
    null,
    Buffer.from(canonicalManifest(finalizedManifest)),
    privateKey
  );
  return {
    algorithm: 'Ed25519',
    manifest: finalizedManifest,
    payload,
    signature: signature.toString('base64'),
  };
}

function authentic(packageData, publicKey) {
  try {
    return verify(
      null,
      Buffer.from(canonicalManifest(packageData.manifest)),
      publicKey,
      Buffer.from(packageData.signature, 'base64')
    );
  } catch {
    return false;
  }
}

function validManifestShape(manifest) {
  const allowedKeys = new Set([
    'campaignId',
    'ecuId',
    'version',
    'dependsOn',
    'payloadHash',
  ]);
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    typeof manifest.campaignId !== 'string' ||
    manifest.campaignId.length === 0 ||
    typeof manifest.ecuId !== 'string' ||
    manifest.ecuId.length === 0 ||
    typeof manifest.payloadHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(manifest.payloadHash) ||
    !Array.isArray(manifest.dependsOn) ||
    manifest.dependsOn.length > 8 ||
    Object.keys(manifest).some((key) => !allowedKeys.has(key))
  ) {
    return false;
  }
  const dependencyIds = new Set();
  for (const dependency of manifest.dependsOn) {
    if (
      !dependency ||
      typeof dependency !== 'object' ||
      typeof dependency.ecuId !== 'string' ||
      dependency.ecuId.length === 0 ||
      dependency.ecuId === manifest.ecuId ||
      !Number.isInteger(dependency.minVersion) ||
      dependency.minVersion < 0 ||
      dependencyIds.has(dependency.ecuId)
    ) {
      return false;
    }
    dependencyIds.add(dependency.ecuId);
  }
  return true;
}

export function packageVerdict(packageData, publicKey, context) {
  if (!packageData || typeof packageData !== 'object') {
    return { accepted: false, reason: 'invalid_package' };
  }
  if (!packageData.manifest || typeof packageData.payload !== 'string') {
    return { accepted: false, reason: 'invalid_package' };
  }
  if (!validManifestShape(packageData.manifest)) {
    return { accepted: false, reason: 'invalid_manifest' };
  }
  if (hashPayload(packageData.payload) !== packageData.manifest.payloadHash) {
    return { accepted: false, reason: 'payload_hash_mismatch' };
  }

  const { policy } = context;
  if (policy.signatureMode === 'ed25519') {
    if (!packageData.signature)
      return { accepted: false, reason: 'missing_signature' };
    if (
      packageData.algorithm !== 'Ed25519' ||
      !authentic(packageData, publicKey)
    ) {
      return { accepted: false, reason: 'invalid_signature' };
    }
  }

  if (
    typeof context.ecuId === 'string' &&
    packageData.manifest.ecuId !== context.ecuId
  ) {
    return { accepted: false, reason: 'wrong_target' };
  }

  const version = packageData.manifest.version;
  if (!Number.isInteger(version) || version < 0) {
    return { accepted: false, reason: 'invalid_version' };
  }
  if (
    policy.versionPolicy === 'monotonic' &&
    version <= context.currentVersion
  ) {
    return { accepted: false, reason: 'non_monotonic_version' };
  }

  if (policy.dependencyCheck) {
    for (const dependency of packageData.manifest.dependsOn ?? []) {
      if ((context.inventory[dependency.ecuId] ?? -1) < dependency.minVersion) {
        return { accepted: false, reason: 'dependency_not_satisfied' };
      }
    }
  }
  return { accepted: true, reason: 'accepted' };
}
