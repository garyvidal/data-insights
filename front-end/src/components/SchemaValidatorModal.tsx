import { useState } from "react";
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow-lg p-6 max-w-2xl w-full max-h-96 overflow-y-auto">
        <h2 className="text-xl font-bold mb-4 text-slate-900 dark:text-white">
          Validate Document
        </h2>

        {!validationResult ? (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Document Type
              </label>
              <select
                value={documentType}
                onChange={(e) => setDocumentType(e.target.value as "json" | "xml")}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              >
                <option value="json">JSON</option>
                <option value="xml">XML</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Document Content
              </label>
              <textarea
                value={documentContent}
                onChange={(e) => setDocumentContent(e.target.value)}
                placeholder={documentType === "json" ? "Enter JSON document" : "Enter XML document"}
                className="w-full h-48 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md font-mono text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>

            {error && <div className="p-3 bg-red-50 dark:bg-red-900 text-red-700 dark:text-red-200 rounded">{error}</div>}

            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white rounded hover:bg-slate-300 dark:hover:bg-slate-600"
              >
                Close
              </button>
              <button
                onClick={handleValidate}
                disabled={loading || !documentContent.trim()}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? "Validating..." : "Validate"}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <ValidationResultsDisplay result={validationResult} />
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setValidationResult(null);
                  setDocumentContent("");
                }}
                className="flex-1 px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white rounded hover:bg-slate-300 dark:hover:bg-slate-600"
              >
                Validate Another
              </button>
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
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
