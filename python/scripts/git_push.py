#!/usr/bin/env python3
"""Push a release commit to a shared branch, recovering from a lost race.

Why this exists
---------------
All three release jobs in this repository share the
``main-writer-${{ github.repository }}-main`` concurrency group, so they never
run at the same time. They are still not safe, because ``actions/checkout@v6``
checks out ``github.sha`` -- the commit that triggered the run -- not the branch
tip. Serialisation orders the writers; it does not re-point their working
trees. Every writer after the first therefore holds a tree one commit behind
``main`` and its push is rejected as non-fast-forward.

That is what failed the "Python CI/CD Pipeline" run listed in issue #85: the JS
release pushed ``ab1c5aa 0.17.1`` at 23:29:44 and the Python release, which
started at 23:30:09, pushed from a tree still at ``67c003c``. See
``dev/log/issues/85/pulls/86/analysis/root-causes.md`` (RC-1) and the local
reproduction in ``experiments/ci-repro/repro-release-push-race.sh``.

This is the Python counterpart of ``scripts/push-with-rebase-retry.mjs`` and
``scripts/push-failure-classifier.mjs``; the two must stay in step, and
``python/tests/unit/scripts/test_git_push.py`` asserts that the pattern lists
match.

Scope
-----
Only a lost race is retried. A repository-rule rejection (GH006/GH013) is
reported as itself and fails the job, because rebasing can never satisfy a
rule.

Usage:
    python scripts/git_push.py [--remote origin] [--branch main] [--attempts 3]

Environment variables:
    CI_SCRIPTS_DEBUG / RUNNER_DEBUG / ACTIONS_STEP_DEBUG: enable verbose
        tracing of every git invocation. Default off.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from collections.abc import Iterable, Sequence
from typing import Callable, Protocol

#: Server-side refusals to accept a direct push: legacy branch protection
#: (GH006) and repository rulesets (GH013). No client-side history rewrite can
#: satisfy them, so the change has to arrive through a pull request instead.
REPOSITORY_RULE_PATTERNS: tuple[str, ...] = (
    "gh006",  # legacy protected-branch rejection
    "gh013",  # repository rule violations
    "repository rule violations",
    "changes must be made through a pull request",
    "protected branch",
    "push declined",
)

#: Rejections caused by the remote branch having advanced. Only these are fixed
#: by rebasing onto the new remote head and pushing again. ``fetch first`` sits
#: alongside ``non-fast-forward`` because git picks between the two wordings by
#: whether the local ref already knows about the remote's new commits.
NON_FAST_FORWARD_PATTERNS: tuple[str, ...] = (
    "[rejected]",
    "non-fast-forward",
    "fetch first",
    "updates were rejected",
)

#: Total push attempts, so a single lost race costs one rebase.
DEFAULT_ATTEMPTS = 3

#: Environment variables that switch verbose tracing on, mirroring
#: ``scripts/debug-print.mjs``.
DEBUG_ENV_VARS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("CI_SCRIPTS_DEBUG", ("1", "true")),
    ("RUNNER_DEBUG", ("1",)),
    ("ACTIONS_STEP_DEBUG", ("true",)),
)


class CommandResult(Protocol):
    """The parts of a finished command this module reads."""

    returncode: int
    stdout: str | None
    stderr: str | None


Runner = Callable[[Sequence[str]], CommandResult]


class PushFailedError(RuntimeError):
    """A push that no retry in this module can recover."""

    def __init__(self, message: str, result: CommandResult | None = None) -> None:
        super().__init__(message)
        self.result = result


def is_debug_enabled(env: dict[str, str] | None = None) -> bool:
    """Whether verbose tracing is switched on. Default off."""
    source = os.environ if env is None else env
    return any(
        source.get(name, "").strip().lower() in values
        for name, values in DEBUG_ENV_VARS
    )


def debug(
    *parts: object,
    env: dict[str, str] | None = None,
    log: Callable[[str], None] = print,
) -> None:
    """Print a ``::debug::``-prefixed line, but only when tracing is enabled."""
    if not is_debug_enabled(env):
        return
    message = " ".join(str(part) for part in parts)
    for line in message.split("\n"):
        log(f"::debug::{line}")


def _combined_output(result: object, include_message: bool = True) -> str:
    """Flatten a command result, an exception or a string into one haystack.

    ``stdout`` and ``stderr`` are both read because git writes the rejection to
    stderr while the accompanying hint can land in either stream depending on
    the transport.
    """
    if result is None:
        return ""
    if isinstance(result, str):
        return result.lower()
    parts: list[object] = [
        getattr(result, "stdout", None),
        getattr(result, "stderr", None),
    ]
    if include_message:
        parts.append(str(result) if isinstance(result, BaseException) else None)
    return "\n".join("" if part is None else str(part) for part in parts).lower()


def _matches(output: str, patterns: Iterable[str]) -> bool:
    return any(pattern in output for pattern in patterns)


def is_blocked_by_repository_rule(result: object) -> bool:
    """Whether branch protection or a repository ruleset refused the push."""
    return _matches(_combined_output(result), REPOSITORY_RULE_PATTERNS)


def is_non_fast_forward(result: object) -> bool:
    """Whether the push was refused because the branch has advanced.

    A ruleset rejection also prints "rejected", so it is excluded first:
    rebasing can never satisfy a rule, and misreading it as a lost race burns
    the retry and reports the wrong cause.
    """
    if is_blocked_by_repository_rule(result):
        return False
    return _matches(
        _combined_output(result, include_message=False), NON_FAST_FORWARD_PATTERNS
    )


def classify_push_failure(result: object) -> str:
    """One of ``repository-rule``, ``non-fast-forward`` or ``unknown``."""
    if is_blocked_by_repository_rule(result):
        return "repository-rule"
    if is_non_fast_forward(result):
        return "non-fast-forward"
    return "unknown"


def default_runner(cmd: Sequence[str]) -> subprocess.CompletedProcess:
    """Run a command, capturing output so the classifier can read it.

    Output is echoed as well as captured: a release log that shows only the
    exit code is what made the original failure take a second CI run to
    diagnose.
    """
    debug("running:", " ".join(cmd))
    result = subprocess.run(list(cmd), capture_output=True, text=True, check=False)
    if result.stdout:
        print(result.stdout, end="" if result.stdout.endswith("\n") else "\n")
    if result.stderr:
        print(
            result.stderr,
            end="" if result.stderr.endswith("\n") else "\n",
            file=sys.stderr,
        )
    return result


def push_with_rebase_retry(
    runner: Runner = default_runner,
    remote: str = "origin",
    branch: str = "main",
    refspec: str | None = None,
    attempts: int = DEFAULT_ATTEMPTS,
    log: Callable[[str], None] = print,
) -> dict[str, object]:
    """Push HEAD to ``branch``, rebasing and retrying when the branch advanced.

    :returns: ``{"pushed": True, "via": "direct"|"rebase", "attempts": n}``
    :raises PushFailedError: on a rule violation, an unrecognised failure, or a
        race that survived every attempt.
    """
    target = refspec if refspec is not None else f"HEAD:{branch}"
    push_cmd = ["git", "push", remote, target]

    for attempt in range(1, attempts + 1):
        debug(f"push attempt {attempt}/{attempts}:", " ".join(push_cmd))
        result = runner(push_cmd)
        if result.returncode == 0:
            if attempt == 1:
                log(f"Pushed {target} to {remote}.")
                return {"pushed": True, "via": "direct", "attempts": attempt}
            log(f"Pushed {target} to {remote} after {attempt - 1} rebase(s).")
            return {"pushed": True, "via": "rebase", "attempts": attempt}

        kind = classify_push_failure(result)
        debug(f"push attempt {attempt} failed, classified as {kind}")

        if kind == "repository-rule":
            log(
                f"::error::Push to {remote}/{branch} was declined by a repository rule "
                "(GH006/GH013), not by a lost race. Rebasing cannot satisfy a branch "
                f"protection rule; allow the release token to push to {branch}, or land "
                "this commit through a pull request."
            )
            raise PushFailedError(
                f"push to {remote}/{branch} declined by a repository rule", result
            )

        if kind == "unknown":
            log(
                f"::error::Push to {remote}/{branch} failed for a reason a rebase cannot "
                f"fix (exit code {result.returncode})."
            )
            raise PushFailedError(
                f"push to {remote}/{branch} failed with exit code {result.returncode}",
                result,
            )

        if attempt == attempts:
            log(
                f"::error::Push to {remote}/{branch} still rejected as non-fast-forward "
                f"after {attempts} attempts."
            )
            raise PushFailedError(
                f"push to {remote}/{branch} rejected as non-fast-forward after "
                f"{attempts} attempts",
                result,
            )

        log(
            f"::warning::Push to {remote}/{branch} was rejected because the branch "
            f"advanced; rebasing onto {remote}/{branch} and retrying (attempt "
            f"{attempt + 1}/{attempts})."
        )
        rebase = runner(["git", "pull", "--rebase", remote, branch])
        if rebase.returncode != 0:
            log(f"::error::Rebase onto {remote}/{branch} failed; aborting the push.")
            raise PushFailedError(
                f"git pull --rebase {remote} {branch} failed with exit code "
                f"{rebase.returncode}",
                rebase,
            )

    # Unreachable: the loop either returns or raises on its final attempt.
    raise PushFailedError(f"push exhausted {attempts} attempts without a result")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument(
        "--remote", default="origin", help="Remote name (default: origin)"
    )
    parser.add_argument(
        "--branch", default="main", help="Target branch (default: main)"
    )
    parser.add_argument(
        "--refspec", default=None, help="Refspec to push (default: HEAD:<branch>)"
    )
    parser.add_argument(
        "--attempts",
        type=int,
        default=DEFAULT_ATTEMPTS,
        help=f"Total push attempts (default: {DEFAULT_ATTEMPTS})",
    )
    args = parser.parse_args(argv)

    try:
        push_with_rebase_retry(
            remote=args.remote,
            branch=args.branch,
            refspec=args.refspec,
            attempts=args.attempts,
        )
    except PushFailedError as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
