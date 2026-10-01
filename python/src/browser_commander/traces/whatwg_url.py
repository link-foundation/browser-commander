"""The part of the WHATWG URL Standard trace redaction relies on (issue #108).

The JavaScript recorder redacts a URL by parsing it with ``URL``, replacing
sensitive query parameters through ``searchParams.set`` and serializing it
again. Python's ``urllib.parse`` neither normalizes nor serializes the same
way, so the same URL would be written differently by the two recorders. This
module follows the standard's parser state machine and serializers closely
enough that both agree, including on dot segments, default ports, percent
encoding and ``application/x-www-form-urlencoded`` round trips.

Only absolute URLs are parsed: ``new URL(url)`` without a base rejects
relative references, and so does :func:`parse_url`.
"""

from __future__ import annotations

import ipaddress
import re
from dataclasses import dataclass, field

SPECIAL_SCHEMES = {
    "ftp": 21,
    "file": None,
    "http": 80,
    "https": 443,
    "ws": 80,
    "wss": 443,
}

_C0_CONTROL = frozenset(chr(code) for code in range(0x20))
_FRAGMENT_SET = frozenset(' "<>`')
_QUERY_SET = frozenset(' "#<>')
_SPECIAL_QUERY_SET = _QUERY_SET | {"'"}
_PATH_SET = _QUERY_SET | frozenset("?^`{}")
_USERINFO_SET = _PATH_SET | frozenset("/:;=@[\\]|")
_FORBIDDEN_HOST = frozenset("\x00\t\n\r #/:<>?@[\\]^|")
_FORBIDDEN_DOMAIN = _FORBIDDEN_HOST | _C0_CONTROL | {"%", "\x7f"}
_FORM_SAFE = frozenset(
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789*-._"
)
_ALPHA = frozenset("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ")
_ALNUM_SCHEME = _ALPHA | frozenset("0123456789+-.")
_HEX = frozenset("0123456789abcdefABCDEF")
_SURROGATE = re.compile("[\ud800-\udfff]")
_EOF = ""


class URLError(ValueError):
    """Raised for input the URL parser rejects."""


@dataclass
class URLRecord:
    """A parsed URL, as the standard's URL record."""

    scheme: str = ""
    username: str = ""
    password: str = ""
    host: str | None = None
    port: int | None = None
    path: list[str] | str = field(default_factory=list)
    query: str | None = None
    fragment: str | None = None

    @property
    def special(self) -> bool:
        """Whether the scheme is one of the special schemes."""
        return self.scheme in SPECIAL_SCHEMES

    @property
    def opaque(self) -> bool:
        """Whether the path is opaque, as in ``about:blank``."""
        return isinstance(self.path, str)

    def can_have_credentials(self) -> bool:
        """Whether the username and password setters apply."""
        return bool(self.host) and self.scheme != "file"

    def set_username(self, value: str) -> None:
        """Mirror the ``username`` setter."""
        if self.can_have_credentials():
            self.username = _encode(_usv(value), _USERINFO_SET)

    def set_password(self, value: str) -> None:
        """Mirror the ``password`` setter."""
        if self.can_have_credentials():
            self.password = _encode(_usv(value), _USERINFO_SET)

    @property
    def hash(self) -> str:
        """Mirror the ``hash`` getter."""
        return f"#{self.fragment}" if self.fragment else ""

    def set_hash(self, value: str) -> None:
        """Mirror the ``hash`` setter."""
        text = value[1:] if value.startswith("#") else value
        if text == "":
            self.fragment = None
            return
        text = re.sub("[\t\n\r]", "", _usv(text))
        self.fragment = "".join(_encode_char(char, _FRAGMENT_SET) for char in text)

    def search_params(self) -> list[list[str]]:
        """Parse the query the way ``url.searchParams`` sees it."""
        return parse_form(self.query) if self.query is not None else []

    def set_search_params(self, pairs: list[list[str]]) -> None:
        """Write ``searchParams`` back, as its update steps do."""
        serialized = serialize_form(pairs)
        self.query = serialized if serialized else None
        if self.query is None and self.opaque:
            self.path = str(self.path).rstrip(" ")

    def serialize(self) -> str:
        """Mirror ``url.href``."""
        output = f"{self.scheme}:"
        if self.host is not None:
            output += "//"
            if self.username or self.password:
                output += self.username
                if self.password:
                    output += f":{self.password}"
                output += "@"
            output += self.host
            if self.port is not None:
                output += f":{self.port}"
        if isinstance(self.path, str):
            output += self.path
        else:
            if self.host is None and len(self.path) > 1 and self.path[0] == "":
                output += "/."
            output += "".join(f"/{segment}" for segment in self.path)
        if self.query is not None:
            output += f"?{self.query}"
        if self.fragment is not None:
            output += f"#{self.fragment}"
        return output


def _usv(text: str) -> str:
    return _SURROGATE.sub("�", text)


def _encode_char(char: str, encode_set: frozenset[str]) -> str:
    if char in encode_set or char in _C0_CONTROL or ord(char) > 0x7E:
        return "".join(f"%{byte:02X}" for byte in char.encode("utf-8"))
    return char


def _encode(text: str, encode_set: frozenset[str]) -> str:
    return "".join(_encode_char(char, encode_set) for char in text)


def percent_decode(data: bytes) -> bytes:
    """Percent-decode bytes, leaving malformed escapes as they are."""
    output = bytearray()
    index = 0
    while index < len(data):
        byte = data[index]
        if (
            byte == 0x25
            and index + 2 < len(data)
            and chr(data[index + 1]) in _HEX
            and chr(data[index + 2]) in _HEX
        ):
            output.append(int(data[index + 1 : index + 3], 16))
            index += 3
            continue
        output.append(byte)
        index += 1
    return bytes(output)


def parse_form(text: str) -> list[list[str]]:
    """Parse ``application/x-www-form-urlencoded`` text into name/value pairs."""
    pairs: list[list[str]] = []
    for sequence in _usv(text).encode("utf-8").split(b"&"):
        if not sequence:
            continue
        name, separator, value = sequence.partition(b"=")
        if not separator:
            value = b""
        pairs.append(
            [
                percent_decode(name.replace(b"+", b" ")).decode("utf-8", "replace"),
                percent_decode(value.replace(b"+", b" ")).decode("utf-8", "replace"),
            ]
        )
    return pairs


def _form_encode(text: str) -> str:
    output = []
    for char in _usv(text):
        if char in _FORM_SAFE:
            output.append(char)
        elif char == " ":
            output.append("+")
        else:
            output.append("".join(f"%{byte:02X}" for byte in char.encode("utf-8")))
    return "".join(output)


def serialize_form(pairs: list[list[str]]) -> str:
    """Serialize name/value pairs as ``URLSearchParams#toString`` does."""
    return "&".join(
        f"{_form_encode(name)}={_form_encode(value)}" for name, value in pairs
    )


def set_param(pairs: list[list[str]], name: str, value: str) -> None:
    """Mirror ``URLSearchParams#set``: replace the first, drop the rest."""
    found = False
    index = 0
    while index < len(pairs):
        if pairs[index][0] == name:
            if found:
                del pairs[index]
                continue
            pairs[index][1] = value
            found = True
        index += 1
    if not found:
        pairs.append([name, value])


def _ipv4_number(text: str) -> int:
    radix = 10
    if len(text) >= 2 and text[:2] in ("0x", "0X"):
        text, radix = text[2:], 16
    elif len(text) >= 2 and text[0] == "0":
        text, radix = text[1:], 8
    if text == "":
        return 0
    digits = {10: "0123456789", 16: "0123456789abcdefABCDEF", 8: "01234567"}[radix]
    if any(char not in digits for char in text):
        raise URLError("invalid IPv4 number")
    return int(text, radix)


def _ends_in_number(domain: str) -> bool:
    parts = domain.split(".")
    if parts[-1] == "":
        if len(parts) == 1:
            return False
        parts.pop()
    last = parts[-1]
    if last and all(char in "0123456789" for char in last):
        return True
    try:
        _ipv4_number(last)
    except URLError:
        return False
    return last != ""


def _parse_ipv4(domain: str) -> str:
    parts = domain.split(".")
    if parts[-1] == "" and len(parts) > 1:
        parts.pop()
    if len(parts) > 4:
        raise URLError("too many IPv4 parts")
    numbers = []
    for part in parts:
        if part == "":
            raise URLError("empty IPv4 part")
        numbers.append(_ipv4_number(part))
    if any(number > 255 for number in numbers[:-1]):
        raise URLError("IPv4 part out of range")
    if numbers[-1] >= 256 ** (5 - len(numbers)):
        raise URLError("IPv4 address out of range")
    address = numbers[-1]
    for index, number in enumerate(numbers[:-1]):
        address += number * 256 ** (3 - index)
    return ".".join(str((address >> shift) & 0xFF) for shift in (24, 16, 8, 0))


def _serialize_ipv6(address: int) -> str:
    pieces = [(address >> (112 - 16 * index)) & 0xFFFF for index in range(8)]
    best_start, best_length = -1, 1
    start = None
    for index in range(9):
        if index < 8 and pieces[index] == 0:
            if start is None:
                start = index
        elif start is not None:
            if index - start > best_length:
                best_start, best_length = start, index - start
            start = None
    output = ""
    ignore = False
    for index, piece in enumerate(pieces):
        if ignore and piece == 0:
            continue
        ignore = False
        if index == best_start:
            output += "::" if index == 0 else ":"
            ignore = True
            continue
        output += f"{piece:x}"
        if index != 7:
            output += ":"
    return output


def _parse_host(text: str, special: bool) -> str:
    if text.startswith("["):
        if not text.endswith("]"):
            raise URLError("unclosed IPv6 address")
        try:
            address = ipaddress.IPv6Address(text[1:-1])
        except ValueError as error:
            raise URLError(str(error)) from error
        return f"[{_serialize_ipv6(int(address))}]"
    if not special:
        if any(char in _FORBIDDEN_HOST for char in text):
            raise URLError("forbidden host code point")
        return "".join(_encode_char(char, frozenset()) for char in text)
    domain = percent_decode(text.encode("utf-8")).decode("utf-8", "replace")
    if domain.isascii():
        ascii_domain = domain.lower()
    else:
        try:
            ascii_domain = domain.lower().encode("idna").decode("ascii")
        except UnicodeError as error:
            raise URLError("invalid domain") from error
    if ascii_domain == "" or any(char in _FORBIDDEN_DOMAIN for char in ascii_domain):
        raise URLError("forbidden domain code point")
    if _ends_in_number(ascii_domain):
        return _parse_ipv4(ascii_domain)
    return ascii_domain


def _is_drive(text: str, normalized: bool = False) -> bool:
    return (
        len(text) == 2
        and text[0] in _ALPHA
        and (text[1] == ":" or (not normalized and text[1] == "|"))
    )


def _starts_with_drive(text: str) -> bool:
    return (
        len(text) >= 2
        and _is_drive(text[:2])
        and (len(text) == 2 or text[2] in "/\\?#")
    )


def _shorten(url: URLRecord) -> None:
    path = url.path
    assert isinstance(path, list)
    if url.scheme == "file" and len(path) == 1 and _is_drive(path[0], True):
        return
    if path:
        path.pop()


def _double_dot(segment: str) -> bool:
    return segment.lower() in ("..", ".%2e", "%2e.", "%2e%2e")


def _single_dot(segment: str) -> bool:
    return segment.lower() in (".", "%2e")


class _Parser:
    """The basic URL parser, for absolute URLs without a base."""

    def __init__(self, text: str) -> None:
        text = text.strip("".join(_C0_CONTROL) + " ")
        self.input = re.sub("[\t\n\r]", "", _usv(text))
        self.url = URLRecord()
        self.pointer = 0
        self.buffer = ""

    def char(self) -> str:
        if self.pointer < len(self.input):
            return self.input[self.pointer]
        return _EOF

    def remaining(self) -> str:
        return self.input[self.pointer + 1 :]

    def parse(self) -> URLRecord:
        state = "scheme start"
        self.at_sign = False
        self.inside_brackets = False
        self.password_token = False
        while True:
            state = getattr(self, "_" + state.replace(" ", "_"))(self.char())
            if self.pointer >= len(self.input):
                return self.url
            self.pointer += 1

    def _scheme_start(self, c: str) -> str:
        if c and c in _ALPHA:
            self.buffer += c.lower()
            return "scheme"
        raise URLError("missing scheme")

    def _scheme(self, c: str) -> str:
        if c and c in _ALNUM_SCHEME:
            self.buffer += c.lower()
            return "scheme"
        if c == ":":
            url = self.url
            url.scheme, self.buffer = self.buffer, ""
            if url.scheme == "file":
                return "file"
            if url.special:
                return "special authority ignore slashes"
            if self.remaining().startswith("/"):
                self.pointer += 1
                return "path or authority"
            url.path = ""
            return "opaque path"
        raise URLError("missing scheme")

    def _special_authority_ignore_slashes(self, c: str) -> str:
        if c in ("/", "\\") and c:
            return "special authority ignore slashes"
        self.pointer -= 1
        return "authority"

    def _path_or_authority(self, c: str) -> str:
        if c == "/":
            return "authority"
        self.pointer -= 1
        return "path"

    def _authority(self, c: str) -> str:
        url = self.url
        if c == "@":
            if self.at_sign:
                self.buffer = "%40" + self.buffer
            self.at_sign = True
            for char in self.buffer:
                if char == ":" and not self.password_token:
                    self.password_token = True
                    continue
                encoded = _encode_char(char, _USERINFO_SET)
                if self.password_token:
                    url.password += encoded
                else:
                    url.username += encoded
            self.buffer = ""
            return "authority"
        if c == _EOF or c in "/?#" or (url.special and c == "\\"):
            if self.at_sign and self.buffer == "":
                raise URLError("missing host")
            self.pointer -= len(self.buffer) + 1
            self.buffer = ""
            return "host"
        self.buffer += c
        return "authority"

    def _host(self, c: str) -> str:
        url = self.url
        if c == ":" and not self.inside_brackets:
            if self.buffer == "":
                raise URLError("missing host")
            url.host, self.buffer = _parse_host(self.buffer, url.special), ""
            return "port"
        if c == _EOF or c in "/?#" or (url.special and c == "\\"):
            self.pointer -= 1
            if url.special and self.buffer == "":
                raise URLError("missing host")
            url.host, self.buffer = _parse_host(self.buffer, url.special), ""
            return "path start"
        if c == "[":
            self.inside_brackets = True
        elif c == "]":
            self.inside_brackets = False
        self.buffer += c
        return "host"

    def _port(self, c: str) -> str:
        url = self.url
        if c and c in "0123456789":
            self.buffer += c
            return "port"
        if c == _EOF or c in "/?#" or (url.special and c == "\\"):
            if self.buffer:
                port = int(self.buffer)
                if port > 65535:
                    raise URLError("port out of range")
                url.port = None if SPECIAL_SCHEMES.get(url.scheme) == port else port
                self.buffer = ""
            self.pointer -= 1
            return "path start"
        raise URLError("invalid port")

    def _file(self, c: str) -> str:
        url = self.url
        url.host = ""
        if c and c in "/\\":
            return "file slash"
        self.pointer -= 1
        return "path"

    def _file_slash(self, c: str) -> str:
        if c and c in "/\\":
            return "file host"
        self.pointer -= 1
        return "path"

    def _file_host(self, c: str) -> str:
        url = self.url
        if c == _EOF or c in "/\\?#":
            self.pointer -= 1
            if _is_drive(self.buffer):
                return "path"
            if self.buffer == "":
                url.host = ""
                return "path start"
            host = _parse_host(self.buffer, True)
            url.host = "" if host == "localhost" else host
            self.buffer = ""
            return "path start"
        self.buffer += c
        return "file host"

    def _path_start(self, c: str) -> str:
        url = self.url
        if url.special:
            if c not in ("/", "\\") or c == _EOF:
                self.pointer -= 1
            return "path"
        if c == "?":
            url.query = ""
            return "query"
        if c == "#":
            url.fragment = ""
            return "fragment"
        if c != _EOF:
            if c != "/":
                self.pointer -= 1
            return "path"
        return "path start"

    def _path(self, c: str) -> str:
        url = self.url
        path = url.path
        assert isinstance(path, list)
        slash = c == "/" or (url.special and c == "\\")
        if c == _EOF or slash or c in ("?", "#"):
            if _double_dot(self.buffer):
                _shorten(url)
                if not slash:
                    path.append("")
            elif _single_dot(self.buffer) and not slash:
                path.append("")
            elif not _single_dot(self.buffer):
                if url.scheme == "file" and not path and _is_drive(self.buffer):
                    self.buffer = self.buffer[0] + ":"
                path.append(self.buffer)
            self.buffer = ""
            if c == "?":
                url.query = ""
                return "query"
            if c == "#":
                url.fragment = ""
                return "fragment"
            return "path"
        self.buffer += _encode_char(c, _PATH_SET)
        return "path"

    def _opaque_path(self, c: str) -> str:
        url = self.url
        if c == "?":
            url.query = ""
            return "query"
        if c == "#":
            url.fragment = ""
            return "fragment"
        if c == " ":
            rest = self.remaining()
            url.path = str(url.path) + ("%20" if rest[:1] in ("?", "#") else " ")
            return "opaque path"
        if c != _EOF:
            url.path = str(url.path) + _encode_char(c, frozenset())
        return "opaque path"

    def _query(self, c: str) -> str:
        url = self.url
        if c == _EOF or c == "#":
            encode_set = _SPECIAL_QUERY_SET if url.special else _QUERY_SET
            url.query = (url.query or "") + _encode(self.buffer, encode_set)
            self.buffer = ""
            if c == "#":
                url.fragment = ""
                return "fragment"
            return "query"
        self.buffer += c
        return "query"

    def _fragment(self, c: str) -> str:
        url = self.url
        if c != _EOF:
            url.fragment = (url.fragment or "") + _encode_char(c, _FRAGMENT_SET)
        return "fragment"


def parse_url(text: str) -> URLRecord:
    """Parse an absolute URL as ``new URL(text)`` does.

    Args:
        text: URL to parse

    Returns:
        The URL record

    Raises:
        URLError: When ``new URL(text)`` would throw
    """
    return _Parser(text).parse()
