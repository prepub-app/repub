import RePub from '../src/index.ts';
import fs from 'fs/promises';
import path from 'path';

describe('RePub Class Tests', () => {
  let epubData: Uint8Array;
  let repub: RePub;

  beforeAll(async () => {
    const epubPath = path.resolve(__dirname, 'fixtures', 'moby-dick.epub');
    epubData = await fs.readFile(epubPath);
  });

  beforeEach(async () => {
    repub = new RePub();
    await repub.load(epubData);
  });

  describe('Loading and Basic Structure', () => {
    test('should load an EPUB file', () => {
      const contents = repub.listContents();
      expect(contents.length).toBeGreaterThan(0);
    });

    test('should have correct content structure', () => {
      const contents = repub.listContents();
      const firstItem = contents[0];
      expect(firstItem).toHaveProperty('id');
      expect(firstItem).toHaveProperty('label');
      expect(firstItem).toHaveProperty('href');
      expect(firstItem).toHaveProperty('index');
    });
  });

  describe('Content Manipulation', () => {
    test('should remove content by index', async () => {
      const originalContents = repub.listContents();
      await repub.removeContentElement(1);
      const newContents = repub.listContents();
      expect(newContents.length).toBe(originalContents.length - 1);
      expect(newContents[1].id).not.toBe(originalContents[1].id);
    });

    test('should remove content by id', async () => {
      const contents = repub.listContents();
      const idToRemove = contents[1].id;
      await repub.removeContentElement(idToRemove);
      const newContents = repub.listContents();
      expect(newContents.find(c => c.id === idToRemove)).toBeUndefined();
    });

    test('should remove range of content', async () => {
      const originalContents = repub.listContents();
      await repub.removeContentRange('1..3');
      const newContents = repub.listContents();
      expect(newContents.length).toBe(originalContents.length - 3);
    });

    test('should remove everything except specified indices', async () => {
      await repub.removeExcept([0, 1]);
      const contents = repub.listContents();
      expect(contents.length).toBe(2);
      expect(contents[0].index).toBe(0);
      expect(contents[1].index).toBe(1);
    });

    test('should handle nested content removal correctly', async () => {
      const contents = repub.listContents();
      const parentWithChildren = contents.find(c => c.children && c.children?.length > 0);
      if (parentWithChildren) {
        await repub.removeContentElement(parentWithChildren.id);
        const newContents = repub.listContents();
        expect(newContents.find(c => c.id === parentWithChildren.id)).toBeUndefined();
        // Check that children are also removed
        parentWithChildren.children?.forEach(child => {
          expect(newContents.find(c => c.id === child.id)).toBeUndefined();
        });
      }
    });
  });

  describe('Content Insertion', () => {
    test('should insert HTML content', async () => {
      const originalLength = repub.listContents().length;
      await repub.insertContent('<h1>New Chapter</h1><p>Test content</p>', 1, {
        title: 'New Chapter'
      });
      const newContents = repub.listContents();
      expect(newContents.length).toBe(originalLength + 1);
      expect(newContents[1].label).toBe('New Chapter');
    });

    test('should insert Markdown content', async () => {
      await repub.insertContent('# New Chapter\n\nTest content', 1, {
        title: 'New Chapter',
        type: 'md'
      });
      const contents = repub.listContents();
      const insertedContent = contents[1];
      expect(insertedContent.label).toBe('New Chapter');
    });

    test('should insert content with CSS', async () => {
      const css = 'body { font-family: serif; } h1 { color: navy; }';
      await repub.insertContent('<h1>Styled Chapter</h1>', 1, {
        title: 'Styled Chapter',
        css
      });
      const output = await repub.getOutput('arraybuffer');
      expect(output).toBeDefined();
      // We could add more specific checks for CSS inclusion if needed
    });
  });

  describe('Metadata Operations', () => {
    test('should get core metadata', () => {
      const metadata = repub.getCoreMetadata();
      expect(metadata).toHaveProperty('title');
      expect(metadata).toHaveProperty('authors');
      expect(metadata).toHaveProperty('language');
      expect(metadata).toHaveProperty('identifier');
    });

    test('should get full metadata', () => {
      const metadata = repub.getMetadata();
      expect(metadata).toHaveProperty('title');
      expect(metadata).toHaveProperty('creator');
      expect(metadata).toHaveProperty('language');
    });
  });

  describe('Cover Operations', () => {
    test('should extract cover image if present', async () => {
      const cover = await repub.getCover();
      if (cover) {
        expect(cover).toHaveProperty('data');
        expect(cover).toHaveProperty('mediaType');
        expect(cover).toHaveProperty('href');
        expect(cover.mediaType).toMatch(/^image\//);
      }
    });
  });

  describe('Output Generation', () => {
    test('should generate different output formats', async () => {
      const blob = await repub.getOutput('blob');
      expect(blob).toBeDefined();

      const arrayBuffer = await repub.getOutput('arraybuffer');
      expect(arrayBuffer).toBeDefined();
      expect(arrayBuffer instanceof ArrayBuffer).toBe(true);

      const uint8Array = await repub.getOutput('uint8array');
      expect(uint8Array).toBeDefined();
      expect(uint8Array instanceof Uint8Array).toBe(true);
    });
  });
});