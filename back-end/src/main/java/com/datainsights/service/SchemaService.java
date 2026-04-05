package com.datainsights.service;

import com.datainsights.dto.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.*;

@Service
public class SchemaService {

    private static final Logger log = LoggerFactory.getLogger(SchemaService.class);
    private static final Map<String, String> schemaCache = new HashMap<>();
    private static final ObjectMapper mapper = new ObjectMapper();

    private final MarkLogicService mlService;

    public SchemaService(MarkLogicService mlService) {
        this.mlService = mlService;
    }

    public SchemaGenerationResponse generateJsonSchema(SchemaGenerationRequest request) {
        log.info("Generating JSON Schema for analysis: {}", request.getAnalysisId());
        
        SchemaGenerationResponse response = new SchemaGenerationResponse();
        response.setSchemaId(UUID.randomUUID().toString());
        response.setAnalysisId(request.getAnalysisId());
        response.setDatabase(request.getDatabase());
        response.setSchemaType("json-schema");
        
        try {
            List<Map<String, Object>> analysisStructure = 
                mlService.getAnalysisStructure(request.getAnalysisId(), request.getDatabase());
            
            ObjectNode schema = generateSchemaFromAnalysis(analysisStructure, request.isStrict());
            
            response.setSchema(mapper.writerWithDefaultPrettyPrinter().writeValueAsString(schema));
            response.setDocumentCount(analysisStructure.size());
            response.setStatus("success");
            response.setMessage("JSON Schema generated successfully");
            response.setGeneratedAt(java.time.LocalDateTime.now());
            
            schemaCache.put(response.getSchemaId(), response.getSchema());
        } catch (Exception e) {
            log.error("Error generating JSON schema", e);
            response.setStatus("error");
            response.setMessage("Failed to generate schema: " + e.getMessage());
        }
        
        return response;
    }

    public SchemaGenerationResponse generateXmlSchema(SchemaGenerationRequest request) {
        log.info("Generating XSD for analysis: {}", request.getAnalysisId());
        
        SchemaGenerationResponse response = new SchemaGenerationResponse();
        response.setSchemaId(UUID.randomUUID().toString());
        response.setAnalysisId(request.getAnalysisId());
        response.setDatabase(request.getDatabase());
        response.setSchemaType("xsd");
        
        try {
            List<Map<String, Object>> analysisStructure = 
                mlService.getAnalysisStructure(request.getAnalysisId(), request.getDatabase());
            
            String xsd = generateXsdFromAnalysis(analysisStructure, request.isStrict());
            
            response.setSchema(xsd);
            response.setDocumentCount(analysisStructure.size());
            response.setStatus("success");
            response.setMessage("XSD generated successfully");
            response.setGeneratedAt(java.time.LocalDateTime.now());
            
            schemaCache.put(response.getSchemaId(), xsd);
        } catch (Exception e) {
            log.error("Error generating XSD", e);
            response.setStatus("error");
            response.setMessage("Failed to generate XSD: " + e.getMessage());
        }
        
        return response;
    }

    public String getSchema(String schemaId) {
        return schemaCache.get(schemaId);
    }

    private ObjectNode generateSchemaFromAnalysis(List<Map<String, Object>> structure, boolean strict) throws Exception {
        ObjectNode schema = mapper.createObjectNode();
        schema.put("$" + "schema", "http://json-schema.org/draft-07/schema#");
        schema.put("type", "object");
        
        ObjectNode properties = mapper.createObjectNode();
        List<String> requiredFields = new ArrayList<>();
        
        for (Map<String, Object> element : structure) {
            String localname = (String) element.getOrDefault("localname", "element");
            String type = (String) element.getOrDefault("type", "string");
            Object frequency = element.get("frequency");
            
            ObjectNode prop = mapper.createObjectNode();
            prop.put("type", mapToJsonType(type));
            
            if (element.containsKey("distinctValues")) {
                prop.put("description", "Element with " + element.get("distinctValues") + " distinct values");
            }
            
            if (strict && frequency != null && !frequency.toString().equals("0")) {
                requiredFields.add(localname);
            }
            
            properties.set(localname, prop);
        }
        
        schema.set("properties", properties);
        
        if (!requiredFields.isEmpty()) {
            var requiredArray = schema.putArray("required");
            for (String field : requiredFields) {
                requiredArray.add(field);
            }
        }
        
        schema.put("additionalProperties", !strict);
        return schema;
    }

    private String generateXsdFromAnalysis(List<Map<String, Object>> structure, boolean strict) {
        StringBuilder xsd = new StringBuilder();
        xsd.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
        xsd.append("<xs:schema xmlns:xs=\"http://www.w3.org/2001/XMLSchema\">\n");
        
        xsd.append("  <xs:element name=\"root\">\n");
        xsd.append("    <xs:complexType>\n");
        xsd.append("      <xs:sequence>\n");
        
        for (Map<String, Object> element : structure) {
            String localname = (String) element.getOrDefault("localname", "element");
            String type = mapToXsdType((String) element.getOrDefault("type", "string"));
            Object frequency = element.get("frequency");
            
            int minOccurs = (strict && frequency != null && !frequency.toString().equals("0")) ? 1 : 0;
            xsd.append(String.format("        <xs:element name=\"%s\" type=\"%s\" minOccurs=\"%d\" maxOccurs=\"1\"/>\n", 
                localname, type, minOccurs));
        }
        
        xsd.append("      </xs:sequence>\n");
        xsd.append("    </xs:complexType>\n");
        xsd.append("  </xs:element>\n");
        xsd.append("</xs:schema>\n");
        
        return xsd.toString();
    }

    private String mapToJsonType(String type) {
        return switch (type) {
            case "element", "attribute" -> "object";
            case "number" -> "number";
            case "boolean" -> "boolean";
            default -> "string";
        };
    }

    private String mapToXsdType(String type) {
        return switch (type) {
            case "number" -> "xs:decimal";
            case "boolean" -> "xs:boolean";
            case "date" -> "xs:date";
            default -> "xs:string";
        };
    }

    public List<SchemaInfo> listSchemas(String database) {
        List<SchemaInfo> schemas = new ArrayList<>();
        for (String schemaId : schemaCache.keySet()) {
            SchemaInfo info = new SchemaInfo();
            info.setSchemaId(schemaId);
            info.setDatabase(database);
            info.setSchemaType("generated");
            schemas.add(info);
        }
        return schemas;
    }

    public void deleteSchema(String schemaId) {
        schemaCache.remove(schemaId);
        log.info("Schema deleted: {}", schemaId);
    }
}