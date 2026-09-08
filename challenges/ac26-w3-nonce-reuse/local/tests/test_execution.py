"""Exercise the deployed value boundary with normal and harmless invalid inputs."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from verifier.server import evaluate_with_message, CODE_CHECKPOINTS


def main():
    from participant.protocol import encode, decode
    from participant.schnorr import Point
    class PublicPointSubclass(Point):
        pass
    original = PublicPointSubclass((17, 2, 2), 5, 1)
    restored = decode(encode(original))
    assert isinstance(restored, Point) and type(restored) is not Point
    assert (restored.params, restored.x, restored.y) == (original.params, original.x, original.y)
    print('PASS Point subclass value roundtrip', flush=True)
    source = (Path(__file__).resolve().parents[1] / 'reference/recover.py').read_text()
    for checkpoint in CODE_CHECKPOINTS:
        correct, message = evaluate_with_message(checkpoint, source)
        assert correct, (checkpoint, message)
        print('PASS deployed reference', checkpoint, flush=True)
    alternative = source.replace('class MalformedRecord(Exception):', 'class BaseMalformedRecord(Exception): pass\nclass MalformedRecord(BaseMalformedRecord):').replace('raise MalformedRecord(', 'raise ChildMalformedRecord(') + '\nclass ChildMalformedRecord(MalformedRecord): pass\n'
    assert evaluate_with_message('parse', alternative)[0]
    print('PASS documented exception subclass', flush=True)
    checkpoint = next(iter(CODE_CHECKPOINTS))
    assert not evaluate_with_message(checkpoint, 'pass')[0]
    assert not evaluate_with_message(checkpoint, 'def broken(:')[0]
    print('PASS harmless missing-function and syntax-error submissions', flush=True)


if __name__ == '__main__':
    main()
