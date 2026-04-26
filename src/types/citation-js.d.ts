declare module "citation-js" {
  interface CiteFormatOptions {
    format?: string;
    template?: string;
    lang?: string;
  }

  class Cite {
    constructor(data?: unknown);
    format(type?: string, options?: CiteFormatOptions): string;
  }

  export default Cite;
}
