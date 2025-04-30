# --- Stage 1: Build ---
FROM golang:1.22-alpine AS builder

# Install build dependencies (like make, git if needed for private modules)
# RUN apk add --no-cache make git

WORKDIR /app

# Copy go module files
COPY go.mod ./
# If go.sum exists, copy it too: COPY go.sum ./

# Download dependencies
# RUN go mod download
# Note: 'go build' below will also download dependencies if needed

# Copy the entire source code
COPY . .

# Build the application using the Makefile
# Ensure the binary is static if using scratch or distroless non-static base image
# CGO_ENABLED=0 might be needed for fully static builds if using distroless/static
# RUN CGO_ENABLED=0 make build
RUN make build

# --- Stage 2: Runtime ---
FROM alpine:latest

WORKDIR /app

# Copy the built binary from the builder stage
COPY --from=builder /app/clarifai-agent .

# Expose the port the server listens on (default 8080 from http.go)
EXPOSE 8080

# Set the entrypoint to run the agent in server mode
ENTRYPOINT ["./clarifai-agent", "--serve"]

# Optional: Add a non-root user for security
# RUN addgroup -S appgroup && adduser -S appuser -G appgroup
# USER appuser
