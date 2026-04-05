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
import org.springframework.web.util.UriComponentsBuilder;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;
import org.xml.sax.InputSource;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.StringReader;
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
            a.put("analysisName", child(el, "analysis-name"));
            a.put("database", child(el, "database"));
            a.put("localname", child(el, "localname"));
            list.add(a);
        }
        return list;
    }

    // ── Analysis Data ────────────────────────────────────────────────────────

    public String getAnalysisRaw(Map<String, String> params) {
        // Return raw XML for structure — frontend can request specific types
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

    public Map<String, Object> getAnalysisValues(String analysisId, String nodeId, String type, int page, int rows) {
        Map<String, String> params = new LinkedHashMap<>();
        params.put("rs:type", type); // element-values or attribute-values
        params.put("rs:analysis-id", analysisId);
        params.put("rs:id", nodeId);
        params.put("rs:page", String.valueOf(page));
        params.put("rs:rows", String.valueOf(rows));
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
        UriComponentsBuilder builder = UriComponentsBuilder
                .fromHttpUrl(config.getBaseUrl() + path);
        params.forEach(builder::queryParam);
        String url = builder.toUriString();
        log.debug("GET {}", url);
        return restTemplate().getForObject(url, String.class);
    }

    private void delete(String path, Map<String, String> params) {
        UriComponentsBuilder builder = UriComponentsBuilder
                .fromHttpUrl(config.getBaseUrl() + path);
        params.forEach(builder::queryParam);
        String url = builder.toUriString();
        log.debug("DELETE {}", url);
        restTemplate().delete(url);
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
