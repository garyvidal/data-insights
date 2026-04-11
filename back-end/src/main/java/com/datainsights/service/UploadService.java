package com.datainsights.service;

import com.datainsights.config.MarkLogicConfig;
import com.datainsights.dto.UploadResultDTO;
import com.opencsv.CSVReader;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.apache.poi.hssf.usermodel.HSSFWorkbook;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.util.UriComponentsBuilder;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

@Service
public class UploadService {

    private static final Logger log = LoggerFactory.getLogger(UploadService.class);

    private static final Set<String> SUPPORTED_TYPES = Set.of("json", "xml", "csv", "xlsx", "xls");

    private final RestTemplate defaultRestTemplate;
    private final MarkLogicConfig config;

    @Autowired
    private HttpServletRequest httpRequest;

    public UploadService(RestTemplate restTemplate, MarkLogicConfig config) {
        this.defaultRestTemplate = restTemplate;
        this.config = config;
    }

    private RestTemplate restTemplate() {
        HttpSession session = httpRequest.getSession(false);
        if (session != null) {
            String username = (String) session.getAttribute("ml_username");
            String password = (String) session.getAttribute("ml_password");
            if (username != null && password != null) {
                return config.createRestTemplate(username, password);
            }
        }
        return defaultRestTemplate;
    }

    // ── Public entry points ───────────────────────────────────────────────

    /**
     * Process a list of directly uploaded files (no ZIP container).
     */
    public UploadResultDTO processFiles(
            List<MultipartFile> files,
            String database,
            String collection,
            String uriPrefix,
            List<Map<String, String>> permissions,
            String rootKey) throws IOException {

        String prefix = normalisePrefix(uriPrefix);
        log.info("processFiles: {} file(s) -> database={}, prefix={}, rootKey={}", files.size(), database, prefix, rootKey);

        int totalFiles = 0;
        int inserted = 0;
        int skipped = 0;
        int failed = 0;
        Map<String, Integer> byType = new LinkedHashMap<>();
        List<UploadResultDTO.UploadError> errors = new ArrayList<>();

        for (MultipartFile mf : files) {
            String filename = mf.getOriginalFilename() != null ? mf.getOriginalFilename() : mf.getName();
            String ext = extension(filename).toLowerCase();
            totalFiles++;

            if (!SUPPORTED_TYPES.contains(ext)) {
                log.warn("Skipping unsupported file type '{}': {}", ext, filename);
                skipped++;
                continue;
            }

            log.debug("Reading bytes for file: {}", filename);
            byte[] bytes = mf.getBytes();
            ProcessResult pr = processEntry(filename, ext, bytes, prefix, database, collection, permissions, rootKey);
            inserted += pr.inserted;
            failed += pr.failed;
            skipped += pr.skipped;
            pr.byType.forEach((k, v) -> byType.merge(k, v, Integer::sum));
            errors.addAll(pr.errors);
        }

        log.info("processFiles done: totalFiles={}, inserted={}, skipped={}, failed={}", totalFiles, inserted, skipped, failed);
        return new UploadResultDTO(totalFiles, inserted, skipped, failed, byType, errors);
    }

    /**
     * Process a ZIP archive — each entry inside is handled like a direct file.
     */
    public UploadResultDTO processZip(
            MultipartFile file,
            String database,
            String collection,
            String uriPrefix,
            List<Map<String, String>> permissions,
            String rootKey) throws IOException {

        String prefix = normalisePrefix(uriPrefix);
        log.info("processZip: {} ({} bytes) -> database={}, prefix={}, rootKey={}", file.getOriginalFilename(), file.getSize(), database, prefix, rootKey);

        int totalFiles = 0;
        int inserted = 0;
        int skipped = 0;
        int failed = 0;
        Map<String, Integer> byType = new LinkedHashMap<>();
        List<UploadResultDTO.UploadError> errors = new ArrayList<>();

        try (ZipInputStream zis = new ZipInputStream(file.getInputStream())) {
            ZipEntry entry;
            while ((entry = zis.getNextEntry()) != null) {
                if (entry.isDirectory()) { zis.closeEntry(); continue; }

                String entryName = entry.getName();
                String ext = extension(entryName).toLowerCase();
                totalFiles++;

                if (!SUPPORTED_TYPES.contains(ext)) {
                    log.warn("Skipping unsupported zip entry type '{}': {}", ext, entryName);
                    skipped++;
                    zis.closeEntry();
                    continue;
                }

                log.debug("Processing zip entry: {}", entryName);
                byte[] bytes = zis.readAllBytes();
                ProcessResult pr = processEntry(entryName, ext, bytes, prefix, database, collection, permissions, rootKey);
                inserted += pr.inserted;
                failed += pr.failed;
                skipped += pr.skipped;
                pr.byType.forEach((k, v) -> byType.merge(k, v, Integer::sum));
                errors.addAll(pr.errors);

                zis.closeEntry();
            }
        }

        log.info("processZip done: totalFiles={}, inserted={}, skipped={}, failed={}", totalFiles, inserted, skipped, failed);
        return new UploadResultDTO(totalFiles, inserted, skipped, failed, byType, errors);
    }

    // ── Core per-entry processor ──────────────────────────────────────────

    private ProcessResult processEntry(
            String entryName,
            String ext,
            byte[] bytes,
            String prefix,
            String database,
            String collection,
            List<Map<String, String>> permissions,
            String rootKey) {

        ProcessResult result = new ProcessResult();

        if ("csv".equals(ext)) {
            String content = new String(bytes, StandardCharsets.UTF_8);
            List<String[]> rows;
            try (CSVReader csvReader = new CSVReader(new StringReader(content))) {
                rows = csvReader.readAll();
            } catch (Exception e) {
                log.error("CSV parse error for {}: {}", entryName, e.getMessage(), e);
                result.failed++;
                result.errors.add(new UploadResultDTO.UploadError(entryName, "CSV parse error: " + e.getMessage()));
                return result;
            }

            if (rows.size() < 2) {
                log.warn("CSV file {} has no data rows, skipping", entryName);
                result.skipped++;
                return result;
            }

            String[] headers = rows.get(0);
            String baseName = stripExtension(entryName);
            log.info("CSV {}: {} data row(s), {} column(s)", entryName, rows.size() - 1, headers.length);

            for (int i = 1; i < rows.size(); i++) {
                String json = buildJson(headers, rows.get(i), rootKey);
                String uri = sanitiseUri(prefix + baseName + "-" + i + ".json");
                try {
                    putDocument(uri, json, "application/json", database, collection, permissions);
                    result.inserted++;
                    result.byType.merge("csv", 1, Integer::sum);
                } catch (Exception e) {
                    log.error("Failed to insert CSV row {} to {}: {}", i, uri, e.getMessage());
                    result.failed++;
                    result.errors.add(new UploadResultDTO.UploadError(uri, e.getMessage()));
                }
            }

        } else if ("xlsx".equals(ext) || "xls".equals(ext)) {
            String baseName = stripExtension(entryName);
            try (Workbook workbook = "xlsx".equals(ext)
                    ? new XSSFWorkbook(new ByteArrayInputStream(bytes))
                    : new HSSFWorkbook(new ByteArrayInputStream(bytes))) {

                log.info("Excel {}: {} sheet(s)", entryName, workbook.getNumberOfSheets());
                DataFormatter formatter = new DataFormatter();
                for (int s = 0; s < workbook.getNumberOfSheets(); s++) {
                    Sheet sheet = workbook.getSheetAt(s);
                    String sheetName = sheet.getSheetName().replaceAll("[^a-zA-Z0-9_-]", "_");
                    log.debug("Processing sheet '{}' ({} rows)", sheet.getSheetName(), sheet.getLastRowNum());

                    Row headerRow = sheet.getRow(sheet.getFirstRowNum());
                    if (headerRow == null) {
                        log.warn("Sheet '{}' in {} has no header row, skipping", sheet.getSheetName(), entryName);
                        continue;
                    }

                    String[] headers = new String[headerRow.getLastCellNum()];
                    for (int c = 0; c < headers.length; c++) {
                        Cell cell = headerRow.getCell(c, Row.MissingCellPolicy.CREATE_NULL_AS_BLANK);
                        headers[c] = formatter.formatCellValue(cell).trim();
                        if (headers[c].isEmpty()) headers[c] = "col" + c;
                    }

                    int rowNum = 0;
                    for (int r = sheet.getFirstRowNum() + 1; r <= sheet.getLastRowNum(); r++) {
                        Row row = sheet.getRow(r);
                        if (row == null) continue;

                        String[] values = new String[headers.length];
                        for (int c = 0; c < headers.length; c++) {
                            Cell cell = row.getCell(c, Row.MissingCellPolicy.CREATE_NULL_AS_BLANK);
                            values[c] = formatter.formatCellValue(cell);
                        }

                        String json = buildJson(headers, values, rootKey);
                        String uri = sanitiseUri(prefix + baseName + "-" + sheetName + "-" + (++rowNum) + ".json");
                        try {
                            putDocument(uri, json, "application/json", database, collection, permissions);
                            result.inserted++;
                            result.byType.merge(ext, 1, Integer::sum);
                        } catch (Exception e) {
                            log.error("Failed to insert Excel row {} (sheet '{}') to {}: {}", r, sheet.getSheetName(), uri, e.getMessage());
                            result.failed++;
                            result.errors.add(new UploadResultDTO.UploadError(uri, e.getMessage()));
                        }
                    }
                }
            } catch (Exception e) {
                log.error("Excel parse error for {}: {}", entryName, e.getMessage(), e);
                result.failed++;
                result.errors.add(new UploadResultDTO.UploadError(entryName, "Excel parse error: " + e.getMessage()));
            }

        } else {
            // JSON or XML — insert directly
            String content = new String(bytes, StandardCharsets.UTF_8);
            String contentType = "xml".equals(ext) ? "application/xml" : "application/json";
            // Keep directory structure from zip entries, strip it for direct files
            String filename = entryName.contains("/") ? entryName : stripDirectory(entryName);
            String uri = sanitiseUri(prefix + filename);
            try {
                putDocument(uri, content, contentType, database, collection, permissions);
                result.inserted++;
                result.byType.merge(ext, 1, Integer::sum);
            } catch (Exception e) {
                log.error("Failed to insert {} to {}: {}", ext.toUpperCase(), uri, e.getMessage());
                result.failed++;
                result.errors.add(new UploadResultDTO.UploadError(entryName, e.getMessage()));
            }
        }

        return result;
    }

    // ── MarkLogic PUT ─────────────────────────────────────────────────────

    private void putDocument(
            String uri,
            String content,
            String contentType,
            String database,
            String collection,
            List<Map<String, String>> permissions) {

        UriComponentsBuilder builder = UriComponentsBuilder
                .fromHttpUrl(config.getBaseUrl() + "/v1/documents")
                .queryParam("uri", uri)
                .queryParam("database", database);

        if (collection != null && !collection.isBlank()) {
            builder.queryParam("collection", collection);
        }

        if (permissions != null) {
            for (Map<String, String> perm : permissions) {
                String role = perm.get("role");
                String capability = perm.get("capability");
                if (role != null && !role.isBlank() && capability != null && !capability.isBlank()) {
                    builder.queryParam("perm:" + role, capability);
                }
            }
        }

        String url = builder.toUriString();
        log.debug("PUT {} -> {}", contentType, url);

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.parseMediaType(contentType));
        try {
            restTemplate().exchange(url, HttpMethod.PUT, new HttpEntity<>(content, headers), String.class);
            log.debug("PUT success: {}", uri);
        } catch (Exception e) {
            log.error("PUT failed for uri={} database={}: {}", uri, database, e.getMessage());
            throw e;
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    private String normalisePrefix(String uriPrefix) {
        String prefix = (uriPrefix != null && !uriPrefix.isBlank()) ? uriPrefix : "/upload/";
        return prefix.endsWith("/") ? prefix : prefix + "/";
    }

    /** Replace spaces and other URI-unsafe characters so MarkLogic REST accepts the URI. */
    private String sanitiseUri(String uri) {
        return uri.replace(' ', '_');
    }

    private String extension(String filename) {
        int dot = filename.lastIndexOf('.');
        if (dot < 0 || dot == filename.length() - 1) return "";
        String ext = filename.substring(dot + 1);
        return ext.contains("/") || ext.contains("\\") ? "" : ext;
    }

    private String stripExtension(String filename) {
        String name = stripDirectory(filename);
        int dot = name.lastIndexOf('.');
        return dot > 0 ? name.substring(0, dot) : name;
    }

    private String stripDirectory(String filename) {
        int slash = Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\'));
        return slash >= 0 ? filename.substring(slash + 1) : filename;
    }

    private String buildJson(String[] headers, String[] values, String rootKey) {
        StringBuilder sb = new StringBuilder("{");
        for (int i = 0; i < headers.length; i++) {
            if (i > 0) sb.append(",");
            sb.append("\"").append(escapeJson(headers[i])).append("\":");
            String val = i < values.length ? values[i] : "";
            sb.append("\"").append(escapeJson(val)).append("\"");
        }
        sb.append("}");
        String inner = sb.toString();
        if (rootKey != null && !rootKey.isBlank()) {
            return "{\"" + escapeJson(rootKey) + "\":" + inner + "}";
        }
        return inner;
    }

    private String escapeJson(String s) {
        return s.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r")
                .replace("\t", "\\t");
    }

    // ── Internal result accumulator ───────────────────────────────────────

    private static class ProcessResult {
        int inserted = 0;
        int skipped = 0;
        int failed = 0;
        Map<String, Integer> byType = new LinkedHashMap<>();
        List<UploadResultDTO.UploadError> errors = new ArrayList<>();
    }
}
