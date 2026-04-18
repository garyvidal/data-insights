package com.datainsights.dto;

public class ValidationError {
    private String path;
    private String message;
    private String severity;
    private String code;

    public ValidationError() {}

    public ValidationError(String path, String message, String severity, String code) {
        this.path = path;
        this.message = message;
        this.severity = severity;
        this.code = code;
    }

    public String getPath() { return path; }
    public void setPath(String path) { this.path = path; }
    public String getMessage() { return message; }
    public void setMessage(String message) { this.message = message; }
    public String getSeverity() { return severity; }
    public void setSeverity(String severity) { this.severity = severity; }
    public String getCode() { return code; }
    public void setCode(String code) { this.code = code; }
}