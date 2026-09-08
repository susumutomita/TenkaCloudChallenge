"""JA: このファイルだけを編集。証拠を確認 → encoding → 公開テスト → 提出。
EN: Edit this file only. Inspect evidence → encoding → public tests → submit.

目的: 公開の主張と秘密の入力を分け、出力をその対象へ結び付ける。
Goal: separate public claims and private inputs, then bind output to its target.

実際のzkVM証明は生成・検証しません。receiptはこの模型ではjournalだけの辞書です。
No real zkVM proof is made or verified. A model receipt is only a journal dictionary.
必要な全規則・型・小例は無料の問題本文にあります。下のimportはそのまま使えます。
Every required rule, type and worked example is free in the statement. Imports are supplied.
"""
from __future__ import annotations

from participant.lab import (
    BYTE_ORDER, CLAIMS, DIGEST_HEX_LENGTH, DOMAINS, GUARDS, GUEST_VERSIONS,
    IMAGE_COMMITMENT_DOMAIN, INTEGER_BYTES, JOURNAL_FIELDS, LENGTH_PREFIX_BYTES,
    MEASUREMENT_NAMES, PARAM_NAMES, PUBLIC_NAMES, RECEIPT_FIELDS, RUN_FIELDS,
    SEMANTICS, STATEMENT_COMMITMENT_DOMAIN, STATEMENT_FIELDS, WRAP_SITE_OF,
    claim_site, commit, decode_program, is_well_formed,
)


def encode_statement(statement: dict) -> bytes:
    """JA: 同じ対象に同じbytes、違う対象には違うbytes。まず形と範囲を検査。
    EN: Validate the free statement contract; reject malformed input with ValueError.
    All non-params fields are strings; the four vocabulary fields use named constants.
    imageDigest is DIGEST_HEX_LENGTH lowercase hex; params are non-bool integers:
    0 < price <= max and 0 <= spent < budget <= max in the statement's profile.

    frame(b) = len(b).to_bytes(LENGTH_PREFIX_BYTES,BYTE_ORDER) + b.
    Text: frame(s.encode('utf-8')). Integer: frame(n.to_bytes(INTEGER_BYTES,BYTE_ORDER)).
    params: frame(all PARAM_NAMES in order, each framed name then framed integer).
    Emit all STATEMENT_FIELDS in order, with params as that block, others as text.
    Example frame(b'ab') = bytes([0,0,0,2,97,98]). Wrong fields → ValueError.
    """
    return b""


def image_digest(image: dict) -> str:
    """JA: bodyをdecodeしてから、IMAGE_COMMITMENT_DOMAINでcommit。
    EN: Require a dictionary carrying a decodable bytes or bytearray body; commit its full bytes.
    Ignore external sourcePath/imageId/buildId. Stamp bytes INSIDE body are included.
    Same body under a different path → same digest. Missing/bad body → ValueError.
    """
    return ""


def guest_input(env, statement: dict, witness: dict) -> None:
    """JA: 全statementを公開、全witnessをprivateへ1回。まず両方を検査。
    EN: Validate statement and is_well_formed(witness,SEMANTICS[statement['semantics']]).
    Reject before writing. Supply all STATEMENT_FIELDS using env.public(name,value),
    then env.write_private(witness) once. Never record witness in variables or notes.
    """


def run_guest(image: dict, env) -> dict:
    """JA: imageを照合し、bodyの命令をprofileに従って実行。hintsは答えにしない。
    EN: Validate env.public_inputs(), image identity and env.read_private() first.
    Decode body and execute its instructions; the free table specifies every operation.
    Wrapping: reduce and record site; saturating: clamp; checked: stop BEFORE counting
    the failed instruction. Apply addition to the processed multiplication result.

    Return exactly RUN_FIELDS: imageDigest, steps, programSteps, accepted, violated,
    wrapped, trapped, claimResult. steps counts completed instructions; programSteps
    is len(decode_program(body)) even on a trap. Both counts are integers, not bool.
    Four decisions are bool; wrapped is a sorted distinct tuple of mul/add names.
    violated = spent + price*quantity > budget using ordinary integers.
    claimResult = accepted and violated and claim_site(claim) in wrapped.
    Bad statement/witness or different image → ValueError before execution.
    """
    return {}


def seal_journal(statement: dict, run: dict) -> dict:
    """JA: 対象のdigestと結果を公開。進んだ命令数ではなく公開の総命令数を使う。
    EN: Validate statement and the complete run type/range contract from the free guide.
    Return exactly JOURNAL_FIELDS: statementDigest from encode_statement under
    STATEMENT_COMMITMENT_DOMAIN; imageDigest/guestVersion from statement;
    claimResult unchanged; measurements={'steps':run['programSteps']}.
    The public length stays 4 even when checked stops after 1 completed instruction.
    Invalid shapes, decision/count types, count bounds, wrapped sites or image → ValueError.
    """
    return {}


def accept_receipt(receipt: object, statement: object) -> bool:
    """JA: 別の対象へ使われたreceiptを拒否。不正な形も例外でなくFalse。
    EN: Require exactly RECEIPT_FIELDS and JOURNAL_FIELDS; measurements contains only
    steps, an integer>=1 (not bool). Validate statement, recompute its whole digest,
    match imageDigest and guestVersion, and require claimResult is True.
    No cryptographic seal is checked here; this alone cannot authenticate a receipt
    or the public program length. Never raise on malformed ordinary Python data.
    """
    return False


def leak_report(disclosure, statement: dict, image: dict) -> tuple[tuple[str, str], ...]:
    """JA: 6出口を監査。許可名でも別の値を運べば違反。
    EN: .journal is a dict; .stdout/.stderr/.trace/.temp contain {label,values}
    records; .error is None or {message,values}. Ignore heading prose.
    Inspect each values/journal field and its immediate children when it is a dict.
    Report names outside PUBLIC_NAMES; PARAM_NAMES with wrong integer type/value;
    MEASUREMENT_NAMES with wrong integer type/value versus len(decode_program(body)).
    Sort and deduplicate (channel,name) pairs. No violation → ().
    Example public spent=1 but stdout values={'spent':3} → (('stdout','spent'),).
    transfer adds no function: compose these stages under changed public parameters.
    """
    return ()
