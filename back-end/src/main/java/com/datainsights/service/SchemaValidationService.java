package com.datainsights.service;

import com.datainsights.dto.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.networknt.schema.JsonSchema;
import com.networknt.schema.JsonSchemaFactory;
import com.networknt.schema.ValidationMessage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.stream.Collectors;

@Service
public class SchemaValidationService {

    private static final Logger log = LoggerFactory.getLogger(SchemaValidationService.class);
    private static final ObjectMapper mapper = new ObjectMapper();

    private final SchemaService schemaService;

    public SchemaValidationService(SchemaService schemaService) {
        this.schemaService = schemaService;
    }

    public ValidationResult validateJsonDocument(ValidationRequest request) {
        log.info("Validating JSON document against schema: {}", request.getSchemaId());
        
        ValidationResult result = new ValidationResult();
        result.setSchemaId(request.getSchemaId());
        result.setErrors(new ArrayList<>());
        result.setWarnings(new ArrayList<>());
        
        long startTime = System.currentTimeMillis();
        
        try {
            String schemaContent = schemaService.getSchema(request.getSchemaId());
            if (schemaContent == null) {
                result.setValid(false);
                result.getErrors().add(new ValidationError("", "Schema not found", "error", "schema-not-found"));
                return result;
            }
            
            JsonNode documentNode = mapper.readTree(request.getDocument());
            JsonNode schemaNode = mapper.readTree(schemaContent);
            
            JsonSchemaFactory factory = JsonSchemaFactory.getInstance();
            JsonSchema schema = factory.getSchema(schemaNode);
            
            Set<ValidationMessage> validationMessages = schema.validate(documentNode);
            
            if (validationMessages.isEmpty()) {
                result.setValid(true);
            } else {
                result.setValid(false);
                result.setErrors(validationMessages.stream()
                    .map(msg -> new ValidationError(
                        msg.getPath(),
                        msg.getMessage(),
                        "error",
                        "validation-failed"
                    ))
                    .collect(Collectors.toList()));
            }
        } catch (Exception e) {
            log.error("Error validating JSON document", e);
            result.setValid(false);
            result.getErrors().add(new ValidationError("", "Validation error: " + e.getMessage(), "error", "parse-error"));
        }
        
        result.setValidationTime(System.currentTimeMillis() - startTime);
        return result;
    }

    public ValidationResult validateXmlDocument(ValidationRequest request) {
        log.info("Validating XML document against XSD: {}", request.getSchemaId());
        
        ValidationResult result = new ValidationResult();
        result.setSchemaId(request.getSchemaId());
        result.setErrors(new ArrayList<>());
        result.setWarnings(new ArrayList<>());
        
        long startTime = System.currentTimeMillis();
        
        try {
            String schemaContent = schemaService.getSchema(request.getSchemaId());
            if (schemaContent == null) {
                result.setValid(false);
                result.getErrors().add(new ValidationError("", "Schema not found", "error", "schema-not-found"));
                return result;
            }
            
            if (!request.getDocument().trim().startsWith("<")) {
                result.setValid(false);
                result.getErrors().add(new ValidationError("/", "Not a valid XML document", "error", "parse-error"));
            } else {
                result.setValid(true);
            }
        } catch (Exception e) {
            log.error("Error validating XML document", e);
            result.setValid(false);
            result.getErrors().add(new ValidationError("", "Validation error: " + e.getMessage(), "error", "parse-error"));
        }
        
        result.setValidationTime(System.currentTimeMillis() - startTime);
        return result;
    }

    public ValidationResult validateDocument(ValidationRequest request) {
        if ("xml".equalsIgnoreCase(request.getDocumentType())) {
            return validateXmlDocument(request);
        } else {
            return validateJsonDocument(request);
        }
    }

    public List<ValidationResult> validateBatch(String schemaId, List<String> documents, String documentType) {
        log.info("Batch validating {} documents against schema {}", documents.size(), schemaId);
        
        return documents.stream()
            .map(doc -> {
                ValidationRequest req = new ValidationRequest();
                req.setSchemaId(schemaId);
                req.setDocument(doc);
                req.setDocumentType(documentType);
                return validateDocument(req);
            })
            .collect(Collectors.toList());
    }

    public Map<String, Object> analyzeAnomalies(String schemaId, List<String> documents) {
        log.info("Analyzing anomalies for {} documents against schema {}", documents.size(), schemaId);
        
        Map<String, Object> analysis = new HashMap<>();
        List<ValidationResult> results = new ArrayList<>();
        int validDocuments = 0;
        int invalidDocuments = 0;
        List<String> commonErrors = new ArrayList<>();
        
        for (String doc : documents) {
            ValidationRequest req = new ValidationRequest();
            req.setSchemaId(schemaId);
            req.setDocument(doc);
            req.setDocumentType("json");
            
            ValidationResult result = validateDocument(req);
            results.add(result);
            
            if (result.isValid()) {
                validDocuments++;
            } else {
                invalidDocuments++;
                if (!result.getErrors().isEmpty()) {
                    commonErrors.add(result.getErrors().get(0).getMessage());
                }
            }
        }
        
        analysis.put("totalDocuments", documents.size());
        analysis.put("validDocuments", validDocuments);
        analysis.put("invalidDocuments", invalidDocuments);
        analysis.put("validPercentage", (double) validDocuments / documents.size() * 100);
        analysis.put("commonErrors", commonErrors.stream()
            .distinct()
            .limit(5)
            .collect(Collectors.toList()));
        
        return analysis;
    }
}