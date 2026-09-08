"""Typed data for the value-only worker channel; never deserialize Python objects."""
from participant.lab import Disclosure


def encode(value, depth=0):
    if depth > 60:
        raise ValueError("Function value exceeds the nesting limit.")
    if value is None or type(value) in (bool, int, float, str):
        return ['scalar', value]
    if isinstance(value, (bytes, bytearray)):
        return ['bytearray' if isinstance(value, bytearray) else 'bytes', bytes(value).hex()]
    if isinstance(value, (list, tuple)):
        return ['tuple' if isinstance(value, tuple) else 'list', [encode(item, depth + 1) for item in value]]
    if isinstance(value, dict):
        return ['dict', [[encode(key, depth + 1), encode(item, depth + 1)] for key, item in value.items()]]
    if isinstance(value, Disclosure):
        return ['disclosure', encode({name: getattr(value, name) for name in Disclosure.__slots__}, depth + 1)]
    raise ValueError('Unsupported function value type.')


def decode(record, depth=0):
    if depth > 60:
        raise ValueError("Function value exceeds the nesting limit.")
    if not isinstance(record, list) or len(record) != 2:
        raise ValueError('Malformed function value.')
    kind, data = record
    if kind == 'scalar' and (data is None or type(data) in (bool, int, float, str)):
        return data
    if kind in ('bytes', 'bytearray') and isinstance(data, str):
        value = bytes.fromhex(data)
        return bytearray(value) if kind == 'bytearray' else value
    if kind in ('list', 'tuple') and isinstance(data, list):
        result = [decode(item, depth + 1) for item in data]
        return tuple(result) if kind == 'tuple' else result
    if kind == 'dict' and isinstance(data, list):
        result = {}
        for pair in data:
            if not isinstance(pair, list) or len(pair) != 2:
                raise ValueError('Malformed dictionary entry.')
            key, value = decode(pair[0], depth + 1), decode(pair[1], depth + 1)
            if key in result:
                raise ValueError('Repeated dictionary key.')
            result[key] = value
        return result
    if kind == 'disclosure':
        fields = decode(data, depth + 1)
        if not isinstance(fields, dict) or set(fields) != set(Disclosure.__slots__):
            raise ValueError('Malformed disclosure.')
        return Disclosure(**fields)
    raise ValueError('Unsupported function value.')
