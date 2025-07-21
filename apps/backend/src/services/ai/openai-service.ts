import {
  type AiEnrichmentResult,
  AiService,
  type AiServiceConfig,
} from './ai-service.js';

export class OpenAiService extends AiService {
  private defaultModels = {
    text: 'gpt-4o',
    imageText: 'gpt-4o',
    embedding: 'text-embedding-3-small',
    audioTranscript: 'whisper-1',
    fileTranscript: 'gpt-4o',
  };

  isConfigured(): boolean {
    const configured = !!this.config.apiKey;
    console.log(
      `🔧 OpenAI service configured: ${configured}, apiKey: ${this.config.apiKey ? '***PRESENT***' : 'MISSING'}`
    );
    return configured;
  }

  private async makeRequest(
    endpoint: string,
    body: any,
    headers: Record<string, string> = {}
  ): Promise<any> {
    const baseUrl = this.config.baseUrl || 'https://api.openai.com/v1';
    const url = `${baseUrl}${endpoint}`;

    console.log(`🌐 Making OpenAI API request to: ${url}`);
    console.log('📤 Request body:', body);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    });

    console.log(
      `📥 Response status: ${response.status} ${response.statusText}`
    );

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ error: 'Unknown error' }));
      console.log('❌ OpenAI API error:', error);
      throw new Error(
        `OpenAI API error: ${error.error?.message || error.error || 'Unknown error'}`
      );
    }

    const result = await response.json();
    console.log('✅ OpenAI API response received:', result);
    return result;
  }

  async generateTags(content: string, contentType: string): Promise<string[]> {
    console.log(
      `🏷️ Generating tags for ${contentType} content (${content.length} chars)`
    );

    if (!this.isConfigured()) {
      console.log('❌ OpenAI service not configured, returning empty tags');
      return [];
    }

    const prompt = `Analyze the following ${contentType} content and generate 3-7 relevant tags that categorize and describe it. 

Return only the tags as a JSON array of strings, nothing else.

Content:
${content}`;

    try {
      const response = await this.makeRequest('/chat/completions', {
        model: this.config.textModelName || this.defaultModels.text,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: 150,
        temperature: 0.3,
      });

      const result = response.choices[0]?.message?.content?.trim();
      if (!result) return [];

      // Clean up the response (remove markdown code blocks if present)
      const cleanResult = result
        .replace(/^```json\s*/, '')
        .replace(/\s*```$/, '');

      // Parse the JSON response
      const tags = JSON.parse(cleanResult);
      return Array.isArray(tags) ? tags.slice(0, 7) : [];
    } catch (error) {
      console.error('Failed to generate tags:', error);
      return [];
    }
  }

  async generateSummary(content: string, contentType: string): Promise<string> {
    if (!this.isConfigured()) {
      return '';
    }

    const prompt = `Analyze the following ${contentType} content and create a concise 2-line summary that captures the main points or essence.

Keep it under 200 characters total. Be direct and informative.

Content:
${content}`;

    try {
      const response = await this.makeRequest('/chat/completions', {
        model: this.config.textModelName || this.defaultModels.text,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: 100,
        temperature: 0.3,
      });

      return response.choices[0]?.message?.content?.trim() || '';
    } catch (error) {
      console.error('Failed to generate summary:', error);
      return '';
    }
  }

  async transcribeAudio(
    audioBuffer: Buffer,
    mimeType: string
  ): Promise<string> {
    if (!this.isConfigured()) {
      return '';
    }

    try {
      // Create a form data payload for audio transcription
      const formData = new FormData();
      const blob = new Blob([audioBuffer], { type: mimeType });
      formData.append('file', blob, 'audio.wav');
      formData.append(
        'model',
        this.config.audioTranscriptModelName ||
          this.defaultModels.audioTranscript
      );

      const baseUrl = this.config.baseUrl || 'https://api.openai.com/v1';
      const response = await fetch(`${baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const error = await response
          .json()
          .catch(() => ({ error: 'Unknown error' }));
        throw new Error(
          `OpenAI transcription error: ${error.error?.message || 'Unknown error'}`
        );
      }

      const result = await response.json();
      return result.text || '';
    } catch (error) {
      console.error('Failed to transcribe audio:', error);
      return '';
    }
  }

  async transcribeDocument(content: string): Promise<string> {
    if (!this.isConfigured()) {
      return '';
    }

    const prompt = `Extract and clean up the text content from this document. 

Remove any formatting artifacts, headers, footers, and page numbers. Focus on the main content and present it in a clean, readable format.

Document content:
${content}`;

    try {
      const response = await this.makeRequest('/chat/completions', {
        model:
          this.config.fileTranscriptModelName ||
          this.defaultModels.fileTranscript,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: 2000,
        temperature: 0.1,
      });

      return response.choices[0]?.message?.content?.trim() || '';
    } catch (error) {
      console.error('Failed to transcribe document:', error);
      return '';
    }
  }

  async analyzeImage(
    imageBuffer: Buffer,
    mimeType: string
  ): Promise<{
    description: string;
    tags: string[];
  }> {
    if (!this.isConfigured()) {
      return { description: '', tags: [] };
    }

    // Convert image to base64 for OpenAI vision API
    const base64Image = imageBuffer.toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64Image}`;

    const prompt = `Analyze this image and provide:
1. A concise 2-line description (under 200 characters)
2. 3-7 relevant tags that describe the content

Return the response as JSON in this exact format:
{
  "description": "your 2-line description here",
  "tags": ["tag1", "tag2", "tag3"]
}`;

    try {
      const response = await this.makeRequest('/chat/completions', {
        model: this.config.imageTextModelName || this.defaultModels.imageText,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: prompt,
              },
              {
                type: 'image_url',
                image_url: {
                  url: dataUrl,
                },
              },
            ],
          },
        ],
        max_tokens: 300,
        temperature: 0.3,
      });

      const result = response.choices[0]?.message?.content?.trim();
      if (!result) return { description: '', tags: [] };

      // Clean up the response (remove markdown code blocks if present)
      const cleanResult = result
        .replace(/^```json\s*/, '')
        .replace(/\s*```$/, '');

      const parsed = JSON.parse(cleanResult);
      return {
        description: parsed.description || '',
        tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 7) : [],
      };
    } catch (error) {
      console.error('Failed to analyze image:', error);
      return { description: '', tags: [] };
    }
  }

  async extractPdfContent(pdfBuffer: Buffer): Promise<string> {
    if (!this.isConfigured()) {
      return '';
    }

    try {
      // Convert PDF to base64 for OpenAI API
      const base64Pdf = pdfBuffer.toString('base64');
      const dataUrl = `data:application/pdf;base64,${base64Pdf}`;

      const prompt = `Extract all the text content from this PDF document. 
      
Please provide the text in a clean, readable format:
- Maintain paragraph structure and logical flow
- Remove headers, footers, page numbers, and formatting artifacts
- Preserve important structural elements like headings and lists
- Focus on the main content that would be useful for search and summarization

Return only the extracted text content, nothing else.`;

      const response = await this.makeRequest('/chat/completions', {
        model:
          this.config.fileTranscriptModelName ||
          this.defaultModels.fileTranscript,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: prompt,
              },
              {
                type: 'image_url',
                image_url: {
                  url: dataUrl,
                },
              },
            ],
          },
        ],
        max_tokens: 4000,
        temperature: 0.1,
      });

      return response.choices[0]?.message?.content?.trim() || '';
    } catch (error) {
      console.error('Failed to extract PDF content:', error);
      return '';
    }
  }

  async extractUrlContent(url: string): Promise<{
    content: string;
    description: string;
    tags: string[];
  }> {
    if (!this.isConfigured()) {
      return { content: '', description: '', tags: [] };
    }

    try {
      // Fetch the URL content
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; TeakBot/1.0)',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch URL: ${response.status}`);
      }

      const html = await response.text();

      // Extract text content from HTML (basic extraction)
      const textContent = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 4000); // Limit content length

      const prompt = `Analyze this web page content and provide:
1. A concise 2-line description (under 200 characters)
2. 3-7 relevant tags that categorize the content

Return the response as JSON in this exact format:
{
  "description": "your 2-line description here",
  "tags": ["tag1", "tag2", "tag3"]
}

Web page content:
${textContent}`;

      const aiResponse = await this.makeRequest('/chat/completions', {
        model: this.config.textModelName || this.defaultModels.text,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: 300,
        temperature: 0.3,
      });

      const result = aiResponse.choices[0]?.message?.content?.trim();
      if (!result) return { content: textContent, description: '', tags: [] };

      // Clean up the response (remove markdown code blocks if present)
      const cleanResult = result
        .replace(/^```json\s*/, '')
        .replace(/\s*```$/, '');

      const parsed = JSON.parse(cleanResult);
      return {
        content: textContent,
        description: parsed.description || '',
        tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 7) : [],
      };
    } catch (error) {
      console.error('Failed to extract URL content:', error);
      return { content: '', description: '', tags: [] };
    }
  }
}
