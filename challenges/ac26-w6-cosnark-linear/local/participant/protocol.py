"""Typed values and opaque MPC handles. No pickle, code, seed or verdict crosses."""
import secrets
from participant.mpc import Share, ParticipantRuntime


class HiddenShare(Share):
    @property
    def _value(self):
        raise AttributeError('Use the supplied runtime to read a share.')


class Codec:
    def __init__(self, *, parent=False, runtime_factory=None):
        self.parent = parent
        self.runtime_factory = runtime_factory
        self.objects = {}
        self.tokens = {}

    def encode(self, value, depth=0):
        if depth > 60:
            raise ValueError("Function value exceeds the nesting limit.")
        if value is None or type(value) in (bool, int, float, str):
            return ['scalar', value]
        if isinstance(value, (list, tuple, set, frozenset)):
            kind = 'tuple' if isinstance(value, tuple) else 'set' if isinstance(value, (set, frozenset)) else 'list'
            return [kind, [self.encode(item, depth + 1) for item in value]]
        if isinstance(value, dict):
            return ['dict', [[self.encode(k, depth + 1), self.encode(v, depth + 1)] for k, v in value.items()]]
        token = self.tokens.get(id(value))
        if token is not None:
            return ['ref', token]
        if not self.parent:
            raise ValueError('Only supplied or runtime-issued MPC objects can be returned.')
        if not isinstance(value, (Share, ParticipantRuntime)):
            raise ValueError('Unsupported function value.')
        token = secrets.token_hex(16)
        self.tokens[id(value)] = token
        self.objects[token] = value
        if isinstance(value, Share):
            return ['share', [token, value.party, value.field, value.id]]
        methods = ['value_of', 'add', 'mul_public', 'zero', 'events', 'violations', 'ancestry', 'issued']
        if hasattr(value, 'reconstruct'):
            methods.append('reconstruct')
        return ['runtime', [token, self.encode(value.setting, depth + 1), methods]]

    def decode(self, record, depth=0):
        if depth > 60:
            raise ValueError("Function value exceeds the nesting limit.")
        if not isinstance(record, list) or len(record) != 2:
            raise ValueError('Malformed function value.')
        kind, data = record
        if kind == 'scalar' and (data is None or type(data) in (bool, int, float, str)):
            return data
        if kind in ('list', 'tuple', 'set') and isinstance(data, list):
            items = [self.decode(item, depth + 1) for item in data]
            return tuple(items) if kind == 'tuple' else set(items) if kind == 'set' else items
        if kind == 'dict' and isinstance(data, list):
            result = {}
            for pair in data:
                if not isinstance(pair, list) or len(pair) != 2:
                    raise ValueError('Malformed dictionary entry.')
                key, value = self.decode(pair[0], depth + 1), self.decode(pair[1], depth + 1)
                if key in result:
                    raise ValueError('Repeated dictionary key.')
                result[key] = value
            return result
        if kind == 'ref' and isinstance(data, str) and data in self.objects:
            return self.objects[data]
        if self.parent:
            raise ValueError('A child cannot create an MPC object.')
        if kind == 'share':
            token, party, field, name = data
            obj = object.__new__(HiddenShare)
            obj.party, obj.field, obj.id = party, field, name
        elif kind == 'runtime':
            token, setting, methods = data
            obj = self.runtime_factory(token, self.decode(setting, depth + 1), methods)
        else:
            raise ValueError('Unsupported function value.')
        self.objects[token] = obj
        self.tokens[id(obj)] = token
        return obj
