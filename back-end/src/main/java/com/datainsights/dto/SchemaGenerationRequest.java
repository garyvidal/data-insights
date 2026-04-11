package com.datainsights.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class SchemaGenerationRequest {
    private String analysisId;
    private String database;
    private String schemaType;
    private boolean strict;
    private String name;
    /** JSON Schema draft version: "draft-07" (default) or "2019-09" */
    private String draft;
}