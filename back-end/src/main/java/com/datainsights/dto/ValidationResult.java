package com.datainsights.dto;

import java.util.List;

public class ValidationResult {
    private boolean valid;
    private String schemaId;
    private List<ValidationError> errors;
    private List<String> warnings;
    private long validationTime;

    public ValidationResult() {}

    public ValidationResult(boolean valid, String schemaId, List<ValidationError> errors, List<String> warnings, long validationTime) {
        this.valid = valid;
        this.schemaId = schemaId;
        this.errors = errors;
        this.warnings = warnings;
        this.validationTime = validationTime;
    }

    public boolean isValid() { return valid; }
    public void setValid(boolean valid) { this.valid = valid; }
    public String getSchemaId() { return schemaId; }
    public void setSchemaId(String schemaId) { this.schemaId = schemaId; }
    public List<ValidationError> getErrors() { return errors; }
    public void setErrors(List<ValidationError> errors) { this.errors = errors; }
    public List<String> getWarnings() { return warnings; }
    public void setWarnings(List<String> warnings) { this.warnings = warnings; }
    public long getValidationTime() { return validationTime; }
    public void setValidationTime(long validationTime) { this.validationTime = validationTime; }
}