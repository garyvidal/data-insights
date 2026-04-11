package com.datainsights.controller;

import com.datainsights.service.MarkLogicService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api")
public class SearchController {

    private final MarkLogicService mlService;

    public SearchController(MarkLogicService mlService) {
        this.mlService = mlService;
    }

    // ── List search option sets ───────────────────────────────────────────────

    @GetMapping("/search-options")
    public ResponseEntity<List<Map<String, Object>>> listSearchOptions(
            @RequestParam String db,
            @RequestParam(value = "analysis-id", defaultValue = "") String analysisId) {
        return ResponseEntity.ok(mlService.listSearchOptions(db, analysisId));
    }

    // ── Get one search option set ─────────────────────────────────────────────

    @GetMapping("/search-options/{id}")
    public ResponseEntity<Map<String, Object>> getSearchOptions(@PathVariable String id) {
        return ResponseEntity.ok(mlService.getSearchOptions(id));
    }

    // ── Save a new search option set ──────────────────────────────────────────

    @PostMapping("/search-options")
    public ResponseEntity<Map<String, Object>> saveSearchOptions(@RequestBody Map<String, Object> body) {
        String db         = (String) body.get("db");
        String analysisId = (String) body.getOrDefault("analysisId", "");
        String name       = (String) body.get("name");
        String options    = (String) body.get("options");
        return ResponseEntity.ok(mlService.saveSearchOptions(db, analysisId, name, options));
    }

    // ── Update an existing search option set ──────────────────────────────────

    @PutMapping("/search-options/{id}")
    public ResponseEntity<Map<String, Object>> updateSearchOptions(
            @PathVariable String id,
            @RequestBody Map<String, Object> body) {
        String name    = (String) body.get("name");
        String options = (String) body.get("options");
        return ResponseEntity.ok(mlService.updateSearchOptions(id, name, options));
    }

    // ── Delete a search option set ────────────────────────────────────────────

    @DeleteMapping("/search-options/{id}")
    public ResponseEntity<Void> deleteSearchOptions(@PathVariable String id) {
        mlService.deleteSearchOptions(id);
        return ResponseEntity.ok().build();
    }

    // ── Execute search ────────────────────────────────────────────────────────

    @PostMapping("/search")
    public ResponseEntity<Map<String, Object>> executeSearch(@RequestBody Map<String, Object> body) {
        String db        = (String) body.get("db");
        String optionsId = (String) body.get("optionsId");
        String query     = (String) body.getOrDefault("query", "");
        int page         = body.containsKey("page")     ? ((Number) body.get("page")).intValue()     : 1;
        int pageSize     = body.containsKey("pageSize") ? ((Number) body.get("pageSize")).intValue() : 25;
        return ResponseEntity.ok(mlService.executeSearch(db, optionsId, query, page, pageSize));
    }
}
