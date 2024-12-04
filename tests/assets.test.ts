import { RePub } from '../src/core';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import JSZip from 'jszip';
describe('Asset Handling', () => {
    let epub: RePub;
    
    beforeEach(async () => {
      epub = new RePub();
      
      // Create minimal EPUB structure
      const zip = new JSZip();
      
      const container = `<?xml version="1.0" encoding="UTF-8"?>
        <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
          <rootfiles>
            <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
          </rootfiles>
        </container>`;
  
      const contentOpf = `<?xml version="1.0" encoding="utf-8"?>
        <package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uuid_id" version="2.0">
          <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
            <dc:title>Test Book</dc:title>
          </metadata>
          <manifest>
            <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
            <item id="css" href="style.css" media-type="text/css"/>
          </manifest>
          <spine toc="ncx"/>
        </package>`;
  
      const ncx = `<?xml version="1.0" encoding="utf-8"?>
        <ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
          <head>
            <meta name="dtb:uid" content="123"/>
            <meta name="dtb:depth" content="1"/>
            <meta name="dtb:totalPageCount" content="0"/>
            <meta name="dtb:maxPageNumber" content="0"/>
          </head>
          <docTitle><text>Test Book</text></docTitle>
          <navMap/>
        </ncx>`;
  
      zip.file('META-INF/container.xml', container);
      zip.file('OEBPS/content.opf', contentOpf);
      zip.file('OEBPS/toc.ncx', ncx);
      zip.file('OEBPS/style.css', '/* Initial CSS */');
  
      const epubData = await zip.generateAsync({ type: 'arraybuffer' });
      await epub.load(epubData);
    });
  
    it('should add new CSS file', async () => {
      const css = 'body { font-family: Arial; }';
      await epub.insertAsset('styles/new.css', css);
  
      const output = await epub.getOutput('arraybuffer');
      const outputZip = await JSZip.loadAsync(output);
  
      // Check if file was added
      const cssFile = await outputZip.file('OEBPS/styles/new.css')?.async('string');
      expect(cssFile).toBe(css);
  
      // Check manifest entry
      const manifest = outputZip.file('OEBPS/content.opf');
      const manifestContent = await manifest?.async('string');
      expect(manifestContent).toContain('href="styles/new.css"');
      expect(manifestContent).toContain('media-type="text/css"');
    });
  
    it('should update existing CSS file', async () => {
      const newCss = 'body { color: red; }';
      await epub.insertAsset('style.css', newCss);
  
      const output = await epub.getOutput('arraybuffer');
      const outputZip = await JSZip.loadAsync(output);
  
      // Check if file was updated
      const cssFile = await outputZip.file('OEBPS/style.css')?.async('string');
      expect(cssFile).toBe(newCss);
  
      // Check manifest hasn't duplicated the entry
      const manifest = outputZip.file('OEBPS/content.opf');
      const manifestContent = await manifest?.async('string');
      const cssCount = (manifestContent?.match(/media-type="text\/css"/g) || []).length;
      expect(cssCount).toBe(1);
    });
  
    it('should add image file', async () => {
      // Create a simple PNG-like buffer
      const imageData = new Uint8Array([0x89, 0x50, 0x4E, 0x47]); // PNG signature
      await epub.insertAsset('images/test.png', imageData);
  
      const output = await epub.getOutput('arraybuffer');
      const outputZip = await JSZip.loadAsync(output);
  
      // Check if file was added
      const imageFile = await outputZip.file('OEBPS/images/test.png')?.async('uint8array');
      expect(imageFile).toEqual(imageData);
  
      // Check manifest entry
      const manifest = outputZip.file('OEBPS/content.opf');
      const manifestContent = await manifest?.async('string');
      expect(manifestContent).toContain('href="images/test.png"');
      expect(manifestContent).toContain('media-type="image/png"');
    });
  
    it('should handle font files', async () => {
      const fontData = new ArrayBuffer(4); // Dummy font data
      await epub.insertAsset('fonts/test.woff2', fontData);
  
      const output = await epub.getOutput('arraybuffer');
      const outputZip = await JSZip.loadAsync(output);
  
      // Check manifest entry
      const manifest = outputZip.file('OEBPS/content.opf');
      const manifestContent = await manifest?.async('string');
      expect(manifestContent).toContain('href="fonts/test.woff2"');
      expect(manifestContent).toContain('media-type="font/woff2"');
    });
  
    it('should generate unique IDs for files with same names', async () => {
      await epub.insertAsset('images/test.jpg', new ArrayBuffer(4));
      await epub.insertAsset('other/test.jpg', new ArrayBuffer(4));
  
      const output = await epub.getOutput('arraybuffer');
      const outputZip = await JSZip.loadAsync(output);
      const manifest = outputZip.file('OEBPS/content.opf');
      const manifestContent = await manifest?.async('string');
  
      // Check that we have two different IDs
      const matches = manifestContent?.match(/id="([^"]+)"/g) || [];
      const ids = matches.map(m => m.match(/id="([^"]+)"/)?.[1]);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(matches.length);
    });
  });