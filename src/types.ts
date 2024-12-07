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