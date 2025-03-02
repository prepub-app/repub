/**
 * Jest test file to verify the fixed flattened content functionality
 */
import { RePub } from '../src/index';
import fs from 'fs/promises';
import path from 'path';

describe('EPUB Flattened Content Tests', () => {
  let epub: RePub;
  
  beforeAll(async () => {
    // Create instance and load the EPUB
    epub = new RePub();
    
    const epubPath = path.resolve('./tests/fixtures/mind_is_flat.epub');
    const data = await fs.readFile(epubPath);
    await epub.load(data);
  });

  describe('listContents()', () => {
    test('should return hierarchical contents by default', () => {
        const hierarchicalContents = epub.listContents({ flatten: false });
        
        console.group(hierarchicalContents)
      
      // Should have top-level sections that may have children
      expect(hierarchicalContents.length).toBeGreaterThan(0);
      
      // At least some content should have children
      const hasChildren = hierarchicalContents.some(content => 
        content.children && content.children.length > 0
      );
      expect(hasChildren).toBeTruthy();
    });

    test('should return flattened contents without parent elements by default', () => {
        const flattenedContents = epub.listContents({ flatten: true });
        
        console.log(flattenedContents)
      
      // Should have more items than hierarchical top-level
      const hierarchicalContents = epub.listContents({ flatten: false });
      expect(flattenedContents.length).toBeGreaterThan(hierarchicalContents.length);
      
      // No content should have children
      const hasChildren = flattenedContents.some(content => 
        content.children && content.children.length > 0
      );
      expect(hasChildren).toBeFalsy();
      
      // Should have consecutive indices
      flattenedContents.forEach((content, i) => {
        expect(content.index).toBe(i);
      });
      
      // Should exclude parent elements
      const hasPartOne = flattenedContents.some(c => c.label === 'Part One: The Illusion of Mental Depth');
      const hasPartTwo = flattenedContents.some(c => c.label === 'Part Two: The Improvised Mind');
      
      expect(hasPartOne).toBeFalsy();
      expect(hasPartTwo).toBeFalsy();
      
      // But should include their children
      const hasPart1Content = flattenedContents.some(c => 
        c.label.includes('Feeling of Reality') || 
        c.label.includes('Power of Invention')
      );
      
      const hasPart2Content = flattenedContents.some(c => 
        c.label.includes('Cycle of Thought') || 
        c.label.includes('Secret of Intelligence')
      );
      
      expect(hasPart1Content).toBeTruthy();
      expect(hasPart2Content).toBeTruthy();
    });
    
    test('should include parent elements when specified', () => {
      const flattenedWithParents = epub.listContents({ 
        flatten: true, 
        includeParents: true 
      });
      
      // Should have all elements
      expect(flattenedWithParents.length).toBeGreaterThan(0);
      
      // No content should have children
      const hasChildren = flattenedWithParents.some(content => 
        content.children && content.children.length > 0
      );
      expect(hasChildren).toBeFalsy();
      
      // Should have consecutive indices
      flattenedWithParents.forEach((content, i) => {
        expect(content.index).toBe(i);
      });
      
      // Should include parent elements
      const hasPartOne = flattenedWithParents.some(c => c.label.includes('Part One:'));
      const hasPartTwo = flattenedWithParents.some(c => c.label.includes('Part Two:'));
      
      expect(hasPartOne).toBeTruthy();
      expect(hasPartTwo).toBeTruthy();
    });
  });

  describe('getContents()', () => {
    test('should use flattened content without parents by default', async () => {
      const contentMap = await epub.getContents();
      
      // Should be a Map object
      expect(contentMap).toBeInstanceOf(Map);
      
      if (contentMap instanceof Map) {
        // Check that parent sections are not included
        const keys = Array.from(contentMap.keys());
        const hasPartOne = keys.some(key => key === 'xhtml/part01.html');
        const hasPartTwo = keys.some(key => key === 'xhtml/part02.html');
        
        expect(hasPartOne).toBeFalsy();
        expect(hasPartTwo).toBeFalsy();
        
        // But should include their content
        const values = Array.from(contentMap.values()).join(' ');
        expect(values).toContain('Power of Invention');
        expect(values).toContain('Cycle of Thought');
      }
    });
    
    test('should include parent elements when specified', async () => {
      const contentMap = await epub.getContents(undefined, { 
        flatten: true,
        includeParents: true 
      });
      
      // Should be a Map object
      expect(contentMap).toBeInstanceOf(Map);
      
      if (contentMap instanceof Map) {
        // Check that parent sections are included
        const keys = Array.from(contentMap.keys());
        const hasPartOne = keys.some(key => key === 'xhtml/part01.html');
        const hasPartTwo = keys.some(key => key === 'xhtml/part02.html');
        
        expect(hasPartOne).toBeTruthy();
        expect(hasPartTwo).toBeTruthy();
      }
    });

    test('should merge content correctly', async () => {
      const mergedContent = await epub.getContents(undefined, { merge: true });
      
      // Should be a string
      expect(typeof mergedContent).toBe('string');
      
      if (typeof mergedContent === 'string') {
        // Should contain text from multiple parts of the book
        expect(mergedContent).toContain('Prologue');
        
        // Should contain text from chapters
        expect(mergedContent).toContain('Feeling of Reality');
        expect(mergedContent).toContain('Cycle of Thought');
        
        // Should NOT contain section titles of parent elements
        expect(mergedContent).not.toContain('Part One: The Illusion of Mental Depth');
        expect(mergedContent).not.toContain('Part Two: The Improvised Mind');
      }
    });
    
    test('should support hierarchical content retrieval', async () => {
      const hierarchicalContentMap = await epub.getContents(undefined, { 
        flatten: false 
      });
      
      // Should be a Map object
      expect(hierarchicalContentMap).toBeInstanceOf(Map);
      
      if (hierarchicalContentMap instanceof Map) {
        // Should match the number of top-level elements
        const topLevelContents = epub.listContents({ flatten: false });
        expect(hierarchicalContentMap.size).toBe(topLevelContents.length);
        
        // Should include part headers
        const keys = Array.from(hierarchicalContentMap.keys());
        const hasPartOne = keys.some(key => key === 'xhtml/part01.html');
        const hasPartTwo = keys.some(key => key === 'xhtml/part02.html');
        
        expect(hasPartOne).toBeTruthy();
        expect(hasPartTwo).toBeTruthy();
      }
    });
  });
});