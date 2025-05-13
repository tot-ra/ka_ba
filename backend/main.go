package main

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"net/http"
	"os"
)

const apiKey = "YOUR_GOOGLE_BOOKS_API_KEY"

func searchBooks(query string) {
	url := fmt.Sprintf("https://www.googleapis.com/books/v1/search?q=%s&key=%s", query, apiKey)
	resp, err := http.Get(url)
	if err != nil || resp.StatusCode != 200 {
		fmt.Println("Error fetching data:", err)
		return
	}

	body, _ := ioutil.ReadAll(resp.Body)
	var result map[string]interface{}
	json.Unmarshal(body, &result)

	results := result["items"].([]interface{})
	if len(results) == 0 {
		fmt.Println("No results found")
		return
	}

	for _, item := range results {
		fmt.Printf("%v\n", item.(map[string]interface{})["volumeInfo"].(map[string]interface{})["title"]))
	}
}