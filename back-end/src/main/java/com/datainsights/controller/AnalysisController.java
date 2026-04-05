package com.datainsights.controller;

import com.datainsights.service.MarkLogicService;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.LinkedHashMap;

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

    // ── Clear All Analyses for a Database ────────────────────────────────────

    @DeleteMapping("/analyses")
    public ResponseEntity<Void> clearAnalyses(@RequestParam String db) {
        mlService.clearAnalyses(db);
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

    // ── Notifications (SSE stream) ────────────────────────────────────────────

    @GetMapping(value = "/notifications/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter streamNotifications(@RequestParam String db) {
        SseEmitter emitter = new SseEmitter(300_000L);

        // Capture the request context from the servlet thread before the virtual thread starts.
        // Virtual threads do not inherit Spring's ThreadLocal-bound RequestAttributes.
        org.springframework.web.context.request.RequestAttributes requestAttributes =
                org.springframework.web.context.request.RequestContextHolder.currentRequestAttributes();

        Thread.ofVirtual().start(() -> {
            org.springframework.web.context.request.RequestContextHolder.setRequestAttributes(requestAttributes);
            long start = System.currentTimeMillis();
            try {
                while (System.currentTimeMillis() - start < 300_000L) {
                    List<Map<String, Object>> analyses = mlService.getAnalysisList(db);
                    Map<String, Object> notifResult = mlService.getNotificationResult();

                    Map<String, Object> payload = new LinkedHashMap<>();
                    payload.put("analyses", analyses);
                    payload.put("notifications", notifResult.get("notifications"));
                    payload.put("complete", notifResult.get("complete"));

                    emitter.send(SseEmitter.event().name("update").data(payload));

                    if (Boolean.TRUE.equals(notifResult.get("complete"))) {
                        emitter.send(SseEmitter.event().name("complete").data("done"));
                        emitter.complete();
                        return;
                    }

                    Thread.sleep(2000);
                }
                emitter.complete();
            } catch (Exception e) {
                emitter.completeWithError(e);
            } finally {
                org.springframework.web.context.request.RequestContextHolder.resetRequestAttributes();
            }
        });

        return emitter;
    }
}
