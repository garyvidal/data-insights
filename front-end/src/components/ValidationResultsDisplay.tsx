import type { ValidationResult } from "../types";

interface ValidationResultsDisplayProps {
  result: ValidationResult;
  title?: string;
}

export function ValidationResultsDisplay({ result, title = "Validation Results" }: ValidationResultsDisplayProps) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-4">
      <h3 className="text-lg font-semibold mb-4 text-slate-900 dark:text-white">{title}</h3>

      <div className="mb-4">
        <div className="flex items-center gap-2 p-3 rounded-lg bg-slate-50 dark:bg-slate-800">
          <div
            className={`w-4 h-4 rounded-full ${result.valid ? "bg-green-500" : "bg-red-500"}`}
          />
          <span className="font-semibold text-slate-900 dark:text-white">
            {result.valid ? "Valid Document" : "Invalid Document"}
          </span>
          <span className="ml-auto text-sm text-slate-600 dark:text-slate-400">
            {result.validationTime}ms
          </span>
        </div>
      </div>

      {result.errors.length > 0 && (
        <div className="mb-4">
          <h4 className="font-semibold text-red-700 dark:text-red-300 mb-2">Errors ({result.errors.length})</h4>
          <div className="space-y-2">
            {result.errors.map((error, idx) => (
              <div
                key={idx}
                className="p-3 rounded bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-800"
              >
                <div className="text-sm font-mono text-red-700 dark:text-red-300">{error.path}</div>
                <div className="text-sm text-red-600 dark:text-red-400">{error.message}</div>
                <div className="text-xs text-red-500 dark:text-red-500 mt-1">{error.code}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.warnings.length > 0 && (
        <div className="mb-4">
          <h4 className="font-semibold text-yellow-700 dark:text-yellow-300 mb-2">Warnings ({result.warnings.length})</h4>
          <div className="space-y-2">
            {result.warnings.map((warning, idx) => (
              <div
                key={idx}
                className="p-3 rounded bg-yellow-50 dark:bg-yellow-900 border border-yellow-200 dark:border-yellow-800"
              >
                <div className="text-sm text-yellow-700 dark:text-yellow-300">{warning}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.valid && result.errors.length === 0 && (
        <div className="p-3 rounded bg-green-50 dark:bg-green-900 border border-green-200 dark:border-green-800">
          <p className="text-sm text-green-700 dark:text-green-300">Document conforms to the schema</p>
        </div>
      )}
    </div>
  );
}
