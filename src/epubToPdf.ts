import PDFDocument from 'pdfkit';
import TurndownService from 'turndown';
import { ContentElement, CoverImage, PDFOptions,PaginationVariables, PaginationSection, PaginationTextConfig } from './types';
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
        regular: options.font?.regular || 'Helvetica',
        bold: options.font?.bold || 'Helvetica-Bold',
        italic: options.font?.italic || 'Helvetica-Oblique'
      },
      fontSize: {
        normal: options.fontSize?.normal || 10,
        heading1: options.fontSize?.heading1 || 18,
        heading2: options.fontSize?.heading2 || 16,
        heading3: options.fontSize?.heading3 || 12
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
    
    const centerY = this.doc.page.height / 2;
    
    // Title
    this.doc
      .font(this.options.font.bold)
      .fontSize(this.options.fontSize.heading1)
      .text(metadata.title, {
        align: 'center',
        continued: false
      });

    // Subtitle if exists
    if (metadata.subtitle) {
      this.doc
        .moveDown()
        .fontSize(this.options.fontSize.heading2)
        .text(metadata.subtitle, {
          align: 'center',
          continued: false
        });
    }

    // Authors
    if (metadata.authors.length > 0) {
      this.doc
        .moveDown(2)
        .font(this.options.font.regular)
        .fontSize(this.options.fontSize.heading3)
        .text(metadata.authors.join('\n'), {
          align: 'center',
          continued: false
        });
    }

    // Publisher
    if (metadata.publisher) {
      this.doc
        .moveDown(2)
        .fontSize(this.options.fontSize.normal)
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
    this.doc
      .font(this.options.font.regular)
      .fontSize(this.options.fontSize.normal);

    // Split content into lines and process each
    const lines = content.split('\n');
    
      for (const line of lines) {
        
      // Handle images with improved regex for various markdown formats
      const imageMatch = line.match(/!\[(.*?)\]\(([^)]+)\)/);
      if (imageMatch) {
        const [, alt, src] = imageMatch;
        try {
          const imageData = await this.processImage(src);
          
          if (imageData) {
            // Calculate dimensions to fit within margins
            const maxWidth = this.doc.page.width - this.options.margins.left - this.options.margins.right;
            const maxHeight = this.doc.page.height / 2; // Limit to half page height by default

            // Add some spacing before image
            this.doc.moveDown();

            // Add image centered on page
            this.doc.image(imageData, {
              fit: [maxWidth, maxHeight],
              align: 'center',
              valign: 'center'
            });

            // Add spacing after image
            this.doc.moveDown();
          }
        } catch (error) {
          log('Failed to add image to PDF:', error);
          // Continue with text content even if image fails
        }
        continue;
      }
          
      // Handle headings
      if (line.startsWith('#')) {
        const level = line.match(/^#+/)?.[0].length || 1;
        const text = line.replace(/^#+\s*/, '');
        
        this.doc
          .font(this.options.font.bold)
          .fontSize(this.options.fontSize[`heading${level}` as keyof typeof this.options.fontSize] || this.options.fontSize.normal)
          .text(text, { continued: false })
          .moveDown();
          
        continue;
      }

      // Handle emphasis
      let text = line
        .replace(/\*\*(.*?)\*\*/g, (_, p1) => {
          this.doc.font(this.options.font.bold);
          return p1;
        })
        .replace(/\*(.*?)\*/g, (_, p1) => {
          this.doc.font(this.options.font.italic);
          return p1;
        });

      // Render line
      if (text.trim()) {
        this.doc.text(text, { continued: false });
      } else {
        this.doc.moveDown();
      }

      // Reset font
      this.doc.font(this.options.font.regular);
    }
  }
}