// Simple test to verify screenshot functionality
async function testScreenshot() {
  console.log('Testing screenshot functionality...');
  
  // Test creating a URL card via API
  const response = await fetch('http://localhost:3001/api/cards', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'url',
      data: {
        url: 'https://example.com'
      }
    })
  });
  
  if (response.ok) {
    const result = await response.json();
    console.log('URL card created successfully:', result);
    
    if (result.data.screenshot_url) {
      console.log('Screenshot URL generated:', result.data.screenshot_url);
    } else {
      console.log('No screenshot URL found in response');
    }
  } else {
    console.error('Failed to create URL card:', response.status, await response.text());
  }
}

testScreenshot().catch(console.error);