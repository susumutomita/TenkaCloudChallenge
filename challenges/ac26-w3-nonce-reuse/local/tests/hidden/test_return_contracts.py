"""Author regressions for each checkpoint's documented return contract."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ROOT = Path(__file__).resolve().parents[2]
checker = load('return_checker', Path(__file__).with_name('check_recover.py'))
reference = load('contract_reference', ROOT / 'reference' / 'recover.py')


class ReturnContractsTest(unittest.TestCase):
    def test_parse_accepts_all_supported_coordinate_forms(self):
        self.assertEqual(checker.check_parse(reference, 'parse-forms'), [])

    def test_parse_checks_raw_and_point_results_equally(self):
        def response_only(record, group):
            result = reference.parse_record(record, group)
            if isinstance(record['public_key'], (tuple, list)):
                return {'response': result['response']}
            return result
        submission = SimpleNamespace(parse_record=response_only, MalformedRecord=reference.MalformedRecord)
        self.assertTrue(checker.check_parse(submission, 'raw-response-only'))

    def test_detect_allows_reversed_pairs_lists_and_subsets(self):
        def alternative(records, group):
            pairs = reference.find_reuse(records, group)
            return [[b, a] for a, b in reversed(pairs)][:1]
        submission = SimpleNamespace(find_reuse=alternative)
        self.assertEqual(checker.check_detect(submission, 'arbitrary-pair-order'), [])

    def test_detect_bad_indices_report_failures_without_indexing_them(self):
        for bad_pair in [(-2, -1), (False, True), (0.0, 1.0), (0,), (0, 1, 2), 1, (0, 999999)]:
            with self.subTest(pair=bad_pair):
                submission = SimpleNamespace(find_reuse=lambda rows, group: [bad_pair])
                failures = checker.check_detect(submission, 'bad-pair-shape')
                self.assertIn('a reuse pair must contain two distinct original record indices', failures)

    def test_collision_checks_more_than_the_example_sample_count(self):
        submission = SimpleNamespace(collision_experiment=lambda seed, group, samples:
                                     reference.collision_experiment(seed, group, 40))
        self.assertTrue(checker.check_collision(submission, 'samples-ignored'))

    def test_collision_supplies_zero_one_and_more_than_one_space_of_samples(self):
        sizes = set()
        def measure(seed, group, samples):
            sizes.add(samples)
            return reference.collision_experiment(seed, group, samples)
        self.assertEqual(checker.check_collision(SimpleNamespace(collision_experiment=measure), 'sizes'), [])
        self.assertTrue({0, 1, 40}.issubset(sizes))
        self.assertGreater(max(sizes), checker.NONCE_SPACE)


if __name__ == '__main__':
    unittest.main()
