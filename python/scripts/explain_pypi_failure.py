#!/usr/bin/env python3
"""
Explain a PyPI trusted-publishing failure in terms of the form that fixes it.

`pypa/gh-action-pypi-publish` reports a missing publisher like this:

    * `invalid-publisher`: valid token, but no corresponding publisher
      (Publisher with matching claims was not found)

    This generally indicates a trusted publisher configuration error, but
    could also indicate an internal error on GitHub or PyPI's part.

That is true and unactionable. It does not say which of the two it is, which
of PyPI's two registration forms applies, or what to type into it -- and the
answer differs depending on whether the project is already on PyPI. For a
project that is not (the JSON API returns 404), only the *pending* publisher
form works; the per-project form does not exist yet.

This script runs after a failed publish and prints those specifics. It does
not decide whether the release should have succeeded, and it never turns a
failure into a pass: the publish step's own result stands.

Usage:
    python scripts/explain_pypi_failure.py \
        --project browser-commander \
        --repository owner/repo \
        --workflow python.yml \
        [--environment name]

See dev/log/issues/83/pulls/84/analysis/root-causes.md, RC-A.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request

PENDING_PUBLISHER_URL = "https://pypi.org/manage/account/publishing/"
PUBLISHER_URL = "https://pypi.org/manage/project/{project}/settings/publishing/"
TROUBLESHOOTING_URL = "https://docs.pypi.org/trusted-publishers/troubleshooting/"
PYPI_JSON_URL = "https://pypi.org/pypi/{project}/json"


def project_is_on_pypi(project: str, timeout: float = 10.0) -> bool:
    """Return True when PyPI already has a project under this name.

    A network failure is reported as "not present" rather than raised: this
    runs while the job is already failing, and a second failure inside the
    explanation would replace the explanation with a traceback.
    """
    url = PYPI_JSON_URL.format(project=project)
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            json.load(response)
        return True
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return False
        print(f"Could not query {url}: HTTP {error.code}", file=sys.stderr)
        return False
    except (urllib.error.URLError, TimeoutError, ValueError) as error:
        print(f"Could not query {url}: {error}", file=sys.stderr)
        return False


def build_report(
    *,
    project: str,
    repository: str,
    workflow: str,
    environment: str,
    project_exists: bool,
) -> str:
    """Build the human-readable explanation for a publish failure."""
    owner, _, repo = repository.partition("/")

    if project_exists:
        where = (
            f"{project} already exists on PyPI, so add the publisher on its "
            f"settings page: {PUBLISHER_URL.format(project=project)}"
        )
    else:
        where = (
            f"{project} does not exist on PyPI yet, so the per-project "
            "settings page does not exist either. Register a *pending* "
            f"publisher instead: {PENDING_PUBLISHER_URL}"
        )

    if environment:
        environment_line = (
            f"  Environment name: {environment}   "
            "(must match the job's `environment:` exactly)"
        )
    else:
        environment_line = (
            "  Environment name: leave this empty   "
            "(the job declares no `environment:`, so the OIDC claim is "
            "MISSING; filling this in is the most common way to get an "
            "`invalid-publisher` that otherwise looks correct)"
        )

    return "\n".join(
        [
            "PyPI rejected this release because no trusted publisher matches "
            "this workflow.",
            "",
            where,
            "",
            "Fill the form with exactly these values:",
            f"  PyPI Project Name: {project}",
            f"  Owner: {owner}",
            f"  Repository name: {repo}",
            f"  Workflow name: {workflow}",
            environment_line,
            "",
            "Then re-run this job. Nothing in this repository can complete "
            "this step; it needs a PyPI account with permission to register "
            f"the name. More detail: {TROUBLESHOOTING_URL}",
        ]
    )


def build_annotation(report: str) -> str:
    """Wrap a report as a single-line GitHub error annotation.

    A workflow command ends at the first newline, so the body is escaped the
    way GitHub documents; the run summary renders it back as line breaks.
    """
    escaped = report.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
    return f"::error title=PyPI trusted publisher is not configured::{escaped}"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Explain a PyPI trusted-publishing failure",
    )
    parser.add_argument("--project", required=True, help="PyPI project name")
    parser.add_argument("--repository", required=True, help="owner/repo")
    parser.add_argument(
        "--workflow",
        required=True,
        help="Workflow file name, e.g. python.yml",
    )
    parser.add_argument(
        "--environment",
        default="",
        help="Deployment environment name, if the job declares one",
    )
    args = parser.parse_args()

    report = build_report(
        project=args.project,
        repository=args.repository,
        workflow=args.workflow,
        environment=args.environment,
        project_exists=project_is_on_pypi(args.project),
    )

    print(build_annotation(report))
    print(report, file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
