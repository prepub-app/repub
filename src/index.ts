import fs from 'fs';
import path from 'path';
import axios from 'axios';
import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { parseString } from 'xml2js';

// Node Types
interface XMLNode {
  nodeType: number;
  nodeName: string;
  getAttribute: (name: string) => string | null;
  getElementsByTagName: (name: string) => XMLElement[];
  textContent: string | null;
  parentNode: XMLElement | null;
  removeChild: (child: XMLElement) => void;
}

interface XMLElement extends XMLNode {
  ownerDocument: XMLDocument;
}

interface XMLDocument extends XMLNode {
  documentElement: XMLElement;
}

interface ContentElement {
  id: string;
  label: string;
  href?: string;
  index: number;
}

class RePub {
  private zip!: JSZip;
  private contentPath: string = '';
  private spine: XMLElement | null = null;
  private manifest: XMLElement | null = null;
  private navigation: XMLDocument | null = null;
  private ncx: XMLDocument | null = null;
  private contents: ContentElement[] = [];

  constructor() {
    //this.zip = new JSZip();
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

  private async buildContentsList(): Promise<void> {
    this.contents = [];
    let index = 0;

    if (this.navigation) {
      // Parse nav document
      const navPoints = Array.from(this.navigation.getElementsByTagName('a'));
      for (const navPoint of navPoints) {
        const href = navPoint.getAttribute('href');
        if (href) {
          this.contents.push({
            id: href.split('#')[0],
            label: navPoint.textContent || `Item ${index + 1}`,
            href,
            index: index++
          });
        }
      }
    } else if (this.ncx) {
      // Parse NCX document
      const navPoints = Array.from(this.ncx.getElementsByTagName('navPoint'));
      for (const navPoint of navPoints) {
        const texts = navPoint.getElementsByTagName('text');
        const contents = navPoint.getElementsByTagName('content');
        
        if (texts.length > 0 && contents.length > 0) {
          const textElement = texts[0];
          const contentElement = contents[0];
          const src = contentElement.getAttribute('src');
          
          if (src) {
            this.contents.push({
              id: src.split('#')[0],
              label: textElement.textContent || `Item ${index + 1}`,
              href: src,
              index: index++
            });
          }
        }
      }
    }
  }

  listContents(): ContentElement[] {
    return this.contents;
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

    // Remove from navigation document
    if (this.navigation) {
        // First try to find an <a> element with matching href
        const navAnchors = Array.from(this.navigation.getElementsByTagName('a'));
        const navAnchor = navAnchors.find(
          a => a.getAttribute('href') === content.href
        );
        
        if (navAnchor) {
          this.removeNavigationItem(navAnchor);
        } else {
          // If no matching <a> found, check for spans that might be related
          // (e.g., if this is a section being removed that has a span header)
          const navSpans = Array.from(this.navigation.getElementsByTagName('span'));
          for (const span of navSpans) {
            // Check if this span's subsections contain our target
            const nestedAnchors = Array.from(span.parentNode?.getElementsByTagName('a') || []);
            const hasTargetContent = nestedAnchors.some(
              a => a.getAttribute('href') === content.href
            );
            
            if (hasTargetContent) {
              this.removeNavigationItem(span);
              break;
            }
          }
        }
      }

    // Remove from NCX
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

  async saveAs(location: string): Promise<void> {
    if (!this.manifest || !this.spine) {
      throw new Error('Invalid EPUB structure');
    }

    // Update content.opf
    const serializer = new XMLSerializer();
    const contentOpfPath = this.contentPath;
    const contentOpfContent = serializer.serializeToString(this.manifest.ownerDocument.documentElement as unknown as Node);
    this.zip.file(contentOpfPath, contentOpfContent);

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
          const navContent = serializer.serializeToString(this.navigation.documentElement as unknown as Node);
          this.zip.file(navPath, navContent);
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
          const ncxContent = serializer.serializeToString(this.ncx.documentElement as unknown as Node);
          this.zip.file(ncxPath, ncxContent);
        }
      }
    }

    // Generate EPUB file
    const content = await this.zip.generateAsync({ type: 'nodebuffer' });
    await fs.promises.writeFile(location, content);
  }
}

export default RePub;