# Go parameters
GOCMD=go
GOBUILD=$(GOCMD) build
GOCLEAN=$(GOCMD) clean
GOTEST=$(GOCMD) test
GOGET=$(GOCMD) get
BINARY_NAME=ka
BINARY_UNIX=$(BINARY_NAME)_unix

all: build

# Build the application
build:
	@echo "Building $(BINARY_NAME)..."
	$(GOBUILD) -o $(BINARY_NAME) -v .
	@echo "$(BINARY_NAME) built successfully."

# Run the application
run: build
	@echo "Running $(BINARY_NAME)..."
	./$(BINARY_NAME)

# Test the application
test:
	@echo "Running tests..."
	$(GOTEST) -v ./...

# Clean the binary files
clean:
	@echo "Cleaning..."
	$(GOCLEAN)
	rm -f $(BINARY_NAME) $(BINARY_UNIX)
	@echo "Cleaned."

# Cross compilation
build-linux:
	@echo "Building for Linux..."
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 $(GOBUILD) -o $(BINARY_UNIX) -v .
	@echo "$(BINARY_UNIX) built successfully for Linux."

.PHONY: all build run test clean build-linux
