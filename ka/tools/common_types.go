package tools

// FunctionCall represents the details of a parsed tool call,
// including its name (usually from the 'id' attribute), any other attributes,
// and the content within the tool tags.
type FunctionCall struct {
	Name       string            // The name of the function/tool to call.
	Attributes map[string]string // A map of attributes from the tool's XML tag.
	Content    string            // The inner content of the tool's XML tag.
}
