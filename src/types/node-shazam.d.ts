declare module 'node-shazam' {
  export class Shazam {
    constructor(timeZone?: string);

    recognise(
      path: string,
      language?: string,
      minimal?: boolean,
    ): Promise<unknown>;
  }
}
