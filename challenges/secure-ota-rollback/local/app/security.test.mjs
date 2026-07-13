import { describe, expect, it } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import {
  BROKEN_ECU_POLICY,
  HARDENED_ECU_POLICY,
  createSignedPackage,
  hashPayload,
  packageVerdict,
} from './security.mjs';

const manifest = (version = 2) => ({
  campaignId: 'campaign-1',
  ecuId: 'ecu-a',
  version,
  dependsOn: [],
});

describe('secure OTA package verification', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');

  it('should accept an authentic monotonic package under the hardened policy', () => {
    const update = createSignedPackage(privateKey, manifest(), 'firmware-v2');

    expect(
      packageVerdict(update, publicKey, {
        ecuId: 'ecu-a',
        currentVersion: 1,
        inventory: { 'ecu-a': 1, 'ecu-b': 1 },
        policy: HARDENED_ECU_POLICY,
      })
    ).toEqual({ accepted: true, reason: 'accepted' });
  });

  it('should reject tampered metadata even when its payload hash was recomputed', () => {
    const update = createSignedPackage(privateKey, manifest(), 'firmware-v2');
    const tamperedPayload = 'attacker-firmware';
    const tampered = {
      ...update,
      payload: tamperedPayload,
      manifest: {
        ...update.manifest,
        payloadHash: hashPayload(tamperedPayload),
      },
    };

    expect(
      packageVerdict(tampered, publicKey, {
        ecuId: 'ecu-a',
        currentVersion: 1,
        inventory: { 'ecu-a': 1, 'ecu-b': 1 },
        policy: HARDENED_ECU_POLICY,
      })
    ).toEqual({ accepted: false, reason: 'invalid_signature' });
    expect(
      packageVerdict(tampered, publicKey, {
        ecuId: 'ecu-a',
        currentVersion: 1,
        inventory: { 'ecu-a': 1, 'ecu-b': 1 },
        policy: BROKEN_ECU_POLICY,
      })
    ).toEqual({ accepted: true, reason: 'accepted' });
  });

  it('should reject unsigned and downgrade packages under the hardened policy', () => {
    const unsigned = createSignedPackage(privateKey, manifest(), 'firmware-v2');
    const downgrade = createSignedPackage(
      privateKey,
      manifest(0),
      'firmware-v0'
    );

    expect(
      packageVerdict({ ...unsigned, signature: '' }, publicKey, {
        ecuId: 'ecu-a',
        currentVersion: 1,
        inventory: { 'ecu-a': 1, 'ecu-b': 1 },
        policy: HARDENED_ECU_POLICY,
      }).reason
    ).toBe('missing_signature');
    expect(
      packageVerdict(downgrade, publicKey, {
        ecuId: 'ecu-a',
        currentVersion: 1,
        inventory: { 'ecu-a': 1, 'ecu-b': 1 },
        policy: HARDENED_ECU_POLICY,
      }).reason
    ).toBe('non_monotonic_version');
  });

  it('should reject a valid package addressed to another ECU', () => {
    const update = createSignedPackage(
      privateKey,
      { ...manifest(), ecuId: 'ecu-b' },
      'ecu-b-firmware-v2'
    );

    expect(
      packageVerdict(update, publicKey, {
        ecuId: 'ecu-a',
        currentVersion: 1,
        inventory: { 'ecu-a': 1, 'ecu-b': 1 },
        policy: HARDENED_ECU_POLICY,
      })
    ).toEqual({ accepted: false, reason: 'wrong_target' });
  });

  it('should reject malformed dependency metadata without throwing', () => {
    const update = createSignedPackage(
      privateKey,
      { ...manifest(), dependsOn: 'ecu-a' },
      'firmware-v2'
    );

    expect(
      packageVerdict(update, publicKey, {
        ecuId: 'ecu-a',
        currentVersion: 1,
        inventory: { 'ecu-a': 1, 'ecu-b': 1 },
        policy: HARDENED_ECU_POLICY,
      })
    ).toEqual({ accepted: false, reason: 'invalid_manifest' });
  });

  it('should reject a publisher-controlled boot health claim', () => {
    const update = createSignedPackage(
      privateKey,
      { ...manifest(), healthy: true },
      'firmware-v2'
    );

    expect(
      packageVerdict(update, publicKey, {
        ecuId: 'ecu-a',
        currentVersion: 1,
        inventory: { 'ecu-a': 1, 'ecu-b': 1 },
        policy: HARDENED_ECU_POLICY,
      })
    ).toEqual({ accepted: false, reason: 'invalid_manifest' });
  });
});
