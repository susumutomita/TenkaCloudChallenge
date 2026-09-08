"""Author regression checks for the final construction; not participant material."""
import importlib.util
from pathlib import Path
import sys
import unittest
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def load(path):
    spec = importlib.util.spec_from_file_location(path.stem, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


checker = load(ROOT / "tests/hidden/check_prover.py")
reference = load(ROOT / "reference/prover.py")


class CancellationTest(unittest.TestCase):
    def check(self, function):
        return checker.check_mask_cancellation(
            SimpleNamespace(mask_cancellation_witness=function), "author-cancellation"
        )

    def test_reference_constructs(self):
        self.assertEqual(self.check(reference.mask_cancellation_witness), [])

    def test_direct_and_unbound_facade_reads_are_rejected(self):
        from participant.mpc import ParticipantRuntime
        for unbound in (False, True):
            def broken(runtime, halves, triple):
                with runtime.party_scope(0):
                    if unbound:
                        ParticipantRuntime.value_of(runtime, halves["A"][0])
                    else:
                        runtime.value_of(halves["A"][0])
                return reference.mask_cancellation_witness(runtime, halves, triple)
            self.assertIn("cancellation witness must not read values directly", self.check(broken))

    def test_restoring_mutable_read_counter_cannot_hide_reads(self):
        from participant.mpc import ParticipantRuntime
        for unbound in (False, True):
            def broken(runtime, halves, triple):
                before = runtime._runtime.reads
                with runtime.party_scope(0):
                    if unbound:
                        ParticipantRuntime.value_of(runtime, halves["A"][0])
                    else:
                        runtime.value_of(halves["A"][0])
                runtime._runtime.reads = before
                return reference.mask_cancellation_witness(runtime, halves, triple)
            self.assertIn("cancellation witness must not read values directly", self.check(broken))

    def test_unbound_runtime_class_read_is_rejected(self):
        from participant.mpc import Runtime
        def broken(runtime, halves, triple):
            with runtime.party_scope(0):
                Runtime.value_of(runtime._runtime, halves["A"][0])
            return reference.mask_cancellation_witness(runtime, halves, triple)
        self.assertIn("cancellation witness must not read values directly", self.check(broken))

    def test_alternative_local_construction_is_allowed(self):
        def valid(runtime, halves, triple):
            result = []
            for i in range(runtime.setting["parties"]):
                with runtime.party_scope(i):
                    zero = runtime.mul_public(triple.x[i], 0)
                    result.append(runtime.add_public(runtime.add(halves["A"][i], zero), 0))
            return tuple(result)
        self.assertEqual(self.check(valid), [])

    def test_returning_input_has_no_mask_ancestry(self):
        self.assertTrue(self.check(lambda runtime, halves, triple: halves["A"]))

    def test_adding_mask_without_cancelling_changes_value(self):
        def broken(runtime, halves, triple):
            result = []
            for i in range(runtime.setting["parties"]):
                with runtime.party_scope(i):
                    result.append(runtime.add(halves["A"][i], triple.x[i]))
            return tuple(result)
        self.assertTrue(self.check(broken))

    def test_opening_is_rejected_even_with_correct_value(self):
        def broken(runtime, halves, triple):
            runtime.open("leak", halves["A"])
            return reference.mask_cancellation_witness(runtime, halves, triple)
        self.assertTrue(self.check(broken))

    def test_forged_object_with_issued_identifier_is_rejected(self):
        from participant.mpc import Share
        def broken(runtime, halves, triple):
            real = reference.mask_cancellation_witness(runtime, halves, triple)
            return tuple(Share(s.party, s.field, s.id, s._value) for s in real)
        self.assertTrue(self.check(broken))

    def test_foreign_party_order_is_rejected(self):
        def broken(runtime, halves, triple):
            real = reference.mask_cancellation_witness(runtime, halves, triple)
            return real[1:] + real[:1]
        self.assertTrue(self.check(broken))


if __name__ == "__main__":
    unittest.main()
