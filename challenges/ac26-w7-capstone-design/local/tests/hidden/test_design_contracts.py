"""Author regressions for the documented design contracts and participant preview."""
from copy import deepcopy
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest

from fixtures.generate import public_brief, review_variant
from participant.lab import PRIMITIVES
from tests.hidden import check_design as checker

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("design_contract_reference", ROOT / "reference/design.py")
reference = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reference)
FUNCTIONS = ("classify_assets", "required_properties", "compare_alternatives", "select_primitive",
             "architecture", "attack_plan", "property_matrix", "revise")


def module_with(function, transform):
    functions = {name: getattr(reference, name) for name in FUNCTIONS}
    original = functions[function]
    functions[function] = lambda *args: transform(original(*args), *args)
    return SimpleNamespace(**functions)


def changed_field(answer, key, value):
    answer[key] = value
    return answer


def graph_field(graph, section, key, value):
    graph[section][0][key] = value
    return graph


def extra_option(graph, brief, selection):
    graph["nodes"][0]["primitives"].append(next(name for name in PRIMITIVES if name not in selection))
    return graph


def without_placed_option(graph, *_):
    for node in graph["nodes"]:
        node["primitives"] = []
    return graph


def without_assumptions(plan, *_):
    for row in plan:
        row.pop("assumption", None)
    return plan


def unrelated_evidence(matrix, brief, graph):
    plan = reference.attack_plan(brief, graph)
    for prop, row in matrix.items():
        other = next((entry for entry in plan if entry["property"] != prop), None)
        if other:
            row["evidence"] = other["id"]
    return matrix


def mutate_brief(function, key):
    functions = {name: getattr(reference, name) for name in FUNCTIONS}
    def changed(brief):
        if key == "secrecy":
            for asset in brief["assets"]:
                asset["must_not_learn"] = []
        else:
            brief["constraints"]["commit_then_reveal"] = False
        return getattr(reference, function)(brief)
    functions[function] = changed
    return SimpleNamespace(**functions)


# Every case runs against its named checkpoint alone, not a failure elsewhere.
CONTRACT_MUTANTS = (
    ("comparison omits half the options", "alternatives", module_with("compare_alternatives", lambda a,*_:a[:3])),
    ("comparison repeats an option", "alternatives", module_with("compare_alternatives", lambda a,*_:[a[0]]*6)),
    ("comparison invents assumptions", "alternatives", module_with("compare_alternatives", lambda a,*_:[dict(row, assumptions=["anything"]) for row in a])),
    ("comparison invents non-goals", "alternatives", module_with("compare_alternatives", lambda a,*_:[dict(row, non_goals=["anything"]) for row in a])),
    ("comparison uses integer admissibility", "alternatives", module_with("compare_alternatives", lambda a,*_:[dict(row, admissible=int(row["admissible"])) for row in a])),
    ("unknown visibility", "architecture", module_with("architecture", lambda a,*_:graph_field(a,"edges","visibility","encrypted-ish"))),
    ("unknown placed option", "architecture", module_with("architecture", lambda a,*_:graph_field(a,"nodes","primitives",["magic"]))),
    ("unselected option added", "architecture", module_with("architecture", extra_option)),
    ("selected option never placed", "architecture", module_with("architecture", without_placed_option)),
    ("missing trust endpoint", "architecture", module_with("architecture", lambda a,*_:graph_field(a,"nodes","trusts",["missing-node"]))),
    ("self trust", "architecture", module_with("architecture", lambda a,*_:graph_field(a,"nodes","trusts",[a["nodes"][0]["id"]]))),
    ("node hides the primitives field", "architecture", module_with("architecture", lambda a,*_:changed_field(a,"nodes",[{k:v for k,v in n.items() if k!="primitives"} for n in a["nodes"]]))),
    ("architecture bypasses valid selection", "architecture", module_with("select_primitive", lambda a,*_:[])),
    ("trust attacks omitted", "attacks", module_with("attack_plan", without_assumptions)),
    ("fabricated trust assumption", "attacks", module_with("attack_plan", lambda a,*_:[dict(a[0],assumption={"primitive":"mpc","trust":"magic"}),*a[1:]])),
    ("empty hypothesis", "attacks", module_with("attack_plan", lambda a,*_:[dict(a[0],hypothesis=" "),*a[1:]])),
    ("unrecognised experiment kind", "attacks", module_with("attack_plan", lambda a,*_:[dict(a[0],experiment=dict(a[0]["experiment"],kind="happy-path")),*a[1:]])),
    ("numeric observation", "attacks", module_with("attack_plan", lambda a,*_:[dict(a[0],experiment=dict(a[0]["experiment"],observable=1)),*a[1:]])),
    ("attack checkpoint bypasses graph validation", "attacks", module_with("architecture", lambda a,*_:graph_field(a,"edges","visibility","magic"))),
    ("matrix cites an unrelated property", "matrix", module_with("property_matrix", unrelated_evidence)),
    ("matrix bypasses plan coverage", "matrix", module_with("attack_plan", lambda a,*_:a[:1])),
    ("matrix numeric limitation", "matrix", module_with("property_matrix", lambda a,*_:{p:dict(row,limitation=1) for p,row in a.items()})),
    ("revision bypasses trust attacks", "revision", module_with("attack_plan", without_assumptions)),
    ("revision uses numbers as booleans", "revision", module_with("revise", lambda a,*_:changed_field(a,"required",{p:int(v) for p,v in a["required"].items()}))),
    ("revision missing key masked by extra key", "revision", module_with("revise", lambda a,*_:{**{k:v for k,v in a.items() if k!="required"},"extra":True})),
    ("classification rewrites the task's secrecy", "assets", mutate_brief("classify_assets","secrecy")),
    ("requirements rewrite the binding constraint", "requirements", mutate_brief("required_properties","binding")),
)


class DesignContractTests(unittest.TestCase):
    def test_each_contract_mutant_is_rejected_by_its_checkpoint(self):
        for name, checkpoint, module in CONTRACT_MUTANTS:
            with self.subTest(name=name, checkpoint=checkpoint):
                failures = getattr(checker, "check_" + checkpoint)(module, "contract-regressions")
                self.assertTrue(failures)

    def test_requirement_ignores_the_owner_among_relying_parties(self):
        brief = {"actors":[{"id":"A","role":"input_provider"},
                           {"id":"B","role":"operator"},{"id":"C","role":"relying_party"}],
                 "assets":[{"id":"x","owner":"A","must_not_learn":["B"],"integrity_relied_on_by":[]},
                           {"id":"y","owner":"B","must_not_learn":[],"derived_from":["x"],
                            "integrity_relied_on_by":["B","C"]}],"constraints":{}}
        self.assertFalse(reference.required_properties(brief)["zero_knowledge"])
        self.assertEqual(reference.required_properties(brief), checker._spec_requirements(brief))

    def test_different_valid_minimal_selections_remain_accepted(self):
        brief = {"id":"small","actors":[{"id":"A","role":"input_provider"}],
                 "assets":[{"id":"x","owner":"A","must_not_learn":[],"integrity_relied_on_by":[]}],
                 "constraints":{"commit_then_reveal":True}}
        for selected in (["none","commitment"],["commitment","zk"]):
            self.assertEqual(checker._selection_failures(brief,selected), [])

    def test_node_and_edge_order_are_not_a_hidden_layout_requirement(self):
        module = module_with("architecture", lambda a,*_:dict(a,nodes=list(reversed(a["nodes"])),edges=list(reversed(a["edges"]))))
        self.assertEqual(checker.check_architecture(module,"order-independent"), [])

    def test_preview_revises_the_displayed_brief_and_changes_a_fact(self):
        for index in range(30):
            original = public_brief(str(index))
            revised = review_variant(str(index))
            self.assertTrue(revised["id"].startswith(original["id"] + "-"))
            self.assertEqual(revised["statement"], original["statement"])
            self.assertTrue(any(revised[key] != original[key] for key in ("actors","assets","constraints")))

    def test_failure_messages_do_not_expose_hidden_brief_ids(self):
        _, checkpoint, module = CONTRACT_MUTANTS[-1]
        failures = getattr(checker,"check_"+checkpoint)(module,"private-id-regression")
        self.assertTrue(failures)
        for brief in checker.population("private-id-regression"):
            self.assertNotIn(brief["id"], " ".join(failures))


if __name__ == "__main__":
    unittest.main()
