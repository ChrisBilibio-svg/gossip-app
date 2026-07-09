export function netScore(likeCount: number, dislikeCount: number): number {
  return Math.max(likeCount - dislikeCount, 0);
}

export function formatReactionCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(count >= 10_000_000 ? 0 : 1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(count >= 10_000 ? 0 : 1)}k`;
  return String(count);
}

export function ratingLabel(rating: number): string {
  const clamped = Math.max(1, Math.min(5, rating));
  return '★'.repeat(clamped) + '☆'.repeat(5 - clamped);
}

export function socialScore(likeCount: number, dislikeCount: number): number {
  return likeCount - dislikeCount;
}
