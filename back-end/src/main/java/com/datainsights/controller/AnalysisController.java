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
            @RequestParam(defaultValue = "50") int rows,
            @RequestParam(defaultValue = "frequency") String sidx,
            @RequestParam(defaultValue = "desc") String sord) {
        return ResponseEntity.ok(mlService.getAnalysisValues(analysisId, id, type, page, rows, sidx, sord));
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

    // ── Execute Query (count only) ────────────────────────────────────────────

    @PostMapping("/execute-query")
    public ResponseEntity<Map<String, Object>> executeQuery(@RequestBody Map<String, String> body) {
        return ResponseEntity.ok(mlService.executeQuery(
                body.get("db"), body.get("query"), body.get("xpath")));
    }

    // ── Execute Query Results (paginated) ─────────────────────────────────────

    @PostMapping("/query-results")
    public ResponseEntity<Map<String, Object>> queryResults(@RequestBody Map<String, Object> body) {
        String db = (String) body.get("db");
        String query = (String) body.getOrDefault("query", "cts:and-query(())");
        String xpath = (String) body.getOrDefault("xpath", "fn:collection()");
        String analysisId = (String) body.getOrDefault("analysisId", "");
        int page = body.containsKey("page") ? ((Number) body.get("page")).intValue() : 1;
        int pageSize = body.containsKey("pageSize") ? ((Number) body.get("pageSize")).intValue() : 25;
        return ResponseEntity.ok(mlService.executeQueryResults(db, query, xpath, analysisId, page, pageSize));
    }

    // ── Save Expression ───────────────────────────────────────────────────────

    @PostMapping("/expressions")
    public ResponseEntity<Map<String, Object>> saveExpression(@RequestBody Map<String, String> body) {
        return ResponseEntity.ok(mlService.saveExpression(
                body.get("db"), body.get("name"), body.get("query"), body.get("xpath")));
    }

    // ── Get Expression ────────────────────────────────────────────────────────

    @GetMapping("/expressions/{id}")
    public ResponseEntity<Map<String, Object>> getExpression(@PathVariable String id) {
        return ResponseEntity.ok(mlService.getExpression(id));
    }

    // ── Delete Expression ─────────────────────────────────────────────────────

    @DeleteMapping("/expressions/{id}")
    public ResponseEntity<Void> deleteExpression(@PathVariable String id) {
        mlService.deleteExpression(id);
        return ResponseEntity.ok().build();
    }

    // ── Notifications (SSE stream) ────────────────────────────────────────────

    @GetMapping(value = "/notifications/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter streamNotifications(@RequestParam String db) {
        SseEmitter emitter = new SseEmitter(300_000L);
        java.util.concurrent.atomic.AtomicBoolean done = new java.util.concurrent.atomic.AtomicBoolean(false);
        emitter.onCompletion(() -> done.set(true));
        emitter.onTimeout(() -> done.set(true));
        emitter.onError(t -> done.set(true));

        // Capture the request context from the servlet thread before the virtual thread starts.
        // Virtual threads do not inherit Spring's ThreadLocal-bound RequestAttributes.
        org.springframework.web.context.request.RequestAttributes requestAttributes =
                org.springframework.web.context.request.RequestContextHolder.currentRequestAttributes();

        Thread.ofVirtual().start(() -> {
            org.springframework.web.context.request.RequestContextHolder.setRequestAttributes(requestAttributes);
            long start = System.currentTimeMillis();
            try {
                while (!done.get() && System.currentTimeMillis() - start < 300_000L) {
                    List<Map<String, Object>> analyses = mlService.getAnalysisList(db);
                    Map<String, Object> notifResult = mlService.getNotificationResult();

                    if (done.get()) return;

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
                if (!done.get()) emitter.complete();
            } catch (Exception e) {
                if (!done.get()) emitter.completeWithError(e);
            } finally {
                org.springframework.web.context.request.RequestContextHolder.resetRequestAttributes();
            }
        });

        return emitter;
    }
}
