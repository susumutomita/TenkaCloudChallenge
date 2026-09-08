"""Author-only contract regressions, run by the normal mutation entry point."""
from pathlib import Path
import sys
import types
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tests.hidden import check_capstone as check
from participant.lab import Setting, sample_randomness


def module():
    obj = types.ModuleType('solution')
    exec(compile((ROOT/'reference/capstone.py').read_text(), 'reference', 'exec'), obj.__dict__)
    return obj


class ContractTests(unittest.TestCase):
    def test_reference(self):
        self.assertEqual(check.run(module(), 'contract'), [])

    def test_view_cannot_replace_mail_with_placeholders(self):
        obj = module()
        original = obj.view
        def view(t, c):
            observed = original(t, c)
            observed['received'] = tuple((0, 0, 0) for _ in observed['received'])
            return observed
        obj.view = view
        self.assertTrue(check.check_privacy(obj, 'contract'))

    def test_view_cannot_rotate_public_values(self):
        obj = module()
        original = obj.view
        def view(t, c):
            observed = original(t, c)
            observed['public'] = observed['public'][1:] + observed['public'][:1]
            return observed
        obj.view = view
        self.assertTrue(check.check_privacy(obj, 'contract'))

    def test_view_cannot_rewrite_its_input_to_change_expected_mail(self):
        obj = module()
        original = obj.view
        def broken(t, c):
            t['messages'].clear()
            t['public'].clear()
            return original(t, c)
        obj.view = broken
        self.assertTrue(check.check_privacy(obj, 'contract'))

    def test_view_can_mutate_input_after_capturing_correct_observation(self):
        obj = module()
        original = obj.view
        def valid(t, c):
            observed = original(t, c)
            t['messages'].clear()
            t['public'].clear()
            return observed
        obj.view = valid
        self.assertEqual(check.check_privacy(obj, 'contract'), [])

    def test_sender_inputs_cannot_be_swapped_with_same_total(self):
        obj = module()
        original = obj.run
        def broken(setting, randomness):
            changed = Setting(setting.parties, setting.modulus,
                              setting.inputs[1:] + setting.inputs[:1])
            return original(changed, randomness)
        obj.run = broken
        self.assertTrue(check.check_transcript(obj, 'contract'))

    def test_output_float_is_not_an_integer_answer(self):
        obj = module(); original = obj.run
        obj.run = lambda s, r: {**original(s, r), 'output': float(original(s, r)['output'])}
        self.assertTrue(check.check_correctness(obj, 'contract'))

    def test_duplicate_addresses_even_when_totals_match(self):
        obj = module(); setting = Setting(3, 7, (3, 4, 2))
        t = obj.run(setting, sample_randomness('contract', setting))
        for m in t['messages']: m['to'] = 0
        t['public'] = [{'kind':'partial', 'value': t['output']}, {'kind':'partial', 'value':0}, {'kind':'partial', 'value':0}]
        self.assertTrue(check._spec_well_formed(t, setting))

    def test_transcript_type_and_rounds(self):
        obj = module(); setting = Setting(3, 7, (3, 4, 2))
        for target in ('sender', 'public', 'rounds'):
            t = obj.run(setting, sample_randomness('contract', setting))
            if target == 'sender': t['messages'][0]['from'] = False
            if target == 'public': t['public'][0]['value'] = float(t['public'][0]['value'])
            if target == 'rounds': t['rounds'] = 8
            self.assertTrue(check._spec_well_formed(t, setting))

    def test_evidence_cannot_disclaim_everything(self):
        obj = module()
        obj.evidence = lambda *_: {name: {'claimed':False, 'experiment':'', 'verdict':None, 'limitation':'none'} for name in obj.CLAIMABLE}
        self.assertTrue(check.check_evidence(obj, 'contract'))

    def test_privacy_flags_must_be_boolean(self):
        obj = module()
        obj.experiment_privacy = lambda: {'id':'exp-privacy', 'ran':1, 'passed':1, 'space':729}
        self.assertTrue(check.check_privacy(obj, 'contract'))


if __name__ == '__main__':
    unittest.main()
