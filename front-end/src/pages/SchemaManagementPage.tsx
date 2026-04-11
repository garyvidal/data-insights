import { useEffect, useState } from "react";
import { Wand2, Eye, ShieldCheck, Trash2 } from "lucide-react";
import { useDatabase } from "../context/useDatabase";
import type { Analysis, AnalysisNode, SchemaGenerationResponse, SchemaInfo } from "../types";
import { SchemaGeneratorModal } from "../components/SchemaGeneratorModal";
import { SchemaValidatorModal } from "../components/SchemaValidatorModal";
import { SchemaViewerModal } from "../components/SchemaViewerModal";
import * as api from "../services/api";

export function SchemaManagementPage() {
  const { selectedDb } = useDatabase();

  const [schemas, setSchemas] = useState<SchemaInfo[]>([]);
  const [loadingSchemas, setLoadingSchemas] = useState(false);

  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [selectedAnalysisId, setSelectedAnalysisId] = useState<string>("");
  const [analysisNodes, setAnalysisNodes] = useState<AnalysisNode[]>([]);
  const [loadingAnalyses, setLoadingAnalyses] = useState(false);

  const [showGeneratorModal, setShowGeneratorModal] = useState(false);
  const [showValidatorModal, setShowValidatorModal] = useState(false);
  const [showViewerModal, setShowViewerModal] = useState(false);
  const [selectedSchemaId, setSelectedSchemaId] = useState<string | null>(null);
  const [viewerSchema, setViewerSchema] = useState<SchemaInfo | null>(null);

  // Load analyses + schemas when DB changes
  useEffect(() => {
    if (!selectedDb) return;
    setAnalyses([]);
    setSelectedAnalysisId("");
    setAnalysisNodes([]);

    setLoadingAnalyses(true);
    api.getAnalysisList(selectedDb)
      .then((list) => {
        setAnalyses(list);
        if (list.length > 0) setSelectedAnalysisId(list[0].analysisId);
      })
      .catch(console.error)
      .finally(() => setLoadingAnalyses(false));

    loadSchemas();
  }, [selectedDb]);

  // Load nodes whenever the selected analysis changes (so the modal gets them)
  useEffect(() => {
    if (!selectedAnalysisId || !selectedDb) {
      setAnalysisNodes([]);
      return;
    }
    api.getAnalysisStructure(selectedAnalysisId, selectedDb)
      .then(setAnalysisNodes)
      .catch(console.error);
  }, [selectedAnalysisId, selectedDb]);

  const loadSchemas = async () => {
    if (!selectedDb) return;
    setLoadingSchemas(true);
    try {
      const data = await api.listSchemas(selectedDb);
      setSchemas(data);
    } catch (err) {
      console.error("Failed to load schemas:", err);
    } finally {
      setLoadingSchemas(false);
    }
  };

  const handleSchemaGenerated = (schema: SchemaGenerationResponse) => {
    const newSchema: SchemaInfo = {
      schemaId: schema.schemaId,
      name: schema.name || schema.schemaType,
      schemaType: schema.schemaType,
      analysisId: schema.analysisId,
      database: schema.database,
      documentCount: schema.documentCount,
      createdAt: schema.generatedAt,
    };
    setSchemas((prev) => [...prev, newSchema]);
  };

  const handleDeleteSchema = async (schemaId: string) => {
    if (!confirm("Delete this schema?")) return;
    try {
      await api.deleteSchema(schemaId);
      setSchemas((prev) => prev.filter((s) => s.schemaId !== schemaId));
    } catch (err) {
      console.error("Failed to delete schema:", err);
    }
  };

  const handleViewSchema = (schema: SchemaInfo) => {
    setViewerSchema(schema);
    setShowViewerModal(true);
  };

  if (!selectedDb) {
    return (
      <div className="p-6 bg-gray-50 dark:bg-gray-950 min-h-screen text-center text-slate-600 dark:text-slate-300">
        Please select a database first.
      </div>
    );
  }

  const canGenerate = !!selectedAnalysisId;

  return (
    <div className="p-6 bg-gray-50 dark:bg-gray-950 min-h-screen">
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white flex-1">
          Schema Management
        </h1>

        {/* Analysis selector */}
        {loadingAnalyses ? (
          <span className="text-sm text-slate-500 dark:text-slate-400">Loading analyses…</span>
        ) : analyses.length > 0 ? (
          <select
            value={selectedAnalysisId}
            onChange={(e) => setSelectedAnalysisId(e.target.value)}
            className="border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-500"
          >
            {analyses.map((a) => (
              <option key={a.analysisId} value={a.analysisId}>
                {a.documentType ? `[${a.documentType.toUpperCase()}] ` : ''}{a.localname} [{a.analysisName}]
              </option>
            ))}
          </select>
        ) : (
          <span className="text-sm text-slate-500 dark:text-slate-400">
            No analyses — run one on the Analyze page first.
          </span>
        )}

        <button
          onClick={() => setShowGeneratorModal(true)}
          disabled={!canGenerate}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border border-blue-400 dark:border-blue-400/40 bg-gray-100 dark:bg-transparent text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-400/10 hover:border-blue-500 dark:hover:border-blue-400/70 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Wand2 size={14} /> Generate Schema
        </button>
      </div>

      {loadingSchemas ? (
        <div className="text-center text-slate-600 dark:text-slate-300">Loading schemas…</div>
      ) : schemas.length === 0 ? (
        <div className="text-center text-slate-600 dark:text-slate-300">
          No schemas yet. Select an analysis above and click Generate Schema.
        </div>
      ) : (
        <div className="grid gap-4">
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
                    onClick={() => handleViewSchema(schema)}
                    className="flex items-center gap-1.5 px-3 py-1 text-sm rounded border border-gray-400 dark:border-white/25 bg-gray-100 dark:bg-transparent text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10 hover:border-gray-500 dark:hover:border-white/50 transition-colors"
                    title="View schema"
                  >
                    <Eye size={13} /> View
                  </button>
                  <button
                    onClick={() => {
                      setSelectedSchemaId(schema.schemaId);
                      setShowValidatorModal(true);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1 text-sm rounded border border-green-500 dark:border-green-400/35 bg-gray-100 dark:bg-transparent text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-400/10 hover:border-green-600 dark:hover:border-green-400/60 transition-colors"
                    title="Validate schema"
                  >
                    <ShieldCheck size={13} /> Validate
                  </button>
                  <button
                    onClick={() => handleDeleteSchema(schema.schemaId)}
                    className="flex items-center justify-center w-8 h-8 rounded border border-red-400 dark:border-red-400/35 bg-gray-100 dark:bg-transparent text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-400/10 hover:border-red-500 dark:hover:border-red-400/60 transition-colors"
                    title="Delete schema"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showGeneratorModal && (
        <SchemaGeneratorModal
          analysisId={selectedAnalysisId}
          database={selectedDb}
          nodes={analysisNodes}
          isOpen={showGeneratorModal}
          onClose={() => setShowGeneratorModal(false)}
          onSuccess={(schema) => {
            handleSchemaGenerated(schema);
            setShowGeneratorModal(false);
          }}
        />
      )}

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

      {viewerSchema && (
        <SchemaViewerModal
          schemaId={viewerSchema.schemaId}
          schemaType={viewerSchema.schemaType}
          schemaName={viewerSchema.name}
          isOpen={showViewerModal}
          onFetch={api.getSchema}
          onClose={() => {
            setShowViewerModal(false);
            setViewerSchema(null);
          }}
        />
      )}
    </div>
  );
}
