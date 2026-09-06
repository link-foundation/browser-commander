#!/usr/bin/env bash
# Reproduce the two defects that made the Python and Rust "Auto Release" jobs
# fail in the runs listed in issue #85, using nothing but local git.
#
# Evidence being reproduced (dev/log/issues/85/pulls/86/ci-logs/):
#
#   run-33998729934.log (Python), run-33998729958.log (Rust)
#     ! [rejected]        main -> main (non-fast-forward)
#     error: failed to push some refs to '.../browser-commander'
#
# The `main-writer-<repo>-main` concurrency group serialises the release jobs
# correctly -- the JS release pushed 0.17.1 at 23:29:44, Python started at
# 23:30:09 and Rust at 23:31:00. Serialising is not enough: `actions/checkout`
# checks out `github.sha`, the commit that triggered the run, so every writer
# after the first holds a tree that is one commit behind main and its push is
# rejected.
#
# Case 1 shows the rejection and that `git pull --rebase` + retry clears it.
# Case 2 shows why the retry cannot simply be bolted on to the Rust script as
# it stands: it tags before pushing, and the rebase leaves that tag pointing at
# an abandoned commit.
#
# Usage: bash experiments/ci-repro/repro-release-push-race.sh

set -euo pipefail

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

export GIT_AUTHOR_NAME='ci' GIT_AUTHOR_EMAIL='ci@example.com'
export GIT_COMMITTER_NAME='ci' GIT_COMMITTER_EMAIL='ci@example.com'

# A bare remote plus the state every release job starts from.
git init --quiet --bare "$WORK/remote.git"
git clone --quiet "$WORK/remote.git" "$WORK/seed"
git -C "$WORK/seed" commit --quiet --allow-empty -m 'trigger commit (github.sha)'
git -C "$WORK/seed" push --quiet origin HEAD:main
TRIGGER_SHA="$(git -C "$WORK/seed" rev-parse HEAD)"

# Every release job in a workflow run checks out the SAME trigger commit.
checkout_trigger() { # $1 = destination
  git clone --quiet "$WORK/remote.git" "$1"
  git -C "$1" checkout --quiet "$TRIGGER_SHA"
  git -C "$1" checkout --quiet -B main
}

echo '=============================================================='
echo 'Case 1: second main writer pushes from the trigger commit'
echo '=============================================================='

checkout_trigger "$WORK/js"
checkout_trigger "$WORK/python"

# The JS release wins the concurrency group and lands 0.17.1.
echo '0.17.1' > "$WORK/js/version"
git -C "$WORK/js" add version
git -C "$WORK/js" commit --quiet -m '0.17.1'
git -C "$WORK/js" push --quiet origin HEAD:main
echo "JS release pushed $(git -C "$WORK/js" rev-parse --short HEAD) to main"

# Python starts next. Its checkout is still at the trigger commit.
echo 'changelog for 0.5.3' > "$WORK/python/CHANGELOG.md"
git -C "$WORK/python" add CHANGELOG.md
git -C "$WORK/python" commit --quiet -m 'python: changelog for 0.5.3'

echo
echo '--- what CI does today: git push origin HEAD:main ---'
if git -C "$WORK/python" push origin HEAD:main 2>&1 | sed 's/^/    /'; then
  echo 'UNEXPECTED: the push succeeded; the race was not reproduced'
  exit 1
fi
echo '    => reproduced: non-fast-forward, exactly as in run-33998729934.log'

echo
echo '--- the fix: pull --rebase, then push again ---'
git -C "$WORK/python" pull --quiet --rebase origin main
git -C "$WORK/python" push --quiet origin HEAD:main
echo "    => push succeeded; main is now:"
git -C "$WORK/python" log origin/main --oneline | sed 's/^/    /'

echo
echo '=============================================================='
echo 'Case 2: tagging before the push orphans the tag on rebase'
echo '=============================================================='

checkout_trigger "$WORK/rust"
git -C "$WORK/seed" pull --quiet --rebase origin main
git -C "$WORK/seed" commit --quiet --allow-empty -m 'another main writer'
git -C "$WORK/seed" push --quiet origin HEAD:main

# rust/scripts/version-and-commit.mjs commits, then tags, then pushes.
echo '0.10.12' > "$WORK/rust/Cargo.toml"
git -C "$WORK/rust" add Cargo.toml
git -C "$WORK/rust" commit --quiet -m 'chore: release v0.10.12'
git -C "$WORK/rust" tag -a rust-v0.10.12 -m 'Release rust-v0.10.12'
TAGGED_COMMIT="$(git -C "$WORK/rust" rev-parse rust-v0.10.12^{commit})"

git -C "$WORK/rust" push origin HEAD:main >/dev/null 2>&1 \
  && { echo 'UNEXPECTED: the push succeeded'; exit 1; }
git -C "$WORK/rust" pull --quiet --rebase origin main
git -C "$WORK/rust" push --quiet origin HEAD:main
git -C "$WORK/rust" push --quiet origin --tags

REBASED_COMMIT="$(git -C "$WORK/rust" rev-parse HEAD)"
echo "    tag rust-v0.10.12 points at : $TAGGED_COMMIT"
echo "    the commit actually on main : $REBASED_COMMIT"
if [ "$TAGGED_COMMIT" = "$REBASED_COMMIT" ]; then
  echo 'UNEXPECTED: the tag survived the rebase'
  exit 1
fi
if git -C "$WORK/remote.git" merge-base --is-ancestor "$TAGGED_COMMIT" main 2>/dev/null; then
  echo 'UNEXPECTED: the tagged commit is reachable from main'
  exit 1
fi
echo '    => reproduced: the tag names a commit that is not on main.'
echo '       Tag AFTER the push succeeds, the way the Rust template does.'

echo
echo 'Both defects reproduced.'
