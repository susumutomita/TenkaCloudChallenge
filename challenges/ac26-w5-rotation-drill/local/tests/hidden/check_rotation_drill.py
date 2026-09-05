"""Author-only correctness checks; the direct-answer verifier never runs learner code."""
from fixtures.generate import GRADED,normalize_answer,setting,valid_window,valid_edge
from participant.exercise import EXAMPLE,EXAMPLE_EXPECTED,call_row


def run(module,seed):
    fixture=setting(seed)
    failures=[]
    for context,inputs,expected in [('example',EXAMPLE,EXAMPLE_EXPECTED),('deployment',fixture['public'],fixture['expected'])]:
        for row in GRADED:
            try:
                actual=normalize_answer(row,call_row(module,row,inputs))
                valid=(valid_window if row=='window' else valid_edge)(inputs,actual) if row in ('window','edge') else actual is not None and actual==normalize_answer(row,expected[row])
                if not valid:
                    failures.append(f'{context} {row}: result differs from the stated rule')
            except Exception as error:
                failures.append(f'{context} {row}: raised {type(error).__name__}')
    return failures
