package com.datainsights.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor  
@AllArgsConstructor
public class SchemaInfo {
    private String schemaId;
    private String name;
    private String schemaType;
    private String analysisId;
    private String database;
    private long documentCount;
    private String createdAt;
}