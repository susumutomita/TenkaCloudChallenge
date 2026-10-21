// Operator-only reference program. This file is not copied into the participant image.
import { scenario } from './model.mjs';
const guards = [
  ['slot.live', '==', true],
  ['handle.generation', '==', 'slot.generation'],
  ['slot.owner', '==', 'caller.owner'],
  ['slot.kind', '==', 'caller.kind'],
];
for (const mode of ['normal', 'buggy', 'fixed']) console.log(JSON.stringify(scenario(mode, guards), null, 2));
