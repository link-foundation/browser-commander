"""Redaction applied before a trace byte reaches disk (issue #108).

A port of ``js/src/traces/redaction.js``. Browser traces routinely contain
credentials, so redaction runs where the data is produced: inside the page for
DOM and control state (the in-page capture code from ``assets.json`` receives
the selectors and attributes), and here for every URL, header and message the
recorder writes.

URLs are parsed and serialized with :mod:`.whatwg_url`, so a redacted URL is
the same text the JavaScript recorder writes for it.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any, Callable

from .jsonfmt import js_entries, js_string
from .whatwg_url import URLError, parse_form, parse_url, serialize_form, set_param

#: What replaces a redacted value. Recognizable, and never a valid secret.
REDACTED = "[redacted]"

#: Controls whose value is a secret unless the caller says otherwise.
DEFAULT_REDACT_SELECTORS = (
    "input[type=password]",
    "[data-private]",
    "[data-bc-redact]",
)

#: Attributes and headers that carry credentials.
DEFAULT_REDACT_ATTRIBUTES = (
    "authorization",
    "proxy-authorization",
    "cookie",
    "set-cookie",
    "x-api-key",
    "x-auth-token",
    "x-csrf-token",
)

#: Query parameters that carry credentials in a URL.
DEFAULT_REDACT_QUERY_PARAMS = (
    "access_token",
    "api_key",
    "apikey",
    "auth",
    "code",
    "id_token",
    "password",
    "refresh_token",
    "secret",
    "session",
    "signature",
    "token",
)

_ENCODED_MARKER = "%5Bredacted%5D"
_URL_KEY = re.compile(r"url\Z", re.IGNORECASE)

_PRIVACY_KEYS = {
    "redact_selectors": "redactSelectors",
    "redact_attributes": "redactAttributes",
    "redact_query_params": "redactQueryParams",
    "redact_patterns": "redactPatterns",
    "redact": "redact",
    "use_defaults": "useDefaults",
}


@dataclass
class PrivacyOptions:
    """Privacy options in the shape every writer uses."""

    redact_selectors: list[str] = field(default_factory=list)
    redact_attributes: list[str] = field(default_factory=list)
    redact_query_params: list[str] = field(default_factory=list)
    redact_patterns: list[re.Pattern[str]] = field(default_factory=list)
    redact: Callable[[dict[str, Any]], Any] | None = None


def _lower_set(values: Iterable[Any]) -> list[str]:
    seen: dict[str, None] = {}
    for value in values:
        seen.setdefault(js_string(value).lower(), None)
    return list(seen)


def _option(privacy: Mapping[str, Any], name: str, default: Any) -> Any:
    camel = _PRIVACY_KEYS[name]
    if name in privacy and privacy[name] is not None:
        return privacy[name]
    if camel in privacy and privacy[camel] is not None:
        return privacy[camel]
    return default


def normalize_privacy_options(
    privacy: Mapping[str, Any] | PrivacyOptions | None = None,
) -> PrivacyOptions:
    """Turn the caller's ``privacy`` option into the shape every writer uses.

    Keys may be given in snake_case (``redact_query_params``) or in the
    camelCase the JavaScript options use (``redactQueryParams``). Defaults are
    additive: a caller adds to the safe set rather than replacing it, unless
    ``use_defaults`` is false.

    Args:
        privacy: Caller privacy options, or options already normalized

    Returns:
        Normalized privacy options

    Raises:
        TypeError: When the options or the ``redact`` callback have the wrong type
    """
    if isinstance(privacy, PrivacyOptions):
        return privacy
    if privacy is None:
        privacy = {}
    if not isinstance(privacy, Mapping):
        raise TypeError("trace privacy options must be an object")

    redact = _option(privacy, "redact", None)
    if redact is not None and not callable(redact):
        raise TypeError("privacy.redact must be a function")
    use_defaults = _option(privacy, "use_defaults", True)

    def merged(name: str, defaults: Iterable[str]) -> list[str]:
        given = list(_option(privacy, name, []))
        return _lower_set([*(defaults if use_defaults else ()), *given])

    patterns = [
        pattern if isinstance(pattern, re.Pattern) else re.compile(js_string(pattern))
        for pattern in _option(privacy, "redact_patterns", [])
    ]
    return PrivacyOptions(
        redact_selectors=merged("redact_selectors", DEFAULT_REDACT_SELECTORS),
        redact_attributes=merged("redact_attributes", DEFAULT_REDACT_ATTRIBUTES),
        redact_query_params=merged("redact_query_params", DEFAULT_REDACT_QUERY_PARAMS),
        redact_patterns=patterns,
        redact=redact,
    )


def redact_text(
    value: Any,
    privacy: PrivacyOptions,
    context: Mapping[str, Any] | None = None,
) -> Any:
    """Apply the caller's patterns and callback to a string.

    Args:
        value: Text about to be persisted
        privacy: Normalized privacy options
        context: What the text is, passed to the callback

    Returns:
        Redacted text; anything that is not a non-empty string unchanged
    """
    if not isinstance(value, str) or value == "":
        return value

    text = value
    for pattern in privacy.redact_patterns:
        text = pattern.sub(lambda _match: REDACTED, text)

    if privacy.redact is not None:
        replaced = privacy.redact({**dict(context or {}), "value": text})
        if isinstance(replaced, str):
            text = replaced

    return text


def redact_url(url: Any, privacy: PrivacyOptions) -> Any:
    """Redact credentials carried in a URL.

    ``https://user:pass@host/path?token=abc`` becomes a URL that still
    identifies the page without handing over the session it belonged to.

    Args:
        url: URL about to be persisted
        privacy: Normalized privacy options

    Returns:
        Redacted URL; anything that is not a non-empty string unchanged
    """
    if not isinstance(url, str) or url == "":
        return url

    text = url
    try:
        parsed = parse_url(url)
    except URLError:
        # A relative or malformed URL is still worth keeping, just unparsed.
        parsed = None
    if parsed is not None:
        if parsed.username or parsed.password:
            parsed.set_username(REDACTED if parsed.username else "")
            parsed.set_password(REDACTED if parsed.password else "")
        params = parsed.search_params()
        for key in [name for name, _ in params]:
            if key.lower() in privacy.redact_query_params:
                set_param(params, key, REDACTED)
                parsed.set_search_params(params)
        if parsed.hash:
            # Implicit OAuth flows put the token in the fragment.
            fragment = parse_form(parsed.hash[1:])
            changed = False
            for key in [name for name, _ in fragment]:
                if key.lower() in privacy.redact_query_params:
                    set_param(fragment, key, REDACTED)
                    changed = True
            if changed:
                parsed.set_hash(f"#{serialize_form(fragment)}")
        # Percent-encoding the marker is undone: a trace is read by people.
        text = parsed.serialize().replace(_ENCODED_MARKER, REDACTED)

    return redact_text(text, privacy, {"kind": "url"})


def redact_headers(headers: Any, privacy: PrivacyOptions) -> Any:
    """Redact a header or attribute map.

    Args:
        headers: Header name/value pairs
        privacy: Normalized privacy options

    Returns:
        Map with sensitive values replaced
    """
    if not headers or not isinstance(headers, Mapping):
        return headers

    result: dict[str, Any] = {}
    for name, value in js_entries(headers):
        result[name] = (
            REDACTED
            if name.lower() in privacy.redact_attributes
            else redact_text(
                js_string(value), privacy, {"kind": "header", "name": name}
            )
        )
    return result


def redact_value(value: Any, privacy: PrivacyOptions, key: str = "") -> Any:
    """Redact every string in an event payload.

    Args:
        value: Any JSON-compatible value
        privacy: Normalized privacy options
        key: Field name the value was found under

    Returns:
        The value with strings redacted
    """
    if isinstance(value, str):
        if key.lower() in privacy.redact_attributes:
            return REDACTED
        if _URL_KEY.search(key):
            return redact_url(value, privacy)
        return redact_text(value, privacy, {"kind": "field", "name": key})
    if isinstance(value, (list, tuple)):
        return [redact_value(entry, privacy, key) for entry in value]
    if isinstance(value, Mapping):
        return {
            name: redact_value(entry, privacy, name)
            for name, entry in js_entries(value)
        }
    return value
