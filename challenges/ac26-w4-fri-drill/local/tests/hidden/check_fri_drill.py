"""Author correctness checks; learner code never executes in the verifier."""
from fixtures.generate import GRADED,normalize_answer,setting
from verifier.expected import expected_for
from participant.exercise import EXAMPLE,EXAMPLE_EXPECTED,call_row,construction_valid


def run(module,seed):
    failures=[]
    contexts=[('example',EXAMPLE,EXAMPLE_EXPECTED),('deployment',setting(seed)['public'],expected_for(seed))]
    for context,inputs,expected in contexts:
        for row in GRADED:
            try:
                actual=normalize_answer(row,call_row(module,row,inputs))
                correct=construction_valid(actual,inputs) if row=='miss-points' else actual==normalize_answer(row,expected[row])
                if actual is None or not correct:
                    failures.append(f'{context} {row}: result differs from the stated rule')
            except Exception as error:
                failures.append(f'{context} {row}: raised {type(error).__name__}')
    return failures
