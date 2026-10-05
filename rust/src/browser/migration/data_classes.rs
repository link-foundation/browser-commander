//! Explicit reports for selected classes without a native target writer.

use std::path::Path;

use super::MigrationEntry;

pub(crate) const ADDITIONAL_DATA_CLASSES: [&str; 12] = [
    "localStorage",
    "indexedDB",
    "sessionStorage",
    "autofill",
    "paymentCards",
    "searchEngines",
    "siteSettings",
    "openTabs",
    "downloads",
    "readingList",
    "clientCertificates",
    "passkeys",
];

pub(crate) fn report_additional_class(
    type_: &str,
    profile: &Path,
    include_payment_cards: bool,
) -> Vec<MigrationEntry> {
    let entry = |item: &str, reason, detail: String| {
        MigrationEntry::new(type_, item, reason).with_detail(detail)
    };
    if type_ == "passkeys" {
        return ["iCloud Keychain", "Google Password Manager", "Windows Hello"]
            .into_iter()
            .map(|provider| entry(
                provider,
                "passkey-not-exportable",
                format!("{provider} private keys cannot be exported by copying browser profile files. Provider-authorized transfer may be available separately. Sign in once with the platform passkey in a dedicated persistent profile and retain its session."),
            ))
            .collect();
    }
    let item = profile.display().to_string();
    if type_ == "paymentCards" && !include_payment_cards {
        return vec![entry(
            &item, "payment-card-consent-required",
            "Payment cards require includePaymentCards=true (Python/Rust: include_payment_cards; CLI: --include-payment-cards). Selecting the class alone does not grant consent.".into(),
        )];
    }
    if type_ == "clientCertificates" {
        return vec![entry(
            &item, "client-certificates-os-export-required",
            "Client certificate private keys require an authorized export from the OS or NSS store. Hardware-backed or non-exportable keys cannot be copied from browser profile files.".into(),
        )];
    }
    vec![entry(
        &item, "data-class-not-supported",
        format!("A native source reader and compatible target writer for {type_} are not implemented; no data was copied."),
    )]
}
