"""JA: 秘密を扱うプログラムの記録を監査します。編集するのはこのファイルです。

Use supplied objects only within the current call, through the documented public API.
Do not retain them for another call or access private share/runtime state.
EN: Audit the records of programs using secret inputs. Edit this file only.

最初: 「証拠を確認」→ classify に print(entry) →「公開テストを実行」。
First: Inspect evidence → add print(entry) in classify → Run public tests.

無料の問題文に全分類規則・API・復元式があります。各提出は同じファイルを採点します。
All classification rules, APIs and recovery formulas are free in the statement.
Each checkpoint grades this same file. Public tests check shapes, not secret answers.

Sharing = one secret's shares, one per party. Share ids are not their numeric values.
MPC = joint computation with private inputs. This co-SNARK exercise models records,
not an actual SNARK proof or cryptographic security. Never read specimen source or _value.

probe(id) returns evidence; probe(id, malformed_row(evidence.row)) tests a failure path.
Evidence: runtime, row, setting, disclosure, raised.
runtime.reached(): sequence of {capability, party, operands}; party is share owner.
runtime.openings(): sequence of {roundId, shareIds, maskedBy}; ids, never values.
Disclosure: artifact/metrics dictionaries, log records, error record or None.
log record: {event, values}; error: {message, values}. Audit values, not heading prose.
"""
from __future__ import annotations

from participant.lab import malformed_row, serialized
from participant.mpc import (
    ALLOWED_NAMES, AUDIENCES, FORMS, ORIGINS, PROTOCOL_CAPABILITIES,
    SHARING_ONLY_NAMES, beaver_product, clean_artifact, is_sharing, round_id_for,
)


def classify(entry: dict, row: dict) -> str:
    """JA: 値を6分類へ。語彙外と不正なopenedの形はValueError。
    EN: Return one class; reject unknown vocabulary or malformed opened shape.

    Check origin/form/audience against ORIGINS/FORMS/AUDIENCES first.
    opened must be None or a dict. An authorized opened dict has nonempty
    maskedBy AND roundId == round_id_for(row).
    Priority: verifier audience → verifier-only; authorized opening → allowed-open;
    relation origin OR metadata form → public-input; share form → secret-share;
    sharing form AND participant audience → participant-artifact;
    otherwise → secret-intermediate.
    Example: witness/element, opened=None, audience=party → secret-intermediate.
    """
    return ""


def capability_audit(probe, specimen_id: str) -> tuple[str, ...]:
    """JA: 正常行・壊れた行の両実行で、支給計算以外の操作を全件報告。
    EN: Probe a normal row and malformed_row(normal.row), union all reached names,
    remove PROTOCOL_CAPABILITIES, deduplicate, sort and return a tuple.
    Example reached open,peek,peek → ("peek",). Inspect record["capability"].
    """
    return ()


def open_set_audit(evidence) -> tuple[dict, ...]:
    """JA: 許可されない開示を元の順番で全部返します。
    EN: Return every unauthorized opening in original order.
    Authorized = nonempty maskedBy AND roundId == round_id_for(evidence.row).
    Output each record as {roundId, shareIds: tuple, masked: bool}.
    Example allowed round r:mul with maskedBy=[] is unauthorized, masked=False.
    No violations → (). A mask alone or the correct round alone is insufficient.
    """
    return ()


def cross_party_audit(evidence) -> dict:
    """JA: peek回数、持ち主番号の種類、2種類以上かを報告します。
    EN: Count peek records, then sort distinct owner party IDs.
    Return {peeks: count, parties: tuple, crossed: len(parties)>1}.
    Owners 1,0,0 → {peeks:3, parties:(0,1), crossed:True}.
    False only means this owner-count check did not establish a crossing.
    """
    return {}


def leakage_audit(evidence) -> tuple[tuple[str, str], ...]:
    """JA: 4出口の名前と形を調べ、違反(出口,項目名)を全件返します。
    EN: Check artifact, log.values, metrics and error.values when error exists.
    Violation: name outside ALLOWED_NAMES OR a SHARING_ONLY_NAMES value that
    fails is_sharing(value,evidence.setting["parties"]). Deduplicate and sort pairs.
    Example integer artifact C → (("artifact","C"),). No violations → ().
    """
    return ()


def leakage_evidence(disclosure, setting) -> dict | None:
    """JA: 外へ出た内容だけから最初に復元できる秘密と取得元を返します。
    EN: Input remains a Disclosure object with .artifact/.log/.metrics/.error.
    Only sharing entries are serialized into opaque string-id sequences.
    Visit artifact, log records' values, metrics, error.values in that order,
    keeping dictionary field order. Only consider policy violations.
    Serialized A/B/C are allowed only as nonempty lists/tuples of string ids.

    Check these derivations in order, using p=setting["p"]:
    nonempty integer list/tuple → sum(value) % p;
    integer with integer d in the SAME record → (value+d) % p;
    same record means artifact/metrics dict, or each log/error values dict;
    integer without d → value % p. Booleans are not integers for this policy.
    p=7: [2,4,3] → 2; mask 5 with d=5 → 3; integer 3 alone → 3.
    Ignore strings and id sequences. Return {value: recovered, from:(channel,name)}
    for the first recoverable violation; otherwise None. Do not call the runtime.
    """
    return None


def private_prover(runtime, row: dict, halves: dict, triple, sink) -> dict:
    """JA: 支給計算のproofと、それと一致するartifactを公開して返します。
    EN: Compute once with beaver_product(runtime,row,halves,triple).
    Build clean_artifact(row,proof), publish it with sink.publish, and return proof.
    proof keys: A,B,C,d,e,tripleId,roundId. Artifact keys:
    relationId,fieldId,parties,A,B,C,tripleId,roundId.
    Return and artifact must describe the same current inputs/product and IDs.
    A/B/C remain sharings. C recovers to A*B. Only the two authorized d/e openings,
    in one round; no reconstruct or peek. Optional logs must satisfy the policy.
    A spent triple must propagate TripleMisuse with all four channels still empty.

    transfer adds no function: these audits face multiple combined defects on
    normal AND malformed inputs, under changed IDs, field, party count and rows.
    Return every promised finding, not just the first (except leakage_evidence).
    """
    return {}
