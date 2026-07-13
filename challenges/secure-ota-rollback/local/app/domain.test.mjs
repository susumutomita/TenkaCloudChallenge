import { describe, expect, it } from 'bun:test';
import {
  BROKEN_TCU_POLICY,
  HARDENED_TCU_POLICY,
  applyToInactiveSlot,
  createEcuState,
  hasCorrelatedAudit,
  nextDeliveryQueue,
  orderPackages,
} from './domain.mjs';

const packageFor = (ecuId, dependsOn = []) => ({
  manifest: { ecuId, version: 2, dependsOn },
});

describe('secure OTA state machine', () => {
  it('should order ECU packages by declared dependencies only after remediation', () => {
    const ecuA = packageFor('ecu-a');
    const ecuB = packageFor('ecu-b', [{ ecuId: 'ecu-a', minVersion: 2 }]);

    expect(
      orderPackages([ecuB, ecuA], BROKEN_TCU_POLICY).map(
        (item) => item.manifest.ecuId
      )
    ).toEqual(['ecu-b', 'ecu-a']);
    expect(
      orderPackages([ecuB, ecuA], HARDENED_TCU_POLICY).map(
        (item) => item.manifest.ecuId
      )
    ).toEqual(['ecu-a', 'ecu-b']);
  });

  it('should resume after the last durable checkpoint only after remediation', () => {
    const packages = [packageFor('ecu-a'), packageFor('ecu-b')];
    const completed = new Set(['ecu-a']);

    expect(
      nextDeliveryQueue(packages, completed, BROKEN_TCU_POLICY).length
    ).toBe(2);
    expect(
      nextDeliveryQueue(packages, completed, HARDENED_TCU_POLICY).map(
        (item) => item.manifest.ecuId
      )
    ).toEqual(['ecu-b']);
  });

  it('should restore the known-good slot after a health failure', () => {
    const state = createEcuState('ecu-a');
    const manifest = { campaignId: 'campaign-1', ecuId: 'ecu-a', version: 2 };

    const broken = applyToInactiveSlot(state, manifest, false, false);
    const recovered = applyToInactiveSlot(state, manifest, true, false);
    const healthy = applyToInactiveSlot(state, manifest, true, true);

    expect(broken.activeSlot).toBe('B');
    expect(broken.slots.B).toMatchObject({ version: 2, healthy: false });
    expect(recovered.activeSlot).toBe('A');
    expect(recovered.knownGoodSlot).toBe('A');
    expect(recovered.slots.B).toMatchObject({ version: 2, healthy: false });
    expect(healthy.activeSlot).toBe('B');
    expect(healthy.knownGoodSlot).toBe('B');
    expect(healthy.slots.B).toMatchObject({ version: 2, healthy: true });
  });

  it('should require one correlation id across every responsibility boundary', () => {
    const components = ['signing', 'ota', 'tcu', 'bus', 'ecu-a', 'ecu-b'];
    const correlated = [
      {
        component: 'ota',
        actor: 'ota',
        action: 'scenario_started',
        result: 'started',
        campaignId: 'campaign-1',
        correlationId: 'corr-1',
        at: '2026-01-01T00:00:00.000Z',
      },
      ...['signing', 'tcu', 'bus', 'ecu-a', 'ecu-b'].map(
        (component, index) => ({
          component,
          actor: component,
          action: 'decision_recorded',
          result: 'accepted',
          campaignId: 'campaign-1',
          correlationId: 'corr-1',
          at: `2026-01-01T00:00:0${index + 1}.000Z`,
        })
      ),
      {
        component: 'ota',
        actor: 'ota',
        action: 'scenario_finished',
        result: 'completed',
        campaignId: 'campaign-1',
        correlationId: 'corr-1',
        at: '2026-01-01T00:00:06.000Z',
      },
    ];
    const fragmented = correlated.map((event, index) => ({
      ...event,
      correlationId: index === 0 ? 'corr-1' : `corr-${index + 1}`,
    }));
    const missingDecisionEvidence = correlated.map((event, index) =>
      index === 2 ? { ...event, result: '' } : event
    );
    const outOfOrder = correlated.map((event, index) =>
      index === 2 ? { ...event, at: '2025-12-31T23:59:59.000Z' } : event
    );
    const steps = correlated.map(({ action, component }) => ({
      action,
      component,
    }));
    const missingStep = correlated.filter((_, index) => index !== 3);

    expect(
      hasCorrelatedAudit(correlated, components, {
        campaignId: 'campaign-1',
        steps,
      })
    ).toBe(true);
    expect(hasCorrelatedAudit(fragmented, components)).toBe(false);
    expect(hasCorrelatedAudit(missingDecisionEvidence, components)).toBe(false);
    expect(hasCorrelatedAudit(outOfOrder, components)).toBe(false);
    expect(
      hasCorrelatedAudit(missingStep, components, {
        campaignId: 'campaign-1',
        steps,
      })
    ).toBe(false);
  });
});
