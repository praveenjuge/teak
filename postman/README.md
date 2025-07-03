# Teak API Postman Collection

This directory contains a comprehensive Postman collection for testing the Teak API, along with environment files for different deployment scenarios.

## Files

- **`Teak-API.postman_collection.json`** - Main collection with all API endpoints
- **`Teak-Local.postman_environment.json`** - Environment for local development (localhost:3001)
- **`Teak-Production.postman_environment.json`** - Template for production environment

## How to Import

### 1. Import Collection
1. Open Postman
2. Click **Import** button
3. Select **Upload Files**
4. Choose `Teak-API.postman_collection.json`
5. Click **Import**

### 2. Import Environment
1. In Postman, click the **Environment** tab
2. Click **Import**
3. Select `Teak-Local.postman_environment.json` (or production)
4. Click **Import**
5. Select the imported environment from the dropdown

### 3. For Production
1. Import `Teak-Production.postman_environment.json`
2. Update the `baseUrl` variable with your production domain
3. Update user credentials as needed

## Collection Structure

### 🔐 Authentication
- **Sign Up** - Create new user account
- **Sign In** - Login with email/password
- **Get Session** - Retrieve current session info
- **Sign Out** - Logout and clear session

### 📋 Cards Management
- **List All Cards** - Get paginated list with search/filter
- **Search Cards** - Advanced full-text search with ranking
- **Get Card by ID** - Retrieve specific card
- **Create Text Card** - Create text content card
- **Create Audio Card** - Create audio with transcription
- **Create URL Card** - Create URL bookmark with metadata
- **Create Image Card** - Create image with description
- **Create Video Card** - Create video with transcription
- **Update Card** - Modify existing card
- **Delete Card** - Soft delete card
- **Get Card Statistics** - View card counts by type

### 🔧 Utility
- **Health Check** - Verify API status
- **Protected Route Test** - Test authentication

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `baseUrl` | API base URL | `http://localhost:3001` |
| `userEmail` | Test user email | `test@example.com` |
| `userName` | Test user name | `Test User` |
| `userPassword` | Test password | `password123` |
| `sessionToken` | Auto-populated session token | (auto-filled) |
| `cardId` | Card ID for testing | `1` |
| `lastCreatedCardId` | Last created card ID | (auto-filled) |
| `limit` | Pagination limit | `10` |
| `offset` | Pagination offset | `0` |

## Usage Workflow

### 1. Authentication Flow
1. Run **Sign Up** to create a new user (or use existing)
2. Session token is automatically saved to environment
3. All subsequent requests use this token automatically

### 2. Testing Cards
1. Run **Create Text Card** (or other card types)
2. The card ID is saved as `lastCreatedCardId`
3. Test **Update Card** and **Delete Card** using this ID
4. Use **List All Cards** to see all cards
5. Test **Search Cards** with different queries

### 3. Search Examples
- Search for "React": `{{baseUrl}}/api/cards/search?q=React`
- Filter by type: `{{baseUrl}}/api/cards?type=audio`
- Pagination: `{{baseUrl}}/api/cards?limit=5&offset=10`

## Card Types & Data Structures

### Text Card
```json
{
  "type": "text",
  "data": {
    "content": "Your text content here",
    "title": "Optional title"
  },
  "metaInfo": {
    "tags": ["tag1", "tag2"],
    "source": "Source name"
  }
}
```

### Audio Card
```json
{
  "type": "audio",
  "data": {
    "transcription": "Audio transcription text",
    "media_url": "https://example.com/audio.mp3",
    "duration": 180,
    "title": "Audio title"
  },
  "metaInfo": {
    "language": "en",
    "playtime": "00:03:00"
  }
}
```

### URL Card
```json
{
  "type": "url",
  "data": {
    "url": "https://example.com",
    "title": "Page title",
    "description": "Page description"
  }
}
```

### Image Card
```json
{
  "type": "image",
  "data": {
    "media_url": "https://example.com/image.jpg",
    "alt_text": "Image description",
    "title": "Image title",
    "description": "Detailed description"
  }
}
```

### Video Card
```json
{
  "type": "video",
  "data": {
    "media_url": "https://example.com/video.mp4",
    "transcription": "Video transcription",
    "duration": 300,
    "title": "Video title"
  }
}
```

## Authentication

The collection uses **Better Auth** session-based authentication:
- Sessions are managed via cookies
- Session token is automatically extracted and stored
- All protected routes use the stored session token
- Token persists across requests in the same environment

## Testing Tips

1. **Start with Health Check** to verify API is running
2. **Sign Up first** to create a test user
3. **Session tokens** are automatically managed
4. **Create cards** before testing search functionality
5. **Use variables** like `{{lastCreatedCardId}}` for dynamic testing
6. **Check response tests** to verify API behavior

## Troubleshooting

### Common Issues
- **401 Unauthorized**: Run Sign In/Sign Up first
- **404 Not Found**: Check if the API server is running
- **400 Bad Request**: Verify request body structure matches schema

### Environment Setup
- Ensure the correct environment is selected
- Verify `baseUrl` points to running API server
- Check that user credentials are valid

## Need Help?

- Check the **Tests** tab in each request for validation examples
- Look at **Pre-request Scripts** for automation logic
- Review response examples in the collection
- Ensure your API server matches the expected endpoints