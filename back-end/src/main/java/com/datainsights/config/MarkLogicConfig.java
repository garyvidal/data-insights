package com.datainsights.config;

import com.marklogic.client.DatabaseClient;
import com.marklogic.client.DatabaseClientFactory;
import org.apache.hc.client5.http.auth.AuthScope;
import org.apache.hc.client5.http.auth.UsernamePasswordCredentials;
import org.apache.hc.client5.http.impl.auth.BasicCredentialsProvider;
import org.apache.hc.client5.http.impl.classic.CloseableHttpClient;
import org.apache.hc.client5.http.impl.classic.HttpClientBuilder;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.HttpComponentsClientHttpRequestFactory;
import org.springframework.http.client.ClientHttpResponse;
import org.springframework.web.client.ResponseErrorHandler;
import org.springframework.web.client.RestTemplate;
import java.io.IOException;

@Configuration
public class MarkLogicConfig {

    @Value("${marklogic.username}")
    private String username;

    @Value("${marklogic.password}")
    private String password;

    @Value("${marklogic.host}")
    private String host;

    @Value("${marklogic.port}")
    private int port;

    @Bean
    public RestTemplate markLogicRestTemplate() {
        return createRestTemplate(username, password);
    }

    public RestTemplate createRestTemplate(String user, String pass) {
        BasicCredentialsProvider credentialsProvider = new BasicCredentialsProvider();
        credentialsProvider.setCredentials(
                new AuthScope(host, port),
                new UsernamePasswordCredentials(user, pass.toCharArray())
        );

        CloseableHttpClient httpClient = HttpClientBuilder.create()
                .setDefaultCredentialsProvider(credentialsProvider)
                .build();

        HttpComponentsClientHttpRequestFactory factory = new HttpComponentsClientHttpRequestFactory(httpClient);
        factory.setConnectTimeout(10000);

        RestTemplate template = new RestTemplate(factory);
        // Do not throw exceptions on 4xx/5xx — return the response body so callers
        // can parse the MarkLogic error JSON and surface it to the client.
        template.setErrorHandler(new ResponseErrorHandler() {
            @Override public boolean hasError(ClientHttpResponse r) throws IOException { return false; }
            @Override public void handleError(ClientHttpResponse r) throws IOException { }
        });
        return template;
    }

    /**
     * Creates a DatabaseClient for the given user and target database using Digest auth.
     * The caller is responsible for calling client.release() when done.
     */
    public DatabaseClient createDatabaseClient(String user, String pass, String database) {
        return DatabaseClientFactory.newClient(
                host, port, database,
                new DatabaseClientFactory.DigestAuthContext(user, pass)
        );
    }

    public String getHost() { return host; }
    public int getPort()    { return port; }
    public String getBaseUrl() { return "http://" + host + ":" + port; }
}
