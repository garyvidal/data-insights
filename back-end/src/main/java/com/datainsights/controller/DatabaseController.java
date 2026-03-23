package com.datainsights.controller;

import com.datainsights.service.MarkLogicService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api")
public class DatabaseController {

    private final MarkLogicService mlService;

    public DatabaseController(MarkLogicService mlService) {
        this.mlService = mlService;
    }

    @GetMapping("/databases")
    public ResponseEntity<List<String>> getDatabases() {
        return ResponseEntity.ok(mlService.getDatabases());
    }

    @GetMapping("/statistics")
    public ResponseEntity<Map<String, Object>> getStatistics(@RequestParam String db) {
        return ResponseEntity.ok(mlService.getDatabaseStatistics(db));
    }

    @GetMapping("/analysis-status")
    public ResponseEntity<Map<String, Object>> getAnalysisStatus(@RequestParam String db) {
        return ResponseEntity.ok(mlService.getAnalysisStatus(db));
    }
}
