/**
 * Pure text layout for on-air text cards. ffmpeg's drawtext does not wrap, so
 * lines are broken here using conservative glyph widths (calibrated against
 * DejaVu Sans, which is wider than Arial) so text never runs off the frame.
 */

export interface TextLayout {
  fontSize: number
  lineSpacing: number
  lines: string[]
  truncated: boolean
}

/** Rendered line height (ascent + descent) as a multiple of font size. */
export const LINE_HEIGHT_EM = 1.2
export const LINE_GAP_EM = 0.15
const FONT_SIZES = [64, 52, 42, 34, 30] as const

/** Upper-bound advance width of one character, in em. */
export function charWidthEm(ch: string) {
  if (ch === ' ') return 0.32
  if ('mwMW@%'.includes(ch)) return 1.0
  if ('ijlIft.,:;!|\'"()[]'.includes(ch)) return 0.42
  if (/[A-Z]/.test(ch)) return 0.78
  if (/[0-9]/.test(ch)) return 0.64
  if (/[a-z]/.test(ch)) return 0.62
  const code = ch.codePointAt(0) || 0
  return code > 0x2e80 ? 1.05 : 0.8 // CJK / wide scripts, then everything else
}

export function measureEm(text: string) {
  let width = 0
  for (const ch of Array.from(text)) width += charWidthEm(ch)
  return width
}

// Emoji (and their joiners / variation selectors) render as empty boxes with
// ordinary broadcast fonts, so they are removed. Built with RegExp for the ES2017 target.
const EMOJI = new RegExp('[\\p{Extended_Pictographic}\\u{1F1E6}-\\u{1F1FF}\\u200D\\uFE0F\\u{1F3FB}-\\u{1F3FF}]', 'gu')

export function normalizeText(input: string) {
  return String(input || '')
    .replace(EMOJI, '')
    .replace(/\r\n?/g, '\n')
    // Drop control characters (except newline and tab) that would render as boxes.
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .replace(/\t/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Greedy word wrap to a maximum width in em. Words wider than a line are hard-broken. */
export function wrapText(text: string, maxWidthEm: number): string[] {
  const lines: string[] = []
  for (const paragraph of normalizeText(text).split('\n')) {
    const words = paragraph.split(/ +/).filter(Boolean)
    if (words.length === 0) {
      lines.push('')
      continue
    }
    let line = ''
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (measureEm(candidate) <= maxWidthEm) {
        line = candidate
        continue
      }
      if (line) lines.push(line)
      line = ''
      if (measureEm(word) <= maxWidthEm) {
        line = word
        continue
      }
      // Hard-break an over-long word.
      for (const ch of Array.from(word)) {
        if (measureEm(line + ch) > maxWidthEm && line) {
          lines.push(line)
          line = ''
        }
        line += ch
      }
    }
    if (line) lines.push(line)
  }
  return lines
}

export function textBlockHeight(lines: number, fontSize: number, lineSpacing: number) {
  return lines * fontSize * LINE_HEIGHT_EM + Math.max(0, lines - 1) * lineSpacing
}

/**
 * Picks the largest font size whose wrapped lines fit the box; truncates with an
 * ellipsis at the smallest size if the text still does not fit.
 */
export function layoutText(text: string, boxWidth: number, boxHeight: number): TextLayout {
  for (const fontSize of FONT_SIZES) {
    const maxWidthEm = boxWidth / fontSize
    const lineSpacing = Math.round(fontSize * LINE_GAP_EM)
    const maxLines = Math.max(1, Math.floor((boxHeight + lineSpacing) / (fontSize * LINE_HEIGHT_EM + lineSpacing)))
    const lines = wrapText(text, maxWidthEm)
    if (lines.length <= maxLines) return { fontSize, lineSpacing, lines, truncated: false }
    if (fontSize === FONT_SIZES[FONT_SIZES.length - 1]) {
      const kept = lines.slice(0, maxLines)
      let last = kept[maxLines - 1] || ''
      while (last && measureEm(`${last}…`) > maxWidthEm) last = Array.from(last).slice(0, -1).join('')
      kept[maxLines - 1] = `${last.trimEnd()}…`
      return { fontSize, lineSpacing, lines: kept, truncated: true }
    }
  }
  throw new Error('unreachable')
}
