/**
 * Question editor shared by the item screen (editing) and the bank (adding a question by hand), plus
 * the list row used by the review queue, the bank and the course screen.
 */
import { DIFFICULTIES, marketProfile, type BankItem, type BankItemType, type Difficulty, type LegalRef, type OrganizationMarket } from '@study/shared';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { Chips } from '@/components/planner';
import { Badge, Body, colors, Field, SectionLabel, space, TextButton } from '@/components/ui';
import { flagLabel, STATUS_TONE, statusLabel, VERDICT_TONE, verdictLabel } from '@/lib/org';

export type ItemDraft = {
  stem: string;
  options: string[];
  /** MCQ: which option is the keyed answer. */
  correctIndex: number;
  /** Short answer: the expected answer. */
  correctAnswer: string;
  explanation: string;
  topic: string;
  section: string;
  difficulty: Difficulty | null;
  legal: LegalRef;
};

const EMPTY_LEGAL: LegalRef = { law: '', publication: '', article: '', effectiveDate: '' };
const MAX_OPTIONS = 8;
const MIN_OPTIONS = 2;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function emptyDraft(type: BankItemType, optionCount: number): ItemDraft {
  return {
    stem: '',
    options: type === 'mcq' ? Array.from({ length: optionCount }, () => '') : [],
    correctIndex: 0,
    correctAnswer: '',
    explanation: '',
    topic: '',
    section: '',
    difficulty: null,
    legal: { ...EMPTY_LEGAL },
  };
}

export function draftFromItem(item: BankItem): ItemDraft {
  const options = item.options ?? [];
  const idx = options.indexOf(item.correctAnswer);
  return {
    stem: item.stem,
    options,
    correctIndex: idx >= 0 ? idx : 0,
    correctAnswer: item.correctAnswer,
    explanation: item.explanation,
    topic: item.topic,
    section: item.section ?? '',
    difficulty: item.difficulty,
    legal: { ...EMPTY_LEGAL, ...(item.legalRef ?? {}) },
  };
}

export type DraftProblem = 'org.item.required' | 'org.item.minOptions' | 'org.item.correctNotOption' | 'org.item.badDate';

/** Returns the i18n key of the first problem, or null when the draft can be sent. */
export function validateDraft(d: ItemDraft, type: BankItemType, legalMetadata: boolean): DraftProblem | null {
  if (!d.stem.trim() || !d.topic.trim()) return 'org.item.required';
  if (type === 'mcq') {
    const options = d.options.map((o) => o.trim()).filter(Boolean);
    if (options.length < MIN_OPTIONS) return 'org.item.minOptions';
    if (!d.options[d.correctIndex]?.trim()) return 'org.item.correctNotOption';
  } else if (!d.correctAnswer.trim()) return 'org.item.required';
  if (legalMetadata && d.legal.effectiveDate && !DATE.test(d.legal.effectiveDate)) return 'org.item.badDate';
  return null;
}

/** Content fields of a question as the API takes them (create: plus documentId and type). */
export type ItemInput = {
  stem: string;
  options: string[] | null;
  correctAnswer: string;
  explanation: string;
  topic: string;
  section: string | null;
  difficulty: Difficulty | null;
  legalRef: LegalRef | null;
};

/** The PATCH/POST body (without documentId/type) — the correct MCQ answer is always one of the options. */
export function draftToInput(d: ItemDraft, type: BankItemType, legalMetadata: boolean): ItemInput {
  const options = type === 'mcq' ? d.options.map((o) => o.trim()).filter(Boolean) : null;
  const correctAnswer = type === 'mcq' ? (d.options[d.correctIndex] ?? '').trim() : d.correctAnswer.trim();
  const legal = legalMetadata && d.legal.law.trim() ? { ...d.legal, law: d.legal.law.trim() } : null;
  return {
    stem: d.stem.trim(),
    options,
    correctAnswer,
    explanation: d.explanation.trim(),
    topic: d.topic.trim(),
    section: d.section.trim() || null,
    difficulty: d.difficulty,
    legalRef: legal,
  };
}

type FieldsProps = {
  draft: ItemDraft;
  type: BankItemType;
  market: OrganizationMarket;
  disabled?: boolean;
  onChange: (next: ItemDraft) => void;
};

export function ItemFields({ draft, type, market, disabled, onChange }: FieldsProps) {
  const { t } = useTranslation();
  const profile = marketProfile(market);
  const set = <K extends keyof ItemDraft>(key: K, value: ItemDraft[K]) => onChange({ ...draft, [key]: value });
  const setOption = (i: number, value: string) => set('options', draft.options.map((o, j) => (j === i ? value : o)));
  const removeOption = (i: number) =>
    onChange({
      ...draft,
      options: draft.options.filter((_, j) => j !== i),
      correctIndex: draft.correctIndex === i ? 0 : draft.correctIndex > i ? draft.correctIndex - 1 : draft.correctIndex,
    });

  return (
    <View style={{ gap: space(4) }}>
      <Field label={t('org.item.stem')} value={draft.stem} onChangeText={(v) => set('stem', v)} multiline numberOfLines={4} editable={!disabled} />

      {type === 'mcq' ? (
        <View style={{ gap: space(3) }}>
          <SectionLabel>{t('org.item.options')}</SectionLabel>
          <Body muted style={{ fontSize: 13 }}>{t('org.item.optionsHint')}</Body>
          {draft.options.map((o, i) => {
            const correct = i === draft.correctIndex;
            return (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space(2) }}>
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: correct, disabled: !!disabled }}
                  aria-checked={correct}
                  accessibilityLabel={t('org.item.markCorrect', { n: i + 1 })}
                  disabled={disabled}
                  onPress={() => set('correctIndex', i)}
                  hitSlop={8}
                  style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: correct ? colors.success : colors.border, backgroundColor: correct ? colors.success : colors.card, alignItems: 'center', justifyContent: 'center', marginBottom: 11 }}
                >
                  {correct && <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>✓</Text>}
                </Pressable>
                <View style={{ flex: 1 }}>
                  <Field label={correct ? `${t('org.item.option', { n: i + 1 })} · ${t('org.item.correct')}` : t('org.item.option', { n: i + 1 })} value={o} onChangeText={(v) => setOption(i, v)} editable={!disabled} />
                </View>
                {!disabled && draft.options.length > MIN_OPTIONS && (
                  <Pressable accessibilityRole="button" accessibilityLabel={t('org.item.removeOption', { n: i + 1 })} onPress={() => removeOption(i)} hitSlop={8} style={{ paddingBottom: 14 }}>
                    <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 18 }}>×</Text>
                  </Pressable>
                )}
              </View>
            );
          })}
          {!disabled && draft.options.length < MAX_OPTIONS && <TextButton title={t('org.item.addOption')} onPress={() => set('options', [...draft.options, ''])} />}
        </View>
      ) : (
        <Field label={t('org.item.correctAnswer')} value={draft.correctAnswer} onChangeText={(v) => set('correctAnswer', v)} multiline editable={!disabled} />
      )}

      <Field label={t('org.item.explanation')} value={draft.explanation} onChangeText={(v) => set('explanation', v)} multiline numberOfLines={3} editable={!disabled} />
      <Field label={t('org.item.topic')} value={draft.topic} onChangeText={(v) => set('topic', v)} editable={!disabled} />
      <Field label={t(`org.item.unit.${profile.unitLabel}`)} value={draft.section} onChangeText={(v) => set('section', v)} editable={!disabled} placeholder={t('org.item.unitPlaceholder')} />

      <View style={{ gap: space(2) }}>
        <SectionLabel>{t('org.item.difficulty')}</SectionLabel>
        <Chips<'none' | Difficulty>
          options={[{ value: 'none', label: t('org.difficulty.none') }, ...DIFFICULTIES.map((d) => ({ value: d, label: t(`org.difficulty.${d}`) }))]}
          value={draft.difficulty ?? 'none'}
          onChange={(v) => !disabled && set('difficulty', v === 'none' ? null : v)}
        />
      </View>

      {profile.legalMetadata && (
        <View style={{ gap: space(3), borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space(3) }}>
          <SectionLabel>{t('org.item.legal')}</SectionLabel>
          <Body muted style={{ fontSize: 13 }}>{t('org.item.legalNote')}</Body>
          <Field label={t('org.item.law')} value={draft.legal.law} onChangeText={(v) => set('legal', { ...draft.legal, law: v })} editable={!disabled} placeholder={t('org.item.lawPlaceholder')} />
          <Field label={t('org.item.publication')} value={draft.legal.publication} onChangeText={(v) => set('legal', { ...draft.legal, publication: v })} editable={!disabled} placeholder={t('org.item.publicationPlaceholder')} />
          <Field label={t('org.item.article')} value={draft.legal.article} onChangeText={(v) => set('legal', { ...draft.legal, article: v })} editable={!disabled} placeholder={t('org.item.articlePlaceholder')} />
          <Field label={t('org.item.effectiveDate')} value={draft.legal.effectiveDate} onChangeText={(v) => set('legal', { ...draft.legal, effectiveDate: v })} editable={!disabled} placeholder={t('org.item.effectiveDatePlaceholder')} autoCapitalize="none" />
        </View>
      )}
    </View>
  );
}

/** One question in a list: stem, topic and course, status and review flags. Tapping opens the item. */
export function ItemRow({ item, onPress, last, showCourse = true, showStatus = true }: { item: BankItem; onPress: () => void; last?: boolean; showCourse?: boolean; showStatus?: boolean }) {
  const { t } = useTranslation();
  const hasSources = item.sources.length > 0;
  const unlocated = hasSources && item.sources.some((s) => !s.located);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.stem}
      onPress={onPress}
      style={({ pressed }) => ({ gap: space(1.5), paddingVertical: space(3), borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border, opacity: pressed ? 0.6 : 1 })}
    >
      <Text style={{ color: colors.text, fontSize: 15, lineHeight: 21 }} numberOfLines={3}>
        {item.stem}
      </Text>
      <Text style={{ color: colors.muted, fontSize: 13 }} numberOfLines={1}>
        {[item.topic, showCourse ? item.documentTitle : null, t(`org.type.${item.type}`)].filter(Boolean).join(' · ')}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(1.5) }}>
        {showStatus && <Badge label={statusLabel(item.status)} tone={STATUS_TONE[item.status]} />}
        {item.reviewFlags.map((f) => (
          <Badge key={f} label={flagLabel(f)} tone="warning" />
        ))}
        {item.verification && <Badge label={verdictLabel(item.verification.verdict)} tone={VERDICT_TONE[item.verification.verdict]} />}
        {hasSources && <Badge label={unlocated ? t('org.source.notConfirmed') : t('org.source.located')} tone={unlocated ? 'danger' : 'neutral'} />}
      </View>
    </Pressable>
  );
}
