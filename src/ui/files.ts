import { el } from './el';

/** Hands the player a text file to save, as the browser's download of `fileName`. */
export const downloadText = (fileName: string, text: string): void => {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = el('a', { attrs: { href: url, download: fileName } });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

/**
 * A button-like file picker labelled `label` that reads the chosen file as text and hands it to
 * `onText`; the same file may be chosen again.
 */
export const textFilePicker = (label: string, onText: (text: string) => void) => {
  const input = el('input', {
    className: 'file-picker__input',
    attrs: { type: 'file', accept: '.json,application/json' },
  });
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    void file.text().then((text) => {
      input.value = '';
      onText(text);
    });
  });
  return el('label', { className: 'menu-button file-picker' }, el('span', { text: label }), input);
};
