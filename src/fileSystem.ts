import RePub from './core.js';
import {
    FileData
} from './types';

export class RePubFS extends RePub {
/**
   * Opens an EPUB from a file path or URL
   * @param location File path or URL to the EPUB
   * @throws {Error} If file path loading is attempted in browser environment
   */
async open(location: string): Promise<void> {
    let epubData: FileData;

    if (location.startsWith('http')) {
      const response = await fetch(location);
      epubData = await response.arrayBuffer();
    } else {
      // Only import fs if we're in Node environment
      if (typeof window === 'undefined') {
        const fs = await import('fs/promises');
        epubData = await fs.readFile(location);
      } else {
        throw new Error('File path loading is not supported in browser environment');
      }
    }

    await this.load(epubData);
}
    
    /**
     * Saves the EPUB to a file (Node.js environment only)
     * @param location File path where the EPUB should be saved
     * @throws {Error} If called in a browser environment
     */
        async saveAs(location: string): Promise<void> {
            if (typeof window !== 'undefined') {
              throw new Error('saveAs is only supported in Node.js environment');
            }
      
            await this.prepareOutput();
            const content = await this.getOutput('uint8array');
            const fs = await import('fs/promises');
            await fs.writeFile(location, content);
          }
}