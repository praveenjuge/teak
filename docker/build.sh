#!/bin/bash

# Build script for Teak single-image Docker deployment
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🐳 Teak Docker Build Script${NC}"
echo -e "${BLUE}================================${NC}"

# Default values
IMAGE_NAME="teak"
TAG="latest"
PUSH_TO_HUB=false
DOCKER_USERNAME=""
BUILD_ONLY=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -n|--name)
            IMAGE_NAME="$2"
            shift 2
            ;;
        -t|--tag)
            TAG="$2"
            shift 2
            ;;
        -u|--username)
            DOCKER_USERNAME="$2"
            PUSH_TO_HUB=true
            shift 2
            ;;
        -p|--push)
            PUSH_TO_HUB=true
            shift
            ;;
        -b|--build-only)
            BUILD_ONLY=true
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  -n, --name NAME        Image name (default: teak)"
            echo "  -t, --tag TAG          Image tag (default: latest)"
            echo "  -u, --username USER    Docker Hub username (enables push)"
            echo "  -p, --push             Push to Docker Hub (requires username)"
            echo "  -b, --build-only       Build only, don't run tests"
            echo "  -h, --help             Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0                                    # Build teak:latest"
            echo "  $0 -n myapp -t v1.0.0               # Build myapp:v1.0.0"
            echo "  $0 -u myuser -t v1.0.0 -p           # Build and push myuser/teak:v1.0.0"
            exit 0
            ;;
        *)
            echo -e "${RED}❌ Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

# Build the full image name
if [[ -n "$DOCKER_USERNAME" ]]; then
    FULL_IMAGE_NAME="$DOCKER_USERNAME/$IMAGE_NAME:$TAG"
    LATEST_IMAGE_NAME="$DOCKER_USERNAME/$IMAGE_NAME:latest"
else
    FULL_IMAGE_NAME="$IMAGE_NAME:$TAG"
    LATEST_IMAGE_NAME="$IMAGE_NAME:latest"
fi

echo -e "${YELLOW}📋 Build Configuration:${NC}"
echo "  Image: $FULL_IMAGE_NAME"
echo "  Build context: $(pwd)/.."
echo "  Dockerfile: docker/Dockerfile"
echo "  Push to hub: $PUSH_TO_HUB"
echo ""

# Verify we're in the right directory
if [[ ! -f "../package.json" ]]; then
    echo -e "${RED}❌ Error: Must run from docker directory${NC}"
    echo "Current directory: $(pwd)"
    exit 1
fi

# Check Docker is running
if ! docker info >/dev/null 2>&1; then
    echo -e "${RED}❌ Error: Docker is not running${NC}"
    exit 1
fi

# Build the image
echo -e "${YELLOW}🔨 Building Docker image...${NC}"
docker build \
    -f Dockerfile \
    -t "$FULL_IMAGE_NAME" \
    -t "$LATEST_IMAGE_NAME" \
    ..

if [[ $? -ne 0 ]]; then
    echo -e "${RED}❌ Build failed!${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Build completed successfully!${NC}"

# Display image info
echo -e "${YELLOW}📊 Image Information:${NC}"
docker images "$IMAGE_NAME" --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedAt}}"

if [[ "$BUILD_ONLY" == "true" ]]; then
    echo -e "${BLUE}🏁 Build complete (skipping tests and push)${NC}"
    exit 0
fi

# Test the image
echo -e "${YELLOW}🧪 Testing the built image...${NC}"

# Check if the image can start
echo "  Testing image startup..."
CONTAINER_ID=$(docker run -d \
    -e DATABASE_URL="postgresql://test:test@localhost:5432/test" \
    -e BETTER_AUTH_SECRET="test-secret-for-build-test" \
    -e BETTER_AUTH_URL="http://localhost:80" \
    "$FULL_IMAGE_NAME" || echo "failed")

if [[ "$CONTAINER_ID" == "failed" ]]; then
    echo -e "${RED}❌ Container failed to start${NC}"
    exit 1
fi

# Wait a moment for startup
sleep 5

# Check if container is still running
if docker ps -q --filter "id=$CONTAINER_ID" | grep -q .; then
    echo -e "${GREEN}✅ Container started successfully${NC}"
    docker stop "$CONTAINER_ID" >/dev/null
    docker rm "$CONTAINER_ID" >/dev/null
else
    echo -e "${RED}❌ Container exited unexpectedly${NC}"
    echo "Logs:"
    docker logs "$CONTAINER_ID"
    docker rm "$CONTAINER_ID" >/dev/null
    exit 1
fi

# Push to Docker Hub if requested
if [[ "$PUSH_TO_HUB" == "true" ]]; then
    if [[ -z "$DOCKER_USERNAME" ]]; then
        echo -e "${RED}❌ Docker username required for pushing${NC}"
        exit 1
    fi

    echo -e "${YELLOW}🚀 Pushing to Docker Hub...${NC}"
    
    # Login check
    if ! docker info | grep -q "Username: $DOCKER_USERNAME"; then
        echo "Please log in to Docker Hub:"
        docker login
    fi

    # Push both tags
    docker push "$FULL_IMAGE_NAME"
    if [[ "$TAG" != "latest" ]]; then
        docker push "$LATEST_IMAGE_NAME"
    fi

    echo -e "${GREEN}✅ Successfully pushed to Docker Hub!${NC}"
    echo -e "${BLUE}🌐 Available at: https://hub.docker.com/r/$DOCKER_USERNAME/$IMAGE_NAME${NC}"
fi

echo -e "${GREEN}🎉 All done!${NC}"
echo ""
echo -e "${YELLOW}📋 Next Steps:${NC}"
echo "  1. Test locally:"
echo "     docker-compose up"
echo ""
echo "  2. Run standalone:"
echo "     docker run -p 80:80 \\"
echo "       -e DATABASE_URL='postgresql://...' \\"
echo "       -e BETTER_AUTH_SECRET='your-secret' \\"
echo "       $FULL_IMAGE_NAME"
echo ""
if [[ "$PUSH_TO_HUB" == "true" ]]; then
    echo "  3. Deploy anywhere:"
    echo "     docker run -p 80:80 \\"
    echo "       -e DATABASE_URL='postgresql://...' \\"
    echo "       -e BETTER_AUTH_SECRET='your-secret' \\"
    echo "       $FULL_IMAGE_NAME"
fi