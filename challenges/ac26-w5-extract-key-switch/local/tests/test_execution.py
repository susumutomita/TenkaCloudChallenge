"""Exercise the deployed value boundary with normal and harmless invalid inputs."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from verifier.server import evaluate_with_message, CODE_CHECKPOINTS


def main():
    source = (Path(__file__).resolve().parents[1] / 'reference/extract.py').read_text()
    for checkpoint in CODE_CHECKPOINTS:
        correct, message = evaluate_with_message(checkpoint, source)
        assert correct, (checkpoint, message)
        print('PASS deployed reference', checkpoint, flush=True)
    subclass = source.replace('raise ValueError(', 'raise BadInput(') + '\nclass BadInput(ValueError):\n    pass\n'
    for checkpoint in ('phase', 'extract', 'switch', 'domains'):
        assert evaluate_with_message(checkpoint, subclass)[0], checkpoint
    print('PASS legal ValueError subclass refusals', flush=True)
    checkpoint = next(iter(CODE_CHECKPOINTS))
    assert not evaluate_with_message(checkpoint, 'pass')[0]
    assert not evaluate_with_message(checkpoint, 'def broken(:')[0]
    print('PASS harmless missing-function and syntax-error submissions', flush=True)


if __name__ == '__main__':
    main()
