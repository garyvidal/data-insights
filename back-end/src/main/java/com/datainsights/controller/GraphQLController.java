package com.datainsights.controller;

import com.datainsights.service.MarkLogicService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/v1/resources/graphql")
public class GraphQLController {

    private static final Logger log = LoggerFactory.getLogger(GraphQLController.class);

    private final MarkLogicService mlService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public GraphQLController(MarkLogicService mlService) {
        this.mlService = mlService;
    }

    /**
     * GET — utility actions: derive, schema, introspect.
     * Parses the MarkLogic JSON response into a JsonNode so Spring serializes
     * it as a proper JSON object (not a double-encoded string).
     */
    @GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<JsonNode> graphQLGet(@RequestParam Map<String, String> params) throws Exception {
        String response = mlService.graphQLGet(params);
        JsonNode json = parseOrWrap(response);
        if (json.has("error")) {
            log.error("MarkLogic GET error. params={} raw={}}", params, response);
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(json);
        }
        return ResponseEntity.ok(json);
    }

    /**
     * POST — execute a GraphQL query.
     * Accepts the standard GraphQL JSON envelope { query, variables, operationName }
     * and proxies it directly to the MarkLogic REST extension.
     */
    @PostMapping(
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE
    )
    public ResponseEntity<JsonNode> graphQLPost(@RequestBody Map<String, Object> body) throws Exception {
        String response = mlService.graphQLPost(body);
        JsonNode json = parseOrWrap(response);
        if (json.has("error")) {
            log.error("MarkLogic POST error. body={} raw={}", body, response);
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(json);
        }
        return ResponseEntity.ok(json);
    }

    /**
     * DELETE — remove a schema type by name.
     * Proxies DELETE /v1/resources/graphql?rs:type={type} to MarkLogic.
     */
    @DeleteMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<JsonNode> graphQLDelete(@RequestParam Map<String, String> params) {
        try {
            mlService.graphQLDelete(params);
            String typeName = params.getOrDefault("type", "");
            return ResponseEntity.ok(objectMapper.createObjectNode()
                    .put("deleted", true)
                    .put("type", typeName));
        } catch (Exception e) {
            log.error("MarkLogic DELETE error. params={}", params, e);
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(
                    objectMapper.createObjectNode().put("error", e.getMessage()));
        }
    }

    /** Parse as JSON; if MarkLogic returned XML or something unexpected, wrap it as an error node. */
    private JsonNode parseOrWrap(String response) {
        try {
            return objectMapper.readTree(response);
        } catch (Exception e) {
            log.error("MarkLogic returned non-JSON response: {}", response);
            return objectMapper.createObjectNode()
                    .put("error", "MarkLogic returned a non-JSON response: " + response.substring(0, Math.min(500, response.length())));
        }
    }
}

