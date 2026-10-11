'use client';
import {useEffect} from 'react';
import {subscribeDocumentDoraSheen} from './dora-sheen-clock';

export function useDoraSheenClock(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    return subscribeDocumentDoraSheen(document, window);
  }, [enabled]);
}
