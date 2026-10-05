/** Explicit reports for selected classes without a native target writer. */
export const ADDITIONAL_DATA_CLASSES = Object.freeze([
  'localStorage',
  'indexedDB',
  'sessionStorage',
  'autofill',
  'paymentCards',
  'searchEngines',
  'siteSettings',
  'openTabs',
  'downloads',
  'readingList',
  'clientCertificates',
  'passkeys',
]);

export function reportAdditionalClasses({
  selected,
  profileDir,
  includePaymentCards,
}) {
  return ADDITIONAL_DATA_CLASSES.filter((type) => selected.has(type)).flatMap(
    (type) => reportAdditionalClass({ type, profileDir, includePaymentCards })
  );
}

export function reportAdditionalClass({
  type,
  profileDir,
  includePaymentCards,
}) {
  const entry = (item, reason, detail) => ({ type, item, reason, detail });
  if (type === 'passkeys') {
    return ['iCloud Keychain', 'Google Password Manager', 'Windows Hello'].map(
      (provider) =>
        entry(
          provider,
          'passkey-not-exportable',
          `${provider} private keys cannot be exported by copying browser profile files. Provider-authorized transfer may be available separately. Sign in once with the platform passkey in a dedicated persistent profile and retain its session.`
        )
    );
  }
  if (type === 'paymentCards' && !includePaymentCards) {
    return [
      entry(
        profileDir,
        'payment-card-consent-required',
        'Payment cards require includePaymentCards=true (Python/Rust: include_payment_cards; CLI: --include-payment-cards). Selecting the class alone does not grant consent.'
      ),
    ];
  }
  if (type === 'clientCertificates') {
    return [
      entry(
        profileDir,
        'client-certificates-os-export-required',
        'Client certificate private keys require an authorized export from the OS or NSS store. Hardware-backed or non-exportable keys cannot be copied from browser profile files.'
      ),
    ];
  }
  return [
    entry(
      profileDir,
      'data-class-not-supported',
      `A native source reader and compatible target writer for ${type} are not implemented; no data was copied.`
    ),
  ];
}
