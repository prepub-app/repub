import PDFDocument from 'pdfkit';
import TurndownService from 'turndown';
import { ContentElement, CoverImage, PDFOptions,PaginationVariables, PaginationSection, PaginationTextConfig, CustomFontData, BodyFontStyle, HeadingLevel, FontTarget, alignment } from './types';
import { RePub } from './core';
import debug from 'debug';
import { Debugger } from 'debug';

const log: Debugger = debug('repub:pdf');

// Standard paperback formats in points (1 inch = 72 points)
export const PAPERBACK_FORMATS = {
  MASS_MARKET: [324, 504] as [number, number],     // 4.25" x 7"
  TRADE_5x8: [360, 576] as [number, number],       // 5" x 8"
  TRADE_5_5x8_5: [396, 612] as [number, number],   // 5.5" x 8.5"
  TRADE_6x9: [432, 648] as [number, number],       // 6" x 9"
  ROYAL: [504, 720] as [number, number],           // 7" x 10"
  US_LETTER: [612, 792] as [number, number],       // 8.5" x 11"
  CROWN_QUARTO: [504, 666] as [number, number],    // 7" x 9.25"
  DEMY: [445, 697] as [number, number],            // 6.18" x 9.67"
} as const;

// Type for paperback format keys
export type PaperbackFormat = keyof typeof PAPERBACK_FORMATS;


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
      pageSize: this.resolvePaperbackFormat(options.pageSize),
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
      style: {
        body: {
          align: 'justify',
          paragraphGap: 12
        },
        blockquote: {
          indent: 0
        },
        link: {
          underline: false,
          color: 'blue'
        },
        ...options.style
      },
      pagination: options.pagination || {},
      addTitlePage: options.addTitlePage || false
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
   * Resolves a paperback format string to PDFKit page size
   * @private
   * @param format Format string or size array
   * @returns PDFKit page size
   */
   private resolvePaperbackFormat(format: string | number[] | undefined): string | number[] {
    if (!format) return 'A4';
    if (Array.isArray(format)) return format;
    
    // Check if format is a paperback format key
    if (format in PAPERBACK_FORMATS) {
      // Create a new mutable array from the constant array
      return [...PAPERBACK_FORMATS[format as PaperbackFormat]];
    }
    
    // Return original format string if not a paperback format
    return format;
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
      if (this.options.addTitlePage) {
        this.addTitlePage(this.metadata);
      }

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

    const customMargin = 10

    this.doc.addPage({
      size: this.options.pageSize,
      margin: customMargin
    });
    
    // Calculate dimensions to fit page while maintaining aspect ratio
    const pageWidth = this.doc.page.width - customMargin * 2;
    const pageHeight = this.doc.page.height - customMargin * 2;
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
      .moveDown()
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

  interface TextState {
    font: string;
    fontSize: number;
    fillColor: string | PDFKit.Mixins.ColorValue;
    x: number;
    y: number;
  }

  interface TextSegment {
    text: string;
    isBold: boolean;
    isItalic: boolean;
    link?: { url: string };
  }

  // Track current text state
  let currentFont = this.options.font.body.regular;
  let currentFontSize = this.options.fontSize.body;
  let currentColor: string | PDFKit.Mixins.ColorValue = 'black';

  // Function to process text with emphasis and links
  const processFormattedText = (text: string): TextSegment[] => {
    const segments: TextSegment[] = [];
    let currentIndex = 0;
    let currentText = '';
    let isBold = false;
    let isItalic = false;

    const addSegment = () => {
      if (currentText) {
        segments.push({
          text: currentText,
          isBold,
          isItalic
        });
        currentText = '';
      }
    };

    while (currentIndex < text.length) {
      const remainingText = text.substr(currentIndex);

      // Check for escaped characters
      if (remainingText.startsWith('\\')) {
        if (currentIndex + 1 < text.length) {
          currentText += text[currentIndex + 1];
        }
        currentIndex += 2;
        continue;
      }

      // Look for links
      const linkMatch = remainingText.match(/^\[([^\]]+)\]\(([^)]+)\)/);
      if (linkMatch) {
        addSegment();
        const [fullMatch, linkText, url] = linkMatch;
        
        // Process the link text for formatting
        const linkSegments = processFormattedText(linkText);
        
        // Add each formatted segment with the link
        linkSegments.forEach(segment => {
          segments.push({
            text: segment.text,
            isBold: segment.isBold,
            isItalic: segment.isItalic,
            link: { url }
          });
        });
        
        currentIndex += fullMatch.length;
        continue;
      }

      // Look for bold markers
      if ((remainingText.startsWith('**') || remainingText.startsWith('__')) &&
          !text.substr(currentIndex - 1, 1).startsWith('\\')) {
        addSegment();
        isBold = !isBold;
        currentIndex += 2;
        continue;
      }

      // Look for italic markers
      if (((remainingText.startsWith('*') && !remainingText.startsWith('**')) ||
           (remainingText.startsWith('_') && !remainingText.startsWith('__'))) &&
          !text.substr(currentIndex - 1, 1).startsWith('\\')) {
        addSegment();
        isItalic = !isItalic;
        currentIndex += 1;
        continue;
      }

      currentText += text[currentIndex];
      currentIndex += 1;
    }

    // Add final segment
    addSegment();

    return segments;
  };

  // Function to render text segments
  const renderSegments = (
    segments: TextSegment[],
    options: {
      x?: number;
      y?: number;
      width?: number;
      continued?: boolean;
      align?: alignment;
      indent?: number;
      customFont?: string;
      customFontSize?: number;
      customColor?: string | PDFKit.Mixins.ColorValue;
    } = {}
  ) => {
    let isFirst = true;
    const savedState: TextState = {
      font: currentFont,
      fontSize: currentFontSize,
      fillColor: currentColor,
      x: this.doc.x,
      y: this.doc.y
    };

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const isLast = i === segments.length - 1;

      // Select appropriate font
      let font = options.customFont || this.options.font.body.regular;
      if (segment.isBold && segment.isItalic && this.options.font.body.boldItalic) {
        font = this.options.font.body.boldItalic;
      } else if (segment.isBold) {
        font = this.options.font.body.bold;
      } else if (segment.isItalic) {
        font = this.options.font.body.italic;
      }

      const textOptions: PDFKit.Mixins.TextOptions = {
        continued: !isLast || options.continued,
        align: options.align || this.options.style?.body?.align || 'left',
        width: options.width,
        paragraphGap: this.options.style?.body?.paragraphGap
      };

      // Position text if coordinates provided
      if (options.x !== undefined && options.y !== undefined && isFirst) {
        this.doc.text('', options.x, options.y, textOptions);
        isFirst = false;
      }

      // Apply custom styling
      this.doc.font(font);
      currentFont = font;
      
      const fontSize = options.customFontSize || this.options.fontSize.body;
      this.doc.fontSize(fontSize);
      currentFontSize = fontSize;

      if (options.customColor) {
        this.doc.fillColor(options.customColor);
        currentColor = options.customColor;
      }

      // Handle links
      if (segment.link) {
        const linkStyle = this.options.style?.link;
        const currentX = this.doc.x;
        const currentY = this.doc.y;

        if (linkStyle?.color) {
          this.doc.fillColor(linkStyle.color);
          currentColor = linkStyle.color;
        }

        if (linkStyle?.underline !== false) {
          this.doc.underline(
            currentX,
            currentY,
            this.doc.widthOfString(segment.text),
            this.doc.currentLineHeight(),
            { color: linkStyle?.color || 'blue' }
          );
        }

        this.doc
          .link(currentX, currentY, this.doc.widthOfString(segment.text), this.doc.currentLineHeight(), segment.link.url)
          .text(segment.text, textOptions);
      } else {
        this.doc.text(segment.text, textOptions);
      }
    }

    // Restore state
    this.doc
      .font(savedState.font)
      .fontSize(savedState.fontSize)
      .fillColor(savedState.fillColor);

    currentFont = savedState.font;
    currentFontSize = savedState.fontSize;
    currentColor = savedState.fillColor;

    return savedState;
  };

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
      
      const headingFont = this.options.font[fontKey] || this.options.font.body.bold;
      const headingSize = this.options.fontSize[fontKey] || this.standards[fontKey];
      
      this.doc
        .font(headingFont)
        .fontSize(headingSize)
        .text(text, { continued: false })
        .moveDown();
      
      currentFont = this.options.font.body.regular;
      currentFontSize = this.options.fontSize.body;
      
      this.doc
        .font(currentFont)
        .fontSize(currentFontSize);
      
      continue;
    }


// Handle blockquotes
if (line.startsWith('>')) {
  const textContent = line.substring(1).trim();
  const blockquoteStyle = this.options.style?.blockquote;
  const leftPadding = blockquoteStyle?.indent === undefined ? 36 : blockquoteStyle.indent;
  
  // Add left border/gap first
  if (blockquoteStyle?.borderColor && blockquoteStyle?.borderWidth) {
    const currentY = this.doc.y;
    this.doc
      .rect(
        this.options.margins.left,
        currentY,
        blockquoteStyle.borderWidth,
        this.doc.currentLineHeight() * 1.5
      )
      .fill(blockquoteStyle.borderColor);
  }

  // Set text position with proper left margin
  this.doc.x = this.options.margins.left + leftPadding;
  const currentY = this.doc.y;
  
  // Process text for formatting
  const segments = processFormattedText(textContent);
  
  // Render formatted segments
  renderSegments(segments, {
    x: this.options.margins.left + leftPadding,
    y: currentY,
    width: this.doc.page.width - this.options.margins.left - this.options.margins.right - leftPadding,
    continued: false,
    align: blockquoteStyle?.align || this.options.style?.body?.align || 'left',
    customFont: blockquoteStyle?.font,
    customFontSize: blockquoteStyle?.fontSize,
    customColor: blockquoteStyle?.color
  });

  //this.doc.moveDown();
  continue;
}

    // Handle regular text
    const segments = processFormattedText(line);
    renderSegments(segments, { continued: false });
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