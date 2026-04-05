package com.datainsights.controller;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;

/**
 * Forwards all non-API routes to index.html so React Router handles navigation.
 */
@Controller
public class SpaController {

    @RequestMapping(value = { "/", "/{path:^(?!api|actuator).*}", "/{path:^(?!api|actuator).*}/**" })
    public String forward() {
        return "forward:/index.html";
    }
}
