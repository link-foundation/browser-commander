/**
 * Convert a Firefox `places.sqlite` bookmark tree into Chrome's `Bookmarks`
 * JSON format.
 *
 * Firefox keeps bookmarks in `moz_bookmarks` (a tree of folders/rows, type 1 =
 * bookmark, type 2 = folder) joined to `moz_places` for the URLs. Chrome keeps
 * them in a JSON document with three roots (`bookmark_bar`, `other`,
 * `synced`). The Firefox toolbar maps to Chrome's bookmarks bar; the Firefox
 * menu and unsorted bookmarks map to Chrome's "other bookmarks".
 */

// Chrome stores timestamps as microseconds since 1601-01-01; a fixed, valid
// value is fine for imported bookmarks (Chrome only needs it to be parseable).
const CHROME_TIMESTAMP = '13300000000000000';

// Firefox root ids (stable across profiles).
const FIREFOX_ROOT = Object.freeze({
  TOOLBAR: 'toolbar',
  MENU: 'menu',
  UNFILED: 'unfiled',
});

function buildChromeNode(node, idRef) {
  if (node.type === 'url') {
    idRef.value += 1;
    return {
      date_added: CHROME_TIMESTAMP,
      id: String(idRef.value),
      name: node.title ?? node.url ?? '',
      type: 'url',
      url: node.url,
    };
  }
  idRef.value += 1;
  const id = String(idRef.value);
  return {
    children: (node.children ?? []).map((child) =>
      buildChromeNode(child, idRef)
    ),
    date_added: CHROME_TIMESTAMP,
    date_modified: CHROME_TIMESTAMP,
    id,
    name: node.title ?? '',
    type: 'folder',
  };
}

/**
 * Build the parent→children tree from flat `moz_bookmarks` rows.
 *
 * @param {Array<{id:number,parent:number,type:number,title:string,url:string|null}>} rows
 * @returns {Map<number, Array>}
 */
function groupByParent(rows) {
  const byParent = new Map();
  for (const row of rows) {
    if (!byParent.has(row.parent)) {
      byParent.set(row.parent, []);
    }
    byParent.get(row.parent).push(row);
  }
  return byParent;
}

function collectChildren(byParent, parentId) {
  const rows = byParent.get(parentId) ?? [];
  return rows.map((row) => {
    if (row.type === 2) {
      return {
        type: 'folder',
        title: row.title,
        children: collectChildren(byParent, row.id),
      };
    }
    return { type: 'url', title: row.title, url: row.url };
  });
}

/**
 * Convert flat `moz_bookmarks` rows (joined with URLs) to a Chrome Bookmarks
 * document.
 *
 * @param {Object} options
 * @param {Array} options.rows - Rows with {id, parent, type, title, url, root}
 * @returns {{document: Object, count: number}}
 */
export function firefoxBookmarksToChrome({ rows }) {
  const byParent = groupByParent(rows);
  const rootIdByName = {};
  for (const row of rows) {
    if (row.root && FIREFOX_ROOT[row.root.toUpperCase()]) {
      rootIdByName[row.root] = row.id;
    }
  }

  const idRef = { value: 0 };
  const makeRoot = (name, firefoxRootKey, extraRootKeys = []) => {
    const children = [];
    for (const key of [firefoxRootKey, ...extraRootKeys]) {
      const rootId = rootIdByName[key];
      if (rootId !== undefined && rootId !== null) {
        for (const child of collectChildren(byParent, rootId)) {
          children.push(buildChromeNode(child, idRef));
        }
      }
    }
    idRef.value += 1;
    return {
      children,
      date_added: CHROME_TIMESTAMP,
      date_modified: CHROME_TIMESTAMP,
      id: String(idRef.value),
      name,
      type: 'folder',
    };
  };

  const bookmarkBar = makeRoot('Bookmarks bar', FIREFOX_ROOT.TOOLBAR);
  const other = makeRoot('Other bookmarks', FIREFOX_ROOT.MENU, [
    FIREFOX_ROOT.UNFILED,
  ]);
  const synced = makeRoot('Mobile bookmarks', '__none__');

  const countUrls = (node) => {
    if (node.type === 'url') {
      return 1;
    }
    return (node.children ?? []).reduce((sum, c) => sum + countUrls(c), 0);
  };
  const count = countUrls(bookmarkBar) + countUrls(other) + countUrls(synced);

  return {
    document: {
      checksum: '',
      roots: {
        bookmark_bar: bookmarkBar,
        other,
        synced,
      },
      version: 1,
    },
    count,
  };
}
