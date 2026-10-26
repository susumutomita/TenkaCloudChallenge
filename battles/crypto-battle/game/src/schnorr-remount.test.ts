import { afterEach, expect, spyOn, test } from "bun:test";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { createElement } from "react";
import { SchnorrProof } from "../../portal/SchnorrProof.tsx";
import { applyOp, initialState, projectForTeam, STREAMING_ORDER_CONFIG, validateOp } from "./reducer.ts";
import type { ContractProjection, CryptoBattleOp } from "./types.ts";

const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
const previousAct = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
let renderer: ReactTestRenderer | undefined;
let random: ReturnType<typeof spyOn> | undefined;
afterEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = undefined;
  random?.mockRestore();
  for (const [name, descriptor] of [["sessionStorage", previousStorage], ["IS_REACT_ACT_ENVIRONMENT", previousAct]] as const) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});
const text = (node: ReactTestInstance): string => node.children.map(child => typeof child === "string" ? child : text(child)).join("");
function setup(storage: { getItem(key: string): string | null; setItem(key: string, value: string): void }) {
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: storage });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  let next = 3;
  random = spyOn(crypto, "getRandomValues").mockImplementation(((bytes: Uint8Array) => { bytes[0] = next++; return bytes; }) as typeof crypto.getRandomValues);
  return () => next - 3;
}

test("the real proof component keeps the displayed calculation across other Orders and accepts its response", () => {
  const notes = new Map<string, string>();
  const draws = setup({ getItem: key => notes.get(key) ?? null, setItem: (key, value) => { notes.set(key, value); } });
  let state = applyOp(initialState({ eventId: "remount", teamIds: ["a", "b"], matchSecret: "unit-fixture" }, STREAMING_ORDER_CONFIG), "a", { kind: "start" });
  const ownOrder = () => projectForTeam(state, "a").myContracts[0]!;
  const submit = (op: CryptoBattleOp) => {
    expect(validateOp(state, "a", op)).toEqual({ ok: true });
    state = applyOp(state, "a", op);
  };
  const element = (order: ContractProjection) => createElement(SchnorrProof, { order, teamId: "a", locale: "ja", busy: false, onSubmit: submit });
  const mount = (order: ContractProjection) => { act(() => { renderer = create(element(order)); }); };
  mount(ownOrder());
  expect(text(renderer!.root)).toContain("r = 3");
  act(() => renderer!.unmount()); renderer = undefined;
  mount({ ...ownOrder(), id: "a-other-order" });
  expect(text(renderer!.root)).toContain("r = 4");
  act(() => renderer!.unmount()); renderer = undefined;
  mount(ownOrder());
  expect(text(renderer!.root)).toContain("r = 3");
  expect(draws()).toBe(2);
  act(() => renderer!.root.findByProps({ "aria-label": "Schnorr a" }).props.onChange({ target: { value: "8" } }));
  act(() => renderer!.root.findAllByType("button").find(button => String(button.props.children).startsWith("①"))!.props.onClick());
  act(() => renderer!.update(element(ownOrder())));
  const pending = ownOrder().schnorr!.pending!;
  const witness = JSON.parse(notes.get(`tc-schnorr:a:${ownOrder().id}`)!);
  const z = (3 + pending.e * witness.x) % 11;
  act(() => renderer!.root.findByProps({ "aria-label": "Schnorr z" }).props.onChange({ target: { value: String(z) } }));
  act(() => renderer!.root.findAllByType("button").find(button => String(button.props.children).startsWith("②"))!.props.onClick());
  expect(ownOrder().schnorr!.pending!.outcome).toBe("hit");
  expect(state.teams.a!.score).toBe(ownOrder().points);
  expect(draws()).toBe(2);
});

test("unavailable storage does not reroll an accepted commitment on remount", () => {
  const draws = setup({ getItem: () => { throw Error("storage unavailable"); }, setItem: () => { throw Error("storage unavailable"); } });
  const state = applyOp(initialState({ eventId: "missing-notes", teamIds: ["a", "b"], matchSecret: "unit-fixture" }, STREAMING_ORDER_CONFIG), "a", { kind: "start" });
  const order = projectForTeam(state, "a").myContracts[0]!;
  const pending = { ...order, schnorr: { ...order.schnorr!, pending: { y: order.schnorr!.y, a: 8, e: 5 } } };
  act(() => { renderer = create(createElement(SchnorrProof, { order: pending, teamId: "a", locale: "ja", busy: false, onSubmit: () => { throw Error("cannot submit without notes"); } })); });
  expect(text(renderer!.root)).toContain("証明を開始したタブで続けてください");
  expect(renderer!.root.findAllByProps({ "aria-label": "Schnorr z" })).toHaveLength(0);
  expect(draws()).toBe(0);
});
