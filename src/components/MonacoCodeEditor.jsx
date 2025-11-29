import { useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";

/**
 * Monaco Code Editor Component
 * Wrapper around Monaco Editor for Java code input
 */
const MonacoCodeEditor = ({
  value = "",
  onChange,
  height = "400px",
  language = "java",
  placeholder = "Write your code here...",
  readOnly = false,
  ...props
}) => {
  const editorRef = useRef(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Update editor value when prop changes
  useEffect(() => {
    if (editorRef.current && editorRef.current.getValue() !== value) {
      editorRef.current.setValue(value || "");
    }
  }, [value]);

  // Update readOnly state when prop changes
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.updateOptions({ readOnly: readOnly });
    }
  }, [readOnly]);

  const handleEditorDidMount = (editor, monaco) => {
    editorRef.current = editor;
    
    // Configure editor options - ensure readOnly is explicitly set
    editor.updateOptions({
      readOnly: readOnly,
      fontSize: 14,
      lineNumbers: "on",
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      tabSize: 2,
      wordWrap: "on",
      formatOnPaste: true,
      formatOnType: true,
      readOnlyMessage: readOnly ? { value: "This editor is read-only" } : undefined,
      // Ensure editor is always editable and responsive
      contextmenu: true,
      mouseWheelZoom: false,
      // Make sure editor accepts input immediately
      acceptSuggestionOnCommitCharacter: true,
      acceptSuggestionOnEnter: "on",
    });

    // Set Java-specific settings
    monaco.languages.setLanguageConfiguration("java", {
      comments: {
        lineComment: "//",
        blockComment: ["/*", "*/"],
      },
      brackets: [
        ["{", "}"],
        ["[", "]"],
        ["(", ")"],
      ],
      autoClosingPairs: [
        { open: "{", close: "}" },
        { open: "[", close: "]" },
        { open: "(", close: ")" },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
      ],
    });

    // Ensure editor is properly initialized and ready
    if (!readOnly) {
      // Set initial value if provided
      if (value && editor.getValue() !== value) {
        editor.setValue(value);
      }
      
      // Make editor focusable and ensure it's ready for input
      setTimeout(() => {
        editor.focus();
        // Force editor to be in edit mode
        editor.getModel()?.setEOL(monaco.editor.EndOfLineSequence.LF);
      }, 100);
    }
  };

  const handleEditorChange = (newValue) => {
    // Always call onChange, even if value is undefined
    if (onChange) {
      onChange(newValue === undefined ? "" : newValue);
    }
  };

  if (!mounted) {
    // Fallback to textarea while Monaco loads
    return (
      <textarea
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        className="java-editor__textarea"
        style={{ minHeight: height }}
        readOnly={readOnly}
      />
    );
  }

  return (
    <div 
      className="java-editor__code-area"
      onClick={(e) => {
        // Ensure editor gets focus when wrapper is clicked
        if (editorRef.current && !readOnly) {
          editorRef.current.focus();
        }
      }}
      style={{ cursor: readOnly ? 'default' : 'text' }}
    >
      <Editor
        height={height}
        language={language}
        value={value || ""}
        onChange={handleEditorChange}
        onMount={handleEditorDidMount}
        theme="vs-dark"
        options={{
          readOnly: readOnly,
          placeholder: placeholder,
          fontSize: 14,
          lineNumbers: "on",
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          wordWrap: "on",
          formatOnPaste: true,
          formatOnType: true,
          suggestOnTriggerCharacters: true,
          acceptSuggestionOnCommitCharacter: true,
          acceptSuggestionOnEnter: "on",
          snippetSuggestions: "top",
          tabCompletion: "on",
          // Ensure editor is editable
          domReadOnly: false,
          // Enable all editing features
          quickSuggestions: true,
          parameterHints: { enabled: true },
          // Make editor always ready for input
          cursorBlinking: "smooth",
          cursorSmoothCaretAnimation: "on",
          // Ensure input is always accepted
          disableLayerHinting: false,
          // Enable context menu for better UX
          contextmenu: true,
        }}
        {...props}
      />
    </div>
  );
};

export default MonacoCodeEditor;

