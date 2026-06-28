export function formatRegistryPackagePath(packageName) {
  return encodeURIComponent(packageName);
}

export async function isVersionPublished(
  packageName,
  version,
  fetchFn = fetch
) {
  const packagePath = formatRegistryPackagePath(packageName);
  const versionPath = encodeURIComponent(version);
  const response = await fetchFn(
    `https://registry.npmjs.org/${packagePath}/${versionPath}`,
    {
      headers: { accept: 'application/json' },
    }
  );

  if (response.status === 404) {
    return false;
  }

  if (!response.ok) {
    throw new Error(
      `Failed to check npm registry for ${packageName}@${version}: ${response.status} ${response.statusText}`
    );
  }

  const metadata = await response.json();
  return metadata?.version === version;
}
