export function resumeDownloadUrl(id: string) {
  if (!/^[a-z0-9_-]{1,80}$/i.test(id)) throw new Error("Invalid resume ID.");
  return `/api/resumes/${id}/download`;
}

export function isResumeDownloadUrl(value: string) {
  return /^\/api\/resumes\/[a-z0-9_-]{1,80}\/download$/i.test(value);
}
