"""JSON and value formatting that matches what JavaScript writes (issue #108).

A trace written from Python has to be byte-for-byte what the JavaScript
recorder writes for the same run, so a bundle can be compared, diffed and
replayed by any of the three readers. ``json.dumps`` comes close but differs in
a handful of places that show up in real traces:

- an integral float such as ``2.0`` is ``2`` in JavaScript;
- ``1e-07`` is ``1e-7`` and ``1e+16`` is ``10000000000000000``;
- ``NaN`` and the infinities are ``null``;
- object keys that look like array indices come first, in numeric order;
- ``undefined`` drops a key from an object and is ``null`` inside an array.

This module writes values the way ``JSON.stringify`` does, with an
:data:`UNDEFINED` sentinel standing in for JavaScript's ``undefined``.
"""

from __future__ import annotations

import datetime as _datetime
import json
import math
import re
from collections.abc import Iterable, Mapping
from typing import Any


class _Undefined:
    """JavaScript's ``undefined``: a missing value, unlike ``None``."""

    _instance: _Undefined | None = None

    def __new__(cls) -> _Undefined:
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __repr__(self) -> str:
        return "UNDEFINED"

    def __bool__(self) -> bool:
        return False


#: Stands in for JavaScript's ``undefined``.
UNDEFINED: Any = _Undefined()

_MAX_ARRAY_INDEX = 2**32 - 1
_INDEX_KEY = re.compile(r"^(?:0|[1-9][0-9]*)$")
_SURROGATE = re.compile("[\ud800-\udfff]")


def is_missing(value: Any) -> bool:
    """Tell whether ``value`` is JavaScript's ``null`` or ``undefined``.

    Args:
        value: Any value

    Returns:
        True for ``None`` and :data:`UNDEFINED`
    """
    return value is None or value is UNDEFINED


def coalesce(*values: Any) -> Any:
    """Return the first value that is not missing, like JavaScript's ``??``.

    Args:
        *values: Candidates, in order

    Returns:
        The first candidate that is not ``None`` or :data:`UNDEFINED`, or
        ``None`` when all of them are
    """
    for value in values:
        if not is_missing(value):
            return value
    return None


def js_keys(mapping: Mapping[Any, Any]) -> list[Any]:
    """Order a mapping's keys the way a JavaScript object enumerates them.

    Keys that are canonical array indices come first, in ascending numeric
    order; every other key keeps its insertion order.

    Args:
        mapping: Mapping to order

    Returns:
        The keys, in JavaScript enumeration order
    """
    indices: list[tuple[int, Any]] = []
    others: list[Any] = []
    for key in mapping:
        text = str(key)
        if _INDEX_KEY.match(text) and int(text) < _MAX_ARRAY_INDEX:
            indices.append((int(text), key))
        else:
            others.append(key)
    if not indices:
        return others
    indices.sort(key=lambda item: item[0])
    return [key for _, key in indices] + others


def js_entries(mapping: Mapping[Any, Any]) -> list[tuple[str, Any]]:
    """Mirror ``Object.entries`` on a mapping.

    Args:
        mapping: Mapping to enumerate

    Returns:
        ``(key, value)`` pairs in JavaScript enumeration order
    """
    return [(str(key), mapping[key]) for key in js_keys(mapping)]


def js_number(value: float | int) -> str:
    """Format a number the way JavaScript's ``Number#toString`` does.

    Args:
        value: Number to format

    Returns:
        The text JavaScript would produce
    """
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if math.isnan(value):
        return "NaN"
    if math.isinf(value):
        return "Infinity" if value > 0 else "-Infinity"
    if value == 0:
        return "0"
    sign = "-" if value < 0 else ""
    text = repr(abs(value))
    if "e" in text:
        mantissa, exponent_text = text.split("e")
        exponent = int(exponent_text)
    else:
        mantissa, exponent = text, 0
    whole, _, fraction = mantissa.partition(".")
    digits = whole + fraction
    point = len(whole) + exponent
    stripped = digits.lstrip("0")
    point -= len(digits) - len(stripped)
    digits = stripped.rstrip("0") or "0"
    count = len(digits)
    if count <= point <= 21:
        body = digits + "0" * (point - count)
    elif 0 < point <= 21:
        body = f"{digits[:point]}.{digits[point:]}"
    elif -6 < point <= 0:
        body = f"0.{'0' * -point}{digits}"
    else:
        exponent = point - 1
        mark = "+" if exponent >= 0 else "-"
        rest = f".{digits[1:]}" if count > 1 else ""
        body = f"{digits[0]}{rest}e{mark}{abs(exponent)}"
    return sign + body


def js_string(value: Any) -> str:
    """Stringify a value the way a JavaScript template literal does.

    Args:
        value: Value to interpolate

    Returns:
        The text ``${value}`` would produce
    """
    if value is UNDEFINED:
        return "undefined"
    if value is None:
        return "null"
    if isinstance(value, str):
        return value
    if isinstance(value, (bool, int, float)):
        return js_number(value)
    if isinstance(value, (list, tuple)):
        return ",".join("" if is_missing(item) else js_string(item) for item in value)
    if isinstance(value, Mapping):
        return "[object Object]"
    return str(value)


def js_truthy(value: Any) -> bool:
    """Tell whether JavaScript would treat ``value`` as true.

    Args:
        value: Any value

    Returns:
        JavaScript truthiness: objects and arrays are always true
    """
    if is_missing(value):
        return False
    if isinstance(value, (Mapping, list, tuple)):
        return True
    if isinstance(value, float) and math.isnan(value):
        return False
    return bool(value)


def js_round(value: float) -> int:
    """Round the way ``Math.round`` does: halves go up.

    Args:
        value: Number to round

    Returns:
        The nearest integer, with halves rounded towards positive infinity
    """
    return math.floor(value + 0.5)


def iso_timestamp(milliseconds: float) -> str:
    """Format epoch milliseconds the way ``Date#toISOString`` does.

    Args:
        milliseconds: Milliseconds since the Unix epoch

    Returns:
        A UTC timestamp such as ``2026-01-01T00:00:00.000Z``
    """
    whole = int(milliseconds)
    epoch = _datetime.datetime(1970, 1, 1, tzinfo=_datetime.timezone.utc)
    moment = epoch + _datetime.timedelta(milliseconds=whole)
    return f"{moment.strftime('%Y-%m-%dT%H:%M:%S')}.{moment.microsecond // 1000:03d}Z"


def _string(value: str) -> str:
    text = json.dumps(value, ensure_ascii=False)
    if _SURROGATE.search(text):
        text = _SURROGATE.sub(lambda match: f"\\u{ord(match.group()):04x}", text)
    return text


def _is_sequence(value: Any) -> bool:
    return isinstance(value, (list, tuple))


def _to_json(value: Any) -> Any:
    to_json = getattr(value, "to_json", None)
    if callable(to_json):
        return to_json()
    return value


def _scalar(value: Any) -> str | None:
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return "null"
        return js_number(value)
    if isinstance(value, str):
        return _string(value)
    return None


def _items(mapping: Mapping[Any, Any]) -> Iterable[tuple[str, Any]]:
    for key in js_keys(mapping):
        item = mapping[key]
        if item is UNDEFINED or callable(item):
            continue
        yield str(key), item


def _encode(value: Any, indent: str, depth: int) -> str | None:
    value = _to_json(value)
    if value is UNDEFINED or callable(value):
        return None
    scalar = _scalar(value)
    if scalar is not None:
        return scalar
    if isinstance(value, (bytes, bytearray)):
        return _encode(
            {"type": "Buffer", "data": list(value)},
            indent,
            depth,
        )
    inner = "\n" + indent * (depth + 1) if indent else ""
    outer = "\n" + indent * depth if indent else ""
    colon = ": " if indent else ":"
    if _is_sequence(value):
        if not value:
            return "[]"
        parts = []
        for item in value:
            encoded = _encode(item, indent, depth + 1)
            parts.append("null" if encoded is None else encoded)
        return "[" + inner + ("," + inner).join(parts) + outer + "]"
    if isinstance(value, Mapping):
        parts = []
        for key, item in _items(value):
            encoded = _encode(item, indent, depth + 1)
            if encoded is not None:
                parts.append(_string(key) + colon + encoded)
        if not parts:
            return "{}"
        return "{" + inner + ("," + inner).join(parts) + outer + "}"
    if isinstance(value, (set, frozenset)):
        return "{}"
    return _string(str(value))


def stringify(value: Any, indent: int | None = None) -> str | None:
    """Serialize a value exactly as ``JSON.stringify(value, null, indent)``.

    Args:
        value: Value to serialize
        indent: Spaces per level, or None for the compact form

    Returns:
        The JSON text, or None where JavaScript returns ``undefined``
    """
    return _encode(value, " " * indent if indent else "", 0)


def dumps(value: Any) -> str:
    """Serialize a value compactly, writing ``null`` for ``undefined``.

    Args:
        value: Value to serialize

    Returns:
        The JSON text
    """
    text = stringify(value)
    return "null" if text is None else text


def dumps_pretty(value: Any) -> str:
    """Serialize a value with two-space indentation and a trailing newline.

    Args:
        value: Value to serialize

    Returns:
        The JSON text, as the recorder writes members such as the manifest
    """
    text = stringify(value, 2)
    return ("null" if text is None else text) + "\n"


def utf16_length(text: str) -> int:
    """Measure a string the way JavaScript's ``String#length`` does.

    Args:
        text: Text to measure

    Returns:
        Its length in UTF-16 code units
    """
    return len(text) + sum(1 for char in text if ord(char) > 0xFFFF)
