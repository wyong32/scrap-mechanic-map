declare module "lz4js" {
  export function decompressBlock(
    source: Uint8Array,
    destination: Uint8Array,
    sourceOffset: number,
    sourceLength: number,
    destinationOffset: number
  ): number;
  export function decompress(input: Uint8Array, output?: Uint8Array): Uint8Array;
  const lz4: {
    decompressBlock: typeof decompressBlock;
    decompress: typeof decompress;
  };
  export default lz4;
}

declare module "sql.js" {
  export interface SqlJsStatic {
    Database: new (data?: Uint8Array) => unknown;
  }

  export default function initSqlJs(config?: {
    locateFile?: (file: string) => string;
  }): Promise<SqlJsStatic>;
}
