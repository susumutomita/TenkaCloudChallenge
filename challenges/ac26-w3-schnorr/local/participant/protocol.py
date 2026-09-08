"""Inert, typed values for this problem's dict/list/tuple contracts.

No Python object, pickle, executable decoder or learner-defined method enters the
trusted checker. Tagging also prevents JSON from quietly changing tuple to list,
integer keys to string keys, or booleans to integers.
"""
from __future__ import annotations

import math
try:
    from participant.group import Point, Group
except ModuleNotFoundError:
    from group import Point, Group


def encode(value, depth=0):
    if depth > 60:
        raise ValueError('nested value exceeded the limit')
    kind = type(value)
    if isinstance(value, Point):
        return ['point', encode((value.params, value.x, value.y), depth+1)]
    if isinstance(value, Group):
        return ['group', encode((value.p, value.a, value.b, value.generator.x, value.generator.y, value.n), depth+1)]
    if value is None:
        return ['none', None]
    if kind is bool:
        return ['bool', value]
    if kind is int:
        return ['int', value]
    if kind is float and math.isfinite(value):
        return ['float', value]
    if kind is bytearray:
        return ['bytearray', value.hex()]
    if kind is bytes:
        return ['bytes', value.hex()]
    if kind is str:
        return ['str', value]
    if isinstance(value, (list, tuple)):
        return ['tuple' if isinstance(value, tuple) else 'list',
                [encode(item, depth+1) for item in value]]
    if isinstance(value, dict):
        return ['dict', [[encode(key, depth+1), encode(item, depth+1)]
                         for key, item in value.items()]]
    raise TypeError('unsupported return value')


def decode(frame, depth=0):
    if depth > 60 or type(frame) is not list or len(frame) != 2:
        raise ValueError('invalid value frame')
    kind, value = frame
    if kind in ('point', 'group'):
        items = decode(value, depth+1)
        if kind == 'point' and type(items) is tuple and len(items) == 3:
            params, x, y = items
            if (type(params) is tuple and len(params) == 3 and all(type(n) is int for n in params)
                    and params[0] > 1 and ((x is None and y is None) or (type(x) is int and type(y) is int))):
                return Point(params, x, y)
        if kind == 'group' and type(items) is tuple and len(items) == 6 and all(type(n) is int for n in items) and items[0] > 1:
            return Group(*items)
        raise ValueError('invalid curve value')
    if kind == 'none' and value is None:
        return None
    if kind == 'bool' and type(value) is bool:
        return value
    if kind == 'int' and type(value) is int:
        return value
    if kind == 'float' and type(value) is float and math.isfinite(value):
        return value
    if kind == 'bytearray' and type(value) is str:
        return bytearray.fromhex(value)
    if kind == 'bytes' and type(value) is str:
        return bytes.fromhex(value)
    if kind == 'str' and type(value) is str:
        return value
    if kind in ('list', 'tuple') and type(value) is list:
        items = [decode(item, depth+1) for item in value]
        return tuple(items) if kind == 'tuple' else items
    if kind == 'dict' and type(value) is list:
        result = {}
        for pair in value:
            if type(pair) is not list or len(pair) != 2:
                raise ValueError('invalid dictionary entry')
            key = decode(pair[0], depth+1)
            if key in result:
                raise ValueError('duplicate dictionary key')
            result[key] = decode(pair[1], depth+1)
        return result
    raise ValueError('invalid value type')
