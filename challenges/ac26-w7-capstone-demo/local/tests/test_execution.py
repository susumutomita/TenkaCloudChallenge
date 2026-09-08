"""Exercise the deployed value boundary with normal and harmless invalid inputs."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from verifier.server import evaluate_with_message, CODE_CHECKPOINTS


def main():
    source = (Path(__file__).resolve().parents[1] / 'reference/capstone.py').read_text()
    for checkpoint in CODE_CHECKPOINTS:
        correct, message = evaluate_with_message(checkpoint, source)
        assert correct, (checkpoint, message)
        print('PASS deployed reference', checkpoint, flush=True)
    diagnostics = source + "\n_base_run = run\ndef run(setting, randomness):\n    t = _base_run(setting, randomness)\n    for row in [t, *t['messages'], *t['public']]:\n        row['diagnostic'] = (x for x in ())\n    return t\n"
    for checkpoint in ('transcript', 'privacy', 'detect', 'evidence'):
        assert evaluate_with_message(checkpoint, diagnostics)[0], checkpoint
    print('PASS legal generator diagnostic extras across value boundary', flush=True)
    serializable = source + "\n_original_run = run\n_original_view = view\ndef run(setting, randomness):\n    t = _original_run(setting, randomness)\n    t['diagnostic'] = 'present'\n    for row in [*t['messages'], *t['public']]: row['diagnostic'] = (1, 2)\n    return t\ndef view(transcript, coalition):\n    assert transcript['diagnostic'] == 'present'\n    assert all(row['diagnostic'] == (1, 2) for row in [*transcript['messages'], *transcript['public']])\n    return _original_view(transcript, coalition)\n"
    assert evaluate_with_message('privacy', serializable)[0]
    print('PASS serializable diagnostics available to view', flush=True)
    checkpoint = next(iter(CODE_CHECKPOINTS))
    assert not evaluate_with_message(checkpoint, 'pass')[0]
    assert not evaluate_with_message(checkpoint, 'def broken(:')[0]
    print('PASS harmless missing-function and syntax-error submissions', flush=True)


if __name__ == '__main__':
    main()
