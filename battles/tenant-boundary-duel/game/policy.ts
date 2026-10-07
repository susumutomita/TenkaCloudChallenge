type Value = string | boolean;
type Node =
  | { kind: "value"; value: Value }
  | { kind: "field"; name: string }
  | { kind: "not"; child: Node }
  | { kind: "binary"; op: string; left: Node; right: Node };
export const AUTH_FIELDS = {
  "actor.active": "boolean",
  "actor.tenant": "string",
  "actor.role": "string",
  "document.tenant": "string",
  action: "string",
  "grant.valid": "boolean",
  "request.tenant": "string",
} as const;
export const LOG_FIELDS = {
  "event.allowed": "boolean",
  "event.actorTenant": "string",
  "event.documentTenant": "string",
  "event.action": "string",
  "event.grantValid": "boolean",
} as const;
type FieldTypes = Readonly<Record<string, "string" | "boolean">>;
export function compile(
  source: string,
  fields: FieldTypes,
): (values: Record<string, Value>) => boolean {
  if (source.length > 1024) throw new Error("expression_too_long");
  const tokens: string[] = [];
  const lexer = /\s*("(?:[^"\\\r\n]|\\["\\])*"|[a-zA-Z][a-zA-Z.]*|&&|\|\||==|!=|!|\(|\))/y;
  let offset = 0;
  while (offset < source.length) {
    if (!source.slice(offset).trim()) break;
    lexer.lastIndex = offset;
    const token = lexer.exec(source);
    if (!token) throw new Error("invalid_expression_token");
    tokens.push(token[1]!);
    offset = lexer.lastIndex;
    if (tokens.length > 128) throw new Error("too_many_tokens");
  }
  let index = 0;
  const typeOf = (node: Node): string => {
    if (node.kind === "value") return typeof node.value;
    if (node.kind === "field") return fields[node.name]!;
    if (node.kind === "not") {
      if (typeOf(node.child) !== "boolean") throw new Error("boolean_required");
      return "boolean";
    }
    const a = typeOf(node.left),
      b = typeOf(node.right);
    if (node.op === "==" || node.op === "!=") {
      if (a !== b) throw new Error("comparison_type_mismatch");
    } else if (a !== "boolean" || b !== "boolean") throw new Error("boolean_required");
    return "boolean";
  };
  function primary(depth: number): Node {
    if (depth > 16) throw new Error("expression_too_deep");
    const token = tokens[index++];
    if (!token) throw new Error("incomplete_expression");
    if (token === "!") return { kind: "not", child: primary(depth + 1) };
    if (token === "(") {
      const node = expression(0, depth + 1);
      if (tokens[index++] !== ")") throw new Error("missing_close_parenthesis");
      return node;
    }
    if (token === "true" || token === "false") return { kind: "value", value: token === "true" };
    if (token.startsWith('"')) return { kind: "value", value: JSON.parse(token) as string };
    if (Object.hasOwn(fields, token)) return { kind: "field", name: token };
    throw new Error("unknown_field");
  }
  const precedence: Record<string, number> = { "||": 1, "&&": 2, "==": 3, "!=": 3 };
  function expression(min: number, depth: number): Node {
    let left = primary(depth);
    while ((precedence[tokens[index]!] ?? 0) > min) {
      const op = tokens[index++]!;
      left = { kind: "binary", op, left, right: expression(precedence[op]!, depth + 1) };
    }
    return left;
  }
  const tree = expression(0, 0);
  if (index !== tokens.length) throw new Error("unexpected_token");
  if (typeOf(tree) !== "boolean") throw new Error("boolean_result_required");
  function evaluate(node: Node, values: Record<string, Value>): Value {
    if (node.kind === "value") return node.value;
    if (node.kind === "field") {
      const value = values[node.name];
      if (typeof value !== fields[node.name]) throw new Error("missing_typed_field");
      return value!;
    }
    if (node.kind === "not") return !evaluate(node.child, values);
    const a = evaluate(node.left, values),
      b = evaluate(node.right, values);
    if (node.op === "==") return a === b;
    if (node.op === "!=") return a !== b;
    return node.op === "&&" ? a === true && b === true : a === true || b === true;
  }
  return (values) => evaluate(tree, values) === true;
}
