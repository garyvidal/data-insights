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

export function SchemaGeneratorModal({
  analysisId,
  database,
  isOpen,
  nodes,
  onClose,
  onSuccess,
}: SchemaGeneratorModalProps) {
  // Determine document type from analysis nodes
  const documentType = nodes && nodes.length > 0
    ? nodes[0].xpath && nodes[0].xpath.includes('/')
      ? 'xml'
      : 'json'
    : 'json';

  // Determine supported schema types based on document type
  const supportedSchemaTypes =
    documentType === 'xml' ? ['xsd'] : ['json-schema'];
  const defaultSchemaType =
    documentType === 'xml' ? 'xsd' : 'json-schema';

  const [schemaType, setSchemaType] = useState<"json-schema" | "xsd">(defaultSchemaType);
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
      };

      let response;
      if (schemaType === "json-schema") {
        response = await api.generateJsonSchema(request);
      } else {
        response = await api.generateXmlSchema(request);
      }

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
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Schema Type
            </label>
            {supportedSchemaTypes.length === 1 ? (
              <div className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white flex items-center">
                {documentType === 'xml' ? 'XML Schema (XSD)' : 'JSON Schema'}
              </div>
            ) : (
              <select
                value={schemaType}
                onChange={(e) => setSchemaType(e.target.value as "json-schema" | "xsd")}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              >
                <option value="json-schema">JSON Schema</option>
                <option value="xsd">XML Schema (XSD)</option>
              </select>
            )}
          </div>

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

          <div className="flex items-center">
            <input
              type="checkbox"
              id="strict"
              checked={strict}
              onChange={(e) => setStrict(e.target.checked)}
              className="h-4 w-4"
            />
            <label htmlFor="strict" className="ml-2 text-sm text-slate-700 dark:text-slate-300">
              Use strict schema rules (all frequent elements required)
            </label>
          </div>

          {error && <div className="p-3 bg-red-50 dark:bg-red-900 text-red-700 dark:text-red-200 rounded">{error}</div>}
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
