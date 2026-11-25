import { createHash, timingSafeEqual } from 'crypto';

// fork: constant-time API key comparison; hashing first gives equal-length buffers, so the length does not leak either.
const digest = (value: string) => createHash('sha256').update(value).digest();

export const sameKey = (given: unknown, expected: unknown) =>
  typeof given === 'string' &&
  typeof expected === 'string' &&
  !!expected &&
  timingSafeEqual(digest(given), digest(expected));
