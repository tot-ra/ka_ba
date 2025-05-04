package tools

import (
	"fmt"
	"os"
	"path/filepath"
)

// ListFiles lists files and directories in the given path.
// If recursive is true, it lists contents recursively.
func ListFiles(path string, recursive bool) ([]string, error) {
	var fileList []string
	err := filepath.Walk(path, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			// Log the error but continue walking
			fmt.Printf("Error accessing path %q: %v\n", path, err)
			return nil // Don't stop the walk on errors
		}
		// Add the path to the list
		fileList = append(fileList, path)

		if !recursive && info.IsDir() && path != "." && path != "/" {
			// If not recursive and it's a directory (and not the starting path), skip its contents
			return filepath.SkipDir
		}
		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("error walking the path %q: %v", path, err)
	}

	return fileList, nil
}
