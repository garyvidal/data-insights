package com.datainsights.service;

import com.datainsights.config.MarkLogicConfig;
import com.datainsights.dto.UploadResultDTO;
import com.marklogic.client.DatabaseClient;
import com.marklogic.client.datamovement.DataMovementManager;
import com.marklogic.client.datamovement.WriteBatcher;
import com.marklogic.client.io.DocumentMetadataHandle;
import com.marklogic.client.io.Format;
import com.marklogic.client.io.StringHandle;
import com.opencsv.CSVReader;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.apache.poi.hssf.usermodel.HSSFWorkbook;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

@Service
public class UploadService {

    private static final Logger log = LoggerFactory.getLogger(UploadService.class);

    private static final Set<String> SUPPORTED_TYPES = Set.of("json", "xml", "csv", "xlsx", "xls");

    // Tune for your server / network topology
    private static final int BATCH_SIZE   = 500;
    private static final int THREAD_COUNT = 8;

    private final MarkLogicConfig config;

    @Value("${marklogic.username}")
    private String defaultUsername;

    @Value("${marklogic.password}")
    private String defaultPassword;

    @Autowired
    private HttpServletRequest httpRequest;

    public UploadService(MarkLogicConfig config) {
        this.config = config;
    }

    // ── Session-credential resolution ─────────────────────────────────────

    private DatabaseClient newClient(String database) {
        HttpSession session = httpRequest.getSession(false);
        if (session != null) {
            String u = (String) session.getAttribute("ml_username");
            String p = (String) session.getAttribute("ml_password");
            if (u != null && p != null) {
                return config.createDatabaseClient(u, p, database);
            }
        }
        return config.createDatabaseClient(defaultUsername, defaultPassword, database);
    }

    // ── Public entry points ───────────────────────────────────────────────

    public UploadResultDTO processFiles(
            List<MultipartFile> files,
            String database,
            String collection,
            String uriPrefix,
            List<Map<String, String>> permissions,
            String rootKey) throws IOException {

        String prefix = normalisePrefix(uriPrefix);
        log.info("processFiles: {} file(s) -> database={}, prefix={}, rootKey={}",
                files.size(), database, prefix, rootKey);

        BatchContext ctx = new BatchContext();
        DatabaseClient client = newClient(database);
        try {
            DataMovementManager dmm = client.newDataMovementManager();
            WriteBatcher batcher = buildBatcher(dmm, collection, permissions, ctx);
            dmm.startJob(batcher);

            for (MultipartFile mf : files) {
                String filename = mf.getOriginalFilename() != null ? mf.getOriginalFilename() : mf.getName();
                String ext = extension(filename).toLowerCase();
                ctx.totalFiles.incrementAndGet();

                if (!SUPPORTED_TYPES.contains(ext)) {
                    log.warn("Skipping unsupported file type '{}': {}", ext, filename);
                    ctx.skipped.incrementAndGet();
                    continue;
                }

                enqueueEntry(filename, ext, mf.getBytes(), prefix, rootKey, batcher, ctx);
            }

            batcher.flushAndWait();
            dmm.stopJob(batcher);
        } finally {
            client.release();
        }

        log.info("processFiles done: totalFiles={}, inserted={}, skipped={}, failed={}",
                ctx.totalFiles, ctx.inserted, ctx.skipped, ctx.failed);
        return ctx.toResult();
    }

    public UploadResultDTO processZip(
            MultipartFile file,
            String database,
            String collection,
            String uriPrefix,
            List<Map<String, String>> permissions,
            String rootKey) throws IOException {

        String prefix = normalisePrefix(uriPrefix);
        log.info("processZip: {} ({} bytes) -> database={}, prefix={}, rootKey={}",
                file.getOriginalFilename(), file.getSize(), database, prefix, rootKey);

        BatchContext ctx = new BatchContext();
        DatabaseClient client = newClient(database);
        try {
            DataMovementManager dmm = client.newDataMovementManager();
            WriteBatcher batcher = buildBatcher(dmm, collection, permissions, ctx);
            dmm.startJob(batcher);

            try (ZipInputStream zis = new ZipInputStream(file.getInputStream())) {
                ZipEntry entry;
                while ((entry = zis.getNextEntry()) != null) {
                    if (entry.isDirectory()) { zis.closeEntry(); continue; }

                    String entryName = entry.getName();
                    String ext = extension(entryName).toLowerCase();
                    ctx.totalFiles.incrementAndGet();

                    if (!SUPPORTED_TYPES.contains(ext)) {
                        log.warn("Skipping unsupported zip entry '{}': {}", ext, entryName);
                        ctx.skipped.incrementAndGet();
                        zis.closeEntry();
                        continue;
                    }

                    enqueueEntry(entryName, ext, zis.readAllBytes(), prefix, rootKey, batcher, ctx);
                    zis.closeEntry();
                }
            }

            batcher.flushAndWait();
            dmm.stopJob(batcher);
        } finally {
            client.release();
        }

        log.info("processZip done: totalFiles={}, inserted={}, skipped={}, failed={}",
                ctx.totalFiles, ctx.inserted, ctx.skipped, ctx.failed);
        return ctx.toResult();
    }

    // ── WriteBatcher factory ──────────────────────────────────────────────

    private WriteBatcher buildBatcher(
            DataMovementManager dmm,
            String collection,
            List<Map<String, String>> permissions,
            BatchContext ctx) {

        // Build default metadata: collection + permissions applied to every document
        DocumentMetadataHandle metadata = new DocumentMetadataHandle();
        if (collection != null && !collection.isBlank()) {
            metadata.getCollections().add(collection);
        }
        if (permissions != null) {
            for (Map<String, String> perm : permissions) {
                String role       = perm.get("role");
                String capability = perm.get("capability");
                if (role != null && !role.isBlank() && capability != null && !capability.isBlank()) {
                    metadata.getPermissions().add(role, capabilityFor(capability));
                }
            }
        }

        return dmm.newWriteBatcher()
                .withBatchSize(BATCH_SIZE)
                .withThreadCount(THREAD_COUNT)
                .withDefaultMetadata(metadata)
                .onBatchSuccess(batch -> {
                    int n = batch.getItems().length;
                    ctx.inserted.addAndGet(n);
                    for (var item : batch.getItems()) {
                        String uri = item.getTargetUri();
                        String ext = (uri != null) ? extension(uri) : "";
                        ctx.byType.merge(ext.isEmpty() ? "json" : ext, 1, Integer::sum);
                    }
                    log.debug("Batch success: {} doc(s) written", n);
                })
                .onBatchFailure((batch, throwable) -> {
                    for (var item : batch.getItems()) {
                        String uri = item.getTargetUri() != null ? item.getTargetUri() : "(unknown)";
                        log.error("Batch failure uri={}: {}", uri, throwable.getMessage());
                        ctx.failed.incrementAndGet();
                        ctx.errors.add(new UploadResultDTO.UploadError(uri, throwable.getMessage()));
                    }
                });
    }

    private DocumentMetadataHandle.Capability capabilityFor(String s) {
        return switch (s.toLowerCase()) {
            case "update"  -> DocumentMetadataHandle.Capability.UPDATE;
            case "insert"  -> DocumentMetadataHandle.Capability.INSERT;
            case "execute" -> DocumentMetadataHandle.Capability.EXECUTE;
            default        -> DocumentMetadataHandle.Capability.READ;
        };
    }

    // ── Per-entry parsing and enqueue ─────────────────────────────────────

    private void enqueueEntry(
            String entryName, String ext, byte[] bytes,
            String prefix, String rootKey,
            WriteBatcher batcher, BatchContext ctx) {

        switch (ext) {
            case "csv"            -> enqueueCsv(entryName, bytes, prefix, rootKey, batcher, ctx);
            case "xlsx", "xls"   -> enqueueExcel(entryName, ext, bytes, prefix, rootKey, batcher, ctx);
            default               -> enqueueDocument(entryName, ext, bytes, prefix, batcher);
        }
    }

    private void enqueueCsv(
            String entryName, byte[] bytes, String prefix, String rootKey,
            WriteBatcher batcher, BatchContext ctx) {

        List<String[]> rows;
        try (CSVReader csvReader = new CSVReader(new StringReader(new String(bytes, StandardCharsets.UTF_8)))) {
            rows = csvReader.readAll();
        } catch (Exception e) {
            log.error("CSV parse error for {}: {}", entryName, e.getMessage(), e);
            ctx.failed.incrementAndGet();
            ctx.errors.add(new UploadResultDTO.UploadError(entryName, "CSV parse error: " + e.getMessage()));
            return;
        }

        if (rows.size() < 2) {
            log.warn("CSV file {} has no data rows, skipping", entryName);
            ctx.skipped.incrementAndGet();
            return;
        }

        String[] headers  = rows.get(0);
        String   baseName = stripExtension(entryName);
        log.info("CSV {}: {} data row(s), {} column(s)", entryName, rows.size() - 1, headers.length);

        for (int i = 1; i < rows.size(); i++) {
            String uri = sanitiseUri(prefix + baseName + "-" + i + ".json");
            batcher.addAs(uri, new StringHandle(buildJson(headers, rows.get(i), rootKey)).withFormat(Format.JSON));
        }
    }

    private void enqueueExcel(
            String entryName, String ext, byte[] bytes, String prefix, String rootKey,
            WriteBatcher batcher, BatchContext ctx) {

        String baseName = stripExtension(entryName);
        try (Workbook workbook = "xlsx".equals(ext)
                ? new XSSFWorkbook(new ByteArrayInputStream(bytes))
                : new HSSFWorkbook(new ByteArrayInputStream(bytes))) {

            log.info("Excel {}: {} sheet(s)", entryName, workbook.getNumberOfSheets());
            DataFormatter formatter = new DataFormatter();

            for (int s = 0; s < workbook.getNumberOfSheets(); s++) {
                Sheet sheet     = workbook.getSheetAt(s);
                String sheetName = sheet.getSheetName().replaceAll("[^a-zA-Z0-9_-]", "_");
                Row headerRow   = sheet.getRow(sheet.getFirstRowNum());
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

                    String uri = sanitiseUri(prefix + baseName + "-" + sheetName + "-" + (++rowNum) + ".json");
                    batcher.addAs(uri, new StringHandle(buildJson(headers, values, rootKey)).withFormat(Format.JSON));
                }
            }
        } catch (Exception e) {
            log.error("Excel parse error for {}: {}", entryName, e.getMessage(), e);
            ctx.failed.incrementAndGet();
            ctx.errors.add(new UploadResultDTO.UploadError(entryName, "Excel parse error: " + e.getMessage()));
        }
    }

    private void enqueueDocument(
            String entryName, String ext, byte[] bytes,
            String prefix, WriteBatcher batcher) {

        boolean isXml  = "xml".equals(ext);
        String filename = entryName.contains("/") ? entryName : stripDirectory(entryName);
        String uri      = sanitiseUri(prefix + filename);
        batcher.addAs(uri,
                new StringHandle(new String(bytes, StandardCharsets.UTF_8))
                        .withFormat(isXml ? Format.XML : Format.JSON));
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    private String normalisePrefix(String uriPrefix) {
        String prefix = (uriPrefix != null && !uriPrefix.isBlank()) ? uriPrefix : "/upload/";
        return prefix.endsWith("/") ? prefix : prefix + "/";
    }

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
        return (rootKey != null && !rootKey.isBlank())
                ? "{\"" + escapeJson(rootKey) + "\":" + inner + "}"
                : inner;
    }

    private String escapeJson(String s) {
        return s.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r")
                .replace("\t", "\\t");
    }

    // ── Thread-safe result accumulator ────────────────────────────────────

    private static class BatchContext {
        final AtomicInteger totalFiles = new AtomicInteger();
        final AtomicInteger inserted   = new AtomicInteger();
        final AtomicInteger skipped    = new AtomicInteger();
        final AtomicInteger failed     = new AtomicInteger();
        final Map<String, Integer>              byType = new ConcurrentHashMap<>();
        final List<UploadResultDTO.UploadError> errors = Collections.synchronizedList(new ArrayList<>());

        UploadResultDTO toResult() {
            return new UploadResultDTO(
                    totalFiles.get(), inserted.get(), skipped.get(), failed.get(),
                    new LinkedHashMap<>(byType), new ArrayList<>(errors));
        }
    }
}
