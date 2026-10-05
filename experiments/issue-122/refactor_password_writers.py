"""One-time extraction used during issue 122; current code is already extracted."""

from pathlib import Path

p = Path("js/src/browser/migration/firefox.js")
s = p.read_text()
if "export async function writeChromiumPasswords" in s:
    raise SystemExit("Password writers are already extracted; no files changed.")
start = s.index(
    "  await mkdir(targetProfileDir",
    s.index("export async function migrateFirefoxPasswords"),
)
end = s.index("  const warnings = [];", start)
body = s[start:end].replace("const entry of decrypted", "const entry of entries")
s = (
    s[:start]
    + "  const migrated = await writeChromiumPasswords({ entries: decrypted, targetProfileDir, platform, targetKey, targetPrefix });\n\n"
    + s[end:]
)
s += (
    "\nexport async function writeChromiumPasswords({ entries, targetProfileDir, platform, targetKey, targetPrefix }) {\n"
    + body
    + "  return migrated;\n}\n"
)
p.write_text(s)

p = Path("python/src/browser_commander/browser/migration/firefox.py")
s = p.read_text()
start = s.index(
    "    target = Path(target_profile_dir)", s.index("def migrate_firefox_passwords")
)
end = s.index("    warnings: list", start)
body = (
    s[start:end]
    .replace("for entry in decrypted:", "for entry in entries:")
    .replace("prefix=prefix,", "prefix=target_prefix,")
)
s = (
    s[:start]
    + "    migrated = write_chromium_passwords(entries=decrypted, target_profile_dir=target_profile_dir, platform=platform, target_key=target_key, target_prefix=prefix)\n\n"
    + s[end:]
)
s += (
    "\ndef write_chromium_passwords(*, entries: list[dict[str, str]], target_profile_dir: PathLike, platform: str, target_key: bytes, target_prefix: str | None = None) -> int:\n"
    + body
    + "    return migrated\n"
)
p.write_text(s)

p = Path("rust/src/browser/migration/firefox.rs")
s = p.read_text()
start = s.index(
    "    fs::create_dir_all(target_profile_dir)",
    s.index("pub(crate) fn migrate_firefox_passwords_filtered"),
)
end = s.index("    if outcome.migrated > 0", start)
body = (
    s[start:end]
    .replace("for entry in &decrypted", "for entry in entries")
    .replace("outcome.migrated += 1;", "migrated += 1;")
)
s = (
    s[:start]
    + "    outcome.migrated = write_chromium_passwords(target_profile_dir, &decrypted, keys)?;\n\n"
    + s[end:]
)
s += (
    "\npub(crate) fn write_chromium_passwords(target_profile_dir: &Path, entries: &[DecryptedLogin], keys: &FirefoxPasswordKeys<'_>) -> Result<u64> {\n    let mut migrated = 0;\n"
    + body
    + "    Ok(migrated)\n}\n"
)
s = s.replace("struct DecryptedLogin {", "pub(crate) struct DecryptedLogin {")
start = s.index("pub(crate) struct DecryptedLogin {")
end = s.index("\n}", start)
part = s[start:end]
for field in ("origin", "username", "password"):
    part = part.replace(f"    {field}:", f"    pub {field}:")
s = s[:start] + part + s[end:]
p.write_text(s)
