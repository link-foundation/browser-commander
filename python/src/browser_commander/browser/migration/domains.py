"""Exact host and subdomain isolation for per-site migration classes."""

from urllib.parse import urlsplit


def matches_domains(value, domains):
    if not domains:
        return True
    try:
        host = urlsplit(value).hostname if "://" in value else value
    except ValueError:
        return False
    host = (host or "").lstrip(".").lower().rstrip(".")
    return any(
        host == domain.lstrip(".").lower().rstrip(".")
        or host.endswith("." + domain.lstrip(".").lower().rstrip("."))
        for domain in domains
    )


def validate_domains(domains):
    if domains is not None and (
        isinstance(domains, (str, bytes))
        or any(
            not isinstance(domain, str)
            or not domain
            or any(c.isspace() or c in "/:" for c in domain)
            for domain in domains
        )
    ):
        raise TypeError("domains must be an array of host names")
