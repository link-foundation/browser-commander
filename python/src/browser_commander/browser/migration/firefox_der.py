"""A minimal DER decoder for the ASN.1 structures in Firefox's NSS stores.

``key4.db`` and ``logins.json`` hold DER-encoded blobs: an algorithm
identifier (with its parameters) wrapped around ciphertext. Only definite
lengths and the handful of tags NSS uses are needed, so this stays tiny
instead of pulling in an ASN.1 library.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

__all__ = [
    "DER_TAG",
    "DerElement",
    "decode_der_element",
    "decode_der_sequence",
    "oid_to_string",
]

#: Universal tags used by NSS blobs.
DER_TAG: Final = {
    "INTEGER": 0x02,
    "OCTET_STRING": 0x04,
    "NULL": 0x05,
    "OID": 0x06,
    "SEQUENCE": 0x30,
}


@dataclass(frozen=True)
class DerElement:
    """One decoded DER element.

    ``children`` is set for constructed elements (``tag & 0x20``) and holds the
    decoded content; it is ``None`` for primitive elements.
    """

    tag: int
    length: int
    header: int
    content_start: int
    end: int
    content: bytes
    children: list[DerElement] | None


def decode_der_element(buffer: bytes, offset: int = 0) -> DerElement:
    """Decode the element that starts at ``offset`` in ``buffer``.

    Raises:
        ValueError: When the buffer ends before the element does.
    """

    if offset + 2 > len(buffer):
        msg = "DER element is truncated"
        raise ValueError(msg)
    tag = buffer[offset]
    cursor = offset + 1
    length = buffer[cursor]
    cursor += 1
    if length & 0x80:
        length_bytes = length & 0x7F
        length = 0
        for _ in range(length_bytes):
            if cursor >= len(buffer):
                msg = "DER length is truncated"
                raise ValueError(msg)
            length = length * 256 + buffer[cursor]
            cursor += 1
    content_start = cursor
    end = content_start + length
    if end > len(buffer):
        msg = "DER content is truncated"
        raise ValueError(msg)
    content = bytes(buffer[content_start:end])
    constructed = (tag & 0x20) != 0
    return DerElement(
        tag=tag,
        length=length,
        header=content_start - offset,
        content_start=content_start,
        end=end,
        content=content,
        children=decode_der_sequence(content) if constructed else None,
    )


def decode_der_sequence(content: bytes) -> list[DerElement]:
    """Decode every element in the content of a constructed element."""

    elements: list[DerElement] = []
    offset = 0
    while offset < len(content):
        element = decode_der_element(content, offset)
        elements.append(element)
        offset = element.end
    return elements


def oid_to_string(content: bytes) -> str:
    """Render the content bytes of an OBJECT IDENTIFIER as dotted text."""

    if not content:
        return ""
    parts = [content[0] // 40, content[0] % 40]
    value = 0
    for byte in content[1:]:
        value = value * 128 + (byte & 0x7F)
        if (byte & 0x80) == 0:
            parts.append(value)
            value = 0
    return ".".join(str(part) for part in parts)
