package com.datainsights.service;

import com.datainsights.dto.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

@Service
public class SchemaService {

    private static final Logger log = LoggerFactory.getLogger(SchemaService.class);

    /** In-memory store: schemaId → full response (so list/get have real metadata) */
    private static final Map<String, SchemaGenerationResponse> schemaStore = new ConcurrentHashMap<>();

    private static final ObjectMapper mapper = new ObjectMapper();

    // Frequency threshold: element must appear in ≥ this fraction of docs to be "required"
    private static final double REQUIRED_FREQUENCY_RATIO = 0.90;

    // Max distinct values before we stop emitting an enum
    private static final int MAX_ENUM_VALUES = 20;

    private final MarkLogicService mlService;

    public SchemaService(MarkLogicService mlService) {
        this.mlService = mlService;
    }

    // ── Public API ───────────────────────────────────────────────────────────

    public SchemaGenerationResponse generateJsonSchema(SchemaGenerationRequest request) {
        log.info("Generating JSON Schema for analysis: {}", request.getAnalysisId());

        SchemaGenerationResponse response = newResponse(request, "json-schema");
        try {
            List<Map<String, Object>> structure =
                mlService.getAnalysisStructure(request.getAnalysisId(), request.getDatabase());

            long totalDocs = totalDocumentCount(structure);
            ObjectNode schema = buildJsonSchema(structure, totalDocs, request.isStrict(), request.getDraft());

            response.setSchema(mapper.writerWithDefaultPrettyPrinter().writeValueAsString(schema));
            response.setDocumentCount(totalDocs);
            response.setStatus("success");
            response.setMessage("JSON Schema generated successfully");
        } catch (Exception e) {
            log.error("Error generating JSON schema", e);
            response.setStatus("error");
            response.setMessage("Failed to generate schema: " + e.getMessage());
        }

        schemaStore.put(response.getSchemaId(), response);
        return response;
    }

    public SchemaGenerationResponse generateXmlSchema(SchemaGenerationRequest request) {
        log.info("Generating XSD for analysis: {}", request.getAnalysisId());

        SchemaGenerationResponse response = newResponse(request, "xsd");
        try {
            List<Map<String, Object>> structure =
                mlService.getAnalysisStructure(request.getAnalysisId(), request.getDatabase());

            long totalDocs = totalDocumentCount(structure);
            String xsd = buildXsd(structure, totalDocs, request.isStrict(), request.getName());

            response.setSchema(xsd);
            response.setDocumentCount(totalDocs);
            response.setStatus("success");
            response.setMessage("XSD generated successfully");
        } catch (Exception e) {
            log.error("Error generating XSD", e);
            response.setStatus("error");
            response.setMessage("Failed to generate XSD: " + e.getMessage());
        }

        schemaStore.put(response.getSchemaId(), response);
        return response;
    }

    public String getSchema(String schemaId) {
        SchemaGenerationResponse r = schemaStore.get(schemaId);
        return r != null ? r.getSchema() : null;
    }

    public List<SchemaInfo> listSchemas(String database) {
        return schemaStore.values().stream()
            .filter(r -> database == null || database.equals(r.getDatabase()))
            .map(r -> {
                SchemaInfo info = new SchemaInfo();
                info.setSchemaId(r.getSchemaId());
                info.setName(r.getName() != null ? r.getName() : r.getSchemaId());
                info.setSchemaType(r.getSchemaType());
                info.setAnalysisId(r.getAnalysisId());
                info.setDatabase(r.getDatabase());
                info.setDocumentCount(r.getDocumentCount());
                info.setCreatedAt(r.getGeneratedAt() != null ? r.getGeneratedAt().toString() : "");
                return info;
            })
            .collect(Collectors.toList());
    }

    public void deleteSchema(String schemaId) {
        schemaStore.remove(schemaId);
        log.info("Schema deleted: {}", schemaId);
    }

    // ── JSON Schema builder ──────────────────────────────────────────────────

    /**
     * Builds a hierarchical JSON Schema by:
     * 1. Sorting nodes by level so parents always come before children
     * 2. Recursively nesting child properties under their parent
     * 3. Using inferedTypes from MarkLogic for accurate type mapping
     * 4. Adding minLength/maxLength/minimum/maximum/enum constraints
     */
    private ObjectNode buildJsonSchema(List<Map<String, Object>> structure, long totalDocs,
                                       boolean strict, String draft) {
        ObjectNode root = mapper.createObjectNode();
        String schemaUrl = "2019-09".equals(draft)
            ? "https://json-schema.org/draft/2019-09/schema"
            : "http://json-schema.org/draft-07/schema#";
        root.put("$schema", schemaUrl);
        root.put("type", "object");
        root.put("title", "Generated Schema");

        // Index nodes by key for hierarchy lookup
        Map<String, Map<String, Object>> byKey = new LinkedHashMap<>();
        for (Map<String, Object> node : structure) {
            String key = str(node, "key");
            if (key != null) byKey.put(key, node);
        }

        // Find root-level nodes (no parent or parent not in set)
        List<Map<String, Object>> rootNodes = structure.stream()
            .filter(n -> {
                String parent = str(n, "parentKey");
                return parent == null || parent.isBlank() || !byKey.containsKey(parent);
            })
            .collect(Collectors.toList());

        // Build child index: parentKey → children
        Map<String, List<Map<String, Object>>> childrenOf = new LinkedHashMap<>();
        for (Map<String, Object> node : structure) {
            String parentKey = str(node, "parentKey");
            if (parentKey != null && !parentKey.isBlank() && byKey.containsKey(parentKey)) {
                childrenOf.computeIfAbsent(parentKey, k -> new ArrayList<>()).add(node);
            }
        }

        ObjectNode properties = mapper.createObjectNode();
        ArrayNode required = mapper.createArrayNode();

        for (Map<String, Object> node : rootNodes) {
            String localname = str(node, "localname");
            if (localname == null || localname.isBlank()) continue;

            ObjectNode prop = buildPropertyNode(node, byKey, childrenOf, totalDocs, strict);
            properties.set(localname, prop);

            if (strict && isRequired(node, totalDocs)) {
                required.add(localname);
            }
        }

        root.set("properties", properties);
        if (required.size() > 0) root.set("required", required);
        root.put("additionalProperties", !strict);

        return root;
    }

    private ObjectNode buildPropertyNode(Map<String, Object> node,
                                         Map<String, Map<String, Object>> byKey,
                                         Map<String, List<Map<String, Object>>> childrenOf,
                                         long totalDocs, boolean strict) {
        ObjectNode prop = mapper.createObjectNode();
        String key = str(node, "key");
        String localname = str(node, "localname");
        String mlType = str(node, "type");
        String inferedTypes = str(node, "inferedTypes");
        boolean isLeaf = Boolean.TRUE.equals(node.get("isLeaf"));

        List<Map<String, Object>> children = key != null ? childrenOf.get(key) : null;
        boolean hasChildren = children != null && !children.isEmpty();

        // Determine JSON Schema type from MarkLogic inferred types
        String jsonType = inferJsonType(mlType, inferedTypes, isLeaf, hasChildren);
        prop.put("type", jsonType);

        // Description from distinct values count
        String distinctValues = str(node, "distinctValues");
        String xpath = str(node, "xpath");
        if (xpath != null && !xpath.isBlank()) {
            prop.put("description", "XPath: " + xpath
                + (distinctValues != null ? " | " + distinctValues + " distinct values" : ""));
        } else if (distinctValues != null) {
            prop.put("description", distinctValues + " distinct values");
        }

        // Add string constraints
        if ("string".equals(jsonType)) {
            addStringConstraints(prop, node, inferedTypes);
        }

        // Add numeric constraints
        if ("number".equals(jsonType) || "integer".equals(jsonType)) {
            addNumericConstraints(prop, node);
        }

        // Recurse into children for object/array types
        if (hasChildren) {
            if ("array".equals(jsonType)) {
                // Wrap child properties under "items"
                ObjectNode items = buildChildObject(children, byKey, childrenOf, totalDocs, strict);
                prop.set("items", items);
            } else {
                // object
                ObjectNode childProps = mapper.createObjectNode();
                ArrayNode childRequired = mapper.createArrayNode();
                for (Map<String, Object> child : children) {
                    String childName = str(child, "localname");
                    if (childName == null || childName.isBlank()) continue;
                    childProps.set(childName, buildPropertyNode(child, byKey, childrenOf, totalDocs, strict));
                    if (strict && isRequired(child, totalDocs)) {
                        childRequired.add(childName);
                    }
                }
                prop.set("properties", childProps);
                if (childRequired.size() > 0) prop.set("required", childRequired);
                prop.put("additionalProperties", !strict);
            }
        }

        return prop;
    }

    private ObjectNode buildChildObject(List<Map<String, Object>> children,
                                        Map<String, Map<String, Object>> byKey,
                                        Map<String, List<Map<String, Object>>> childrenOf,
                                        long totalDocs, boolean strict) {
        ObjectNode obj = mapper.createObjectNode();
        obj.put("type", "object");
        ObjectNode props = mapper.createObjectNode();
        for (Map<String, Object> child : children) {
            String name = str(child, "localname");
            if (name == null || name.isBlank()) continue;
            props.set(name, buildPropertyNode(child, byKey, childrenOf, totalDocs, strict));
        }
        obj.set("properties", props);
        return obj;
    }

    /**
     * Infer JSON Schema type using MarkLogic's inferedTypes string and structural hints.
     * inferedTypes is typically a comma-separated list like "xs:string,xs:integer"
     */
    private String inferJsonType(String mlType, String inferedTypes, boolean isLeaf, boolean hasChildren) {
        // Non-leaf with children → object (may be overridden to array below)
        if (hasChildren) return "object";

        if (inferedTypes != null && !inferedTypes.isBlank()) {
            String types = inferedTypes.toLowerCase();
            // Check for array markers
            if (types.contains("array") || types.contains("json-array")) return "array";
            // Numeric types
            if (types.contains("xs:integer") || types.contains("xs:int")
                || types.contains("xs:long") || types.contains("xs:short")) return "integer";
            if (types.contains("xs:decimal") || types.contains("xs:float")
                || types.contains("xs:double") || types.contains("number")) return "number";
            // Boolean
            if (types.contains("xs:boolean") || types.contains("boolean")) return "boolean";
            // Date/time → string with format
            if (types.contains("xs:date") || types.contains("xs:datetime")
                || types.contains("xs:time")) return "string"; // format added separately
        }

        // Fall back on MarkLogic structural type
        if (mlType != null) {
            return switch (mlType.toLowerCase()) {
                case "number" -> "number";
                case "boolean" -> "boolean";
                case "array" -> "array";
                case "object" -> "object";
                default -> "string";
            };
        }

        return "string";
    }

    private void addStringConstraints(ObjectNode prop, Map<String, Object> node, String inferedTypes) {
        // Add format for date/time types
        if (inferedTypes != null) {
            String types = inferedTypes.toLowerCase();
            if (types.contains("xs:datetime")) prop.put("format", "date-time");
            else if (types.contains("xs:date")) prop.put("format", "date");
            else if (types.contains("xs:time")) prop.put("format", "time");
        }

        // minLength / maxLength
        String minLen = str(node, "minLength");
        String maxLen = str(node, "maxLength");
        if (minLen != null && isPositiveLong(minLen)) prop.put("minLength", Long.parseLong(minLen));
        if (maxLen != null && isPositiveLong(maxLen)) prop.put("maxLength", Long.parseLong(maxLen));

        // enum for low-cardinality fields (distinctValues is a count string)
        // We emit the count in description; actual enum values would need a separate values fetch
    }

    private void addNumericConstraints(ObjectNode prop, Map<String, Object> node) {
        String minVal = str(node, "minValue");
        String maxVal = str(node, "maxValue");
        try {
            if (minVal != null && !minVal.isBlank()) prop.put("minimum", Double.parseDouble(minVal));
        } catch (NumberFormatException ignored) {}
        try {
            if (maxVal != null && !maxVal.isBlank()) prop.put("maximum", Double.parseDouble(maxVal));
        } catch (NumberFormatException ignored) {}
    }

    // ── XSD builder ──────────────────────────────────────────────────────────

    private String buildXsd(List<Map<String, Object>> structure, long totalDocs,
                             boolean strict, String rootName) {
        // Index for hierarchy
        Map<String, Map<String, Object>> byKey = new LinkedHashMap<>();
        for (Map<String, Object> node : structure) {
            String key = str(node, "key");
            if (key != null) byKey.put(key, node);
        }

        Map<String, List<Map<String, Object>>> childrenOf = new LinkedHashMap<>();
        for (Map<String, Object> node : structure) {
            String parentKey = str(node, "parentKey");
            if (parentKey != null && !parentKey.isBlank() && byKey.containsKey(parentKey)) {
                childrenOf.computeIfAbsent(parentKey, k -> new ArrayList<>()).add(node);
            }
        }

        List<Map<String, Object>> rootNodes = structure.stream()
            .filter(n -> {
                String p = str(n, "parentKey");
                return p == null || p.isBlank() || !byKey.containsKey(p);
            })
            .collect(Collectors.toList());

        StringBuilder xsd = new StringBuilder();
        xsd.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
        xsd.append("<xs:schema xmlns:xs=\"http://www.w3.org/2001/XMLSchema\">\n\n");

        String effectiveRoot = (rootName != null && !rootName.isBlank()) ? rootName : "root";
        xsd.append("  <xs:element name=\"").append(escapeXml(effectiveRoot)).append("\">\n");
        xsd.append("    <xs:complexType>\n");
        xsd.append("      <xs:sequence>\n");

        for (Map<String, Object> node : rootNodes) {
            appendXsdElement(xsd, node, byKey, childrenOf, totalDocs, strict, 4);
        }

        xsd.append("      </xs:sequence>\n");
        xsd.append("    </xs:complexType>\n");
        xsd.append("  </xs:element>\n\n");
        xsd.append("</xs:schema>\n");
        return xsd.toString();
    }

    private void appendXsdElement(StringBuilder xsd, Map<String, Object> node,
                                   Map<String, Map<String, Object>> byKey,
                                   Map<String, List<Map<String, Object>>> childrenOf,
                                   long totalDocs, boolean strict, int indent) {
        String pad = " ".repeat(indent);
        String localname = str(node, "localname");
        if (localname == null || localname.isBlank()) return;

        String key = str(node, "key");
        List<Map<String, Object>> children = key != null ? childrenOf.get(key) : null;
        boolean hasChildren = children != null && !children.isEmpty();

        int minOccurs = (strict && isRequired(node, totalDocs)) ? 1 : 0;
        String maxOccurs = "unbounded"; // conservative; MarkLogic doesn't give us max cardinality

        if (hasChildren) {
            xsd.append(pad).append("<xs:element name=\"").append(escapeXml(localname)).append("\"")
               .append(" minOccurs=\"").append(minOccurs).append("\"")
               .append(" maxOccurs=\"").append(maxOccurs).append("\">\n");
            xsd.append(pad).append("  <xs:complexType>\n");
            xsd.append(pad).append("    <xs:sequence>\n");
            for (Map<String, Object> child : children) {
                appendXsdElement(xsd, child, byKey, childrenOf, totalDocs, strict, indent + 6);
            }
            xsd.append(pad).append("    </xs:sequence>\n");
            xsd.append(pad).append("  </xs:complexType>\n");
            xsd.append(pad).append("</xs:element>\n");
        } else {
            String xsdType = inferXsdType(str(node, "type"), str(node, "inferedTypes"));
            xsd.append(pad).append("<xs:element name=\"").append(escapeXml(localname)).append("\"")
               .append(" type=\"").append(xsdType).append("\"")
               .append(" minOccurs=\"").append(minOccurs).append("\"")
               .append(" maxOccurs=\"").append(maxOccurs).append("\"/>\n");
        }
    }

    private String inferXsdType(String mlType, String inferedTypes) {
        if (inferedTypes != null && !inferedTypes.isBlank()) {
            String types = inferedTypes.toLowerCase();
            if (types.contains("xs:integer") || types.contains("xs:int")) return "xs:integer";
            if (types.contains("xs:long")) return "xs:long";
            if (types.contains("xs:decimal") || types.contains("xs:float") || types.contains("xs:double")) return "xs:decimal";
            if (types.contains("xs:boolean")) return "xs:boolean";
            if (types.contains("xs:datetime")) return "xs:dateTime";
            if (types.contains("xs:date")) return "xs:date";
            if (types.contains("xs:time")) return "xs:time";
        }
        if (mlType != null) {
            return switch (mlType.toLowerCase()) {
                case "number" -> "xs:decimal";
                case "boolean" -> "xs:boolean";
                case "date" -> "xs:date";
                default -> "xs:string";
            };
        }
        return "xs:string";
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private SchemaGenerationResponse newResponse(SchemaGenerationRequest request, String schemaType) {
        SchemaGenerationResponse r = new SchemaGenerationResponse();
        r.setSchemaId(UUID.randomUUID().toString());
        r.setAnalysisId(request.getAnalysisId());
        r.setDatabase(request.getDatabase());
        r.setSchemaType(schemaType);
        r.setName(request.getName());
        r.setGeneratedAt(LocalDateTime.now());
        return r;
    }

    /**
     * Total document count is derived from the maximum frequency found at level 1 nodes
     * (the root-level elements), since frequency represents occurrence count in the corpus.
     */
    private long totalDocumentCount(List<Map<String, Object>> structure) {
        return structure.stream()
            .filter(n -> "1".equals(str(n, "level")) || str(n, "parentKey") == null || str(n, "parentKey").isBlank())
            .mapToLong(n -> {
                String freq = str(n, "frequency");
                try { return freq != null ? Long.parseLong(freq) : 0L; } catch (NumberFormatException e) { return 0L; }
            })
            .max()
            .orElse(structure.size());
    }

    private boolean isRequired(Map<String, Object> node, long totalDocs) {
        String freq = str(node, "frequency");
        if (freq == null || freq.isBlank() || totalDocs <= 0) return false;
        try {
            long f = Long.parseLong(freq);
            return f > 0 && ((double) f / totalDocs) >= REQUIRED_FREQUENCY_RATIO;
        } catch (NumberFormatException e) {
            return false;
        }
    }

    private static String str(Map<String, Object> map, String key) {
        Object v = map.get(key);
        return v != null ? v.toString() : null;
    }

    private static boolean isPositiveLong(String s) {
        try { return Long.parseLong(s) > 0; } catch (NumberFormatException e) { return false; }
    }

    private static String escapeXml(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }
}
