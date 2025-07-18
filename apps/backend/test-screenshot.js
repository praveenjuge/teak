import { ScreenshotService } from './src/services/screenshot/ScreenshotService.js';

async function testScreenshot() {
  console.log('Testing screenshot service...');
  
  const service = new ScreenshotService();
  
  try {
    // Test with a simple, reliable website
    const result = await service.takeScreenshot('https://example.com', {
      width: 800,
      height: 600,
      format: 'jpeg',
      quality: 85
    });
    
    console.log('Screenshot taken successfully:', result);
    
    // Test OG image download
    const ogResult = await service.downloadAndSaveOgImage(
      'https://avatars.githubusercontent.com/u/9919?v=4',
      'https://github.com/torvalds'
    );
    
    console.log('OG image downloaded successfully:', ogResult);
    
  } catch (error) {
    console.error('Screenshot test failed:', error);
  } finally {
    await service.cleanup();
  }
}

testScreenshot();