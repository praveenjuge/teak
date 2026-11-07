// Text from Teak (card content, titles, notes, a server's message) is data. A
// saved page can carry escape sequences that retitle the terminal, hide text,
// plant links or write the clipboard, so human output keeps printable
// characters, newlines and tabs only. JSON output escapes them by itself.

const isControl = (code: number) =>
  (code < 0x20 && code !== 0x09 && code !== 0x0a) ||
  (code >= 0x7f && code <= 0x9f);

const hasControl = (text: string) => {
  for (let index = 0; index < text.length; index += 1) {
    if (isControl(text.charCodeAt(index))) {
      return true;
    }
  }
  return false;
};

/** The text with control characters taken out; a carriage return becomes a newline. */
export const terminalText = (text: string) => {
  if (!hasControl(text)) {
    return text;
  }
  let safe = "";
  for (const character of text.replace(/\r\n?/g, "\n")) {
    if (!isControl(character.charCodeAt(0))) {
      safe += character;
    }
  }
  return safe;
};
