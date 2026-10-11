export const rankingRowAt = (index: number) => 1800 + 800 * index;
export const rankingReadyAt = (count: number) => rankingRowAt(count);
export const rankingBoundaries = (count: number) => Array.from({length: count + 1}, (_, index) => rankingRowAt(index));
