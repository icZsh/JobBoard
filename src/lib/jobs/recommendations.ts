type RecommendationWithRun = {
  importRun: {
    runDate: Date;
    createdAt: Date;
  };
};

export function sortRecommendationsByLatest<T extends RecommendationWithRun>(
  recommendations: T[],
) {
  return [...recommendations].sort((left, right) => {
    const runDateDelta =
      right.importRun.runDate.getTime() - left.importRun.runDate.getTime();

    if (runDateDelta !== 0) {
      return runDateDelta;
    }

    return (
      right.importRun.createdAt.getTime() - left.importRun.createdAt.getTime()
    );
  });
}

export function getLatestRecommendation<T extends RecommendationWithRun>(
  recommendations: T[],
) {
  return sortRecommendationsByLatest(recommendations)[0] ?? null;
}
