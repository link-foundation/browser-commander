/** Site filters match a host or its subdomains, never an unrelated suffix. */
export function matchesDomains(value, domains) {
  if (!domains?.length) {
    return true;
  }
  let host;
  try {
    host = value.includes('://') ? new URL(value).hostname : value;
  } catch {
    return false;
  }
  host = host.replace(/^\./, '').toLowerCase().replace(/\.$/, '');
  return domains.some((domain) => {
    const filter = domain.replace(/^\./, '').toLowerCase().replace(/\.$/, '');
    return host === filter || host.endsWith(`.${filter}`);
  });
}

export function validateDomains(domains) {
  if (domains === undefined) {
    return;
  }
  if (
    !Array.isArray(domains) ||
    domains.some(
      (domain) =>
        typeof domain !== 'string' || !domain || /[\s/:]/u.test(domain)
    )
  ) {
    throw new TypeError('domains must be an array of host names');
  }
}
