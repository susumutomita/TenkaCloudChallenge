import { expect, test } from "bun:test";
import {
  artifactFields,
  decodeArtifact,
  encodeArtifact,
} from "./ledger-codec.ts";
import { initialState } from "./reducer.ts";
import type { PublicArtifact } from "./types.ts";

test("all tuple kinds preserve public values, optional fields, unfamiliar IDs and exact epoch time", () => {
  const teams = initialState({
    eventId: "tuple-kinds",
    teamIds: ["0", "雪", "a|b"],
  }).teams;
  const base = {
    teamId: "a|b",
    contractId: "a|b-c123",
    generation: 31,
    postedAtMs: 1788595200123,
  };
  const entries: PublicArtifact[] = [
    {
      ...base,
      id: "unfamiliar-share",
      kind: "share",
      method: "leak",
      shareIndex: 9,
      value: "0",
    },
    {
      ...base,
      id: "unfamiliar-caesar",
      kind: "cipher-pair",
      method: "leak",
      rung: "caesar",
      plaintext: [0],
      ciphertext: [1],
    },
    {
      ...base,
      id: "unfamiliar-vig",
      kind: "cipher-pair",
      method: "leak",
      rung: "vigenere",
      keyPosition: 0,
      plaintext: [0],
      ciphertext: [1],
    },
    {
      ...base,
      id: "unfamiliar-rotor",
      kind: "rotor-pair",
      method: "leak",
      plaintext: [0, 1, 2, 3],
      ciphertext: [3, 2, 1, 0],
    },
    {
      ...base,
      id: "unfamiliar-rsa",
      kind: "rsa-pair",
      method: "leak",
      n: 77,
      e: 7,
      plaintext: 0,
      ciphertext: 0,
    },
    {
      ...base,
      id: "unfamiliar-proof",
      kind: "proof",
      method: "prove",
      commitment: "1",
      response: "0",
    },
    {
      ...base,
      id: "unfamiliar-proof-e",
      kind: "proof",
      method: "prove",
      commitment: "1",
      challenge: "0",
      response: "0",
    },
    {
      ...base,
      id: "unfamiliar-fhe",
      kind: "ciphertext",
      method: "fhe",
      r: "0",
      y: "0",
    },
    {
      ...base,
      id: "unfamiliar-mpc",
      kind: "partial",
      method: "mpc",
      partial: "0",
      peerPartials: ["0", "1"],
      total: "1",
    },
    {
      ...base,
      id: "unfamiliar-sudoku",
      kind: "sudoku-reveal",
      method: "prove",
      group: 0,
      cells: [4, 3, 2, 1],
      tag: "literal|tag",
    },
    {
      ...base,
      id: "unfamiliar-commit",
      kind: "rps-commit",
      method: "duel",
      duelId: "foreign-duel",
      commitment: 0,
    },
    {
      ...base,
      id: "unfamiliar-open",
      kind: "rps-open",
      method: "duel",
      duelId: "foreign-duel",
      commitment: 0,
      hand: 1,
      randomness: 0,
    },
  ];
  for (const value of entries) {
    const legacy = encodeArtifact(value),
      tuple = encodeArtifact(value, teams);
    expect(Array.isArray(tuple)).toBe(true);
    expect(artifactFields(tuple).t).toBe(base.postedAtMs);
    expect(decodeArtifact(JSON.parse(JSON.stringify(tuple)), teams)).toEqual(
      value,
    );
    expect(decodeArtifact(legacy)).toEqual(value);
    expect(artifactFields(tuple)).toBe(artifactFields(tuple));
  }
  const tuple = encodeArtifact(entries[0]!, teams);
  for (const invalid of [
    [99, ...tuple.slice(1)],
    [...tuple.slice(0, 4), 99, ...tuple.slice(5)],
    tuple.slice(0, -2),
    [...tuple, "extra"],
    [...tuple.slice(0, 6), null, ...tuple.slice(7)],
  ])
    expect(() => decodeArtifact(invalid as never, teams)).toThrow();
});
