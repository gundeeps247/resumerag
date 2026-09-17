/**
 * Reciprocal Rank Fusion (RRF).
 *
 * BM25 scores (e.g. 7.3) and cosine similarities (e.g. 0.82) live on completely
 * different scales, so adding them is meaningless. RRF ignores the raw scores and
 * uses only *positions*: every list gives each item 1 / (k + rank). Items ranked
 * well by both retrievers float to the top.
 *
 *   rrf(item) = Σ over lists  weight / (k + rank_in_list)
 *
 * k = 60 comes from the original paper (Cormack et al., 2009) and dampens the
 * advantage of being ranked #1 vs #2 in a single list.
 */
export function reciprocalRankFusion(rankings: string[][], k = 60, weights: number[] = rankings.map(() => 1)): Map<string, number> {
  const scores = new Map<string, number>();
  rankings.forEach((list, listIndex) => {
    const weight = weights[listIndex] ?? 1;
    list.forEach((id, position) => {
      const rank = position + 1;
      scores.set(id, (scores.get(id) ?? 0) + weight / (k + rank));
    });
  });
  return scores;
}
