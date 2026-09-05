"""Author implementation of the published model, never shipped to participants."""

def label(p, secret, scope):
    return (secret * secret + scope) % p


def repeat(p, secret, scope, messages):
    labels = []
    for message in messages:
        labels.append((secret * secret + scope) % p)
    return labels


def scopes(p, secret, scope_ids):
    labels = []
    for scope_id in scope_ids:
        labels.append((secret * secret + scope_id) % p)
    return labels


def accept(scope, attempts):
    used = []
    answers = []
    for attempt in attempts:
        ok = attempt['verified'] and attempt['scope'] == scope and (attempt['nullifier'] not in used)
        answers.append(ok)
        if ok:
            used.append(attempt['nullifier'])
    return answers


def count(scope, attempts):
    used = []
    for attempt in attempts:
        if attempt['verified'] and attempt['scope'] == scope and (attempt['nullifier'] not in used):
            used.append(attempt['nullifier'])
    return len(used)


def message(p, secret, scope, messages):
    used = []
    answers = []
    for vote in messages:
        marker = (secret * secret + scope + vote) % p
        ok = marker not in used
        answers.append(ok)
        if ok:
            used.append(marker)
    return answers


def unchecked(scope, attempts):
    # Author-only exhaustive search, deliberately independent of the grader helper.
    from itertools import permutations
    for order in permutations(range(1,len(attempts)+1),4):
        good=[];bad=[];accepted=blocked=0
        for i in order:
            row=attempts[i-1];marker=row['nullifier']
            eligible=row['verified'] and row['scope']==scope
            if eligible and marker not in good:
                accepted+=1;good.append(marker)
            new=marker not in bad
            bad.append(marker)
            if eligible and new:blocked+=1
        if accepted==2 and blocked==0:return list(order)
    raise ValueError('no witness')


def collision(p, secret, scope):
    # Author-only construction search; published material gives conditions, not this code.
    from fixtures.generate import construct_schedule
    return construct_schedule({'p':p,'secret':secret,'scope':scope})
