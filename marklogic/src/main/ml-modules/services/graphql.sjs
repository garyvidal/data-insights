'use strict';
/**
 * services/graphql.sjs
 * REST resource extension entry point — delegates to /ext/graphql.sjs.
 * Deployed by ml-gradle as /v1/resources/graphql.
 */
var resource = require('/ext/graphql.sjs');
exports.GET  = resource.GET;
exports.POST = resource.POST;
