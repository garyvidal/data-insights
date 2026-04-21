import { useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { tokyoNight } from "@uiw/codemirror-theme-tokyo-night";
import { json } from "@codemirror/lang-json";
import { xml } from "@codemirror/lang-xml";
import { useTheme } from "../context/ThemeContext";
import type { ValidationResult, ValidationRequest } from "../types";
import * as api from "../services/api";
import { ValidationResultsDisplay } from "./ValidationResultsDisplay";

interface SchemaValidatorModalProps {
  schemaId: string;
  database: string;
  isOpen: boolean;
  onClose: () => void;
}

export function SchemaValidatorModal({
  schemaId,
  database,
  isOpen,
  onClose,
}: SchemaValidatorModalProps) {
  const { theme } = useTheme();
  const [documentContent, setDocumentContent] = useState("");
  const [documentType, setDocumentType] = useState<"json" | "xml">("json");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);

  const handleValidate = async () => {
    setLoading(true);
    setError(null);
    try {
      const request: ValidationRequest = {
        schemaId,
        database,
        document: documentContent,
        documentType,
      };
      const result = await api.validateDocument(request);
      setValidationResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Validation failed");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setValidationResult(null);
    setDocumentContent("");
    setError(null);
  };

  if (!isOpen) return null;

  const extensions = documentType === "xml" ? [xml()] : [json()];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow-xl flex flex-col w-full max-w-4xl h-[85vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Validate Document</h2>
          <button
            onClick={onClose}
            className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {!validationResult ? (
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Controls */}
            <div className="flex items-center gap-4 px-5 py-3 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Document Type
              </label>
              <select
                value={documentType}
                onChange={(e) => setDocumentType(e.target.value as "json" | "xml")}
                className="px-3 py-1.5 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm"
              >
                <option value="json">JSON</option>
                <option value="xml">XML</option>
              </select>
            </div>

            {/* Editor — fills remaining height */}
            <div className="flex-1 overflow-hidden">
              <CodeMirror
                value={documentContent}
                onChange={setDocumentContent}
                extensions={extensions}
                theme={theme === "dark" ? tokyoNight : "light"}
                placeholder={documentType === "json" ? '{\n  "key": "value"\n}' : "<root>\n  <element/>\n</root>"}
                basicSetup={{
                  lineNumbers: true,
                  foldGutter: true,
                  highlightActiveLine: true,
                }}
                style={{ height: "100%", fontSize: "13px" }}
                height="100%"
              />
            </div>

            {/* Error + actions */}
            <div className="flex-shrink-0 px-5 py-3 border-t border-slate-200 dark:border-slate-700 space-y-3">
              {error && (
                <div className="p-3 bg-red-50 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded text-sm">
                  {error}
                </div>
              )}
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="flex-1 px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white rounded hover:bg-slate-300 dark:hover:bg-slate-600 text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={handleValidate}
                  disabled={loading || !documentContent.trim()}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 text-sm"
                >
                  {loading ? "Validating…" : "Validate"}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <ValidationResultsDisplay result={validationResult} />
            </div>
            <div className="flex gap-3 px-5 py-3 border-t border-slate-200 dark:border-slate-700 flex-shrink-0">
              <button
                onClick={handleReset}
                className="flex-1 px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white rounded hover:bg-slate-300 dark:hover:bg-slate-600 text-sm"
              >
                Validate Another
              </button>
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
