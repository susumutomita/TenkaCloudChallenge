import { describe, expect, it } from "bun:test";
import {
  interpolateSecret,
  shareSecret,
  verifyShare,
} from "../battles/ac26-crypto-battle/game/crypto/feldman.ts";
import {
  G,
  P,
  Q,
  isElementInRange,
  isSubgroupElement,
  tryParseSubgroupElement,
} from "../battles/ac26-crypto-battle/game/crypto/group.ts";
import {
  bigintToHex,
  mod,
  modInv,
  modPow,
  tryHexToBigint,
} from "../battles/ac26-crypto-battle/game/crypto/modmath.ts";
import { sha256 } from "../battles/ac26-crypto-battle/game/crypto/sha256.ts";
import {
  POK_DOMAIN,
  buildContextParts,
  challengeScalar,
  encodeGroupElement,
  proveKnowledge,
  verifyKnowledge,
  type ProofContext,
} from "../battles/ac26-crypto-battle/game/crypto/schnorr.ts";
import {
  CONTRACT_SUCCESS_POINTS,
  DEFAULT_THRESHOLD,
  DEFAULT_TOTAL_SHARES,
  HUNT_BONUS_POINTS,
  ROTATE_COOLDOWN_MS,
} from "../battles/ac26-crypto-battle/game/constants.ts";
import {
  buildTeamFixture,
  buildTwoTeamState,
  createRng,
  huntOpFor,
  initOpFor,
  issueProveContract,
  issueStandardLeakContracts,
  leakOpFor,
  proveOpFor,
  rotateOpFor,
} from "../battles/ac26-crypto-battle/game/fixtures.ts";
import { projectForTeam } from "../battles/ac26-crypto-battle/game/projection.ts";
import {
  applyOp,
  expireContracts,
  initialState,
  issueContract,
  validateOp,
} from "../battles/ac26-crypto-battle/game/reducer.ts";
import type { ContractSpec, CryptoBattleOp } from "../battles/ac26-crypto-battle/game/types.ts";

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * ac26-crypto-battle の game model (PR1: state/op/reducer + Shamir/Feldman + fixtures)
 * のテスト。 2048-bit の BigInt modPow がコスト支配的なので、fixture は describe 単位
 * で使い回す (buildTwoTeamState 呼び出しは全体で数回に抑える)。
 */

// ---- crypto/modmath ----------------------------------------------------------------

describe("crypto/modmath", () => {
  it("mod normalizes negative values into [0, m)", () => {
    expect(mod(-1n, 7n)).toBe(6n);
    expect(mod(-15n, 7n)).toBe(6n);
    expect(mod(15n, 7n)).toBe(1n);
    expect(mod(0n, 7n)).toBe(0n);
  });

  it("modPow computes base^exp mod m via square-and-multiply", () => {
    expect(modPow(2n, 10n, 1000n)).toBe(24n); // 1024 mod 1000
    expect(modPow(3n, 0n, 5n)).toBe(1n);
    expect(modPow(0n, 5n, 7n)).toBe(0n);
    expect(modPow(5n, 1n, 1n)).toBe(0n); // m=1 -> everything is 0
  });

  it("modInv returns the multiplicative inverse", () => {
    expect(modInv(3n, 11n)).toBe(4n); // 3*4=12=1 mod 11
    expect((modInv(3n, 11n) * 3n) % 11n).toBe(1n);
  });

  it("modInv throws on non-invertible input (e.g. 0)", () => {
    expect(() => modInv(0n, 11n)).toThrow();
  });

  it("modInv throws when gcd(a,m) != 1", () => {
    expect(() => modInv(6n, 9n)).toThrow(); // gcd(6,9)=3
  });

  it("tryHexToBigint rejects malformed / oversized / uppercase input without throwing", () => {
    expect(tryHexToBigint("")).toBeNull();
    expect(tryHexToBigint("not-hex!")).toBeNull();
    expect(tryHexToBigint("ABCDEF")).toBeNull(); // 大文字は許可しない
    expect(tryHexToBigint("a".repeat(700))).toBeNull(); // MAX_HEX_LEN 超過
    expect(tryHexToBigint("1a2b")).toBe(0x1a2bn);
  });

  it("bigintToHex round-trips with tryHexToBigint", () => {
    const value = 0xdeadbeefn;
    expect(tryHexToBigint(bigintToHex(value))).toBe(value);
  });

  it("bigintToHex throws on negative input (programmer error, not adversarial input)", () => {
    expect(() => bigintToHex(-1n)).toThrow();
  });
});

// ---- crypto/sha256 -------------------------------------------------------------------

describe("crypto/sha256", () => {
  const enc = new TextEncoder();

  it("matches the NIST vector for the empty input", () => {
    expect(hex(sha256(enc.encode("")))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("matches the NIST vector for \"abc\"", () => {
    expect(hex(sha256(enc.encode("abc")))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("matches the NIST two-block vector", () => {
    // FIPS 180-2 の標準テストベクタ (56 byte -> padding 込みで2 block になる)。
    const message = "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";
    expect(hex(sha256(enc.encode(message)))).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  it("handles an input longer than one block (>64 bytes)", () => {
    const message = "a".repeat(100);
    // NIST の公表テストベクタではないが、python3 hashlib.sha256 と照合済みの値
    // (padding が複数 block にまたがるケースの回帰検出用)。
    expect(hex(sha256(enc.encode(message)))).toBe(
      "2816597888e4a0d3a36b82b83316ab32680eb8f00f8cd3b904d681246d285a0e",
    );
  });

  it("is deterministic and sensitive to every input byte", () => {
    const a = sha256(enc.encode("hunt-team-a"));
    const b = sha256(enc.encode("hunt-team-b"));
    expect(hex(sha256(enc.encode("hunt-team-a")))).toBe(hex(a)); // deterministic
    expect(hex(a)).not.toBe(hex(b));
  });
});

// ---- crypto/group --------------------------------------------------------------------

describe("crypto/group", () => {
  it("g has order exactly q: g^q == 1 and g != 1", () => {
    expect(modPow(G, Q, P)).toBe(1n);
    expect(G).not.toBe(1n);
  });

  it("rejects 0 and p as out-of-range elements, accepts 1 and p-1 as boundary", () => {
    expect(isElementInRange(0n)).toBe(false);
    expect(isElementInRange(P)).toBe(false);
    expect(isElementInRange(1n)).toBe(true);
    expect(isElementInRange(P - 1n)).toBe(true);
  });

  it("rejects a non-subgroup element even though it's in [1, p-1]", () => {
    // 11 は本 group の p に対して平方非剰余 (= 位数 2q の元) であることを確認済み
    // (この p では 5 は実は平方剰余だったため、issue の例をそのまま使わず 11 を使う)。
    const eleven = 11n;
    expect(isElementInRange(eleven)).toBe(true);
    expect(isSubgroupElement(eleven)).toBe(false);
    expect(modPow(eleven, Q, P)).toBe(P - 1n); // 位数 2q の証拠
  });

  it("accepts g itself and rejects out-of-range hex via tryParseSubgroupElement", () => {
    expect(tryParseSubgroupElement(bigintToHex(G))).toBe(G);
    expect(tryParseSubgroupElement(bigintToHex(11n))).toBeNull();
    expect(tryParseSubgroupElement("00")).toBeNull(); // 0 は範囲外
  });
});

// ---- crypto/feldman -------------------------------------------------------------------

describe("crypto/feldman", () => {
  const seeds = ["feldman-seed-a", "feldman-seed-b"];

  it.each(seeds)("share/verify roundtrip holds for every share (seed=%s)", (seed) => {
    const rng = createRng(seed);
    const secret = rng.nextScalar();
    const coefficients = [rng.nextScalar(), rng.nextScalar()]; // t=3
    const { shares, commitments } = shareSecret(secret, coefficients, DEFAULT_TOTAL_SHARES);
    expect(shares.length).toBe(DEFAULT_TOTAL_SHARES);
    expect(commitments.length).toBe(DEFAULT_THRESHOLD);
    for (const share of shares) {
      expect(verifyShare(share.i, share.value, commitments)).toBe(true);
    }
  });

  it("rejects a forged share (value + 1)", () => {
    const rng = createRng("feldman-forge-seed");
    const secret = rng.nextScalar();
    const coefficients = [rng.nextScalar(), rng.nextScalar()];
    const { shares, commitments } = shareSecret(secret, coefficients, DEFAULT_TOTAL_SHARES);
    const forged = mod(shares[0].value + 1n, Q);
    expect(verifyShare(shares[0].i, forged, commitments)).toBe(false);
  });

  it("rejects a share checked against the wrong index", () => {
    const rng = createRng("feldman-wrong-index-seed");
    const secret = rng.nextScalar();
    const coefficients = [rng.nextScalar(), rng.nextScalar()];
    const { shares, commitments } = shareSecret(secret, coefficients, DEFAULT_TOTAL_SHARES);
    // shares[0].value is f(1); verifying it as if it were f(2) must fail.
    expect(verifyShare(shares[1].i, shares[0].value, commitments)).toBe(false);
  });

  it("interpolates the secret back from any t of n shares", () => {
    const rng = createRng("feldman-interp-seed");
    const secret = rng.nextScalar();
    const coefficients = [rng.nextScalar(), rng.nextScalar()];
    const { shares } = shareSecret(secret, coefficients, DEFAULT_TOTAL_SHARES);

    const subsets = [
      [shares[0], shares[1], shares[2]],
      [shares[1], shares[2], shares[3]],
      [shares[0], shares[2], shares[4]],
    ];
    for (const subset of subsets) {
      expect(interpolateSecret(subset)).toBe(secret);
    }
  });

  it("t-1 shares do NOT determine the secret: two different secrets are both consistent", () => {
    // t-1 = 2 個の固定点。 secretA と secretB のどちらとも「(0,secret),(10,y1),(20,y2) を
    // 通る唯一の次数<=2多項式が存在する」という事実自体が、2点だけでは secret を
    // 一意に決められないことの構成的証明になる。 x=1 (10,20 以外) での値が secretA/B
    // 由来で必ず異なることまで確認する (差多項式が (x-10)(x-20) の定数倍になるため、
    // x=1 では確率的にではなく数学的に必ず非0になる)。
    function lagrangeAt(points: { x: bigint; y: bigint }[], atX: bigint): bigint {
      let result = 0n;
      for (let k = 0; k < points.length; k++) {
        let num = 1n;
        let den = 1n;
        for (let m = 0; m < points.length; m++) {
          if (m === k) continue;
          num = mod(num * mod(atX - points[m].x, Q), Q);
          den = mod(den * mod(points[k].x - points[m].x, Q), Q);
        }
        result = mod(result + points[k].y * num * modInv(den, Q), Q);
      }
      return result;
    }

    const y1 = 111n;
    const y2 = 222n;
    const fixed = [
      { x: 10n, y: y1 },
      { x: 20n, y: y2 },
    ];
    const secretA = 42n;
    const secretB = 4242n;
    expect(secretA).not.toBe(secretB);

    const pointsA = [{ x: 0n, y: secretA }, ...fixed];
    const pointsB = [{ x: 0n, y: secretB }, ...fixed];

    // 両方とも固定点をちゃんと通る (Lagrange 補間の定義上、常に成立)。
    expect(lagrangeAt(pointsA, 10n)).toBe(y1);
    expect(lagrangeAt(pointsA, 20n)).toBe(y2);
    expect(lagrangeAt(pointsB, 10n)).toBe(y1);
    expect(lagrangeAt(pointsB, 20n)).toBe(y2);

    // だが x=0 (secret) では異なり、他の x (=1) でも必ず異なる。
    expect(lagrangeAt(pointsA, 0n)).toBe(secretA);
    expect(lagrangeAt(pointsB, 0n)).toBe(secretB);
    expect(lagrangeAt(pointsA, 1n)).not.toBe(lagrangeAt(pointsB, 1n));
  });

  it("verifySecret / interpolateSecret compose: recovered secret matches g^secret == C_0", () => {
    const rng = createRng("feldman-compose-seed");
    const secret = rng.nextScalar();
    const coefficients = [rng.nextScalar(), rng.nextScalar()];
    const { shares, commitments } = shareSecret(secret, coefficients, DEFAULT_TOTAL_SHARES);
    const recovered = interpolateSecret([shares[0], shares[2], shares[4]]);
    expect(recovered).toBe(secret);
    expect(modPow(G, recovered, P)).toBe(commitments[0]);
  });
});

// ---- crypto/schnorr -------------------------------------------------------------------

describe("crypto/schnorr", () => {
  const baseContext: ProofContext = {
    purpose: "contract",
    teamId: "team-a",
    generation: 0,
    contractId: "contract-1",
  };

  function fixtureFor(seed: string): { secret: bigint; nonce: bigint; c0Hex: string } {
    const rng = createRng(seed);
    const secret = rng.nextScalar();
    const nonceRaw = rng.nextScalar();
    const nonce = nonceRaw === 0n ? 1n : nonceRaw;
    const c0Hex = bigintToHex(modPow(G, secret, P));
    return { secret, nonce, c0Hex };
  }

  const seeds = ["schnorr-seed-a", "schnorr-seed-b", "schnorr-seed-c"];

  it.each(seeds)("prove/verify roundtrip holds (seed=%s)", (seed) => {
    const { secret, nonce, c0Hex } = fixtureFor(seed);
    const proof = proveKnowledge(secret, nonce, baseContext);
    expect(verifyKnowledge(c0Hex, proof, baseContext)).toBe(true);
  });

  // 以降のテストは1つの proof を使い回す (2048-bit modPow のコストを抑えるため —
  // モジュールレベルで1回だけ作る)。
  const shared = fixtureFor("schnorr-shared-seed");
  const sharedProof = proveKnowledge(shared.secret, shared.nonce, baseContext);

  it("verifies the legitimate proof", () => {
    expect(verifyKnowledge(shared.c0Hex, sharedProof, baseContext)).toBe(true);
  });

  it("rejects a tampered commitment (R)", () => {
    const tampered = {
      ...sharedProof,
      commitment: bigintToHex(mod(BigInt(`0x${sharedProof.commitment}`) + 1n, P)),
    };
    expect(verifyKnowledge(shared.c0Hex, tampered, baseContext)).toBe(false);
  });

  it("rejects a tampered response (s)", () => {
    const tampered = {
      ...sharedProof,
      response: bigintToHex(mod(BigInt(`0x${sharedProof.response}`) + 1n, Q)),
    };
    expect(verifyKnowledge(shared.c0Hex, tampered, baseContext)).toBe(false);
  });

  it("rejects R outside the subgroup without throwing (adversarial boundary)", () => {
    // 11 は範囲内だが部分群外 (crypto/group テストで確認済み)。
    const forged = { ...sharedProof, commitment: bigintToHex(11n) };
    expect(() => verifyKnowledge(shared.c0Hex, forged, baseContext)).not.toThrow();
    expect(verifyKnowledge(shared.c0Hex, forged, baseContext)).toBe(false);
  });

  it("a proof for contract A does not verify against contract B (replay across contracts)", () => {
    const contextB: ProofContext = { ...baseContext, contractId: "contract-2" };
    expect(verifyKnowledge(shared.c0Hex, sharedProof, contextB)).toBe(false);
  });

  it("a proof made under team A's context does not verify under team B's context", () => {
    const contextTeamB: ProofContext = { ...baseContext, teamId: "team-b" };
    expect(verifyKnowledge(shared.c0Hex, sharedProof, contextTeamB)).toBe(false);
  });

  it("a proof for generation 0 fails verification under generation 1 (post-rotate context)", () => {
    const initContext: ProofContext = { purpose: "init", teamId: "team-a", generation: 0, contractId: "" };
    const proof = proveKnowledge(shared.secret, shared.nonce, initContext);
    const rotateContext: ProofContext = { ...initContext, purpose: "rotate", generation: 1 };
    expect(verifyKnowledge(shared.c0Hex, proof, rotateContext)).toBe(false);
  });

  it("nonce reuse across two different contexts leaks the secret (special soundness attack)", () => {
    // 同じ nonce を異なる context で使い回すと、2つの (e, s) から
    // x = (s1-s2) / (e1-e2) mod q で秘密が復元できてしまう — これは実装のバグではなく
    // Schnorr proof の数学的性質そのもの (special soundness)。 このテストは
    // 「なぜ proveKnowledge の nonce を context ごとに変えなければならないか」を
    // 実際に攻撃を実行して実演する (ac26-w3-nonce-reuse と同じ原理)。
    const attackSecret = createRng("schnorr-attack-secret").nextScalar();
    const attackNonceRaw = createRng("schnorr-attack-nonce").nextScalar();
    const attackNonce = attackNonceRaw === 0n ? 1n : attackNonceRaw;
    const c0 = modPow(G, attackSecret, P);
    const c0Hex = bigintToHex(c0);

    const contextX: ProofContext = {
      purpose: "contract",
      teamId: "victim",
      generation: 0,
      contractId: "contract-x",
    };
    const contextY: ProofContext = { ...contextX, contractId: "contract-y" };

    // 攻撃者から見て: victim が同じ nonce を使い回して2つの異なる contract の proof を
    // 提出してしまった、という想定。
    const proofX = proveKnowledge(attackSecret, attackNonce, contextX);
    const proofY = proveKnowledge(attackSecret, attackNonce, contextY);
    expect(verifyKnowledge(c0Hex, proofX, contextX)).toBe(true);
    expect(verifyKnowledge(c0Hex, proofY, contextY)).toBe(true);

    const r = BigInt(`0x${proofX.commitment}`);
    expect(proofY.commitment).toBe(bigintToHex(r)); // 同じ nonce -> 同じ R (公開情報から見て取れる)

    // 攻撃者は challengeScalar を自分でも計算できる (公開 API、秘密は要らない)。
    const eX = challengeScalar(POK_DOMAIN, buildContextParts(contextX, c0, r));
    const eY = challengeScalar(POK_DOMAIN, buildContextParts(contextY, c0, r));
    expect(eX).not.toBe(eY);

    const sX = BigInt(`0x${proofX.response}`);
    const sY = BigInt(`0x${proofY.response}`);
    const recoveredSecret = mod((sX - sY) * modInv(mod(eX - eY, Q), Q), Q);

    expect(recoveredSecret).toBe(attackSecret); // 本物の secret を復元できてしまった
    expect(modPow(G, recoveredSecret, P)).toBe(c0); // 復元した secret は C_0 を再現する (本物の攻撃)
  });
});

// ---- reducer: shared two-team fixture ------------------------------------------------

const MATCH_START = 1_000_000;
const base = buildTwoTeamState("team-a", "team-b", MATCH_START);
const TEAM_A = "team-a";
const TEAM_B = "team-b";

describe("reducer: happy path (init -> contracts -> leak x3 -> hunt)", () => {
  const leakAt = MATCH_START + 5_000;
  const expiresAt = MATCH_START + 60_000;
  const { state: withContracts, contractIds } = issueStandardLeakContracts(
    base.state,
    TEAM_A,
    [1, 2, 3],
    MATCH_START,
    expiresAt,
  );

  const leakValidations: boolean[] = [];
  let state = withContracts;
  for (let k = 0; k < contractIds.length; k++) {
    const shareIndex = k + 1;
    const op = leakOpFor(base.teamA, contractIds[k], shareIndex);
    leakValidations.push(validateOp(state, TEAM_A, op, leakAt).ok);
    state = applyOp(state, TEAM_A, op, leakAt);
  }

  it("setup: all three leak ops validate as ok", () => {
    expect(leakValidations).toEqual([true, true, true]);
  });

  it("fulfils all three contracts and pays out points", () => {
    for (const id of contractIds) {
      const contract = state.contracts.find((c) => c.id === id) as ContractSpec;
      expect(contract.status).toBe("fulfilled");
    }
    expect(state.teams[TEAM_A].score).toBeGreaterThan(0);
  });

  it("records a public ledger transcript with monotonic timestamps", () => {
    const leakEntries = state.publicLedger.filter((e) => e.kind === "leak");
    expect(leakEntries.length).toBe(3);
    expect(leakEntries.map((e) => e.shareIndex)).toEqual([1, 2, 3]);
    for (const entry of leakEntries) expect(entry.at).toBe(leakAt);
    expect(leakEntries.every((e) => e.teamId === TEAM_A)).toBe(true);
  });

  it("lets an opponent recover the secret via real Lagrange interpolation over the leaked shares", () => {
    const leakEntries = state.publicLedger.filter((e) => e.kind === "leak" && e.teamId === TEAM_A);
    const recoveredShares = leakEntries.map((entry) => {
      const value = tryHexToBigint(entry.shareValue as string);
      expect(value).not.toBeNull();
      return { i: entry.shareIndex as number, value: value as bigint };
    });
    const recovered = interpolateSecret(recoveredShares);
    expect(recovered).toBe(base.teamA.secret); // 本物の暗号復元 (mock ではない)

    const huntAt = leakAt + 1_000;
    const huntOp = huntOpFor(TEAM_A, 0, recovered);
    const validation = validateOp(state, TEAM_B, huntOp, huntAt);
    expect(validation.ok).toBe(true);
    const afterHunt = applyOp(state, TEAM_B, huntOp, huntAt);

    expect(afterHunt.teams[TEAM_B].score).toBe(HUNT_BONUS_POINTS);
    const huntEntry = afterHunt.publicLedger.find((e) => e.kind === "hunt-success");
    expect(huntEntry).toBeDefined();
    expect(huntEntry?.targetTeamId).toBe(TEAM_A);
    expect(huntEntry?.generation).toBe(0);
    // 復元した secret の値そのものは ledger に載らない。
    expect(JSON.stringify(huntEntry)).not.toContain(bigintToHex(recovered));
  });
});

// ---- reducer: adversarial paths -------------------------------------------------------

describe("reducer: adversarial inputs never throw and return explicit error codes", () => {
  it("unknown_team: op from a team not in the match", () => {
    const validation = validateOp(base.state, "team-z", { type: "skip", contractId: "x" }, MATCH_START);
    expect(validation).toEqual({ ok: false, error: "unknown_team" });
  });

  it("already_initialized: init twice", () => {
    const validation = validateOp(base.state, TEAM_A, initOpFor(base.teamA), MATCH_START);
    expect(validation).toEqual({ ok: false, error: "already_initialized" });
  });

  it("not_initialized: leak/skip/rotate before init", () => {
    const fresh = initialState([TEAM_A], MATCH_START);
    expect(validateOp(fresh, TEAM_A, { type: "skip", contractId: "x" }, MATCH_START)).toEqual({
      ok: false,
      error: "not_initialized",
    });
    expect(validateOp(fresh, TEAM_A, rotateOpFor(base.teamA, 1), MATCH_START)).toEqual({
      ok: false,
      error: "not_initialized",
    });
  });

  it("invalid_commitments: wrong length, malformed hex, oversized string, non-subgroup element", () => {
    const fresh = initialState([TEAM_A], MATCH_START);
    expect(validateOp(fresh, TEAM_A, { type: "init", commitments: ["ab", "cd"] }, MATCH_START)).toEqual({
      ok: false,
      error: "invalid_commitments",
    });
    expect(
      validateOp(fresh, TEAM_A, { type: "init", commitments: ["not-hex", "ab", "cd"] }, MATCH_START),
    ).toEqual({ ok: false, error: "invalid_commitments" });
    expect(
      validateOp(
        fresh,
        TEAM_A,
        { type: "init", commitments: ["a".repeat(5000), "ab", "cd"] },
        MATCH_START,
      ),
    ).toEqual({ ok: false, error: "invalid_commitments" });
    // 11 は範囲内だが部分群外 (crypto/group テストで確認済み)。
    expect(
      validateOp(
        fresh,
        TEAM_A,
        { type: "init", commitments: [bigintToHex(11n), bigintToHex(G), bigintToHex(G)] },
        MATCH_START,
      ),
    ).toEqual({ ok: false, error: "invalid_commitments" });
  });

  it("unknown_contract / not_your_contract", () => {
    expect(
      validateOp(base.state, TEAM_A, { type: "skip", contractId: "does-not-exist" }, MATCH_START),
    ).toEqual({ ok: false, error: "unknown_contract" });

    const { state } = issueStandardLeakContracts(base.state, TEAM_A, [1], MATCH_START, MATCH_START + 60_000);
    const contractId = `${TEAM_A}-leak-1-${MATCH_START}`;
    expect(validateOp(state, TEAM_B, { type: "skip", contractId }, MATCH_START)).toEqual({
      ok: false,
      error: "not_your_contract",
    });
  });

  it("wrong_contract_kind: leak op against a prove-knowledge contract", () => {
    const spec: ContractSpec = {
      id: "prove-1",
      teamId: TEAM_A,
      kind: "prove-knowledge",
      points: 10,
      issuedAtMs: MATCH_START,
      expiresAtMs: MATCH_START + 60_000,
      status: "open",
    };
    const state = issueContract(base.state, spec);
    const op: CryptoBattleOp = { type: "leak", contractId: "prove-1", shareIndex: 1, shareValue: "01" };
    expect(validateOp(state, TEAM_A, op, MATCH_START)).toEqual({ ok: false, error: "wrong_contract_kind" });
  });

  it("contract_not_open: leaking an already-fulfilled contract again", () => {
    const expiresAt = MATCH_START + 60_000;
    const { state: withContract, contractIds } = issueStandardLeakContracts(
      base.state,
      TEAM_A,
      [1],
      MATCH_START,
      expiresAt,
    );
    const op = leakOpFor(base.teamA, contractIds[0], 1);
    const fulfilled = applyOp(withContract, TEAM_A, op, MATCH_START + 1_000);
    expect(validateOp(fulfilled, TEAM_A, op, MATCH_START + 2_000)).toEqual({
      ok: false,
      error: "contract_not_open",
    });
  });

  it("contract_expired: past expiresAtMs while still marked open, and after expireContracts()", () => {
    const expiresAt = MATCH_START + 1_000;
    const { state: withContract, contractIds } = issueStandardLeakContracts(
      base.state,
      TEAM_A,
      [1],
      MATCH_START,
      expiresAt,
    );
    const op = leakOpFor(base.teamA, contractIds[0], 1);
    // まだ status="open" のまま、時刻だけが期限を過ぎているケース。
    expect(validateOp(withContract, TEAM_A, op, expiresAt + 1)).toEqual({
      ok: false,
      error: "contract_expired",
    });
    // expireContracts() で status="expired" に遷移させた後のケース。
    const expired = expireContracts(withContract, expiresAt + 1);
    expect(expired.contracts[0].status).toBe("expired");
    expect(validateOp(expired, TEAM_A, op, expiresAt + 1)).toEqual({
      ok: false,
      error: "contract_expired",
    });
  });

  it("share_index_out_of_range: out of [1,n] and mismatched vs contract's required index", () => {
    const expiresAt = MATCH_START + 60_000;
    const { state, contractIds } = issueStandardLeakContracts(base.state, TEAM_A, [2], MATCH_START, expiresAt);
    const contractId = contractIds[0];
    expect(
      validateOp(state, TEAM_A, { type: "leak", contractId, shareIndex: 99, shareValue: "01" }, MATCH_START),
    ).toEqual({ ok: false, error: "share_index_out_of_range" });
    expect(
      validateOp(state, TEAM_A, { type: "leak", contractId, shareIndex: 0, shareValue: "01" }, MATCH_START),
    ).toEqual({ ok: false, error: "share_index_out_of_range" });
    // contract は index=2 を要求しているが、index=3 の (本物の) share を送る。
    const wrongIndexOp = leakOpFor(base.teamA, contractId, 3);
    expect(
      validateOp(state, TEAM_A, { ...wrongIndexOp, contractId }, MATCH_START),
    ).toEqual({ ok: false, error: "share_index_out_of_range" });
  });

  it("invalid_share: forged value, malformed hex, oversized string never throw", () => {
    const expiresAt = MATCH_START + 60_000;
    const { state, contractIds } = issueStandardLeakContracts(base.state, TEAM_A, [1], MATCH_START, expiresAt);
    const contractId = contractIds[0];
    const real = leakOpFor(base.teamA, contractId, 1);
    const forgedValue = tryHexToBigint(real.shareValue);
    expect(forgedValue).not.toBeNull();
    const forged: CryptoBattleOp = {
      ...real,
      shareValue: bigintToHex(mod((forgedValue as bigint) + 1n, Q)),
    };
    expect(validateOp(state, TEAM_A, forged, MATCH_START)).toEqual({ ok: false, error: "invalid_share" });

    expect(() =>
      validateOp(state, TEAM_A, { ...real, shareValue: "not-hex" }, MATCH_START),
    ).not.toThrow();
    expect(validateOp(state, TEAM_A, { ...real, shareValue: "not-hex" }, MATCH_START)).toEqual({
      ok: false,
      error: "invalid_share",
    });
    expect(() =>
      applyOp(state, TEAM_A, { ...real, shareValue: "f".repeat(5000) }, MATCH_START),
    ).not.toThrow();
    expect(
      validateOp(state, TEAM_A, { ...real, shareValue: "f".repeat(5000) }, MATCH_START),
    ).toEqual({ ok: false, error: "invalid_share" });
  });

  it("cannot_hunt_self", () => {
    expect(validateOp(base.state, TEAM_A, huntOpFor(TEAM_A, 0, 1n), MATCH_START)).toEqual({
      ok: false,
      error: "cannot_hunt_self",
    });
  });

  it("hunt_already_claimed: replaying a successful hunt is idempotent", () => {
    const expiresAt = MATCH_START + 60_000;
    const { state: withContracts, contractIds } = issueStandardLeakContracts(
      base.state,
      TEAM_A,
      [1, 2, 3],
      MATCH_START,
      expiresAt,
    );
    let state = withContracts;
    for (let k = 0; k < contractIds.length; k++) {
      state = applyOp(state, TEAM_A, leakOpFor(base.teamA, contractIds[k], k + 1), MATCH_START + 1_000);
    }
    const huntOp = huntOpFor(TEAM_A, 0, base.teamA.secret);
    const afterFirst = applyOp(state, TEAM_B, huntOp, MATCH_START + 2_000);
    expect(afterFirst.teams[TEAM_B].score).toBe(HUNT_BONUS_POINTS);
    expect(validateOp(afterFirst, TEAM_B, huntOp, MATCH_START + 3_000)).toEqual({
      ok: false,
      error: "hunt_already_claimed",
    });
    const afterReplay = applyOp(afterFirst, TEAM_B, huntOp, MATCH_START + 3_000);
    expect(afterReplay.teams[TEAM_B].score).toBe(HUNT_BONUS_POINTS); // no double payout
  });

  it("wrong_generation: nonexistent / negative / non-integer generation", () => {
    expect(validateOp(base.state, TEAM_B, huntOpFor(TEAM_A, 5, 1n), MATCH_START)).toEqual({
      ok: false,
      error: "wrong_generation",
    });
    expect(validateOp(base.state, TEAM_B, huntOpFor(TEAM_A, -1, 1n), MATCH_START)).toEqual({
      ok: false,
      error: "wrong_generation",
    });
    const nonInteger: CryptoBattleOp = { type: "hunt", targetTeamId: TEAM_A, generation: 1.5, secret: "01" };
    expect(validateOp(base.state, TEAM_B, nonInteger, MATCH_START)).toEqual({
      ok: false,
      error: "wrong_generation",
    });
  });

  it("invalid_secret: wrong value and malformed hex never throw", () => {
    expect(validateOp(base.state, TEAM_B, huntOpFor(TEAM_A, 0, base.teamA.secret + 1n), MATCH_START)).toEqual(
      { ok: false, error: "invalid_secret" },
    );
    const malformed: CryptoBattleOp = {
      type: "hunt",
      targetTeamId: TEAM_A,
      generation: 0,
      secret: "not-hex",
    };
    expect(() => validateOp(base.state, TEAM_B, malformed, MATCH_START)).not.toThrow();
    expect(validateOp(base.state, TEAM_B, malformed, MATCH_START)).toEqual({
      ok: false,
      error: "invalid_secret",
    });
  });

  it("rotate_cooldown: rotating immediately after init is rejected", () => {
    expect(validateOp(base.state, TEAM_A, rotateOpFor(base.teamA, 1), MATCH_START + 1)).toEqual({
      ok: false,
      error: "rotate_cooldown",
    });
    expect(
      validateOp(base.state, TEAM_A, rotateOpFor(base.teamA, 1), MATCH_START + ROTATE_COOLDOWN_MS),
    ).toEqual({ ok: true });
  });

  it("unknown_op_type: a runtime type field outside the closed union is rejected, not thrown", () => {
    const bogus = { type: "bogus" } as unknown as CryptoBattleOp;
    expect(() => validateOp(base.state, TEAM_A, bogus, MATCH_START)).not.toThrow();
    expect(validateOp(base.state, TEAM_A, bogus, MATCH_START)).toEqual({
      ok: false,
      error: "unknown_op_type",
    });
    expect(() => applyOp(base.state, TEAM_A, bogus, MATCH_START)).not.toThrow();
  });

  it("unknown_op_type: null / non-object / type-less ops are rejected, not thrown", () => {
    // dispatcher からの op は実行時には生 JSON — 型システムを経由しない値も想定する。
    const malformed = [null, 42, "leak", [], {}, { type: 7 }] as unknown as CryptoBattleOp[];
    for (const op of malformed) {
      expect(() => validateOp(base.state, TEAM_A, op, MATCH_START)).not.toThrow();
      expect(validateOp(base.state, TEAM_A, op, MATCH_START)).toEqual({
        ok: false,
        error: "unknown_op_type",
      });
      expect(applyOp(base.state, TEAM_A, op, MATCH_START)).toBe(base.state);
    }
  });

  it("applyOp never mutates state and is a no-op on an invalid op", () => {
    const before = JSON.stringify(base.state);
    const result = applyOp(base.state, TEAM_A, { type: "skip", contractId: "nope" }, MATCH_START);
    expect(JSON.stringify(base.state)).toBe(before); // 元の state は不変
    expect(result).toBe(base.state); // no-op: 同じ参照を返す
  });
});

// ---- reducer: rotate path --------------------------------------------------------------

describe("reducer: rotate invalidates the old generation for hunting", () => {
  const teamAGen0 = buildTeamFixture(TEAM_A, "rotate-gen0-seed");
  const teamAGen1 = buildTeamFixture(TEAM_A, "rotate-gen1-seed");

  it("sanity: gen0 and gen1 fixtures carry different secrets", () => {
    // g の位数が素数 q なので secret -> g^secret は単射 — secret が異なれば
    // C_0 も必ず異なる (確率的にではなく)。後続テストはこの前提に依存する。
    expect(teamAGen0.secret).not.toBe(teamAGen1.secret);
  });

  let state = initialState([TEAM_A, TEAM_B], MATCH_START);
  state = applyOp(state, TEAM_A, initOpFor(teamAGen0), MATCH_START);
  state = applyOp(state, TEAM_B, initOpFor(buildTeamFixture(TEAM_B, "rotate-teamb-seed")), MATCH_START);

  const expiresAt = MATCH_START + 60_000;
  const { state: withContracts, contractIds } = issueStandardLeakContracts(
    state,
    TEAM_A,
    [1, 2, 3],
    MATCH_START,
    expiresAt,
  );
  let afterLeaks = withContracts;
  for (let k = 0; k < contractIds.length; k++) {
    afterLeaks = applyOp(
      afterLeaks,
      TEAM_A,
      leakOpFor(teamAGen0, contractIds[k], k + 1),
      MATCH_START + 1_000,
    );
  }

  const rotateAt = MATCH_START + ROTATE_COOLDOWN_MS + 1;
  const afterRotate = applyOp(afterLeaks, TEAM_A, rotateOpFor(teamAGen1, 1), rotateAt);

  it("rotate advances currentGeneration and appends a new commitment set", () => {
    expect(afterRotate.teams[TEAM_A].currentGeneration).toBe(1);
    expect(afterRotate.teams[TEAM_A].generations.length).toBe(2);
    const rotateEntry = afterRotate.publicLedger.find((e) => e.kind === "rotate");
    expect(rotateEntry?.generation).toBe(1);
  });

  it("hunting the rotated-away generation 0 secret returns stale_generation and pays nothing", () => {
    const recoveredGen0 = interpolateSecret(teamAGen0.shares.slice(0, 3));
    expect(recoveredGen0).toBe(teamAGen0.secret);
    const huntOp = huntOpFor(TEAM_A, 0, recoveredGen0);
    expect(validateOp(afterRotate, TEAM_B, huntOp, rotateAt + 1_000)).toEqual({
      ok: false,
      error: "stale_generation",
    });
    const result = applyOp(afterRotate, TEAM_B, huntOp, rotateAt + 1_000);
    expect(result.teams[TEAM_B].score).toBe(0);
  });

  it("hunting the current generation 1 with the old generation-0 secret fails invalid_secret", () => {
    const huntOp = huntOpFor(TEAM_A, 1, teamAGen0.secret);
    expect(validateOp(afterRotate, TEAM_B, huntOp, rotateAt + 1_000)).toEqual({
      ok: false,
      error: "invalid_secret",
    });
  });

  it("hunting the current generation 1 with its real secret succeeds", () => {
    const huntOp = huntOpFor(TEAM_A, 1, teamAGen1.secret);
    expect(validateOp(afterRotate, TEAM_B, huntOp, rotateAt + 1_000)).toEqual({ ok: true });
  });
});

// ---- reducer: prove path ---------------------------------------------------------------

describe("reducer: prove path (Schnorr proof of knowledge fulfils prove-knowledge contracts)", () => {
  const proveAt = MATCH_START + 5_000;
  const expiresAt = MATCH_START + 60_000;
  const { state: withContract, contractId } = issueProveContract(base.state, TEAM_A, MATCH_START, expiresAt);
  const proveOp = proveOpFor(base.teamA, contractId, 0);

  it("happy path: a valid Schnorr proof fulfils the contract and pays out points", () => {
    expect(validateOp(withContract, TEAM_A, proveOp, proveAt)).toEqual({ ok: true });
    const afterProve = applyOp(withContract, TEAM_A, proveOp, proveAt);
    const contract = afterProve.contracts.find((c) => c.id === contractId) as ContractSpec;
    expect(contract.status).toBe("fulfilled");
    expect(afterProve.teams[TEAM_A].score).toBe(CONTRACT_SUCCESS_POINTS);

    const ledgerEntry = afterProve.publicLedger.find((e) => e.kind === "prove");
    expect(ledgerEntry).toBeDefined();
    expect(ledgerEntry?.contractId).toBe(contractId);
    expect(ledgerEntry?.generation).toBe(0);
    expect(ledgerEntry?.points).toBe(CONTRACT_SUCCESS_POINTS);
    // ledger entry には proof の中身 (R, s) も secret も一切含まれない (leak 専用フィールド)。
    expect(ledgerEntry).not.toHaveProperty("shareValue");
    expect(ledgerEntry).not.toHaveProperty("shareIndex");
  });

  it("invalid_proof: a forged response is rejected", () => {
    const forged = {
      ...proveOp,
      response: bigintToHex(mod(BigInt(`0x${proveOp.response}`) + 1n, Q)),
    };
    expect(validateOp(withContract, TEAM_A, forged, proveAt)).toEqual({
      ok: false,
      error: "invalid_proof",
    });
  });

  it("invalid_proof: malformed hex never throws", () => {
    const malformed = { ...proveOp, commitment: "not-hex" };
    expect(() => validateOp(withContract, TEAM_A, malformed, proveAt)).not.toThrow();
    expect(validateOp(withContract, TEAM_A, malformed, proveAt)).toEqual({
      ok: false,
      error: "invalid_proof",
    });
  });

  it("replaying the same proof against a second prove-knowledge contract fails (contractId is bound into the challenge)", () => {
    // issuedAtMs をずらして、元の contractId (`${TEAM_A}-prove-${MATCH_START}`) と
    // 衝突しない別 contract を作る。
    const { state: withSecondContract, contractId: secondContractId } = issueProveContract(
      withContract,
      TEAM_A,
      MATCH_START + 1,
      expiresAt,
    );
    expect(secondContractId).not.toBe(contractId);
    const replay: CryptoBattleOp = { ...proveOp, contractId: secondContractId };
    expect(validateOp(withSecondContract, TEAM_A, replay, proveAt)).toEqual({
      ok: false,
      error: "invalid_proof",
    });
  });

  it("wrong_contract_kind: a prove op against a leak-share contract is rejected", () => {
    const { state: withLeakContract, contractIds } = issueStandardLeakContracts(
      base.state,
      TEAM_A,
      [1],
      MATCH_START,
      expiresAt,
    );
    const op: CryptoBattleOp = {
      type: "prove",
      contractId: contractIds[0],
      commitment: proveOp.commitment,
      response: proveOp.response,
    };
    expect(validateOp(withLeakContract, TEAM_A, op, proveAt)).toEqual({
      ok: false,
      error: "wrong_contract_kind",
    });
  });

  it("contract_expired: proving after the deadline is rejected", () => {
    const shortExpiry = MATCH_START + 1_000;
    const { state: withShortContract, contractId: shortContractId } = issueProveContract(
      base.state,
      TEAM_A,
      MATCH_START,
      shortExpiry,
    );
    const shortOp = proveOpFor(base.teamA, shortContractId, 0);
    expect(validateOp(withShortContract, TEAM_A, shortOp, shortExpiry + 1)).toEqual({
      ok: false,
      error: "contract_expired",
    });
  });
});

// ---- reducer: init/rotate commitment cloning -------------------------------------------

describe("reducer: init/rotate proof of knowledge blocks commitment cloning", () => {
  it("team B replaying team A's init op (commitments + proof) verbatim fails: context binds teamId into the challenge", () => {
    const teamA = buildTeamFixture("clone-team-a", "clone-seed-a");
    const initOpA = initOpFor(teamA);
    const freshState = initialState(["clone-team-a", "clone-team-b"], MATCH_START);
    // team B は自分の commitments を作らず、team A の (commitments, proof) をそのまま
    // 提出する — proof の challenge は teamId を束縛しているので、送信元が変わると
    // 同じ (R,s) では通らない。
    expect(validateOp(freshState, "clone-team-b", initOpA, MATCH_START)).toEqual({
      ok: false,
      error: "invalid_proof",
    });
  });

  it("team B cannot forge its own proof for team A's commitments without team A's secret", () => {
    const teamA = buildTeamFixture("clone2-team-a", "clone2-seed-a");
    // team B は team A の commitments (公開情報) は知っているが secret は知らない —
    // 「自分の (間違った) secret」でしか proof を作れない、という状況をモデル化する。
    const wrongSecret = createRng("clone2-wrong-secret").nextScalar();
    const nonceRaw = createRng("clone2-wrong-nonce").nextScalar();
    const nonce = nonceRaw === 0n ? 1n : nonceRaw;
    const context: ProofContext = {
      purpose: "init",
      teamId: "clone2-team-b",
      generation: 0,
      contractId: "",
    };
    const forgedProof = proveKnowledge(wrongSecret, nonce, context);
    const op: CryptoBattleOp = {
      type: "init",
      commitments: teamA.commitments.map(bigintToHex),
      proofCommitment: forgedProof.commitment,
      proofResponse: forgedProof.response,
    };
    const freshState = initialState(["clone2-team-a", "clone2-team-b"], MATCH_START);
    expect(validateOp(freshState, "clone2-team-b", op, MATCH_START)).toEqual({
      ok: false,
      error: "invalid_proof",
    });
  });

  it("rotate is symmetrically protected: team B cannot rotate into team A's commitments + proof either", () => {
    const teamA = buildTeamFixture("clone3-team-a", "clone3-seed-a");
    const teamB = buildTeamFixture("clone3-team-b", "clone3-seed-b");
    let state = initialState(["clone3-team-a", "clone3-team-b"], MATCH_START);
    state = applyOp(state, "clone3-team-a", initOpFor(teamA), MATCH_START);
    state = applyOp(state, "clone3-team-b", initOpFor(teamB), MATCH_START);

    const rotateAt = MATCH_START + ROTATE_COOLDOWN_MS + 1;
    const rotateOpA = rotateOpFor(teamA, 1); // team A 自身の real proof (generation=1 向け)
    // team B が team A の commitments + proof をそのまま自分の rotate として提出する。
    expect(validateOp(state, "clone3-team-b", rotateOpA, rotateAt)).toEqual({
      ok: false,
      error: "invalid_proof",
    });
  });
});

// ---- projection: privacy ---------------------------------------------------------------

describe("projection: no unleaked share value or other team's contract queue leaks out", () => {
  const expiresAt = MATCH_START + 60_000;
  const { state: withContracts, contractIds } = issueStandardLeakContracts(
    base.state,
    TEAM_A,
    [1],
    MATCH_START,
    expiresAt,
  );
  const afterLeak = applyOp(
    withContracts,
    TEAM_A,
    leakOpFor(base.teamA, contractIds[0], 1),
    MATCH_START + 1_000,
  );

  it("teamB's projection contains the leaked share value but none of teamA's unleaked share values", () => {
    const projection = projectForTeam(afterLeak, TEAM_B);
    const json = JSON.stringify(projection);
    const leakedHex = bigintToHex(base.teamA.shares[0].value); // index 1, leaked
    expect(json).toContain(leakedHex);
    for (const share of base.teamA.shares.slice(1)) {
      expect(json).not.toContain(bigintToHex(share.value));
    }
    expect(json).not.toContain(bigintToHex(base.teamA.secret));
  });

  it("teamB's projection does not include teamA's contract queue", () => {
    const projection = projectForTeam(afterLeak, TEAM_B);
    expect(projection.ownContracts.every((c) => c.teamId === TEAM_B)).toBe(true);
    expect(projection.ownContracts.length).toBe(0);
  });

  it("teamA's own vault shows the leaked index as risk, not the value", () => {
    const projection = projectForTeam(afterLeak, TEAM_A);
    expect(projection.ownVault?.generations[0].leakedShareIndexes).toEqual([1]);
    expect(JSON.stringify(projection.ownVault)).not.toContain(bigintToHex(base.teamA.shares[0].value));
  });

  it("scoreboard exposes every team's score", () => {
    const projection = projectForTeam(afterLeak, TEAM_B);
    const teamAEntry = projection.scoreboard.find((s) => s.teamId === TEAM_A);
    expect(teamAEntry?.score).toBe(afterLeak.teams[TEAM_A].score);
  });

  it("a 'prove' ledger entry carries no proof material and no secret (zero-knowledge, and nothing worth publishing)", () => {
    const proveExpiresAt = MATCH_START + 60_000;
    const { state: withProveContract, contractId } = issueProveContract(
      base.state,
      TEAM_A,
      MATCH_START,
      proveExpiresAt,
    );
    const proveOp = proveOpFor(base.teamA, contractId, 0);
    const afterProve = applyOp(withProveContract, TEAM_A, proveOp, MATCH_START + 1_000);
    const projection = projectForTeam(afterProve, TEAM_B);
    const json = JSON.stringify(projection);
    expect(json).not.toContain(proveOp.commitment);
    expect(json).not.toContain(proveOp.response);
    expect(json).not.toContain(bigintToHex(base.teamA.secret));

    const ledgerEntry = projection.publicLedger.find((e) => e.kind === "prove");
    expect(ledgerEntry).toBeDefined();
    // contractId/generation/points/at/teamId/kind 以外のフィールドは載らない
    // (shareIndex/shareValue/targetTeamId は leak/hunt 専用)。
    expect(Object.keys(ledgerEntry as object).sort()).toEqual(
      ["at", "contractId", "generation", "kind", "points", "teamId"].sort(),
    );
  });
});

// ---- determinism -------------------------------------------------------------------------

describe("determinism: same seed always yields the same state", () => {
  it("buildTeamFixture is deterministic across calls", () => {
    const a1 = buildTeamFixture("x", "same-seed");
    const a2 = buildTeamFixture("x", "same-seed");
    expect(a1.secret).toBe(a2.secret);
    expect(a1.coefficients).toEqual(a2.coefficients);
    expect(a1.shares).toEqual(a2.shares);
    expect(a1.commitments).toEqual(a2.commitments);
  });

  it("two independently-built two-team states with the same seeds and op sequence are deep-equal", () => {
    const run1 = buildTwoTeamState("d-a", "d-b", MATCH_START, "seed-1", "seed-2");
    const run2 = buildTwoTeamState("d-a", "d-b", MATCH_START, "seed-1", "seed-2");
    expect(run1.state).toEqual(run2.state);

    const { state: c1, contractIds: ids1 } = issueStandardLeakContracts(
      run1.state,
      "d-a",
      [1, 2],
      MATCH_START,
      MATCH_START + 60_000,
    );
    const { state: c2, contractIds: ids2 } = issueStandardLeakContracts(
      run2.state,
      "d-a",
      [1, 2],
      MATCH_START,
      MATCH_START + 60_000,
    );
    expect(ids1).toEqual(ids2);
    const s1 = applyOp(c1, "d-a", leakOpFor(run1.teamA, ids1[0], 1), MATCH_START + 500);
    const s2 = applyOp(c2, "d-a", leakOpFor(run2.teamA, ids2[0], 1), MATCH_START + 500);
    expect(s1).toEqual(s2);
  });
});
