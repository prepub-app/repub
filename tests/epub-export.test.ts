/**
 * Jest test file to verify the correct export of EPUB content
 */
import { RePub } from '../src/index';
import fs from 'fs/promises';
import path from 'path';

describe('EPUB Export Tests', () => {
  let epub: RePub;
  let contents: any[];

  beforeAll(async () => {
    // Create instance and load the problematic EPUB
    epub = new RePub();
    
    const epubPath = path.resolve('./tests/fixtures/mind_is_flat.epub');
    const data = await fs.readFile(epubPath);
    await epub.load(data);
    
    // Store contents for tests
    contents = epub.listContents();
  });

  test('should extract metadata correctly', () => {
    const metadata = epub.getCoreMetadata();
    expect(metadata.title).toBe('Mind Is Flat');
    expect(metadata.authors).toContain('Nick Chater');
  });

  test('should extract more than the initial 4 elements', () => {
    expect(contents.length).toBeGreaterThan(4);
  });

  test('should include previously missing top-level sections', () => {
    // Check for specific sections that were previously missing
    const sectionLabels = contents.map(item => item.label);
    
    expect(sectionLabels).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Contents/),
        expect.stringMatching(/Prologue/),
        expect.stringMatching(/Part One/)
      ])
    );
  });

  test('should extract all chapters correctly', () => {
    // Find "Part One" section
    const partOne = contents.find(c => c.label.includes('Part One'));
    
    // Part One should exist and have children (chapters)
    expect(partOne).toBeDefined();
    expect(partOne?.children?.length).toBeGreaterThan(0);
    
    // Check for specific chapters in Part One
    if (partOne?.children) {
      const chapterTitles = partOne.children.map(child => child.label);
      
      expect(chapterTitles).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/Power of Invention/),
          expect.stringMatching(/Feeling of Reality/),
          expect.stringMatching(/Anatomy of a Hoax/),
          expect.stringMatching(/Inconstant Imagination/),
          expect.stringMatching(/Inventing Feelings/),
          expect.stringMatching(/Manufacturing Choice/)
        ])
      );
    }
  });

  test('should handle fragment identifiers in hrefs correctly', () => {
    // Find sections that have fragments in their hrefs
    const contentsSection = contents.find(c => c.label.includes('Contents'));
    const prologueSection = contents.find(c => c.label.includes('Prologue'));
    
    expect(contentsSection).toBeDefined();
    expect(prologueSection).toBeDefined();
    
    // Check that href has fragment but id doesn't
    if (contentsSection) {
      expect(contentsSection.href).toContain('#');
      expect(contentsSection.id).not.toContain('#');
    }
    
    if (prologueSection) {
      expect(prologueSection.href).toContain('#');
      expect(prologueSection.id).not.toContain('#');
    }
  });

  test('should extract all expected sections', () => {
    // Define the expected top-level sections in order
    const expectedSections = [
      'Cover',
      'Title Page',
      'Copyright Page',
      'Dedication',
      'Contents',
      'Prologue',
      'Part One',
      'Part Two',
      'Epilogue',
      'Notes',
      'Index'
    ];
    
    // Check that all expected sections are present (in any order)
    const sectionLabels = contents.map(item => item.label);
    
    expectedSections.forEach(section => {
      expect(sectionLabels.some(label => label.includes(section))).toBeTruthy();
    });
  });
});