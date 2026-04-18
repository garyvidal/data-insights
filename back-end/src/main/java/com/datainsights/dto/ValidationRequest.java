package com.datainsights.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

public class ValidationRequest {
    private String schemaId;
    private String database;
    @JsonProperty("document")
    private String document;
    private String documentType;

    public ValidationRequest() {}

    public ValidationRequest(String schemaId, String database, String document, String documentType) {
        this.schemaId = schemaId;
        this.database = database;
        this.document = document;
        this.documentType = documentType;
    }

    public String getSchemaId() { return schemaId; }
    public void setSchemaId(String schemaId) { this.schemaId = schemaId; }
    public String getDatabase() { return database; }
    public void setDatabase(String database) { this.database = database; }
    public String getDocument() { return document; }
    public void setDocument(String document) { this.document = document; }
    public String getDocumentType() { return documentType; }
    public void setDocumentType(String documentType) { this.documentType = documentType; }
}