package com.datainsights.dto;

public class SchemaInfo {
    private String schemaId;
    private String name;
    private String schemaType;
    private String analysisId;
    private String database;
    private long documentCount;
    private String createdAt;

    public SchemaInfo() {}

    public SchemaInfo(String schemaId, String name, String schemaType, String analysisId, String database, long documentCount, String createdAt) {
        this.schemaId = schemaId;
        this.name = name;
        this.schemaType = schemaType;
        this.analysisId = analysisId;
        this.database = database;
        this.documentCount = documentCount;
        this.createdAt = createdAt;
    }

    public String getSchemaId() { return schemaId; }
    public void setSchemaId(String schemaId) { this.schemaId = schemaId; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getSchemaType() { return schemaType; }
    public void setSchemaType(String schemaType) { this.schemaType = schemaType; }
    public String getAnalysisId() { return analysisId; }
    public void setAnalysisId(String analysisId) { this.analysisId = analysisId; }
    public String getDatabase() { return database; }
    public void setDatabase(String database) { this.database = database; }
    public long getDocumentCount() { return documentCount; }
    public void setDocumentCount(long documentCount) { this.documentCount = documentCount; }
    public String getCreatedAt() { return createdAt; }
    public void setCreatedAt(String createdAt) { this.createdAt = createdAt; }
}