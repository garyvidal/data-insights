package com.datainsights.controller;

import com.datainsights.dto.UploadResultDTO;
import com.datainsights.service.UploadService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.Collections;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api")
public class UploadController {

    private static final Logger log = LoggerFactory.getLogger(UploadController.class);

    private final UploadService uploadService;
    private final ObjectMapper objectMapper;

    public UploadController(UploadService uploadService, ObjectMapper objectMapper) {
        this.uploadService = uploadService;
        this.objectMapper = objectMapper;
    }

    @PostMapping("/upload")
    public ResponseEntity<UploadResultDTO> upload(
            @RequestParam("files") List<MultipartFile> files,
            @RequestParam("database") String database,
            @RequestParam(value = "collection", required = false) String collection,
            @RequestParam(value = "uriPrefix", defaultValue = "/upload/") String uriPrefix,
            @RequestParam(value = "permissions", required = false) String permissionsJson,
            @RequestParam(value = "rootKey", required = false) String rootKey) {

        log.info("Upload request: {} file(s), database={}, collection={}, uriPrefix={}, rootKey={}",
                files == null ? 0 : files.size(), database, collection, uriPrefix, rootKey);

        if (files == null || files.isEmpty()) {
            log.warn("Upload rejected: no files provided");
            return ResponseEntity.badRequest().build();
        }

        List<Map<String, String>> permissions = Collections.emptyList();
        if (permissionsJson != null && !permissionsJson.isBlank()) {
            try {
                permissions = objectMapper.readValue(permissionsJson,
                        new TypeReference<List<Map<String, String>>>() {});
                log.debug("Parsed {} permission(s) from request", permissions.size());
            } catch (Exception e) {
                log.warn("Upload rejected: invalid permissions JSON - {}", e.getMessage());
                return ResponseEntity.badRequest().build();
            }
        }

        try {
            UploadResultDTO combined = new com.datainsights.dto.UploadResultDTO(0, 0, 0, 0,
                    new java.util.LinkedHashMap<>(), new java.util.ArrayList<>());

            for (MultipartFile file : files) {
                String name = file.getOriginalFilename() != null ? file.getOriginalFilename() : "";
                log.info("Processing file: {} ({} bytes)", name, file.getSize());
                UploadResultDTO r = name.toLowerCase().endsWith(".zip")
                        ? uploadService.processZip(file, database, collection, uriPrefix, permissions, rootKey)
                        : uploadService.processFiles(List.of(file), database, collection, uriPrefix, permissions, rootKey);
                log.info("File {} result: inserted={}, skipped={}, failed={}", name, r.getInserted(), r.getSkipped(), r.getFailed());
                combined = merge(combined, r);
            }

            log.info("Upload complete: totalFiles={}, inserted={}, skipped={}, failed={}",
                    combined.getTotalFiles(), combined.getInserted(), combined.getSkipped(), combined.getFailed());
            return ResponseEntity.ok(combined);
        } catch (IOException e) {
            log.error("Upload failed with IOException: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError().build();
        }
    }

    private UploadResultDTO merge(UploadResultDTO a, UploadResultDTO b) {
        java.util.Map<String, Integer> byType = new java.util.LinkedHashMap<>(a.getByType());
        b.getByType().forEach((k, v) -> byType.merge(k, v, Integer::sum));
        java.util.List<UploadResultDTO.UploadError> errors = new java.util.ArrayList<>(a.getErrors());
        errors.addAll(b.getErrors());
        return new UploadResultDTO(
                a.getTotalFiles() + b.getTotalFiles(),
                a.getInserted() + b.getInserted(),
                a.getSkipped() + b.getSkipped(),
                a.getFailed() + b.getFailed(),
                byType,
                errors
        );
    }
}
