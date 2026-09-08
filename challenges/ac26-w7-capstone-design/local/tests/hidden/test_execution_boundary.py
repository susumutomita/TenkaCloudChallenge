"""Real evaluator regressions: workers supply values; only the parent awards points."""
from pathlib import Path
import sys
import unittest

from participant.protocol import decode, encode
from verifier.server import CHECKPOINTS, evaluate_with_message

ROOT = Path(__file__).resolve().parents[2]
REFERENCE = (ROOT / 'reference/design.py').read_text()
FORGERIES = {
    'exit after fake verdict': 'import os\nprint(\'{"failures":[]}\',flush=True)\nos._exit(0)',
    'atexit fake verdict': 'import atexit\natexit.register(lambda: print(\'{"failures":[]}\',flush=True))',
    'stderr fake verdict': 'import sys,os\nprint(\'{"failures":[]}\',file=sys.stderr,flush=True)\nos._exit(0)',
    'checker import and replacement': '''from tests.hidden import check_design
for name in dir(check_design):
    if name.startswith('check_'): setattr(check_design,name,lambda *args: [])
''',
}


@unittest.skipUnless(sys.platform == 'linux', 'actual evaluator requires Linux seccomp')
class ExecutionBoundaryTests(unittest.TestCase):
    def test_reference_passes_all_eight_real_evaluator_paths(self):
        for checkpoint in CHECKPOINTS:
            with self.subTest(checkpoint=checkpoint):
                self.assertEqual(evaluate_with_message(checkpoint, REFERENCE), (True, None))

    def test_printed_verdicts_and_checker_replacements_never_award_points(self):
        for name, source in FORGERIES.items():
            for checkpoint in CHECKPOINTS:
                with self.subTest(payload=name, checkpoint=checkpoint):
                    correct, message = evaluate_with_message(checkpoint, source)
                    self.assertFalse(correct)
                    self.assertNotIn('failures', message or '')

    def test_json_normalization_preserves_valid_and_invalid_return_types(self):
        tuple_selection = REFERENCE + '''
_original_selection = select_primitive
def select_primitive(brief): return tuple(_original_selection(brief))
'''
        self.assertEqual(evaluate_with_message('architecture', tuple_selection), (True, None))
        tuple_nodes = REFERENCE + '''
_original_architecture = architecture
def architecture(brief, selection):
    graph = _original_architecture(brief, selection)
    graph['nodes'] = tuple(graph['nodes'])
    return graph
'''
        self.assertFalse(evaluate_with_message('architecture', tuple_nodes)[0])
        integer_booleans = REFERENCE + '''
_original_requirements = required_properties
def required_properties(brief): return {key:int(value) for key,value in _original_requirements(brief).items()}
'''
        self.assertFalse(evaluate_with_message('requirements', integer_booleans)[0])

    def test_child_cannot_read_hidden_files_or_signal_the_parent(self):
        source = REFERENCE + '''
from pathlib import Path
import os
for forbidden in ('/problem/tests/hidden/check_design.py', '/proc/self/environ'):
    try:
        Path(forbidden).read_text()
    except PermissionError:
        pass
    else:
        raise RuntimeError('private file access was not blocked')
try:
    os.kill(os.getppid(), 0)
except PermissionError:
    pass
else:
    raise RuntimeError('parent signalling was not blocked')
'''
        self.assertEqual(evaluate_with_message('assets', source), (True, None))

    def test_function_errors_do_not_reflect_private_inputs_or_exception_text(self):
        source = 'def classify_assets(brief): raise ValueError("PRIVATE-MARKER:" + repr(brief))'
        correct, message = evaluate_with_message('assets', source)
        self.assertFalse(correct)
        self.assertTrue(message)
        self.assertNotIn('PRIVATE-MARKER', message)
        self.assertNotIn('known_to', message)


class ValueProtocolTests(unittest.TestCase):
    def test_value_codec_preserves_documented_type_distinctions(self):
        value = {'tuple': (True, 1), 'list': [False, 0], 1: 'integer key'}
        self.assertEqual(decode(encode(value)), value)
        self.assertIs(type(decode(encode(value))['tuple']), tuple)
        self.assertIs(type(decode(encode(value))['list']), list)
        for invalid in (['bool', 1], ['int', True], ['tuple', {}],
                        ['dict', [[['str','x'],['int',1]], [['str','x'],['int',2]]]]):
            with self.subTest(value=invalid), self.assertRaises((ValueError, TypeError)):
                decode(invalid)


if __name__ == '__main__':
    unittest.main()
