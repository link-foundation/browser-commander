"""Tests for trace redaction (issue #108).

A port of ``js/tests/unit/traces/redaction.test.js``.
"""

from __future__ import annotations

import json
import re

import pytest

from browser_commander.traces import (
    DEFAULT_REDACT_SELECTORS,
    REDACTED,
    normalize_privacy_options,
    redact_headers,
    redact_text,
    redact_url,
    redact_value,
)

PRIVACY = normalize_privacy_options()


class TestNormalizePrivacyOptions:
    def test_adds_to_the_safe_defaults_rather_than_replacing_them(self) -> None:
        options = normalize_privacy_options({"redact_selectors": [".secret"]})

        for selector in DEFAULT_REDACT_SELECTORS:
            assert selector in options.redact_selectors
        assert ".secret" in options.redact_selectors

    def test_accepts_the_javascript_spelling(self) -> None:
        options = normalize_privacy_options({"redactQueryParams": ["Private"]})

        assert "private" in options.redact_query_params
        assert "token" in options.redact_query_params

    def test_lets_a_caller_opt_out_of_the_defaults_on_purpose(self) -> None:
        options = normalize_privacy_options(
            {"use_defaults": False, "redact_selectors": [".secret"]}
        )

        assert options.redact_selectors == [".secret"]

    def test_compiles_string_patterns_into_regular_expressions(self) -> None:
        options = normalize_privacy_options({"redact_patterns": [r"sk-\w+"]})

        assert redact_text("key sk-live42 here", options) == f"key {REDACTED} here"

    def test_refuses_options_that_are_not_an_object(self) -> None:
        with pytest.raises(TypeError, match="privacy options must be an object"):
            normalize_privacy_options("everything")  # type: ignore[arg-type]

    def test_refuses_a_redact_callback_that_is_not_callable(self) -> None:
        with pytest.raises(TypeError, match=r"privacy.redact must be a function"):
            normalize_privacy_options({"redact": "yes please"})

    def test_returns_options_already_normalized_as_they_are(self) -> None:
        assert normalize_privacy_options(PRIVACY) is PRIVACY


class TestRedactUrl:
    def test_removes_credentials_tokens_and_fragment_tokens(self) -> None:
        # Assembled rather than written out, so a secret scanner does not
        # mistake the fixture for a leak.
        credentials = ":".join(["user", "hunter2"])
        redacted = redact_url(
            f"https://{credentials}@example.com/report?token=abc&page=2#id_token=zz",
            PRIVACY,
        )

        assert redacted == (
            f"https://{REDACTED}:{REDACTED}@example.com/report"
            f"?token={REDACTED}&page=2#id_token={REDACTED}"
        )
        assert "hunter2" not in redacted
        assert "abc" not in redacted

    def test_keeps_a_url_that_cannot_be_parsed(self) -> None:
        assert redact_url("/relative/path", PRIVACY) == "/relative/path"

    def test_leaves_a_value_that_is_not_a_url_alone(self) -> None:
        assert redact_url("", PRIVACY) == ""
        assert redact_url(None, PRIVACY) is None


class TestRedactHeaders:
    def test_masks_authorization_and_cookie_headers_by_default(self) -> None:
        headers = redact_headers(
            {
                "Authorization": "Bearer secret-token",
                "Cookie": "session=abc",
                "Content-Type": "application/json",
            },
            PRIVACY,
        )

        assert headers == {
            "Authorization": REDACTED,
            "Cookie": REDACTED,
            "Content-Type": "application/json",
        }

    def test_passes_a_value_that_is_not_a_header_map_through(self) -> None:
        assert redact_headers(None, PRIVACY) is None


class TestRedactText:
    def test_lets_a_callback_rewrite_what_is_about_to_be_persisted(self) -> None:
        options = normalize_privacy_options(
            {"redact": lambda ctx: ctx["value"].replace("Ada Lovelace", "a customer")}
        )

        assert redact_text("signed by Ada Lovelace", options) == "signed by a customer"

    def test_applies_a_compiled_pattern_every_time(self) -> None:
        options = normalize_privacy_options({"redact_patterns": [re.compile("secret")]})

        assert redact_text("a secret", options) == f"a {REDACTED}"
        assert redact_text("a secret", options) == f"a {REDACTED}"


class TestRedactValue:
    def test_redacts_every_string_in_a_nested_payload(self) -> None:
        event = {
            "request": {
                "url": "https://example.com/api?access_token=live",
                "headers": {"authorization": "Bearer live"},
                "method": "GET",
            },
            "cookie": "session=abc",
            "sizes": [1, 2, 3],
        }

        redacted = redact_value(event, PRIVACY)

        assert redacted["request"]["url"] == (
            f"https://example.com/api?access_token={REDACTED}"
        )
        assert redacted["request"]["headers"]["authorization"] == REDACTED
        assert redacted["request"]["method"] == "GET"
        assert redacted["cookie"] == REDACTED
        assert redacted["sizes"] == [1, 2, 3]
        assert "live" not in json.dumps(redacted)

    def test_leaves_values_that_carry_no_text_unchanged(self) -> None:
        assert redact_value(42, PRIVACY) == 42
        assert redact_value(None, PRIVACY) is None
        assert redact_value(True, PRIVACY) is True
