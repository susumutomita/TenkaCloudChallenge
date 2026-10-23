// Safe semantic simulation: array indices are labels, never machine addresses.
export const FIELDS = [
  'slot.live', 'slot.generation', 'slot.owner', 'slot.kind',
  'handle.generation', 'handle.owner', 'handle.kind', 'caller.owner', 'caller.kind',
];
const isOperand = value => typeof value === 'boolean' || FIELDS.includes(value);
export function parseProgram(text) {
  const p = JSON.parse(text);
  if (!p || Object.keys(p).join() !== 'guards' || !Array.isArray(p.guards) ||
      p.guards.length > 8 || p.guards.some(g => !Array.isArray(g) || g.length !== 3 ||
        !isOperand(g[0]) || !['==', '!='].includes(g[1]) || !isOperand(g[2]))) {
    throw new Error('invalid comparison program');
  }
  return p.guards;
}
// A closed operand table, not property traversal or JavaScript evaluation.
function operand(value, h, s, owner, kind) {
  if (typeof value === 'boolean') return value;
  const values = {
    'slot.live': s.live, 'slot.generation': s.generation, 'slot.owner': s.owner, 'slot.kind': s.kind,
    'handle.generation': h.generation, 'handle.owner': h.owner, 'handle.kind': h.kind,
    'caller.owner': owner, 'caller.kind': kind,
  };
  if (!FIELDS.includes(value)) throw new Error('invalid operand');
  return values[value];
}
export class Memory {
  slots = [];
  allocate(owner, kind, value) {
    let index = this.slots.findIndex(s => !s.live);
    if (index < 0) index = this.slots.length;
    const generation = (this.slots[index]?.generation ?? 0) + 1;
    this.slots[index] = { live: true, generation, owner, kind, value };
    return Object.freeze({ slot: index, generation, owner, kind });
  }
  slot(h) {
    if (!h || !Number.isInteger(h.slot) || h.slot < 0) throw new Error('invalid handle');
    const s = this.slots[h.slot];
    if (!s) throw new Error('invalid slot');
    return s;
  }
  resolve(h, guards, owner, kind) {
    const s = this.slot(h);
    // The submitted comparison program executes before EVERY read and write.
    for (const [left, op, right] of guards) {
      if (!['==', '!='].includes(op)) throw new Error('invalid comparison');
      const equal = operand(left, h, s, owner, kind) === operand(right, h, s, owner, kind);
      if (!(op === '==' ? equal : !equal)) {
        throw new Error(`comparison rejected: ${left} ${op} ${right}`);
      }
    }
    return s;
  }
  read(h, guards, owner, kind) { return this.resolve(h, guards, owner, kind).value; }
  write(h, value, guards, owner, kind) { this.resolve(h, guards, owner, kind).value = value; }
  // Allocator and dispatcher already hold a current ticket; they are trusted controls,
  // not submitted repair programs. They never use an unchecked stale ticket.
  current(h, owner, kind) {
    const s = this.slot(h);
    if (!s.live || s.generation !== h.generation || s.owner !== owner || s.kind !== kind) {
      throw new Error('invalid current ticket');
    }
    return s;
  }
  release(h) { this.current(h, h.owner, h.kind).live = false; }
  snapshot() { return structuredClone(this.slots); }
}
// Closed, harmless dispatcher: no eval, shell, executable addresses, or user functions.
export function dispatch(id) {
  if (id === 'A') return 'A: 青いカードを表示';
  if (id === 'B') return 'B: 黄色いカードを表示';
  return 'STOP: 未知の呼び出し先を拒否';
}
export function scenario(mode, guards = [], input = 'B') {
  if (!['normal', 'buggy', 'fixed'].includes(mode) || !['A', 'B'].includes(input)) throw new Error('invalid scenario');
  const m = new Memory(), log = [];
  const record = (event, detail = {}) => log.push({ step: log.length + 1, event, ...detail, slots: m.snapshot() });
  const old = m.allocate('upload', 'progress', '25%');
  record('allocate progress', { handle: old });
  if (mode !== 'normal') { m.release(old); record('release progress; old handle remains', { handle: old }); }
  const control = m.allocate('app', 'control', 'A');
  record('allocate control', { handle: control });
  const accessGuards = mode === 'buggy' ? [] : guards;
  let read, rejected = false;
  try { read = m.read(old, accessGuards, 'upload', 'progress'); record('read through old handle', { read }); }
  catch (e) { rejected = true; record('read rejected', { reason: e.message }); }
  // Try the write independently, so a rejected read cannot mask an unsafe write.
  try { m.write(old, input, accessGuards, 'upload', 'progress'); record('write through old handle', { written: input }); }
  catch (e) { rejected = true; record('write rejected', { reason: e.message }); }
  const selected = m.current(control, 'app', 'control').value;
  const output = dispatch(selected);
  record('dispatch current control', { selected, output });
  return { mode, input, old, control, read, rejected, selected, output, log };
}
