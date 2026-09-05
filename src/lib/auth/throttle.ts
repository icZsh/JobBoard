// Bounded process-wide limiter also covers unknown emails before expensive scrypt.
const attempts: number[] = [];
let active = 0;
export function acquireLoginAttempt(now = Date.now()): (() => void) | null {
  while (attempts.length && attempts[0] <= now - 60000) attempts.shift();
  if (attempts.length >= 20 || active >= 2) return null;
  attempts.push(now);
  active++;
  let released = false;
  return () => {
    if (!released) {
      active--;
      released = true;
    }
  };
}
