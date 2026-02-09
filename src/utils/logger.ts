export const log = {
  info: (m: string) => console.log(`\x1b[36m[INFO]\x1b[0m ${m}`),
  warn: (m: string) => console.log(`\x1b[33m[WARN]\x1b[0m ${m}`),
  success: (m: string) => console.log(`\x1b[32m[SUCCESS]\x1b[0m ${m}`),
  error: (m: string) => console.log(`\x1b[31m[ERROR]\x1b[0m ${m}`),
};
