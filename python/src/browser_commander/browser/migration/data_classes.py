"""Explicit reports for selected classes without a native target writer."""

from __future__ import annotations

from pathlib import Path

ADDITIONAL_DATA_CLASSES = (
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
)


def report_additional_class(
    type_: str, profile_dir: Path, include_payment_cards: bool
) -> list[dict[str, str]]:
    def entry(item: str, reason: str, detail: str) -> dict[str, str]:
        return {"type": type_, "item": item, "reason": reason, "detail": detail}

    if type_ == "passkeys":
        return [
            entry(
                provider,
                "passkey-not-exportable",
                f"{provider} private keys cannot be exported by copying browser profile files. Provider-authorized transfer may be available separately. Sign in once with the platform passkey in a dedicated persistent profile and retain its session.",
            )
            for provider in (
                "iCloud Keychain",
                "Google Password Manager",
                "Windows Hello",
            )
        ]
    if type_ == "paymentCards" and not include_payment_cards:
        return [
            entry(
                str(profile_dir),
                "payment-card-consent-required",
                "Payment cards require includePaymentCards=true (Python/Rust: include_payment_cards; CLI: --include-payment-cards). Selecting the class alone does not grant consent.",
            )
        ]
    if type_ == "clientCertificates":
        return [
            entry(
                str(profile_dir),
                "client-certificates-os-export-required",
                "Client certificate private keys require an authorized export from the OS or NSS store. Hardware-backed or non-exportable keys cannot be copied from browser profile files.",
            )
        ]
    return [
        entry(
            str(profile_dir),
            "data-class-not-supported",
            f"A native source reader and compatible target writer for {type_} are not implemented; no data was copied.",
        )
    ]
