import { useState } from "react";
import type { SchemaGenerationRequest, SchemaGenerationResponse } from "../types";
import * as api from "../services/api";

import type { AnalysisNode } from "../types";

interface SchemaGeneratorModalProps {
  analysisId: string;
  database: string;
  isOpen: boolean;
  nodes?: AnalysisNode[];
  onClose: () => void;
  onSuccess: (schema: SchemaGenerationResponse) => void;
}

/**
 * Determine whether the analysis nodes are from JSON or XML documents.
 * MarkLogic reports JSON nodes with type "object", "array", or omits namespace,
 * while XML nodes have type "element" or "attribute" and carry namespaces.
 */
function detectDocumentType(nodes: AnalysisNode[] | undefined): "json" | "xml" {
  if (!nodes || nodes.length === 0) return "json";
  const sample = nodes.slice(0, 10);
  const xmlCount = sample.filter(
    (n) => n.type === "element" || n.type === "attribute" || (n.namespace && n.namespace.trim() !== "")
  ).length;
  return xmlCount > sample.length / 2 ? "xml" : "json";
}

export function SchemaGeneratorModal({
  analysisId,
  database,
  isOpen,
  nodes,
  onClose,
  onSuccess,
}: SchemaGeneratorModalProps) {
  const documentType = detectDocumentType(nodes);
  const defaultSchemaType: "json-schema" | "xsd" = documentType === "xml" ? "xsd" : "json-schema";

  const [schemaType, setSchemaType] = useState<"json-schema" | "xsd">(defaultSchemaType);
  const [draft, setDraft] = useState<"draft-07" | "2019-09">("draft-07");
  const [strict, setStrict] = useState(false);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateSchema = async () => {
    setLoading(true);
    setError(null);

    try {
      const request: SchemaGenerationRequest = {
        analysisId,
        database,
        schemaType,
        strict,
        name: name || undefined,
        draft: schemaType === "json-schema" ? draft : undefined,
      };

      const response = schemaType === "json-schema"
        ? await api.generateJsonSchema(request)
        : await api.generateXmlSchema(request);

      if (response.status === "success") {
        onSuccess(response);
        onClose();
      } else {
        setError(response.message || "Failed to generate schema");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate schema");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow-lg p-6 max-w-md w-full">
        <h2 className="text-xl font-bold mb-4 text-slate-900 dark:text-white">
          Generate Schema
        </h2>

        <div className="space-y-4">
          {/* Schema Type */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Schema Type
            </label>
            <select
              value={schemaType}
              onChange={(e) => setSchemaType(e.target.value as "json-schema" | "xsd")}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
            >
              <option value="json-schema">JSON Schema</option>
              <option value="xsd">XML Schema (XSD)</option>
            </select>
            {documentType !== (schemaType === "xsd" ? "xml" : "json") && (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                Analysis appears to be {documentType.toUpperCase()} — consider using{" "}
                {documentType === "xml" ? "XSD" : "JSON Schema"}.
              </p>
            )}
          </div>

          {/* JSON Schema draft version */}
          {schemaType === "json-schema" && (
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Draft Version
              </label>
              <select
                value={draft}
                onChange={(e) => setDraft(e.target.value as "draft-07" | "2019-09")}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              >
                <option value="draft-07">Draft-07 (widely supported)</option>
                <option value="2019-09">Draft 2019-09</option>
              </select>
            </div>
          )}

          {/* Schema Name */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Schema Name (Optional)
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter schema name"
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
            />
          </div>

          {/* Strict mode */}
          <div className="flex items-start gap-2">
            <input
              type="checkbox"
              id="strict"
              checked={strict}
              onChange={(e) => setStrict(e.target.checked)}
              className="h-4 w-4 mt-0.5"
            />
            <div>
              <label htmlFor="strict" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Strict mode
              </label>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Marks elements that appear in ≥90% of documents as required and disallows additional properties.
              </p>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900 text-red-700 dark:text-red-200 rounded">
              {error}
            </div>
          )}
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white rounded hover:bg-slate-300 dark:hover:bg-slate-600"
          >
            Cancel
          </button>
          <button
            onClick={generateSchema}
            disabled={loading}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Generating..." : "Generate"}
          </button>
        </div>
      </div>
    </div>
  );
}
