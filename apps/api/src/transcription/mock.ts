/**
 * Deterministic offline transcription for development and tests: no key, no cost, no network.
 * It cannot hear audio — it returns a fixed lecture script spread over the recording's length.
 *
 * Test hooks: put one of these ASCII markers in the first 64 KB of a file to simulate a case:
 *   EXAMA-MOCK:FAIL       provider outage (retryable)
 *   EXAMA-MOCK:NO_SPEECH  recording without usable speech
 *   EXAMA-MOCK:HANG       never finishes (exercises the processing timeout)
 *   EXAMA-MOCK:LANG=fr    French lecture script
 */
import { TranscriptionError } from './errors.js';
import type { Transcript, TranscribeInput, TranscriptionProvider } from './types.js';

const SCRIPTS: Record<string, string[]> = {
  en: [
    'Good morning everyone, today we continue with cellular respiration and look at what happens without oxygen.',
    'When oxygen is not available, cells rely on fermentation to regenerate NAD plus so that glycolysis can continue.',
    'In lactic acid fermentation, pyruvate is reduced to lactate, which is what happens in muscle cells during intense exercise.',
    'In alcoholic fermentation, yeast converts pyruvate into ethanol and carbon dioxide.',
    'Fermentation produces only two ATP per glucose, far less than aerobic respiration.',
    'Now let us talk about enzymes, the proteins that speed up chemical reactions in the cell.',
    'Enzymes lower the activation energy of a reaction without being consumed by it.',
    'Each enzyme has an active site where the substrate binds, forming an enzyme-substrate complex.',
    'Temperature and pH change the shape of the active site, so every enzyme has an optimum temperature and an optimum pH.',
    'Competitive inhibitors bind to the active site and compete with the substrate, while non-competitive inhibitors bind elsewhere and change the enzyme shape.',
    'Remember for the exam: fermentation regenerates NAD plus, and enzymes lower activation energy.',
    'Next week we will connect enzymes to the Krebs cycle and the electron transport chain.',
  ],
  fr: [
    'Bonjour à tous, aujourd’hui nous continuons avec la respiration cellulaire et ce qui se passe sans oxygène.',
    'Quand l’oxygène manque, les cellules utilisent la fermentation pour régénérer le NAD plus afin que la glycolyse continue.',
    'Dans la fermentation lactique, le pyruvate est réduit en lactate, comme dans les muscles pendant un effort intense.',
    'Dans la fermentation alcoolique, la levure transforme le pyruvate en éthanol et en dioxyde de carbone.',
    'Les enzymes sont des protéines qui accélèrent les réactions chimiques de la cellule.',
    'Les enzymes abaissent l’énergie d’activation d’une réaction sans être consommées.',
    'Chaque enzyme possède un site actif où se fixe le substrat.',
    'La température et le pH modifient la forme du site actif des enzymes.',
  ],
};

const MARKER = 'EXAMA-MOCK:';

export class MockTranscriptionProvider implements TranscriptionProvider {
  readonly name = 'mock';

  async transcribe({ media, expectedSeconds, maxSeconds, signal }: TranscribeInput): Promise<Transcript> {
    const head = new TextDecoder('latin1').decode(await media.peek());
    const directive = (name: string) => head.includes(MARKER + name);
    if (directive('FAIL')) throw new TranscriptionError('unavailable', 'mock outage');
    if (directive('NO_SPEECH')) throw new TranscriptionError('no_speech', 'mock silence');
    if (directive('HANG')) {
      await new Promise((_, reject) => {
        if (signal.aborted) reject(new TranscriptionError('timeout', 'aborted'));
        signal.addEventListener('abort', () => reject(new TranscriptionError('timeout', 'aborted')), { once: true });
      });
    }
    const language = head.match(/EXAMA-MOCK:LANG=([a-z]{2})/)?.[1] ?? 'en';
    const script = SCRIPTS[language] ?? SCRIPTS.en;

    const seconds = Math.max(1, Math.min(expectedSeconds, maxSeconds));
    // One sentence every ~20 s (at least the whole script), spread evenly over the recording.
    const count = Math.max(script.length, Math.min(400, Math.floor(seconds / 20)));
    const step = (seconds * 1000) / count;
    const segments = Array.from({ length: count }, (_, i) => ({
      startMs: Math.round(i * step),
      endMs: Math.round((i + 1) * step),
      text: script[i % script.length],
    }));
    return { language, durationSeconds: seconds, segments };
  }
}
