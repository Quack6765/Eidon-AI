declare module "heic-decode" {
  export type HeicDecodeResult = {
    width: number;
    height: number;
    data: Uint8ClampedArray;
  };

  export default function heicDecode(input: { buffer: Buffer }): Promise<HeicDecodeResult>;
}
