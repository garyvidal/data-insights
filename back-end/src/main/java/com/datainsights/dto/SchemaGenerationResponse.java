package com.datainsights.dto;

import java.time.LocalDateTime;

public class SchemaGenerationResponse {
    private String schemaId;
    private String analysisId;
    private String database;
    private String schemaType;
    private String name;
    private String schema;
    private LocalDateTime generatedAt;
    private long documentCount;
    private String status;
    private String message;

    public SchemaGenerationResponse() {}

    public SchemaGenerationResponse(String schemaId, String analysisId, String database, String schemaType, String name, String schema, LocalDateTime generatedAt, long documentCount, String status, String message) {
        this.schemaId = schemaId;
        this.analysisId = analysisId;
        this.database = database;
        this.schemaType = schemaType;
        this.name = name;
        this.schema = schema;
        this.generatedAt = generatedAt;
        this.documentCount = documentCount;
        this.status = status;
        this.message = message;
    }

    public String getSchemaId() { return schemaId; }
    public void setSchemaId(String schemaId) { this.schemaId = schemaId; }
    public String getAnalysisId() { return analysisId; }
    public void setAnalysisId(String analysisId) { this.analysisId = analysisId; }
    public String getDatabase() { return database; }
    public void setDatabase(String database) { this.database = database; }
    public String getSchemaType() { return schemaType; }
    public void setSchemaType(String schemaType) { this.schemaType = schemaType; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getSchema() { return schema; }
    public void setSchema(String schema) { this.schema = schema; }
    public LocalDateTime getGeneratedAt() { return generatedAt; }
    public void setGeneratedAt(LocalDateTime generatedAt) { this.generatedAt = generatedAt; }
    public long getDocumentCount() { return documentCount; }
    public void setDocumentCount(long documentCount) { this.documentCount = documentCount; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public String getMessage() { return message; }
    public void setMessage(String message) { this.message = message; }
}