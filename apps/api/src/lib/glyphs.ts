/**
 * Characters a document's own fonts draw but no display font has. PDFs (and PowerPoint text) made with
 * Symbol or Wingdings bullets store them in Unicode's Private Use Area (U+E000–U+F8FF, e.g. U+F0B7 ""),
 * so the text shows "□" wherever it is displayed. They are replaced one-for-one by "•": every one of these
 * is a single UTF-16 unit, so lengths and stored quote offsets stay exactly the same.
 */
const PRIVATE_USE = /[-]/g;

export const normalizeGlyphs = (text: string): string => text.replace(PRIVATE_USE, '•');
