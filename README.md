# RePub Module Documentation

## Overview

The RePub module is a TypeScript library for manipulating EPUB files. It provides functionality to read, modify, and create EPUB documents while maintaining compliance with the EPUB standard. The module handles both EPUB 3.0 (using Navigation Documents) and EPUB 2.0 (using NCX) formats.

## Installation

```bash
npm install repub
```

## Core Features

- Load EPUB files from various sources (file system, URL, buffer)
- Read and modify EPUB content structure
- Add, remove, and modify content elements
- Handle EPUB metadata
- Extract cover images
- Save modified EPUBs

## Class: RePub

### Constructor

```typescript
constructor()
```

Creates a new RePub instance with a configured Markdown parser that outputs XHTML-compatible content.

### Loading Methods

#### `async load(data: FileData): Promise<void>`
Loads EPUB data from a buffer or blob.
- `data`: Can be Buffer, ArrayBuffer, Uint8Array, or Blob

#### `async open(location: string): Promise<void>`
Opens an EPUB file from a filesystem path or URL.
- `location`: File path or URL to EPUB file
- Throws error if file path loading is attempted in browser environment

### Content Management

#### `listContents(): ContentElement[]`
Returns an array of content elements representing the EPUB's structure.

#### `async removeContentElement(identifier: string | number): Promise<void>`
Removes a single content element.
- `identifier`: Either the element's ID or index

#### `async removeContents(identifiers: (string | number)[]): Promise<void>`
Removes multiple content elements.
- `identifiers`: Array of element IDs or indices

#### `async removeContentRange(range: string): Promise<void>`
Removes a range of content elements.
- `range`: String in format "n..." or "n..m"
  - "n...": Removes elements from index n onwards
  - "n..m": Removes elements from index n to m inclusive

#### `async removeExcept(keep: (string | number)[]): Promise<void>`
Removes all content elements except specified ones.
- `keep`: Array of indices or IDs to preserve

#### `async removeExceptWhere(filterFn: (element: ContentElement) => boolean): Promise<void>`
Removes all content elements that don't match the filter function.
- `filterFn`: Function that returns true for elements to keep

### Content Addition

#### `async insertContent(content: string, at: number, options: ContentOptions = {}): Promise<void>`
Inserts new content at specified position.
- `content`: HTML or Markdown content
- `at`: Index where content should be inserted
- `options`: Configuration options for the new content

#### `async appendContent(content: string, options: ContentOptions = {}): Promise<void>`
Adds new content at the end of the EPUB.

#### `async prependContent(content: string, options: ContentOptions = {}): Promise<void>`
Adds new content at the beginning of the EPUB.

### Metadata Management

#### `getMetadata(): FullMetadata`
Returns complete metadata from the EPUB.

#### `getCoreMetadata(): CoreMetadata`
Returns essential metadata including:
- title
- subtitle (if present)
- authors
- language
- identifier
- publisher
- date

#### `async getCover(): Promise<CoverImage | null>`
Extracts cover image data if present.

### Output Methods

#### `async getOutput(type: 'blob' | 'arraybuffer' | 'uint8array' | 'base64' = 'blob'): Promise<any>`
Gets EPUB data in specified format.

#### `async saveAs(location: string): Promise<void>`
Saves EPUB to filesystem (Node.js environment only).

## Types

### ContentElement
```typescript
interface ContentElement {
  id: string;
  label: string;
  href: string;
  index: number;
  children?: ContentElement[];
}
```

### ContentOptions
```typescript
interface ContentOptions {
  id?: string;
  title?: string;
  type?: 'html' | 'md';
  css?: string;
}
```

### CoreMetadata
```typescript
interface CoreMetadata {
  title: string;
  subtitle?: string;
  authors: string[];
  language: string;
  identifier: string;
  publisher: string | null;
  date: string | null;
}
```

### CoverImage
```typescript
interface CoverImage {
  data: Buffer;
  mediaType: string;
  href: string;
}
```

## Examples

### Basic Usage

```typescript
import RePub from 'repub';

// Create instance
const epub = new RePub();

// Load EPUB
await epub.open('path/to/book.epub');

// List contents
const contents = epub.listContents();

// Remove chapters 2-4
await epub.removeContentRange('2..4');

// Add new chapter
await epub.appendContent('# New Chapter\n\nSome content...', {
  title: 'New Chapter',
  type: 'md'
});

// Save changes
await epub.saveAs('modified-book.epub');
```

### Working with Metadata

```typescript
import RePub from 'repub';

const epub = new RePub();
await epub.open('book.epub');

// Get core metadata
const metadata = epub.getCoreMetadata();
console.log(`Title: ${metadata.title}`);
console.log(`Authors: ${metadata.authors.join(', ')}`);

// Extract cover
const cover = await epub.getCover();
if (cover) {
  // Handle cover image...
}
```

## Best Practices

1. Always handle asynchronous operations with proper error catching
2. Use `removeContentRange()` for efficient bulk removal
3. Prefer `removeExceptWhere()` for complex filtering
4. Consider memory usage when handling large EPUBs
5. Validate content before insertion
6. Use appropriate content types (HTML/Markdown) based on source

## Notes

- The module maintains EPUB 3.0 compatibility while preserving EPUB 2.0 structures
- All XML modifications preserve document structure
- Content navigation is updated automatically
- Metadata is preserved and updated appropriately
- File paths are handled cross-platform

## Error Handling

The module throws errors for:
- Invalid EPUB structure
- Missing required files
- Invalid content operations
- Browser-specific limitations
- File system operations in browser context