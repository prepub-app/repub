import PDFDocument from 'pdfkit';
import TurndownService from 'turndown';
import { ContentElement, CoverImage, PDFOptions } from './types';
import { RePub } from './core';

/**
 * Class for converting EPUB content to PDF
 */
export class EPUBToPDF {
  private doc: PDFKit.PDFDocument;
  private options: Required<PDFOptions>;
  private turndownService: TurndownService;

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
      }
    };

    // Initialize PDF document
    this.doc = new PDFDocument({
      size: this.options.pageSize,
      margins: this.options.margins,
      autoFirstPage: false
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
    // Get core metadata
    const metadata = epub.getCoreMetadata();

    // Set PDF metadata
    this.doc.info['Title'] = metadata.title;
    if (metadata.authors.length > 0) {
      this.doc.info['Author'] = metadata.authors.join(', ');
    }

    // Add cover if exists
    const cover = await epub.getCover();
    if (cover) {
      await this.addCover(cover);
    }

    // Add title page
    this.addTitlePage(metadata);

    // Process content
    const contents = epub.listContents();
    const contentMap = await epub.getContents();

    if (contentMap instanceof Map) {
      for (const content of contents) {
        await this.processContent(content, contentMap);
      }
    }

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
      console.error('Failed to add cover image:', error);
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

    // Add section title
   /* this.doc
      .font(this.options.font.bold)
      .fontSize(this.options.fontSize.heading2)
      .text(content.label, {
        align: 'left',
        continued: false
      })
      .moveDown();*/

    // Process content
    await this.renderContent(contentText);

    // Process children recursively
    if (content.children) {
      for (const child of content.children) {
        await this.processContent(child, contentMap);
      }
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