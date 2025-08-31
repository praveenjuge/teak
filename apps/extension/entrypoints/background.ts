export default defineBackground(() => {
  console.log('Teak extension background script started', { id: browser.runtime.id });
  
  // Handle extension icon click - this is automatically handled by the browser action popup
  // The popup will handle the auto-save functionality when opened
  
  // Optional: Add any background processing here if needed in the future
});
