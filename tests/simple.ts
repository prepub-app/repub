import RePub from '../src/index';

async function testEpub(epubPath: string) {
    try {
        const epub = new RePub();
        await epub.open(epubPath);
        
        const contents = epub.listContents();
        console.log('EPUB Contents:');
        contents.forEach((item, index) => {
            console.log(`${index}. ${item.label} (${item.href})`);
        });
        epub.removeContentRange('3...')
        await epub.saveAs( `sampler-${Date.now()}.epub`)
    } catch (error) {
        console.error('Error:', error);
    }
}

// Replace with your EPUB file path
testEpub('test.epub');