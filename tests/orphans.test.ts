import { RePub } from '../src/core';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import JSZip from 'jszip';

describe('RePub Media Handling', () => {
  let epub: RePub;
  let zip: JSZip;

  beforeEach(async () => {
    epub = new RePub();
    zip = new JSZip();

    // Create a basic EPUB structure
    const container = `<?xml version="1.0" encoding="UTF-8"?>
      <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
        <rootfiles>
          <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
        </rootfiles>
      </container>`;

    const contentOpf = `<?xml version="1.0" encoding="utf-8"?>
      <package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uuid_id" version="2.0">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
          <dc:title>Test Book</dc:title>
          <meta name="cover" content="cover-image"/>
        </metadata>
        <manifest>
          <item id="cover-image" href="images/cover.jpg" media-type="image/jpeg"/>
          <item id="image1" href="images/image1.jpg" media-type="image/jpeg"/>
          <item id="image2" href="images/image2.jpg" media-type="image/jpeg"/>
          <item id="orphaned" href="images/orphaned.jpg" media-type="image/jpeg"/>
          <item id="content1" href="text/chapter1.xhtml" media-type="application/xhtml+xml"/>
          <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
          <item id="css" href="styles.css" media-type="text/css"/>
        </manifest>
        <spine toc="ncx">
          <itemref idref="content1"/>
        </spine>
        <guide>
          <reference type="cover" href="text/cover.xhtml"/>
        </guide>
      </package>`;

    const chapter1 = `<?xml version="1.0" encoding="utf-8"?>
      <html xmlns="http://www.w3.org/1999/xhtml">
        <head><title>Chapter 1</title></head>
        <body>
          <img src="../images/image1.jpg" alt="Image 1"/>
          <div style="background-image: url('../images/image2.jpg')"></div>
        </body>
      </html>`;

    const css = `
      .header {
        background-image: url(images/image2.jpg);
      }`;

    // Add files to zip
    zip.file('META-INF/container.xml', container);
    zip.file('OEBPS/content.opf', contentOpf);
    zip.file('OEBPS/text/chapter1.xhtml', chapter1);
    zip.file('OEBPS/styles.css', css);
    
    // Add binary files (mock images)
    const dummyImage = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]); // Minimal JPEG header
    zip.file('OEBPS/images/cover.jpg', dummyImage);
    zip.file('OEBPS/images/image1.jpg', dummyImage);
    zip.file('OEBPS/images/image2.jpg', dummyImage);
    zip.file('OEBPS/images/orphaned.jpg', dummyImage);

    // Load the EPUB
    const epubData = await zip.generateAsync({ type: 'nodebuffer' });
    await epub.load(epubData);
  });

  describe('getCover', () => {
    it('should correctly identify and return cover image', async () => {
      const cover = await epub.getCover();
      
      expect(cover).not.toBeNull();
      expect(cover!.href).toBe('images/cover.jpg');
      expect(cover!.mediaType).toBe('image/jpeg');
      expect(cover!.data).toBeInstanceOf(Buffer);
    });

    it('should find cover image using properties attribute', async () => {
      // Modify the manifest to use properties instead of metadata
      const doc = epub['manifest']!.ownerDocument!;
      const metadata = doc.getElementsByTagName('metadata')[0];
      const meta = metadata.getElementsByTagName('meta')[0];
      metadata.removeChild(meta);

      const coverItem = Array.from(epub['manifest']!.getElementsByTagName('item'))
        .find(item => item.getAttribute('id') === 'cover-image');
      coverItem!.setAttribute('properties', 'cover-image');

      const cover = await epub.getCover();
      expect(cover).not.toBeNull();
      expect(cover!.href).toBe('images/cover.jpg');
    });

    it('should find cover image using guide reference', async () => {
      // Remove other cover indicators and modify guide
      const doc = epub['manifest']!.ownerDocument!;
      const metadata = doc.getElementsByTagName('metadata')[0];
      const meta = metadata.getElementsByTagName('meta')[0];
      metadata.removeChild(meta);

      const guide = doc.getElementsByTagName('guide')[0];
      const reference = guide.getElementsByTagName('reference')[0];
      reference.setAttribute('href', 'images/cover.jpg');

      const cover = await epub.getCover();
      expect(cover).not.toBeNull();
      expect(cover!.href).toBe('images/cover.jpg');
    });

    it('should return null when no cover image is found', async () => {
      // Remove all cover indicators
      const doc = epub['manifest']!.ownerDocument!;
      const metadata = doc.getElementsByTagName('metadata')[0];
      const meta = metadata.getElementsByTagName('meta')[0];
      metadata.removeChild(meta);

      const items = epub['manifest']!.getElementsByTagName('item');
      for (const item of Array.from(items)) {
        item.removeAttribute('properties');
      }

      const guide = doc.getElementsByTagName('guide')[0];
      guide.parentNode!.removeChild(guide);

      const cover = await epub.getCover();
      expect(cover).toBeNull();
    });
  });

  describe('findOrphanedMedia', () => {
    it('should identify orphaned media files', async () => {
      const orphaned = await epub.findOrphanedMedia(false);
      expect(orphaned).toEqual(['orphaned']);
    });

    it('should not identify cover image as orphaned', async () => {
      const orphaned = await epub.findOrphanedMedia(false);
      expect(orphaned).not.toContain('cover-image');
    });

    it('should identify media referenced in CSS', async () => {
      const orphaned = await epub.findOrphanedMedia(false);
      expect(orphaned).not.toContain('image2');
    });

    it('should identify media referenced in HTML', async () => {
      const orphaned = await epub.findOrphanedMedia(false);
      expect(orphaned).not.toContain('image1');
    });

    it('should remove orphaned files when remove flag is true', async () => {
      await epub.findOrphanedMedia(true);
      
      // Check if file was removed from zip
      expect(epub['zip'].file('OEBPS/images/orphaned.jpg')).toBeNull();
      
      // Check if item was removed from manifest
      const items = Array.from(epub['manifest']!.getElementsByTagName('item'));
      const orphanedItem = items.find(item => item.getAttribute('id') === 'orphaned');
      expect(orphanedItem).toBeUndefined();
    });
  });

  describe('removeOrphanedMedia', () => {
    it('should remove all orphaned media files', async () => {
      const removedCount = await epub.removeOrphanedMedia();
      expect(removedCount).toBe(1);
      
      // Verify removal
      const items = Array.from(epub['manifest']!.getElementsByTagName('item'));
      const mediaItems = items.filter(item => {
        const mediaType = item.getAttribute('media-type');
        return mediaType && (
          mediaType.startsWith('image/') ||
          mediaType.startsWith('audio/') ||
          mediaType.startsWith('video/')
        );
      });

      // Should only have cover and referenced images remaining
      expect(mediaItems.length).toBe(3);
      expect(mediaItems.map(item => item.getAttribute('id')))
        .toEqual(expect.arrayContaining(['cover-image', 'image1', 'image2']));
    });

    it('should not remove any files if no orphaned media exists', async () => {
      // Remove the orphaned file first
      await epub.removeOrphanedMedia();
      
      // Try removing again
      const removedCount = await epub.removeOrphanedMedia();
      expect(removedCount).toBe(0);
    });
  });
});