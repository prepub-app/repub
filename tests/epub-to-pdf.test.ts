import { RePub, EPUBToPDF } from '../src/index';
import { readFile, writeFile, mkdir, access } from 'fs/promises';
import { join, resolve } from 'path';
import PDFDocument from 'pdfkit';

describe('EPUBToPDF', () => {
  let epub: RePub;
  let pdfConverter: EPUBToPDF;
  let epubData: Buffer;
  const outputDir = resolve(__dirname, '__output__');
  
  // Setup before all tests
  beforeAll(async () => {
    // Create output directory if it doesn't exist
    try {
      await access(outputDir);
    } catch {
      await mkdir(outputDir);
    }
    
    // Load test EPUB file
    const epubPath = resolve(__dirname, 'fixtures', 'moby-dick.epub');
    epubData = await readFile(epubPath);
    
    // Initialize EPUB
    epub = new RePub();
    await epub.load(epubData);
  });

  // Setup before each test
  beforeEach(() => {
    // Initialize PDF converter with default settings
    pdfConverter = new EPUBToPDF({
      pageSize: 'A4',
      margins: {
        top: 72,
        bottom: 72,
        left: 72,
        right: 72
        },
        fontSize:{
            normal: 9,
            heading1: 14,
            heading2: 12,
            heading3: 9
      }
    });
  });

  test('should successfully convert EPUB to PDF', async () => {
    const pdfBuffer = await pdfConverter.convert(epub);
    
    // Verify PDF was created
    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(0);

    // Save PDF for manual inspection if needed
    const outputPath = join(outputDir, 'test-output.pdf');
    await writeFile(outputPath, pdfBuffer);
  }, 30000); // Increase timeout for PDF generation

  /*test('should preserve EPUB metadata in PDF', async () => {
    const pdfBuffer = await pdfConverter.convert(epub);
    
    // Helper function to extract PDF metadata
    const extractPDFMetadata = async (buffer: Buffer): Promise<Record<string, string>> => {
      return new Promise((resolve) => {
        const metadata: Record<string, string> = {};
        const doc = new PDFDocument();
        
        // Capture metadata from the PDF
        doc.on('info', (info) => {
          metadata.title = info.Title || '';
          metadata.author = info.Author || '';
          metadata.publisher = info.Publisher || '';
        });
        
        doc.end();
        resolve(metadata);
      });
    };

    const pdfMetadata = await extractPDFMetadata(pdfBuffer);
    const epubMetadata = epub.getCoreMetadata();

    // Verify metadata was preserved
    expect(pdfMetadata.title).toBe(epubMetadata.title);
    if (epubMetadata.authors.length > 0) {
      expect(pdfMetadata.author).toBe(epubMetadata.authors.join(', '));
    }
    if (epubMetadata.publisher) {
      expect(pdfMetadata.publisher).toBe(epubMetadata.publisher);
    }
  });
  */

  test('should handle EPUB with cover image', async () => {
    const cover = await epub.getCover();
    const pdfBuffer = await pdfConverter.convert(epub);

    // If EPUB has a cover, verify PDF size is larger
    if (cover) {
      const minSizeWithCover = 1000; // Adjust based on your needs
      expect(pdfBuffer.length).toBeGreaterThan(minSizeWithCover);
    }
  });

  test('should handle EPUB without cover image', async () => {
    // Create a new EPUB instance without cover
    const epubNoCover = new RePub();
    await epubNoCover.load(epubData);
    
    // Mock getCover to return null
    jest.spyOn(epubNoCover, 'getCover').mockResolvedValue(null);

    const pdfBuffer = await pdfConverter.convert(epubNoCover);
    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(0);
  });

  test('should apply custom PDF options', async () => {
    const customPdfConverter = new EPUBToPDF({
      pageSize: 'A4',
      margins: {
        top: 50,
        bottom: 50,
        left: 50,
        right: 50
      },
      fontSize: {
        normal: 14,
        heading1: 28,
        heading2: 24,
        heading3: 20
        },
        pagination: {
            header: {
              left: {
                content: "{title}",
                font: "Helvetica-Bold",
                fontSize: 10,
                color: "#333333",
                alignment: "left",
                margin: 10
              },
              right: {
                content: "Chapter: {chapter}",
                font: "Helvetica",
                fontSize: 10,
                color: "#333333",
                alignment: "right",
                margin: 10
              }
            },
            footer: {
              left: {
                content: "Page {pageNumber} of {totalPages}",
                font: "Helvetica",
                fontSize: 8,
                color: "#666666",
                alignment: "left",
                margin: 10
              },
              center: {
                content: "Generated on {date}",
                font: "Helvetica-Oblique",
                fontSize: 8,
                color: "#999999",
                alignment: "right",
                margin: 10
              }
            },
            startPage: 1
          }
    });

    const pdfBuffer = await customPdfConverter.convert(epub);
    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(0);

    // Save custom PDF for manual inspection
    const outputPath = join(outputDir, 'test-output-custom.pdf');
    await writeFile(outputPath, pdfBuffer);
  });

  // Cleanup generated files after all tests
  afterAll(async () => {
    // Optionally remove generated files
    // await rm(outputDir, { recursive: true, force: true });
  });
});