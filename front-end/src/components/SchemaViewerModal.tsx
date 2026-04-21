import { useState, useEffect } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { tokyoNight } from "@uiw/codemirror-theme-tokyo-night";
import { json } from "@codemirror/lang-json";
import { xml } from "@codemirror/lang-xml";
import { useTheme } from "../context/ThemeContext";

interface SchemaViewerModalProps {
  schemaId: string;
  schemaType: "json-schema" | "xsd" | string;
  schemaName?: string;
  isOpen: boolean;
  onClose: () => void;
  /** Pass schema content directly if already fetched, otherwise provide onFetch */
  content?: string;
  onFetch?: (schemaId: string) => Promise<string>;
}

export function SchemaViewerModal({
  schemaId,
  schemaType,
  schemaName,
  isOpen,
  onClose,
  content: initialContent,
  onFetch,
}: SchemaViewerModalProps) {
  const { theme } = useTheme();
  const [content, setContent] = useState<string | null>(initialContent ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Fetch on first open if not pre-loaded
  useEffect(() => {
    if (!isOpen || content !== null || loading || error || !onFetch) return;
    setLoading(true);
    onFetch(schemaId)
      .then((text) => setContent(text))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load schema"))
      .finally(() => setLoading(false));
  }, [isOpen, schemaId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCopy = () => {
    if (!content) return;
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const extensions = schemaType === "xsd" ? [xml()] : [json()];
  const label = schemaName || (schemaType === "xsd" ? "XML Schema (XSD)" : "JSON Schema");

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow-xl flex flex-col w-full max-w-5xl h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{label}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">{schemaId}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              disabled={!content}
              className="px-3 py-1.5 text-sm bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-40"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white rounded hover:bg-slate-300 dark:hover:bg-slate-600"
            >
              Close
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden">
          {loading && (
            <div className="flex items-center justify-center h-full text-slate-500 dark:text-slate-400">
              Loading schema…
            </div>
          )}
          {error && (
            <div className="flex items-center justify-center h-full text-red-600 dark:text-red-400">
              {error}
            </div>
          )}
          {content !== null && !loading && (
            <CodeMirror
              value={content}
              extensions={extensions}
              theme={theme === "dark" ? tokyoNight : "light"}
              readOnly
              basicSetup={{
                lineNumbers: true,
                foldGutter: true,
                highlightActiveLine: false,
                highlightSelectionMatches: false,
              }}
              style={{ height: "100%", fontSize: "13px" }}
              height="100%"
            />
          )}
        </div>
      </div>
    </div>
  );
}
