"""Tests for the trusted-publishing failure explainer.

Every push to main fails the Python release with the same wall of text:

    * `invalid-publisher`: valid token, but no corresponding publisher
      (Publisher with matching claims was not found)

    This generally indicates a trusted publisher configuration error, but
    could also indicate an internal error on GitHub or PyPI's part.

Nothing in that output says which of the two it is, which form to open, or
what to type into it. The project is not on PyPI at all -- the JSON API
returns 404 -- so the answer is a *pending* publisher, a different form from
the one a maintainer of an existing project would use.

This script turns the failure into the four values that form wants.

See dev/log/issues/83/pulls/84/analysis/root-causes.md, RC-A.
"""

from __future__ import annotations

import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[3] / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

from explain_pypi_failure import (  # noqa: E402
    PENDING_PUBLISHER_URL,
    PUBLISHER_URL,
    build_annotation,
    build_report,
)


def report(**overrides: object) -> str:
    defaults: dict[str, object] = {
        "project": "browser-commander",
        "repository": "link-foundation/browser-commander",
        "workflow": "python.yml",
        "environment": "",
        "project_exists": False,
    }
    defaults.update(overrides)
    return build_report(**defaults)  # type: ignore[arg-type]


def test_names_every_field_the_registration_form_asks_for():
    text = report()
    assert "browser-commander" in text
    assert "link-foundation" in text
    assert "browser-commander" in text
    assert "python.yml" in text


def test_sends_an_unpublished_project_to_the_pending_publisher_form():
    text = report(project_exists=False)
    assert PENDING_PUBLISHER_URL in text
    assert "pending" in text.lower()


def test_sends_a_published_project_to_the_project_publisher_form():
    text = report(project_exists=True)
    assert PUBLISHER_URL.format(project="browser-commander") in text
    assert PENDING_PUBLISHER_URL not in text


def test_spells_out_that_no_environment_is_configured():
    # `environment: MISSING` in the OIDC claims means the form's Environment
    # field must be left empty. Filling it in is the usual way to get an
    # `invalid-publisher` that looks correct.
    text = report(environment="")
    assert "leave" in text.lower() or "empty" in text.lower()


def test_repeats_a_configured_environment_verbatim():
    text = report(environment="pypi")
    assert "pypi" in text


def test_wraps_the_report_in_a_github_error_annotation():
    annotation = build_annotation(report())
    assert annotation.startswith("::error ")
    assert "browser-commander" in annotation


def test_escapes_newlines_so_the_annotation_survives_as_one_line():
    # A workflow command ends at the first newline, so a multi-line
    # ::error:: silently loses everything after its first line. GitHub
    # renders the URL-escaped form as line breaks in the run summary.
    annotation = build_annotation(report())
    assert "\n" not in annotation
    assert "%0A" in annotation
