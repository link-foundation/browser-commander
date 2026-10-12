/** Resolve a text match to an unambiguous CSS path without changing the DOM. */
export function textSelectorInPage({ baseSelector, text, exact }) {
  const matching = Array.from(document.querySelectorAll(baseSelector)).find(
    (element) => {
      const content = element.textContent.trim();
      return exact ? content === text : content.includes(text);
    }
  );
  if (!matching) {
    return null;
  }
  const steps = [];
  for (let node = matching; node; node = node.parentElement) {
    const siblings = Array.from(node.parentElement?.children ?? []).filter(
      (sibling) => sibling.localName === node.localName
    );
    const index = siblings.indexOf(node) + 1;
    steps.unshift(
      `${window.CSS.escape(node.localName)}:nth-of-type(${Math.max(1, index)})`
    );
  }
  return steps.join(' > ');
}
