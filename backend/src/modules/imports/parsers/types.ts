export interface ParserOptions {
  sheetName?: string;
}

export interface TabularParserAdapter {
  name: string;
  parse(buffer: Buffer, options?: ParserOptions): Record<string, string>[];
}

