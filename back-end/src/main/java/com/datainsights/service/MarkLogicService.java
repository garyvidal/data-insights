package com.datainsights.service;

import com.datainsights.config.MarkLogicConfig;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestTemplate;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;
import org.xml.sax.InputSource;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.StringReader;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.*;

@Service
public class MarkLogicService {

    private static final Logger log = LoggerFactory.getLogger(MarkLogicService.class);

    private final RestTemplate defaultRestTemplate;
    private final MarkLogicConfig config;

    @Autowired
    private HttpServletRequest httpRequest;

    public MarkLogicService(RestTemplate restTemplate, MarkLogicConfig config) {
        this.defaultRestTemplate = restTemplate;
        this.config = config;
    }

    private RestTemplate restTemplate() {
        HttpSession session = httpRequest.getSession(false);
        if (session != null) {
            String username = (String) session.getAttribute("ml_username");
            String password = (String) session.getAttribute("ml_password");
            if (username != null && password != null) {
                return config.createRestTemplate(username, password);
            }
        }
        return defaultRestTemplate;
    }

    // ── Databases ───────────────────────────────────────────────────────────

    public List<String> getDatabases() {
        String xml = get("/v1/resources/databases", Map.of());
        Document doc = parse(xml);
        List<String> names = new ArrayList<>();
        NodeList nodes = doc.getElementsByTagName("database");
        for (int i = 0; i < nodes.getLength(); i++) {
            String name = nodes.item(i).getTextContent().trim();
            if (!name.isEmpty()) names.add(name);
        }
        return names;
    }

    // ── Statistics ──────────────────────────────────────────────────────────

    public Map<String, Object> getDatabaseStatistics(String db) {
        String xml = get("/v1/resources/database-statistics", Map.of("rs:db", db));
        Document doc = parse(xml);
        Map<String, Object> stats = new LinkedHashMap<>();
        stats.put("allDocuments", longText(doc, "all-documents"));
        stats.put("xmlDocuments", longText(doc, "xml-documents"));
        stats.put("jsonDocuments", longText(doc, "json-documents"));
        stats.put("binaryDocuments", longText(doc, "binary-documents"));
        stats.put("textDocuments", longText(doc, "text-documents"));
        return stats;
    }

    public Map<String, Object> getAnalysisStatus(String db) {
        String xml = get("/v1/resources/analysis-status", Map.of("rs:db", db));
        Document doc = parse(xml);
        Map<String, Object> status = new LinkedHashMap<>();
        status.put("analyzed", longText(doc, "analyzed"));
        status.put("running", longText(doc, "running"));
        return status;
    }

    // ── Root Elements ───────────────────────────────────────────────────────

    public List<Map<String, Object>> getRootElements(String db) {
        String xml = get("/v1/resources/root-elements", Map.of("rs:db", db));
        Document doc = parse(xml);
        return parseRootElements(doc.getElementsByTagName("root-element"));
    }

    // ── Analysis List ───────────────────────────────────────────────────────

    public List<Map<String, Object>> getAnalysisList(String db) {
        String xml = get("/v1/resources/analysis-list", Map.of("rs:db", db));
        Document doc = parse(xml);
        List<Map<String, Object>> list = new ArrayList<>();
        NodeList analyses = doc.getElementsByTagName("analysis");
        for (int i = 0; i < analyses.getLength(); i++) {
            Element el = (Element) analyses.item(i);
            Map<String, Object> a = new LinkedHashMap<>();
            a.put("analysisId", child(el, "analysis-id"));
            a.put("analysisUri", child(el, "analysis-uri"));
            a.put("analysisName", child(el, "analysis-name"));
            a.put("database", child(el, "database"));
            a.put("localname", child(el, "localname"));
            a.put("documentType", child(el, "type"));
            list.add(a);
        }
        return list;
    }

    // ── Analysis Data ────────────────────────────────────────────────────────

    public String getAnalysisRaw(Map<String, String> params) {
        return get("/v1/resources/analysis", params);
    }

    public List<Map<String, Object>> getAnalysisStructure(String analysisId, String db) {
        Map<String, String> params = Map.of(
                "rs:type", "structure",
                "rs:analysis-id", analysisId,
                "rs:db", db
        );
        String xml = get("/v1/resources/analysis", params);
        Document doc = parse(xml);
        List<Map<String, Object>> nodes = new ArrayList<>();
        NodeList nodeList = doc.getElementsByTagName("node");
        for (int i = 0; i < nodeList.getLength(); i++) {
            Element el = (Element) nodeList.item(i);
            Map<String, Object> node = new LinkedHashMap<>();
            node.put("key", child(el, "key"));
            node.put("parentKey", child(el, "parent-key"));
            node.put("childKey", child(el, "child-key"));
            node.put("parentChildKey", child(el, "parent-child-key"));
            node.put("type", child(el, "type"));
            node.put("localname", child(el, "localname"));
            node.put("namespace", child(el, "namespace"));
            node.put("xpath", child(el, "xpath"));
            node.put("frequency", child(el, "frequency"));
            node.put("distinctValues", child(el, "distinct-values"));
            node.put("inferedTypes", child(el, "infered-types"));
            node.put("nodeKind", child(el, "node-kind"));
            node.put("minLength", child(el, "min-length"));
            node.put("maxLength", child(el, "max-length"));
            node.put("averageLength", child(el, "average-length"));
            node.put("minValue", child(el, "min-value"));
            node.put("maxValue", child(el, "max-value"));
            node.put("level", child(el, "level"));
            node.put("parent", child(el, "parent"));
            node.put("isLeaf", "true".equals(child(el, "isLeaf")));
            nodes.add(node);
        }
        return nodes;
    }

    public Map<String, Object> getAnalysisValues(String analysisId, String nodeId, String type, int page, int rows, String sortCol, String sortDir) {
        Map<String, String> params = new LinkedHashMap<>();
        params.put("rs:type", type);
        params.put("rs:analysis-id", analysisId);
        params.put("rs:id", nodeId);
        params.put("rs:page", String.valueOf(page));
        params.put("rs:rows", String.valueOf(rows));
        if (sortCol != null && !sortCol.isEmpty()) params.put("rs:sidx", sortCol);
        if (sortDir != null && !sortDir.isEmpty()) params.put("rs:sord", sortDir);
        String xml = get("/v1/resources/analysis", params);
        return parsePaginatedValues(xml, "value", "key", "frequency");
    }

    public Map<String, Object> getAnalysisUris(String analysisId, String db, int page, int rows) {
        Map<String, String> params = new LinkedHashMap<>();
        params.put("rs:type", "uris");
        params.put("rs:analysis-id", analysisId);
        params.put("rs:db", db);
        params.put("rs:page", String.valueOf(page));
        params.put("rs:rows", String.valueOf(rows));
        String xml = get("/v1/resources/analysis", params);
        return parsePaginatedValues(xml, "document", "uri", "document-size");
    }

    public Map<String, Object> getDocumentStats(String analysisId, String db) {
        Map<String,String> params =  Map.of(
                "rs:type", "document-stats",
                "rs:analysis-id", analysisId,
                "rs:db", db
        );
        String xml = get("/v1/resources/analysis",params);
        Document doc = parse(xml);
        Map<String, Object> stats = new LinkedHashMap<>();
        stats.put("avgDocumentSize", child(doc.getDocumentElement(), "avg-document-size"));
        stats.put("minDocumentSize", child(doc.getDocumentElement(), "min-document-size"));
        stats.put("maxDocumentSize", child(doc.getDocumentElement(), "max-document-size"));
        stats.put("medianDocumentSize", child(doc.getDocumentElement(), "median-document-size"));
        return stats;
    }

    // ── Trigger Analysis ─────────────────────────────────────────────────────

    public void analyzeDatabase(String db, String name, String sample,
                                String constraint, String xpath,
                                String all, String[] rootElements) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("db", db);
        body.put("name", name);
        body.put("sample", sample);
        body.put("constraint", constraint);
        body.put("xpath", xpath);
        body.put("all", all);
        body.put("rootElements", rootElements != null ? rootElements : new String[0]);
        postJson("/v1/resources/analyze-database", body);
    }

    public void deleteAnalysis(String id) {
        delete("/v1/resources/analysis", Map.of("rs:id", id));
    }

    public void clearDatabase(String db) {
        delete("/v1/resources/clear-db", Map.of("rs:db", db));
    }

    public void clearAnalyses(String db) {
        delete("/v1/resources/clear-analyses", Map.of("rs:db", db));
    }

    // ── Namespaces ────────────────────────────────────────────────────────────

    public List<Map<String, Object>> getNamespaces(String analysisId) {
        String xml = get("/v1/resources/namespaces", Map.of("rs:id", analysisId));
        Document doc = parse(xml);
        List<Map<String, Object>> list = new ArrayList<>();
        NodeList nodes = doc.getElementsByTagName("namespace");
        for (int i = 0; i < nodes.getLength(); i++) {
            Element el = (Element) nodes.item(i);
            Map<String, Object> ns = new LinkedHashMap<>();
            ns.put("prefix", child(el, "prefix"));
            ns.put("namespaceUri", child(el, "namespace-uri"));
            list.add(ns);
        }
        return list;
    }

    // ── Expressions ──────────────────────────────────────────────────────────

    public List<Map<String, Object>> listExpressions(String db) {
        String xml = get("/v1/resources/expressions", Map.of("rs:action", "rs:list", "rs:db", db));
        Document doc = parse(xml);
        List<Map<String, Object>> list = new ArrayList<>();
        NodeList nodes = doc.getElementsByTagName("expression");
        for (int i = 0; i < nodes.getLength(); i++) {
            Element el = (Element) nodes.item(i);
            Map<String, Object> expr = new LinkedHashMap<>();
            expr.put("id", child(el, "id"));
            expr.put("name", child(el, "name"));
            list.add(expr);
        }
        return list;
    }

    public Map<String, Object> validateExpression(String db, String constraint, String xpath) {
        String xml = post("/v1/resources/validate-query",
                formOf("rs:db", db, "rs:constraint", constraint, "rs:xpath", xpath));
        Document doc = parse(xml);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("valid", "true".equals(child(doc.getDocumentElement(), "valid")));
        result.put("error", child(doc.getDocumentElement(), "error"));
        return result;
    }

    public Map<String, Object> executeQuery(String db, String query, String xpath) {
        String xml = post("/v1/resources/eval-query",
                formOf("rs:db", db, "rs:query", query, "rs:xpath", xpath));
        Document doc = parse(xml);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("valid", "true".equals(child(doc.getDocumentElement(), "valid")));
        result.put("count", child(doc.getDocumentElement(), "count"));
        result.put("error", child(doc.getDocumentElement(), "error"));
        return result;
    }

    public Map<String, Object> executeQueryResults(String db, String query, String xpath,
                                                    String analysisId, int page, int pageSize) {
        String xml = post("/v1/resources/eval-xpath",
                formOf("rs:db", db, "rs:query", query, "rs:xpath", xpath,
                        "rs:analysis-id", analysisId != null ? analysisId : "",
                        "rs:page", String.valueOf(page),
                        "rs:pageSize", String.valueOf(pageSize)));
        Document doc = parse(xml);
        Element root = doc.getDocumentElement();

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("valid", "true".equals(child(root, "valid")));
        result.put("error", child(root, "error"));
        result.put("estimate", child(root, "estimate"));
        result.put("page", page);
        result.put("pageSize", pageSize);

        List<Map<String,Object>> results = new ArrayList<>();
        NodeList resultNodes = root.getElementsByTagName("result");
        for (int i = 0; i < resultNodes.getLength(); i++) {
            Map<String,Object> documentMap = new LinkedHashMap<>();
            Node documentNode = resultNodes.item(i);
            documentMap.put("uri",documentNode.getAttributes().getNamedItem("uri").getTextContent());
            documentMap.put("type",documentNode.getAttributes().getNamedItem("type").getTextContent());
            documentMap.put("collections",documentNode.getAttributes().getNamedItem("collections").getTextContent().split(","));
            documentMap.put("content",resultNodes.item(i).getTextContent());
            results.add(documentMap);
        }
        result.put("results", results);
        return result;
    }

    public Map<String, Object> saveExpression(String db, String name, String query, String xpath) {
        String xml = post("/v1/resources/expressions",
                formOf("rs:action", "save", "rs:db", db,
                        "rs:name", name, "rs:query", query, "rs:xpath", xpath));
        Document doc = parse(xml);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", child(doc.getDocumentElement(), "id"));
        return result;
    }

    public void deleteExpression(String id) {
        post("/v1/resources/expressions",
                formOf("rs:action", "delete", "rs:id", id));
    }

    public Map<String, Object> getExpression(String id) {
        String xml = get("/v1/resources/expressions", Map.of("rs:action", "get", "rs:id", id));
        Document doc = parse(xml);
        Element el = doc.getDocumentElement();
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", child(el, "id"));
        result.put("name", child(el, "name"));
        result.put("query", child(el, "query"));
        result.put("xpath", child(el, "xpath"));
        result.put("database", child(el, "database"));
        return result;
    }

    // ── Search Options ────────────────────────────────────────────────────────

    public List<Map<String, Object>> listSearchOptions(String db, String analysisId) {
        Map<String, String> params = new LinkedHashMap<>();
        params.put("rs:action", "list");
        params.put("rs:db", db);
        if (analysisId != null && !analysisId.isEmpty()) params.put("rs:analysis-id", analysisId);
        String json = get("/v1/resources/search-options", params);
        return parseJsonOptionsList(json);
    }

    public Map<String, Object> saveSearchOptions(String db, String analysisId, String name, String optionsJson) {
        String response = post("/v1/resources/search-options",
                formOf("rs:action", "save", "rs:db", db,
                        "rs:analysis-id", analysisId != null ? analysisId : "",
                        "rs:optname", name,
                        "rs:options", optionsJson));
        // response is JSON {"id":"..."}
        Map<String, Object> result = new LinkedHashMap<>();
        String id = extractJsonString(response, "id");
        result.put("id", id);
        return result;
    }

    public Map<String, Object> updateSearchOptions(String id, String name, String optionsJson) {
        String response = post("/v1/resources/search-options",
                formOf("rs:action", "update", "rs:id", id,
                        "rs:optname", name, "rs:options", optionsJson));
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", extractJsonString(response, "id"));
        return result;
    }

    public void deleteSearchOptions(String id) {
        post("/v1/resources/search-options", formOf("rs:action", "delete", "rs:id", id));
    }

    public Map<String, Object> getSearchOptions(String id) {
        String json = get("/v1/resources/search-options", Map.of("rs:action", "get", "rs:id", id));
        return parseJsonObject(json);
    }

    // ── Index Management ─────────────────────────────────────────────────────

    public Map<String, Object> syncIndexes(String db, String constraintsJson, boolean dropMissing) {
        String response = post("/v1/resources/manage-indexes",
                formOf("rs:action", "sync",
                        "rs:db", db,
                        "rs:constraints", constraintsJson,
                        "rs:drop-missing", dropMissing ? "true" : "false"));
        return parseJsonObject(response);
    }

    // ── Search Options XML Export ─────────────────────────────────────────────

    public String exportSearchOptionsXml(String optionsId) {
        return get("/v1/resources/search", Map.of("rs:options-id", optionsId));
    }

    // ── Search Execute ────────────────────────────────────────────────────────

    public Map<String, Object> executeSearch(String db, String optionsId, String query, int page, int pageSize) {
        String xml = post("/v1/resources/search",
                formOf("rs:db", db, "rs:options-id", optionsId,
                        "rs:query", query != null ? query : "",
                        "rs:page", String.valueOf(page),
                        "rs:pageSize", String.valueOf(pageSize)));
        Document doc = parse(xml);
        Element root = doc.getDocumentElement();

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("valid", "true".equals(child(root, "valid")));
        result.put("error", child(root, "error"));
        result.put("estimate", child(root, "estimate"));
        result.put("page", page);
        result.put("pageSize", pageSize);

        // Parse facets
        List<Map<String, Object>> facets = new ArrayList<>();
        NodeList facetNodes = root.getElementsByTagName("facet");
        for (int i = 0; i < facetNodes.getLength(); i++) {
            Element f = (Element) facetNodes.item(i);
            Map<String, Object> facet = new LinkedHashMap<>();
            facet.put("name", f.getAttribute("name"));
            List<Map<String, Object>> values = new ArrayList<>();
            NodeList valNodes = f.getElementsByTagName("value");
            for (int j = 0; j < valNodes.getLength(); j++) {
                Element v = (Element) valNodes.item(j);
                Map<String, Object> val = new LinkedHashMap<>();
                val.put("name", v.getAttribute("name"));
                val.put("count", v.getAttribute("count"));
                values.add(val);
            }
            facet.put("values", values);
            facets.add(facet);
        }
        result.put("facets", facets);

        // Parse results (same shape as executeQueryResults)
        List<Map<String, Object>> results = new ArrayList<>();
        NodeList resultNodes = root.getElementsByTagName("result");
        for (int i = 0; i < resultNodes.getLength(); i++) {
            Node n = resultNodes.item(i);
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("uri", n.getAttributes().getNamedItem("uri").getTextContent());
            r.put("type", n.getAttributes().getNamedItem("type").getTextContent());
            String cols = n.getAttributes().getNamedItem("collections").getTextContent();
            r.put("collections", cols.isEmpty() ? new String[0] : cols.split(","));
            r.put("content", n.getTextContent());
            results.add(r);
        }
        result.put("results", results);
        return result;
    }

    // ── JSON helpers ──────────────────────────────────────────────────────────

    private List<Map<String, Object>> parseJsonOptionsList(String json) {
        List<Map<String, Object>> list = new ArrayList<>();
        try {
            com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
            com.fasterxml.jackson.databind.JsonNode root = mapper.readTree(json);
            com.fasterxml.jackson.databind.JsonNode opts = root.get("options");
            if (opts != null && opts.isArray()) {
                for (com.fasterxml.jackson.databind.JsonNode n : opts) {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id",         n.path("id").asText(""));
                    m.put("name",       n.path("name").asText(""));
                    m.put("database",   n.path("database").asText(""));
                    m.put("analysisId", n.path("analysisId").asText(""));
                    m.put("createdAt",  n.path("createdAt").asText(""));
                    list.add(m);
                }
            }
        } catch (Exception e) {
            log.warn("Failed to parse search options list: {}", e.getMessage());
        }
        return list;
    }

    private Map<String, Object> parseJsonObject(String json) {
        try {
            com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
            com.fasterxml.jackson.databind.JsonNode root = mapper.readTree(json);
            Map<String, Object> m = new LinkedHashMap<>();
            root.fields().forEachRemaining(e -> m.put(e.getKey(), e.getValue().isTextual() ? e.getValue().asText() : e.getValue().toString()));
            return m;
        } catch (Exception e) {
            log.warn("Failed to parse JSON object: {}", e.getMessage());
            return new LinkedHashMap<>();
        }
    }

    private String extractJsonString(String json, String field) {
        try {
            com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
            return mapper.readTree(json).path(field).asText("");
        } catch (Exception e) {
            return "";
        }
    }

    // ── GraphQL ───────────────────────────────────────────────────────────────

    public String graphQLGet(Map<String, String> params) {
        Map<String, String> mlParams = new LinkedHashMap<>();
        params.forEach((k, v) -> mlParams.put("rs:" + k, v));
        return get("/v1/resources/graphql", mlParams);
    }

    public String graphQLPost(Object body) {
        return postJson("/v1/resources/graphql", body);
    }

    // ── Notifications ─────────────────────────────────────────────────────────

    public Map<String, Object> getNotificationResult() {
        String xml = get("/v1/resources/notifications", Map.of());
        Document doc = parse(xml);
        List<Map<String, Object>> list = new ArrayList<>();
        NodeList nodes = doc.getElementsByTagName("notification");
        for (int i = 0; i < nodes.getLength(); i++) {
            Element el = (Element) nodes.item(i);
            Map<String, Object> n = new LinkedHashMap<>();
            n.put("title", child(el, "title"));
            n.put("message", child(el, "message"));
            list.add(n);
        }
        String status = child(doc.getDocumentElement(), "status");
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("notifications", list);
        result.put("complete", "Complete".equals(status));
        return result;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private String get(String path, Map<String, String> params) {
        URI uri = buildUri(path, params);
        log.debug("GET {}", uri);
        return restTemplate().getForObject(uri, String.class);
    }

    private void delete(String path, Map<String, String> params) {
        URI uri = buildUri(path, params);
        log.debug("DELETE {}", uri);
        restTemplate().delete(uri);
    }

    /**
     * Builds a URI where param names are kept verbatim (preserving colons such as
     * "rs:action" required by MarkLogic REST extensions) and only values are
     * percent-encoded.
     */
    private URI buildUri(String path, Map<String, String> params) {
        StringBuilder sb = new StringBuilder(config.getBaseUrl() + path);
        if (!params.isEmpty()) {
            sb.append('?');
            StringJoiner joiner = new StringJoiner("&");
            for (Map.Entry<String, String> e : params.entrySet()) {
                joiner.add(e.getKey() + "=" + URLEncoder.encode(e.getValue(), StandardCharsets.UTF_8));
            }
            sb.append(joiner);
        }
        return URI.create(sb.toString());
    }

    private String post(String path, MultiValueMap<String, String> form) {
        String url = config.getBaseUrl() + path;
        log.debug("POST {}", url);
        return restTemplate().postForObject(url, form, String.class);
    }

    private String postJson(String path, Object body) {
        String url = config.getBaseUrl() + path;
        log.debug("POST JSON {}", url);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        return restTemplate().postForObject(url, new HttpEntity<>(body, headers), String.class);
    }

    private Document parse(String xml) {
        try {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            factory.setNamespaceAware(false);
            DocumentBuilder builder = factory.newDocumentBuilder();
            return builder.parse(new InputSource(new StringReader(xml)));
        } catch (Exception e) {
            throw new RuntimeException("Failed to parse XML: " + e.getMessage(), e);
        }
    }

    private String child(Element el, String tag) {
        NodeList nodes = el.getElementsByTagName(tag);
        if (nodes.getLength() == 0) return "";
        return nodes.item(0).getTextContent().trim();
    }

    private String child(Document doc, String tag) {
        NodeList nodes = doc.getElementsByTagName(tag);
        if (nodes.getLength() == 0) return "";
        return nodes.item(0).getTextContent().trim();
    }

    private long longText(Document doc, String tag) {
        String val = child(doc, tag);
        if (val.isEmpty()) return 0L;
        try { return Long.parseLong(val); } catch (NumberFormatException e) { return 0L; }
    }

    private List<Map<String, Object>> parseRootElements(NodeList nodes) {
        List<Map<String, Object>> list = new ArrayList<>();
        for (int i = 0; i < nodes.getLength(); i++) {
            Element el = (Element) nodes.item(i);
            Map<String, Object> re = new LinkedHashMap<>();
            re.put("id", child(el, "id"));
            re.put("type", child(el, "type"));
            re.put("database", child(el, "database"));
            re.put("namespace", child(el, "namespace"));
            re.put("localname", child(el, "localname"));
            re.put("frequency", longText(el, "frequency"));
            list.add(re);
        }
        return list;
    }

    private long longText(Element el, String tag) {
        NodeList nodes = el.getElementsByTagName(tag);
        if (nodes.getLength() == 0) return 0L;
        String val = nodes.item(0).getTextContent().trim();
        try { return Long.parseLong(val); } catch (NumberFormatException e) { return 0L; }
    }

    private Map<String, Object> parsePaginatedValues(String xml, String rowTag, String col1, String col2) {
        Document doc = parse(xml);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("page", longText(doc, "page"));
        result.put("total", longText(doc, "total"));
        result.put("records", longText(doc, "records"));
        List<Map<String, Object>> rows = new ArrayList<>();
        NodeList nodes = doc.getElementsByTagName(rowTag);
        for (int i = 0; i < nodes.getLength(); i++) {
            Element el = (Element) nodes.item(i);
            Map<String, Object> row = new LinkedHashMap<>();
            row.put(col1, child(el, col1));
            row.put(col2, child(el, col2));
            rows.add(row);
        }
        result.put("rows", rows);
        return result;
    }

    private MultiValueMap<String, String> formOf(String... pairs) {
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        for (int i = 0; i < pairs.length - 1; i += 2) {
            form.add(pairs[i], pairs[i + 1]);
        }
        return form;
    }
}