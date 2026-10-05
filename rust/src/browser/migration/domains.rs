pub(crate) fn matches_domains(value: &str, domains: &[String]) -> bool {
    if domains.is_empty() {
        return true;
    }
    let host = if value.contains("://") {
        let Ok(url) = url::Url::parse(value) else {
            return false;
        };
        url.host_str().unwrap_or_default().to_string()
    } else {
        value.to_string()
    };
    let host = host
        .trim_start_matches('.')
        .trim_end_matches('.')
        .to_lowercase();
    domains.iter().any(|domain| {
        let filter = domain
            .trim_start_matches('.')
            .trim_end_matches('.')
            .to_lowercase();
        host == filter || host.ends_with(&format!(".{filter}"))
    })
}
