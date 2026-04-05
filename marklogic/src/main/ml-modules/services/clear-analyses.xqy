xquery version "1.0-ml";
module namespace resource = "http://marklogic.com/rest-api/resource/clear-analyses";

declare namespace ca = "http://marklogic.com/content-analyzer";

declare function delete(
    $context as map:map,
    $params  as map:map
) as document-node()? {
    let $db   := map:get($params, "db")
    let $user := map:get($params, "user")
    let $docs := cts:search(/ca:content-analysis,
                cts:and-query((
                    cts:element-value-query(xs:QName("ca:user"), $user),
                    cts:element-value-query(xs:QName("ca:database"), $db)
                )))
    let $_ := for $doc in $docs return xdmp:node-delete($doc)
    return
        document {
            <deleted>{fn:count($docs)}</deleted>
        }
};
