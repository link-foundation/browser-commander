"""Guard for RC-1 on the Python side of the pipeline.

The three release jobs are serialised by the
``main-writer-${{ github.repository }}-main`` concurrency group, but each one
checks out ``github.sha``. Serialisation orders the writers; it does not
re-point their working trees. The Python release therefore pushed a tree one
commit behind main and was rejected as non-fast-forward, with nothing to
rebase and retry.

A ruleset rejection prints "rejected" too, so the classifier has to keep the
two apart: rebasing can never satisfy a rule, and retrying it burns the retry
and blames a race that never happened.

Analysis: dev/log/issues/85/pulls/86/analysis/root-causes.md, RC-1
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[4]
SCRIPTS_DIR = REPO_ROOT / "python" / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

from git_push import (  # noqa: E402
    DEFAULT_ATTEMPTS,
    NON_FAST_FORWARD_PATTERNS,
    REPOSITORY_RULE_PATTERNS,
    PushFailedError,
    classify_push_failure,
    is_blocked_by_repository_rule,
    is_debug_enabled,
    is_non_fast_forward,
    push_with_rebase_retry,
)

#: Rejection text a lost race produces, verbatim. The first wording is what
#: the CI logs in dev/log/issues/85/pulls/86/ci-logs/ contain; the second is
#: what experiments/ci-repro/repro-release-push-race.sh reproduces locally.
RACE_SAMPLES = [
    " ! [rejected]        HEAD -> main (non-fast-forward)\n"
    "error: failed to push some refs\n"
    "hint: Updates were rejected because a pushed branch tip is behind its remote",
    " ! [rejected]        HEAD -> main (fetch first)\n"
    "hint: Updates were rejected because the remote contains work that you do not\n"
    "hint: have locally.",
]

#: Rejection text a ruleset or a protected branch produces, verbatim.
RULE_SAMPLES = [
    "remote: error: GH013: Repository rule violations found for refs/heads/main.\n"
    "remote: - Changes must be made through a pull request.\n"
    " ! [remote rejected] main -> main (push declined due to repository rule violations)",
    "remote: error: GH006: Protected branch update failed for refs/heads/main.\n"
    " ! [remote rejected] main -> main (protected branch hook declined)",
]


@dataclass
class FakeResult:
    """The shape ``subprocess.run`` returns, reduced to what is read."""

    returncode: int = 0
    stdout: str = ""
    stderr: str = ""


@dataclass
class FakeGit:
    """A git that fails the first ``failures`` pushes, then succeeds."""

    failures: int = 0
    stderr: str = RACE_SAMPLES[0]
    stdout: str = ""
    calls: list[str] = field(default_factory=list)
    _pushes: int = 0

    def __call__(self, cmd) -> FakeResult:
        self.calls.append(" ".join(cmd))
        if cmd[1] == "push":
            self._pushes += 1
            if self._pushes <= self.failures:
                return FakeResult(returncode=1, stderr=self.stderr)
        return FakeResult(returncode=0, stdout=self.stdout)


class Log:
    """Collect log lines instead of printing them."""

    def __init__(self) -> None:
        self.lines: list[str] = []

    def __call__(self, line: str) -> None:
        self.lines.append(line)


@pytest.mark.parametrize("sample", RACE_SAMPLES)
def test_lost_race_is_classified_as_non_fast_forward(sample):
    assert classify_push_failure(sample) == "non-fast-forward"
    assert is_non_fast_forward(sample)
    assert not is_blocked_by_repository_rule(sample)


@pytest.mark.parametrize("sample", RULE_SAMPLES)
def test_rule_violation_is_never_read_as_a_lost_race(sample):
    # The whole point of the classifier: a ruleset rejection contains the word
    # "rejected" too, so a naive substring check retries a push that can never
    # succeed.
    assert classify_push_failure(sample) == "repository-rule"
    assert not is_non_fast_forward(sample)
    assert is_blocked_by_repository_rule(sample)


def test_unrelated_failure_is_left_unclassified():
    auth = FakeResult(
        returncode=128,
        stderr="fatal: could not read Username for https://github.com",
    )
    assert classify_push_failure(auth) == "unknown"


@pytest.mark.parametrize("empty", [None, "", FakeResult()])
def test_classifier_survives_a_failure_with_nothing_to_read(empty):
    assert classify_push_failure(empty) == "unknown"


def test_classifier_is_case_insensitive():
    assert (
        classify_push_failure("REMOTE: ERROR: GH013: REPOSITORY RULE VIOLATIONS")
        == "repository-rule"
    )
    assert (
        classify_push_failure("! [REJECTED] main -> main (NON-FAST-FORWARD)")
        == "non-fast-forward"
    )


def test_push_succeeds_without_a_retry_when_nothing_raced():
    git = FakeGit()
    result = push_with_rebase_retry(runner=git, branch="main", log=Log())

    assert result == {"pushed": True, "via": "direct", "attempts": 1}
    assert git.calls == ["git push origin HEAD:main"]


def test_push_rebases_and_retries_after_losing_the_race():
    git = FakeGit(failures=1)
    log = Log()

    result = push_with_rebase_retry(runner=git, branch="main", log=log)

    assert result == {"pushed": True, "via": "rebase", "attempts": 2}
    assert git.calls == [
        "git push origin HEAD:main",
        "git pull --rebase origin main",
        "git push origin HEAD:main",
    ]
    assert any(line.startswith("::warning::") for line in log.lines), (
        "a recovered race must still be visible in the log"
    )


def test_push_does_not_retry_a_repository_rule_rejection():
    git = FakeGit(failures=DEFAULT_ATTEMPTS, stderr=RULE_SAMPLES[0])
    log = Log()

    with pytest.raises(PushFailedError):
        push_with_rebase_retry(runner=git, branch="main", log=log)

    assert git.calls == ["git push origin HEAD:main"]
    assert any(
        line.startswith("::error::") and "GH006/GH013" in line for line in log.lines
    ), "the log must name the real cause"


def test_push_does_not_retry_a_failure_a_rebase_cannot_fix():
    git = FakeGit(
        failures=DEFAULT_ATTEMPTS,
        stderr="fatal: could not read Username for https://github.com",
    )
    with pytest.raises(PushFailedError):
        push_with_rebase_retry(runner=git, branch="main", log=Log())
    assert git.calls == ["git push origin HEAD:main"]


def test_push_gives_up_after_the_configured_attempts():
    git = FakeGit(failures=99)
    with pytest.raises(PushFailedError):
        push_with_rebase_retry(runner=git, branch="main", attempts=3, log=Log())
    assert [call for call in git.calls if call.startswith("git push")] == [
        "git push origin HEAD:main"
    ] * 3


def test_push_stops_when_the_rebase_itself_fails():
    # A rebase that leaves conflicts must not be followed by another push:
    # that would push a half-rebased tree.
    class ConflictingGit(FakeGit):
        def __call__(self, cmd):
            result = super().__call__(cmd)
            if cmd[1] == "pull":
                return FakeResult(returncode=1, stderr="CONFLICT (content)")
            return result

    git = ConflictingGit(failures=99)
    with pytest.raises(PushFailedError):
        push_with_rebase_retry(runner=git, branch="main", log=Log())
    assert git.calls == [
        "git push origin HEAD:main",
        "git pull --rebase origin main",
    ]


def test_push_targets_the_branch_it_is_told_to():
    git = FakeGit()
    push_with_rebase_retry(runner=git, remote="upstream", branch="release", log=Log())
    assert git.calls == ["git push upstream HEAD:release"]


def test_verbose_mode_is_off_by_default():
    # Tracing must never be on unless asked for: a release log is read by
    # people looking for the one line that matters.
    assert not is_debug_enabled({})
    assert not is_debug_enabled({"CI_SCRIPTS_DEBUG": "0"})
    assert is_debug_enabled({"CI_SCRIPTS_DEBUG": "1"})
    assert is_debug_enabled({"CI_SCRIPTS_DEBUG": "true"})
    assert is_debug_enabled({"RUNNER_DEBUG": "1"})
    assert is_debug_enabled({"ACTIONS_STEP_DEBUG": "true"})


def test_python_and_node_classifiers_agree():
    # Two implementations of one rule drift apart silently. The lists are the
    # rule, so compare them directly.
    source = (REPO_ROOT / "scripts" / "push-failure-classifier.mjs").read_text()

    def js_list(name: str) -> list[str]:
        body = re.search(
            rf"export const {name} = Object\.freeze\(\[(.*?)\]\);", source, re.S
        )
        assert body, f"{name} not found in push-failure-classifier.mjs"
        return re.findall(r"'([^']+)'", body.group(1))

    assert js_list("REPOSITORY_RULE_PATTERNS") == list(REPOSITORY_RULE_PATTERNS)
    assert js_list("NON_FAST_FORWARD_PATTERNS") == list(NON_FAST_FORWARD_PATTERNS)


def test_every_python_push_site_uses_the_shared_helper():
    # The fix has to be applied everywhere: one un-migrated push site
    # reproduces the original failure the next time two releases run.
    version_script = (SCRIPTS_DIR / "version_and_commit.py").read_text()
    assert "push_with_rebase_retry" in version_script
    assert '"push", "origin", "main"' not in version_script

    workflow = (REPO_ROOT / ".github" / "workflows" / "python.yml").read_text()
    assert "scripts/git_push.py" in workflow
    assert "git push origin HEAD:main" not in workflow
