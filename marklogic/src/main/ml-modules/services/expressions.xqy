xquery version "1.0-ml";
module namespace resource = "http://marklogic.com/rest-api/resource/expressions";

declare namespace ca = "http://marklogic.com/content-analyzer";

declare function get(
    $context as map:map,
    $params  as map:map
) as document-node()* {
    let $action   := map:get($params, "action")
    let $database := map:get($params, "db")
    let $id       := map:get($params, "id")
    return
        if ($action = "list") then
            document {
                <expressions xmlns="http://marklogic.com/content-analyzer">
                    {/ca:expression[ca:database = $database]}
                </expressions>
            }
        else if ($action = "get") then
            document { /ca:expression[ca:id = $id] }
        else
            document { <error>unknown action</error> }
};

declare function post(
    $context as map:map,
    $params  as map:map,
    $input   as document-node()*
) as document-node()? {
    let $action   := xdmp:get-request-field("action")
    let $database := xdmp:get-request-field("db")
    let $xpath    := xdmp:get-request-field("xpath")
    let $query    := xdmp:get-request-field("query")
    let $name     := xdmp:get-request-field("name")
    let $id       := xdmp:get-request-field("id")
    return
        if ($action = "save") then
            let $new-id    := xdmp:random()
            let $expression :=
                <expression xmlns="http://marklogic.com/content-analyzer">
                    <id>{$new-id}</id>
                    <name>{$name}</name>
                    <user>{xdmp:get-current-user()}</user>
                    <created>{fn:current-dateTime()}</created>
                    <database>{$database}</database>
                    <xpath>{$xpath}</xpath>
                    <query>{$query}</query>
                </expression>
            return (
                xdmp:document-insert(
                    fn:concat("/expressions/", $database, "/", $new-id, ".xml"),
                    $expression,
                    xdmp:default-permissions(),
                    ("expression", $database)
                ),
                document { <id>{$new-id}</id> }
            )
        else if ($action = "delete") then
            let $node := /ca:expression[ca:id = $id]
            return
                document {
                    if ($node)
                    then (xdmp:node-delete($node), <status>deleted</status>)
                    else <status>error</status>
                }
        else
            document { <error>unknown action</error> }
};
