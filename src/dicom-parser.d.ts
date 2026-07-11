// Minimal typings for the subset of dicom-parser this app uses.
// The package ships no declarations of its own.
declare module "dicom-parser" {
  export interface Element {
    dataOffset: number;
    length: number;
  }
  export interface DataSet {
    elements: Record<string, Element | undefined> & { x7fe00010?: Element };
    byteArray: Uint8Array;
    uint16(tag: string, index?: number): number | undefined;
    int16(tag: string, index?: number): number | undefined;
    string(tag: string, index?: number): string | undefined;
    intString(tag: string, index?: number): number | undefined;
    floatString(tag: string, index?: number): number | undefined;
  }
  export function parseDicom(byteArray: Uint8Array, options?: unknown): DataSet;
  const dicomParser: {
    parseDicom: typeof parseDicom;
  };
  export default dicomParser;
}
