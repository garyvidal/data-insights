package com.datainsights.controller;

import com.datainsights.config.MarkLogicConfig;
import jakarta.servlet.http.HttpSession;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClientException;

import java.util.Map;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final MarkLogicConfig config;

    public AuthController(MarkLogicConfig config) {
        this.config = config;
    }

    record LoginRequest(String username, String password) {}

    @PostMapping("/login")
    public ResponseEntity<?> login(@RequestBody LoginRequest request, HttpSession session) {
        if (request.username() == null || request.username().isBlank()
                || request.password() == null || request.password().isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Username and password are required"));
        }
        try {
            // Validate credentials by hitting a lightweight MarkLogic endpoint
            config.createRestTemplate(request.username(), request.password())
                    .getForObject(config.getBaseUrl() + "/v1/resources/databases", String.class);

            session.setAttribute("ml_username", request.username());
            session.setAttribute("ml_password", request.password());
            return ResponseEntity.ok(Map.of("username", request.username()));
        } catch (HttpClientErrorException.Unauthorized | HttpClientErrorException.Forbidden e) {
            return ResponseEntity.status(401).body(Map.of("error", "Invalid username or password"));
        } catch (RestClientException e) {
            return ResponseEntity.status(502).body(Map.of("error", "Could not connect to MarkLogic: " + e.getMessage()));
        }
    }

    @PostMapping("/logout")
    public ResponseEntity<?> logout(HttpSession session) {
        session.invalidate();
        return ResponseEntity.ok().build();
    }

    @GetMapping("/me")
    public ResponseEntity<?> me(HttpSession session) {
        String username = (String) session.getAttribute("ml_username");
        if (username == null) {
            return ResponseEntity.status(401).body(Map.of("error", "Not authenticated"));
        }
        return ResponseEntity.ok(Map.of("username", username));
    }
}
