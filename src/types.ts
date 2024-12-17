// XML Types
export interface XMLNode {
    nodeType: number;
    nodeName: string;
    textContent: string | null;
    getAttribute: (name: string) => string | null;
    setAttribute: (name: string, value: string) => void;
    getElementsByTagName: (name: string) => XMLElement[];
    parentNode: XMLElement | null;
    removeChild: (child: XMLElement) => void;
    appendChild: (child: XMLElement) => XMLElement;
    insertBefore: (newNode: XMLElement, referenceNode: XMLElement) => XMLElement;
    childNodes: NodeListOf<XMLElement>;
  }
  
  export interface XMLElement extends XMLNode {
    [x: string]: any;
    firstChild: XMLElement;
    ownerDocument: XMLDocument;
    children: HTMLCollection;
    attributes: NamedNodeMap;
  }
  
  export interface XMLDocument extends XMLNode {
    documentElement: XMLElement;
    createElement: (tagName: string) => XMLElement;
    createElementNS: (namespace: string | null, qualifiedName: string) => XMLElement;
    createTextNode: (data: string) => XMLNode;
  }
  
  export interface NamedNodeMap {
    length: number;
    item: (index: number) => Attr | null;
    [index: number]: Attr;
  }
  
  export interface Attr {
    name: string;
    value: string;
  }
  
  export interface HTMLCollection {
    length: number;
    item: (index: number) => XMLElement | null;
    [index: number]: XMLElement;
  }
  
  export interface NodeListOf<T> {
    length: number;
    item: (index: number) => T | null;
    [index: number]: T;
  }
  
  // Content Types
  export type ContentType = 'frontmatter' | 'bodymatter' | 'backmatter';

  export interface ContentElement {
    id: string;
    label: string;
    href: string;
    index: number;
    type?: ContentType;
    role?: string;
    children?: ContentElement[];
  }
  
  export interface LandmarkInfo {
    type?: ContentType;
    role?: string;
  }
  
  export interface ContentOptions {
    id?: string;          
    title?: string; 
    type?: 'html' | 'md';
    css?: string;
  }
  
  // Metadata Types
  export interface CoreMetadata {
    title: string;
    subtitle?: string;
    authors: string[];
    language: string;
    identifier: string;
    publisher: string | null;
    date: string | null;
  }
  
  export interface MetadataProperty {
    value: string;
    id?: string;
    refinements?: {
      [key: string]: string;
    };
  }
  
  export interface FullMetadata {
    [key: string]: MetadataProperty | MetadataProperty[];
  }
  
  // Cover Image Type
  export interface CoverImage {
    data: Buffer;
    mediaType: string;
    href: string;
  }
  
  // File Data Type
export type FileData = ArrayBuffer | Uint8Array | Blob;
type PDFFontData = string | Buffer | ArrayBuffer | Uint8Array;
  

// Define the paperback format type
export type PaperbackFormat = 
  | 'MASS_MARKET'     // 4.25" x 7"
  | 'TRADE_5x8'       // 5" x 8"
  | 'TRADE_5_5x8_5'   // 5.5" x 8.5"
  | 'TRADE_6x9'       // 6" x 9"
  | 'ROYAL'           // 7" x 10"
  | 'US_LETTER'       // 8.5" x 11"
  | 'CROWN_QUARTO'    // 7" x 9.25"
  | 'DEMY';           // 6.18" x 9.67"

// Standard page sizes type
export type StandardPageSize = 'A4' | 'A5' | 'LETTER';

// Combined type for all possible page size options
export type PageSize = StandardPageSize | PaperbackFormat | number[];

/**
 * Configuration options for PDF generation
 */
export interface PDFOptions {
  pageSize?: PageSize;
  margins?: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
  font?: {
    body: {
      regular: string;
      bold: string;
      italic: string;
      boldItalic?: string; // Optional support for bold+italic combination
    };
    h1?: string;
    h2?: string;
    h3?: string;
  };
  fontSize?: {
    body: number;
    h1?: number;
    h2?: number;
    h3?: number;
  };
  pagination?: PaginationConfig;
}

// Add new interface for pagination options
export type alignment = 'left' | 'center' | 'right';

export interface PaginationOptions {
  header?: {
    showAuthor?: boolean;
    showBookTitle?: boolean;
    showChapterTitle?: boolean;
    align?: alignment;
  };
  footer?: {
    showAuthor?: boolean;
    showBookTitle?: boolean;
    showChapterTitle?: boolean;
    showPageNumbers?: boolean;
    align?: alignment;
  };
}

export interface PaginationTextConfig {
  content: string;
  font: string;
  fontSize: number;
  color: string;
  alignment: 'left' | 'center' | 'right';
  margin: number;
}

export interface PaginationSection {
  left?: PaginationTextConfig;
  center?: PaginationTextConfig;
  right?: PaginationTextConfig;
}

export interface PaginationVariables {
  title?: string;
  author?: string;
  chapter?: string;
  pageNumber?: number;
  totalPages?: number;
  date?: string;
  [key: string]: string | number | undefined;
}

export interface PaginationConfig {
  header?: PaginationSection;
  footer?: PaginationSection;
  variables?: PaginationVariables;
  startPage?: number;
}

/**
 * Types for font targeting
 */
export type BodyFontStyle = 'regular' | 'bold' | 'italic' | 'boldItalic';
export type HeadingLevel = 'h1' | 'h2' | 'h3';
export type FontTarget = `body-${BodyFontStyle}` | HeadingLevel;

/**
 * Interface for custom font registration
 */
export interface CustomFontData {
  data: FileData;
  postscriptName: string;     // The PostScript name to register the font under
  targets: FontTarget[];      // Array of places to use this font
}
