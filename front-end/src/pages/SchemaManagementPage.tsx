import { useEffect, useState } from "react";
import { useDatabase } from "../context/DatabaseContext";
import type { SchemaGenerationResponse, SchemaInfo } from "../types";
import { SchemaGeneratorModal } from "../components/SchemaGeneratorModal";
import { SchemaValidatorModal } from "../components/SchemaValidatorModal";
import * as api from "../services/api";

export function SchemaManagementPage() {
  const { selectedDb } = useDatabase();
  const [schemas, setSchemas] = useState<SchemaInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [showGeneratorModal, setShowGeneratorModal] = useState(false);
  const [showValidatorModal, setShowValidatorModal] = useState(false);
  const [selectedSchemaId, setSelectedSchemaId] = useState<string | null>(null);
  const selectedAnalysisId = "";

  useEffect(() => {
    if (selectedDb) {
      loadSchemas();
    }
  }, [selectedDb]);

  const loadSchemas = async () => {
    if (!selectedDb) return;
    setLoading(true);
    try {
      const data = await api.listSchemas(selectedDb);
      setSchemas(data);
    } catch (err) {
      console.error("Failed to load schemas:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSchemaGenerated = (schema: SchemaGenerationResponse) => {
    const newSchema: SchemaInfo = {
      schemaId: schema.schemaId,
      name: schema.schemaType,
      schemaType: schema.schemaType,
      analysisId: schema.analysisId,
      database: schema.database,
      documentCount: schema.documentCount,
      createdAt: schema.generatedAt,
    };
    setSchemas([...schemas, newSchema]);
  };

  const handleDeleteSchema = async (schemaId: string) => {
    if (!confirm("Delete this schema?")) return;
    try {
      await api.deleteSchema(schemaId);
      setSchemas(schemas.filter((s) => s.schemaId !== schemaId));
    } catch (err) {
      console.error("Failed to delete schema:", err);
    }
  };

  const handleViewSchema = async (schemaId: string) => {
    try {
      const schema = await api.getSchema(schemaId);
      // Show in a modal or new view
      alert("Schema:\n\n" + schema);
    } catch (err) {
      console.error("Failed to load schema:", err);
    }
  };

  if (!selectedDb) {
    return (
      <div className="p-6 bg-gray-50 dark:bg-gray-950 min-h-screen text-center text-slate-600 dark:text-slate-300">
        Please select a database first.
      </div>
    );
  }

  return (
    <div className="p-6 bg-gray-50 dark:bg-gray-950 min-h-screen">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Schema Management</h1>
        <button
          onClick={() => setShowGeneratorModal(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Generate Schema
        </button>
      </div>

      {loading ? (
        <div className="text-center text-slate-600 dark:text-slate-300">Loading schemas...</div>
      ) : schemas.length === 0 ? (
        <div className="text-center text-slate-600 dark:text-slate-300">
          No schemas yet. Generate one from your analysis data.
        </div>
      ) : (
        <div className="grid gap-4 bg-gray-50 dark:bg-gray-900">
          {schemas.map((schema) => (
            <div
              key={schema.schemaId}
              className="bg-white dark:bg-slate-800 rounded-lg shadow p-4"
            >
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-semibold text-slate-900 dark:text-white">
                    {schema.name || schema.schemaType}
                  </h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Type: {schema.schemaType} | Documents: {schema.documentCount}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-500">
                    Created: {schema.createdAt}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleViewSchema(schema.schemaId)}
                    className="px-3 py-1 text-sm bg-slate-200 dark:bg-slate-700 rounded hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-900 dark:text-white"
                  >
                    View
                  </button>
                  <button
                    onClick={() => {
                      setSelectedSchemaId(schema.schemaId);
                      setShowValidatorModal(true);
                    }}
                    className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700"
                  >
                    Validate
                  </button>
                  <button
                    onClick={() => handleDeleteSchema(schema.schemaId)}
                    className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <SchemaGeneratorModal
        analysisId={selectedAnalysisId}
        database={selectedDb}
        isOpen={showGeneratorModal}
        onClose={() => setShowGeneratorModal(false)}
        onSuccess={handleSchemaGenerated}
      />

      {selectedSchemaId && (
        <SchemaValidatorModal
          schemaId={selectedSchemaId}
          database={selectedDb}
          isOpen={showValidatorModal}
          onClose={() => {
            setShowValidatorModal(false);
            setSelectedSchemaId(null);
          }}
        />
      )}
    </div>
  );
}
