/**
 * A flashcard deck (web, iOS, Android): one card at a time — reveal the answer, then "Needs practice"
 * or "I knew it". Every answer is saved on the server right away (shown immediately, rolled back if
 * saving fails), so a refresh, sign-out or another device resumes at the same card. At the end:
 * the round's results, replay the difficult cards or all of them, make a new deck, or go back.
 * Web keyboard: Space/Enter reveals; → or K = knew it; ← or P = needs practice (arrows follow RTL).
 */
import { FLASHCARD_DECK_SIZES, type FlashcardDeck, type FlashcardDeckSize, type FlashcardResult } from '@study/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { I18nManager, Platform, Text, View } from 'react-native';
import { isRtlLanguage } from '@study/shared';
import { AnswerButton, FlipCard, StackedCardsArt, useReducedMotion } from '@/components/flashcards';
import { Chips } from '@/components/planner';
import { Body, Button, Card, colors, ErrorState, ErrorText, Loading, ProgressBar, Screen, SectionLabel, space, TextButton, Title, WorkingCard } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { handleLimitError } from '@/lib/billing';
import { applyReview, cardNumber, keyAction, nextCard, practiceCount } from '@/lib/flashcards';
import { usePreferences } from '@/lib/preferences';

export default function FlashcardDeckScreen() {
  const { t, i18n } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const key = ['flashcard-deck', id] as const;
  const deck = useQuery({ queryKey: key, queryFn: () => api.getFlashcardDeck(id) });
  const reducedMotion = useReducedMotion();
  const [revealed, setRevealed] = useState(false);
  const { aiLanguage } = usePreferences();
  const [size, setSize] = useState<FlashcardDeckSize>(10);

  const refreshLists = (d: FlashcardDeck) => {
    qc.setQueryData(key, d);
    void qc.invalidateQueries({ queryKey: ['flashcard-decks', d.documentId] });
  };

  const review = useMutation({
    mutationFn: (v: { cardId: string; result: FlashcardResult; round: number }) => api.reviewFlashcard(id, v),
    onMutate: (v) => {
      const before = qc.getQueryData<FlashcardDeck>(key);
      if (before) qc.setQueryData(key, applyReview(before, v.cardId, v.result));
      setRevealed(false);
      return { before };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.before) qc.setQueryData(key, ctx.before);
      if (err instanceof ApiError && err.code === 'flashcards_round_changed') void deck.refetch();
    },
    onSuccess: (d) => refreshLists(d),
  });
  const round = useMutation({
    mutationFn: (scope: 'all' | 'practice') => api.startFlashcardRound(id, scope),
    onSuccess: (d) => {
      setRevealed(false);
      refreshLists(d);
    },
  });
  const newDeck = useMutation({
    mutationFn: (documentId: string) => api.createFlashcardDeck(documentId, { cardCount: size, language: aiLanguage }),
    onError: (err) => handleLimitError(err),
    onSuccess: (d) => {
      qc.setQueryData(['flashcard-deck', d.id], d);
      void qc.invalidateQueries({ queryKey: ['flashcard-decks', d.documentId] });
      void qc.invalidateQueries({ queryKey: ['entitlement'] });
      router.replace({ pathname: '/flashcards/[id]', params: { id: d.id } });
    },
  });

  const d = deck.data;
  const card = d ? nextCard(d) : null;
  const answer = (result: FlashcardResult) => {
    if (!d || !card || review.isPending) return;
    review.mutate({ cardId: card.id, result, round: d.round });
  };

  // Web keyboard shortcuts (no effect on iOS/Android).
  const latest = useRef({ revealed, card, answer });
  latest.current = { revealed, card, answer };
  const rtl = I18nManager.isRTL || isRtlLanguage(i18n.language);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Space/Enter on a focused button already presses that button.
      if ((e.key === ' ' || e.key === 'Enter') && target?.getAttribute?.('role') === 'button') return;
      const action = keyAction({ key: e.key, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, targetTag: target?.tagName ?? null }, latest.current.revealed, rtl);
      if (!action || !latest.current.card) return;
      e.preventDefault();
      if (action === 'flip') setRevealed(true);
      else latest.current.answer(action);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [rtl]);

  const header = <Stack.Screen options={{ title: t('nav.flashcards') }} />;
  if (deck.isLoading) return <Loading />;
  if (!d) {
    return (
      <Screen>
        {header}
        <ErrorState error={deck.error} onRetry={() => deck.refetch()} />
      </Screen>
    );
  }

  if (newDeck.isPending) {
    return (
      <Screen>
        {header}
        <WorkingCard title={t('flashcards.making')} detail={t('flashcards.makingDetail')} />
      </Screen>
    );
  }

  // ---- Round finished
  if (!card) {
    const p = d.progress;
    const difficult = practiceCount(d);
    const pct = p.total ? p.known / p.total : 0;
    return (
      <Screen>
        {header}
        <Card style={{ alignItems: 'center', gap: space(3), paddingVertical: space(6) }}>
          <StackedCardsArt size={1.3} />
          <Title style={{ textAlign: 'center' }}>{t(difficult === 0 ? 'flashcards.doneAllTitle' : 'flashcards.doneTitle')}</Title>
          <Text style={{ color: colors.primary, fontSize: 40, fontWeight: '800' }} accessibilityLabel={t('flashcards.knewOf', { known: p.known, total: p.total })}>
            {p.known}/{p.total}
          </Text>
          <Body muted style={{ textAlign: 'center' }}>{t('flashcards.knewOf', { known: p.known, total: p.total })}</Body>
          <View style={{ alignSelf: 'stretch' }}>
            <ProgressBar value={pct} color={colors.success} />
          </View>
          <View style={{ flexDirection: 'row', gap: space(4), flexWrap: 'wrap', justifyContent: 'center' }}>
            <Stat label={t('flashcards.statReviewed')} value={p.reviewed} color={colors.text} />
            <Stat label={t('flashcards.statKnown')} value={p.known} color={colors.success} />
            <Stat label={t('flashcards.statPractice')} value={p.practice} color={colors.warning} />
          </View>
        </Card>
        <ErrorText error={round.error ?? newDeck.error} />
        {difficult > 0 && <Button title={t('flashcards.reviewDifficult', { count: difficult })} onPress={() => round.mutate('practice')} loading={round.isPending && round.variables === 'practice'} disabled={round.isPending} />}
        <Button variant={difficult > 0 ? 'secondary' : 'primary'} title={t('flashcards.reviewAll')} onPress={() => round.mutate('all')} loading={round.isPending && round.variables === 'all'} disabled={round.isPending} />
        <Card style={{ gap: space(3) }}>
          <SectionLabel>{t('flashcards.newDeckTitle')}</SectionLabel>
          <Chips options={FLASHCARD_DECK_SIZES.map((n) => ({ value: n, label: t('flashcards.cards', { count: n }) }))} value={size} onChange={setSize} />
          <Body muted style={{ fontSize: 13 }}>{t('flashcards.usesPractice')}</Body>
          <Button variant="secondary" title={t('flashcards.makeNewDeck')} onPress={() => newDeck.mutate(d.documentId)} />
        </Card>
        <TextButton title={t('flashcards.backToCourse')} tone="muted" onPress={() => (router.canGoBack() ? router.back() : router.replace({ pathname: '/documents/[id]', params: { id: d.documentId } }))} />
      </Screen>
    );
  }

  // ---- Reviewing
  const n = cardNumber(d, card);
  return (
    <Screen>
      {header}
      <View style={{ gap: space(2) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space(3) }}>
          <Text style={{ color: colors.muted, fontSize: 14, fontWeight: '700' }} accessibilityLiveRegion="polite">
            {t('flashcards.cardOf', { current: n, total: d.progress.total })}
          </Text>
          <View style={{ flexDirection: 'row', gap: space(3) }}>
            <Text style={{ color: colors.success, fontWeight: '700' }} accessibilityLabel={t('flashcards.statKnownA11y', { count: d.progress.known })}>
              ✓ {d.progress.known}
            </Text>
            <Text style={{ color: colors.warning, fontWeight: '700' }} accessibilityLabel={t('flashcards.statPracticeA11y', { count: d.progress.practice })}>
              ↻ {d.progress.practice}
            </Text>
          </View>
        </View>
        <ProgressBar value={d.progress.total ? d.progress.reviewed / d.progress.total : 0} color={colors.primary} />
      </View>

      <FlipCard card={card} revealed={revealed} onFlip={() => setRevealed((r) => !r)} reducedMotion={reducedMotion} />

      <ErrorText error={review.error} />
      {revealed ? (
        <View style={{ flexDirection: 'row', gap: space(3) }}>
          <AnswerButton tone="practice" title={t('flashcards.needPractice')} hint={Platform.OS === 'web' ? t('flashcards.keyPractice') : undefined} onPress={() => answer('practice')} disabled={review.isPending} />
          <AnswerButton tone="known" title={t('flashcards.knewIt')} hint={Platform.OS === 'web' ? t('flashcards.keyKnown') : undefined} onPress={() => answer('known')} disabled={review.isPending} />
        </View>
      ) : (
        <Button title={t('flashcards.showAnswer')} onPress={() => setRevealed(true)} />
      )}
      {Platform.OS === 'web' && !revealed && <Body muted style={{ fontSize: 13, textAlign: 'center' }}>{t('flashcards.keyFlip')}</Body>}
    </Screen>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={{ alignItems: 'center', minWidth: 72 }}>
      <Text style={{ color, fontSize: 22, fontWeight: '800' }}>{value}</Text>
      <Text style={{ color: colors.muted, fontSize: 13 }}>{label}</Text>
    </View>
  );
}
