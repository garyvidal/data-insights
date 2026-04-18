package com.datainsights.dto;

public class SchemaGenerationRequest {
    private String analysisId;
    private String database;
    private String schemaType;
    private boolean strict;
    private String name;
    /** JSON Schema draft version: "draft-07" (default) or "2019-09" */
    private String draft;

    public SchemaGenerationRequest() {}

    public SchemaGenerationRequest(String analysisId, String database, String schemaType, boolean strict, String name, String draft) {
        this.analysisId = analysisId;
        this.database = database;
        this.schemaType = schemaType;
        this.strict = strict;
        this.name = name;
        this.draft = draft;
    }

    public String getAnalysisId() { return analysisId; }
    public void setAnalysisId(String analysisId) { this.analysisId = analysisId; }
    public String getDatabase() { return database; }
    public void setDatabase(String database) { this.database = database; }
    public String getSchemaType() { return schemaType; }
    public void setSchemaType(String schemaType) { this.schemaType = schemaType; }
    public boolean isStrict() { return strict; }
    public void setStrict(boolean strict) { this.strict = strict; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getDraft() { return draft; }
    public void setDraft(String draft) { this.draft = draft; }
}