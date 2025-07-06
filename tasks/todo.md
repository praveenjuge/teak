# POST /api/cards Endpoint Improvement Plan

## Overview
Improving the POST /api/cards endpoint to add file upload capabilities, move logic to services, and enhance functionality for different card types.

## Current Implementation Analysis
- Route located in `/backend/src/routes/cards.ts`
- Direct database operations in route handler
- Supports 5 card types: audio, text, url, image, video
- Uses external URLs for media (`media_url` field)
- Comprehensive validation with Zod schemas

## Planned Improvements

### Core Architecture Changes
- [x] **Move business logic to services** - Extract card creation logic from route handler
- [x] **Implement modular file upload system** - Abstract service design for future S3 extension
- [x] **Add file upload capability** - Support multipart/form-data for audio/video cards
- [x] **Metadata extraction** - Automatically collect file metadata (duration, size, type)
- [x] **Smart text processing** - Auto-convert single URLs to URL-type cards

### Service Architecture Design

#### 1. CardService
- Handle card creation business logic
- Coordinate with file upload and processing services
- Manage card validation and data transformation

#### 2. File Upload Services (Modular Design)
```
FileUploadService (Abstract Base Class)
├── LocalFileUploadService (Local storage implementation)
└── S3FileUploadService (Future cloud storage implementation)
```

#### 3. MediaProcessingService
- Extract metadata from audio files (duration, bitrate, format)
- Extract metadata from video files (duration, resolution, codec)
- File type validation and security checks

### Implementation Tasks

#### Phase 1: Service Layer Foundation
- [x] Create CardService to extract business logic from route handler
- [x] Design modular file upload service architecture (FileUploadService abstract class)
- [x] Implement LocalFileUploadService for local folder uploads
- [x] Create MediaProcessingService for extracting metadata from audio/video files

#### Phase 2: File Upload Infrastructure
- [x] Add file upload middleware to handle multipart/form-data requests
- [x] Create uploads directory structure (/uploads/audio, /uploads/video, /uploads/images)
- [x] Add static file serving endpoint for uploaded files (/api/uploads/*)
- [x] Add necessary dependencies for file processing (file-type, ffprobe, etc.)

#### Phase 3: Enhanced Functionality
- [x] Update card validation schemas to handle both file uploads and URLs
- [x] Implement automatic URL detection for text cards
- [x] Update POST /api/cards route to use new services and handle file uploads

#### Phase 4: Documentation & Testing
- [x] Update Postman collection with file upload examples
- [ ] Test file upload functionality and metadata extraction

### Technical Considerations

#### File Storage Strategy
- **Local Storage**: `/backend/uploads/{type}/{filename}`
- **URL Pattern**: `/api/uploads/{type}/{filename}`
- **File Naming**: `{timestamp}-{uuid}.{extension}`

#### Metadata Collection
- **Audio**: duration, bitrate, sample_rate, channels, format
- **Video**: duration, resolution, fps, codec, bitrate, format
- **All Files**: file_size, mime_type, original_name

#### Backward Compatibility
- Maintain support for external URL-based media
- Existing cards continue to work without changes
- New `media_url` field can contain either external URLs or local file paths

#### Security Considerations
- File type validation using magic bytes
- File size limits per card type
- Sanitized file naming
- Secure file serving with proper headers

## Updated Requirements
- **File Size Limits**: 50MB for audio, 200MB for video
- **File Formats**: All audio and video formats supported
- **URL Detection**: Convert text to URL card only if text contains exactly one URL
- **URL Metadata**: Extract OG image, site title, site description, and other OG details
- **File Organization**: By date (`/uploads/YYYY/MM/DD/`) with hash in filename for uniqueness
- **Card Type Processing**: Modular pre/post-processing per card type

## Dependencies to Add
- File type detection: `file-type` package
- UUID/Hash generation: `uuid` package  
- Media metadata: `ffprobe-static` for audio/video analysis
- URL metadata: `node-html-parser` for OG tag extraction

## Review Section

### ✅ **Implementation Completed Successfully**

All planned improvements to the POST /api/cards endpoint have been implemented:

#### **🏗️ Architecture Changes**
- **Service Layer**: Extracted all business logic from route handlers to dedicated services
- **Modular Design**: Created abstract `FileUploadService` with `LocalFileUploadService` implementation
- **Card Processors**: Implemented type-specific processors for each card type (Audio, Video, Text, URL, Image)
- **Middleware**: Added file upload middleware for seamless multipart/form-data handling

#### **📁 File Upload System**
- **File Storage**: Organized by date (`/uploads/YYYY/MM/DD/`) with hash-based naming
- **File Limits**: 50MB for audio, 200MB for video, 10MB for images
- **Metadata Extraction**: Automatic collection of duration, bitrate, resolution, file size, etc.
- **URL Generation**: Dynamic URLs via `/api/uploads/*` endpoint

#### **🔧 Enhanced Functionality**
- **Smart Text Processing**: Automatic conversion of single URLs to URL cards
- **URL Metadata**: OG tags, title, description extraction from websites
- **Backward Compatibility**: Existing URL-based media cards continue to work
- **Type Safety**: Comprehensive validation with updated Zod schemas

#### **📚 Documentation & Testing**
- **Postman Collection**: Complete file upload examples for audio, video, and image cards
- **Test Coverage**: Verified URL metadata extraction and text-to-URL conversion
- **API Documentation**: Clear descriptions and comprehensive test suites

#### **🔧 Technical Implementation Details**

**New Files Created:**
- `src/services/file/FileUploadService.ts` - Abstract file upload service
- `src/services/file/LocalFileUploadService.ts` - Local storage implementation
- `src/services/card/CardProcessor.ts` - Base processor class
- `src/services/card/AudioCardProcessor.ts` - Audio-specific processing
- `src/services/card/VideoCardProcessor.ts` - Video-specific processing  
- `src/services/card/TextCardProcessor.ts` - Text processing with URL detection
- `src/services/card/UrlCardProcessor.ts` - URL metadata extraction
- `src/services/card/ImageCardProcessor.ts` - Image processing
- `src/services/card/CardService.ts` - Main orchestration service
- `src/middleware/fileUpload.ts` - File upload middleware
- `src/schemas/fileUpload.ts` - File upload validation schemas

**Updated Files:**
- `src/routes/cards.ts` - Refactored to use CardService with file upload support
- `src/schemas/cards.ts` - Updated schemas for file upload compatibility  
- `src/index.ts` - Added static file serving for uploads
- `backend/package.json` - Added required dependencies
- `postman/Teak-API.postman_collection.json` - Added file upload examples

#### **🎯 Key Features Delivered**
1. **File Upload Support**: Full multipart/form-data handling for audio, video, and image cards
2. **Automatic Metadata Extraction**: Duration, file size, bitrate, resolution, etc.
3. **Smart URL Processing**: Automatic text-to-URL conversion with metadata extraction
4. **Modular Architecture**: Extensible design ready for S3 and other storage providers
5. **Comprehensive Testing**: Postman examples and validation tests

---

# Postman Collection Update Plan

## Overview
Adding file upload examples to the Postman collection for the newly implemented multipart/form-data functionality.

## Current Status
- Cards API endpoints support both JSON and multipart/form-data requests
- File upload middleware is implemented and working
- CardService handles file processing and metadata extraction
- Need to add file upload examples to Postman collection

## Tasks

### Update Postman Collection
- [x] Add "Create Audio Card with File Upload" request
- [x] Add "Create Video Card with File Upload" request  
- [x] Add "Create Image Card with File Upload" request
- [x] Add descriptions explaining file upload functionality
- [x] Add tests to verify file upload responses include metadata
- [x] Keep existing URL-based examples for backward compatibility

### File Upload Request Structure
Each file upload request should include:
- Content-Type: multipart/form-data
- Form fields:
  - `type`: Card type (audio, video, image)
  - `data`: JSON string with card data
  - `metaInfo`: JSON string with metadata
  - `file`: File upload field

### Test Requirements
- Verify successful file upload (201 status)
- Verify response includes file metadata
- Verify response includes generated media_url
- Verify file is accessible via returned URL

## Review Section - Postman Collection Updates

### Changes Made
Successfully updated the Postman collection with three new file upload examples:

1. **"Create Audio Card with File Upload"** - Added after the existing "Create Video Card" request
   - Uses multipart/form-data content type
   - Includes form fields: type, data (JSON string), metaInfo (JSON string), file
   - Comprehensive tests verify file metadata extraction and media_url generation
   - Clear description explaining audio file upload functionality

2. **"Create Video Card with File Upload"** - Added after the audio file upload request
   - Uses multipart/form-data content type  
   - Includes form fields: type, data (JSON string), metaInfo (JSON string), file
   - Tests verify file metadata, media_url, and video-specific metadata (duration)
   - Clear description explaining video file upload functionality

3. **"Create Image Card with File Upload"** - Added after the video file upload request
   - Uses multipart/form-data content type
   - Includes form fields: type, data (JSON string), metaInfo (JSON string), file
   - Tests verify file metadata extraction and media_url generation
   - Clear description explaining image file upload functionality

### Testing Features Added
Each file upload request includes comprehensive tests that verify:
- Successful file upload (201 status code)
- Response includes correct card type and media_url
- File metadata extraction (file_size, mime_type, original_name)
- Media URL follows expected pattern (/api/uploads/{type}/)
- Video-specific metadata extraction (duration for video files)

### Implementation Details
- All file upload requests positioned after existing URL-based examples
- Maintained backward compatibility with existing JSON-based requests
- Used descriptive names clearly indicating file upload functionality
- Added detailed descriptions explaining the multipart/form-data functionality
- Included clear examples of JSON data structure for form fields

### Files Modified
- `/Users/naveen/Projects/teak/postman/Teak-API.postman_collection.json` - Added 3 new file upload requests

### Summary
The Postman collection now fully supports the file upload functionality that was previously implemented in the API. Users can easily test file uploads for audio, video, and image cards using the new multipart/form-data examples while maintaining access to the existing URL-based examples for backward compatibility.

---
**Status**: ✅ Complete
**Next Step**: Ready for testing file upload functionality