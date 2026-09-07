"""Public shape and small arithmetic checks run by a trusted parent.

These examples do not prove security of a cryptographic protocol. The private
checkpoints also examine complete finite distributions of specified observations.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from participant.execution import LearnerError, LearnerSession  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _load_public_evidence() -> dict:
    """This deployment's group, sender key, session and gate shares -- what `show.py`
    prints, plus the sender's exponent, which this file has always needed to call
    `encrypt` at all. A learner implements both roles here, so the sender's step is
    theirs to run; `show.py` still does not print it, because the transfer's privacy
    claim is about the receiver.

    Issue 537/538 (Issue 543 option B2): this file used to import `fixtures.generate`
    directly. That module shipped in the same image as
    `tests/hidden/check_oblivious.py`, whose assertions decide all six checkpoints, so
    it does not ship in the `participant` Docker stage at all any more (see
    ../../Dockerfile). This deployment's own verifier is the only source for the public
    half now: `PUBLIC_EVIDENCE_JSON` when the Portal has already fetched it, or
    `VERIFIER_PUBLIC_URL` fetched directly when it has not.
    """
    injected = os.environ.get("PUBLIC_EVIDENCE_JSON")
    if injected:
        return json.loads(injected)
    verifier_public_url = os.environ.get("VERIFIER_PUBLIC_URL")
    if verifier_public_url:
        from urllib.request import urlopen

        with urlopen(verifier_public_url, timeout=10) as response:  # noqa: S310
            return json.loads(response.read().decode("utf-8"))
    # Neither is set: this only resolves when `fixtures/` is actually on disk, which is
    # true for a checkout (this file run directly, e.g. by
    # scripts/ac26-w2-oblivious-transfer.test.ts) and the verifier/author Docker stages,
    # and never inside a built `participant` image -- so this branch does not reopen the
    # leak above.
    from fixtures.generate import public_payload

    return public_payload(SEED)


PUBLIC = {}
GRP = {}
KEY = {}
SES = {}
oblivious = None


def test_request_is_in_the_group() -> None:
    req = oblivious.request(GRP, KEY["public"], SES["choice"], SES["blind"])
    assert type(req) is int
    assert 0 <= req < GRP["p"]


def test_blind_range_returns_two_bounds() -> None:
    low, high = oblivious.blind_range(GRP)
    assert type(low) is int and type(high) is int
    assert low <= high


def test_encrypt_returns_two_ciphertexts() -> None:
    req = oblivious.request(GRP, KEY["public"], SES["choice"], SES["blind"])
    cts = oblivious.encrypt(
        GRP, KEY["secret"], KEY["public"], req, SES["message_0"], SES["message_1"]
    )
    assert len(cts) == 2


def test_the_chosen_message_comes_back() -> None:
    choice = SES["choice"]
    req = oblivious.request(GRP, KEY["public"], choice, SES["blind"])
    cts = oblivious.encrypt(
        GRP, KEY["secret"], KEY["public"], req, SES["message_0"], SES["message_1"]
    )
    got = oblivious.unwrap(GRP, KEY["public"], choice, SES["blind"], cts)
    assert got == (SES["message_0"] if choice == 0 else SES["message_1"])


def test_gate_masks_returns_two_bits() -> None:
    masks = oblivious.gate_masks((0, 1))
    assert len(masks) == 2
    assert all(type(m) is int and m in (0, 1) for m in masks)


def test_offer_returns_two_messages() -> None:
    pair=oblivious.offer(1,0)
    assert isinstance(pair,list) and len(pair)==2
    assert all(type(value) is int and value in (0,1) for value in pair)


def test_output_share_returns_a_bit() -> None:
    value = oblivious.output_share(1, 1, 0, 0)
    assert type(value) is int and value in (0, 1)


def test_needs_transfer_returns_a_boolean() -> None:
    assert isinstance(oblivious.needs_transfer("and"), bool)


def test_small_group_selected_keys_agree() -> None:
    grp={'p':7,'q':3,'g':2}
    for choice in (0,1):
        req=oblivious.request(grp,4,choice,1)
        assert req==(2 if choice==0 else 1), 'use the choice-dependent request formula'
        cts=oblivious.encrypt(grp,2,4,req,3,5)
        assert isinstance(cts,list) and len(cts)==2 and all(type(v) is int for v in cts)
        got=oblivious.unwrap(grp,4,choice,1,cts)
        assert type(got) is int and got==(3 if choice==0 else 5), 'recover the selected message'


def test_small_and_example_reconstructs() -> None:
    masks=oblivious.gate_masks((0,1))
    v1=oblivious.offer(1,masks[0])[1]
    v0=oblivious.offer(0,masks[1])[1]
    z0=oblivious.output_share(1,1,masks[0],v0)
    z1=oblivious.output_share(0,1,masks[1],v1)
    assert type(z0) is int and type(z1) is int and z0 in (0,1) and z1 in (0,1)
    assert z0 ^ z1 == 0, 'the combined AND output must be zero for the displayed example'


def run_cases(module, public, only=''):
    global oblivious, PUBLIC, GRP, KEY, SES
    oblivious, PUBLIC = module, public
    GRP,KEY,SES=public['group'],public['senderKey'],public['session']
    transcript=[]
    failures=selected=0
    for name,fn in sorted(globals().items()):
        if not name.startswith('test_') or not callable(fn):continue
        if only and only not in name:continue
        selected+=1
        try:
            fn()
            transcript.append('PASS '+name)
        except AssertionError as error:
            failures+=1;transcript.append(f'FAIL {name}: {error or "assertion failed"}')
        except Exception as error:
            failures+=1;transcript.append(f'FAIL {name}: raised {type(error).__name__}')
    if not selected:return False,f'no public test matched --only {only!r}'
    transcript.append('public tests: '+('all passed' if not failures else f'{failures} failed'))
    return failures==0,'\n'.join(transcript)


def main() -> int:
    only=''
    if '--only' in sys.argv:
        index=sys.argv.index('--only');only=sys.argv[index+1] if index+1<len(sys.argv) else ''
    directory=Path(os.environ.get('SUBMISSION_DIR',str(ROOT/'starter')))
    learner=LearnerSession({'oblivious.py':(directory/'oblivious.py').read_text()})
    try:
        public=_load_public_evidence()
        with learner:passed,output=run_cases(learner.module(),public,only)
        print(output)
        return 0 if passed else 1
    except (LearnerError,OSError,ValueError):
        print(learner.initialization_diagnostic or 'The submitted functions could not be evaluated.')
        return 1


if __name__=='__main__':raise SystemExit(main())
