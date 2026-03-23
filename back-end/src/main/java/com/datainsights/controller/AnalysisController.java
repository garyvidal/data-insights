package com.datainsights.controller;

import com.datainsights.service.MarkLogicService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api")
public class AnalysisController {

    private final MarkLogicService mlService;

    public AnalysisController(MarkLogicService mlService) {
        this.mlService = mlService;
    }

    // ── Root Elements ─────────────────────────────────────────────────────────

    @GetMapping("/root-elements")
    public ResponseEntity<List<Map<String, Object>>> getRootElements(@RequestParam String db) {
        return ResponseEntity.ok(mlService.getRootElements(db));
    }

    // ── Analysis List ─────────────────────────────────────────────────────────

    @GetMapping("/analysis-list")
    public ResponseEntity<List<Map<String, Object>>> getAnalysisList(@RequestParam String db) {
        return ResponseEntity.ok(mlService.getAnalysisList(db));
    }

    // ── Analysis Structure ────────────────────────────────────────────────────

    @GetMapping("/analysis/structure")
    public ResponseEntity<List<Map<String, Object>>> getAnalysisStructure(
            @RequestParam("analysis-id") String analysisId,
            @RequestParam String db) {
        return ResponseEntity.ok(mlService.getAnalysisStructure(analysisId, db));
    }

    // ── Analysis Values ───────────────────────────────────────────────────────

    @GetMapping("/analysis/values")
    public ResponseEntity<Map<String, Object>> getAnalysisValues(
            @RequestParam("analysis-id") String analysisId,
            @RequestParam String id,
            @RequestParam(defaultValue = "element-values") String type,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "50") int rows) {
        return ResponseEntity.ok(mlService.getAnalysisValues(analysisId, id, type, page, rows));
    }

    // ── URIs ──────────────────────────────────────────────────────────────────

    @GetMapping("/analysis/uris")
    public ResponseEntity<Map<String, Object>> getAnalysisUris(
            @RequestParam("analysis-id") String analysisId,
            @RequestParam String db,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "50") int rows) {
        return ResponseEntity.ok(mlService.getAnalysisUris(analysisId, db, page, rows));
    }

    // ── Document Stats ────────────────────────────────────────────────────────

    @GetMapping("/analysis/doc-stats")
    public ResponseEntity<Map<String, Object>> getDocStats(
            @RequestParam("analysis-id") String analysisId,
            @RequestParam String db) {
        return ResponseEntity.ok(mlService.getDocumentStats(analysisId, db));
    }

    // ── Namespaces ────────────────────────────────────────────────────────────

    @GetMapping("/namespaces")
    public ResponseEntity<List<Map<String, Object>>> getNamespaces(
            @RequestParam("analysis-id") String analysisId) {
        return ResponseEntity.ok(mlService.getNamespaces(analysisId));
    }

    // ── Run Analysis ──────────────────────────────────────────────────────────

    @PostMapping("/analyze")
    public ResponseEntity<Void> analyze(@RequestBody Map<String, Object> body) {
        String db = (String) body.getOrDefault("db", "");
        String name = (String) body.getOrDefault("name", "");
        String sample = String.valueOf(body.getOrDefault("sample", "100"));
        String constraint = (String) body.getOrDefault("constraint", "cts:and-query(())");
        String xpath = (String) body.getOrDefault("xpath", "");
        String all = String.valueOf(body.getOrDefault("all", "false"));

        @SuppressWarnings("unchecked")
        List<String> rootElementsList = (List<String>) body.get("rootElements");
        String[] rootElements = rootElementsList != null
                ? rootElementsList.toArray(new String[0])
                : new String[0];

        mlService.analyzeDatabase(db, name, sample, constraint, xpath, all, rootElements);
        return ResponseEntity.accepted().build();
    }

    // ── Delete Analysis ───────────────────────────────────────────────────────

    @DeleteMapping("/analysis")
    public ResponseEntity<Void> deleteAnalysis(@RequestParam String id) {
        mlService.deleteAnalysis(id);
        return ResponseEntity.ok().build();
    }

    // ── Clear Database ────────────────────────────────────────────────────────

    @PostMapping("/clear-db")
    public ResponseEntity<Void> clearDatabase(@RequestParam String db) {
        mlService.clearDatabase(db);
        return ResponseEntity.ok().build();
    }

    // ── Expressions ───────────────────────────────────────────────────────────

    @GetMapping("/expressions")
    public ResponseEntity<List<Map<String, Object>>> listExpressions(@RequestParam String db) {
        return ResponseEntity.ok(mlService.listExpressions(db));
    }

    // ── Validate ──────────────────────────────────────────────────────────────

    @PostMapping("/validate-expression")
    public ResponseEntity<Map<String, Object>> validateExpression(@RequestBody Map<String, String> body) {
        return ResponseEntity.ok(mlService.validateExpression(
                body.get("db"), body.get("constraint"), body.get("xpath")));
    }

    // ── Execute Query ─────────────────────────────────────────────────────────

    @PostMapping("/execute-query")
    public ResponseEntity<Map<String, Object>> executeQuery(@RequestBody Map<String, String> body) {
        return ResponseEntity.ok(mlService.executeQuery(
                body.get("db"), body.get("query"), body.get("xpath")));
    }

    // ── Notifications ─────────────────────────────────────────────────────────

    @GetMapping("/notifications")
    public ResponseEntity<List<Map<String, Object>>> getNotifications() {
        return ResponseEntity.ok(mlService.getNotifications());
    }
}
