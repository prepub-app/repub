import RePub from '../src/index';

async function testEpub(epubPath: string) {
    try {
        const epub = new RePub();
        await epub.open(epubPath);
        
        let contents = epub.listContents();
        console.log('EPUB Contents:');
        contents.forEach((item, index) => {
            console.log(`${index}. ${item.label} (${item.href})`);
        });
        //await epub.removeContentRange('3...')
        await epub.removeExcept([0, 1, 5, 10]); 
        // Append content
        await epub.appendContent('# Made with prePub\n\nGet your own preview at\n\n[prePub App](https://prepub.app)', {
            title: 'Made with prePub',
            type: 'md',
            css: `
                body { font-family: sans-serif; text-align:center }
                h1 { color: red; }
                `
        });
        console.log('Updated EPUB Contents:');
        contents = epub.listContents();
        contents.forEach((item, index) => {
            console.log(`${index}. ${item.label} (${item.href})`);
        });

        // Get all metadata
        const fullMetadata = epub.getMetadata();
        console.log(fullMetadata);

        // Get core metadata
        const coreMetadata = epub.getCoreMetadata();
        console.log(coreMetadata);
        
        await epub.saveAs( `sampler-${Date.now()}.epub`)
    } catch (error) {
        console.error('Error:', error);
    }
}

// Replace with your EPUB file path
testEpub('test2.epub');