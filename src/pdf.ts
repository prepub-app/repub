import PDFDocument from 'pdfkit';
import TurndownService from 'turndown';
import { ContentElement, CoverImage, PDFOptions,PaginationVariables, PaginationSection, PaginationTextConfig, CustomFontData, BodyFontStyle, HeadingLevel, FontTarget } from './types';
import { RePub } from './core';
import debug from 'debug';
import { Debugger } from 'debug';

const log: Debugger = debug('repub:pdf');

/**
 * Class for converting EPUB content to PDF
 */
export class EPUBToPDF {
  private doc: PDFKit.PDFDocument;
  private options: Required<PDFOptions>;
    private turndownService: TurndownService;
    private currentChapterTitle: string = '';
    private metadata: any;
    private paginationVariables: PaginationVariables = {};
  private epub: RePub | null = null;
  private standards = {
    'h1': 18,
    'h2': 16,
    'h3': 14
  }

  /**
   * Creates a new EPUBToPDF converter instance
   * @param options Configuration options for PDF generation
   */
  constructor(options: PDFOptions = {}) {
    // Set default options
    this.options = {
      pageSize: options.pageSize || 'A4',
      margins: {
        top: options.margins?.top || 72,    // 1 inch
        bottom: options.margins?.bottom || 72,
        left: options.margins?.left || 72,
        right: options.margins?.right || 72
      },
      font: {
        body: {
          regular: options.font?.body?.regular || 'Helvetica',
          bold: options.font?.body?.bold || 'Helvetica-Bold',
          italic: options.font?.body?.italic || 'Helvetica-Oblique',
          boldItalic: options.font?.body?.boldItalic || 'Helvetica-BoldOblique'
        },
        h1: options.font?.h1 || 'Helvetica-Bold',
        h2: options.font?.h2 || 'Helvetica-Bold',
        h3: options.font?.h3 || 'Helvetica-Bold'
      },
      fontSize: {
        body: options.fontSize?.body || 10,
        h1: options.fontSize?.h1 || 18,
        h2: options.fontSize?.h2 || 16,
        h3: options.fontSize?.h3 || 12
      },
      pagination: options.pagination || {}
    };

    // Initialize PDF document
    this.doc = new PDFDocument({
      size: this.options.pageSize,
      margins: this.options.margins,
        autoFirstPage: false,
        bufferPages: true
    });

    // Initialize HTML to Markdown converter
    this.turndownService = new TurndownService({
      headingStyle: 'atx',
      hr: '---',
      bulletListMarker: '*',
      codeBlockStyle: 'fenced'
    });
  }

  /**
   * Converts EPUB content to PDF
   * @param epub RePub instance containing the EPUB to convert
   * @returns Promise resolving to PDF data as Buffer
   */
    async convert(epub: RePub): Promise<Buffer> {
      
        this.epub = epub;

    // Store metadata for headers/footers
    this.metadata = epub.getCoreMetadata();

    // Set PDF metadata
    this.doc.info['Title'] = this.metadata.title;
    if (this.metadata.authors.length > 0) {
      this.doc.info['Author'] = this.metadata.authors.join(', ');
    }
    this.doc.info['Creator'] = `RePub ${RePub.VERSION}`

    // Add cover if exists
    const cover = await epub.getCover();
    if (cover) {
      await this.addCover(cover);
    }
      
    // Initialize pagination variables
    this.initializePaginationVariables();

    // Add title page
    this.addTitlePage(this.metadata);

    // Process content
    const contents = epub.listContents();
    const contentMap = await epub.getContents();

    if (contentMap instanceof Map) {
      for (const content of contents) {
        await this.processContent(content, contentMap);
      }
    }

    // Add pagination after all content is added
    this.addPagination();

    // Finalize document
    this.doc.end();

    // Return PDF data
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      this.doc.on('data', chunks.push.bind(chunks));
      this.doc.on('end', () => resolve(Buffer.concat(chunks)));
      this.doc.on('error', reject);
    });
  }

    
  private initializePaginationVariables(): void {
    if (!this.options.pagination) return;

    const now = new Date();
    
    this.paginationVariables = {
      title: this.metadata.title || '',
      author: this.metadata.authors?.join(', ') || '',
      chapter: '',
      date: now.toISOString().split('T')[0],
      ...this.options.pagination.variables
    };
  }

  private substituteVariables(text: string, pageNumber: number, totalPages: number): string {
    const variables: Record<string, string | number> = {
      ...this.paginationVariables,
      pageNumber,
      totalPages,
      chapter: this.currentChapterTitle
    };

    return text.replace(/\{(\w+)\}/g, (match, variable: string) => {
      return variable in variables ? String(variables[variable]) : match;
    });
  }

    private addPagination(): void {
      log(this.options.pagination)
    if (!this.options.pagination) return;

    const pages = this.doc.bufferedPageRange();
    const startPage = this.options.pagination.startPage || 0;
    
    for (let i = pages.start; i < pages.start + pages.count; i++) {
      // Skip pages before start page
      if (i < startPage) continue;

      this.doc.switchToPage(i);

        // Add header
        if (this.options.pagination.header) {
            this.addPaginationSection(
                this.options.pagination.header,
                true,
                i - startPage + 1,
                pages.count - startPage
            );
        }

        // Add footer
        if (this.options.pagination.footer) {
            this.addPaginationSection(
                this.options.pagination.footer,
                false,
                i - startPage + 1,
                pages.count - startPage
            );
        }
    }
        
  }

  private addPaginationSection(
    section: PaginationSection,
    isHeader: boolean,
    pageNumber: number,
    totalPages: number
  ): void {
    const { left, center, right } = section;
    const margin = this.doc.page.margins[isHeader ? 'top' : 'bottom'];
    const yPosition = isHeader
      ? margin / 2
      : this.doc.page.height - margin / 2;

    // Temporarily remove margin
    this.doc.page.margins[isHeader ? 'top' : 'bottom'] = 0;

    // Add left text
    if (left?.content) {
      this.addPaginationText(
        left,
        yPosition,
        pageNumber,
        totalPages,
        'left'
      );
    }

    // Add center text
    if (center?.content) {
      this.addPaginationText(
        center,
        yPosition,
        pageNumber,
        totalPages,
        'center'
      );
    }

    // Add right text
    if (right?.content) {
      this.addPaginationText(
        right,
        yPosition,
        pageNumber,
        totalPages,
        'right'
      );
    }

    // Restore margin
    this.doc.page.margins[isHeader ? 'top' : 'bottom'] = margin;
  }

  private addPaginationText(
    config: PaginationTextConfig,
    y: number,
    pageNumber: number,
    totalPages: number,
    align: 'left' | 'center' | 'right'
  ): void {
    const text = this.substituteVariables(config.content, pageNumber, totalPages);
    
    // Set up text options
    this.doc
      .font(config.font)
      .fontSize(config.fontSize)
      .fillColor(config.color);

    // Calculate the width of the text
    const textWidth = this.doc.widthOfString(text);
    
    // Calculate the available width between margins
    const availableWidth = this.doc.page.width - (this.doc.page.margins.left + this.doc.page.margins.right);

    // Calculate the final x position based on alignment
    let finalX = this.doc.page.margins.left; // Start at the left margin for left alignment
    if (align === 'center') {
      finalX = this.doc.page.margins.left + (availableWidth / 2) - (textWidth / 2);
    } else if (align === 'right') {
      finalX = this.doc.page.width - this.doc.page.margins.right - textWidth;
    }

    // Add the text at the calculated position
    this.doc.text(text, finalX, y, {
      lineBreak: false
    });
  }

  /**
   * Adds cover image to the PDF
   * @private
   * @param cover Cover image data
   */
  private async addCover(cover: CoverImage): Promise<void> {
    this.doc.addPage();
    
    // Calculate dimensions to fit page while maintaining aspect ratio
    const pageWidth = this.doc.page.width - this.options.margins.left - this.options.margins.right;
    const pageHeight = this.doc.page.height - this.options.margins.top - this.options.margins.bottom;
    
    try {
      // Add image centered on page
      this.doc.image(cover.data, {
        fit: [pageWidth, pageHeight],
        align: 'center',
        valign: 'center'
      });
    } catch (error) {
      log('Failed to add cover image:', error);
    }
  }

  /**
   * Adds a title page to the PDF
   * @private
   * @param metadata EPUB metadata
   */
  private addTitlePage(metadata: any): void {
    this.doc.addPage();
    
    const centerY = this.doc.page.height / 4;
    
    // Title
    this.doc
      .moveDown(centerY)
      .font(this.options.font.h1 || this.options.font.body.bold)
      .fontSize(this.options.fontSize.h1 || this.standards.h1)
      .text(metadata.title, {
        align: 'center',
        continued: false
      });

    // Subtitle if exists
    if (metadata.subtitle) {
      this.doc
        .moveDown()
        .font(this.options.font.h2 || this.options.font.body.bold)
        .fontSize(this.options.fontSize.h2 || this.standards.h2)
        .text(metadata.subtitle, {
          align: 'center',
          continued: false
        });
    }

    // Authors
    if (metadata.authors.length > 0) {
      this.doc
        .moveDown(2)
        .font(this.options.font.h2 || this.options.font.body.bold)
        .fontSize(this.options.fontSize.h2 || this.standards.h2)
        .text(metadata.authors.join('\n'), {
          align: 'center',
          continued: false
        });
    }

    // Publisher
    if (metadata.publisher) {
      this.doc
        .moveDown(2)
        .fontSize(this.options.fontSize.body)
        .text(metadata.publisher, {
          align: 'center',
          continued: false
        });
    }
  }

  /**
   * Processes a content element and its children
   * @private
   * @param content Content element to process
   * @param contentMap Map of content IDs to content text
   */
  private async processContent(
    content: ContentElement,
    contentMap: Map<string, string>
  ): Promise<void> {
    const contentText = contentMap.get(content.id);
    if (!contentText) return;

    this.doc.addPage();
    
    // Update current chapter title for headers/footers
    this.currentChapterTitle = content.label;

    // Process content
    await this.renderContent(contentText);

    // Process children recursively
    if (content.children) {
      for (const child of content.children) {
        await this.processContent(child, contentMap);
      }
    }
  }
    
  private async processImage(src: string): Promise<Buffer | null> {
    if (!this.epub) return null;

    try {
      const asset = await this.epub.getAsset(src);
      
      // Check if it's an image type
      if (!asset.mediaType.startsWith('image/')) {
        console.warn(`Asset is not an image: ${src} (${asset.mediaType})`);
        return null;
      }

      // Convert ArrayBuffer to Buffer if necessary
      if (asset.data instanceof ArrayBuffer) {
        return Buffer.from(asset.data);
      }
      
      return asset.data as Buffer;
    } catch (error) {
      log('Failed to process image:', src, error);
      return null;
    }
  }

   /**
   * Renders content text with basic formatting
   * @private
   * @param content Content text (Markdown)
   */
   private async renderContent(content: string): Promise<void> {
    // Set default body font
    this.doc
      .font(this.options.font.body.regular)
      .fontSize(this.options.fontSize.body);

    const lines = content.split('\n');
    let isItalic = false;
    let isBold = false;
    
    for (const line of lines) {
      // Handle images
      const imageMatch = line.match(/!\[(.*?)\]\(([^)]+)\)/);
      if (imageMatch) {
        const [, alt, src] = imageMatch;
        try {
          const imageData = await this.processImage(src);
          if (imageData) {
            const maxWidth = this.doc.page.width - this.options.margins.left - this.options.margins.right;
            const maxHeight = this.doc.page.height / 2;
            
            this.doc.moveDown();
            this.doc.image(imageData, {
              fit: [maxWidth, maxHeight],
              align: 'center',
              valign: 'center'
            });
            this.doc.moveDown();
          }
        } catch (error) {
          log('Failed to add image to PDF:', error);
        }
        continue;
      }
          
      // Handle headings
      if (line.startsWith('#')) {
        const level = line.match(/^#+/)?.[0].length || 1;
        const text = line.replace(/^#+\s*/, '');
        
        // Only handle h1-h3, anything deeper uses h3 formatting
        const headingLevel = Math.min(level, 3) as 1 | 2 | 3;
        const fontKey = `h${headingLevel}` as 'h1' | 'h2' | 'h3';
        
        this.doc
          .font(this.options.font[fontKey] || this.options.font.body.bold)
          .fontSize(this.options.fontSize[fontKey] || this.standards[fontKey])
          .text(text, { continued: false })
          .moveDown();
        
        // Reset to body font
        this.doc
          .font(this.options.font.body.regular)
          .fontSize(this.options.fontSize.body);
          
        continue;
      }

      // Process text with emphasis
      let segments: string[] = [];
      let currentText = '';
      let currentIndex = 0;

      // Helper function to apply current style and add text segment
      const addSegment = (text: string, endOfLine: boolean = false) => {
        if (!text) return;
        
        // Select appropriate font based on current style
        let font = this.options.font.body.regular;
        if (isBold && isItalic && this.options.font.body.boldItalic) {
          font = this.options.font.body.boldItalic;
        } else if (isBold) {
          font = this.options.font.body.bold;
        } else if (isItalic) {
          font = this.options.font.body.italic;
        }

        this.doc
          .font(font)
          .text(text, { continued: !endOfLine });
      };

      while (currentIndex < line.length) {
        // Look for bold/italic markers
        if (line.substr(currentIndex).startsWith('**')) {
          addSegment(currentText);
          currentText = '';
          isBold = !isBold;
          currentIndex += 2;
        } else if (line.substr(currentIndex).startsWith('*')) {
          addSegment(currentText);
          currentText = '';
          isItalic = !isItalic;
          currentIndex += 1;
        } else {
          currentText += line[currentIndex];
          currentIndex += 1;
        }
      }

      // Add remaining text
      if (currentText) {
        addSegment(currentText, true);
      }

      // Add line break if empty line
      if (!line.trim()) {
        this.doc.moveDown();
      }

      // Reset styles at end of line
      isBold = false;
      isItalic = false;
      this.doc.font(this.options.font.body.regular);
    }
   }
  
/**
 * Method to register a custom font with PDFKit
 * @param fontData Font configuration and data
 * @returns Promise resolving when font is registered
 */
private async registerCustomFont(fontData: CustomFontData): Promise<void> {
  try {

    if (fontData.data instanceof Blob)
      fontData.data = await fontData.data.arrayBuffer();
    
    // Register font with PDFKit directly using the provided data
    this.doc.registerFont(fontData.postscriptName, fontData.data);

    // Update font configuration for each target
    for (const target of fontData.targets) {
      if (target.startsWith('body-')) {
        const style = target.replace('body-', '') as BodyFontStyle;
        this.options.font.body[style] = fontData.postscriptName;
      } else {
        this.options.font[target as HeadingLevel] = fontData.postscriptName;
      }
    }

    log(`Registered custom font ${fontData.postscriptName} for targets: ${fontData.targets.join(', ')}`);
  } catch (error) {
    log('Failed to register custom font:', error);
    throw new Error(`Failed to register custom font ${fontData.postscriptName}: ${error}`);
  }
}

/**
 * Public method to register custom fonts
 * @param fonts Array of custom fonts to register
 * @returns Promise resolving when all fonts are registered
 */
public async registerFonts(fonts: CustomFontData[]): Promise<void> {
  await Promise.all(fonts.map(font => this.registerCustomFont(font)));
}
  
}