"""Author-only correctness checks; the direct-answer verifier never runs learner code."""
from fixtures.generate import GRADED,normalize_answer,setting,valid_binding
from participant.exercise import EXAMPLE,EXAMPLE_EXPECTED,call_row


def run(module,seed):
    fixture=setting(seed)
    failures=[]
    for context,inputs,expected in [('example',EXAMPLE,EXAMPLE_EXPECTED),('deployment',fixture['public'],fixture['expected'])]:
        for row in GRADED:
            try:
                actual=normalize_answer(row,call_row(module,row,inputs))
                if (not valid_binding(inputs, actual)) if row == 'binding' else (actual is None or actual!=normalize_answer(row,expected[row])):
                    failures.append(f'{context} {row}: result differs from the stated rule')
            except Exception as error:
                failures.append(f'{context} {row}: raised {type(error).__name__}')
    return failures
