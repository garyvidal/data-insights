package com.datainsights.controller;

import com.datainsights.dto.*;
import com.datainsights.service.SchemaService;
import com.datainsights.service.SchemaValidationService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/schema")
public class SchemaController {

    private final SchemaService schemaService;
    private final SchemaValidationService validationService;

    public SchemaController(SchemaService schemaService, SchemaValidationService validationService) {
        this.schemaService = schemaService;
        this.validationService = validationService;
    }

    // ── Schema Generation ─────────────────────────────────────────────────────

    @PostMapping("/generate/json-schema")
    public ResponseEntity<SchemaGenerationResponse> generateJsonSchema(@RequestBody SchemaGenerationRequest request) {
        return ResponseEntity.ok(schemaService.generateJsonSchema(request));
    }

    @PostMapping("/generate/xsd")
    public ResponseEntity<SchemaGenerationResponse> generateXsd(@RequestBody SchemaGenerationRequest request) {
        return ResponseEntity.ok(schemaService.generateXmlSchema(request));
    }

    @GetMapping("/{schemaId}")
    public ResponseEntity<String> getSchema(@PathVariable String schemaId) {
        String schema = schemaService.getSchema(schemaId);
        if (schema == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(schema);
    }

    @GetMapping("/list")
    public ResponseEntity<List<SchemaInfo>> listSchemas(@RequestParam String database) {
        return ResponseEntity.ok(schemaService.listSchemas(database));
    }

    @DeleteMapping("/{schemaId}")
    public ResponseEntity<Void> deleteSchema(@PathVariable String schemaId) {
        schemaService.deleteSchema(schemaId);
        return ResponseEntity.noContent().build();
    }

    // ── Validation ───────────────────────────────────────────────────────────

    @PostMapping("/validate")
    public ResponseEntity<ValidationResult> validateDocument(@RequestBody ValidationRequest request) {
        return ResponseEntity.ok(validationService.validateDocument(request));
    }

    @PostMapping("/validate/batch")
    public ResponseEntity<List<ValidationResult>> validateBatch(
            @RequestParam String schemaId,
            @RequestBody List<String> documents,
            @RequestParam(defaultValue = "json") String documentType) {
        return ResponseEntity.ok(validationService.validateBatch(schemaId, documents, documentType));
    }

    @PostMapping("/analyze-anomalies")
    public ResponseEntity<Map<String, Object>> analyzeAnomalies(
            @RequestParam String schemaId,
            @RequestBody List<String> documents) {
        return ResponseEntity.ok(validationService.analyzeAnomalies(schemaId, documents));
    }
}