package com.datainsights.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.LocalDateTime;

@Data
@NoArgsConstructor
@AllArgsConstructor
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
}