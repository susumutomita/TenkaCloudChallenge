"""Local Linux evidence for the parent-owned EC checker and public feedback."""
from pathlib import Path
import sys
import unittest

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from participant.execution import LearnerSession, LearnerError
from participant.isolation import protect_supervisor
from participant.server import _WORKBENCH
from verifier import server


def reader():
    return (ROOT/'tests/hidden/reader-curve.py').read_text()


@unittest.skipUnless(sys.platform=='linux','requires deployed Linux isolation')
class ExecutionBoundary(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        protect_supervisor()

    def test_reader_and_reference_pass_all_private_and_public_checks(self):
        for source in (reader(),(ROOT/'reference/curve.py').read_text()):
            for checkpoint in server.CHECKPOINTS:
                self.assertTrue(server.evaluate(checkpoint,source),checkpoint)
            self.assertTrue(_WORKBENCH.run_public_tests({'curve.py':source})['passed'])

    def test_empty_success_prints_do_not_replace_calculation(self):
        for source in ('print(\'{"failures":[]}\')\nraise SystemExit\n',
                       'print(\'{"ready":true}\')\nprint(\'{"correct":true}\')\nraise SystemExit\n'):
            for checkpoint in server.CHECKPOINTS:
                self.assertFalse(server.evaluate(checkpoint,source),checkpoint)
            self.assertFalse(_WORKBENCH.run_public_tests({'curve.py':source})['passed'])

    def test_wrong_coordinates_and_scalar_methods_are_rejected(self):
        variants=[('add', '\nPoint.__add__=lambda self, other:self\n'),
                  ('double','\nPoint.__add__=lambda self, other:self.curve.infinity()\n'),
                  ('scalar','\nPoint.__mul__=lambda self,k:self\n'),
                  ('scalar','\nPoint.__rmul__=lambda self,k:self\n'),
                  ('secp256k1','\nPoint.scalar_mul=lambda self,k:self.curve.infinity()\n')]
        for checkpoint,patch in variants:
            self.assertFalse(server.evaluate(checkpoint,reader()+patch),checkpoint)

    def test_point_data_cannot_change_curve_or_integer_coordinates(self):
        patches=["point.y += point.curve.p", "point.y = float(point.y)",
                 "point.y = bool(point.y)", "point.curve = Curve(7,0,1)"]
        for patch in patches:
            source=reader()+f"\n_original_add=Point.__add__\ndef add(self,other):\n point=_original_add(self,other)\n if not point.is_infinity:\n  {patch}\n return point\nPoint.__add__=add\n"
            self.assertFalse(server.evaluate('add',source),patch)
            self.assertFalse(_WORKBENCH.run_public_tests({'curve.py':source})['passed'],patch)

    def test_trace_before_fields_indices_flags_and_zero_are_checked(self):
        patches=["row['index']=99", "row['accumulator_before']='wrong'",
                 "row['addend_before']='wrong'", "row['added']=int(row['added'])",
                 "row['bit']=bool(row['bit'])"]
        for patch in patches:
            source=reader()+f'\n_original_trace=double_and_add_trace\ndef double_and_add_trace(p,k):\n rows=_original_trace(p,k)\n for row in rows:\n  {patch}\n return rows\n'
            self.assertFalse(server.evaluate('trace',source),patch)
            self.assertFalse(_WORKBENCH.run_public_tests({'curve.py':source})['passed'],patch)
        zero=reader()+"\n_original_trace=double_and_add_trace\ndef double_and_add_trace(p,k):\n return [{}] if k==0 else _original_trace(p,k)\n"
        self.assertFalse(server.evaluate('trace',zero))

    def test_equal_curve_instances_and_point_hashes_are_required(self):
        patches=["Point.__eq__=lambda self,other:self.curve is other.curve and self.x==other.x and self.y==other.y",
                 "Point.__hash__=lambda self:hash((id(self.curve),self.x,self.y))"]
        for patch in patches:
            self.assertFalse(server.evaluate('properties',reader()+'\n'+patch))
            self.assertFalse(_WORKBENCH.run_public_tests({'curve.py':reader()+'\n'+patch})['passed'])

    def test_builtin_exception_aliases_cannot_satisfy_custom_errors(self):
        source=reader()+'\nNotOnCurve=ValueError\nCurveMismatch=TypeError\n'
        self.assertFalse(server.evaluate('on-curve',source))
        self.assertFalse(server.evaluate('properties',source))
        self.assertFalse(_WORKBENCH.run_public_tests({'curve.py':source})['passed'])

    def test_unrelated_classes_and_mutable_json_do_not_forge_errors(self):
        source=reader().replace('raise NotOnCurve(', 'raise ValueError(').replace('raise CurveMismatch(', 'raise TypeError(')+'''
import json
_original_dumps=json.dumps
def fake(value,*args,**kwargs):
    if isinstance(value,dict) and value.get('error'):
        value['errorKinds']=['NotOnCurve','CurveMismatch']
    return _original_dumps(value,*args,**kwargs)
json.dumps=fake
'''
        self.assertFalse(server.evaluate('on-curve',source))
        self.assertFalse(server.evaluate('properties',source))

    def test_learner_frames_cannot_replace_response_classification(self):
        source=reader().replace('raise NotOnCurve(', 'raise ValueError(').replace('raise CurveMismatch(', 'raise TypeError(')+'''
import sys
_frame=sys._getframe(1)
_send=_frame.f_locals['send']
_cell=dict(zip(_send.__code__.co_freevars,_send.__closure__))['encode']
_encode=_cell.cell_contents
def fake(value,*args):
    if isinstance(value,dict) and value.get('error'):
        value['errorKinds']=['NotOnCurve','CurveMismatch']
    return _encode(value,*args)
_cell.cell_contents=fake
'''
        self.assertFalse(server.evaluate('on-curve',source))
        self.assertFalse(server.evaluate('properties',source))

    def test_source_files_and_parent_environment_are_unavailable(self):
        source=reader()+'''
import os
for path in ('/problem/tests/hidden/check_curve.py','/problem/reference/curve.py','/proc/self/environ'):
    try: open(path).read()
    except PermissionError: pass
    else: raise RuntimeError('private file was readable')
if 'FLAG_SEED' in os.environ:
    raise RuntimeError('private environment was inherited')
'''
        self.assertTrue(server.evaluate('on-curve',source))

    def test_timeout_and_flood_do_not_become_success(self):
        for source in ('while True: pass', 'print("x"*1000000)'):
            with self.assertRaises(LearnerError):
                with LearnerSession({'curve.py':source},timeout=.3):
                    self.fail('invalid source initialized')
        self.assertTrue(server.evaluate('on-curve',reader()))

    def test_source_locations_are_public_and_hidden_feedback_is_generic(self):
        source='class Curve:\n syntax invalid here\n'
        public=_WORKBENCH.run_public_tests({'curve.py':source})
        self.assertFalse(public['passed'])
        self.assertIn('curve.py:2:',public['output'])
        correct,message=server.evaluate_with_message('on-curve',source)
        self.assertFalse(correct)
        self.assertNotIn('syntax invalid',message)


if __name__=='__main__':
    unittest.main()
