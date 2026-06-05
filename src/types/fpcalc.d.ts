declare module 'fpcalc' {
  interface FpcalcOptions {
    command?: string;
    length?: number;
    raw?: boolean;
  }

  interface FpcalcResult {
    file: string;
    duration: string;
    fingerprint: string;
  }

  function fpcalc(
    file: string,
    options: FpcalcOptions,
    callback: (err: Error | null, result: FpcalcResult) => void,
  ): void;
  function fpcalc(
    file: string,
    callback: (err: Error | null, result: FpcalcResult) => void,
  ): void;

  export = fpcalc;
}
