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
  
/**
 * Configuration options for PDF generation
 */
export interface PDFOptions {
  pageSize?: 'A4' | 'A5' | 'LETTER';
  margins?: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
  font?: {
    regular: string;
    bold: string;
    italic: string;
  };
  fontSize?: {
    normal: number;
    heading1: number;
    heading2: number;
    heading3: number;
  };
  pagination?: PaginationOptions;
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

interface PaginationTextConfig {
  content: string;
  font: string;
  fontSize: number;
  color: string;
  alignment: 'left' | 'center' | 'right';
  margin: number;
}

interface PaginationSection {
  left: PaginationTextConfig;
  center: PaginationTextConfig;
  right: PaginationTextConfig;
}

interface PaginationVariables {
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