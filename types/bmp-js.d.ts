declare module "bmp-js" {
  export type BmpDecodeResult = {
    width: number;
    height: number;
    data: Buffer;
  };

  export function decode(buffer: Buffer): BmpDecodeResult;
}
