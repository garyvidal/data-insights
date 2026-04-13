xquery version "1.0-ml";
module namespace resource = "http://marklogic.com/rest-api/resource/search-options";

declare namespace ca = "http://marklogic.com/content-analyzer";

(:~
 : CRUD for named search option sets.
 : Each set is stored as a JSON document under /search-options/{db}/{id}.json
 : in the "search-options" collection.
 :
 : GET  ?action=list&db=...&analysis-id=...  → list all option sets for db/analysis
 : GET  ?action=get&id=...                   → fetch one option set by id
 : POST action=save   body fields: db, analysis-id, name, options (JSON string)
 : POST action=delete body fields: id
 :)

declare function get(
    $context as map:map,
    $params  as map:map
) as document-node()* {
    let $action      := map:get($params, "action")
    let $db          := map:get($params, "db")
    let $analysis-id := map:get($params, "analysis-id")
    let $id          := map:get($params, "id")
    return
        if ($action = "list") then
            let $docs :=
                if ($analysis-id and $analysis-id ne "")
                then cts:search(/,
                    cts:and-query((
                        cts:collection-query("search-options"),
                        cts:json-property-value-query("database", $db),
                        cts:json-property-value-query("analysisId", $analysis-id)
                    )))
                else cts:search(/,
                    cts:and-query((
                        cts:collection-query("search-options"),
                        cts:json-property-value-query("database", $db)
                    )))
            return
                document {
                    object-node {
                        "options": array-node {
                            for $d in $docs
                            return object-node {
                                "id":          $d/id/data(.),
                                "name":        $d/name/data(.),
                                "database":    $d/database/data(.),
                                "analysisId":  $d/analysisId/data(.),
                                "createdAt":   $d/createdAt/data(.)
                            }
                        }
                    }
                }
        else if ($action = "get") then
            let $doc := cts:search(/,
                cts:and-query((
                    cts:collection-query("search-options"),
                    cts:json-property-value-query("id", $id)
                )))[1]
            return
                if ($doc)
                then document { $doc/node() }
                else document { object-node { "error": "not found" } }
        else
            document { object-node { "error": "unknown action" } }
};

declare function post(
    $context as map:map,
    $params  as map:map,
    $input   as document-node()*
) as document-node()? {
    let $action      := map:get($params, "action")
    let $db          := map:get($params, "db")
    let $analysis-id := map:get($params, "analysis-id")
    let $name        := map:get($params, "optname")
    let $options-str := map:get($params, "options")
    let $id          := map:get($params, "id")
    return
        if ($action = "save") then
            let $new-id  := fn:string(xdmp:random())
            let $uri     := fn:concat("/search-options/", $db, "/", $new-id, ".json")
            let $doc     := xdmp:unquote(fn:concat(
                '{"id":"', $new-id, '",',
                '"name":', xdmp:to-json-string($name), ',',
                '"database":', xdmp:to-json-string($db), ',',
                '"analysisId":', xdmp:to-json-string($analysis-id), ',',
                '"createdAt":"', fn:current-dateTime(), '",',
                '"options":', $options-str,
                '}'
            ))
            return (
                xdmp:invoke-function(
                    function() { xdmp:document-insert($uri, $doc, xdmp:default-permissions(), ("search-options", $db)) },
                    <options xmlns="xdmp:eval"><transaction-mode>update-auto-commit</transaction-mode></options>
                ),
                document { object-node { "id": $new-id } }
            )
        else if ($action = "update") then
            let $doc := cts:search(/,
                cts:and-query((
                    cts:collection-query("search-options"),
                    cts:json-property-value-query("id", $id)
                )))[1]
            return
                if ($doc) then
                    let $uri     := xdmp:node-uri($doc)
                    let $perms   := xdmp:document-get-permissions($uri)
                    let $colls   := xdmp:document-get-collections($uri)
                    let $updated := xdmp:unquote(fn:concat(
                        '{"id":"', $id, '",',
                        '"name":', xdmp:to-json-string($name), ',',
                        '"database":', xdmp:to-json-string(fn:string($doc/database)), ',',
                        '"analysisId":', xdmp:to-json-string(fn:string($doc/analysisId)), ',',
                        '"createdAt":', xdmp:to-json-string(fn:string($doc/createdAt)), ',',
                        '"options":', $options-str,
                        '}'
                    ))
                    return (
                        xdmp:invoke-function(
                            function() { xdmp:document-insert($uri, $updated, $perms, $colls) },
                            <options xmlns="xdmp:eval"><transaction-mode>update-auto-commit</transaction-mode></options>
                        ),
                        document { object-node { "id": $id } }
                    )
                else
                    document { object-node { "error": "not found" } }
        else if ($action = "delete") then
            let $doc := cts:search(/,
                cts:and-query((
                    cts:collection-query("search-options"),
                    cts:json-property-value-query("id", $id)
                )))[1]
            return
                if ($doc) then
                    let $uri := xdmp:node-uri($doc)
                    return (
                        xdmp:invoke-function(
                            function() { xdmp:document-delete($uri) },
                            <options xmlns="xdmp:eval"><transaction-mode>update-auto-commit</transaction-mode></options>
                        ),
                        document { object-node { "status": "deleted" } }
                    )
                else
                    document { object-node { "status": "error" } }
        else
            document { object-node { "error": "unknown action" } }
};
