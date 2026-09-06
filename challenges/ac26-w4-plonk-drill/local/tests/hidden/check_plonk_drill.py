"""Author arithmetic/constructive checks; the verifier never executes learner code."""
from fixtures.generate import GRADED,normalize_answer,setting
from verifier.expected import expected_for,valid_construction
from participant.exercise import EXAMPLE,EXAMPLE_EXPECTED,call_row,construction_valid

def run(module,seed):
    failures=[]
    for context,inputs,expected in [('example',EXAMPLE,EXAMPLE_EXPECTED),('deployment',setting(seed)['public'],expected_for(seed))]:
        for row in GRADED:
            try:
                actual=normalize_answer(row,call_row(module,row,inputs))
                if row=='miss-count':
                    correct=construction_valid(actual,inputs) if context=='example' else actual is not None and valid_construction(seed,actual)
                else:correct=actual==normalize_answer(row,expected[row])
                if actual is None or not correct:failures.append(f'{context} {row}: result violates a published condition')
            except Exception as error:failures.append(f'{context} {row}: raised {type(error).__name__}')
    return failures
