declare module 'ffprobe-static' {
  interface FFProbe {
    path: string;
  }
  const ffprobe: FFProbe;
  export default ffprobe;
}
