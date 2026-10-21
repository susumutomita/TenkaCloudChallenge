import { createHash } from 'node:crypto';
import { Memory, parseProgram, scenario } from '../app/model.mjs';
export function grade(submission, seed) {
  try {
    if (typeof submission !== 'string' || submission.length > 1024 || !seed) return false;
    const guards = parseProgram(submission);
    for (const input of ['A', 'B']) {
      const normal = scenario('normal', guards, input), fixed = scenario('fixed', guards, input);
      if (normal.rejected || normal.selected !== 'A' || !fixed.rejected || fixed.selected !== 'A') return false;
    }
    // Per-run fixtures stay with verifier authority. Never grade a client-supplied success log.
    for (let i = 0; i < 32; i++) {
      const owner = createHash('sha256').update(`${seed}:${i}`).digest('hex');
      const m = new Memory();
      for (let j = 0; j < i % 5; j++) m.allocate('padding', 'data', 'A');
      const old = m.allocate(owner, 'progress', 'A');
      m.write(old, 'B', guards, owner, 'progress');
      if (m.read(old, guards, owner, 'progress') !== 'B') return false;
      const rejectsBoth = (h, who, kind) => {
        const before = m.snapshot(); let rejected = 0;
        try { m.read(h, guards, who, kind); } catch { rejected++; }
        try { m.write(h, 'B', guards, who, kind); } catch { rejected++; }
        return rejected === 2 && JSON.stringify(before) === JSON.stringify(m.snapshot());
      };
      if (!rejectsBoth(old, 'another-owner', 'progress')) return false;
      if (!rejectsBoth(old, owner, 'control')) return false;
      m.release(old);
      if (!rejectsBoth(old, owner, 'progress')) return false;
      // Same owner and same kind: live/type/owner checks alone cannot detect reuse.
      for (let n = 0; n < 3; n++) {
        const fresh = m.allocate(owner, 'progress', 'A');
        if (!rejectsBoth(old, owner, 'progress')) return false;
        if (m.read(fresh, guards, owner, 'progress') !== 'A') return false;
        m.release(fresh);
      }
    }
    return true;
  } catch { return false; }
}
