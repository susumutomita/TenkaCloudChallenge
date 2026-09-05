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
    used = []
    answers = []
    for attempt in attempts:
        ok = attempt['scope'] == scope and attempt['nullifier'] not in used
        answers.append(ok and (not attempt['verified']))
        if ok:
            used.append(attempt['nullifier'])
    return answers


def collision(p, secret, scope):
    target = (secret * secret + scope) % p
    matches = []
    for candidate in range(p):
        if candidate != secret and (candidate * candidate + scope) % p == target:
            matches.append(candidate)
    return matches[0]
