declare module 'heic-convert' {
  interface Options {
    buffer: ArrayBufferLike | Uint8Array;
    format: 'JPEG' | 'PNG';
    quality?: number;
  }
  function convert(opts: Options): Promise<ArrayBuffer>;
  export default convert;
}
declare module 'fontkit';
