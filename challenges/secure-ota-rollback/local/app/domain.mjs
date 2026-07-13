export const BROKEN_TCU_POLICY = Object.freeze({
  dependencyOrder: false,
  resumeFromCheckpoint: false,
  maxRetries: 5,
  auditCorrelation: false,
});

export const HARDENED_TCU_POLICY = Object.freeze({
  dependencyOrder: true,
  resumeFromCheckpoint: true,
  maxRetries: 2,
  auditCorrelation: true,
});

export function orderPackages(packages, policy) {
  if (!policy.dependencyOrder) return [...packages];

  const remaining = [...packages];
  const ordered = [];
  const available = new Set();
  while (remaining.length > 0) {
    const index = remaining.findIndex((packageData) =>
      (packageData.manifest.dependsOn ?? []).every((dependency) =>
        available.has(dependency.ecuId)
      )
    );
    if (index < 0)
      throw new Error('package dependency graph is cyclic or incomplete');
    const [next] = remaining.splice(index, 1);
    ordered.push(next);
    available.add(next.manifest.ecuId);
  }
  return ordered;
}

export function nextDeliveryQueue(packages, completedEcus, policy) {
  if (!policy.resumeFromCheckpoint) return [...packages];
  return packages.filter(
    (packageData) => !completedEcus.has(packageData.manifest.ecuId)
  );
}

export function createEcuState(ecuId) {
  return {
    ecuId,
    activeSlot: 'A',
    knownGoodSlot: 'A',
    slots: {
      A: { version: 1, healthy: true, campaignId: 'factory' },
      B: null,
    },
    installCount: 0,
    lastResult: 'factory_state',
  };
}

export function applyToInactiveSlot(
  current,
  manifest,
  rollbackOnHealthFailure,
  bootHealthy
) {
  const inactiveSlot = current.activeSlot === 'A' ? 'B' : 'A';
  const next = {
    ...current,
    slots: {
      ...current.slots,
      [inactiveSlot]: {
        version: manifest.version,
        healthy: bootHealthy,
        campaignId: manifest.campaignId ?? 'unknown',
      },
    },
    activeSlot: inactiveSlot,
    installCount: current.installCount + 1,
    lastResult: 'installed',
  };

  if (!bootHealthy) {
    if (rollbackOnHealthFailure) {
      return {
        ...next,
        activeSlot: current.knownGoodSlot,
        lastResult: 'rolled_back',
      };
    }
    return { ...next, lastResult: 'unhealthy_active' };
  }
  return { ...next, knownGoodSlot: inactiveSlot };
}

export function hasCorrelatedAudit(
  events,
  requiredComponents,
  requirements = {}
) {
  if (!Array.isArray(events) || events.length < requiredComponents.length + 1)
    return false;
  if (
    events[0]?.component !== 'ota' ||
    events[0]?.action !== 'scenario_started'
  )
    return false;
  const last = events.at(-1);
  if (last?.component !== 'ota' || last?.action !== 'scenario_finished')
    return false;

  let previousTimestamp = Number.NEGATIVE_INFINITY;
  for (const event of events) {
    if (
      typeof event.component !== 'string' ||
      typeof event.actor !== 'string' ||
      event.actor !== event.component ||
      typeof event.action !== 'string' ||
      event.action.length === 0 ||
      typeof event.result !== 'string' ||
      event.result.length === 0 ||
      typeof event.correlationId !== 'string' ||
      event.correlationId.length === 0 ||
      typeof event.at !== 'string'
    ) {
      return false;
    }
    if (requirements.campaignId && event.campaignId !== requirements.campaignId)
      return false;
    const timestamp = Date.parse(event.at);
    if (!Number.isFinite(timestamp) || timestamp < previousTimestamp)
      return false;
    previousTimestamp = timestamp;
  }

  const components = new Set(events.map((event) => event.component));
  if (!requiredComponents.every((component) => components.has(component)))
    return false;
  const correlationIds = new Set(events.map((event) => event.correlationId));
  if (correlationIds.size !== 1 || correlationIds.has('')) return false;

  let cursor = -1;
  for (const step of requirements.steps ?? []) {
    cursor = events.findIndex(
      (event, index) =>
        index > cursor &&
        event.component === step.component &&
        event.action === step.action
    );
    if (cursor < 0) return false;
  }
  return true;
}

export function currentVersion(state) {
  return state.slots[state.activeSlot]?.version ?? -1;
}

export function makeEvent(component, action, correlationId, details = {}) {
  const { actor = component, result = 'recorded', ...eventDetails } = details;
  return {
    component,
    actor,
    action,
    correlationId,
    at: new Date().toISOString(),
    result,
    ...eventDetails,
  };
}
