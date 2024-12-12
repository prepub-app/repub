/**
 * RePub: A TypeScript library for EPUB manipulation
 * 
 * This module provides functionality to read, modify, and create EPUB files while maintaining
 * compliance with both EPUB 3.0 and 2.0 standards. It handles content management, metadata,
 * navigation, and structural modifications of EPUB documents.
 * 
 * @module RePub
 * @version 1.0.0
 */

import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import format from 'xml-formatter';
import MarkdownIt from 'markdown-it';
import  TurndownService from 'turndown';
import {
    XMLElement,
    XMLDocument,
    ContentElement,
    ContentOptions,
    CoreMetadata,
    MetadataProperty,
    FullMetadata,
    CoverImage,
    FileData,
    ContentType,
    LandmarkInfo
} from './types';

import debug from 'debug';
import { Debugger } from 'debug';

const log: Debugger = debug('repub:core');

/**
 * Error thrown when DRM is detected in an EPUB file
 */
export class DRMError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DRMError';
  }
}

/**
 * Main class for EPUB manipulation
 * Provides methods for reading, modifying, and saving EPUB documents
 */
export class RePub {
  /** Current version of the RePub library */
  private static readonly VERSION = '1.0.0';
  
  /** JSZip instance for handling the EPUB archive */
  private zip!: JSZip;
  
  /** Markdown parser instance configured for XHTML output */
  private md: MarkdownIt;
  
  /** Path to the EPUB content file (content.opf) */
  private contentPath: string = '';
  
  /** Reference to the spine element in content.opf */
  private spine: XMLElement | null = null;
  
  /** Reference to the manifest element in content.opf */
  private manifest: XMLElement | null = null;
  
  /** Navigation document (EPUB3) */
  private navigation: XMLDocument | null = null;
  
  /** NCX document (EPUB2) */
  private ncx: XMLDocument | null = null;
  
  /** List of content elements representing the EPUB structure */
  private contents: ContentElement[] = [];

  /**
   * Creates a new RePub instance
   * Initializes the Markdown parser with XHTML-compatible output
   */
  constructor() {
    this.md = new MarkdownIt({
      html: true,
      xhtmlOut: true  // Important for EPUB compatibility
    });
  }

  /**
   * Checks if the EPUB file contains DRM protection
   * @private
   * @param zip JSZip instance containing the EPUB contents
   * @returns True if DRM is detected, false otherwise
   */
  private async checkForDRM(zip: JSZip): Promise<boolean> {
    // Check for encryption files in META-INF
    const encryptionFile = zip.file('META-INF/encryption.xml');
    const rightsFile = zip.file('META-INF/rights.xml');
    
    if (encryptionFile) {
      const encryptionContent = await encryptionFile.async('string');
      const parser = new DOMParser();
      const encryptionDoc = parser.parseFromString(encryptionContent, 'text/xml');
      
      // Check for encryption method elements
      const encryptionMethod = encryptionDoc.getElementsByTagName('EncryptionMethod');
      if (encryptionMethod.length > 0) {
        return true;
      }
    }

    // Check for rights file
    if (rightsFile) {
      return true;
    }

    // Check for Adobe's adept DRM
    const adeptFile = zip.file('META-INF/adept.xml');
    if (adeptFile) {
      return true;
    }

    // Check for Apple's fairplay DRM
    const fairplayFile = zip.file('META-INF/fairplay.xml');
    if (fairplayFile) {
      return true;
    }

    // Check content.opf for DRM-related metadata
    const containerFile = zip.file('META-INF/container.xml');
    if (containerFile) {
      const containerContent = await containerFile.async('string');
      const parser = new DOMParser();
      const containerDoc = parser.parseFromString(containerContent, 'text/xml');
      const rootfiles = containerDoc.getElementsByTagName('rootfile');
      
      if (rootfiles.length > 0) {
        const fullPath = rootfiles[0].getAttribute('full-path');
        if (fullPath) {
          const contentFile = zip.file(fullPath);
          if (contentFile) {
            const contentOpf = await contentFile.async('string');
            const contentDoc = parser.parseFromString(contentOpf, 'text/xml');
            
            // Check for DRM-related metadata
            const metadataElement = contentDoc.getElementsByTagName('metadata')[0];
            if (metadataElement) {
              // Check for rights-related metadata
              const rights = metadataElement.getElementsByTagName('dc:rights');
              const rightsMeta = Array.from(metadataElement.getElementsByTagName('meta'))
                .filter(meta => {
                  const property = meta.getAttribute('property');
                  return property && (
                    property.includes('rights') ||
                    property.includes('encrypted') ||
                    property.includes('protection')
                  );
                });

              if (rights.length > 0 || rightsMeta.length > 0) {
                // Further analyze the content to determine if it's actually DRM
                // or just standard rights information
                for (const element of [...Array.from(rights), ...rightsMeta]) {
                  const content = element.textContent?.toLowerCase() || '';
                  if (
                    content.includes('drm') ||
                    content.includes('encrypted') ||
                    content.includes('protected') ||
                    content.includes('adept') ||
                    content.includes('fairplay')
                  ) {
                    return true;
                  }
                }
              }
            }
          }
        }
      }
    }

    return false;
  }

  /**
   * Loads EPUB data from a file or buffer
   * @param data The EPUB data as Buffer, ArrayBuffer, Uint8Array, or Blob
   * @throws {Error} If the EPUB structure is invalid
   * @throws {DRMError} If DRM protection is detected
   */
  async load(data: FileData): Promise<void> {
    this.zip = await JSZip.loadAsync(data);
    
    // Check for DRM before proceeding
    if (await this.checkForDRM(this.zip)) {
      throw new DRMError('This EPUB file is protected by DRM and cannot be modified');
    }
    
    await this.initialize();
  }

  /**
   * Opens an EPUB from a file path or URL
   * @param location File path or URL to the EPUB
   * @throws {Error} If file path loading is attempted in browser environment
   * @throws {DRMError} If DRM protection is detected
   */
  async open(location: string): Promise<void> {
    let epubData: FileData;

    if (location.startsWith('http')) {
      const response = await fetch(location);
      epubData = await response.arrayBuffer();
    } else {
      throw new Error('File path loading is not supported in browser environment');
    }

    await this.load(epubData);
  }

  /**
   * Initializes the EPUB structure by reading and parsing essential files
   * @private
   * @throws {Error} If required EPUB components are missing or invalid
   */
  private async initialize(): Promise<void> {
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

    // Find navigation document (EPUB3)
    const items = this.manifest.getElementsByTagName('item');
    const navItem = Array.from(items).find(
      item => item.getAttribute('properties')?.includes('nav')
    );

    if (navItem) {
      const href = navItem.getAttribute('href');
      if (href) {
        const navPath = this.path.join(this.path.dirname(this.contentPath), href);
        const navFile = this.zip.file(navPath);
        if (navFile) {
          const navContent = await navFile.async('string');
          this.navigation = parser.parseFromString(navContent, 'text/xml') as unknown as XMLDocument;
        }
      }
    }

    // Try to find NCX file (EPUB2)
    const ncxItem = Array.from(items).find(
      item => item.getAttribute('media-type') === 'application/x-dtbncx+xml'
    );

    if (ncxItem) {
      const href = ncxItem.getAttribute('href');
      if (href) {
        const ncxPath = this.path.join(this.path.dirname(this.contentPath), href);
        const ncxFile = this.zip.file(ncxPath);
        if (ncxFile) {
          const ncxContent = await ncxFile.async('string');
          this.ncx = parser.parseFromString(ncxContent, 'text/xml') as unknown as XMLDocument;
        }
      }
    }

    await this.buildContentsList();
  }

/**
 * Builds the internal contents list from navigation documents
 * @private
 */
private async buildContentsList(): Promise<void> {
  this.contents = [];
  let index = 0;
  
  // Helper to determine content type from landmarks
  const getLandmarkInfo = (href: string): LandmarkInfo => {
    if (!this.navigation) return {};
    
    const landmarks = Array.from(this.navigation.getElementsByTagName('nav'))
      .find(nav => nav.getAttribute('epub:type') === 'landmarks');
      
    if (!landmarks) return {};

    const links = Array.from(landmarks.getElementsByTagName('a'));
    for (const link of links) {
      const landmarkHref = link.getAttribute('href');
      if (!landmarkHref) continue;
      
      // Match either exact href or the file part without fragment
      if (landmarkHref === href || landmarkHref.split('#')[0] === href.split('#')[0]) {
        const type = link.getAttribute('epub:type');
        if (!type) continue;
        
        // Map epub:type to our simplified type system
        let contentType: ContentType | undefined;
        if (type.includes('front')) contentType = 'frontmatter';
        else if (type.includes('back')) contentType = 'backmatter';
        else if (type.includes('body')) contentType = 'bodymatter';
        
        return {
          type: contentType,
          role: type
        };
      }
    }
    
    return {};
  };

  // Helper to get content type from the document itself
  const getContentType = async (href: string): Promise<LandmarkInfo> => {
    // First check landmarks
    const landmarkInfo = getLandmarkInfo(href);
    if (landmarkInfo.type) return landmarkInfo;
    
    // If not in landmarks, check the content file itself
    try {
      const contentPath = this.path.join(this.path.dirname(this.contentPath), href.split('#')[0]);
      const contentFile = this.zip.file(contentPath);
      if (!contentFile) return {};
      
      const content = await contentFile.async('string');
      const bodyMatch = content.match(/<body[^>]*epub:type="([^"]*)"[^>]*>/);
      if (!bodyMatch) return {};
      
      const type = bodyMatch[1];
      let contentType: ContentType | undefined;
      
      if (type.includes('front')) contentType = 'frontmatter';
      else if (type.includes('back')) contentType = 'backmatter';
      else if (type.includes('body')) contentType = 'bodymatter';
      
      return {
        type: contentType,
        role: type
      };
    } catch {
      return {};
    }
  };

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
            const [children, newIndex] = await this.processNavigationChildrenWithType(
              item, 
              index + 1, 
              getContentType
            );
            const { type, role } = await getContentType(href);
            
            const element: ContentElement = {
              id: href.split('#')[0],
              label: anchor.textContent || `Item ${index}`,
              href,
              index: index++
            };

            if (type) element.type = type;
            if (role) element.role = role;
            if (children.length > 0) element.children = children;

            this.contents.push(element);
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
        const [element, newIndex] = await this.processNCXNavPointWithType(
          navPoint, 
          index,
          getContentType
        );
        this.contents.push(element);
        index = newIndex;
      }
    }
  }
}

private async processNavigationChildrenWithType(
  item: XMLElement,
  currentIndex: number,
  getContentType: (href: string) => Promise<LandmarkInfo>
): Promise<[ContentElement[], number]> {
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
          const [grandChildren, newIndex] = await this.processNavigationChildrenWithType(
            childItem, 
            index + 1,
            getContentType
          );
          const { type, role } = await getContentType(href);
          
          const element: ContentElement = {
            id: href.split('#')[0],
            label: childAnchor.textContent || `Item ${index}`,
            href,
            index: index++
          };

          if (type) element.type = type;
          if (role) element.role = role;
          if (grandChildren.length > 0) element.children = grandChildren;

          children.push(element);
          index = newIndex;
        }
      }
    }
  }
  
  return [children, index];
}

private async processNCXNavPointWithType(
  navPoint: XMLElement,
  currentIndex: number,
  getContentType: (href: string) => Promise<LandmarkInfo>
): Promise<[ContentElement, number]> {
  const textElement = navPoint.getElementsByTagName('text')[0];
  const contentElement = navPoint.getElementsByTagName('content')[0];
  const src = contentElement?.getAttribute('src');
  let index = currentIndex;
  
  const children: ContentElement[] = [];
  const childNavPoints = Array.from(navPoint.childNodes).filter(
    child => child.nodeType === 1 && child.nodeName === 'navPoint'
  );
  
  for (const childPoint of childNavPoints) {
    const [childElement, newIndex] = await this.processNCXNavPointWithType(
      childPoint, 
      index + 1,
      getContentType
    );
    children.push(childElement);
    index = newIndex;
  }

  const { type = undefined, role = undefined } = src ? await getContentType(src) : {};

  const element: ContentElement = {
    id: src?.split('#')[0] || '',
    label: textElement?.textContent || `Item ${index}`,
    href: src || '',
    index: index++
  };

  if (type) element.type = type;
  if (role) element.role = role;
  if (children.length > 0) element.children = children;

  return [element, index];
}

  /**
   * Returns the current list of content elements
   * @returns Array of ContentElement objects representing the EPUB structure
   */
  listContents(): ContentElement[] {
    return this.contents;
  }

  /**
   * Removes a range of content elements
   * @param range String representing the range to remove ("n..." or "n..m")
   * @throws {Error} If the range format is invalid or indices are out of bounds
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

    const getAllElements = (elements: ContentElement[]): ContentElement[] => {
      return elements.reduce((acc: ContentElement[], element) => {
        acc.push(element);
        return acc;
      }, []);
    };

    const [start, end] = parseRange(range);
    const allElements = getAllElements(this.contents);
    allElements.sort((a, b) => a.index - b.index);
    
    const startElement = allElements.find(el => el.index >= start);
    if (!startElement) {
      throw new Error(`Start index ${start} not found`);
    }

    const endIndex = end !== null ? end : Math.max(...allElements.map(el => el.index));
    
    const elementsToRemove = allElements.filter(el => 
      el.index >= start && el.index <= endIndex
    );

    for (let i = elementsToRemove.length - 1; i >= 0; i--) {
      await this._removeContentElement(elementsToRemove[i].id);
    }

    await this.buildContentsList();
  }

  /**
   * Removes references to a content file from navigation documents
   * @private
   * @param href Content file reference to remove
   */
  private removeFromNavigation(href: string): void {
    if (!this.navigation) return;

    const navElements = Array.from(this.navigation.getElementsByTagName('nav'));
    
    for (const nav of navElements) {
      const anchors = Array.from(nav.getElementsByTagName('a'));
      
      for (const anchor of anchors) {
        const anchorHref = anchor.getAttribute('href');
        if (!anchorHref) continue;

        const isMatch = anchorHref === href || 
                       anchorHref.split('#')[0] === href || 
                       href.includes(anchorHref.split('#')[0]);

        if (isMatch) {
          const listItem = anchor.parentNode;
          if (listItem?.parentNode) {
            listItem.parentNode.removeChild(listItem);
          }
        }
      }

      const lists = Array.from(nav.getElementsByTagName('ol'));
          for (const list of lists) {
            if (list.getElementsByTagName('li').length === 0) {
              list.parentNode?.removeChild(list);
            }
          }
        }
      }

    /**
     * Removes a single content element from the EPUB
     * @private
     * @param identifier String ID or numeric index of the element to remove
     * @throws {Error} If the content element is not found or the EPUB structure is invalid
     */
    private async _removeContentElement(identifier: string | number): Promise<void> {
      const content = typeof identifier === 'number'
        ? this.contents[identifier]
        : this.contents.find(c => c.id === identifier);

      if (!content || !content.href) {
        throw new Error('Content element not found');
      }

      const contentURI = content.href.split('#')[0];

      // Remove from zip
      const contentPath = this.path.join(this.path.dirname(this.contentPath), contentURI);
      this.zip.remove(contentPath);

      if (!this.manifest || !this.spine) {
        throw new Error('Invalid EPUB structure');
      }

      // Remove from manifest
      const manifestItems = Array.from(this.manifest.getElementsByTagName('item'));
      const manifestItem = manifestItems.find(
        item => item.getAttribute('href') === contentURI
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
    }
  
  /**
 * Maps chapter boundaries by analyzing navigation and spine structure
 * @returns Map of chapter start IDs to arrays of related content IDs
 */
private getChapterBoundaries(): Map<string, string[]> {
  const boundaries = new Map<string, string[]>();
  
  if (!this.spine || !this.ncx) return boundaries;

  // Get all spine items for sequential analysis
  const spineItems = Array.from(this.spine.getElementsByTagName('itemref'))
    .map(item => item.getAttribute('idref'))
    .filter((id): id is string => id !== null);

  // Get chapter start points from NCX
  const navPoints = Array.from(this.ncx.getElementsByTagName('navPoint'));
  
  for (let i = 0; i < navPoints.length; i++) {
    const contentElement = navPoints[i].getElementsByTagName('content')[0];
    if (!contentElement) continue;

    const chapterSrc = contentElement.getAttribute('src');
    if (!chapterSrc) continue;

    // Find corresponding manifest item for this chapter
    const manifestItem = Array.from(this.manifest!.getElementsByTagName('item'))
      .find(item => {
        const href = item.getAttribute('href');
        return href && (href === chapterSrc || chapterSrc.includes(href));
      });
    
    if (!manifestItem) continue;
    
    const chapterId = manifestItem.getAttribute('id');
    if (!chapterId) continue;

    // Find position in spine
    const spineIndex = spineItems.indexOf(chapterId);
    if (spineIndex === -1) continue;

    // Determine chapter boundary
    let endIndex: number;
    if (i < navPoints.length - 1) {
      // Find start of next chapter
      const nextContent = navPoints[i + 1].getElementsByTagName('content')[0];
      if (nextContent) {
        const nextSrc = nextContent.getAttribute('src');
        if (nextSrc) {
          const nextItem = Array.from(this.manifest!.getElementsByTagName('item'))
            .find(item => {
              const href = item.getAttribute('href');
              return href && (href === nextSrc || nextSrc.includes(href));
            });
          
          if (nextItem) {
            const nextId = nextItem.getAttribute('id');
            if (nextId) {
              endIndex = spineItems.indexOf(nextId);
            } else {
              endIndex = spineItems.length;
            }
          } else {
            endIndex = spineItems.length;
          }
        } else {
          endIndex = spineItems.length;
        }
      } else {
        endIndex = spineItems.length;
      }
    } else {
      // Last chapter - include everything until the end
      endIndex = spineItems.length;
    }

    // Store all spine items between chapter start and next chapter start
    boundaries.set(
      chapterId,
      spineItems.slice(spineIndex, endIndex)
    );
  }
  log("Boundaries",boundaries);
  return boundaries;
}

/**
 * Removes a content element and all its related split parts
 * @private
 * @param identifier String ID or numeric index of the element to remove
 */
private async _removeContentElementWithSplits(identifier: string | number): Promise<void> {
  const content = typeof identifier === 'number'
    ? this.contents[identifier]
    : this.contents.find(c => c.id === identifier);

  if (!content || !content.href) {
    throw new Error('Content element not found');
  }

  // Get chapter boundaries
  const boundaries = this.getChapterBoundaries();
  
  // Find manifest item for this content
  const manifestItem = Array.from(this.manifest!.getElementsByTagName('item'))
    .find(item => {
      const href = item.getAttribute('href');
      return href && (href === content.href || content.href.includes(href));
    });

  if (!manifestItem) return;
  
  const contentId = manifestItem.getAttribute('id');
  if (!contentId) return;

  // Get all related content IDs
  const relatedIds = boundaries.get(contentId) || [contentId];

  // Remove all related content
  for (const id of relatedIds) {
    const item = Array.from(this.manifest!.getElementsByTagName('item'))
      .find(item => item.getAttribute('id') === id);
    
    if (item) {
      const href = item.getAttribute('href');
      if (href) {
        // Remove from zip
        const contentPath = this.path.join(this.path.dirname(this.contentPath), href);
        this.zip.remove(contentPath);
      }

      // Remove from manifest
      if (item.parentNode) {
        item.parentNode.removeChild(item);
      }

      // Remove from spine
      const spineItem = Array.from(this.spine!.getElementsByTagName('itemref'))
        .find(spineItem => spineItem.getAttribute('idref') === id);
      
      if (spineItem?.parentNode) {
        spineItem.parentNode.removeChild(spineItem);
      }
    }
  }

  // Remove from navigation documents
  this.removeFromNavigation(content.href);

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
}

async removeContentElement(identifier: string | number): Promise<void> {
  await this._removeContentElementWithSplits(identifier);
  await this.buildContentsList();
}

async removeContents(identifiers: (string | number)[]): Promise<void> {
  for (const identifier of identifiers) {
    await this._removeContentElementWithSplits(identifier);
  }
  await this.buildContentsList();
}
  

    /**
     * Finds a content element by its index in the EPUB
     * @private
     * @param index Index to search for
     * @param elements Array of content elements to search through
     * @returns Found ContentElement or null if not found
     */
    private findContentElementByIndex(index: number, elements: ContentElement[] = this.contents): ContentElement | null {
      for (const element of elements) {
        if (element.index === index) {
          return element;
        }
        if (element.children) {
          const found = this.findContentElementByIndex(index, element.children);
          if (found) {
            return found;
          }
        }
      }
      return null;
    }

    /**
     * Removes all content elements except specified ones
     * @param keep Array of indices or IDs of elements to preserve
     * @throws {Error} If specified elements are not found
     */
    async removeExcept(keep: (string | number)[]): Promise<void> {
      // Convert all number indices to their corresponding IDs
      const idsToKeep = new Set(
        keep.map(identifier => {
          if (typeof identifier === 'number') {
            const element = this.findContentElementByIndex(identifier);
            if (!element) {
              throw new Error(`Element with index ${identifier} not found`);
            }
            return element.id;
          }
          return identifier;
        })
      );

      // Get all content IDs
      const allIds = new Set(
        this.contents.map(element => element.id)
      );

      // Get IDs to remove
      const idsToRemove = Array.from(allIds).filter(id => !idsToKeep.has(id));

      // Remove elements in reverse order to maintain correct indices
      for (let i = idsToRemove.length - 1; i >= 0; i--) {
        //await this._removeContentElement(idsToRemove[i]);
        await this._removeContentElementWithSplits(idsToRemove[i]);
      }
      // Update contents list
      await this.buildContentsList();
    }

    /**
     * Removes all content elements that don't match the filter function
     * @param filterFn Function that returns true for elements to keep
     */
    async removeExceptWhere(filterFn: (element: ContentElement) => boolean): Promise<void> {
      // Find all elements that don't match the filter
      const elementsToRemove = this.contents.filter(element => !filterFn(element));

      // Remove elements in reverse order to maintain correct indices
      for (let i = elementsToRemove.length - 1; i >= 0; i--) {
        await this._removeContentElement(elementsToRemove[i].id);
      }
      // Update contents list
      await this.buildContentsList();
    }

  /**
   * Retrieves content from specified elements or all elements in the EPUB
   * @param identifiers Optional array of element IDs or indices to retrieve
   * @param merge Optional boolean to merge all content into a single string
   * @returns Promise resolving to either a Map of ID => content or merged content string
   * @throws {Error} If EPUB is not loaded or specified elements are not found
   */
  async getContents(
    identifiers?: (string | number)[],
    merge: boolean = false
  ): Promise<Map<string, string> | string> {
    if (!this.manifest || !this.spine) {
      throw new Error('EPUB not loaded');
    }

    // Initialize Turndown once for all conversions
    const turndownService = new TurndownService({
      headingStyle: 'atx',
      hr: '---',
      bulletListMarker: '*',
      codeBlockStyle: 'fenced'
    });

    // Convert all numeric indices to IDs
    const contentIds = identifiers?.map(identifier => {
      if (typeof identifier === 'number') {
        const element = this.findContentElementByIndex(identifier);
        if (!element) {
          throw new Error(`Element with index ${identifier} not found`);
        }
        return element.id;
      }
      return identifier;
    });

    // If no identifiers provided, get all content IDs
    const idsToRetrieve = contentIds || this.contents.map(element => element.id);

    // Create a map to store content
    const contentMap = new Map<string, string>();

    // Helper function to extract and convert body content
    const extractAndConvert = (html: string): string => {
      // Extract body content
      const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      if (!bodyMatch) return '';
      
      // Convert body content to Markdown
      return turndownService.turndown(bodyMatch[1]);
    };

    // Process each content file
    for (const id of idsToRetrieve) {
      const content = this.contents.find(element => element.id === id);
      if (!content) {
        throw new Error(`Content element with ID ${id} not found`);
      }

      const contentPath = this.path.join(
        this.path.dirname(this.contentPath),
        content.href.split('#')[0]
      );

      const contentFile = this.zip.file(contentPath);
      if (!contentFile) {
        throw new Error(`Content file not found: ${contentPath}`);
      }

      const htmlContent = await contentFile.async('string');
      contentMap.set(id, extractAndConvert(htmlContent));
    }

    // Return either merged content or the content map
    if (merge) {
      return Array.from(contentMap.values()).join('\n\n---\n\n');
    }

    return contentMap;
  }

    /**
     * Normalizes whitespace in XML elements recursively
     * @private
     * @param element XML element to process
     */
    private normalizeWhitespace(element: XMLElement): void {
      const children = Array.from(element.childNodes);
      
      for (const child of children) {
        if (child.nodeType === 3) { // Text node
          if (!child.textContent?.trim()) {
            element.removeChild(child);
          } else {
            child.textContent = child.textContent.replace(/\s+/g, ' ').trim();
          }
        } else if (child.nodeType === 1) { // Element node
          this.normalizeWhitespace(child as XMLElement);
        }
      }
    }

    /**
     * Updates the EPUB metadata with current information
     * @private
     */
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

  
    /**
     * Resets playOrder attributes in NCX document to ensure they are continuous
     * @protected
     */
    protected resetNcxPlayOrder(): void {
      if (!this.ncx) return;

      const navMap = this.ncx.getElementsByTagName('navMap')[0];
      if (!navMap) return;

      const navPoints = navMap.getElementsByTagName('navPoint');
      // Only proceed if playOrder is being used
      if (navPoints[0]?.getAttribute('playOrder')) {
        Array.from(navPoints).forEach((navPoint, index) => {
          navPoint.setAttribute('playOrder', (index + 1).toString());
        });
      }
    }
  
  
    /**
     * Prepares EPUB content for output by updating all necessary files
     * @protected
     * @throws {Error} If EPUB structure is invalid
     */
    protected async prepareOutput(): Promise<void> {
      if (!this.manifest || !this.spine) {
        throw new Error('Invalid EPUB structure');
      }

      // Update metadata
      this.updateMetadata();

      // Remove ophaned media items
      await this.removeOrphanedMedia()

      // Fix any broken links
      await this.fixBrokenLinks();

      const serializer = new XMLSerializer();
      const compressionOptions = {
        compression: 'DEFLATE' as const,
        compressionOptions: {
          level: 9
        }
      };

      /**
       * Helper function to format and save XML content
       * @param doc XML document to save
       * @param path Path in the EPUB where the file should be saved
       * @param options Compression options
       */
      const saveXmlContent = (
        doc: XMLDocument,
        path: string,
        options = compressionOptions
      ) => {
        this.normalizeWhitespace(doc.documentElement);
        const content = format(
          serializer.serializeToString(doc.documentElement as unknown as Node),
          { indentation: '  ', collapseContent: true }
        );
        this.zip.file(path, content, options);
      };

      // Update content.opf
      saveXmlContent(
        this.manifest.ownerDocument as XMLDocument,
        this.contentPath
      );

      // Update navigation document if it exists
      if (this.navigation) {
        const navItem = Array.from(this.manifest.getElementsByTagName('item'))
          .find(item => item.getAttribute('properties')?.includes('nav'));
        
        if (navItem) {
          const href = navItem.getAttribute('href');
          if (href) {
            const navPath = this.path.join(
              this.path.dirname(this.contentPath),
              href
            );
            saveXmlContent(this.navigation as XMLDocument, navPath);
          }
        }
      }

      // Update NCX if it exists
      if (this.ncx) {
        const ncxItem = Array.from(this.manifest.getElementsByTagName('item'))
          .find(item => item.getAttribute('media-type') === 'application/x-dtbncx+xml');
        
        if (ncxItem) {
          const href = ncxItem.getAttribute('href');
          if (href) {
            this.resetNcxPlayOrder(); // Reset playOrder values before saving
            const ncxPath = this.path.join(
              this.path.dirname(this.contentPath),
              href
            );
            saveXmlContent(this.ncx as XMLDocument, ncxPath);
          }
        }
      }

    }

    /**
     * Gets the EPUB content in various formats
     * @param type Output format ('blob', 'arraybuffer', 'uint8array', or 'base64')
     * @returns Promise resolving to the EPUB content in the specified format
     */
    async getOutput(type: 'blob' | 'arraybuffer' | 'uint8array' | 'base64' = 'blob'): Promise<any> {
      await this.prepareOutput();
      return await this.zip.generateAsync({ type });
    }

    /**
     * Path utility functions to handle file paths consistently across platforms
     * @private
     */
    private path = {
      /**
       * Joins path segments, handling leading/trailing slashes
       */
      join(...parts: string[]): string {
        return parts
          .map(part => part.replace(/^\/+|\/+$/g, '')) // Remove leading/trailing slashes
          .filter(part => part.length > 0)  // Remove empty parts
          .join('/');
      },

      /**
       * Gets the directory name from a file path
       */
      dirname(filePath: string): string {
        const parts = filePath.split('/');
        parts.pop();
        return parts.join('/');
      }
    }

    /**
     * Generates a unique identifier for new content elements
     * @private
     * @param prefix Prefix for the generated ID
     * @returns Unique identifier string
     */
    private generateUniqueId(prefix: string = 'content'): string {
      const timestamp = new Date().getTime();
      const random = Math.floor(Math.random() * 10000);
      return `${prefix}-${timestamp}-${random}`;
    }

    /**
     * Creates a complete XHTML document wrapper for content
     * @private
     * @param content HTML content to wrap
     * @param title Optional title for the document
     * @param css Optional CSS styles to include
     * @returns Complete XHTML document as string
     */
    private createXhtmlWrapper(content: string, title?: string, css?: string): string {
      return `<?xml version="1.0" encoding="utf-8"?>
              <!DOCTYPE html>
              <html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
              <head>
                  <title>${title || 'New Content'}</title>
                  ${css ? `<style type="text/css">${css}</style>` : ''}
              </head>
              <body>
                  ${content}
              </body>
              </html>`;
    }

  /**
   * Inserts new content at a specific index in the EPUB
   * @private
   * @param content HTML or Markdown content to insert
   * @param index Position where content should be inserted relative to the contents list
   * @param options Configuration options for the new content
   * @throws {Error} If EPUB is not loaded
   */
  private async insertContentAtIndex(content: string, index: number, options: ContentOptions = {}): Promise<void> {
    if (!this.manifest || !this.spine) {
      throw new Error('EPUB not loaded');
    }

    const doc = this.manifest.ownerDocument as XMLDocument;

    // Convert markdown if needed
    const htmlContent = options.type === 'md' ? this.md.render(content) : content;

    // Generate file name and ID
    const id = options.id || this.generateUniqueId();
    const fileName = `${id}.xhtml`;
    const filePath = this.path.join(this.path.dirname(this.contentPath), fileName);
    
    // Create full XHTML document
    const xhtmlContent = this.createXhtmlWrapper(htmlContent, options.title, options.css);

    // Add to ZIP
    this.zip.file(filePath, xhtmlContent);

    // Add to manifest
    const manifestItem = doc.createElement('item');
    manifestItem.setAttribute('id', id);
    manifestItem.setAttribute('href', fileName);
    manifestItem.setAttribute('media-type', 'application/xhtml+xml');
    this.manifest.appendChild(manifestItem);

    // Add to spine
    const spineItem = doc.createElement('itemref');
    spineItem.setAttribute('idref', id);
    
    // Find the correct position in spine based on the content list item at the given index
    const spineItems = Array.from(this.spine.getElementsByTagName('itemref'));
    
    if (this.contents && index < this.contents.length) {
      // Get the id from the reference content item
      const referenceContent = this.contents[index];
      const referenceHref = referenceContent.id;
      
      // Find corresponding manifest item
      const referenceManifestItem = Array.from(this.manifest.getElementsByTagName('item')).find(
        item => item.getAttribute('href')?.split('#')[0] === referenceHref
      );
      
      if (referenceManifestItem) {
        // Get the manifest item's ID
        const referenceId = referenceManifestItem.getAttribute('id');
        
        // Find the spine item with matching idref
        const referenceSpineIndex = spineItems.findIndex(
          item => item.getAttribute('idref') === referenceId
        );
        
        if (referenceSpineIndex !== -1) {
          this.spine.insertBefore(spineItem, spineItems[referenceSpineIndex]);
        } else {
          // Fallback: append to spine if reference not found
          this.spine.appendChild(spineItem);
        }
      } else {
        this.spine.appendChild(spineItem);
      }
    } else {
      this.spine.appendChild(spineItem);
    }

    // Add to navigation
    if (this.navigation) {
      const navDoc = this.navigation as XMLDocument;
      const navList = navDoc.getElementsByTagName('ol')[0];
      if (navList) {
        const li = navDoc.createElement('li');
        const a = navDoc.createElement('a');
        a.setAttribute('href', fileName);
        a.textContent = options.title || `Content ${id}`;
        li.appendChild(a);

        const navItems = navList.getElementsByTagName('li');
        if (index >= navItems.length) {
          navList.appendChild(li);
        } else {
          navList.insertBefore(li, navItems[index]);
        }
      }
    }

    // Update NCX if it exists
    if (this.ncx) {
      const ncxDoc = this.ncx as XMLDocument;
      const navMap = ncxDoc.getElementsByTagName('navMap')[0];
      if (navMap) {
        const navPoint = ncxDoc.createElement('navPoint');
        const navLabel = ncxDoc.createElement('navLabel');
        const text = ncxDoc.createElement('text');
        const contentElement = ncxDoc.createElement('content');

        // Add required id attribute to navPoint
        navPoint.setAttribute('id', id);
        navPoint.setAttribute('class', 'chapter'); // Optional but common in NCX

        text.textContent = options.title || `Content ${id}`;
        contentElement.setAttribute('src', fileName);

        navLabel.appendChild(text);
        navPoint.appendChild(navLabel);
        navPoint.appendChild(contentElement);

        // Add playOrder if it exists in other navPoints
        const existingNavPoints = navMap.getElementsByTagName('navPoint');
        if (existingNavPoints[0]?.getAttribute('playOrder')) {
          navPoint.setAttribute('playOrder', (index + 1).toString());
        }
        
        if (index >= existingNavPoints.length) {
          navMap.appendChild(navPoint);
        } else {
          navMap.insertBefore(navPoint, existingNavPoints[index]);
        }
      }
    }

    // Rebuild contents list
    await this.buildContentsList();
  }

   /**
    * Inserts new content at a specific position in the EPUB
    * @param content HTML or Markdown content to insert
    * @param at Index where content should be inserted
    * @param options Configuration options for the new content
    */
   async insertContent(content: string, at: number, options: ContentOptions = {}): Promise<void> {
     await this.insertContentAtIndex(content, at, options);
   }

   /**
    * Adds new content to the end of the EPUB
    * @param content HTML or Markdown content to append
    * @param options Configuration options for the new content
    */
   async appendContent(content: string, options: ContentOptions = {}): Promise<void> {
     const lastIndex = this.contents.length;
     await this.insertContentAtIndex(content, lastIndex, options);
   }

   /**
    * Adds new content to the beginning of the EPUB
    * @param content HTML or Markdown content to prepend
    * @param options Configuration options for the new content
    */
   async prependContent(content: string, options: ContentOptions = {}): Promise<void> {
     await this.insertContentAtIndex(content, 0, options);
   }

   /**
    * Retrieves complete metadata from the EPUB
    * @returns Object containing all metadata properties
    * @throws {Error} If EPUB is not loaded
    */
   getMetadata(): FullMetadata {
     if (!this.manifest?.ownerDocument) {
       throw new Error('EPUB not loaded');
     }

     const metadata: FullMetadata = {};
     const metadataElement = this.manifest.ownerDocument.getElementsByTagName('metadata')[0];
     if (!metadataElement) return metadata;

     /**
      * Processes a metadata element and its refinements
      * @param element Element to process
      * @returns Processed metadata property
      */
     const processElement = (element: XMLElement) => {
       const property: MetadataProperty = {
         value: element.textContent || ''
       };

       // Get element ID if exists
       const id = element.getAttribute('id');
       if (id) property.id = id;

       // Find refinements
       if (id) {
         const refinements = Array.from(metadataElement.getElementsByTagName('meta'))
           .filter(meta => meta.getAttribute('refines') === `#${id}`);

         if (refinements.length > 0) {
           property.refinements = {};
           refinements.forEach(refinement => {
             const prop = refinement.getAttribute('property');
             if (prop) {
               property.refinements![prop] = refinement.textContent || '';
             }
           });
         }
       }

       return property;
     };

     // Process DC elements
     const dcElements = Array.from(metadataElement.getElementsByTagName('*'))
       .filter(el => el.nodeName.startsWith('dc:'));

     dcElements.forEach(element => {
       const name = element.nodeName.replace('dc:', '');
       const property = processElement(element);

       if (metadata[name]) {
         if (Array.isArray(metadata[name])) {
           (metadata[name] as MetadataProperty[]).push(property);
         } else {
           metadata[name] = [metadata[name] as MetadataProperty, property];
         }
       } else {
         metadata[name] = property;
       }
     });

     // Process meta elements
     const metaElements = Array.from(metadataElement.getElementsByTagName('meta'))
       .filter(meta => !meta.getAttribute('refines'));

     metaElements.forEach(element => {
       const property = element.getAttribute('property');
       if (property) {
         metadata[property] = processElement(element);
       }
     });

     return metadata;
   }

   /**
    * Retrieves core metadata (commonly used properties) from the EPUB
    * @returns Object containing essential metadata properties
    */
   getCoreMetadata(): CoreMetadata {
     const metadata = this.getMetadata();
     
     /**
      * Helper function to get first value from a metadata property
      */
     const getFirstValue = (prop: MetadataProperty | MetadataProperty[] | undefined): string => {
       if (!prop) return '';
       return Array.isArray(prop) ? prop[0].value : prop.value;
     };

     const title = getFirstValue(metadata['title']);
     let subtitle: string | undefined;

     // Check for subtitle in refinements or separate element
     if (Array.isArray(metadata['title'])) {
       const subtitleEntry = (metadata['title'] as MetadataProperty[])
         .find(t => t.refinements?.['title-type'] === 'subtitle');
       if (subtitleEntry) {
         subtitle = subtitleEntry.value;
       }
     }

     // Get authors (only those with role 'aut' if specified)
     const authors: string[] = [];
     if (metadata['creator']) {
       const creators = Array.isArray(metadata['creator']) 
         ? metadata['creator'] 
         : [metadata['creator']];

       creators.forEach(creator => {
         if (!creator.refinements?.role || creator.refinements.role === 'aut') {
           authors.push(creator.value);
         }
       });
     }

     return {
       title,
       ...(subtitle && { subtitle }),
       authors,
       language: getFirstValue(metadata['language']),
       identifier: getFirstValue(metadata['identifier']),
       publisher: getFirstValue(metadata['publisher']) || null,
       date: (getFirstValue(metadata['date']) || getFirstValue(metadata['dcterms:modified']) || null)
     };
   }


/**
 * Gets the manifest item for the cover image
 * @private
 * @returns Manifest item for cover image or null if not found
 */
private getCoverItem(): XMLElement | null {
  if (!this.manifest?.ownerDocument) {
    return null;
  }

  let coverItem: XMLElement | null = null;

  // Method 1: Look for meta element with name="cover"
  const metadata = this.manifest.ownerDocument.getElementsByTagName('metadata')[0];
  if (metadata) {
    const metaElements = metadata.getElementsByTagName('meta');
    for (const meta of Array.from(metaElements)) {
      if (meta.getAttribute('name') === 'cover') {
        const coverId = meta.getAttribute('content');
        if (coverId) {
          const items = this.manifest.getElementsByTagName('item');
          for (const item of Array.from(items)) {
            if (item.getAttribute('id') === coverId) {
              coverItem = item;
              break;
            }
          }
        }
        break;
      }
    }
  }

  // Method 2: Look for item with properties="cover-image"
  if (!coverItem) {
    const items = this.manifest.getElementsByTagName('item');
    for (const item of Array.from(items)) {
      if (item.getAttribute('properties') === 'cover-image') {
        coverItem = item;
        break;
      }
    }
  }

  // Method 3: Look in guide
  if (!coverItem) {
    const guide = this.manifest.ownerDocument.getElementsByTagName('guide')[0];
    if (guide) {
      const references = guide.getElementsByTagName('reference');
      for (const ref of Array.from(references)) {
        if (ref.getAttribute('type') === 'cover') {
          const href = ref.getAttribute('href');
          if (href) {
            const items = this.manifest.getElementsByTagName('item');
            for (const item of Array.from(items)) {
              if (item.getAttribute('href') === href) {
                coverItem = item;
                break;
              }
            }
          }
        }
      }
    }
  }

  return coverItem;
}

/**
 * Gets cover image data from the EPUB
 * @returns Promise resolving to cover image data or null if no cover is found
 */
async getCover(): Promise<CoverImage | null> {
  const coverItem = this.getCoverItem();
  
  if (coverItem) {
    const href = coverItem.getAttribute('href');
    const mediaType = coverItem.getAttribute('media-type');
    
    if (href && mediaType) {
      const coverPath = this.path.join(this.path.dirname(this.contentPath), href);
      const coverFile = this.zip.file(coverPath);
      
      if (coverFile) {
        const data = await coverFile.async('nodebuffer');
        return {
          data,
          mediaType,
          href
        };
      }
    }
  }

  return null;
}
  
/**
 * Finds and optionally removes orphaned media items from the EPUB
 * @param remove Whether to remove the orphaned items (default: false)
 * @returns Array of orphaned media item IDs
 */
async findOrphanedMedia(remove: boolean = false): Promise<string[]> {
  if (!this.manifest) {
    throw new Error('EPUB not loaded');
  }

  // Get cover item to exclude from orphan check
  const coverItem = this.getCoverItem();
  const coverId = coverItem?.getAttribute('id');

  // Get all media items from manifest
  const mediaItems = Array.from(this.manifest.getElementsByTagName('item'))
    .filter(item => {
      const mediaType = item.getAttribute('media-type');
      const id = item.getAttribute('id');
      return mediaType && 
             (mediaType.startsWith('image/') ||
              mediaType.startsWith('audio/') ||
              mediaType.startsWith('video/')) &&
             id !== coverId; // Exclude cover image
    });

  // Create a map of media items for quick lookup
  const mediaMap = new Map<string, {
    id: string;
    href: string;
    referenced: boolean;
  }>();

  mediaItems.forEach(item => {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (id && href) {
      mediaMap.set(id, {
        id,
        href,
        referenced: false
      });
    }
  });

  // Helper to normalize paths for comparison
  const normalizePath = (path: string): string => {
    return path.replace(/^\.?\/+/, '').replace(/\\/g, '/');
  };

  // Get all content files from manifest
  const contentItems = Array.from(this.manifest.getElementsByTagName('item'))
    .filter(item => {
      const mediaType = item.getAttribute('media-type');
      return mediaType === 'application/xhtml+xml' ||
             mediaType === 'application/x-dtbncx+xml' ||
             mediaType === 'text/css';
    });

  // Scan each content file for media references
  for (const item of contentItems) {
    const href = item.getAttribute('href');
    if (!href) continue;

    const contentPath = this.path.join(this.path.dirname(this.contentPath), href);
    const contentFile = this.zip.file(contentPath);
    if (!contentFile) continue;

    const content = await contentFile.async('string');

    // Check for media references in various formats
    mediaMap.forEach((media, id) => {
      // Normalize paths for comparison
      const mediaPath = normalizePath(media.href);
      const relativePath = normalizePath(this.path.join(this.path.dirname(href), mediaPath));
      const absolutePath = normalizePath(mediaPath);

      // Common reference patterns
      const patterns = [
        mediaPath,
        relativePath,
        absolutePath,
        `#${id}`,                    // Fragment identifier
        `="${id}"`,                  // Direct ID reference
        `='${id}'`,                  // Single-quoted ID reference
        `url\\(['"]{0,1}${mediaPath}['"]{0,1}\\)`, // CSS url() function
        `xlink:href=['"]{1}${mediaPath}['"]{1}`,   // SVG xlink:href
      ];

      // Check each pattern
      if (patterns.some(pattern => {
        const regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        return regex.test(content);
      })) {
        media.referenced = true;
      }
    });
  }

  // Collect orphaned items
  const orphanedItems = Array.from(mediaMap.values())
    .filter(item => !item.referenced);

  // Remove orphaned items if requested
  if (remove && orphanedItems.length > 0) {
    for (const orphan of orphanedItems) {
      const item = Array.from(this.manifest!.getElementsByTagName('item'))
        .find(item => item.getAttribute('id') === orphan.id);
      
      if (item) {
        const href = item.getAttribute('href');
        if (href) {
          // Remove from zip
          const contentPath = this.path.join(this.path.dirname(this.contentPath), href);
          this.zip.remove(contentPath);
        }
  
        // Remove from manifest
        if (item.parentNode) {
          item.parentNode.removeChild(item);
        }
      }
    }
  }

  return orphanedItems.map(item => item.id);
}
  
/**
 * Removes all orphaned media items from the EPUB
 * @returns Number of items removed
 */
async removeOrphanedMedia(): Promise<number> {
  const orphanedItems = await this.findOrphanedMedia(true);
  return orphanedItems.length;
}
  
  /**
 * Updates broken links in content files after content removal
 * @private
 */
private async fixBrokenLinks(): Promise<void> {
  if (!this.manifest) {
    throw new Error('EPUB not loaded');
  }

  // Get all valid content hrefs from manifest
  const validHrefs = new Set<string>(
    Array.from(this.manifest.getElementsByTagName('item'))
      .map(item => item.getAttribute('href'))
      .filter((href): href is string => href !== null)
      .map(href => this.path.join(this.path.dirname(this.contentPath), href))
  );

  // Get all content documents that might contain links
  const contentItems = Array.from(this.manifest.getElementsByTagName('item'))
    .filter(item => {
      const mediaType = item.getAttribute('media-type');
      return mediaType === 'application/xhtml+xml' || 
             mediaType === 'text/html';
    });

  const parser = new DOMParser();
  const serializer = new XMLSerializer();

  for (const item of contentItems) {
    const href = item.getAttribute('href');
    if (!href) continue;

    const contentPath = this.path.join(this.path.dirname(this.contentPath), href);
    const contentFile = this.zip.file(contentPath);
    if (!contentFile) continue;

    const content = await contentFile.async('string');
    const doc = parser.parseFromString(content, 'application/xhtml+xml');

    let hasChanges = false;

    // Check all elements with href attributes
    const elementsWithHrefs = Array.from(doc.getElementsByTagName('*'))
      .filter(el => el.hasAttribute('href'));

    for (const element of elementsWithHrefs) {
      const linkHref = element.getAttribute('href');
      if (!linkHref || linkHref === '#' || linkHref.startsWith('http')) continue;

      // Resolve the link relative to the current document
      const resolvedHref = this.path.join(
        this.path.dirname(contentPath),
        linkHref.split('#')[0]
      );

      // If the target doesn't exist in manifest, replace with #
      if (!validHrefs.has(resolvedHref)) {
        element.setAttribute('href', '#');
        hasChanges = true;
      }
    }

    // If we made changes, save the updated content
    if (hasChanges) {
      const updatedContent = serializer.serializeToString(doc);
      this.zip.file(contentPath, updatedContent);
    }
  }
}
  
  /**
 * Adds or updates an asset file in the EPUB
 * @param path Path where the asset should be stored in the EPUB
 * @param data File content as string or binary data
 * @throws {Error} If EPUB is not loaded or path is invalid
 */
async insertAsset(path: string, data: string | FileData): Promise<void> {
  if (!this.manifest) {
    throw new Error('EPUB not loaded');
  }

  // Normalize path to use forward slashes and remove leading slash
  const normalizedPath = path.replace(/\\/g, '/').replace(/^\/+/, '');

  // Get prefix for ID generation based on file type
  const prefix = normalizedPath.split('/').pop()?.split('.')[0] || 'item';

  // Generate a unique ID for the manifest
  const id = this.generateUniqueId(prefix);

  // Determine media type
  const mediaType = this.getMediaType(normalizedPath);

  // Add or update the file in the zip
  const fullPath = this.path.join(this.path.dirname(this.contentPath), normalizedPath);

  if (typeof data === 'string') {
    // String data (e.g., CSS, SVG)
    this.zip.file(fullPath, data);
  } else {
    // Binary data
    if (data instanceof Blob) {
      // Convert Blob to ArrayBuffer
      data = await data.arrayBuffer();
    }
    this.zip.file(fullPath, data);
  }

  // Update manifest
  const existingItem = Array.from(this.manifest.getElementsByTagName('item'))
    .find(item => item.getAttribute('href') === normalizedPath);

  if (existingItem) {
    // Update existing item
    existingItem.setAttribute('media-type', mediaType);
  } else {
    // Add new item to manifest
    const doc = this.manifest.ownerDocument as XMLDocument;
    const item = doc.createElement('item');
    item.setAttribute('id', id);
    item.setAttribute('href', normalizedPath);
    item.setAttribute('media-type', mediaType);
    this.manifest.appendChild(item);
  }
}
  
  /**
 * Retrieves an asset file from the EPUB by its href
 * @param href Path or identifier of the asset to retrieve
 * @returns Promise resolving to an object containing the asset data and metadata
 * @throws {Error} If the asset is not found or EPUB is not loaded
 */
async getAsset(href: string): Promise<{
  data: Buffer | ArrayBuffer;
  mediaType: string;
  href: string;
  id?: string;
}> {
  if (!this.manifest) {
    throw new Error('EPUB not loaded');
  }

  // Normalize href to handle fragment identifiers and relative paths
  const normalizedHref = href.split('#')[0];
  const resolvedHref = this.path.join(this.path.dirname(this.contentPath), normalizedHref);

  // Try to find the asset in the manifest
  const manifestItem = Array.from(this.manifest.getElementsByTagName('item'))
    .find(item => {
      const itemHref = item.getAttribute('href');
      if (!itemHref) return false;

      // Compare both original and resolved paths
      const itemPath = this.path.join(this.path.dirname(this.contentPath), itemHref);
      return itemHref === normalizedHref || 
             itemPath === resolvedHref ||
             itemHref.endsWith(normalizedHref);
    });

  if (!manifestItem) {
    throw new Error(`Asset not found: ${href}`);
  }

  const assetHref = manifestItem.getAttribute('href');
  const mediaType = manifestItem.getAttribute('media-type');
  const id = manifestItem.getAttribute('id');

  if (!assetHref || !mediaType) {
    throw new Error(`Invalid asset entry in manifest: ${href}`);
  }

  // Get the asset from the zip
  const assetPath = this.path.join(this.path.dirname(this.contentPath), assetHref);
  const assetFile = this.zip.file(assetPath);

  if (!assetFile) {
    throw new Error(`Asset file not found in EPUB: ${assetPath}`);
  }

  // Get the asset data
  const data = await assetFile.async('nodebuffer');

  return {
    data,
    mediaType,
    href: assetHref,
    ...(id && { id })
  };
}
  
  /**
 * Determines the media type based on file extension
 * @private
 * @param path File path
 * @returns MIME type string
 */
private getMediaType(path: string): string {
  const ext = path.toLowerCase().split('.').pop() || '';
  const mediaTypes: { [key: string]: string } = {
    // Images
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'svg': 'image/svg+xml',
    'webp': 'image/webp',
    
    // Stylesheets
    'css': 'text/css',
    
    // Fonts
    'ttf': 'font/ttf',
    'otf': 'font/otf',
    'woff': 'font/woff',
    'woff2': 'font/woff2',
    
    // Audio
    'mp3': 'audio/mpeg',
    'aac': 'audio/aac',
    'wav': 'audio/wav',
    
    // Video
    'mp4': 'video/mp4',
    'webm': 'video/webm',
    
    // Documents
    'xhtml': 'application/xhtml+xml',
    'html': 'application/xhtml+xml',
    'xml': 'application/xml',
    
    // Default
    'bin': 'application/octet-stream'
  };

  return mediaTypes[ext] || mediaTypes['bin'];
}
  
}

export default RePub;