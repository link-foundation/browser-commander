"""Convert Firefox ``moz_bookmarks`` rows into a Chrome ``Bookmarks`` document.

Firefox keeps bookmarks in ``places.sqlite`` under three roots (toolbar, menu
and unfiled); Chrome keeps a JSON document with ``bookmark_bar``, ``other``
and ``synced`` roots. The toolbar becomes the bookmark bar and the menu plus
unfiled bookmarks become "Other bookmarks". Ids are assigned in the same
order as the JavaScript port so both produce byte-identical files.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from typing import Any

__all__ = [
    "CHROME_TIMESTAMP",
    "FIREFOX_ROOT",
    "firefox_bookmarks_to_chrome",
]

#: Fixed ``date_added``/``date_modified`` for converted nodes (Chrome's
#: microseconds-since-1601 format).
CHROME_TIMESTAMP = "13300000000000000"

#: Firefox root names, keyed by their upper-case name.
FIREFOX_ROOT = {
    "TOOLBAR": "toolbar",
    "MENU": "menu",
    "UNFILED": "unfiled",
}

_FOLDER = 2


def _first_present(*values: Any) -> Any:
    return next((value for value in values if value is not None), None)


def _build_chrome_node(node: Mapping[str, Any], counter: list[int]) -> dict[str, Any]:
    if node["type"] == "url":
        counter[0] += 1
        return {
            "date_added": CHROME_TIMESTAMP,
            "id": str(counter[0]),
            "name": _first_present(node.get("title"), node.get("url"), ""),
            "type": "url",
            "url": node.get("url"),
        }
    # A folder takes its id before its children do.
    counter[0] += 1
    node_id = str(counter[0])
    return {
        "children": [
            _build_chrome_node(child, counter) for child in node.get("children") or []
        ],
        "date_added": CHROME_TIMESTAMP,
        "date_modified": CHROME_TIMESTAMP,
        "id": node_id,
        "name": _first_present(node.get("title"), ""),
        "type": "folder",
    }


def _group_by_parent(
    rows: Iterable[Mapping[str, Any]],
) -> dict[Any, list[Mapping[str, Any]]]:
    by_parent: dict[Any, list[Mapping[str, Any]]] = {}
    for row in rows:
        by_parent.setdefault(row.get("parent"), []).append(row)
    return by_parent


def _collect_children(
    by_parent: Mapping[Any, list[Mapping[str, Any]]], parent_id: Any
) -> list[dict[str, Any]]:
    children: list[dict[str, Any]] = []
    for row in by_parent.get(parent_id, []):
        if row.get("type") == _FOLDER:
            children.append(
                {
                    "type": "folder",
                    "title": row.get("title"),
                    "children": _collect_children(by_parent, row.get("id")),
                }
            )
        else:
            children.append(
                {"type": "url", "title": row.get("title"), "url": row.get("url")}
            )
    return children


def _count_urls(node: Mapping[str, Any]) -> int:
    if node.get("type") == "url":
        return 1
    return sum(_count_urls(child) for child in node.get("children") or [])


def firefox_bookmarks_to_chrome(
    rows: Sequence[Mapping[str, Any]],
) -> tuple[dict[str, Any], int]:
    """Build a Chrome ``Bookmarks`` document from Firefox bookmark rows.

    Args:
        rows: Mappings with ``id``, ``parent``, ``type`` (1 bookmark, 2
            folder), ``title``, ``url`` and ``root`` (``"toolbar"``,
            ``"menu"``, ``"unfiled"`` or ``None``), ordered by parent and
            position.

    Returns:
        ``(document, count)`` where ``count`` is the number of URL bookmarks.
    """

    by_parent = _group_by_parent(rows)
    root_id_by_name: dict[str, Any] = {}
    for row in rows:
        root = row.get("root")
        if root and root.upper() in FIREFOX_ROOT:
            root_id_by_name[root] = row.get("id")

    counter = [0]

    def make_root(name: str, *root_keys: str) -> dict[str, Any]:
        children: list[dict[str, Any]] = []
        for key in root_keys:
            root_id = root_id_by_name.get(key)
            if root_id is not None:
                children.extend(
                    _build_chrome_node(child, counter)
                    for child in _collect_children(by_parent, root_id)
                )
        # A root takes its id after its children.
        counter[0] += 1
        return {
            "children": children,
            "date_added": CHROME_TIMESTAMP,
            "date_modified": CHROME_TIMESTAMP,
            "id": str(counter[0]),
            "name": name,
            "type": "folder",
        }

    bookmark_bar = make_root("Bookmarks bar", FIREFOX_ROOT["TOOLBAR"])
    other = make_root("Other bookmarks", FIREFOX_ROOT["MENU"], FIREFOX_ROOT["UNFILED"])
    synced = make_root("Mobile bookmarks", "__none__")
    count = _count_urls(bookmark_bar) + _count_urls(other) + _count_urls(synced)
    document = {
        "checksum": "",
        "roots": {"bookmark_bar": bookmark_bar, "other": other, "synced": synced},
        "version": 1,
    }
    return document, count
