# File Upload Docker Persistence Implementation

## Problem Analysis
Currently, the backend uploads files to `./uploads` directory. In Docker, this directory is inside the container, so when the container is killed/restarted, all uploaded files are lost. We need a solution that:
- Makes uploads directory persist across Docker restarts
- Maintains compatibility with local development
- Keeps implementation simple

## Current Implementation
- Files uploaded to `./uploads` with date-based structure (`uploads/YYYY/MM/DD/filename`)
- Files served via `/api/uploads/*` endpoint
- LocalFileUploadService handles file storage
- No Docker volume mounting currently exists

## Implementation Plan

### ✅ 1. Analyze current file upload implementation and Docker setup
- [COMPLETED] Researched existing file upload system
- [COMPLETED] Identified LocalFileUploadService and file upload middleware
- [COMPLETED] Found Docker configuration but no volume mounting

### ⏳ 2. Create docker-compose.yml file with volume mounting for uploads
- Create docker-compose.yml in project root
- Add volume mounting for uploads directory
- Configure services for backend and other components

### ⏳ 3. Add environment variable configuration for upload path
- Add UPLOAD_PATH environment variable support
- Default to `./uploads` for local development
- Allow Docker to override with mounted path

### ⏳ 4. Update backend to use configurable upload path
- Modify LocalFileUploadService to use environment-based path
- Update static file serving configuration
- Ensure path resolution works correctly

### ⏳ 5. Test the solution locally without Docker
- Verify uploads still work with default `./uploads` path
- Test file upload and serving endpoints
- Ensure no regression in local development

### ⏳ 6. Test the solution with Docker compose
- Build and run with docker-compose
- Test file persistence across container restarts
- Verify file upload and serving works in Docker

### ⏳ 7. Document the changes and usage
- Update any relevant documentation
- Document environment variables
- Add docker-compose usage instructions

## Expected Outcome
- Files persist across Docker container restarts
- Local development continues to work without changes
- Minimal code changes required
- Simple docker-compose configuration for deployment

## Implementation Complete ✅

### Changes Made:

#### 1. Docker Compose Configuration (`docker/docker-compose.yml`)
- Added `UPLOAD_PATH=/app/uploads` environment variable
- Added volume mounting: `uploads_data:/app/uploads`
- Created persistent volume: `uploads_data` with local driver

#### 2. Backend Environment Configuration
- Updated `LocalFileUploadService.ts:14` - Constructor now uses `process.env.UPLOAD_PATH || './uploads'`
- Updated `index.ts:92` - Static file serving uses `process.env.UPLOAD_PATH || './uploads'`
- Updated `index.ts:129` - Test endpoint uses configurable upload path

#### 3. File Persistence Solution
- **Local Development**: Files stored in `./uploads` (default behavior unchanged)
- **Docker Production**: Files stored in persistent Docker volume mounted at `/app/uploads`
- **Environment Variable**: `UPLOAD_PATH` allows configuration of upload directory

### Usage:

#### Local Development (unchanged):
```bash
cd backend
bun dev
# Files uploaded to ./uploads as before
```

#### Docker Development/Production:
```bash
cd docker
docker-compose up --build
# Files uploaded to persistent Docker volume
# Volume persists across container restarts
```

### Verification:
- ✅ Local backend tested successfully
- ✅ Docker compose builds and runs successfully  
- ✅ Persistent volume `docker_uploads_data` created
- ✅ Volume mounted at `/app/uploads` in container
- ✅ Environment variables configured correctly

### Technical Details:
- **Volume Location**: `/var/lib/docker/volumes/docker_uploads_data/_data`
- **Container Path**: `/app/uploads`
- **Environment Variable**: `UPLOAD_PATH=/app/uploads`
- **Backward Compatibility**: Maintained for local development

**Status**: ✅ Implementation complete and tested

---

## Local Development Docker Environment Update

### Additional Implementation - Complete Development Environment

Following the persistent file uploads implementation, I created a complete local development Docker environment with hot reloading capabilities:

#### New Features Added:

1. **Complete Development Environment** (`docker/docker-compose.dev.yml`):
   - PostgreSQL database with health checks
   - Backend with hot reloading and volume mounting
   - Frontend with hot reloading and volume mounting
   - Automatic database migration and seeding
   - Proper Docker networking between services

2. **Enhanced Backend Configuration**:
   - Fixed TypeScript type errors with proper environment variable access
   - Updated all `process.env.UPLOAD_PATH` to `process.env['UPLOAD_PATH']`
   - Removed unused imports and variables

3. **Frontend Development Setup**:
   - Updated Vite configuration for Docker networking
   - Fixed API proxy configuration for container communication
   - Resolved dependency optimization warnings
   - Fixed API base URL to use relative paths

4. **Database and Authentication**:
   - Enhanced seed script with demo user creation
   - Fixed Better Auth compatibility issues
   - Automated migration runner on startup
   - Added comprehensive sample data

#### Usage:

```bash
# Start complete development environment
docker-compose -f docker/docker-compose.dev.yml up --build

# Stop development environment  
docker-compose -f docker/docker-compose.dev.yml down

# View logs
docker-compose -f docker/docker-compose.dev.yml logs -f backend
docker-compose -f docker/docker-compose.dev.yml logs -f frontend
```

#### Demo User Access:
- Email: `demo@teak.dev`
- Register through frontend with any password
- Demo cards automatically appear after registration

#### Testing Results:
- ✅ All containers start successfully and pass health checks
- ✅ Database connection and migrations work correctly
- ✅ Backend API endpoints respond properly
- ✅ Frontend serves and proxies API requests correctly
- ✅ Hot reloading works for both backend and frontend
- ✅ File uploads persist across container restarts
- ✅ TypeScript type checking passes (`bunx tsc --noEmit`)
- ✅ Authentication system works correctly

#### Key Benefits:
1. **One-Command Setup**: Complete development environment starts with single command
2. **Hot Reloading**: Both backend and frontend automatically reload on file changes
3. **Persistent Storage**: Files and database data persist across container restarts
4. **Proper Networking**: Frontend proxy configuration works with Docker networking
5. **Automated Setup**: Database migrations and seeding happen automatically

**Final Status**: ✅ All tasks completed successfully with comprehensive testing and documentation

---

# File Upload S3 Integration Analysis and Plan

## Current File Upload System Analysis

### Current Architecture
The Teak application currently uses a **local file storage system** with the following components:

#### 1. Upload Routes and Endpoints
- **Main upload endpoint**: `POST /api/cards` with `multipart/form-data` support
- **File serving endpoint**: `/api/uploads/*` - serves uploaded files statically
- **Upload middleware**: `fileUploadMiddleware` in `/Users/praveenjuge/Projects/teak/backend/src/middleware/fileUpload.ts`

#### 2. File Storage Logic
- **Service abstraction**: `FileUploadService` (abstract base class)
- **Local implementation**: `LocalFileUploadService` extends `FileUploadService`
- **Storage location**: `./uploads` directory (configurable via `UPLOAD_PATH` env var)
- **File organization**: Date-based structure `YYYY/MM/DD/timestamp-random.extension`
- **File serving**: Static file serving via Hono's `serveStatic` middleware

#### 3. File Processing Components
- **Card processors**: Type-specific processors for audio, video, image cards
  - `AudioCardProcessor` - handles audio files, extracts metadata with ffprobe
  - `VideoCardProcessor` - handles video files, extracts metadata with ffprobe  
  - `ImageCardProcessor` - handles image files, extracts dimensions
- **File validation**: MIME type checking, file size limits
- **Metadata extraction**: Audio/video duration, bitrate, dimensions, etc.

#### 4. Current Directory Structure
```
backend/
├── src/
│   ├── middleware/fileUpload.ts          # Upload middleware
│   ├── services/file/
│   │   ├── FileUploadService.ts          # Abstract base class
│   │   └── LocalFileUploadService.ts     # Local storage implementation
│   ├── services/card/
│   │   ├── CardProcessor.ts              # Base processor
│   │   ├── AudioCardProcessor.ts         # Audio file processor
│   │   ├── VideoCardProcessor.ts         # Video file processor
│   │   ├── ImageCardProcessor.ts         # Image file processor
│   │   └── CardService.ts                # Main card service
│   ├── routes/cards.ts                   # Upload endpoints
│   └── schemas/fileUpload.ts             # Validation schemas
└── uploads/                              # Local storage directory
    └── 2025/07/06/                      # Date-based organization
```

#### 5. Storage Abstraction Quality
The codebase has **excellent abstraction** for storage services:
- Abstract `FileUploadService` base class with clean interface
- Pluggable design allowing easy swapping of storage implementations
- Consistent `UploadedFile` interface across all processors
- Clear separation between file upload and card processing logic

## S3 Integration Plan

### Phase 1: Create S3 File Upload Service
- [ ] Install AWS SDK v3 (`@aws-sdk/client-s3`)
- [ ] Create `S3FileUploadService` class extending `FileUploadService`
- [ ] Implement S3 upload with proper error handling
- [ ] Add S3 configuration (bucket, region, credentials)
- [ ] Maintain same `UploadedFile` interface for compatibility

### Phase 2: Update Card Processors
- [ ] Modify `AudioCardProcessor` to use configurable file upload service
- [ ] Modify `VideoCardProcessor` to use configurable file upload service  
- [ ] Modify `ImageCardProcessor` to use configurable file upload service
- [ ] Ensure metadata extraction still works with S3 URLs

### Phase 3: Configuration and Environment
- [ ] Add S3 environment variables (bucket name, region, access keys)
- [ ] Create service factory to choose between Local and S3 storage
- [ ] Update Docker configuration for S3 environment variables
- [ ] Add fallback mechanism for development (local storage)

### Phase 4: File Serving Updates
- [ ] Update URL generation for S3 files (direct S3 URLs vs presigned URLs)
- [ ] Remove local file serving middleware when using S3
- [ ] Handle CORS for S3 bucket access
- [ ] Update file deletion logic for S3

### Phase 5: Migration and Testing
- [ ] Create migration script for existing files (optional)
- [ ] Update Postman collection with S3 examples
- [ ] Test all media types (audio, video, image) with S3
- [ ] Verify metadata extraction works with S3 storage
- [ ] Run TypeScript checks (`bunx tsc --noEmit`)

## Key Files to Modify

### Core Service Files
1. `/Users/praveenjuge/Projects/teak/backend/src/services/file/S3FileUploadService.ts` (NEW)
2. `/Users/praveenjuge/Projects/teak/backend/src/services/card/AudioCardProcessor.ts`
3. `/Users/praveenjuge/Projects/teak/backend/src/services/card/VideoCardProcessor.ts`  
4. `/Users/praveenjuge/Projects/teak/backend/src/services/card/ImageCardProcessor.ts`
5. `/Users/praveenjuge/Projects/teak/backend/src/services/index.ts`

### Configuration Files
6. `/Users/praveenjuge/Projects/teak/backend/package.json` (add AWS SDK)
7. `/Users/praveenjuge/Projects/teak/docker/docker-compose.yml` (S3 env vars)
8. `/Users/praveenjuge/Projects/teak/docker/docker-compose.dev.yml` (S3 env vars)

### Optional Updates
9. `/Users/praveenjuge/Projects/teak/backend/src/index.ts` (remove static file serving for S3)
10. `/Users/praveenjuge/Projects/teak/postman/Teak-API.postman_collection.json`

## Benefits of Current Architecture

1. **Clean Abstraction**: The `FileUploadService` abstract class makes S3 integration straightforward
2. **Minimal Changes**: Only need to create new S3 service and inject it into processors
3. **Backward Compatibility**: Can maintain local storage for development environments
4. **Type Safety**: Strong TypeScript interfaces ensure consistency
5. **Metadata Preservation**: All existing metadata extraction logic will work unchanged

## Recommendations

1. **Gradual Migration**: Implement S3 as an optional storage backend first
2. **Environment-Based**: Use environment variables to choose storage type
3. **Dual Support**: Keep both local and S3 implementations for flexibility
4. **Presigned URLs**: Consider using presigned URLs for secure file access
5. **CDN Integration**: S3 can be paired with CloudFront for better performance

The current codebase is well-architected for this integration with minimal breaking changes required.