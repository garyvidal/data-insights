package com.datainsights.dto;

import java.util.List;
import java.util.Map;

public class UploadResultDTO {

    private int totalFiles;
    private int inserted;
    private int skipped;
    private int failed;
    private Map<String, Integer> byType;
    private List<UploadError> errors;

    public UploadResultDTO() {}

    public UploadResultDTO(int totalFiles, int inserted, int skipped, int failed,
                           Map<String, Integer> byType, List<UploadError> errors) {
        this.totalFiles = totalFiles;
        this.inserted = inserted;
        this.skipped = skipped;
        this.failed = failed;
        this.byType = byType;
        this.errors = errors;
    }

    public int getTotalFiles() { return totalFiles; }
    public void setTotalFiles(int totalFiles) { this.totalFiles = totalFiles; }

    public int getInserted() { return inserted; }
    public void setInserted(int inserted) { this.inserted = inserted; }

    public int getSkipped() { return skipped; }
    public void setSkipped(int skipped) { this.skipped = skipped; }

    public int getFailed() { return failed; }
    public void setFailed(int failed) { this.failed = failed; }

    public Map<String, Integer> getByType() { return byType; }
    public void setByType(Map<String, Integer> byType) { this.byType = byType; }

    public List<UploadError> getErrors() { return errors; }
    public void setErrors(List<UploadError> errors) { this.errors = errors; }

    public static class UploadError {
        private String file;
        private String error;

        public UploadError() {}

        public UploadError(String file, String error) {
            this.file = file;
            this.error = error;
        }

        public String getFile() { return file; }
        public void setFile(String file) { this.file = file; }

        public String getError() { return error; }
        public void setError(String error) { this.error = error; }
    }
}
