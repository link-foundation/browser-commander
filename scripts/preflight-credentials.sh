#!/usr/bin/env bash
#
# Prove the release credentials can publish before any expensive job runs.
#
# Principle 16 of the shared CI/CD best practices ("Prove You Can Publish
# Before You Build"), adopted from the link-foundation pipeline templates
# (scripts/preflight-credentials.sh in js-, python- and
# rust-ai-driven-development-pipeline-template; template issues #74/#77,
# #163/#167 and #176/#181) for issue #128: Python CI/CD run 37509328334 built,
# tested and versioned on main and only then failed at "Publish to PyPI" with
# `invalid-publisher`, because no trusted publisher was registered on PyPI.
# Pull requests never touched the publish path, so nothing said so earlier.
#
# A non-empty secret proves nothing (an expired token is non-empty), and a
# login proves authentication, not authorisation. Where the registry allows
# it, the check is the first half of the publish itself:
#   - pypi:   exchange this job's OIDC token for a short-lived upload token
#             at /_/oidc/mint-token -- exactly what pypa/gh-action-pypi-publish
#             does. PyPI validates the trusted-publisher mapping at mint time;
#             nothing is uploaded.
#   - npm:    exchange this job's OIDC token for a short-lived publish token at
#             /-/npm/v1/oidc/token/exchange/package/<name> -- exactly what
#             `npm publish` does under trusted publishing. Nothing is
#             published.
#   - crates: exchange this job's OIDC token for a short-lived publish token
#             at /api/v1/trusted_publishing/tokens, exactly as
#             rust-lang/crates-io-auth-action does, then revoke it. The
#             exchange validates the trusted-publisher mapping; no upload.
#
# Each workflow probes only the registry it publishes to:
#   PREFLIGHT_REGISTRIES -- space- or comma-separated: pypi, npm, crates.
#
# PREFLIGHT_MODE:
#   release -- push to main / manual release. A refused credential fails the
#              run here, before the test matrix spends a minute.
#   report  -- pull requests, where a fork legitimately has no publishing
#              credentials. The same probes run and annotate, but never block.
#
# Rules each caller depends on (each is a defect if dropped):
#   1. Report every failure, not the first -- no probe aborts the script.
#   2. Report `unknown`, never a guess: a timeout or a 429 has not said the
#      credential is broken. But a release-mode run that verified nothing is
#      not a pass.
#   3. Probe with a write, not a login, wherever the registry allows one.
#   4. Never print a credential: OIDC tokens, minted tokens and API tokens stay
#      in variables.
#
# No set -e on purpose: rule 1 means one failed probe must not hide the rest.

set -u

MODE="${PREFLIGHT_MODE:-report}"
REGISTRIES="${PREFLIGHT_REGISTRIES:-}"
PYPI_API="${PYPI_API:-https://pypi.org}"
NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmjs.org}"
CRATES_API="${CRATES_API:-https://crates.io}"
CURL_TIMEOUT="${PREFLIGHT_CURL_TIMEOUT:-15}"
NEWLINE=$'\n'

PYPI_PENDING_PUBLISHER_URL='https://pypi.org/manage/account/publishing/'

verified=0
n_fail=0
n_unknown=0
failures=''
unknowns=''

ok() {
  verified=$((verified + 1))
  printf '  PASS: %s\n' "$*"
}

bad() {
  n_fail=$((n_fail + 1))
  failures="${failures}${failures:+${NEWLINE}}$1"
  printf '  FAIL: %s\n' "$*"
}

unknown() {
  n_unknown=$((n_unknown + 1))
  unknowns="${unknowns}${unknowns:+${NEWLINE}}$1"
  printf '  UNKNOWN: %s\n' "$*"
}

# curl that separates the HTTP status from the body without temp files.
# Prints "body\nstatus"; a network failure yields an empty status, which the
# callers treat as unknown. curl reports a request that never got an answer
# (refused, timed out, DNS) as status 000, so that is mapped to empty too.
http() {
  local body status
  body=$(curl -sS --max-time "$CURL_TIMEOUT" -o - -w "${NEWLINE}%{http_code}" "$@" 2>/dev/null)
  status="${body##*"$NEWLINE"}"
  [ "$status" = '000' ] && status=''
  printf '%s\n%s' "${body%"${NEWLINE}"*}" "$status"
}

# crates.io answers 403 to API calls without a User-Agent.
CURL_USER_AGENT="release-preflight (github.com/link-foundation/browser-commander)"

# First match of `"key": "<value>"` in a JSON payload -- enough for the flat
# responses in play here and free of jq/node dependencies.
json_string() {
  printf '%s' "$1" | sed -n "s/.*\"$2\" *: *\"\([^\"]*\)\".*/\1/p" | head -n 1
}

# Ask GitHub for an OIDC token with the given (already URL-encoded) audience.
# Sets oidc_token on success; otherwise records the verdict and returns 1.
# `label` names the registry the token is for in the messages.
request_oidc_token() {
  local label="$1" audience="$2" consumer="$3"
  local request_url="${ACTIONS_ID_TOKEN_REQUEST_URL:-}"
  local request_token="${ACTIONS_ID_TOKEN_REQUEST_TOKEN:-}"
  local response status

  oidc_token=''

  if [ -z "$request_url" ] || [ -z "$request_token" ]; then
    bad "${label}: no OIDC token available: ACTIONS_ID_TOKEN_REQUEST_URL/TOKEN are unset -- the job needs id-token: write (fork pull requests never get it), and ${consumer} would fail to authenticate"
    return 1
  fi

  # The default ACTIONS_ID_TOKEN_REQUEST_URL already carries a query string,
  # so & is what the real publish flows append.
  response=$(http -A "$CURL_USER_AGENT" -H 'Accept: application/json' \
    -H "Authorization: Bearer ${request_token}" \
    "${request_url}&audience=${audience}")
  status="${response##*"$NEWLINE"}"

  case "$status" in
    200)
      oidc_token=$(json_string "${response%"${NEWLINE}"*}" value)
      if [ -z "$oidc_token" ]; then
        unknown "${label}: the GitHub OIDC endpoint answered 200 but returned no token"
        return 1
      fi
      return 0
      ;;
    '')
      unknown "${label}: the GitHub OIDC endpoint was unreachable during the token request"
      ;;
    *)
      unknown "${label}: the GitHub OIDC endpoint answered ${status} to the token request (no verdict on trusted publishing)"
      ;;
  esac

  return 1
}

# python.yml publishes with pypa/gh-action-pypi-publish and no password:
# GitHub mints an OIDC token for the job, and PyPI exchanges it for a
# short-lived upload token. The exchange IS the publish credential check --
# PyPI validates the trusted-publisher mapping at mint time -- and minting a
# token uploads nothing. Requires id-token: write on this job.
check_pypi() {
  local oidc_token response status payload code

  printf 'PyPI:\n'

  request_oidc_token PyPI pypi pypa/gh-action-pypi-publish || return 0

  response=$(http -A "$CURL_USER_AGENT" -H 'Content-Type: application/json' \
    -d "{\"token\": \"${oidc_token}\"}" "${PYPI_API}/_/oidc/mint-token")
  status="${response##*"$NEWLINE"}"
  payload="${response%"${NEWLINE}"*}"

  case "$status" in
    200)
      # The response carries a short-lived upload token; it is deliberately
      # not printed.
      ok 'PyPI minted a short-lived upload token via trusted publishing'
      ;;
    400 | 401 | 403 | 422)
      # PyPI answers 422 with {"errors": [{"code": "invalid-publisher", ...}]}
      # when no (pending) publisher matches this repository and workflow --
      # the failure of run 37509328334 (issue #128).
      code=$(json_string "$payload" code)
      bad "PyPI refused to mint an upload token (${status}${code:+, ${code}}) -- no trusted publisher matches this repository/workflow, so the publish step would be rejected. Register one (a pending publisher if the project is not on PyPI yet) at ${PYPI_PENDING_PUBLISHER_URL}; python/scripts/explain_pypi_failure.py prints the exact values"
      ;;
    '')
      unknown 'PyPI was unreachable during the mint-token probe'
      ;;
    *)
      unknown "PyPI answered ${status} to the mint-token probe (no verdict on trusted publishing)"
      ;;
  esac

  return 0
}

# The npm package name: NPM_PACKAGE when set, else the "name" of the
# package.json in the working directory (js.yml runs this from js/).
npm_package_name() {
  if [ -n "${NPM_PACKAGE:-}" ]; then
    printf '%s' "$NPM_PACKAGE"
    return 0
  fi
  [ -f package.json ] || return 1
  json_string "$(cat package.json)" name
}

# js.yml publishes through npm trusted publishing (id-token: write, no
# NPM_TOKEN): `npm publish` exchanges the job's OIDC token, audience
# npm:<registry host>, for a short-lived publish token scoped to the package.
# npm checks the trusted-publisher mapping at exchange time, and the exchange
# publishes nothing.
check_npm() {
  local oidc_token package escaped host response status payload message

  printf 'npm:\n'

  package=$(npm_package_name) || package=''
  if [ -z "$package" ]; then
    bad 'npm: cannot tell which package to probe -- set NPM_PACKAGE or run from the directory holding package.json'
    return 0
  fi

  host="${NPM_REGISTRY#*://}"
  host="${host%%/*}"
  request_oidc_token npm "npm%3A${host}" 'npm publish (trusted publishing)' || return 0

  # Scoped names keep the @ and escape the slash, as npm-package-arg does.
  escaped="${package//\//%2F}"
  response=$(http -A "$CURL_USER_AGENT" -X POST -H 'Accept: application/json' \
    -H "Authorization: Bearer ${oidc_token}" \
    "${NPM_REGISTRY}/-/npm/v1/oidc/token/exchange/package/${escaped}")
  status="${response##*"$NEWLINE"}"
  payload="${response%"${NEWLINE}"*}"

  case "$status" in
    200 | 201)
      # The response carries a short-lived publish token; it is deliberately
      # not printed, only checked for presence.
      if [ -n "$(json_string "$payload" token)" ]; then
        ok "npm exchanged the OIDC token for a publish token for ${package} via trusted publishing"
      else
        unknown "npm answered ${status} to the OIDC token exchange for ${package} but returned no token"
      fi
      ;;
    400 | 401 | 403 | 404)
      message=$(json_string "$payload" message)
      bad "npm refused the OIDC token exchange for ${package} (${status}${message:+: ${message}}) -- no trusted publisher on npmjs.com matches this repository/workflow, so npm publish would fail. Configure it under the package's Settings > Trusted Publisher"
      ;;
    '')
      unknown 'npm registry unreachable during the OIDC token exchange'
      ;;
    *)
      unknown "npm registry answered ${status} to the OIDC token exchange (no verdict on trusted publishing)"
      ;;
  esac

  return 0
}

# Mirror rust-lang/crates-io-auth-action: request a JWT for the registry,
# exchange it for a short-lived publish token, then revoke it immediately.
# The registry validates the workflow's trusted-publisher mapping during the
# exchange. No long-lived Cargo secret or upload is needed for this probe.
check_crates_io() {
  local oidc_token response status token audience
  local endpoint="${CRATES_API%/}/api/v1/trusted_publishing/tokens"

  printf 'crates.io:\n'

  audience="${CRATES_API#*://}"
  audience="${audience%/}"
  request_oidc_token crates.io "$audience" rust-lang/crates-io-auth-action || return 0

  response=$(http -A "$CURL_USER_AGENT" -H 'Content-Type: application/json' \
    -d "{\"jwt\": \"${oidc_token}\"}" "$endpoint")
  status="${response##*"$NEWLINE"}"

  case "$status" in
    200 | 201)
      token=$(json_string "${response%"${NEWLINE}"*}" token)
      if [ -z "$token" ]; then
        unknown "crates.io answered ${status} to the OIDC token exchange but returned no token"
        return 0
      fi
      ok 'crates.io minted a short-lived publish token via trusted publishing'
      # As in the action's post step, revoke the token with Bearer auth. Never
      # echo the response: even an error response might contain credentials.
      response=$(http -A "$CURL_USER_AGENT" -X DELETE \
        -H "Authorization: Bearer ${token}" "$endpoint")
      status="${response##*"$NEWLINE"}"
      case "$status" in
        200 | 204) printf '  PASS: revoked the crates.io preflight token\n' ;;
        *) bad "crates.io could not revoke the preflight token (${status:-unreachable}); it will expire automatically" ;;
      esac
      ;;
    400 | 401 | 403 | 404 | 422)
      bad "crates.io refused the OIDC token exchange (${status}) -- register the trusted publisher for link-foundation/browser-commander, workflow rust.yml, with no environment; see docs/PUBLISHING.md"
      ;;
    '')
      unknown 'crates.io was unreachable during the OIDC token exchange'
      ;;
    *)
      unknown "crates.io answered ${status} to the OIDC token exchange (no verdict on trusted publishing)"
      ;;
  esac

  return 0
}

emit_annotations() {
  local level="$1" list="$2"
  [ -n "$list" ] || return 0
  printf '%s\n' "$list" | while IFS= read -r line; do
    [ -n "$line" ] && printf '::%s::release-preflight: %s\n' "$level" "$line"
  done
}

append_summary() {
  local list
  [ -n "${GITHUB_STEP_SUMMARY:-}" ] || return 0
  {
    printf '### Release preflight (%s mode: %s)\n\n' "$MODE" "$REGISTRIES"
    printf '| verdict | count |\n| --- | --- |\n'
    printf '| verified | %d |\n' "$verified"
    printf '| failed | %d |\n' "$n_fail"
    printf '| unknown | %d |\n' "$n_unknown"
    for list in "$failures" "$unknowns"; do
      [ -n "$list" ] || continue
      printf '\n'
      printf '%s\n' "$list" | while IFS= read -r line; do
        [ -n "$line" ] && printf -- '- %s\n' "$line"
      done
    done
  } >> "$GITHUB_STEP_SUMMARY"
}

if [ -z "${REGISTRIES//[ ,]/}" ]; then
  bad 'PREFLIGHT_REGISTRIES is empty -- the caller must name the registries it publishes to (pypi, npm, crates)'
fi

for registry in ${REGISTRIES//,/ }; do
  case "$registry" in
    pypi) check_pypi ;;
    npm) check_npm ;;
    crates) check_crates_io ;;
    *) bad "unknown registry '${registry}' in PREFLIGHT_REGISTRIES (expected pypi, npm or crates)" ;;
  esac
done

printf '\nRelease preflight: %d verified, %d failed, %d unknown\n' \
  "$verified" "$n_fail" "$n_unknown"

if [ "$n_fail" -gt 0 ]; then
  if [ "$MODE" = 'release' ]; then
    emit_annotations error "$failures"
    append_summary
    printf '::error::release-preflight: refusing to release with %d refused credential(s)\n' "$n_fail"
    exit 1
  fi
  emit_annotations warning "$failures"
  append_summary
  printf 'Report mode: the failures above are advisory -- pull requests may come from forks without publishing credentials.\n'
  exit 0
fi

if [ "$verified" -eq 0 ]; then
  # Rule 2, second half: every probe came back unknown (or there was nothing
  # to probe). That is not a pass in release mode -- a release would run on
  # pure hope.
  if [ "$MODE" = 'release' ]; then
    emit_annotations warning "$unknowns"
    append_summary
    printf '::error::release-preflight: verified nothing (%d unknown) -- refusing to release on an unproven credential set\n' "$n_unknown"
    exit 1
  fi
  emit_annotations warning "$unknowns"
  append_summary
  printf 'Report mode: nothing was verified -- advisory only.\n'
  exit 0
fi

# Unknowns next to a verified credential still deserve a look.
emit_annotations warning "$unknowns"
append_summary
exit 0
