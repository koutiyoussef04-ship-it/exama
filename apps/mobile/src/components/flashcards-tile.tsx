import type { FlashcardDeckSummary } from '@study/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StackedCardsArt, StudyTile } from '@/components/flashcards';
import { colors } from '@/components/ui';
import { api } from '@/lib/api';
import { handleLimitError } from '@/lib/billing';
import { deckTileStatus } from '@/lib/flashcards';
import { usePreferences } from '@/lib/preferences';

export const flashcardDecksKey = (documentId: string) => ['flashcard-decks', documentId] as const;

/**
 * Course screen: the Flashcards tile next to "Start an exam". Opens the latest deck where the student
 * left off, or makes the first one (10 cards, in the study language). Errors are shown by the caller
 * through `onError` (the paywall opens by itself for plan limits).
 */
export function FlashcardsTile({ documentId, onError }: { documentId: string; onError: (err: unknown) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { aiLanguage } = usePreferences();
  const decks = useQuery<FlashcardDeckSummary[]>({ queryKey: flashcardDecksKey(documentId), queryFn: () => api.listFlashcardDecks(documentId) });
  const create = useMutation({
    mutationFn: () => api.createFlashcardDeck(documentId, { language: aiLanguage }),
    onMutate: () => onError(null),
    onError: (err) => {
      if (!handleLimitError(err)) onError(err);
    },
    onSuccess: (deck) => {
      qc.setQueryData(['flashcard-deck', deck.id], deck);
      void qc.invalidateQueries({ queryKey: flashcardDecksKey(documentId) });
      void qc.invalidateQueries({ queryKey: ['entitlement'] });
      router.push({ pathname: '/flashcards/[id]', params: { id: deck.id } });
    },
  });
  const latest = decks.data?.[0];
  const status = deckTileStatus(latest);
  const statusText =
    status.kind === 'resume'
      ? t('flashcards.tileResume', { reviewed: status.reviewed, total: status.total })
      : status.kind === 'done'
        ? status.practice > 0
          ? t('flashcards.tileDonePractice', { count: status.practice })
          : t('flashcards.tileDone')
        : null;

  return (
    <StudyTile
      art={<StackedCardsArt />}
      title={create.isPending ? t('flashcards.making') : t('flashcards.tileTitle')}
      subtitle={t('flashcards.tileSubtitle')}
      status={statusText}
      accent={colors.violet}
      accentSoft="#F3EEFF"
      loading={create.isPending || decks.isLoading}
      onPress={() => (latest ? router.push({ pathname: '/flashcards/[id]', params: { id: latest.id } }) : create.mutate())}
    />
  );
}
