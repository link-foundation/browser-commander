"""Record current published dependency versions for the issue #124 upgrade."""

import concurrent.futures
import json
import re
import tomllib
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MANIFESTS = [ROOT / "js/package.json", ROOT / "js/examples/react-test-app/package.json"]
requests = set()
for path in MANIFESTS:
    manifest = json.loads(path.read_text())
    for section in ("dependencies", "devDependencies", "peerDependencies"):
        requests.update(("npm", name) for name in manifest.get(section, {}))
python = tomllib.loads((ROOT / "python/pyproject.toml").read_text())
requirements = python["build-system"]["requires"] + python["project"]["dependencies"]
for group in python["project"]["optional-dependencies"].values():
    requirements += group
requests.update(("pypi", re.match(r"[\w-]+", req)[0]) for req in requirements)
for path in [ROOT / "rust/Cargo.toml", *ROOT.glob("experiments/*/Cargo.toml")]:
    manifest = tomllib.loads(path.read_text())
    for section in ("dependencies", "dev-dependencies"):
        requests.update(("crates", name) for name in manifest.get(section, {}))
    for target in manifest.get("target", {}).values():
        requests.update(("crates", name) for name in target.get("dependencies", {}))


def latest(item):
    registry, name = item
    escaped = urllib.parse.quote(name, safe="")
    url = {
        "npm": f"https://registry.npmjs.org/{escaped}/latest",
        "pypi": f"https://pypi.org/pypi/{escaped}/json",
        "crates": f"https://crates.io/api/v1/crates/{escaped}",
    }[registry]
    request = urllib.request.Request(
        url, headers={"User-Agent": "browser-commander-issue-124"}
    )
    with urllib.request.urlopen(request) as response:
        data = json.load(response)
    if registry == "npm":
        return (
            registry,
            name,
            {"version": data["version"], "engines": data.get("engines", {})},
        )
    if registry == "pypi":
        return (
            registry,
            name,
            {
                "version": data["info"]["version"],
                "requires_python": data["info"]["requires_python"],
            },
        )
    return registry, name, {"version": data["crate"]["max_stable_version"]}


if __name__ == "__main__":
    snapshot = {"npm": {}, "pypi": {}, "crates": {}}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for registry, name, value in pool.map(latest, sorted(requests)):
            snapshot[registry][name] = value
    (Path(__file__).parent / "dependency-versions.json").write_text(
        json.dumps(snapshot, indent=2) + "\n"
    )
    print(json.dumps(snapshot, indent=2))
