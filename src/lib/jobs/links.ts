export function getJobDetailHref(jobId: string) {
  return `/jobs/${encodeURIComponent(jobId)}`;
}
