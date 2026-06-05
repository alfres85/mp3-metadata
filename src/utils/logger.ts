import fs from 'node:fs';

function logToFile(level: string, message: string) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] ${message}\n`;
  try {
    fs.appendFileSync('error.log', line);
  } catch {
    // silently ignore file write failures
  }
}

export const log = {
  info: (m: string) => console.log(`\x1b[36m[INFO]\x1b[0m ${m}`),
  warn: (m: string) => {
    console.log(`\x1b[33m[WARN]\x1b[0m ${m}`);
    logToFile('WARN', m);
  },
  success: (m: string) => console.log(`\x1b[32m[SUCCESS]\x1b[0m ${m}`),
  error: (m: string) => {
    console.log(`\x1b[31m[ERROR]\x1b[0m ${m}`);
    logToFile('ERROR', m);
  },
};
