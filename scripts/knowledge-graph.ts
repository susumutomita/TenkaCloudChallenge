/**
 * Catalog-wide semantic validation for the optional educational knowledge graph.
 *
 * JSON Schema owns the shape, ID patterns, relation enum, and endpoint namespaces.
 * This module owns facts that require the full catalog: globally unique node IDs,
 * references to nodes declared by another problem, and acyclic `requires` edges.
 */

export interface KnowledgeGraphCatalogEntry {
  readonly file: string;
  readonly metadata: Record<string, unknown>;
}

export interface KnowledgeGraphDiagnostic {
  readonly file: string;
  readonly path: string;
  readonly message: string;
}

type NodeKind =
  | "problem"
  | "learning_objective"
  | "concept"
  | "assessment_criterion"
  | "misconception"
  | "audience";

interface NodeLocation {
  readonly kind: NodeKind;
  readonly file: string;
  readonly path: string;
}

interface Relation {
  readonly type: string;
  readonly source: string;
  readonly target: string;
}

interface RelationLocation {
  readonly relation: Relation;
  readonly file: string;
  readonly path: string;
}

interface RequiresEdge {
  readonly source: string;
  readonly target: string;
  readonly file: string;
  readonly path: string;
}

const NODE_COLLECTIONS = [
  ["learning_objectives", "learning_objective"],
  ["concepts", "concept"],
  ["assessment_criteria", "assessment_criterion"],
  ["misconceptions", "misconception"],
  ["audiences", "audience"],
] as const satisfies ReadonlyArray<readonly [string, NodeKind]>;

const REQUIRES_KINDS = new Set<NodeKind>(["problem", "learning_objective", "concept"]);

/** Validate every graph declaration as one global catalog graph. */
export function validateKnowledgeGraphCatalog(
  catalog: readonly KnowledgeGraphCatalogEntry[],
): KnowledgeGraphDiagnostic[] {
  const diagnostics: KnowledgeGraphDiagnostic[] = [];
  const nodes = new Map<string, NodeLocation>();
  const entries = [...catalog].sort((left, right) => left.file.localeCompare(right.file));

  for (const entry of entries) {
    const problemId = entry.metadata.id;
    if (typeof problemId !== "string") continue;
    registerNode(`problem.${problemId}`, "problem", entry.file, "id", nodes, diagnostics);
  }

  for (const entry of entries) {
    const graphNodes = asRecord(entry.metadata.nodes);
    const problemId = entry.metadata.id;
    if (!graphNodes || typeof problemId !== "string") continue;
    for (const [collection, kind] of NODE_COLLECTIONS) {
      const declarations = graphNodes[collection];
      if (!Array.isArray(declarations)) continue;
      for (const [index, declaration] of declarations.entries()) {
        const id = asRecord(declaration)?.id;
        if (typeof id !== "string") continue;
        const path = `nodes.${collection}[${index}].id`;
        validateProblemScopedNode(id, kind, problemId, entry.file, path, diagnostics);
        registerNode(
          id,
          kind,
          entry.file,
          path,
          nodes,
          diagnostics,
        );
      }
    }
  }

  const relations = collectRelations(entries);
  const requiresEdges: RequiresEdge[] = [];
  for (const located of relations) {
    validateRelation(located, nodes, diagnostics, requiresEdges);
  }
  diagnostics.push(...detectRequiresCycles(requiresEdges));

  return diagnostics.sort(compareDiagnostic);
}

function validateProblemScopedNode(
  id: string,
  kind: NodeKind,
  problemId: string,
  file: string,
  path: string,
  diagnostics: KnowledgeGraphDiagnostic[],
): void {
  const expectedPrefix =
    kind === "learning_objective"
      ? `lo.${problemId}.`
      : kind === "assessment_criterion"
        ? `assessment.${problemId}.`
        : undefined;
  if (expectedPrefix && !id.startsWith(expectedPrefix)) {
    diagnostics.push({
      file,
      path,
      message: `${kind} node id "${id}" must use problem scope "${expectedPrefix}"`,
    });
  }
}

function registerNode(
  id: string,
  kind: NodeKind,
  file: string,
  path: string,
  nodes: Map<string, NodeLocation>,
  diagnostics: KnowledgeGraphDiagnostic[],
): void {
  const first = nodes.get(id);
  if (first) {
    diagnostics.push({
      file,
      path,
      message: `node id "${id}" is duplicated; first declared at ${first.file}:${first.path}`,
    });
    return;
  }
  nodes.set(id, { kind, file, path });
}

function collectRelations(entries: readonly KnowledgeGraphCatalogEntry[]): RelationLocation[] {
  const collected: RelationLocation[] = [];
  for (const entry of entries) {
    if (!Array.isArray(entry.metadata.relations)) continue;
    for (const [index, value] of entry.metadata.relations.entries()) {
      const relation = asRecord(value);
      if (
        typeof relation?.type !== "string" ||
        typeof relation.source !== "string" ||
        typeof relation.target !== "string"
      ) {
        continue;
      }
      collected.push({
        file: entry.file,
        path: `relations[${index}]`,
        relation: {
          type: relation.type,
          source: relation.source,
          target: relation.target,
        },
      });
    }
  }
  return collected;
}

function validateRelation(
  located: RelationLocation,
  nodes: ReadonlyMap<string, NodeLocation>,
  diagnostics: KnowledgeGraphDiagnostic[],
  requiresEdges: RequiresEdge[],
): void {
  const { relation, file, path } = located;
  const source = nodes.get(relation.source);
  const target = nodes.get(relation.target);
  if (!source) {
    diagnostics.push({
      file,
      path: `${path}.source`,
      message: `source node "${relation.source}" does not exist in this catalog`,
    });
  }
  if (!target) {
    diagnostics.push({
      file,
      path: `${path}.target`,
      message: `target node "${relation.target}" does not exist in this catalog`,
    });
  }
  if (!source || !target) return;

  if (!validEndpointKinds(relation.type, source.kind, target.kind)) {
    diagnostics.push({
      file,
      path,
      message: `${relation.type} does not allow ${source.kind} -> ${target.kind}`,
    });
    return;
  }

  if (relation.type === "requires") {
    requiresEdges.push({
      source: relation.source,
      target: relation.target,
      file,
      path,
    });
  }
}

function validEndpointKinds(type: string, source: NodeKind, target: NodeKind): boolean {
  switch (type) {
    case "teaches":
      return source === "problem" && target === "learning_objective";
    case "covers":
      return source === "problem" && target === "concept";
    case "requires":
      return REQUIRES_KINDS.has(source) && REQUIRES_KINDS.has(target);
    case "assesses":
      return source === "problem" && target === "assessment_criterion";
    case "related_to":
      return true;
    default:
      return false;
  }
}

function detectRequiresCycles(edges: readonly RequiresEdge[]): KnowledgeGraphDiagnostic[] {
  const adjacency = new Map<string, RequiresEdge[]>();
  for (const edge of edges) {
    const outgoing = adjacency.get(edge.source) ?? [];
    outgoing.push(edge);
    adjacency.set(edge.source, outgoing);
  }
  for (const outgoing of adjacency.values()) {
    outgoing.sort(
      (left, right) =>
        left.target.localeCompare(right.target) ||
        left.file.localeCompare(right.file) ||
        left.path.localeCompare(right.path),
    );
  }

  const diagnostics: KnowledgeGraphDiagnostic[] = [];
  const state = new Map<string, "visiting" | "visited">();
  const stack: string[] = [];

  const visit = (id: string): void => {
    state.set(id, "visiting");
    stack.push(id);
    for (const edge of adjacency.get(id) ?? []) {
      const targetState = state.get(edge.target);
      if (targetState === "visiting") {
        const cycleStart = stack.lastIndexOf(edge.target);
        const cycle = [...stack.slice(cycleStart), edge.target];
        diagnostics.push({
          file: edge.file,
          path: edge.path,
          message: `requires cycle detected: ${cycle.join(" -> ")}`,
        });
        continue;
      }
      if (targetState !== "visited") visit(edge.target);
    }
    stack.pop();
    state.set(id, "visited");
  };

  for (const id of [...adjacency.keys()].sort((left, right) => left.localeCompare(right))) {
    if (!state.has(id)) visit(id);
  }
  return diagnostics;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function compareDiagnostic(
  left: KnowledgeGraphDiagnostic,
  right: KnowledgeGraphDiagnostic,
): number {
  return (
    left.file.localeCompare(right.file) ||
    left.path.localeCompare(right.path) ||
    left.message.localeCompare(right.message)
  );
}
