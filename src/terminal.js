const shades = { accent: '38;2;117;210;218', bright: '1;38;2;233;240;245', muted: '38;2;143;159;176', border: '38;2;66;86;107', green: '38;2;128;207;151', yellow: '38;2;241;197;120', red: '38;2;235;132;142', blue: '38;2;127;170;245', cyan: '38;2;117;210;218', magenta: '38;2;194;157;235' };
export const strip = text => String(text).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
export const clean = text => strip(text).replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
export function charWidth(char) {
  const cp = char.codePointAt(0);
  if (/\p{Mark}/u.test(char) || cp === 0x200d || (cp >= 0x2066 && cp <= 0x2069)) return 0;
  return cp >= 0x1100 && (cp <= 0x115f || cp >= 0x2e80 && cp <= 0xa4cf || cp >= 0xac00 && cp <= 0xd7a3 || cp >= 0xf900 && cp <= 0xfaff || cp >= 0xfe10 && cp <= 0xfe6f || cp >= 0xff01 && cp <= 0xff60 || cp >= 0x1f300) ? 2 : 1;
}
export const widthOf = text => [...strip(text)].reduce((sum, ch) => sum + charWidth(ch), 0);
export function fit(text, width) {
  width = Math.max(0, width);
  text = String(text ?? '');
  if (widthOf(text) <= width) return text + ' '.repeat(width - widthOf(text));
  let result = '', count = 0;
  for (const char of strip(text)) {
    if (count + charWidth(char) > width - 1) break;
    result += char; count += charWidth(char);
  }
  return result + (width ? '…' : '') + ' '.repeat(Math.max(0, width - count - 1));
}
export function paint(text, shade, color = true) {
  const hex = /^#[\da-f]{6}$/i.test(shade) ? shade.slice(1).match(/../g).map(value => parseInt(value, 16)) : null;
  return color ? `\x1b[${hex ? `38;2;${hex.join(';')}` : shades[shade] || shades.accent}m${text}\x1b[0m` : String(text);
}
export function pane(title, lines, width, height, color = true) {
  const label = fit(` ${title} `, Math.min(width - 2, widthOf(title) + 2));
  return [paint(`╭${label}${'─'.repeat(Math.max(0, width - 2 - widthOf(label)))}╮`, 'border', color),
    ...Array.from({ length: Math.max(0, height - 2) }, (_, i) => paint('│', 'border', color) + fit(lines[i] || '', width - 2) + paint('│', 'border', color)),
    paint(`╰${'─'.repeat(Math.max(0, width - 2))}╯`, 'border', color)];
}
