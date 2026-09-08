"""Inert, typed values for this problem's dict/list/tuple contracts.

No Python object, pickle, executable decoder or learner-defined method enters the
trusted checker. Tagging also prevents JSON from quietly changing tuple to list,
integer keys to string keys, or booleans to integers.
"""
from __future__ import annotations

import math
from participant.lab import Setting


def encode(value, depth=0):
    if depth > 60:
        raise ValueError('nested value exceeded the limit')
    kind = type(value)
    if kind is bytes:
        return ['bytes', value.hex()]
    if isinstance(value, Setting):
        return ['setting', encode((value.parties, value.modulus, value.inputs), depth+1)]
    if value is None:
        return ['none', None]
    if kind is bool:
        return ['bool', value]
    if kind is int:
        return ['int', value]
    if kind is float and math.isfinite(value):
        return ['float', value]
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
    if kind == 'bytes' and type(value) is str:
        return bytes.fromhex(value)
    if kind == 'setting':
        fields = decode(value, depth+1)
        if type(fields) is not tuple or len(fields) != 3:
            raise ValueError('Malformed setting.')
        return Setting(*fields)
    if kind == 'none' and value is None:
        return None
    if kind == 'bool' and type(value) is bool:
        return value
    if kind == 'int' and type(value) is int:
        return value
    if kind == 'float' and type(value) is float and math.isfinite(value):
        return value
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


def _record_fields(record, required):
    """Retain inert extras; omit only opaque diagnostics the wire cannot carry."""
    if not isinstance(record, dict):
        return record
    result = {}
    for key, item in record.items():
        if key not in required:
            try:
                encode((key, item))
            except (TypeError, ValueError, OverflowError, RecursionError):
                continue
        result[key] = item
    return result


def transcript_fields(value):
    """Keep serializable extras available when the transcript returns to view."""
    if not isinstance(value, dict):
        return value
    result = _record_fields(value, ('output', 'messages', 'public', 'rounds'))
    for name, keys in (('messages', ('from', 'to', 'value')), ('public', ('kind', 'from', 'value'))):
        records = result.get(name)
        if isinstance(records, (list, tuple)):
            projected = [_record_fields(row, keys) for row in records]
            result[name] = tuple(projected) if isinstance(records, tuple) else projected
    return result
