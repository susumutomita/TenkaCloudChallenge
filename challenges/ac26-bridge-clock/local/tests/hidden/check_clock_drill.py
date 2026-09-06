"""Author-only checks of public arithmetic and the documented construction contract."""
from fixtures.generate import GRADED, normalize_answer, setting, valid_reuse


def run(module, seed):
    case = setting(seed)
    pub, expected = case['public'], case['expected']
    calls = {
        'add': ('add', (pub['u'],pub['v'],pub['n'])),
        'mul': ('mul', (pub['u'],pub['v'],pub['n'])),
        'cover': ('covered', (pub['secret'],pub['cover'],pub['n'])),
        'uncover': ('uncovered', (pub['secret'],pub['cover'],pub['n'])),
        'every': ('every', (pub['secret'],pub['cover'],pub['n'])),
        'count': ('count', (pub['secret'],pub['cover'],pub['n'])),
        'reuse': ('reuse', (pub['known_first'],pub['seen1'],pub['seen2'],pub['n'])),
        'leak': ('leak', (pub['known_first'],pub['seen1'],pub['seen2'],pub['n'])),
    }
    failures = []
    for checkpoint in GRADED:
        name,args = calls[checkpoint]
        try:
            value = normalize_answer(checkpoint,getattr(module,name)(*args))
            correct = valid_reuse(pub,value) if checkpoint == 'reuse' else value == expected[checkpoint]
        except Exception:
            correct = False
        if not correct:
            failures.append(checkpoint + ': does not satisfy the documented calculation or construction')
    return failures
