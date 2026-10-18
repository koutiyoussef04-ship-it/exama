import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { AppState } from 'react-native';
import { examTimers } from './exam-timer';

/**
 * Runs the exam's clock (lib/exam-timer.ts) while this screen is focused, the app is in the foreground
 * and `running` is true; pauses it otherwise. Returns the elapsed milliseconds. The one-second interval
 * only re-renders the screen — the time itself comes from timestamps, so it is never reset or skewed by
 * re-renders, a slow interval or navigation.
 */
export function useExamClock(examId: string, running: boolean): number {
  const [, setTick] = useState(0);
  useFocusEffect(
    useCallback(() => {
      if (!running) return;
      if (AppState.currentState !== 'background' && AppState.currentState !== 'inactive') examTimers.start(examId);
      const appState = AppState.addEventListener('change', (state) => (state === 'active' ? examTimers.start(examId) : examTimers.pause(examId)));
      const tick = setInterval(() => setTick((n) => (n + 1) % 1_000_000), 1000);
      return () => {
        appState.remove();
        clearInterval(tick);
        examTimers.pause(examId);
      };
    }, [examId, running]),
  );
  return examTimers.elapsedMs(examId);
}
