"""Private fixtures for a tiny nullifier/state model, not cryptographic anonymity."""
from __future__ import annotations
import hashlib
LINES = GRADED = ('label','repeat','scopes','accept','count','message','unchecked','collision')
SHAPES = {'label':'int','repeat':('int',2),'scopes':('int',2),'accept':('bool',6),
          'count':'int','message':('bool',2),'unchecked':('bool',6),'collision':'int'}


def _draw(seed, label, low, high):
    span=high-low+1
    limit=(1<<64)-(1<<64)%span
    for retry in range(128):
        value=int.from_bytes(hashlib.sha256(f'{seed}:{label}:{retry}'.encode()).digest()[:8],'big')
        if value<limit:return low+value%span
    raise RuntimeError('could not draw a fixture value')


def _order(seed, label, values):
    return [values[i] for i in sorted(range(len(values)), key=lambda i:hashlib.sha256(f'{seed}:{label}:{i}'.encode()).digest())]


def setting(seed):
    p=(5,7)[_draw(seed,'divisor',0,1)]
    secret=_draw(seed,'secret',1,p-1)
    scope=_draw(seed,'scope',1,3)
    scope_ids=[scope,scope+1]
    messages=[_draw(seed,'vote-0',0,1),_draw(seed,'vote-1',0,1)]
    valid_labels={(s*s+scope)%p for s in range(p)}
    foreign_labels={(s*s+scope+1)%p for s in range(p)}
    y=_order(seed,'shared-label',sorted(valid_labels & foreign_labels))[0]
    x,z=_order(seed,'labels',sorted(valid_labels-{y}))[:2]
    def attempt(verified, scope_id, label):
        return {'verified':verified,'scope':scope_id,'nullifier':label}
    groups=_order(seed,'attempt-groups',[
        [attempt(False,scope,x),attempt(True,scope,x),attempt(True,scope,x)],
        [attempt(True,scope+1,y),attempt(True,scope,y)],
        [attempt(bool(_draw(seed,"third-proof",0,1)),scope,z)],
    ])
    attempts=[item for group in groups for item in group]
    label=(secret*secret+scope)%p
    seen=set(); accepted=[]
    bad_seen=set(); unchecked=[]
    for item in attempts:
        right_scope=item['scope']==scope
        good=item['verified'] and right_scope and item['nullifier'] not in seen
        accepted.append(good)
        if good:seen.add(item['nullifier'])
        bad=right_scope and item['nullifier'] not in bad_seen
        unchecked.append(bad and not good)
        if bad:bad_seen.add(item['nullifier'])
    bad_message_seen=set(); message=[]
    for vote in messages:
        wrong=(secret*secret+scope+vote)%p
        message.append(wrong not in bad_message_seen)
        bad_message_seen.add(wrong)
    expected={'label':label,'repeat':(label,label),
              'scopes':tuple((secret*secret+s)%p for s in scope_ids),
              'accept':tuple(accepted),'count':len(seen),'message':tuple(message),
              'unchecked':tuple(unchecked),'collision':p-secret}
    public={'p':p,'secret':secret,'scope':scope,'scope_ids':scope_ids,
            'messages':messages,'attempts':attempts}
    return {'public':public,'expected':expected}


def assignments(seed):
    return '\n'.join(f'{name} = {value!r}' for name,value in setting(seed)['public'].items())


def submission_binding(seed):
    return hashlib.sha256(('ac26-w6-nullifier-drill:submission:v1\0'+seed).encode()).hexdigest()


def _clean_token(token: str) -> str:
    """Strip surrounding whitespace and a single layer of quotes Python's own repr adds."""
    token = token.strip()
    if len(token) >= 2 and token[0] == token[-1] and token[0] in "'\"":
        token = token[1:-1]
    return token.strip()


def normalize_scalar(kind: str, raw: object):
    """Normalize one scalar of the given kind, or return None if it does not fit.

    Implements every kind the shared shape grammar defines (int / bool / hex / str),
    not only the ones this drill's own SHAPES table uses, so the three sibling drills'
    value graders share one normalizer contract.
    """
    if kind == "int":
        if isinstance(raw, bool):
            return None
        if isinstance(raw, int):
            return raw
        if isinstance(raw, str):
            try:
                return int(_clean_token(raw))
            except ValueError:
                return None
        return None
    if kind == "bool":
        if isinstance(raw, bool):
            return raw
        if isinstance(raw, str) and _clean_token(raw).lower() in ("true", "false"):
            return _clean_token(raw).lower() == "true"
        return None
    if kind == "hex":
        if not isinstance(raw, str):
            return None
        token = _clean_token(raw)
        if token == "":
            return None
        try:
            int(token, 16)
        except ValueError:
            return None
        return token.lower()
    if kind == "str":
        if not isinstance(raw, str):
            return None
        token = _clean_token(raw)
        return token if token != "" else None
    return None


def _split_tuple_text(raw: str) -> list[str] | None:
    """Split a pasted tuple-like string into its comma-separated parts.

    Accepts `(1, 2)`, `[1, 2]`, and bare `1, 2` -- outer brackets are optional, and are
    the only structure stripped, so a hex or string entry keeps its own quotes intact
    for `normalize_scalar` to peel off itself.
    """
    cleaned = raw.strip()
    if len(cleaned) >= 2 and cleaned[0] in "([" and cleaned[-1] in ")]":
        cleaned = cleaned[1:-1]
    if cleaned.strip() == "":
        return None
    parts = [part.strip() for part in cleaned.split(",")]
    parts = [part for part in parts if part != ""]
    return parts or None


def normalize_answer(line: str, raw: object):
    """Turn whatever the learner pasted into the shape this line's answer has.

    Every graded line declares its shape in SHAPES: a scalar ("int" / "bool" / "hex" /
    "str") or a fixed-width tuple of one of those, e.g. ("int", 2). A tuple may arrive as
    a JSON list `[1, 2]` (the verifier tries `json.loads` before calling this function),
    a Python tuple/list literal typed as text `(1, 2)` / `[1, 2]`, or bare comma-
    separated values `1, 2`.
    """
    shape = SHAPES.get(line)
    if shape is None:
        return None
    if isinstance(shape, tuple):
        kind, width = shape
        if isinstance(raw, str):
            parts = _split_tuple_text(raw)
            if parts is None:
                return None
        elif isinstance(raw, (list, tuple)):
            parts = list(raw)
        else:
            return None
        if len(parts) != width:
            return None
        values = [normalize_scalar(kind, part) for part in parts]
        if any(value is None for value in values):
            return None
        return tuple(values)
    return normalize_scalar(shape, raw)
