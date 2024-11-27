import fs from 'fs';
import path from 'path';
import axios from 'axios';
import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import format from 'xml-formatter';

// Node Types
interface XMLNode {
    nodeType: number;
    nodeName: string;
    textContent: string | null;
    getAttribute: (name: string) => string | null;
    setAttribute: (name: string, value: string) => void;
    getElementsByTagName: (name: string) => XMLElement[];
    parentNode: XMLElement | null;
    removeChild: (child: XMLElement) => void;
    appendChild: (child: XMLElement) => XMLElement;
    childNodes: NodeListOf<XMLElement>;
  }
  
  interface XMLElement extends XMLNode {
    ownerDocument: XMLDocument;
    children: HTMLCollection;
    attributes: NamedNodeMap;
  }
  
  interface XMLDocument extends XMLNode {
    documentElement: XMLElement;
    createElement: (tagName: string) => XMLElement;
  }
  
  interface NamedNodeMap {
    length: number;
    item: (index: number) => Attr | null;
    [index: number]: Attr;
  }
  
  interface Attr {
    name: string;
    value: string;
  }
  
  interface HTMLCollection {
    length: number;
    item: (index: number) => XMLElement | null;
    [index: number]: XMLElement;
  }
  
  interface NodeListOf<T> {
    length: number;
    item: (index: number) => T | null;
    [index: number]: T;
  }

interface ContentElement {
    id: string;
    label: string;
    href: string;
    index: number;
    children?: ContentElement[];
  }

class RePub {

  private static readonly VERSION = '1.0.0';
  private zip!: JSZip;
  private contentPath: string = '';
  private spine: XMLElement | null = null;
  private manifest: XMLElement | null = null;
  private navigation: XMLDocument | null = null;
  private ncx: XMLDocument | null = null;
  private contents: ContentElement[] = [];

  constructor() {
  }

  async open(location: string): Promise<void> {
    let epubData: Buffer;

    if (location.startsWith('http')) {
      const response = await axios.get(location, { responseType: 'arraybuffer' });
      epubData = Buffer.from(response.data);
    } else {
      epubData = await fs.promises.readFile(location);
    }

    this.zip = await JSZip.loadAsync(epubData);
    
    // Read container.xml to get content.opf path
    const containerFile = this.zip.file('META-INF/container.xml');
    if (!containerFile) throw new Error('Invalid EPUB: Missing container.xml');
    
    const containerXml = await containerFile.async('string');
    const parser = new DOMParser();
    const containerDoc = parser.parseFromString(containerXml, 'text/xml') as unknown as XMLDocument;
    const rootfiles = containerDoc.getElementsByTagName('rootfile');
    if (rootfiles.length === 0) throw new Error('Invalid EPUB: No rootfile found');
    
    const fullPath = rootfiles[0].getAttribute('full-path');
    if (!fullPath) throw new Error('Invalid EPUB: Missing rootfile path');
    
    this.contentPath = fullPath;

    // Read content.opf
    const contentFile = this.zip.file(this.contentPath);
    if (!contentFile) throw new Error('Invalid EPUB: Missing content.opf');
    
    const contentOpf = await contentFile.async('string');
    const contentDoc = parser.parseFromString(contentOpf, 'text/xml') as unknown as XMLDocument;
    
    // Get spine and manifest
    const spineElements = contentDoc.getElementsByTagName('spine');
    const manifestElements = contentDoc.getElementsByTagName('manifest');
    
    if (spineElements.length === 0 || manifestElements.length === 0) {
      throw new Error('Invalid EPUB: Missing spine or manifest');
    }

    this.spine = spineElements[0];
    this.manifest = manifestElements[0];

    // Find navigation document
    const items = this.manifest.getElementsByTagName('item');
    const navItem = Array.from(items).find(
      item => item.getAttribute('properties')?.includes('nav')
    );

    if (navItem) {
      const href = navItem.getAttribute('href');
      if (href) {
        const navPath = path.join(path.dirname(this.contentPath), href);
        const navFile = this.zip.file(navPath);
        if (navFile) {
          const navContent = await navFile.async('string');
          this.navigation = parser.parseFromString(navContent, 'text/xml') as unknown as XMLDocument;
        }
      }
    }

    // Try to find NCX file
    const ncxItem = Array.from(items).find(
      item => item.getAttribute('media-type') === 'application/x-dtbncx+xml'
    );

    if (ncxItem) {
      const href = ncxItem.getAttribute('href');
      if (href) {
        const ncxPath = path.join(path.dirname(this.contentPath), href);
        const ncxFile = this.zip.file(ncxPath);
        if (ncxFile) {
          const ncxContent = await ncxFile.async('string');
          this.ncx = parser.parseFromString(ncxContent, 'text/xml') as unknown as XMLDocument;
        }
      }
    }

    await this.buildContentsList();
  }

  private processNavigationChildren(item: XMLElement, currentIndex: number): [ContentElement[], number] {
    const children: ContentElement[] = [];
    let index = currentIndex;
    
    const nestedList = item.getElementsByTagName('ol')[0];
    
    if (nestedList) {
      const childItems = Array.from(nestedList.childNodes).filter(
        child => child.nodeType === 1 && child.nodeName.toLowerCase() === 'li'
      );

      for (const childItem of childItems) {
        const childAnchor = childItem.getElementsByTagName('a')[0];
        
        if (childAnchor) {
          const href = childAnchor.getAttribute('href');
          
          if (href) {
            const [grandChildren, newIndex] = this.processNavigationChildren(childItem, index + 1);
            
            children.push({
              id: href.split('#')[0],
              label: childAnchor.textContent || `Item ${index}`,
              href,
              index: index++,
              ...(grandChildren.length > 0 ? { children: grandChildren } : {})
            });
            index = newIndex;
          }
        }
      }
    }
    
    return [children, index];
  }


  private processNCXNavPoint(navPoint: XMLElement, currentIndex: number): [ContentElement, number] {
    const textElement = navPoint.getElementsByTagName('text')[0];
    const contentElement = navPoint.getElementsByTagName('content')[0];
    const src = contentElement?.getAttribute('src');
    let index = currentIndex;
    
    const children: ContentElement[] = [];
    // Use childNodes instead of children and filter by nodeType and nodeName
    const childNavPoints = Array.from(navPoint.childNodes).filter(
      child => child.nodeType === 1 && child.nodeName === 'navPoint'
    );
    
    for (const childPoint of childNavPoints) {
      const [childElement, newIndex] = this.processNCXNavPoint(childPoint, index + 1);
      children.push(childElement);
      index = newIndex;
    }

    return [{
      id: src?.split('#')[0] || '',
      label: textElement?.textContent || `Item ${index}`,
      href: src || '',
      index: index++,
      ...(children.length > 0 ? { children } : {})
    }, index];
  }

  private async buildContentsList(): Promise<void> {
    this.contents = [];
    let index = 0;

    if (this.navigation) {
        const topLevelList = this.navigation.getElementsByTagName('ol')[0];
        
        if (topLevelList) {
          const topLevelItems = Array.from(topLevelList.childNodes).filter(
            child => child.nodeType === 1 && child.nodeName.toLowerCase() === 'li'
          );
  
          for (const item of topLevelItems) {
            const anchor = item.getElementsByTagName('a')[0];
            
            if (anchor) {
              const href = anchor.getAttribute('href');
              
              if (href) {
                const [children, newIndex] = this.processNavigationChildren(item, index + 1);
                
                this.contents.push({
                  id: href.split('#')[0],
                  label: anchor.textContent || `Item ${index}`,
                  href,
                  index: index++,
                  ...(children.length > 0 ? { children } : {})
                });
                index = newIndex;
              }
            }
          }
        }
    } else if (this.ncx) {
      const navMap = this.ncx.getElementsByTagName('navMap')[0];
      
      if (navMap) {
        const topLevelPoints = Array.from(navMap.childNodes).filter(
          child => child.nodeType === 1 && child.nodeName === 'navPoint'
        );
        
        for (const navPoint of topLevelPoints) {
          const [element, newIndex] = this.processNCXNavPoint(navPoint, index);
          this.contents.push(element);
          index = newIndex;
        }
      }
    }
  }
    
  listContents(): ContentElement[] {
    return this.contents;
  }
    
/**
   * Removes a range of content elements.
   * @param range String representing the range to remove.
   *              Format: "n..." for elements from index n onwards
   *                      "n..m" for elements from index n to m inclusive
   * @throws Error if the range format is invalid or if indices are out of bounds
   */

async removeContentRange(range: string): Promise<void> {
    const parseRange = (rangeStr: string): [number, number | null] => {
      if (rangeStr.endsWith('...')) {
        const start = parseInt(rangeStr.slice(0, -3), 10);
        if (isNaN(start)) {
          throw new Error('Invalid range format. Expected "n..." or "n..m"');
        }
        return [start, null];
      }
      
      const parts = rangeStr.split('..');
      if (parts.length !== 2) {
        throw new Error('Invalid range format. Expected "n..." or "n..m"');
      }
      
      const start = parseInt(parts[0], 10);
      const end = parseInt(parts[1], 10);
      
      if (isNaN(start) || isNaN(end)) {
        throw new Error('Invalid range format. Expected numbers for start and end');
      }
      
      return [start, end];
    };

    // Get flat list of all elements for index lookup
    const getAllElements = (elements: ContentElement[]): ContentElement[] => {
      return elements.reduce((acc: ContentElement[], element) => {
        acc.push(element);
        /*if (element.children) {
          acc.push(...getAllElements(element.children));
        }*/
        return acc;
      }, []);
    };

    const [start, end] = parseRange(range);
    
    // Get all elements including nested ones
    const allElements = getAllElements(this.contents);
    
    // Sort by index to ensure we remove in the correct order
    allElements.sort((a, b) => a.index - b.index);
    
    // Find start and end indices in the flat list
    const startElement = allElements.find(el => el.index >= start);
    if (!startElement) {
      throw new Error(`Start index ${start} not found`);
    }

    // Calculate end index if not specified
    const endIndex = end !== null ? end : Math.max(...allElements.map(el => el.index));
    
    // Get elements to remove
    const elementsToRemove = allElements.filter(el => 
      el.index >= start && el.index <= endIndex
    );

    // Remove elements in reverse order (to maintain correct indices)
    for (let i = elementsToRemove.length - 1; i >= 0; i--) {
      await this.removeContentElement(elementsToRemove[i].id);
    }

    // Rebuild contents list after removal
    await this.buildContentsList();
  }
    
  private removeNavigationItem(element: XMLElement): void {
    // Get the li parent
    const listItem = element.parentNode;
    if (!listItem) return;

    // Get the ol parent
    const orderedList = listItem.parentNode;
    if (!orderedList) return;

    // Remove the li and its contents
    orderedList.removeChild(listItem);

    // If this was the last li in the ol and the ol is not the primary navigation list
    // (i.e., it's a nested ol), remove the empty ol as well
    const remainingItems = orderedList.getElementsByTagName('li');
    if (remainingItems.length === 0 && orderedList.parentNode?.nodeName.toLowerCase() === 'li') {
      const parentListItem = orderedList.parentNode;
      const parentOrderedList = parentListItem.parentNode;
      if (parentOrderedList) {
        parentOrderedList.removeChild(parentListItem);
      }
    }
  }
    
  private getNavPointByContent(ncxElement: XMLElement, href: string): XMLElement | null {
    // First check this navPoint's content
    const content = ncxElement.getElementsByTagName('content')[0];
    if (content?.getAttribute('src')?.split('#')[0] === href.split('#')[0]) {
      return ncxElement;
    }

    // Then check all child navPoints
    const childNavPoints = Array.from(ncxElement.getElementsByTagName('navPoint'));
    for (const navPoint of childNavPoints) {
      const foundNavPoint = this.getNavPointByContent(navPoint, href);
      if (foundNavPoint) {
        return foundNavPoint;
      }
    }

    return null;
  }
    
  private removeFromNavigation(href: string): void {
    if (!this.navigation) return;

    // Get all nav elements (toc, landmarks, etc.)
    const navElements = Array.from(this.navigation.getElementsByTagName('nav'));
    
    for (const nav of navElements) {
      // Get all anchors in this navigation section
      const anchors = Array.from(nav.getElementsByTagName('a'));
      
      for (const anchor of anchors) {
        const anchorHref = anchor.getAttribute('href');
        if (!anchorHref) continue;

        // Check if this anchor references our removed content
        // We need to handle both exact matches and fragment references
        const isMatch = anchorHref === href || // Exact match
                       anchorHref.split('#')[0] === href || // Base file match
                       href.includes(anchorHref.split('#')[0]); // Partial match

        if (isMatch) {
          const listItem = anchor.parentNode;
          if (listItem?.parentNode) {
            listItem.parentNode.removeChild(listItem);
          }
        }
      }

      // Clean up empty lists
      const lists = Array.from(nav.getElementsByTagName('ol'));
      for (const list of lists) {
        if (list.getElementsByTagName('li').length === 0) {
          list.parentNode?.removeChild(list);
        }
      }
    }
  }

  async removeContentElement(identifier: string | number): Promise<void> {
    const content = typeof identifier === 'number'
      ? this.contents[identifier]
      : this.contents.find(c => c.id === identifier);

    if (!content || !content.href) {
      throw new Error('Content element not found');
    }

    // Remove from zip
    const contentPath = path.join(path.dirname(this.contentPath), content.href.split('#')[0]);
    this.zip.remove(contentPath);

    if (!this.manifest || !this.spine) {
      throw new Error('Invalid EPUB structure');
    }

    // Remove from manifest
    const manifestItems = Array.from(this.manifest.getElementsByTagName('item'));
    const manifestItem = manifestItems.find(
      item => item.getAttribute('href') === content.href
    );

    if (manifestItem?.parentNode) {
      manifestItem.parentNode.removeChild(manifestItem);
    }

    // Remove from spine
    const manifestId = manifestItem?.getAttribute('id');
    if (manifestId) {
      const spineItems = Array.from(this.spine.getElementsByTagName('itemref'));
      const spineItem = spineItems.find(
        item => item.getAttribute('idref') === manifestId
      );
      if (spineItem?.parentNode) {
        spineItem.parentNode.removeChild(spineItem);
      }
    }

    // Remove from all navigation sections
    this.removeFromNavigation(content.href.split('#')[0]);

    // Remove from NCX if it exists
    if (this.ncx) {
      const ncxPoints = Array.from(this.ncx.getElementsByTagName('navPoint'));
      const ncxItem = ncxPoints.find(point => {
        const contents = point.getElementsByTagName('content');
        return contents[0]?.getAttribute('src') === content.href;
      });
      
      if (ncxItem?.parentNode) {
        ncxItem.parentNode.removeChild(ncxItem);
      }
    }

    // Update contents list
    await this.buildContentsList();
  }

  async removeContents(identifiers: (string | number)[]): Promise<void> {
    for (const identifier of identifiers) {
      await this.removeContentElement(identifier);
    }
  }
    
  private normalizeWhitespace(element: XMLElement): void {
    // Convert childNodes to array for safe iteration
    const children = Array.from(element.childNodes);
    
    for (const child of children) {
      if (child.nodeType === 3) { // Text node
        // If it's empty or just whitespace, remove it
        if (!child.textContent?.trim()) {
          element.removeChild(child);
        } else {
          // Normalize whitespace in non-empty text nodes
          child.textContent = child.textContent.replace(/\s+/g, ' ').trim();
        }
      } else if (child.nodeType === 1) { // Element node
        this.normalizeWhitespace(child as XMLElement);
      }
    }
  }
    
  private updateMetadata(): void {
    if (!this.manifest?.ownerDocument) return;
    
    const doc = this.manifest.ownerDocument as XMLDocument;
    const metadata = doc.getElementsByTagName('metadata')[0];
    if (!metadata) return;

    const currentDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const currentDateTime = new Date().toISOString().replace(/\.\d+Z$/, 'Z'); // Remove milliseconds
    
    // Update or add contributor
    const contributors = metadata.getElementsByTagName('dc:contributor');
    let contributorElement: XMLElement | null = null;
    
    // Look for existing rePub contributor
    for (const contrib of Array.from(contributors)) {
      if (contrib.textContent?.includes('rePub')) {
        contributorElement = contrib;
        break;
      }
    }

    if (!contributorElement) {
      // Create new contributor element
      contributorElement = doc.createElement('dc:contributor');
      contributorElement.setAttribute('id', 'contributor');
      metadata.appendChild(contributorElement);
      
      // Create role meta element
      const roleMeta = doc.createElement('meta');
      roleMeta.setAttribute('refines', '#contributor');
      roleMeta.setAttribute('property', 'role');
      roleMeta.setAttribute('scheme', 'marc:relators');
      roleMeta.textContent = 'bkp';
      metadata.appendChild(roleMeta);
    }
    
    contributorElement.textContent = `rePub ${RePub.VERSION}`;

    // Update or add date
    let dateElement = metadata.getElementsByTagName('dc:date')[0];
    if (!dateElement) {
      dateElement = doc.createElement('dc:date');
      metadata.appendChild(dateElement);
    }
    dateElement.textContent = currentDate;

    // Update or add modified date
    let modifiedElement = Array.from(metadata.getElementsByTagName('meta'))
      .find(meta => meta.getAttribute('property') === 'dcterms:modified');
      
    if (!modifiedElement) {
      modifiedElement = doc.createElement('meta');
      modifiedElement.setAttribute('property', 'dcterms:modified');
      metadata.appendChild(modifiedElement);
    }
    modifiedElement.textContent = currentDateTime;
  }

  async saveAs(location: string): Promise<void> {
    if (!this.manifest || !this.spine) {
      throw new Error('Invalid EPUB structure');
    }
      
    // Update metadata before saving
    this.updateMetadata();

    // Update content.opf
    const serializer = new XMLSerializer();
    this.normalizeWhitespace(this.manifest.ownerDocument.documentElement);
    const contentOpfPath = this.contentPath;
    const contentOpfContent = format(
      serializer.serializeToString(this.manifest.ownerDocument.documentElement as unknown as Node),
      { indentation: '  ', collapseContent: true }
    );
    this.zip.file(contentOpfPath, contentOpfContent, {
      compression: 'DEFLATE',
      compressionOptions: {
        level: 9
      }
    });

    // Update navigation document if it exists
    if (this.navigation) {
      const items = Array.from(this.manifest.getElementsByTagName('item'));
      const navItem = items.find(
        item => item.getAttribute('properties')?.includes('nav')
      );
      
      if (navItem) {
        const href = navItem.getAttribute('href');
        if (href) {
          const navPath = path.join(path.dirname(this.contentPath), href);
          this.normalizeWhitespace(this.navigation.documentElement);
          const navContent = format(
            serializer.serializeToString(this.navigation.documentElement as unknown as Node),
            { indentation: '  ', collapseContent: true }
          );
          this.zip.file(navPath, navContent, {
            compression: 'DEFLATE',
            compressionOptions: {
              level: 9
            }
          });
        }
      }
    }

    // Update NCX if it exists
    if (this.ncx) {
      const items = Array.from(this.manifest.getElementsByTagName('item'));
      const ncxItem = items.find(
        item => item.getAttribute('media-type') === 'application/x-dtbncx+xml'
      );
      
      if (ncxItem) {
        const href = ncxItem.getAttribute('href');
        if (href) {
          const ncxPath = path.join(path.dirname(this.contentPath), href);
          this.normalizeWhitespace(this.ncx.documentElement);
          const ncxContent = format(
            serializer.serializeToString(this.ncx.documentElement as unknown as Node),
            { indentation: '  ', collapseContent: true }
          );
          this.zip.file(ncxPath, ncxContent, {
            compression: 'DEFLATE',
            compressionOptions: {
              level: 9
            }
          });
        }
      }
    }

    // Generate EPUB file
    const content = await this.zip.generateAsync({ type: 'nodebuffer' });
    await fs.promises.writeFile(location, content);
  }
    
}

export default RePub;