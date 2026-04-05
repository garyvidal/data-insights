package com.datainsights.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class ValidationRequest {
    private String schemaId;
    private String database;
    @JsonProperty("document")
    private String document;
    private String documentType;
}