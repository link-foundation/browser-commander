"""Apply the registry snapshot while retaining Python 3.9 compatibility."""

import json
import re
import tomllib
import urllib.request
from pathlib import Path

from packaging.specifiers import SpecifierSet
from packaging.version import Version

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = Path(__file__).with_name("dependency-versions.json")
versions = json.loads(SNAPSHOT.read_text())
for path in [
    ROOT / "js/package.json",
    ROOT / "js/examples/react-test-app/package.json",
]:
    manifest = json.loads(path.read_text())
    for section in ("dependencies", "devDependencies", "peerDependencies"):
        for name in manifest.get(section, {}):
            prefix = ">=" if section == "peerDependencies" else "^"
            manifest[section][name] = prefix + versions["npm"][name]["version"]
    path.write_text(json.dumps(manifest, indent=2) + "\n")

python_path = ROOT / "python/pyproject.toml"
source = python_path.read_text()
source = source.replace(
    "    # mypy 2.x no longer supports type-checking Python 3.9, which this package supports.\n",
    "",
)
source = source.replace("    # For testing, include both browser drivers\n", "")
for name, latest in versions["pypi"].items():
    with urllib.request.urlopen(f"https://pypi.org/pypi/{name}/json") as response:
        data = json.load(response)
    compatibility = {}
    for interpreter in ("3.9.2", "3.10.0", "3.11.0"):
        candidates = [
            version
            for version, files in data["releases"].items()
            if not Version(version).is_prerelease
            and files
            and any(
                not file.get("yanked")
                and SpecifierSet(file.get("requires_python") or "").contains(
                    interpreter
                )
                for file in files
            )
        ]
        compatibility[interpreter] = str(max(map(Version, candidates)))
    latest["compatible"] = compatibility
    pattern = rf'"({re.escape(name)}(?:\[[^\]]+\])?)(?:[<>=!~][^";]*)"'

    def replacement(match):
        requirement = match[1]
        if SpecifierSet(latest["requires_python"]).contains("3.9.2"):
            return f'"{requirement}>={latest["version"]}"'
        threshold = (
            "3.11"
            if not SpecifierSet(latest["requires_python"]).contains("3.10.0")
            else "3.10"
        )
        legacy = compatibility["3.9.2"]
        return f"\"{requirement}>={latest['version']}; python_version >= '{threshold}'\", \"{requirement}>={legacy}; python_version < '{threshold}'\""

    source = re.sub(pattern, replacement, source)
python_path.write_text(source)
SNAPSHOT.write_text(json.dumps(versions, indent=2) + "\n")

for path in [ROOT / "rust/Cargo.toml", *ROOT.glob("experiments/*/Cargo.toml")]:
    manifest = tomllib.loads(path.read_text())
    names = set(manifest.get("dependencies", {})) | set(
        manifest.get("dev-dependencies", {})
    )
    for target in manifest.get("target", {}).values():
        names.update(target.get("dependencies", {}))
    source = path.read_text()
    for name in names & versions["crates"].keys():
        value = versions["crates"][name]["version"]
        pattern = rf'(^\s*{re.escape(name)}\s*=\s*(?:\{{\s*version\s*=\s*)?")[^"]+(")'
        source = re.sub(
            pattern,
            lambda match: match[1] + value + match[2],
            source,
            flags=re.MULTILINE,
        )
    path.write_text(source)
