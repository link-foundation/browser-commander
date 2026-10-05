"""Add executable declarations to the existing shared catalogue."""

import json
from pathlib import Path

root = Path(__file__).resolve().parents[2]
file = root / "js/src/browser/browser-sources.json"
catalogue = json.loads(file.read_text())
entries = catalogue["browsers"]
by_id = {b["id"]: b for b in entries}

new = [
    (
        "whale",
        "chromium",
        {
            "darwin": ["{appSupport}/Naver/Whale"],
            "win32": ["{localAppData}/Naver/Naver Whale/User Data"],
            "linux": ["{config}/naver-whale"],
        },
        ["naver-whale"],
        "Whale Safe Storage",
        {
            "darwin": ["com.naver.Whale"],
            "win32": ["WhaleHTM"],
            "linux": ["naver-whale.desktop"],
        },
    ),
    (
        "360se",
        "chromium",
        {"win32": ["{appData}/360se6/User Data"]},
        ["360-secure"],
        "360 Safe Storage",
        {"win32": ["360seURL"]},
    ),
    (
        "360chrome",
        "chromium",
        {"win32": ["{localAppData}/360Chrome/Chrome/User Data"]},
        ["360-extreme"],
        "360Chrome Safe Storage",
        {"win32": ["360ChromeURL"]},
    ),
    (
        "qq",
        "chromium",
        {"win32": ["{localAppData}/Tencent/QQBrowser/User Data"]},
        ["qq-browser"],
        "QQBrowser Safe Storage",
        {"win32": ["QQBrowserURL"]},
    ),
    (
        "sogou",
        "chromium",
        {"win32": ["{appData}/SogouExplorer"]},
        ["sogou-explorer"],
        "Sogou Safe Storage",
        {"win32": ["SogouExplorer.HTML"]},
    ),
    (
        "duckduckgo",
        "detection",
        {
            "darwin": [
                "{home}/Library/Containers/com.duckduckgo.macos.browser/Data/Library/Application Support/DuckDuckGo"
            ],
            "win32": [
                "{localAppData}/Packages/DuckDuckGo.DesktopBrowser_ya2fgkz3nks94/LocalState"
            ],
        },
        [],
        None,
        {"darwin": ["com.duckduckgo.macos.browser"], "win32": ["DuckDuckGoHTML"]},
    ),
    (
        "tor",
        "firefox",
        {
            "darwin": ["{appSupport}/TorBrowser-Data/Browser"],
            "linux": [
                "{home}/.local/share/torbrowser/tbb/x86_64/tor-browser/Browser/TorBrowser/Data/Browser"
            ],
            "win32": ["{home}/Desktop/Tor Browser/Browser/TorBrowser/Data/Browser"],
        },
        ["tor-browser"],
        None,
        {
            "darwin": ["org.torproject.torbrowser"],
            "linux": ["torbrowser.desktop"],
            "win32": ["TorBrowserHTML"],
        },
    ),
]
for id_, family, roots, aliases, service, defaults in new:
    if id_ in by_id:
        continue
    b = dict(id=id_, family=family, aliases=aliases, roots=roots, default=defaults)
    if service:
        b["safeStorage"] = dict(
            service=service,
            application=id_,
            folder=service.replace("Safe Storage", "Keys"),
        )
    if id_ in ("sogou", "duckduckgo"):
        b["singleProfile"] = True
    entries.append(b)
    by_id[id_] = b

if "edge-canary" not in by_id:
    b = dict(
        id="edge-canary",
        family="chromium",
        aliases=["msedge-canary", "microsoft-edge-canary"],
        roots={
            "darwin": ["{appSupport}/Microsoft Edge Canary"],
            "win32": ["{localAppData}/Microsoft/Edge SxS/User Data"],
        },
        safeStorage=by_id["edge"]["safeStorage"],
        default={"darwin": ["com.microsoft.edgemac.Canary"]},
    )
    entries.append(b)
    by_id[b["id"]] = b
for suffix in ("beta", "dev"):
    alias = "msedge-" + suffix
    if alias not in by_id["edge-" + suffix]["aliases"]:
        by_id["edge-" + suffix]["aliases"].append(alias)

specs = {
    "chrome": (
        "Google Chrome",
        "Google/Chrome/Application/chrome.exe",
        ["google-chrome", "google-chrome-stable", "chrome"],
    ),
    "chrome-beta": (
        "Google Chrome Beta",
        "Google/Chrome Beta/Application/chrome.exe",
        ["google-chrome-beta"],
    ),
    "chrome-dev": (
        "Google Chrome Dev",
        "Google/Chrome Dev/Application/chrome.exe",
        ["google-chrome-unstable"],
    ),
    "chrome-canary": (
        "Google Chrome Canary",
        "Google/Chrome SxS/Application/chrome.exe",
        ["google-chrome-canary"],
    ),
    "chromium": (
        "Chromium",
        "Chromium/Application/chrome.exe",
        ["chromium", "chromium-browser"],
    ),
    "brave": (
        "Brave Browser",
        "BraveSoftware/Brave-Browser/Application/brave.exe",
        ["brave-browser", "brave-browser-stable", "brave"],
    ),
    "edge": (
        "Microsoft Edge",
        "Microsoft/Edge/Application/msedge.exe",
        ["microsoft-edge", "microsoft-edge-stable", "msedge"],
    ),
    "edge-beta": (
        "Microsoft Edge Beta",
        "Microsoft/Edge Beta/Application/msedge.exe",
        ["microsoft-edge-beta"],
    ),
    "edge-dev": (
        "Microsoft Edge Dev",
        "Microsoft/Edge Dev/Application/msedge.exe",
        ["microsoft-edge-dev"],
    ),
    "edge-canary": (
        "Microsoft Edge Canary",
        "Microsoft/Edge SxS/Application/msedge.exe",
        ["microsoft-edge-canary"],
    ),
    "opera": ("Opera", "Programs/Opera/opera.exe", ["opera"]),
    "opera-gx": ("Opera GX", "Programs/Opera GX/opera.exe", ["opera-gx"]),
    "yandex": (
        "Yandex",
        "Yandex/YandexBrowser/Application/browser.exe",
        ["yandex-browser", "yandex-browser-stable"],
    ),
    "vivaldi": (
        "Vivaldi",
        "Vivaldi/Application/vivaldi.exe",
        ["vivaldi", "vivaldi-stable"],
    ),
    "arc": ("Arc", "Programs/Arc/Arc.exe", ["arc"]),
    "whale": (
        "Whale",
        "Naver/Naver Whale/Application/whale.exe",
        ["naver-whale", "whale"],
    ),
    "360se": (None, "360/360se6/360se.exe", ["360se"]),
    "360chrome": (None, "360Chrome/Chrome/Application/360chrome.exe", ["360chrome"]),
    "qq": (None, "Tencent/QQBrowser/QQBrowser.exe", ["qqbrowser"]),
    "sogou": (None, "SogouExplorer/SogouExplorer.exe", ["sogouexplorer"]),
    "firefox": ("Firefox", "Mozilla Firefox/firefox.exe", ["firefox"]),
    "firefox-developer": (
        "Firefox Developer Edition",
        "Firefox Developer Edition/firefox.exe",
        ["firefox-developer-edition", "firefox"],
    ),
    "firefox-nightly": (
        "Firefox Nightly",
        "Firefox Nightly/firefox.exe",
        ["firefox-nightly", "firefox"],
    ),
    "librewolf": ("LibreWolf", "LibreWolf/librewolf.exe", ["librewolf"]),
    "waterfox": ("Waterfox", "Waterfox/waterfox.exe", ["waterfox"]),
    "zen": ("Zen", "Zen Browser/zen.exe", ["zen-browser", "zen"]),
    "floorp": ("Floorp", "Floorp/floorp.exe", ["floorp"]),
    "tor": ("Tor Browser", "Tor Browser/Browser/firefox.exe", ["tor-browser"]),
}
for b in entries:
    if b["id"] not in specs:
        continue
    app, win, names = specs[b["id"]]
    b["executableNames"] = names
    b["executables"] = {}
    if "darwin" in b["roots"] and app:
        mac_name = "firefox" if b["family"] == "firefox" else app
        rel = f"{app}.app/Contents/MacOS/{mac_name}"
        b["executables"]["darwin"] = [
            "/Applications/" + rel,
            "{home}/Applications/" + rel,
        ]
    if "win32" in b["roots"]:
        b["executables"]["win32"] = [
            "{" + base + "}/" + win
            for base in ["localAppData", "programFiles", "programFilesX86"]
        ]
        if b["id"] in ("opera", "opera-gx"):
            b["executables"]["win32"].insert(
                1, "{localAppData}/" + win.replace("opera.exe", "launcher.exe")
            )
    if "linux" in b["roots"]:
        b["executables"]["linux"] = [
            directory + name
            for directory in ["/usr/bin/", "/usr/local/bin/"]
            for name in names
        ]
        if b["id"] == "chrome":
            b["executables"]["linux"].append("/opt/google/chrome/google-chrome")
    b["controlProtocol"] = "bidi" if b["family"] == "firefox" else "cdp"

payload = json.dumps(catalogue, ensure_ascii=False, indent=2) + "\n"
for target in [
    "js/src/browser/browser-sources.json",
    "python/src/browser_commander/browser/browser-sources.json",
    "rust/src/browser/browser-sources.json",
]:
    (root / target).write_text(payload)
